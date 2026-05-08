import { env } from "cloudflare:test"

import app from "../src"
import { getUserRole } from "../src/billing"
import { createDatabase } from "../src/db"
import * as schema from "../src/schema"
import { createStripeClient } from "../src/stripe"

const webhookSecret = `whsec_test_webhook_secret`
const supporterPriceId = `price_supporter`

let nextUserId = 910_000

test(`signed Stripe subscription webhooks sync billing state`, async () => {
	const db = createDatabase(env.DB)
	const userId = nextUserId++
	const stripeCustomerId = `cus_${userId}`
	const stripeSubscriptionId = `sub_${userId}`
	const invoiceId = `in_${userId}`
	const nowUnixSeconds = 1_778_507_200
	const currentPeriodEndUnixSeconds = 1_781_099_200

	await db.insert(schema.users).values({ id: userId })
	await db.insert(schema.stripeCustomers).values({ stripeCustomerId, userId })

	const payload = JSON.stringify({
		api_version: `2026-04-22.dahlia`,
		created: nowUnixSeconds,
		data: {
			object: {
				cancel_at_period_end: false,
				current_period_end: currentPeriodEndUnixSeconds,
				customer: stripeCustomerId,
				id: stripeSubscriptionId,
				items: {
					data: [
						{
							current_period_end: currentPeriodEndUnixSeconds,
							price: {
								id: supporterPriceId,
							},
						},
					],
				},
				latest_invoice: {
					id: invoiceId,
					status_transitions: {
						paid_at: nowUnixSeconds,
					},
				},
				metadata: {
					recoverageUserId: String(userId),
				},
				object: `subscription`,
				status: `active`,
			},
		},
		id: `evt_${userId}`,
		livemode: false,
		object: `event`,
		type: `customer.subscription.created`,
	})

	const stripe = createStripeClient(`sk_test_placeholder`)
	const signature = await stripe.webhooks.generateTestHeaderStringAsync({
		payload,
		secret: webhookSecret,
	})

	const response = await app.request(
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
			STRIPE_SUPPORTER_PRICE_ID: supporterPriceId,
			STRIPE_WEBHOOK_SECRET: webhookSecret,
		},
	)

	expect(response.status).toBe(200)
	await expect(response.json()).resolves.toEqual({ received: true })

	const syncedSubscription = await db.query.stripeSubscriptions.findFirst({
		where: (subscription, { eq }) =>
			eq(subscription.stripeSubscriptionId, stripeSubscriptionId),
	})
	expect(syncedSubscription).toMatchObject({
		cancelAtPeriodEnd: false,
		latestInvoiceId: invoiceId,
		priceId: supporterPriceId,
		status: `active`,
		stripeCustomerId,
		userId,
	})
	expect(syncedSubscription?.latestInvoicePaidAt).toBe(`2026-05-11 13:46:40`)
	expect(syncedSubscription?.currentPeriodEnd).toBe(`2026-06-10 13:46:40`)

	const userRole = await getUserRole({
		db,
		stripeSupporterPriceId: supporterPriceId,
		userId,
	})
	expect(userRole).toBe(`supporter`)

	const webhookEvent = await db.query.stripeWebhookEvents.findFirst({
		where: (event, { eq }) => eq(event.stripeEventId, `evt_${userId}`),
	})
	expect(webhookEvent?.processedAt).toBeTruthy()
	expect(webhookEvent?.processingError).toBeNull()
})
