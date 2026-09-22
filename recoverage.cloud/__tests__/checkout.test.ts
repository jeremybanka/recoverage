import { env } from "cloudflare:test"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { setSignedCookie } from "hono/cookie"
import type Stripe from "stripe"

import app from "../src"
import { createDatabase } from "../src/db"
import type { Bindings } from "../src/env"
import * as schema from "../src/schema"

const origin = `https://recoverage.cloud`
const priceId = `price_supporter`
let nextId = 7_600_000

type Session = {
	id: string
	object: `checkout.session`
	mode: `subscription`
	customer: string
	livemode: boolean
	status: `complete` | `expired` | `open`
	url: string | null
	expires_at: number
	metadata: Record<string, string>
	subscription: string | null
	priceId: string
}

async function account() {
	const userId = nextId++
	const db = createDatabase(env.DB)
	await db.insert(schema.users).values({ id: userId })
	const cookies = new Hono().get(`/`, async (c) => {
		await setSignedCookie(
			c,
			`github-access-token`,
			`checkout-${userId}`,
			env.COOKIE_SECRET,
		)
		return c.text(`cookie`)
	})
	const cookie = (await cookies.request(`/`)).headers.get(`set-cookie`)
	assert(cookie)
	return { userId, db, cookie }
}

type Account = Awaited<ReturnType<typeof account>>

function post(owner: Account, bindings: Partial<Bindings> = {}, headers = {}) {
	return app.request(
		`${origin}/billing/checkout`,
		{
			method: `POST`,
			headers: { Cookie: owner.cookie, Origin: origin, ...headers },
		},
		{
			...env,
			STRIPE_SECRET_KEY: `sk_test_placeholder`,
			STRIPE_SUPPORTER_PRICE_ID: priceId,
			STRIPE_WEBHOOK_SECRET: `whsec_placeholder`,
			CHECKOUT_ENABLED: `true`,
			BILLING_SUPPORT_EMAIL: `support@example.com`,
			BILLING_REFUND_POLICY: `Contact support for refunds.`,
			CHECKOUT_LIMITER: { limit: () => Promise.resolve({ success: true }) },
			...bindings,
		},
	)
}

