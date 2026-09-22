import { Temporal } from "@js-temporal/polyfill"
import { env } from "cloudflare:test"
import { Hono } from "hono"
import { setSignedCookie } from "hono/cookie"
import type Stripe from "stripe"

import app from "../src"
import {
	type BillingAccount,
	BillingAccountPage,
	BillingReturnNotice,
} from "../src/billing-account"
import { createDatabase } from "../src/db"
import type { Bindings } from "../src/env"
import { verifyPortalConfiguration } from "../src/portal-config"
import * as schema from "../src/schema"
import { sqlTimestampFromInstant } from "../src/temporal"

const config = {
	STRIPE_MODE: `test` as const,
	STRIPE_SECRET_KEY: `sk_test_placeholder`,
	STRIPE_PORTAL_CONFIGURATION_ID: `bpc_test`,
	STRIPE_SUPPORTER_PRICE_ID: `price_supporter`,
	CHECKOUT_ENABLED: `false`,
}
const validConfiguration = {
	id: `bpc_test`,
	active: true,
	livemode: false,
	features: {
		invoice_history: { enabled: true },
		payment_method_update: { enabled: true },
		subscription_cancel: {
			enabled: true,
			mode: `at_period_end`,
			proration_behavior: `none`,
		},
		subscription_update: { enabled: false },
	},
} as Stripe.BillingPortal.Configuration
let nextId = 980_000

afterEach(() => {
	vi.restoreAllMocks()
})

function account(overrides: Partial<BillingAccount> = {}): BillingAccount {
	return {
		role: `free`,
		manualRoleOverride: null,
		hasCustomer: false,
		subscriptions: [],
		...overrides,
	}
}
function subscription(
	overrides: Partial<typeof schema.stripeSubscriptions.$inferSelect> = {},
): typeof schema.stripeSubscriptions.$inferSelect {
	return {
		stripeSubscriptionId: `sub_test`,
		stripeCustomerId: `cus_test`,
		userId: nextId,
		priceId: `price_supporter`,
		status: `active`,
		currentPeriodEnd: sqlTimestampFromInstant(
			Temporal.Now.instant().add({ hours: 24 }),
		),
		latestInvoiceId: `in_test`,
		latestInvoicePaidAt: sqlTimestampFromInstant(Temporal.Now.instant()),
		cancelAtPeriodEnd: false,
		updatedAt: sqlTimestampFromInstant(Temporal.Now.instant()),
		...overrides,
	}
}

async function authenticatedAccount(hasCustomer = true) {
	const userId = nextId++
	const customerId = `cus_${userId}`
	const db = createDatabase(env.DB)
	await db.insert(schema.users).values({ id: userId })
	if (hasCustomer)
		await db
			.insert(schema.stripeCustomers)
			.values({ userId, stripeCustomerId: customerId })
	const signer = new Hono().get(`/`, async (c) => {
		await setSignedCookie(
			c,
			`github-access-token`,
			`token_${userId}`,
			env.COOKIE_SECRET,
		)
		return c.text(`ok`)
	})
	const signed = await signer.request(`/`)
	const cookie = signed.headers.get(`Set-Cookie`)
	assert(cookie)
	const requests: Request[] = []
	vi.spyOn(globalThis, `fetch`).mockImplementation(async (input, init) => {
		await Promise.resolve()
		const request = new Request(input, init)
		requests.push(request)
		const url = new URL(request.url)
		if (url.hostname === `api.github.com`)
			return Response.json({ id: userId, login: `billing-user` })
		if (url.pathname === `/v1/customers/${customerId}`)
			return Response.json({ id: customerId, livemode: false })
		if (url.pathname === `/v1/billing_portal/configurations/bpc_test`)
			return Response.json(validConfiguration)
		if (url.pathname === `/v1/billing_portal/sessions`)
			return Response.json({ url: `https://billing.stripe.com/p/session_test` })
		throw new Error(`Unexpected request`)
	})
	return { db, userId, customerId, cookie, requests }
}

function openPortal(
	cookie?: string,
	bindings: Partial<Bindings> = {},
	headers: Record<string, string> = {},
	body?: string,
) {
	return app.request(
		`https://recoverage.cloud/billing/portal`,
		{
			method: `POST`,
			headers: {
				Origin: `https://recoverage.cloud`,
				...(cookie ? { Cookie: cookie } : {}),
				...headers,
			},
			...(body ? { body } : {}),
		},
		{ ...env, ...config, ...bindings },
	)
}

