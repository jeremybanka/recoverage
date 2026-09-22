import type { Endpoints } from "@octokit/types"
import { eq } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { MiddlewareHandler } from "hono"
import { Hono } from "hono"
import { deleteCookie, getSignedCookie } from "hono/cookie"
import type Stripe from "stripe"

import {
	markStripeWebhookEventFailed,
	markStripeWebhookEventProcessed,
	recordStripeWebhookEvent,
	upsertStripeSubscription,
} from "./billing"
import {
	billingModeMatches,
	checkoutEnabled,
	stripeApiVersion,
	verifySupporterPrice,
} from "./billing-config"
import { cachedFetch } from "./cached-fetch"
import { createDatabase } from "./db"
import { type Bindings, getEnv } from "./env"
import { createGitHubClient } from "./github-client"
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

	const octokit = createGitHubClient(githubAccessTokenCookie)
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

billingRoutes.use(`/checkout`, async (c, next) => {
	if (!checkoutEnabled(getEnv(c.env))) {
		return c.json({ error: `New subscriptions are currently unavailable.` }, 503)
	}
	await next()
})

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
	if (!env.STRIPE_MODE)
		return c.json({ error: `Billing mode is not configured.` }, 503)
	verifySupporterPrice(
		await stripe.prices.retrieve(env.STRIPE_SUPPORTER_PRICE_ID),
		env.STRIPE_MODE,
	)

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
	const started = Date.now()
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

	let event: Stripe.Event | undefined
	for (const secret of [
		env.STRIPE_WEBHOOK_SECRET,
		env.STRIPE_WEBHOOK_PREVIOUS_SECRET,
	]) {
		if (!secret) continue
		try {
			event = await createStripeClient(
				`sk_test_placeholder`,
			).webhooks.constructEventAsync(rawBody, stripeSignature, secret)
			break
		} catch {
			// Signature errors can contain the signed payload. Never log them.
		}
	}
	if (!event) return c.json({ error: `Invalid Stripe webhook signature.` }, 400)
	if (!env.STRIPE_MODE || (env.STRIPE_SECRET_KEY && !billingModeMatches(env))) {
		return c.json(
			{ error: `Billing environment is not configured consistently.` },
			503,
		)
	}
	if (
		event.livemode !== (env.STRIPE_MODE === `live`) ||
		event.api_version !== stripeApiVersion
	) {
		return c.json(
			{
				error: `Stripe event mode or API version does not match this environment.`,
			},
			400,
		)
	}
	const logOutcome = (outcome: string) => {
		console.info({
			event: `stripe_webhook`,
			eventId: event.id,
			type: event.type,
			outcome,
			durationMs: Date.now() - started,
		})
	}

	const db = createDatabase(c.env.DB)
	const { alreadyProcessed } = await recordStripeWebhookEvent({
		db,
		event,
		payload: rawBody,
	})
	if (alreadyProcessed) {
		logOutcome(`duplicate`)
		return c.json({ received: true, duplicate: true })
	}

	try {
		await handleStripeWebhookEvent({ db, event, stripe })
		await markStripeWebhookEventProcessed({ db, eventId: event.id })
		logOutcome(`processed`)
		return c.json({ received: true })
	} catch (error) {
		logOutcome(`failed`)
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
	let subscriptionId: string | undefined
	if (event.type === `checkout.session.completed`) {
		const session = event.data.object
		if (session.mode !== `subscription`) {
			return
		}
		subscriptionId =
			typeof session.subscription === `string`
				? session.subscription
				: session.subscription?.id
	} else if (
		event.type === `customer.subscription.created` ||
		event.type === `customer.subscription.updated` ||
		event.type === `customer.subscription.deleted`
	) {
		subscriptionId = event.data.object.id
	} else if (event.type === `invoice.paid`) {
		const subscription =
			event.data.object.parent?.subscription_details?.subscription
		subscriptionId =
			typeof subscription === `string` ? subscription : subscription?.id
	}

	if (!subscriptionId) {
		return
	}
	if (!stripe) {
		throw new Error(
			`STRIPE_SECRET_KEY is required to sync Stripe subscriptions.`,
		)
	}

	// Webhooks are notifications, not ordered state changes. Even invoice.paid
	// may describe an older invoice, so always fetch the subscription's current
	// status, period, and expanded latest invoice together before persisting them.
	const subscription = await retrieveStripeSubscription(stripe, subscriptionId)
	if (subscription.livemode !== event.livemode)
		throw new Error(`Stripe subscription mode mismatch.`)
	await upsertStripeSubscription({ db, subscription })
}
