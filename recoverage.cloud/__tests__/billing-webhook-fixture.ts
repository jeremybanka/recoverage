import { Temporal } from "@js-temporal/polyfill"
import { env } from "cloudflare:test"
import { eq } from "drizzle-orm"
import type { MockInstance } from "vitest"

import app from "../src"
import { getUserRole } from "../src/billing"
import { createDatabase } from "../src/db"
import type { Bindings } from "../src/env"
import * as schema from "../src/schema"
import { createStripeClient } from "../src/stripe"

const webhookSecret = `whsec_test_webhook_secret`
export const supporterPriceId = `price_supporter`
export const now = 1_778_507_200
export const periodEnd = now + 30 * 24 * 60 * 60
export const renewalEnd = periodEnd + 30 * 24 * 60 * 60
let nextUserId = 910_000

type Account = {
	db: ReturnType<typeof createDatabase>
	userId: number
	customerId: string
	subscriptionId: string
	invoiceId: string
}

export async function account(): Promise<Account> {
	const db = createDatabase(env.DB)
	const userId = nextUserId++
	const customerId = `cus_${userId}`
	const subscriptionId = `sub_${userId}`
	const invoiceId = `in_${userId}`
	await db.insert(schema.users).values({ id: userId })
	await db.insert(schema.stripeCustomers).values({
		stripeCustomerId: customerId,
		userId,
	})
	return { db, userId, customerId, subscriptionId, invoiceId }
}

type InvoiceFixture = {
	object: string
	id: string
	parent: { subscription_details: { subscription: string } }
	status_transitions: { paid_at: number | null }
}

type SubscriptionFixture = {
	object: string
	livemode: boolean
	id: string
	customer: string
	metadata: { recoverageUserId: string }
	status: schema.StripeSubscriptionStatus
	cancel_at_period_end: boolean
	cancel_at: number | null
	items: { data: { current_period_end: number; price: { id: string } }[] }
	latest_invoice: Pick<InvoiceFixture, `id` | `status_transitions`> | string
}

type EventFixture = {
	id: string
	object: string
	api_version: string
	created: number
	livemode: boolean
	type: string
	data: { object: object }
}

export function subscription(
	owner: Account,
	options: {
		status?: schema.StripeSubscriptionStatus
		end?: number
		invoiceId?: string
		paidAt?: number | null
		expandInvoice?: boolean
		cancelAtPeriodEnd?: boolean
		cancelAt?: number | null
	} = {},
): SubscriptionFixture {
	const invoiceId = options.invoiceId ?? owner.invoiceId
	return {
		object: `subscription`,
		livemode: false,
		id: owner.subscriptionId,
		customer: owner.customerId,
		metadata: { recoverageUserId: String(owner.userId) },
		status: options.status ?? `active`,
		cancel_at_period_end: options.cancelAtPeriodEnd ?? false,
		cancel_at: options.cancelAt ?? null,
		items: {
			data: [
				{
					current_period_end: options.end ?? periodEnd,
					price: { id: supporterPriceId },
				},
			],
		},
		latest_invoice:
			options.expandInvoice === false
				? invoiceId
				: {
						id: invoiceId,
						status_transitions: {
							paid_at: options.paidAt === undefined ? now : options.paidAt,
						},
					},
	}
}

export function invoice(
	owner: Account,
	invoiceId = owner.invoiceId,
	paidAt: number | null = now,
): InvoiceFixture {
	return {
		object: `invoice`,
		id: invoiceId,
		parent: {
			subscription_details: { subscription: owner.subscriptionId },
		},
		status_transitions: { paid_at: paidAt },
	}
}

export function event(
	id: string,
	type: string,
	object: object,
	created = now,
): EventFixture {
	return {
		id: `evt_${id}`,
		object: `event`,
		api_version: `2026-04-22.dahlia`,
		created,
		livemode: false,
		type,
		data: { object },
	}
}

export async function deliver(
	stripeEvent: ReturnType<typeof event>,
	options: {
		apiKey?: string
		signingSecret?: string
		bindings?: Partial<Bindings>
	} = {},
): Promise<Response> {
	const payload = JSON.stringify(stripeEvent)
	const stripe = createStripeClient(`sk_test_placeholder`)
	const signature = await stripe.webhooks.generateTestHeaderStringAsync({
		payload,
		secret: options.signingSecret ?? webhookSecret,
	})
	return app.request(
		`/billing/webhook`,
		{
			method: `POST`,
			headers: {
				"content-type": `application/json`,
				"stripe-signature": signature,
			},
			body: payload,
		},
		{
			...env,
			STRIPE_SECRET_KEY: options.apiKey,
			STRIPE_SUPPORTER_PRICE_ID: supporterPriceId,
			STRIPE_WEBHOOK_SECRET: webhookSecret,
			...options.bindings,
		},
	)
}

export async function accept(
	stripeEvent: ReturnType<typeof event>,
	currentSubscription = stripeEvent.data.object as ReturnType<
		typeof subscription
	>,
): Promise<void> {
	// Normal subscription notifications mirror current Stripe state. Delayed
	// notifications and invoice events supply the current snapshot separately.
	mockSubscriptionLookup(currentSubscription)
	const response = await deliver(stripeEvent, { apiKey: `sk_test_placeholder` })
	expect(response.status).toBe(200)
	await expect(response.json()).resolves.toEqual({ received: true })
}

export function role(owner: Account, at = now): ReturnType<typeof getUserRole> {
	return getUserRole({
		db: owner.db,
		userId: owner.userId,
		now: Temporal.Instant.fromEpochMilliseconds(at * 1000),
		stripeSupporterPriceId: supporterPriceId,
	})
}

export async function storedSubscription(
	owner: Account,
): Promise<typeof schema.stripeSubscriptions.$inferSelect | undefined> {
	return owner.db.query.stripeSubscriptions.findFirst({
		where: eq(
			schema.stripeSubscriptions.stripeSubscriptionId,
			owner.subscriptionId,
		),
	})
}

export async function recordedEvent(
	owner: Account,
	eventId: string,
): Promise<typeof schema.stripeWebhookEvents.$inferSelect | undefined> {
	return owner.db.query.stripeWebhookEvents.findFirst({
		where: eq(schema.stripeWebhookEvents.stripeEventId, eventId),
	})
}

export function mockSubscriptionLookup(
	snapshot: ReturnType<typeof subscription>,
): MockInstance<typeof fetch> {
	return vi.spyOn(globalThis, `fetch`).mockImplementation((input, init) => {
		const request = new Request(input, init)
		const url = new URL(request.url)
		expect(request.method).toBe(`GET`)
		expect(url.origin).toBe(`https://api.stripe.com`)
		expect(url.pathname).toBe(`/v1/subscriptions/${snapshot.id}`)
		expect([...url.searchParams.values()]).toContain(`latest_invoice`)
		return Promise.resolve(Response.json(snapshot))
	})
}
