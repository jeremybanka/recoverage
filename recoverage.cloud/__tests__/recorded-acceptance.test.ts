import { Temporal } from "@js-temporal/polyfill"
import { env } from "cloudflare:test"
import { eq, like } from "drizzle-orm"
import { Hono } from "hono"
import { setSignedCookie } from "hono/cookie"
import { jsonSummaryFixture } from "recoverage-fixtures"

import provenance from "../acceptance/provenance.json"
import app from "../src"
import { getUserRole, upsertStripeSubscription } from "../src/billing"
import { stripeApiVersion } from "../src/billing-config"
import { supporterCheckout } from "../src/checkout"
import { createDatabase } from "../src/db"
import { computeHash } from "../src/hash"
import { reportRequestBytes } from "../src/report-storage"
import * as schema from "../src/schema"
import { createStripeClient, retrieveStripeSubscription } from "../src/stripe"
import { sqlTimestampFromUnixSeconds } from "../src/temporal"

const fixture = provenance.fixture
const origin = `https://recoverage-billing-preview.7tffcqc6vs.workers.dev`
const config = {
	...env,
	STRIPE_MODE: `test` as const,
	STRIPE_SECRET_KEY: `sk_test_replay`,
	STRIPE_WEBHOOK_SECRET: `whsec_local_acceptance_only`,
	STRIPE_SUPPORTER_PRICE_ID: fixture.priceId,
	CHECKOUT_ENABLED: `false`,
}
const db = createDatabase(env.DB)
const stripe = createStripeClient(config.STRIPE_SECRET_KEY)

beforeEach(async () => {
	await db.delete(schema.users).where(eq(schema.users.id, fixture.userId))
	await db
		.delete(schema.stripeWebhookEvents)
		.where(
			like(schema.stripeWebhookEvents.stripeEventId, `evt_local_recorded_%`),
		)
	await db.insert(schema.users).values({ id: fixture.userId })
})

async function cookie(rejected = false) {
	const signer = new Hono().get(`/`, async (c) => {
		await setSignedCookie(
			c,
			`github-access-token`,
			rejected ? `replay-rejected` : `replay-accepted`,
			env.COOKIE_SECRET,
		)
		return c.text(`ok`)
	})
	const response = await signer.request(`/`)
	const value = response.headers.get(`Set-Cookie`)
	assert(value)
	return value
}

async function post(path: string, auth: string, name = `acceptance`) {
	return app.request(
		`${origin}${path}`,
		{
			method: `POST`,
			headers: {
				Cookie: auth,
				Origin: origin,
				"Content-Type": `application/x-www-form-urlencoded`,
			},
			body: new URLSearchParams({ name }),
		},
		config,
	)
}

async function paidAccount() {
	const snapshot = await retrieveStripeSubscription(
		stripe,
		fixture.activeSubscriptionId,
	)
	expect(snapshot.livemode).toBe(false)
	expect(
		await upsertStripeSubscription({
			db,
			subscription: snapshot,
			expectedRevision: null,
		}),
	).toBe(true)
	// Persisted local clock normalization keeps quota tests independent of the
	// recording's calendar date; the provider recording itself is never changed.
	await db
		.update(schema.stripeSubscriptions)
		.set({
			currentPeriodEnd: sqlTimestampFromUnixSeconds(
				Math.floor(Date.now() / 1000) + 86400,
			),
		})
		.where(eq(schema.stripeSubscriptions.stripeSubscriptionId, snapshot.id))
	return snapshot
}

