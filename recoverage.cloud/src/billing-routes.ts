import type { Endpoints } from "@octokit/types"
import { eq } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { MiddlewareHandler } from "hono"
import { Hono } from "hono"
import { deleteCookie, getSignedCookie } from "hono/cookie"
import { Octokit } from "octokit"
import type Stripe from "stripe"

import {
	applyInvoicePaidToStripeSubscription,
	markStripeWebhookEventFailed,
	markStripeWebhookEventProcessed,
	recordStripeWebhookEvent,
	upsertStripeSubscription,
} from "./billing"
import { cachedFetch } from "./cached-fetch"
import { createDatabase } from "./db"
import { type Bindings, getEnv } from "./env"
import * as schema from "./schema"
import {
	createStripeClient,
	createSupporterCheckoutSessionParams,
	retrieveStripeSubscription,
} from "./stripe"

type BillingEnv = {
	Bindings: Bindings
	Variables: {
		drizzle: DrizzleD1Database<typeof schema>
		githubUserData: Endpoints[`GET /user`][`response`][`data`]
		userId: number
	}
}

export const billingRoutes = new Hono<BillingEnv>()

const billingAuth: MiddlewareHandler<BillingEnv> = async (c, next) => {
	const env = getEnv(c.env)
	const githubAccessTokenCookie = await getSignedCookie(
		c,
		env.COOKIE_SECRET,
		`github-access-token`,
	)

	if (!githubAccessTokenCookie) {
		return c.json({ error: `Unauthorized` }, 401)
	}

	const octokit = new Octokit({ auth: githubAccessTokenCookie })
	const { data, status } = await octokit.request(`GET /user`, {
		request: { fetch: cachedFetch },
	})

	if (status !== 200) {
		deleteCookie(c, `github-access-token`)
		return c.json({ error: `Unauthorized` }, 401)
	}

	const db = createDatabase(c.env.DB)
	const user = await db.query.users.findFirst({
		where: eq(schema.users.id, data.id),
		columns: { id: true },
	})

	if (!user) {
		deleteCookie(c, `github-access-token`)
		return c.json(
			{ error: `User did not move through the expected auth flow.` },
			500,
		)
	}

	c.set(`drizzle`, db)
	c.set(`githubUserData`, data)
	c.set(`userId`, user.id)

	await next()
}

billingRoutes.post(`/checkout`, billingAuth, async (c) => {
	const env = getEnv(c.env)

	if (!env.STRIPE_SECRET_KEY) {
		return c.json({ error: `STRIPE_SECRET_KEY is not configured.` }, 500)
	}
	if (!env.STRIPE_SUPPORTER_PRICE_ID) {
		return c.json({ error: `STRIPE_SUPPORTER_PRICE_ID is not configured.` }, 500)
	}

	const db = c.get(`drizzle`)
	const userId = c.get(`userId`)
	const githubUser = c.get(`githubUserData`)
	const stripe = createStripeClient(env.STRIPE_SECRET_KEY)

	let stripeCustomer = await db.query.stripeCustomers.findFirst({
		where: eq(schema.stripeCustomers.userId, userId),
		columns: { stripeCustomerId: true },
	})

	if (!stripeCustomer) {
		const customer = await stripe.customers.create({
			...(githubUser.email ? { email: githubUser.email } : {}),
			metadata: { recoverageUserId: String(userId) },
			name: githubUser.name ?? githubUser.login,
		})
		stripeCustomer = { stripeCustomerId: customer.id }
		await db.insert(schema.stripeCustomers).values({
			userId,
			stripeCustomerId: customer.id,
		})
	}

	const origin = new URL(c.req.url).origin
	const checkoutSession = await stripe.checkout.sessions.create(
		createSupporterCheckoutSessionParams({
			customerId: stripeCustomer.stripeCustomerId,
			origin,
			priceId: env.STRIPE_SUPPORTER_PRICE_ID,
			userId,
		}),
	)

	if (!checkoutSession.url) {
		return c.json({ error: `Stripe did not return a Checkout URL.` }, 500)
	}

	return c.redirect(checkoutSession.url, 303)
})

billingRoutes.post(`/webhook`, async (c) => {
	const env = getEnv(c.env)
	if (!env.STRIPE_WEBHOOK_SECRET) {
		return c.json({ error: `STRIPE_WEBHOOK_SECRET is not configured.` }, 500)
	}

	const stripeSignature = c.req.header(`stripe-signature`)
	if (!stripeSignature) {
		return c.json({ error: `Missing Stripe signature.` }, 400)
	}

	const rawBody = await c.req.text()
	const stripe = env.STRIPE_SECRET_KEY
		? createStripeClient(env.STRIPE_SECRET_KEY)
		: null

	let event: Stripe.Event
	try {
		event = await createStripeClient(
			`sk_test_placeholder`,
		).webhooks.constructEventAsync(
			rawBody,
			stripeSignature,
			env.STRIPE_WEBHOOK_SECRET,
		)
	} catch (error) {
		console.error(error)
		return c.json({ error: `Invalid Stripe webhook signature.` }, 400)
	}

	const db = createDatabase(c.env.DB)
	const { alreadyProcessed } = await recordStripeWebhookEvent({
		db,
		event,
		payload: rawBody,
	})
	if (alreadyProcessed) {
		return c.json({ received: true, duplicate: true })
	}

	try {
		await handleStripeWebhookEvent({ db, event, stripe })
		await markStripeWebhookEventProcessed({ db, eventId: event.id })
		return c.json({ received: true })
	} catch (error) {
		console.error(error)
		await markStripeWebhookEventFailed({ db, eventId: event.id, error })
		return c.json({ error: `Webhook processing failed.` }, 500)
	}
})

async function handleStripeWebhookEvent({
	db,
	event,
	stripe,
}: {
	db: DrizzleD1Database<typeof schema>
	event: Stripe.Event
	stripe: Stripe | null
}): Promise<void> {
	if (event.type === `checkout.session.completed`) {
		const session = event.data.object
		if (session.mode !== `subscription`) {
			return
		}
		const subscriptionId =
			typeof session.subscription === `string`
				? session.subscription
				: session.subscription?.id
		if (!subscriptionId) {
			return
		}
		if (!stripe) {
			throw new Error(
				`STRIPE_SECRET_KEY is required to sync Checkout subscriptions.`,
			)
		}
		await upsertStripeSubscription({
			db,
			subscription: await retrieveStripeSubscription(stripe, subscriptionId),
		})
		return
	}

	if (
		event.type === `customer.subscription.created` ||
		event.type === `customer.subscription.updated` ||
		event.type === `customer.subscription.deleted`
	) {
		await upsertStripeSubscription({
			db,
			subscription: event.data.object,
		})
		return
	}

	if (event.type === `invoice.paid`) {
		const invoice = event.data.object
		const foundExistingSubscription = await applyInvoicePaidToStripeSubscription(
			{
				db,
				invoice,
			},
		)
		if (foundExistingSubscription) {
			return
		}

		const subscriptionId = invoice.parent?.subscription_details?.subscription
		if (!subscriptionId) {
			return
		}
		if (!stripe) {
			throw new Error(
				`STRIPE_SECRET_KEY is required to backfill invoice subscriptions.`,
			)
		}
		await upsertStripeSubscription({
			db,
			subscription: await retrieveStripeSubscription(
				stripe,
				typeof subscriptionId === `string` ? subscriptionId : subscriptionId.id,
			),
		})
		await applyInvoicePaidToStripeSubscription({ db, invoice })
	}
}
