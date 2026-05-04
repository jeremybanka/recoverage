import { Temporal } from "@js-temporal/polyfill"
import { and, eq } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"

import type { Role } from "./roles-permissions"
import * as schema from "./schema"
import { instantFromISO8601, isoNow } from "./temporal"

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
