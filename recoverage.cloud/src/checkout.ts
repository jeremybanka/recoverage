import { and, eq } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type Stripe from "stripe"

import * as schema from "./schema"
import { createSupporterCheckoutSessionParams } from "./stripe"

type Attempt = typeof schema.stripeCheckoutAttempts.$inferSelect
type Database = DrizzleD1Database<typeof schema>

export class CheckoutUnavailable extends Error {
	public readonly retryAfter: number

	public constructor(retryAfter: number) {
		super(`The current Checkout attempt cannot be retried yet.`)
		this.retryAfter = retryAfter
	}
}

function terminal(status: Stripe.Subscription.Status): boolean {
	return status === `canceled` || status === `incomplete_expired`
}

function newAttempt(userId: number, priceId: string, origin: string): Attempt {
	return {
		userId,
		attemptId: crypto.randomUUID(),
		priceId,
		origin,
		// Shorter than Stripe's 24-hour idempotency retention. An old request
		// cannot create a new session once this immutable deadline has passed.
		expiresAt: Math.floor(Date.now() / 1000) + 60 * 60,
		stripeSessionId: null,
	}
}

async function customerForAttempt(
	db: Database,
	stripe: Stripe,
	attempt: Attempt,
): Promise<string> {
	const existing = await db.query.stripeCustomers.findFirst({
		where: eq(schema.stripeCustomers.userId, attempt.userId),
	})
	if (existing) return existing.stripeCustomerId

	// Do not include mutable GitHub profile fields in an idempotent request.
	// Checkout collects the customer's current email itself.
	const customer = await stripe.customers.create(
		{ metadata: { recoverageUserId: String(attempt.userId) } },
		{ idempotencyKey: `recoverage-customer-${attempt.attemptId}` },
	)
	await db
		.insert(schema.stripeCustomers)
		.values({ userId: attempt.userId, stripeCustomerId: customer.id })
		.onConflictDoNothing({ target: schema.stripeCustomers.userId })
	const canonical = await db.query.stripeCustomers.findFirst({
		where: eq(schema.stripeCustomers.userId, attempt.userId),
	})
	if (!canonical) throw new Error(`Stripe customer could not be persisted.`)
	// A session is only created for the persisted customer, including when a
	// previous response was lost or concurrent attempts created unused customers.
	return canonical.stripeCustomerId
}

async function findSession(
	stripe: Stripe,
	customerId: string,
	attempt: Attempt,
	livemode: boolean,
): Promise<Stripe.Checkout.Session | undefined> {
	if (attempt.stripeSessionId) {
		return stripe.checkout.sessions.retrieve(attempt.stripeSessionId)
	}
	// Recover a successful creation whose response/database write was lost.
	// Also reuse an open subscription checkout from before this safeguard.
	for await (const session of stripe.checkout.sessions.list({
		customer: customerId,
		limit: 100,
	})) {
		if (
			session.metadata?.[`recoverageAttemptId`] === attempt.attemptId ||
			(session.mode === `subscription` && session.status === `open`)
		) {
			return session
		}
		// A pre-safeguard session can finish between subscriptions.list and
		// this listing. Check its current subscription before dismissing it as
		// history; missing subscription details mean payment is still pending.
		if (session.mode === `subscription` && session.status === `complete`) {
			if (!session.subscription) return session
			const subscription = await stripe.subscriptions.retrieve(
				typeof session.subscription === `string`
					? session.subscription
					: session.subscription.id,
			)
			if (subscription.livemode !== livemode)
				throw new Error(`Stripe subscription mode does not match.`)
			if (!terminal(subscription.status)) return session
		}
	}
	return undefined
}