test(`eight overlapping real D1 Checkout requests reuse one durable reservation and recorded Stripe session`, async () => {
	await db
		.insert(schema.stripeCustomers)
		.values({ userId: fixture.userId, stripeCustomerId: fixture.customerId })
	await db.insert(schema.stripeCheckoutAttempts).values({
		userId: fixture.userId,
		attemptId: fixture.attemptId,
		priceId: fixture.priceId,
		origin,
		expiresAt: fixture.expiresAt,
	})
	const results = await Promise.all(
		Array.from({ length: 8 }, () =>
			supporterCheckout({
				db,
				stripe,
				userId: fixture.userId,
				priceId: fixture.priceId,
				origin,
				livemode: false,
				nowSeconds: () => fixture.recordedNow,
			}),
		),
	)
	expect(new Set(results.map((result) => result.url)).size).toBe(1)
	expect(results[0]?.url).toBe(
		`https://checkout.stripe.com/recorded-redacted-session`,
	)
	const attempts = await db.query.stripeCheckoutAttempts.findMany()
	expect(attempts).toHaveLength(1)
	expect(attempts[0]).toMatchObject({
		attemptId: fixture.attemptId,
		stripeSessionId: fixture.sessionId,
	})
	expect(
		await supporterCheckout({
			db,
			stripe,
			userId: fixture.userId,
			priceId: fixture.priceId,
			origin,
			livemode: false,
			nowSeconds: () => fixture.recordedNow,
		}),
	).toEqual(results[0])
})

test(`a real recorded Stripe authentication rejection leaves a signed webhook retryable, then recovery processes it once`, async () => {
	const payload = JSON.stringify({
		id: `evt_local_recorded_retry`,
		object: `event`,
		api_version: stripeApiVersion,
		type: `customer.subscription.updated`,
		livemode: false,
		created: fixture.recordedNow,
		data: {
			object: { id: fixture.activeSubscriptionId, object: `subscription` },
		},
	})
	const signature = await stripe.webhooks.generateTestHeaderStringAsync({
		payload,
		secret: config.STRIPE_WEBHOOK_SECRET,
	})
	const deliver = (key: string) =>
		app.request(
			`${origin}/billing/webhook`,
			{
				method: `POST`,
				headers: { "Stripe-Signature": signature },
				body: payload,
			},
			{ ...config, STRIPE_SECRET_KEY: key },
		)
	expect((await deliver(`sk_test_replay-rejected`)).status).toBe(500)
	const failed = await db.query.stripeWebhookEvents.findFirst()
	expect(failed).toMatchObject({
		processedAt: null,
		processingError: `Stripe authentication failed; verify the API key.`,
	})
	expect(await db.query.stripeSubscriptions.findMany()).toHaveLength(0)
	expect((await deliver(`sk_test_replay`)).status).toBe(200)
	const recovered = await db.query.stripeWebhookEvents.findFirst()
	expect(recovered?.processedAt).toBeTruthy()
	expect(recovered?.processingError).toBeNull()
	expect(
		await getUserRole({
			db,
			userId: fixture.userId,
			stripeSupporterPriceId: fixture.priceId,
			now: Temporal.Instant.fromEpochMilliseconds(fixture.recordedNow * 1000),
		}),
	).toBe(`supporter`)
	const revision = (await db.query.stripeSubscriptions.findFirst())?.syncRevision
	expect(await (await deliver(`sk_test_replay`)).json()).toMatchObject({
		received: true,
		duplicate: true,
	})
	expect((await db.query.stripeSubscriptions.findFirst())?.syncRevision).toBe(
		revision,
	)
})

test(`recorded GitHub rejection clears an expired session without touching account data`, async () => {
	const response = await app.request(
		`${origin}/ui/billing`,
		{ headers: { Cookie: await cookie(true), "HX-Request": `true` } },
		config,
	)
	expect(response.status).toBe(401)
	expect(response.headers.get(`HX-Redirect`)).toBe(`/`)
	expect(response.headers.get(`Set-Cookie`)).toContain(`Max-Age=0`)
	expect(await db.query.users.findMany()).toHaveLength(1)
})