test(`portal requires authentication and refuses cross-origin or missing-origin POSTs`, async () => {
	expect((await openPortal()).status).toBe(401)
	const owner = await authenticatedAccount()
	for (const headers of [
		{ Origin: `https://other.example` },
		{ Origin: `null` },
		{ Origin: `` },
		{ "Sec-Fetch-Site": `cross-site` },
		{ "Sec-Fetch-Site": `same-site` },
	]) {
		expect((await openPortal(owner.cookie, {}, headers)).status).toBe(403)
	}
	expect(owner.requests).toHaveLength(0)
})

test(`portal opens only the authenticated customer with a server-built return URL while checkout is paused`, async () => {
	const owner = await authenticatedAccount()
	const other = nextId++
	await owner.db.insert(schema.users).values({ id: other })
	await owner.db
		.insert(schema.stripeCustomers)
		.values({ userId: other, stripeCustomerId: `cus_${other}` })
	const response = await openPortal(
		owner.cookie,
		{},
		{ "Content-Type": `application/x-www-form-urlencoded` },
		`customer=cus_${other}&return_url=https://other.example`,
	)
	expect(response.status).toBe(303)
	expect(response.headers.get(`Location`)).toBe(
		`https://billing.stripe.com/p/session_test`,
	)
	expect(response.headers.get(`Cache-Control`)).toBe(`no-store`)
	const request = owner.requests.find(
		(item) => new URL(item.url).pathname === `/v1/billing_portal/sessions`,
	)
	assert(request)
	const params = new URLSearchParams(
		new TextDecoder().decode(await request.arrayBuffer()),
	)
	expect(params.get(`customer`)).toBe(owner.customerId)
	expect(params.get(`configuration`)).toBe(`bpc_test`)
	expect(params.get(`return_url`)).toBe(`https://recoverage.cloud/ui/billing`)
})

test(`portal never creates a customer and fails safely for missing customer or inconsistent configuration`, async () => {
	const owner = await authenticatedAccount(false)
	expect((await openPortal(owner.cookie)).status).toBe(409)
	for (const bindings of [
		{ STRIPE_PORTAL_CONFIGURATION_ID: undefined },
		{ STRIPE_SECRET_KEY: `sk_live_placeholder` },
		{ STRIPE_MODE: undefined },
	]) {
		const response = await openPortal(owner.cookie, bindings)
		expect(response.status).toBe(503)
		expect(await response.text()).not.toContain(`STRIPE_`)
	}
	expect(owner.requests.every((request) => request.method === `GET`)).toBe(true)
})

test(`portal failures do not expose Stripe errors or temporary URLs`, async () => {
	const owner = await authenticatedAccount()
	vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
		await Promise.resolve()
		if (new URL(new Request(input).url).hostname === `api.github.com`)
			return Response.json({ id: owner.userId, login: `billing-user` })
		return Response.json(
			{
				error: {
					type: `invalid_request_error`,
					message: `private cus_123 sk_test_secret https://billing.stripe.com/private`,
				},
			},
			{ status: 400 },
		)
	})
	const response = await openPortal(owner.cookie)
	expect(response.status).toBe(503)
	expect(await response.text()).not.toMatch(/private|cus_123|sk_test_secret/)
})

test(`portal configuration enforces self-service invoices/cards and period-end cancellation without plan changes`, () => {
	expect(() => {
		verifyPortalConfiguration(validConfiguration, `test`)
	}).not.toThrow()
	for (const override of [
		{ active: false },
		{ livemode: true },
		...[
			{ invoice_history: { enabled: false } },
			{ payment_method_update: { enabled: false } },
			{
				subscription_cancel: {
					...validConfiguration.features.subscription_cancel,
					enabled: false,
				},
			},
			{
				subscription_cancel: {
					...validConfiguration.features.subscription_cancel,
					mode: `immediately`,
				},
			},
			{
				subscription_cancel: {
					...validConfiguration.features.subscription_cancel,
					proration_behavior: `create_prorations`,
				},
			},
			{
				subscription_update: {
					...validConfiguration.features.subscription_update,
					enabled: true,
				},
			},
		].map((features) => ({
			features: { ...validConfiguration.features, ...features },
		})),
	]) {
		expect(() => {
			verifyPortalConfiguration(
				{
					...validConfiguration,
					...override,
				} as Stripe.BillingPortal.Configuration,
				`test`,
			)
		}).toThrow()
	}
})

