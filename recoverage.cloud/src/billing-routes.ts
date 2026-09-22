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
import { CheckoutUnavailable, supporterCheckout } from "./checkout"
import { createDatabase } from "./db"
import { type Bindings, getEnv } from "./env"
import { createGitHubClient } from "./github-client"
import * as schema from "./schema"
import { createStripeClient, retrieveStripeSubscription } from "./stripe"

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
	const origin = new URL(c.req.url).origin
	if (
		c.req.header(`origin`) !== origin ||
		(c.req.header(`sec-fetch-site`) &&
			c.req.header(`sec-fetch-site`) !== `same-origin`)
	) {
		return c.json({ error: `Billing requests must come from this site.` }, 403)
	}
	const env = getEnv(c.env)
	if (
		!env.STRIPE_SECRET_KEY ||
		!env.STRIPE_SUPPORTER_PRICE_ID ||
		!env.STRIPE_MODE
	) {
		return c.json({ error: `Billing is not configured.` }, 503)
	}

	try {
		const { success } = await c.env.CHECKOUT_LIMITER.limit({
			key: `${c.env.REPORT_RATE_SCOPE}:checkout:${c.get(`userId`)}`,
		})
		if (!success) {
			c.header(`Retry-After`, `60`)
			return c.json(
				{ error: `Too many checkout requests. Please try again in a minute.` },
				429,
			)
		}
		const stripe = createStripeClient(env.STRIPE_SECRET_KEY)
		verifySupporterPrice(
			await stripe.prices.retrieve(env.STRIPE_SUPPORTER_PRICE_ID),
			env.STRIPE_MODE,
		)
		const checkout = await supporterCheckout({
			db: c.get(`drizzle`),
			stripe,
			userId: c.get(`userId`),
			priceId: env.STRIPE_SUPPORTER_PRICE_ID,
			origin,
			livemode: env.STRIPE_MODE === `live`,
		})
		return c.redirect(checkout.url, 303)
	} catch (error) {
		// Stripe errors may contain customer details. Keep the durable attempt
		// for a safe retry, and never fall back to creating another purchase.
		c.header(
			`Retry-After`,
			String(error instanceof CheckoutUnavailable ? error.retryAfter : 30),
		)
		if (error instanceof CheckoutUnavailable) {
			return c.json(
				{
					error: `Your previous checkout is still reserved. Please try again in ${Math.ceil(error.retryAfter / 60)} minutes.`,
				},
				503,
			)
		}
		return c.json(
			{
				error: `Checkout is temporarily unavailable. Please try again shortly.`,
			},
			503,
		)
	}
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
