import type Stripe from "stripe"

import {
	type BillingConfig,
	BillingConfigurationError,
	billingModeMatches,
} from "./billing-config"

export type PortalConfig = BillingConfig

export function portalEnabled(config: PortalConfig): boolean {
	return billingModeMatches(config) && !!config.STRIPE_PORTAL_CONFIGURATION_ID
}

export function verifyPortalConfiguration(
	configuration: Stripe.BillingPortal.Configuration,
	mode: `live` | `test`,
): void {
	const features = configuration.features
	if (
		!configuration.active ||
		configuration.livemode !== (mode === `live`) ||
		!features.invoice_history.enabled ||
		!features.payment_method_update.enabled ||
		!features.subscription_cancel.enabled ||
		features.subscription_cancel.mode !== `at_period_end` ||
		features.subscription_cancel.proration_behavior !== `none` ||
		features.subscription_update.enabled
	) {
		throw new BillingConfigurationError(
			`Portal configuration must be active in this mode, allow invoices, payment updates and period-end cancellation without proration, and disable plan/quantity changes.`,
		)
	}
}
