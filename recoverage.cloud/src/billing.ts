import { Temporal } from "@js-temporal/polyfill"
import { and, eq, sql } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type Stripe from "stripe"

import type { Json } from "./json"
import type { Role } from "./roles-permissions"
import * as schema from "./schema"
import {
	instantFromSQLTimestamp,
	sqlNow,
	sqlTimestampFromUnixSeconds,
} from "./temporal"

export type BillingSubscription = Pick<
	typeof schema.stripeSubscriptions.$inferSelect,
	`currentPeriodEnd` | `latestInvoicePaidAt` | `priceId` | `status`
>

export type DeriveRoleInput = {
	manualRoleOverride: Role | null
	now: Temporal.Instant
	stripeSupporterPriceId?: string | undefined
	subscriptions: BillingSubscription[]
}

export function deriveRole(input: DeriveRoleInput): Role {
	const { manualRoleOverride, now, stripeSupporterPriceId, subscriptions } =
		input
	if (manualRoleOverride) {
		return manualRoleOverride
	}
	if (!stripeSupporterPriceId) {
		return `free`
	}
	const hasPaidSupporterSubscription = subscriptions.some(
		(subscription) =>
			subscription.priceId === stripeSupporterPriceId &&
			subscription.status === `active` &&
			Boolean(subscription.latestInvoicePaidAt) &&
			Temporal.Instant.compare(
				instantFromSQLTimestamp(subscription.currentPeriodEnd),
				now,
			) > 0,
	)
	return hasPaidSupporterSubscription ? `supporter` : `free`
}

export async function getUserRole({
	db,
	now = instantFromSQLTimestamp(sqlNow()),
	stripeSupporterPriceId,
	userId,
}: {
	db: DrizzleD1Database<typeof schema>
	now?: Temporal.Instant
	stripeSupporterPriceId?: string | undefined
	userId: number
}): Promise<Role | undefined> {
	const user = await db.query.users.findFirst({
		where: eq(schema.users.id, userId),
		columns: { manualRoleOverride: true },
	})
	if (!user) {
		return undefined
	}
	const subscriptions = stripeSupporterPriceId
		? await db.query.stripeSubscriptions.findMany({
				where: and(
					eq(schema.stripeSubscriptions.userId, userId),
					eq(schema.stripeSubscriptions.priceId, stripeSupporterPriceId),
				),
				columns: {
					currentPeriodEnd: true,
					latestInvoicePaidAt: true,
					priceId: true,
					status: true,
				},
			})
		: []

	return deriveRole({
		manualRoleOverride: user.manualRoleOverride,
		now,
		stripeSupporterPriceId,
		subscriptions,
	})
}

function stripeCustomerIdFromSubscription(
	subscription: Stripe.Subscription,
): string {
	return typeof subscription.customer === `string`
		? subscription.customer
		: subscription.customer.id
}

function stripeSubscriptionPriceId(
	subscription: Stripe.Subscription,
): string | undefined {
	return subscription.items.data[0]?.price.id
}

function stripeSubscriptionUserIdFromMetadata(
	subscription: Stripe.Subscription,
): number | undefined {
	const userId = Number(subscription.metadata[`recoverageUserId`])
	return Number.isInteger(userId) ? userId : undefined
}

function latestInvoiceIdFromSubscription(
	subscription: Stripe.Subscription,
): string | null {
	return typeof subscription.latest_invoice === `string`
		? subscription.latest_invoice
		: (subscription.latest_invoice?.id ?? null)
}

function latestInvoicePaidAtFromSubscription(subscription: Stripe.Subscription) {
	if (!subscription.latest_invoice) {
		return null
	}
	if (typeof subscription.latest_invoice === `string`) {
		throw new Error(
			`Stripe subscription ${subscription.id} requires an expanded latest invoice.`,
		)
	}
	return sqlTimestampFromUnixSeconds(
		subscription.latest_invoice.status_transitions.paid_at,
	)
}

