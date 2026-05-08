import { Temporal } from "@js-temporal/polyfill"
import { and, eq } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type Stripe from "stripe"

import type { Json } from "./json"
import { stringify } from "./json"
import type { Role } from "./roles-permissions"
import * as schema from "./schema"
import { instantFromISO8601, iso8601FromUnixSeconds, isoNow } from "./temporal"

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
				instantFromISO8601(subscription.currentPeriodEnd),
				now,
			) > 0,
	)
	return hasPaidSupporterSubscription ? `supporter` : `free`
}

export async function getUserRole({
	db,
	now = instantFromISO8601(isoNow()),
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
	if (
		!subscription.latest_invoice ||
		typeof subscription.latest_invoice === `string`
	) {
		return null
	}
	return iso8601FromUnixSeconds(
		subscription.latest_invoice.status_transitions.paid_at,
	)
}

function stripeSubscriptionIdFromInvoice(
	invoice: Stripe.Invoice,
): string | null {
	if (!invoice.parent?.subscription_details?.subscription) {
		return null
	}
	return typeof invoice.parent.subscription_details.subscription === `string`
		? invoice.parent.subscription_details.subscription
		: invoice.parent.subscription_details.subscription.id
}

export async function upsertStripeSubscription({
	db,
	subscription,
}: {
	db: DrizzleD1Database<typeof schema>
	subscription: Stripe.Subscription
}): Promise<void> {
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
		await db.insert(schema.stripeCustomers).values({ stripeCustomerId, userId })
	}

	const priceId = stripeSubscriptionPriceId(subscription)
	if (!priceId) {
		throw new Error(
			`Stripe subscription ${subscription.id} did not include a price.`,
		)
	}

	const currentPeriodEnd = iso8601FromUnixSeconds(
		subscription.items.data[0]?.current_period_end ?? null,
	)
	if (!currentPeriodEnd) {
		throw new Error(
			`Stripe subscription ${subscription.id} did not include current_period_end.`,
		)
	}

	const existingSubscription = await db.query.stripeSubscriptions.findFirst({
		where: eq(schema.stripeSubscriptions.stripeSubscriptionId, subscription.id),
		columns: {
			latestInvoiceId: true,
			latestInvoicePaidAt: true,
		},
	})
	const latestInvoiceId =
		latestInvoiceIdFromSubscription(subscription) ??
		existingSubscription?.latestInvoiceId ??
		null
	const latestInvoicePaidAt =
		latestInvoicePaidAtFromSubscription(subscription) ??
		existingSubscription?.latestInvoicePaidAt ??
		null

	await db
		.insert(schema.stripeSubscriptions)
		.values({
			cancelAtPeriodEnd: subscription.cancel_at_period_end,
			currentPeriodEnd,
			latestInvoiceId,
			latestInvoicePaidAt,
			priceId,
			status: subscription.status,
			stripeCustomerId,
			stripeSubscriptionId: subscription.id,
			updatedAt: isoNow(),
			userId,
		})
		.onConflictDoUpdate({
			target: [schema.stripeSubscriptions.stripeSubscriptionId],
			set: {
				cancelAtPeriodEnd: subscription.cancel_at_period_end,
				currentPeriodEnd,
				latestInvoiceId,
				latestInvoicePaidAt,
				priceId,
				status: subscription.status,
				stripeCustomerId,
				updatedAt: isoNow(),
				userId,
			},
		})
}

export async function applyInvoicePaidToStripeSubscription({
	db,
	invoice,
}: {
	db: DrizzleD1Database<typeof schema>
	invoice: Stripe.Invoice
}): Promise<boolean> {
	const stripeSubscriptionId = stripeSubscriptionIdFromInvoice(invoice)
	if (!stripeSubscriptionId) {
		return false
	}

	const existingSubscription = await db.query.stripeSubscriptions.findFirst({
		where: eq(
			schema.stripeSubscriptions.stripeSubscriptionId,
			stripeSubscriptionId,
		),
		columns: { stripeSubscriptionId: true },
	})
	if (!existingSubscription) {
		return false
	}

	await db
		.update(schema.stripeSubscriptions)
		.set({
			latestInvoiceId: invoice.id,
			latestInvoicePaidAt: iso8601FromUnixSeconds(
				invoice.status_transitions.paid_at,
			),
			updatedAt: isoNow(),
		})
		.where(
			eq(schema.stripeSubscriptions.stripeSubscriptionId, stripeSubscriptionId),
		)

	return true
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
		await db.insert(schema.stripeWebhookEvents).values({
			createdAt: iso8601FromUnixSeconds(event.created),
			mode: event.livemode ? `live` : `test`,
			payload: payload as Json.stringified<Json.Val>,
			receivedAt: isoNow(),
			stripeEventId: event.id,
			type: event.type,
		})
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
			processedAt: isoNow(),
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
			processingError:
				error instanceof Error
					? error.message
					: stringify({ error: String(error) }),
		})
		.where(eq(schema.stripeWebhookEvents.stripeEventId, eventId))
}
