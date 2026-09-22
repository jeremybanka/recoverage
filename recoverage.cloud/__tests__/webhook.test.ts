import { eq } from "drizzle-orm"

import * as schema from "../src/schema"
import { sqlTimestampFromUnixSeconds } from "../src/temporal"
import {
	accept,
	account,
	deliver,
	event,
	invoice,
	mockSubscriptionLookup,
	now,
	periodEnd,
	recordedEvent,
	renewalEnd,
	role,
	storedSubscription,
	subscription,
	supporterPriceId,
} from "./billing-webhook-fixture"

afterEach(() => {
	vi.restoreAllMocks()
})

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

test.each([
	[`invoice.payment_failed`, `past_due`],
	[`invoice.payment_action_required`, `active`],
] as const)(
	`%s removes unpaid renewal entitlement and recovers only from current paid state`,
	async (eventType, status) => {
		const owner = await account()
		await accept(
			event(
				`${owner.userId}_created`,
				`customer.subscription.created`,
				subscription(owner),
			),
		)
		const renewalInvoiceId = `${owner.invoiceId}_renewal`
		const unpaid = subscription(owner, {
			status,
			end: renewalEnd,
			invoiceId: renewalInvoiceId,
			paidAt: null,
		})
		const failure = event(
			`${owner.userId}_payment_failed`,
			eventType,
			invoice(owner, renewalInvoiceId, null),
			periodEnd,
		)
		await accept(failure, unpaid)
		expect(await storedSubscription(owner)).toMatchObject({
			status,
			latestInvoiceId: renewalInvoiceId,
			latestInvoicePaidAt: null,
		})
		expect(await role(owner, periodEnd + 1)).toBe(`free`)

		const paid = subscription(owner, {
			end: renewalEnd,
			invoiceId: renewalInvoiceId,
			paidAt: periodEnd + 2,
		})
		await accept(
			event(
				`${owner.userId}_recovered`,
				`invoice.paid`,
				invoice(owner, renewalInvoiceId, periodEnd + 2),
			),
			paid,
		)
		expect(await role(owner, periodEnd + 3)).toBe(`supporter`)

		// A different old failure notification can arrive after payment succeeds.
		await accept({ ...failure, id: `${failure.id}_late` }, paid)
		expect(await role(owner, periodEnd + 3)).toBe(`supporter`)
		expect(await storedSubscription(owner)).toMatchObject({
			status: `active`,
			latestInvoicePaidAt: sqlTimestampFromUnixSeconds(periodEnd + 2),
		})
	},
)

test(`an initial payment requiring authentication stays Free until payment completes`, async () => {
	const owner = await account()
	const incomplete = subscription(owner, { status: `incomplete`, paidAt: null })
	await accept(
		event(
			`${owner.userId}_pending`,
			`invoice.payment_action_required`,
			invoice(owner, owner.invoiceId, null),
		),
		incomplete,
	)
	expect(await role(owner)).toBe(`free`)
	await accept(
		event(`${owner.userId}_confirmed`, `invoice.paid`, invoice(owner)),
		subscription(owner),
	)
	expect(await role(owner)).toBe(`supporter`)
})

test(`a failed payment notification remains retryable when its current subscription cannot be fetched`, async () => {
	const owner = await account()
	await accept(
		event(
			`${owner.userId}_created`,
			`customer.subscription.created`,
			subscription(owner),
		),
	)
	const before = await storedSubscription(owner)
	const failed = event(
		`${owner.userId}_failed`,
		`invoice.payment_failed`,
		invoice(owner, `${owner.invoiceId}_renewal`, null),
	)
	vi.spyOn(globalThis, `fetch`).mockResolvedValue(
		Response.json(
			{
				error: {
					type: `authentication_error`,
					message: `sensitive-provider-detail`,
				},
			},
			{ status: 401 },
		),
	)
	expect((await deliver(failed, { apiKey: `sk_test_placeholder` })).status).toBe(
		500,
	)
	expect(await storedSubscription(owner)).toEqual(before)
	expect(await recordedEvent(owner, failed.id)).toMatchObject({
		processedAt: null,
		processingError: `Stripe authentication failed; verify the API key.`,
	})

	await accept(
		failed,
		subscription(owner, {
			status: `past_due`,
			end: renewalEnd,
			invoiceId: `${owner.invoiceId}_renewal`,
			paidAt: null,
		}),
	)
	expect(await role(owner, periodEnd + 1)).toBe(`free`)
	const recorded = await recordedEvent(owner, failed.id)
	expect(recorded?.processedAt).toBeTruthy()
	expect(recorded?.processingError).toBeNull()
})

test.each([`classic`, `flexible`] as const)(
	`a %s scheduled cancellation can be reversed before renewal`,
	async (billingMode) => {
		const owner = await account()
		const scheduled = subscription(
			owner,
			billingMode === `classic`
				? { cancelAtPeriodEnd: true }
				: { cancelAt: periodEnd },
		)
		await accept(
			event(
				`${owner.userId}_scheduled`,
				`customer.subscription.updated`,
				scheduled,
			),
		)
		expect(await storedSubscription(owner)).toMatchObject({
			cancelAtPeriodEnd: true,
		})
		expect(await role(owner, periodEnd - 1)).toBe(`supporter`)
		expect(await role(owner, periodEnd)).toBe(`free`)

		const renewed = subscription(owner, {
			end: renewalEnd,
			invoiceId: `${owner.invoiceId}_renewal`,
			paidAt: periodEnd,
		})
		await accept(
			event(
				`${owner.userId}_undo`,
				`customer.subscription.updated`,
				subscription(owner),
			),
		)
		expect(await storedSubscription(owner)).toMatchObject({
			cancelAtPeriodEnd: false,
		})
		await accept(
			event(
				`${owner.userId}_renewed`,
				`invoice.paid`,
				invoice(owner, `${owner.invoiceId}_renewal`, periodEnd),
			),
			renewed,
		)
		await accept(
			event(
				`${owner.userId}_late_scheduled`,
				`customer.subscription.updated`,
				scheduled,
			),
			renewed,
		)
		expect(await storedSubscription(owner)).toMatchObject({
			cancelAtPeriodEnd: false,
		})
		expect(await role(owner, periodEnd + 1)).toBe(`supporter`)
	},
)

test.each([
	`invoice.payment_failed`,
	`invoice.payment_action_required`,
] as const)(
	`%s for a standalone invoice does not fetch or create a subscription`,
	async (eventType) => {
		const owner = await account()
		const lookup = vi.spyOn(globalThis, `fetch`)
		const notification = event(`${owner.userId}_standalone`, eventType, {
			...invoice(owner),
			parent: null,
		})
		expect(
			(await deliver(notification, { apiKey: `sk_test_placeholder` })).status,
		).toBe(200)
		expect(lookup).not.toHaveBeenCalled()
		expect(await storedSubscription(owner)).toBeUndefined()
	},
)