export async function upsertStripeSubscription({
	db,
	subscription,
	expectedRevision,
}: {
	db: DrizzleD1Database<typeof schema>
	subscription: Stripe.Subscription
	expectedRevision: number | null
}): Promise<boolean> {
	const stripeCustomerId = stripeCustomerIdFromSubscription(subscription)
	const stripeCustomer = await db.query.stripeCustomers.findFirst({
		where: eq(schema.stripeCustomers.stripeCustomerId, stripeCustomerId),
		columns: { userId: true },
	})
	const userId =
		stripeCustomer?.userId ?? stripeSubscriptionUserIdFromMetadata(subscription)
	if (!userId) {
		throw new Error(
			`Could not resolve a recoverage user for Stripe customer ${stripeCustomerId}.`,
		)
	}

	if (!stripeCustomer) {
		await db
			.insert(schema.stripeCustomers)
			.values({ stripeCustomerId, userId })
			.onConflictDoNothing()
	}

	const priceId = stripeSubscriptionPriceId(subscription)
	if (!priceId) {
		throw new Error(
			`Stripe subscription ${subscription.id} did not include a price.`,
		)
	}

	const currentPeriodEnd = sqlTimestampFromUnixSeconds(
		subscription.items.data[0]?.current_period_end ?? null,
	)
	if (!currentPeriodEnd) {
		throw new Error(
			`Stripe subscription ${subscription.id} did not include current_period_end.`,
		)
	}

	// These facts come from one current Stripe snapshot. In particular, a null
	// payment on a new invoice must never inherit payment from an earlier invoice.
	const latestInvoiceId = latestInvoiceIdFromSubscription(subscription)
	const latestInvoicePaidAt = latestInvoicePaidAtFromSubscription(subscription)
	// Portal cancellation uses cancel_at for flexible billing subscriptions.
	const cancelAtPeriodEnd =
		subscription.cancel_at_period_end ||
		typeof subscription.cancel_at === `number`

	const facts = {
		cancelAtPeriodEnd,
		currentPeriodEnd,
		latestInvoiceId,
		latestInvoicePaidAt,
		priceId,
		status: subscription.status,
		stripeCustomerId,
		stripeSubscriptionId: subscription.id,
		updatedAt: sqlNow(),
		userId,
	}
	// Fence the whole read-from-Stripe/write-to-D1 operation. Even two snapshots
	// with identical billing facts need distinct revisions to prevent ABA races.
	if (expectedRevision === null) {
		const inserted = await db
			.insert(schema.stripeSubscriptions)
			.values({ ...facts, syncRevision: 1 })
			.onConflictDoNothing()
			.returning({ id: schema.stripeSubscriptions.stripeSubscriptionId })
		return inserted.length === 1
	}
	const updated = await db
		.update(schema.stripeSubscriptions)
		.set({ ...facts, syncRevision: expectedRevision + 1 })
		.where(
			and(
				eq(schema.stripeSubscriptions.stripeSubscriptionId, subscription.id),
				eq(schema.stripeSubscriptions.syncRevision, expectedRevision),
				// Terminal states cannot be revived by an older Stripe response.
				sql`(${schema.stripeSubscriptions.status} not in ('canceled', 'incomplete_expired')
				or ${schema.stripeSubscriptions.status} = ${subscription.status})`,
			),
		)
		.returning({ id: schema.stripeSubscriptions.stripeSubscriptionId })
	return updated.length === 1
}

export async function recordStripeWebhookEvent({
	db,
	event,
	payload,
}: {
	db: DrizzleD1Database<typeof schema>
	event: Stripe.Event
	payload: string
}): Promise<{ alreadyProcessed: boolean }> {
	const existingEvent = await db.query.stripeWebhookEvents.findFirst({
		where: eq(schema.stripeWebhookEvents.stripeEventId, event.id),
		columns: { processedAt: true },
	})
	if (existingEvent?.processedAt) {
		return { alreadyProcessed: true }
	}
	if (!existingEvent) {
		await db
			.insert(schema.stripeWebhookEvents)
			.values({
				createdAt: sqlTimestampFromUnixSeconds(event.created),
				mode: event.livemode ? `live` : `test`,
				payload: payload as Json.stringified<Json.Val>,
				receivedAt: sqlNow(),
				stripeEventId: event.id,
				type: event.type,
			})
			.onConflictDoNothing()
	}

	return { alreadyProcessed: false }
}

export async function markStripeWebhookEventProcessed({
	db,
	eventId,
}: {
	db: DrizzleD1Database<typeof schema>
	eventId: string
}): Promise<void> {
	await db
		.update(schema.stripeWebhookEvents)
		.set({
			processedAt: sqlNow(),
			processingError: null,
		})
		.where(eq(schema.stripeWebhookEvents.stripeEventId, eventId))
}

export async function markStripeWebhookEventFailed({
	db,
	eventId,
	error,
}: {
	db: DrizzleD1Database<typeof schema>
	eventId: string
	error: unknown
}): Promise<void> {
	await db
		.update(schema.stripeWebhookEvents)
		.set({
			processingError: webhookFailureReason(error),
		})
		.where(eq(schema.stripeWebhookEvents.stripeEventId, eventId))
}

function webhookFailureReason(error: unknown): string {
	if (!(error instanceof Error)) return `Webhook synchronization failed.`
	if (`type` in error && error.type === `StripeAuthenticationError`)
		return `Stripe authentication failed; verify the API key.`
	if (
		error.message ===
		`STRIPE_SECRET_KEY is required to sync Stripe subscriptions.`
	)
		return error.message
	if (error.message.includes(`expanded latest invoice`))
		return `Stripe did not return an expanded latest invoice.`
	return `Webhook synchronization failed; check Stripe delivery and configuration.`
}