function mockStripe(owner: Account) {
	const sessions = new Map<string, Session>()
	const customers = new Map<string, string>()
	const keys = new Map<string, { body: string; session: Session }>()
	const subscriptions: {
		id: string
		status: Stripe.Subscription.Status
		livemode: boolean
	}[] = []
	const state = {
		failList: false,
		loseCreationResponse: false,
		creates: 0,
		subscriptionPages: 0,
		completeLegacyDuringList: false,
	}
	const fetchMock = vi
		.spyOn(globalThis, `fetch`)
		.mockImplementation(async (input, init) => {
			const request = new Request(input, init)
			const url = new URL(request.url)
			if (url.origin === `https://api.github.com`) {
				return Response.json({
					id: owner.userId,
					login: `checkout-${owner.userId}`,
				})
			}
			expect(url.origin).toBe(`https://api.stripe.com`)
			if (url.pathname === `/v1/prices/${priceId}`) {
				return Response.json({
					id: priceId,
					active: true,
					currency: `usd`,
					unit_amount: 100,
					type: `recurring`,
					livemode: false,
					billing_scheme: `per_unit`,
					recurring: {
						interval: `month`,
						interval_count: 1,
						usage_type: `licensed`,
					},
				})
			}
			if (url.pathname === `/v1/customers` && request.method === `POST`) {
				const key = request.headers.get(`idempotency-key`)
				assert(key)
				if (!customers.has(key))
					customers.set(key, `cus_${owner.userId}_${customers.size}`)
				return Response.json({ id: customers.get(key) })
			}
			if (url.pathname === `/v1/subscriptions`) {
				state.subscriptionPages++
				expect(url.searchParams.get(`status`)).toBe(`all`)
				if (state.failList)
					return Response.json(
						{ error: { message: `Private customer error`, type: `api_error` } },
						{ status: 500, headers: { "stripe-should-retry": `false` } },
					)
				const start = url.searchParams.get(`starting_after`)
				const remaining = start
					? subscriptions.slice(
							subscriptions.findIndex((sub) => sub.id === start) + 1,
						)
					: subscriptions
				return Response.json({
					object: `list`,
					data: remaining.slice(0, 2),
					has_more: remaining.length > 2,
					url: url.pathname,
				})
			}
			if (url.pathname.startsWith(`/v1/subscriptions/`)) {
				const subscription = subscriptions.find((sub) =>
					url.pathname.endsWith(sub.id),
				)
				assert(subscription)
				return Response.json(subscription)
			}
			if (url.pathname === `/v1/checkout/sessions` && request.method === `GET`) {
				if (state.completeLegacyDuringList) {
					state.completeLegacyDuringList = false
					const session = [...sessions.values()][0]
					assert(session)
					session.status = `complete`
					session.subscription = `sub_just_completed`
					subscriptions.push({
						id: session.subscription,
						status: `active`,
						livemode: false,
					})
				}
				return Response.json({
					object: `list`,
					data: [...sessions.values()].reverse(),
					has_more: false,
					url: url.pathname,
				})
			}
			if (url.pathname.endsWith(`/line_items`)) {
				const session = sessions.get(url.pathname.split(`/`).at(-2) ?? ``)
				assert(session)
				return Response.json({
					object: `list`,
					data: [{ price: { id: session.priceId }, quantity: 1 }],
					has_more: false,
					url: url.pathname,
				})
			}
			if (
				url.pathname === `/v1/checkout/sessions` &&
				request.method === `POST`
			) {
				const key = request.headers.get(`idempotency-key`)
				assert(key)
				const body = new TextDecoder().decode(await request.arrayBuffer())
				const existing = keys.get(key)
				if (existing) {
					expect(body).toBe(existing.body)
					return Response.json(existing.session)
				}
				const params = new URLSearchParams(body)
				const expiresAt = Number(params.get(`expires_at`))
				if (expiresAt < Math.floor(Date.now() / 1000) + 30 * 60) {
					return Response.json(
						{
							error: {
								message: `Invalid expiry`,
								type: `invalid_request_error`,
							},
						},
						{ status: 400 },
					)
				}
				const session: Session = {
					id: `cs_${owner.userId}_${state.creates++}`,
					object: `checkout.session`,
					mode: `subscription`,
					customer: params.get(`customer`) ?? ``,
					livemode: false,
					status: `open`,
					url: `https://checkout.stripe.com/${owner.userId}/${state.creates}`,
					expires_at: expiresAt,
					metadata: {
						recoverageAttemptId:
							params.get(`metadata[recoverageAttemptId]`) ?? ``,
						recoverageUserId: String(owner.userId),
						recoveragePlan: `supporter`,
					},
					subscription: null,
					priceId: params.get(`line_items[0][price]`) ?? ``,
				}
				keys.set(key, { body, session })
				sessions.set(session.id, session)
				if (state.loseCreationResponse) {
					state.loseCreationResponse = false
					return Response.json(
						{ error: { message: `Lost response`, type: `api_error` } },
						{ status: 500, headers: { "stripe-should-retry": `false` } },
					)
				}
				return Response.json(session)
			}
			const session = sessions.get(url.pathname.split(`/`).at(-1) ?? ``)
			assert(
				session,
				`Unexpected Stripe request: ${request.method} ${url.pathname}`,
			)
			return Response.json(session)
		})
	return { sessions, customers, keys, subscriptions, state, fetchMock }
}

function attempt(owner: Account) {
	return owner.db.query.stripeCheckoutAttempts.findFirst({
		where: eq(schema.stripeCheckoutAttempts.userId, owner.userId),
	})
}

afterEach(() => vi.restoreAllMocks())

test(`concurrent purchase requests share one customer and one Checkout session`, async () => {
	const owner = await account()
	const stripe = mockStripe(owner)
	const responses = await Promise.all(
		Array.from({ length: 8 }, () => post(owner)),
	)
	expect(responses.map((response) => response.status)).toEqual(
		Array(8).fill(303),
	)
	expect(
		new Set(responses.map((response) => response.headers.get(`location`))).size,
	).toBe(1)
	expect(stripe.customers.size).toBe(1)
	expect(stripe.state.creates).toBe(1)
	expect((await attempt(owner))?.stripeSessionId).toBe(
		[...stripe.sessions.keys()][0],
	)
})

test(`abandoned open Checkout resumes and an expired session permits a fresh purchase`, async () => {
	const owner = await account()
	const stripe = mockStripe(owner)
	const first = await post(owner)
	expect((await post(owner)).headers.get(`location`)).toBe(
		first.headers.get(`location`),
	)
	const session = [...stripe.sessions.values()][0]
	assert(session)
	session.status = `expired`
	session.url = null
	const retries = await Promise.all(Array.from({ length: 8 }, () => post(owner)))
	expect(retries.map((response) => response.status)).toEqual(Array(8).fill(303))
	expect(
		new Set(retries.map((response) => response.headers.get(`location`))).size,
	).toBe(1)
	expect(retries[0]?.headers.get(`location`)).not.toBe(
		first.headers.get(`location`),
	)
	expect(stripe.state.creates).toBe(2)
	expect(stripe.customers.size).toBe(1)
})

