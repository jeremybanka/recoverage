import type Stripe from "stripe"

export class BillingConfigurationError extends Error {}

export const stripeApiVersion = `2026-04-22.dahlia`
export const billingEvents = [
	`checkout.session.completed`,
	`customer.subscription.created`,
	`customer.subscription.updated`,
	`customer.subscription.deleted`,
	`invoice.paid`,
	`invoice.payment_failed`,
	`invoice.payment_action_required`,
] as const

export type BillingConfig = {
	STRIPE_MODE?: `live` | `test` | undefined
	STRIPE_SECRET_KEY?: string | undefined
	STRIPE_SUPPORTER_PRICE_ID?: string | undefined
	STRIPE_WEBHOOK_SECRET?: string | undefined
	CHECKOUT_ENABLED?: string | undefined
	BILLING_SUPPORT_EMAIL?: string | undefined
	BILLING_REFUND_POLICY?: string | undefined
}

export function billingModeMatches(config: BillingConfig): boolean {
	return (
		!!config.STRIPE_MODE &&
		!!config.STRIPE_SECRET_KEY?.startsWith(`sk_${config.STRIPE_MODE}_`)
	)
}

export function checkoutEnabled(config: BillingConfig): boolean {
	return (
		config.CHECKOUT_ENABLED === `true` &&
		billingModeMatches(config) &&
		!!config.STRIPE_SUPPORTER_PRICE_ID &&
		!!config.STRIPE_WEBHOOK_SECRET &&
		!!config.BILLING_SUPPORT_EMAIL &&
		!!config.BILLING_REFUND_POLICY
	)
}

export function verifySupporterPrice(
	price: Stripe.Price,
	mode: `live` | `test`,
): void {
	if (
		price.livemode !== (mode === `live`) ||
		!price.active ||
		price.currency !== `usd` ||
		price.unit_amount !== 100 ||
		price.type !== `recurring` ||
		price.billing_scheme !== `per_unit` ||
		price.recurring?.interval !== `month` ||
		price.recurring.interval_count !== 1 ||
		price.recurring.usage_type !== `licensed`
	) {
		throw new BillingConfigurationError(
			`Supporter price must be active, in the configured mode, and USD 1 per month per subscription.`,
		)
	}
}