test(`checkout return flags cannot confirm payment, including manually assigned Supporter`, async () => {
	for (const state of [
		account(),
		account({ role: `supporter`, manualRoleOverride: `supporter` }),
		account({ subscriptions: [subscription({ latestInvoicePaidAt: null })] }),
		account({ subscriptions: [subscription({ priceId: `price_other` })] }),
	]) {
		const text = String(
			await BillingReturnNotice({ state: `success`, account: state, config }),
		)
		expect(text).toContain(`not confirmed`)
		expect(text).not.toContain(`has a confirmed paid`)
	}
	const paid = account({ role: `supporter`, subscriptions: [subscription()] })
	expect(
		String(
			await BillingReturnNotice({ state: `success`, account: paid, config }),
		),
	).toContain(`has a confirmed paid`)
	expect(
		String(
			await BillingReturnNotice({ state: `cancel`, account: paid, config }),
		),
	).toContain(`does not change your plan`)
})

test(`pending Checkout return offers refresh instead of another purchase`, async () => {
	const html = String(
		await BillingAccountPage({
			account: account({ hasCustomer: true }),
			config: {
				...config,
				CHECKOUT_ENABLED: `true`,
				STRIPE_WEBHOOK_SECRET: `whsec_test`,
				BILLING_SUPPORT_EMAIL: `billing@example.test`,
				BILLING_REFUND_POLICY: `Contact support.`,
			},
			returnState: `success`,
		}),
	)
	expect(html).toContain(`Refresh status`)
	expect(html).toContain(`Do not purchase again`)
	expect(html).not.toContain(`Upgrade to Supporter`)
	expect(html).not.toContain(`Subscribe again`)
})

test(`billing page distinguishes payment status from effective role, dates, cancellations and manual assignments`, async () => {
	const cases = [
		[subscription(), `Next renewal:`],
		[subscription({ cancelAtPeriodEnd: true }), `Cancellation scheduled.`],
		[
			subscription({ status: `past_due`, latestInvoicePaidAt: null }),
			`Payment is past due.`,
		],
		[subscription({ status: `unpaid` }), `subscription is unpaid.`],
		[subscription({ status: `incomplete` }), `first payment is incomplete.`],
		[subscription({ status: `canceled` }), `subscription has ended.`],
		[subscription({ status: `incomplete_expired` }), `subscription expired.`],
		[
			subscription({ latestInvoicePaidAt: null }),
			`Payment confirmation is pending.`,
		],
	] as const
	for (const [billing, message] of cases) {
		const html = String(
			await BillingAccountPage({
				account: account({
					role: `free`,
					hasCustomer: true,
					subscriptions: [billing],
				}),
				config,
			}),
		)
		expect(html).toContain(`Current plan: Free`)
		expect(html).toContain(message)
		expect(html).toContain(`action="/billing/portal"`)
		expect(html).toContain(`retained after a downgrade`)
		expect(html).not.toContain(`action="/billing/checkout"`)
	}
	const manual = String(
		await BillingAccountPage({
			account: account({ role: `admin`, manualRoleOverride: `admin` }),
			config,
		}),
	)
	expect(manual).toContain(`Current plan: Admin`)
	expect(manual).toContain(`assigned by a maintainer`)
	expect(manual).not.toContain(`action="/billing/portal"`)
})

test(`authenticated billing page loads only its owner's facts and keeps existing subscriptions out of upgrade checkout`, async () => {
	const owner = await authenticatedAccount()
	await owner.db.insert(schema.stripeSubscriptions).values(
		subscription({
			userId: owner.userId,
			stripeCustomerId: owner.customerId,
			status: `past_due`,
			latestInvoicePaidAt: null,
		}),
	)
	const other = nextId++
	await owner.db.insert(schema.users).values({ id: other })
	await owner.db
		.insert(schema.stripeCustomers)
		.values({ userId: other, stripeCustomerId: `cus_${other}` })
	await owner.db.insert(schema.stripeSubscriptions).values(
		subscription({
			userId: other,
			stripeCustomerId: `cus_${other}`,
			stripeSubscriptionId: `sub_other`,
		}),
	)
	const response = await app.request(
		`/ui/billing?billing=success`,
		{ headers: { Cookie: owner.cookie } },
		{ ...env, ...config },
	)
	expect(response.status).toBe(200)
	const html = await response.text()
	expect(html).toContain(`Current plan: Free`)
	expect(html).toContain(`Payment is past due`)
	expect(html).toContain(`not confirmed`)
	expect(html).not.toContain(`Next renewal`)
	const upgrade = await app.request(
		`/ui/upgrade`,
		{ headers: { Cookie: owner.cookie } },
		{
			...env,
			...config,
			CHECKOUT_ENABLED: `true`,
			STRIPE_WEBHOOK_SECRET: `whsec_test`,
			BILLING_SUPPORT_EMAIL: `billing@example.test`,
			BILLING_REFUND_POLICY: `Contact us.`,
		},
	)
	expect(await upgrade.text()).toContain(`Manage your existing subscription`)
})