export async function supporterCheckout({
	db,
	stripe,
	userId,
	priceId,
	origin,
	livemode,
}: {
	db: Database
	stripe: Stripe
	userId: number
	priceId: string
	origin: string
	livemode: boolean
}): Promise<{ url: string }> {
	await db
		.insert(schema.stripeCheckoutAttempts)
		.values(newAttempt(userId, priceId, origin))
		.onConflictDoNothing({ target: schema.stripeCheckoutAttempts.userId })

	// Compare-and-swap may lose to another request advancing the same expired
	// attempt. Re-read its winner; never create a second independent attempt.
	for (let retry = 0; retry < 4; retry++) {
		const attempt = await db.query.stripeCheckoutAttempts.findFirst({
			where: eq(schema.stripeCheckoutAttempts.userId, userId),
		})
		if (!attempt) throw new Error(`Checkout attempt could not be persisted.`)
		const customerId = await customerForAttempt(db, stripe, attempt)

		// Local entitlements can lag webhooks. Every nonterminal subscription
		// blocks a second purchase, including unpaid, incomplete and trialing.
		for await (const subscription of stripe.subscriptions.list({
			customer: customerId,
			status: `all`,
			limit: 100,
		})) {
			if (subscription.livemode !== livemode)
				throw new Error(`Stripe subscription mode does not match.`)
			if (!terminal(subscription.status)) return { url: `/ui/billing` }
		}

		let session = await findSession(stripe, customerId, attempt, livemode)
		if (session) {
			if (
				session.customer !== customerId ||
				session.mode !== `subscription` ||
				session.livemode !== livemode
			) {
				throw new Error(`Stripe Checkout does not match this account.`)
			}
			await db
				.update(schema.stripeCheckoutAttempts)
				.set({ stripeSessionId: session.id })
				.where(
					and(
						eq(schema.stripeCheckoutAttempts.userId, userId),
						eq(schema.stripeCheckoutAttempts.attemptId, attempt.attemptId),
					),
				)
			if (session.status === `open`) {
				const items = await stripe.checkout.sessions.listLineItems(session.id, {
					limit: 2,
				})
				if (
					session.metadata?.[`recoverageUserId`] !== String(userId) ||
					session.metadata[`recoveragePlan`] !== `supporter` ||
					items.has_more ||
					items.data.length !== 1 ||
					items.data[0]?.price?.id !== priceId ||
					items.data[0]?.quantity !== 1
				) {
					throw new CheckoutUnavailable(
						Math.max(1, session.expires_at - Math.floor(Date.now() / 1000)),
					)
				}
				if (!session.url)
					throw new Error(`Stripe did not return a Checkout URL.`)
				return { url: session.url }
			}
			if (session.status === `complete`) {
				// Completion is not necessarily payment. Never offer another purchase
				// while Stripe is still confirming or collecting the first payment.
				if (!session.subscription) return { url: `/ui/billing` }
				const subscription = await stripe.subscriptions.retrieve(
					typeof session.subscription === `string`
						? session.subscription
						: session.subscription.id,
				)
				if (subscription.livemode !== livemode)
					throw new Error(`Stripe subscription mode does not match.`)
				if (!terminal(subscription.status)) return { url: `/ui/billing` }
			} else if (session.status !== `expired`) {
				throw new Error(`Stripe Checkout status is unknown.`)
			}
		}

		if (session || attempt.expiresAt <= Math.floor(Date.now() / 1000)) {
			// An adopted legacy session did not consume this attempt's Stripe
			// idempotency key. A concurrent request may still be creating with it,
			// so only the fixed deadline makes replacement safe in that case.
			if (
				session?.metadata?.[`recoverageAttemptId`] !== attempt.attemptId &&
				attempt.expiresAt > Math.floor(Date.now() / 1000)
			) {
				throw new CheckoutUnavailable(
					attempt.expiresAt - Math.floor(Date.now() / 1000),
				)
			}
			await db
				.update(schema.stripeCheckoutAttempts)
				.set(newAttempt(userId, priceId, origin))
				.where(
					and(
						eq(schema.stripeCheckoutAttempts.userId, userId),
						eq(schema.stripeCheckoutAttempts.attemptId, attempt.attemptId),
					),
				)
			continue
		}

		// A price change cannot alter the parameters of an existing idempotent
		// creation. Let that attempt expire before accepting the new price.
		if (attempt.priceId !== priceId)
			throw new CheckoutUnavailable(
				Math.max(1, attempt.expiresAt - Math.floor(Date.now() / 1000)),
			)
		// Stripe requires at least 30 minutes until expires_at on first creation.
		// Preserve the old attempt until it is safe to rotate, even if its first
		// response was lost. Earlier rotation could leave two payable sessions.
		const remaining = attempt.expiresAt - Math.floor(Date.now() / 1000)
		if (remaining <= 30 * 60)
			throw new CheckoutUnavailable(Math.max(1, remaining))
		session = await stripe.checkout.sessions.create(
			{
				...createSupporterCheckoutSessionParams({
					customerId,
					origin: attempt.origin,
					priceId: attempt.priceId,
					userId,
				}),
				expires_at: attempt.expiresAt,
				metadata: {
					recoveragePlan: `supporter`,
					recoverageUserId: String(userId),
					recoverageAttemptId: attempt.attemptId,
				},
			},
			{ idempotencyKey: `recoverage-checkout-${attempt.attemptId}` },
		)
		await db
			.update(schema.stripeCheckoutAttempts)
			.set({ stripeSessionId: session.id })
			.where(
				and(
					eq(schema.stripeCheckoutAttempts.userId, userId),
					eq(schema.stripeCheckoutAttempts.attemptId, attempt.attemptId),
				),
			)
		if (!session.url) throw new Error(`Stripe did not return a Checkout URL.`)
		return { url: session.url }
	}
	throw new Error(`Checkout is busy; retry shortly.`)
}
