import { Temporal } from "@js-temporal/polyfill"

import { type BillingSubscription, deriveRole } from "../src/billing"

const supporterPriceId = `price_supporter`
const now = Temporal.Instant.from(`2026-05-03T12:00:00.000Z`)

function subscription(
	overrides: Partial<BillingSubscription> = {},
): BillingSubscription {
	return {
		currentPeriodEnd:
			`2026-06-03T12:00:00.000Z` as BillingSubscription[`currentPeriodEnd`],
		latestInvoicePaidAt:
			`2026-05-03T12:00:00.000Z` as BillingSubscription[`latestInvoicePaidAt`],
		priceId: supporterPriceId,
		status: `active`,
		...overrides,
	}
}

test(`manual role override wins over billing facts`, () => {
	expect(
		deriveRole({
			manualRoleOverride: `admin`,
			now,
			stripeSupporterPriceId: supporterPriceId,
			subscriptions: [],
		}),
	).toBe(`admin`)
})

test(`active paid current supporter subscription derives supporter`, () => {
	expect(
		deriveRole({
			manualRoleOverride: null,
			now,
			stripeSupporterPriceId: supporterPriceId,
			subscriptions: [subscription()],
		}),
	).toBe(`supporter`)
})

test(`subscription must match the configured supporter price`, () => {
	expect(
		deriveRole({
			manualRoleOverride: null,
			now,
			stripeSupporterPriceId: supporterPriceId,
			subscriptions: [subscription({ priceId: `price_other` })],
		}),
	).toBe(`free`)
})

test(`subscription must have a paid invoice`, () => {
	expect(
		deriveRole({
			manualRoleOverride: null,
			now,
			stripeSupporterPriceId: supporterPriceId,
			subscriptions: [subscription({ latestInvoicePaidAt: null })],
		}),
	).toBe(`free`)
})

test(`subscription must be active and current`, () => {
	expect(
		deriveRole({
			manualRoleOverride: null,
			now,
			stripeSupporterPriceId: supporterPriceId,
			subscriptions: [subscription({ status: `past_due` })],
		}),
	).toBe(`free`)
	expect(
		deriveRole({
			manualRoleOverride: null,
			now,
			stripeSupporterPriceId: supporterPriceId,
			subscriptions: [
				subscription({
					currentPeriodEnd:
						`2026-05-03T11:59:59.000Z` as BillingSubscription[`currentPeriodEnd`],
				}),
			],
		}),
	).toBe(`free`)
})