test(`paid to Free to paid admission preserves projects and tokens and returns actual quota HTTP statuses`, async () => {
	const snapshot = await paidAccount()
	const auth = await cookie()
	for (let n = 0; n < 4; n++)
		expect((await post(`/ui/project`, auth, `project-${n}`)).status).toBe(200)
	const projects = await db.query.projects.findMany()
	const project = projects[0]
	assert(project)
	for (let n = 0; n < 6; n++)
		expect(
			(await post(`/ui/token/${project.id}`, auth, `token-${n}`)).status,
		).toBe(200)
	const tokens = await db.query.tokens.findMany()
	// Exercise the actual persisted entitlement transition, without role overrides.
	await db
		.update(schema.stripeSubscriptions)
		.set({ status: `canceled` })
		.where(eq(schema.stripeSubscriptions.stripeSubscriptionId, snapshot.id))
	expect((await post(`/ui/project`, auth)).status).toBe(403)
	expect((await post(`/ui/token/${project.id}`, auth)).status).toBe(403)
	expect(await db.query.projects.findMany()).toEqual(projects)
	expect(await db.query.tokens.findMany()).toEqual(tokens)
	await db
		.update(schema.stripeSubscriptions)
		.set({ status: `active` })
		.where(eq(schema.stripeSubscriptions.stripeSubscriptionId, snapshot.id))
	expect((await post(`/ui/project`, auth)).status).toBe(200)
	expect((await post(`/ui/token/${project.id}`, auth)).status).toBe(200)
	expect(await db.query.projects.findMany()).toHaveLength(5)
	expect(await db.query.tokens.findMany()).toHaveLength(7)
	expect((await db.query.users.findFirst())?.manualRoleOverride).toBeNull()
})

test(`concurrent project and token requests cannot exceed paid ceilings`, async () => {
	await paidAccount()
	const auth = await cookie()
	// D1 batches keep each statement below the provider's SQL variable limit.
	for (let i = 0; i < 99; i++)
		await db.insert(schema.projects).values({
			id: `ceiling-${i}`,
			userId: fixture.userId,
			name: `ceiling-${i}`,
		})
	const projects = await Promise.all(
		Array.from({ length: 8 }, () => post(`/ui/project`, auth)),
	)
	expect(projects.filter((r) => r.status === 200)).toHaveLength(1)
	expect(projects.filter((r) => r.status === 403)).toHaveLength(7)
	expect(await db.query.projects.findMany()).toHaveLength(100)
	for (let i = 0; i < 9; i++)
		expect((await post(`/ui/token/ceiling-0`, auth)).status).toBe(200)
	const tokens = await Promise.all(
		Array.from({ length: 8 }, () => post(`/ui/token/ceiling-0`, auth)),
	)
	expect(tokens.filter((r) => r.status === 200)).toHaveLength(1)
	expect(tokens.filter((r) => r.status === 403)).toHaveLength(7)
	expect(await db.query.tokens.findMany()).toHaveLength(10)
})

test(`real D1 failure yields a correlated safe 500 and preserves the signed-in session`, async () => {
	const auth = await cookie()
	await env.DB.prepare(
		`ALTER TABLE stripeSubscriptions RENAME TO acceptanceUnavailableSubscriptions`,
	).run()
	try {
		for (const path of [`/ui/billing`, `/`]) {
			const response = await app.request(
				`${origin}${path}`,
				{ headers: { Cookie: auth } },
				config,
			)
			expect(response.status).toBe(500)
			expect(response.headers.get(`Set-Cookie`)).toBeNull()
			const result = await response.json<{
				code: string
				requestId: string
				error: string
			}>()
			expect(result.code).toBe(`INTERNAL_ERROR`)
			expect(result.requestId).toMatch(/^[a-f0-9-]{36}$/)
			expect(response.headers.get(`X-Request-Id`)).toBe(result.requestId)
			expect(JSON.stringify(result)).not.toMatch(
				/stripeSubscriptions|SELECT|replay-accepted/,
			)
		}
	} finally {
		await env.DB.prepare(
			`ALTER TABLE acceptanceUnavailableSubscriptions RENAME TO stripeSubscriptions`,
		).run()
	}
})