test.each([
	`active`,
	`past_due`,
	`unpaid`,
	`incomplete`,
	`trialing`,
	`paused`,
] as const)(
	`Stripe %s subscription blocks new Checkout even before its webhook arrives`,
	async (status) => {
		const owner = await account()
		const stripe = mockStripe(owner)
		stripe.subscriptions.push({ id: `sub_current`, status, livemode: false })
		expect(
			await owner.db.query.stripeSubscriptions.findMany({
				where: eq(schema.stripeSubscriptions.userId, owner.userId),
			}),
		).toEqual([])
		const response = await post(owner)
		expect(response.status).toBe(303)
		expect(response.headers.get(`location`)).toBe(`/ui/billing`)
		expect(stripe.state.creates).toBe(0)
	},
)

test(`subscription lookup includes later pages before allowing a new purchase`, async () => {
	const owner = await account()
	const stripe = mockStripe(owner)
	stripe.subscriptions.push(
		{ id: `sub_old1`, status: `canceled`, livemode: false },
		{ id: `sub_old2`, status: `incomplete_expired`, livemode: false },
		{ id: `sub_current`, status: `active`, livemode: false },
	)
	expect((await post(owner)).headers.get(`location`)).toBe(`/ui/billing`)
	expect(stripe.state.subscriptionPages).toBe(2)
	expect(stripe.state.creates).toBe(0)
})

test(`completed Checkout with payment still pending cannot start another purchase`, async () => {
	const owner = await account()
	const stripe = mockStripe(owner)
	await post(owner)
	const session = [...stripe.sessions.values()][0]
	assert(session)
	session.status = `complete`
	session.url = null
	expect((await post(owner)).headers.get(`location`)).toBe(`/ui/billing`)
	expect(stripe.state.creates).toBe(1)
})

test.each([`canceled`, `incomplete_expired`] as const)(
	`completed Checkout can be replaced after its subscription becomes %s`,
	async (status) => {
		const owner = await account()
		const stripe = mockStripe(owner)
		await post(owner)
		const session = [...stripe.sessions.values()][0]
		assert(session)
		session.status = `complete`
		session.subscription = `sub_ended`
		stripe.subscriptions.push({ id: `sub_ended`, status, livemode: false })
		expect((await post(owner)).status).toBe(303)
		expect(stripe.state.creates).toBe(2)
	},
)

test(`a lost creation response is recovered without a second session`, async () => {
	const owner = await account()
	const stripe = mockStripe(owner)
	stripe.state.loseCreationResponse = true
	expect((await post(owner)).status).toBe(503)
	expect((await attempt(owner))?.stripeSessionId).toBeNull()
	expect((await post(owner)).status).toBe(303)
	expect(stripe.state.creates).toBe(1)
})

test(`Stripe lookup failures preserve the attempt and fail closed without leaking errors`, async () => {
	const owner = await account()
	const stripe = mockStripe(owner)
	stripe.state.failList = true
	const response = await post(owner)
	expect(response.status).toBe(503)
	expect(await response.text()).not.toContain(`Private customer`)
	const firstAttempt = await attempt(owner)
	stripe.state.failList = false
	expect((await post(owner)).status).toBe(303)
	expect((await attempt(owner))?.attemptId).toBe(firstAttempt?.attemptId)
	expect(stripe.state.creates).toBe(1)
})

test(`an unused attempt near expiry fails safely and can recover after expiry`, async () => {
	const owner = await account()
	const stripe = mockStripe(owner)
	await owner.db.insert(schema.stripeCheckoutAttempts).values({
		userId: owner.userId,
		attemptId: `delayed`,
		origin,
		priceId,
		expiresAt: Math.floor(Date.now() / 1000) + 10 * 60,
	})
	const waiting = await post(owner)
	expect(waiting.status).toBe(503)
	expect(Number(waiting.headers.get(`retry-after`))).toBeLessThanOrEqual(10 * 60)
	expect(await waiting.text()).toContain(`10 minutes`)
	expect(stripe.state.creates).toBe(0)
	await owner.db
		.update(schema.stripeCheckoutAttempts)
		.set({ expiresAt: Math.floor(Date.now() / 1000) - 1 })
		.where(eq(schema.stripeCheckoutAttempts.userId, owner.userId))
	expect((await post(owner)).status).toBe(303)
	expect((await attempt(owner))?.attemptId).not.toBe(`delayed`)
	expect(stripe.state.creates).toBe(1)
})

