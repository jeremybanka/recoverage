import { Temporal } from "@js-temporal/polyfill"
import { env } from "cloudflare:test"
import { eq } from "drizzle-orm"

import app from "../src"
import { getUserRole } from "../src/billing"
import { createDatabase } from "../src/db"
import type { Bindings } from "../src/env"
import * as schema from "../src/schema"
import { createStripeClient } from "../src/stripe"
import { sqlTimestampFromUnixSeconds } from "../src/temporal"

const webhookSecret = `whsec_test_webhook_secret`
const supporterPriceId = `price_supporter`
const now = 1_778_507_200
const periodEnd = now + 30 * 24 * 60 * 60
const renewalEnd = periodEnd + 30 * 24 * 60 * 60
let nextUserId = 910_000

afterEach(() => {
	vi.restoreAllMocks()
})

async function account() {
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

type Account = Awaited<ReturnType<typeof account>>

function subscription(
	owner: Account,
	options: {
		status?: schema.StripeSubscriptionStatus
		end?: number
		invoiceId?: string
		paidAt?: number | null
		expandInvoice?: boolean
		cancelAtPeriodEnd?: boolean
	} = {},
) {
	const invoiceId = options.invoiceId ?? owner.invoiceId
	return {
		object: `subscription`,
		livemode: false,
		id: owner.subscriptionId,
		customer: owner.customerId,
		metadata: { recoverageUserId: String(owner.userId) },
		status: options.status ?? `active`,
		cancel_at_period_end: options.cancelAtPeriodEnd ?? false,
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

function invoice(owner: Account, invoiceId = owner.invoiceId, paidAt = now) {
	return {
		object: `invoice`,
		id: invoiceId,
		parent: {
			subscription_details: { subscription: owner.subscriptionId },
		},
		status_transitions: { paid_at: paidAt },
	}
}

function event(id: string, type: string, object: object, created = now) {
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

async function deliver(
	stripeEvent: ReturnType<typeof event>,
	options: {
		apiKey?: string
		signingSecret?: string
		bindings?: Partial<Bindings>
	} = {},
) {
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

async function accept(
	stripeEvent: ReturnType<typeof event>,
	currentSubscription = stripeEvent.data.object as ReturnType<
		typeof subscription
	>,
) {
	// Normal subscription notifications mirror current Stripe state. Delayed
	// notifications and invoice events supply the current snapshot separately.
	mockSubscriptionLookup(currentSubscription)
	const response = await deliver(stripeEvent, { apiKey: `sk_test_placeholder` })
	expect(response.status).toBe(200)
	await expect(response.json()).resolves.toEqual({ received: true })
}

function role(owner: Account, at = now) {
	return getUserRole({
		db: owner.db,
		userId: owner.userId,
		now: Temporal.Instant.fromEpochMilliseconds(at * 1000),
		stripeSupporterPriceId: supporterPriceId,
	})
}

function storedSubscription(owner: Account) {
	return owner.db.query.stripeSubscriptions.findFirst({
		where: eq(
			schema.stripeSubscriptions.stripeSubscriptionId,
			owner.subscriptionId,
		),
	})
}

function recordedEvent(owner: Account, eventId: string) {
	return owner.db.query.stripeWebhookEvents.findFirst({
		where: eq(schema.stripeWebhookEvents.stripeEventId, eventId),
	})
}

function mockSubscriptionLookup(snapshot: ReturnType<typeof subscription>) {
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

test(`signed Stripe subscription webhooks sync billing state`, async () => {
	const owner = await account()
	const created = event(
		owner.userId.toString(),
		`customer.subscription.created`,
		subscription(owner),
	)
	await accept(created)

	expect(await storedSubscription(owner)).toMatchObject({
		cancelAtPeriodEnd: false,
		latestInvoiceId: owner.invoiceId,
		latestInvoicePaidAt: sqlTimestampFromUnixSeconds(now),
		currentPeriodEnd: sqlTimestampFromUnixSeconds(periodEnd),
		priceId: supporterPriceId,
		status: `active`,
		stripeCustomerId: owner.customerId,
		userId: owner.userId,
	})
	expect(await role(owner)).toBe(`supporter`)
	const recorded = await recordedEvent(owner, created.id)
	expect(recorded?.processedAt).toBeTruthy()
	expect(recorded?.processingError).toBeNull()
})

test.each([`subscription-first`, `invoice-first`] as const)(
	`renewal keeps the next paid period available with %s delivery`,
	async (order) => {
		const owner = await account()
		await accept(
			event(
				`${owner.userId}_initial`,
				`customer.subscription.created`,
				subscription(owner),
			),
		)
		const renewedInvoiceId = `${owner.invoiceId}_renewal`
		const updated = event(
			`${owner.userId}_renewed`,
			`customer.subscription.updated`,
			subscription(owner, {
				end: renewalEnd,
				invoiceId: renewedInvoiceId,
				expandInvoice: false,
			}),
			periodEnd,
		)
		const paid = event(
			`${owner.userId}_paid`,
			`invoice.paid`,
			invoice(owner, renewedInvoiceId, periodEnd),
			periodEnd,
		)
		for (const delivery of order === `subscription-first`
			? [updated, paid]
			: [paid, updated]) {
			await accept(
				delivery,
				subscription(owner, {
					end: renewalEnd,
					invoiceId: renewedInvoiceId,
					paidAt: periodEnd,
				}),
			)
		}
		expect(await storedSubscription(owner)).toMatchObject({
			currentPeriodEnd: sqlTimestampFromUnixSeconds(renewalEnd),
			latestInvoiceId: renewedInvoiceId,
			latestInvoicePaidAt: sqlTimestampFromUnixSeconds(periodEnd),
		})
		expect(await role(owner, periodEnd + 1)).toBe(`supporter`)
		expect(await role(owner, renewalEnd)).toBe(`free`)
	},
)

test(`scheduled cancellation retains access until the paid period ends`, async () => {
	const owner = await account()
	await accept(
		event(
			`${owner.userId}_created`,
			`customer.subscription.created`,
			subscription(owner),
		),
	)
	await accept(
		event(
			`${owner.userId}_scheduled`,
			`customer.subscription.updated`,
			subscription(owner, { cancelAtPeriodEnd: true }),
		),
	)
	expect(await storedSubscription(owner)).toMatchObject({
		cancelAtPeriodEnd: true,
	})
	expect(await role(owner, periodEnd - 1)).toBe(`supporter`)
	expect(await role(owner, periodEnd)).toBe(`free`)
})

test(`effective cancellation downgrades billing entitlement but preserves manual overrides`, async () => {
	const owner = await account()
	await accept(
		event(
			`${owner.userId}_created`,
			`customer.subscription.created`,
			subscription(owner),
		),
	)
	const deleted = event(
		`${owner.userId}_deleted`,
		`customer.subscription.deleted`,
		subscription(owner, { status: `canceled` }),
	)
	await accept(deleted)
	expect(await role(owner)).toBe(`free`)
	await owner.db
		.update(schema.users)
		.set({ manualRoleOverride: `admin` })
		.where(eq(schema.users.id, owner.userId))
	await accept(
		event(
			`${owner.userId}_deleted_again`,
			`customer.subscription.deleted`,
			subscription(owner, { status: `canceled` }),
		),
	)
	expect(await role(owner)).toBe(`admin`)
})

test(`redelivering a processed event cannot undo a later cancellation`, async () => {
	const owner = await account()
	const created = event(
		`${owner.userId}_created`,
		`customer.subscription.created`,
		subscription(owner),
	)
	await accept(created)
	await accept(
		event(
			`${owner.userId}_deleted`,
			`customer.subscription.deleted`,
			subscription(owner, { status: `canceled` }),
		),
	)
	const before = await storedSubscription(owner)
	const firstReceipt = await recordedEvent(owner, created.id)
	const duplicate = await deliver(created)
	expect(duplicate.status).toBe(200)
	await expect(duplicate.json()).resolves.toEqual({
		received: true,
		duplicate: true,
	})
	expect(await recordedEvent(owner, created.id)).toEqual(firstReceipt)
	expect(await storedSubscription(owner)).toEqual(before)
	expect(await role(owner)).toBe(`free`)
})

test(`an invoice arriving before its subscription is backfilled from Stripe`, async () => {
	const owner = await account()
	const lookup = mockSubscriptionLookup(subscription(owner))
	const paid = event(`${owner.userId}_paid`, `invoice.paid`, invoice(owner))
	const response = await deliver(paid, { apiKey: `sk_test_placeholder` })
	expect(response.status).toBe(200)
	expect(lookup).toHaveBeenCalledTimes(1)
	expect(await role(owner)).toBe(`supporter`)
	await accept(
		event(
			`${owner.userId}_created_later`,
			`customer.subscription.created`,
			subscription(owner, { expandInvoice: false }),
		),
		subscription(owner),
	)
	expect(await role(owner)).toBe(`supporter`)
	expect(await storedSubscription(owner)).toMatchObject({
		latestInvoicePaidAt: sqlTimestampFromUnixSeconds(now),
	})
})

test(`a failed invoice backfill can be retried with the same event ID`, async () => {
	const owner = await account()
	const paid = event(`${owner.userId}_paid`, `invoice.paid`, invoice(owner))
	const failed = await deliver(paid)
	expect(failed.status).toBe(500)
	expect(await recordedEvent(owner, paid.id)).toMatchObject({
		processedAt: null,
		processingError: `STRIPE_SECRET_KEY is required to sync Stripe subscriptions.`,
	})
	expect(await storedSubscription(owner)).toBeUndefined()

	mockSubscriptionLookup(subscription(owner))
	const retry = await deliver(paid, { apiKey: `sk_test_placeholder` })
	expect(retry.status).toBe(200)
	await expect(retry.json()).resolves.toEqual({ received: true })
	const retriedEvent = await recordedEvent(owner, paid.id)
	expect(retriedEvent?.processedAt).toBeTruthy()
	expect(retriedEvent?.processingError).toBeNull()
	expect(await role(owner)).toBe(`supporter`)
})

test(`an invalid signature cannot create billing state or event records`, async () => {
	const owner = await account()
	const created = event(
		`${owner.userId}_invalid`,
		`customer.subscription.created`,
		subscription(owner),
	)
	const response = await deliver(created, { signingSecret: `whsec_wrong` })
	expect(response.status).toBe(400)
	expect(await recordedEvent(owner, created.id)).toBeUndefined()
	expect(await storedSubscription(owner)).toBeUndefined()
	expect(await role(owner)).toBe(`free`)
})

test(`a delayed older subscription snapshot must not revive a canceled subscription`, async () => {
	const owner = await account()
	await accept(
		event(
			`${owner.userId}_created`,
			`customer.subscription.created`,
			subscription(owner),
		),
	)
	// Distinct events can share a creation second. Arrival order is not state order.
	await accept(
		event(
			`${owner.userId}_deleted`,
			`customer.subscription.deleted`,
			subscription(owner, { status: `canceled` }),
		),
	)
	await accept(
		event(
			`${owner.userId}_delayed`,
			`customer.subscription.updated`,
			subscription(owner),
		),
		subscription(owner, { status: `canceled` }),
	)
	expect(await role(owner)).toBe(`free`)
})

test(`an older paid invoice must not replace the renewal invoice`, async () => {
	const owner = await account()
	const renewedInvoiceId = `${owner.invoiceId}_renewal`
	await accept(
		event(
			`${owner.userId}_renewed`,
			`customer.subscription.updated`,
			subscription(owner, {
				end: renewalEnd,
				invoiceId: renewedInvoiceId,
				paidAt: periodEnd,
			}),
			periodEnd,
		),
	)
	await accept(
		event(`${owner.userId}_old_invoice`, `invoice.paid`, invoice(owner)),
		subscription(owner, {
			end: renewalEnd,
			invoiceId: renewedInvoiceId,
			paidAt: periodEnd,
		}),
	)
	expect(await storedSubscription(owner)).toMatchObject({
		latestInvoiceId: renewedInvoiceId,
		latestInvoicePaidAt: sqlTimestampFromUnixSeconds(periodEnd),
	})
})

test(`an unpaid renewal must not inherit the previous invoice's payment`, async () => {
	const owner = await account()
	await accept(
		event(
			`${owner.userId}_initial`,
			`customer.subscription.created`,
			subscription(owner),
		),
	)
	await accept(
		event(
			`${owner.userId}_unpaid_renewal`,
			`customer.subscription.updated`,
			subscription(owner, {
				end: renewalEnd,
				invoiceId: `${owner.invoiceId}_renewal`,
				paidAt: null,
			}),
			periodEnd,
		),
	)
	expect(await role(owner, periodEnd + 1)).toBe(`free`)
})

test(`a delayed pre-renewal snapshot cannot shorten the current paid period`, async () => {
	const owner = await account()
	const current = subscription(owner, {
		end: renewalEnd,
		invoiceId: `${owner.invoiceId}_renewal`,
		paidAt: periodEnd,
	})
	await accept(
		event(
			`${owner.userId}_renewed`,
			`customer.subscription.updated`,
			current,
			periodEnd,
		),
	)
	await accept(
		event(
			`${owner.userId}_old_snapshot`,
			`customer.subscription.updated`,
			subscription(owner),
		),
		current,
	)
	expect(await storedSubscription(owner)).toMatchObject({
		currentPeriodEnd: sqlTimestampFromUnixSeconds(renewalEnd),
		latestInvoiceId: `${owner.invoiceId}_renewal`,
		latestInvoicePaidAt: sqlTimestampFromUnixSeconds(periodEnd),
	})
	expect(await role(owner, periodEnd + 1)).toBe(`supporter`)
})

test(`late payment of an earlier invoice cannot pay an unpaid renewal`, async () => {
	const owner = await account()
	const current = subscription(owner, {
		end: renewalEnd,
		invoiceId: `${owner.invoiceId}_renewal`,
		paidAt: null,
	})
	await accept(
		event(
			`${owner.userId}_renewed`,
			`customer.subscription.updated`,
			current,
			periodEnd,
		),
	)
	await accept(
		event(
			`${owner.userId}_old_paid_late`,
			`invoice.paid`,
			invoice(owner, owner.invoiceId, periodEnd + 1),
			periodEnd + 1,
		),
		current,
	)
	expect(await storedSubscription(owner)).toMatchObject({
		latestInvoiceId: `${owner.invoiceId}_renewal`,
		latestInvoicePaidAt: null,
	})
	expect(await role(owner, periodEnd + 2)).toBe(`free`)
})

test(`a failed Stripe lookup leaves billing unchanged and retries the same event`, async () => {
	const owner = await account()
	await accept(
		event(
			`${owner.userId}_created`,
			`customer.subscription.created`,
			subscription(owner),
		),
	)
	const before = await storedSubscription(owner)
	const canceled = subscription(owner, { status: `canceled` })
	const deleted = event(
		`${owner.userId}_deleted`,
		`customer.subscription.deleted`,
		canceled,
	)
	vi.spyOn(globalThis, `fetch`).mockResolvedValue(
		Response.json(
			{
				error: { type: `authentication_error`, message: `Invalid API key` },
			},
			{ status: 401 },
		),
	)
	const failure = await deliver(deleted, { apiKey: `sk_test_placeholder` })
	expect(failure.status).toBe(500)
	expect(await storedSubscription(owner)).toEqual(before)
	expect(await recordedEvent(owner, deleted.id)).toMatchObject({
		processedAt: null,
		processingError: expect.stringContaining(`Stripe authentication failed`),
	})
	await accept(deleted, canceled)
	expect(await role(owner)).toBe(`free`)
	const retried = await recordedEvent(owner, deleted.id)
	expect(retried?.processedAt).toBeTruthy()
	expect(retried?.processingError).toBeNull()
})

test(`an unexpanded current invoice cannot silently reuse an earlier payment`, async () => {
	const owner = await account()
	await accept(
		event(
			`${owner.userId}_created`,
			`customer.subscription.created`,
			subscription(owner),
		),
	)
	const before = await storedSubscription(owner)
	const current = subscription(owner, {
		end: renewalEnd,
		invoiceId: `${owner.invoiceId}_renewal`,
		paidAt: null,
	})
	const updated = event(
		`${owner.userId}_renewed`,
		`customer.subscription.updated`,
		current,
		periodEnd,
	)
	mockSubscriptionLookup({
		...current,
		latest_invoice: `${owner.invoiceId}_renewal`,
	})
	const failure = await deliver(updated, { apiKey: `sk_test_placeholder` })
	expect(failure.status).toBe(500)
	expect(await storedSubscription(owner)).toEqual(before)
	expect(await recordedEvent(owner, updated.id)).toMatchObject({
		processedAt: null,
		processingError: expect.stringContaining(`expanded latest invoice`),
	})
	await accept(updated, current)
	expect(await role(owner, periodEnd + 1)).toBe(`free`)
})

test.each([`canceled`, `incomplete_expired`] as const)(
	`a lookup started before %s cannot restore a nonterminal state when it finishes late`,
	async (status) => {
		const owner = await account()
		const active = subscription(owner, {
			status: status === `canceled` ? `active` : `incomplete`,
			paidAt: status === `canceled` ? now : null,
		})
		await accept(
			event(`${owner.userId}_created`, `customer.subscription.created`, active),
		)
		const lookupStarted = Promise.withResolvers<void>()
		const lookupResult = Promise.withResolvers<Response>()
		vi.spyOn(globalThis, `fetch`).mockImplementationOnce(() => {
			lookupStarted.resolve()
			return lookupResult.promise
		})
		const pending = deliver(
			event(`${owner.userId}_inflight`, `customer.subscription.updated`, active),
			{ apiKey: `sk_test_placeholder` },
		)
		try {
			await lookupStarted.promise
			await accept(
				event(
					`${owner.userId}_terminal`,
					`customer.subscription.updated`,
					subscription(owner, { status }),
				),
			)
		} finally {
			lookupResult.resolve(Response.json(active))
		}
		expect((await pending).status).toBe(200)
		expect(await storedSubscription(owner)).toMatchObject({ status })
		expect(await role(owner)).toBe(`free`)
	},
)

test(`signed events from the wrong mode or API version cannot write billing facts`, async () => {
	const owner = await account()
	const notification = event(
		`wrong_mode`,
		`customer.subscription.updated`,
		subscription(owner),
	)
	const result = await deliver(notification, {
		apiKey: `sk_live_placeholder`,
		bindings: { STRIPE_MODE: `live` },
	})
	expect(result.status).toBe(400)
	expect(await recordedEvent(owner, notification.id)).toBeUndefined()
	expect(await storedSubscription(owner)).toBeUndefined()
	const wrongVersion = { ...notification, api_version: `2020-01-01` }
	expect(
		(await deliver(wrongVersion, { apiKey: `sk_test_placeholder` })).status,
	).toBe(400)
	expect(await recordedEvent(owner, notification.id)).toBeUndefined()
})

test(`rotation accepts the previous signing secret while checkout is paused`, async () => {
	const owner = await account()
	const notification = event(
		`rotating_secret`,
		`customer.subscription.updated`,
		subscription(owner),
	)
	mockSubscriptionLookup(subscription(owner))
	const result = await deliver(notification, {
		apiKey: `sk_test_placeholder`,
		signingSecret: `whsec_previous`,
		bindings: {
			STRIPE_WEBHOOK_PREVIOUS_SECRET: `whsec_previous`,
			CHECKOUT_ENABLED: `false`,
		},
	})
	expect(result.status).toBe(200)
	expect(await role(owner)).toBe(`supporter`)
})

test(`a lookup in the wrong mode cannot change a subscription`, async () => {
	const owner = await account()
	const notification = event(
		`wrong_snapshot_mode`,
		`customer.subscription.updated`,
		subscription(owner),
	)
	mockSubscriptionLookup({ ...subscription(owner), livemode: true })
	expect(
		(await deliver(notification, { apiKey: `sk_test_placeholder` })).status,
	).toBe(500)
	expect(await storedSubscription(owner)).toBeUndefined()
	expect(await recordedEvent(owner, notification.id)).toMatchObject({
		processedAt: null,
	})
})