test(`real request-size rejection preserves a stored report with declared and streamed bodies`, async () => {
	const projectId = `local-ingress-project`
	const tokenId = `local-ingress-token`
	await db
		.insert(schema.projects)
		.values({ id: projectId, userId: fixture.userId, name: projectId })
	await db.insert(schema.tokens).values({
		id: tokenId,
		projectId,
		name: tokenId,
		salt: `local-only-salt`,
		hash: await computeHash(`local-only-password`, `local-only-salt`),
	})
	const headers = { Authorization: `Bearer ${tokenId}.local-only-password` }
	const baseline = JSON.stringify({
		mapData: {},
		jsonSummary: jsonSummaryFixture,
	})
	const put = (body: string, extra: Record<string, string> = {}) =>
		app.request(
			`${origin}/reporter/baseline`,
			{ method: `PUT`, headers: { ...headers, ...extra }, body },
			config,
		)
	expect((await put(baseline)).status).toBe(200)
	// Exactly at the ingress limit remains valid; JSON whitespace adds framing
	// bytes without inventing a D1 report-storage size limit.
	expect(
		(await put(baseline + ` `.repeat(reportRequestBytes - baseline.length)))
			.status,
	).toBe(200)
	for (const extra of [
		{},
		{ "Content-Length": String(reportRequestBytes + 1) },
	]) {
		const response = await put(` `.repeat(reportRequestBytes + 1), extra)
		expect(response.status).toBe(413)
		expect(await response.json()).toMatchObject({ code: `REQUEST_TOO_LARGE` })
		const retained = await app.request(
			`${origin}/reporter/baseline`,
			{ headers },
			config,
		)
		expect(retained.status).toBe(200)
		expect(await retained.text()).toBe(`{}`)
	}
})

async function signedEvent(id: string, type: string, object: unknown) {
	const payload = JSON.stringify({
		id,
		object: `event`,
		api_version: stripeApiVersion,
		type,
		livemode: false,
		created: fixture.recordedNow,
		data: { object },
	})
	const signature = await stripe.webhooks.generateTestHeaderStringAsync({
		payload,
		secret: config.STRIPE_WEBHOOK_SECRET,
	})
	return () =>
		app.request(
			`${origin}/billing/webhook`,
			{
				method: `POST`,
				headers: { "Stripe-Signature": signature },
				body: payload,
			},
			config,
		)
}

test(`an older paid notification cannot revive the genuinely recorded canceled subscription`, async () => {
	const canceled = await retrieveStripeSubscription(
		stripe,
		fixture.canceledSubscriptionId,
	)
	expect(canceled.status).toBe(`canceled`)
	expect(
		await upsertStripeSubscription({
			db,
			subscription: canceled,
			expectedRevision: null,
		}),
	).toBe(true)
	await db
		.insert(schema.projects)
		.values({ id: `preservation`, userId: fixture.userId, name: `preservation` })
	const before = await db.query.projects.findMany()
	const deliver = await signedEvent(
		`evt_local_recorded_old_paid`,
		`invoice.paid`,
		{
			id:
				typeof canceled.latest_invoice === `string`
					? canceled.latest_invoice
					: canceled.latest_invoice?.id,
			parent: { subscription_details: { subscription: canceled.id } },
		},
	)
	expect((await deliver()).status).toBe(200)
	expect((await db.query.stripeSubscriptions.findFirst())?.status).toBe(
		`canceled`,
	)
	expect(
		await getUserRole({
			db,
			userId: fixture.userId,
			stripeSupporterPriceId: fixture.priceId,
		}),
	).toBe(`free`)
	expect(await db.query.projects.findMany()).toEqual(before)
	expect(
		(await db.query.stripeWebhookEvents.findFirst())?.processingError,
	).toBeNull()
})

test(`overlapping signed events serialize real D1 revisions and bounded retries reach a processed terminal state`, async () => {
	const deliveries = await Promise.all(
		Array.from({ length: 8 }, (_, i) =>
			signedEvent(
				`evt_local_recorded_overlap_${i}`,
				`customer.subscription.updated`,
				{ id: fixture.activeSubscriptionId },
			),
		),
	)
	const responses = await Promise.all(deliveries.map((deliver) => deliver()))
	for (let i = 0; i < responses.length; i++) {
		const response = responses[i]
		expect([200, 500]).toContain(response.status)
		if (response.status === 500) expect((await deliveries[i]()).status).toBe(200)
	}
	const events = await db.query.stripeWebhookEvents.findMany()
	expect(events).toHaveLength(8)
	expect(
		events.every((event) => event.processedAt && !event.processingError),
	).toBe(true)
	const subscription = await db.query.stripeSubscriptions.findFirst()
	expect(subscription).toMatchObject({ status: `active`, syncRevision: 8 })
	const repeated = await Promise.all(deliveries.map((deliver) => deliver()))
	for (const response of repeated)
		expect(await response.json()).toMatchObject({
			received: true,
			duplicate: true,
		})
	expect((await db.query.stripeSubscriptions.findFirst())?.syncRevision).toBe(8)
})