test(`an open session with an old price or another account's metadata is never offered`, async () => {
	const owner = await account()
	const stripe = mockStripe(owner)
	await post(owner)
	const session = [...stripe.sessions.values()][0]
	assert(session)
	session.priceId = `price_retired`
	expect((await post(owner)).status).toBe(503)
	session.priceId = priceId
	session.metadata[`recoverageUserId`] = `another-account`
	expect((await post(owner)).status).toBe(503)
	expect(stripe.state.creates).toBe(1)
})

test(`attempts older than Stripe idempotency retention cannot create another paid subscription`, async () => {
	const owner = await account()
	const stripe = mockStripe(owner)
	stripe.state.loseCreationResponse = true
	expect((await post(owner)).status).toBe(503)
	const session = [...stripe.sessions.values()][0]
	assert(session)
	session.status = `complete`
	session.url = null
	stripe.keys.clear()
	await owner.db
		.update(schema.stripeCheckoutAttempts)
		.set({ expiresAt: Math.floor(Date.now() / 1000) - 25 * 60 * 60 })
		.where(eq(schema.stripeCheckoutAttempts.userId, owner.userId))
	expect((await post(owner)).headers.get(`location`)).toBe(`/ui/billing`)
	expect(stripe.state.creates).toBe(1)
})

test(`checkout requires authentication, a same-origin POST and enabled billing`, async () => {
	const owner = await account()
	const stripe = mockStripe(owner)
	expect((await post(owner, {}, { Cookie: `` })).status).toBe(401)
	expect(
		(await post(owner, {}, { Origin: `https://other.example` })).status,
	).toBe(403)
	expect((await post(owner, { CHECKOUT_ENABLED: `false` })).status).toBe(503)
	expect(stripe.state.creates).toBe(0)
	expect(stripe.customers.size).toBe(0)
})

test(`checkout rate limiting uses verified account identity and runs before Stripe`, async () => {
	const owner = await account()
	const stripe = mockStripe(owner)
	const limit = vi.fn(() => Promise.resolve({ success: false }))
	const bindings = { CHECKOUT_LIMITER: { limit } }
	expect((await post(owner, bindings, { Cookie: `` })).status).toBe(401)
	expect(limit).not.toHaveBeenCalled()
	const response = await post(owner, bindings)
	expect(response.status).toBe(429)
	expect(response.headers.get(`retry-after`)).toBe(`60`)
	expect(limit).toHaveBeenCalledExactlyOnceWith({
		key: `${env.REPORT_RATE_SCOPE}:checkout:${owner.userId}`,
	})
	expect(
		stripe.fetchMock.mock.calls.every(([input]) =>
			new Request(input).url.startsWith(`https://api.github.com/`),
		),
	).toBe(true)
})

test(`legacy Checkout completing during lookup cannot open a second subscription`, async () => {
	const owner = await account()
	const stripe = mockStripe(owner)
	await post(owner)
	const session = [...stripe.sessions.values()][0]
	assert(session)
	session.metadata = {
		recoveragePlan: `supporter`,
		recoverageUserId: String(owner.userId),
	}
	await owner.db
		.delete(schema.stripeCheckoutAttempts)
		.where(eq(schema.stripeCheckoutAttempts.userId, owner.userId))
	stripe.state.completeLegacyDuringList = true
	expect((await post(owner)).headers.get(`location`)).toBe(`/ui/billing`)
	expect(stripe.state.creates).toBe(1)
})

test(`an adopted legacy session cannot rotate its reservation before the fixed deadline`, async () => {
	const owner = await account()
	const stripe = mockStripe(owner)
	await post(owner)
	const session = [...stripe.sessions.values()][0]
	assert(session)
	session.metadata = {
		recoveragePlan: `supporter`,
		recoverageUserId: String(owner.userId),
	}
	session.status = `expired`
	const reserved = await post(owner)
	expect(reserved.status).toBe(503)
	expect(Number(reserved.headers.get(`retry-after`))).toBeGreaterThan(30 * 60)
	expect(stripe.state.creates).toBe(1)
	await owner.db
		.update(schema.stripeCheckoutAttempts)
		.set({ expiresAt: Math.floor(Date.now() / 1000) - 1 })
		.where(eq(schema.stripeCheckoutAttempts.userId, owner.userId))
	expect((await post(owner)).status).toBe(303)
	expect(stripe.state.creates).toBe(2)
})
