import { eq } from "drizzle-orm"
import type { Hono, MiddlewareHandler } from "hono"

import { type BillingEnv, billingSameOrigin } from "./billing-auth"
import { getEnv } from "./env"
import { portalEnabled, verifyPortalConfiguration } from "./portal-config"
import * as schema from "./schema"
import { createStripeClient } from "./stripe"

export function registerPortalRoutes(
	portalRoutes: Hono<BillingEnv>,
	billingAuth: MiddlewareHandler<BillingEnv>,
): void {
	portalRoutes.post(`/portal`, billingSameOrigin, billingAuth, async (c) => {
		c.header(`Cache-Control`, `no-store`)
		const config = getEnv(c.env)
		const unavailable = () =>
			c.json(
				{
					error: `Billing management is temporarily unavailable. Please visit /support for help.`,
				},
				503,
			)
		if (
			!portalEnabled(config) ||
			!config.STRIPE_SECRET_KEY ||
			!config.STRIPE_MODE ||
			!config.STRIPE_PORTAL_CONFIGURATION_ID
		)
			return unavailable()

		// Ignore submitted customer IDs, subscription IDs and return URLs. The
		// authenticated GitHub account determines the only accessible Stripe customer.
		const customer = await c.get(`drizzle`).query.stripeCustomers.findFirst({
			where: eq(schema.stripeCustomers.userId, c.get(`userId`)),
			columns: { stripeCustomerId: true },
		})
		if (!customer) {
			return c.json(
				{ error: `Your account does not have a billing customer yet.` },
				409,
			)
		}

		try {
			const stripe = createStripeClient(config.STRIPE_SECRET_KEY)
			const stripeCustomer = await stripe.customers.retrieve(
				customer.stripeCustomerId,
			)
			if (
				stripeCustomer.deleted ||
				stripeCustomer.livemode !== (config.STRIPE_MODE === `live`)
			) {
				return unavailable()
			}
			verifyPortalConfiguration(
				await stripe.billingPortal.configurations.retrieve(
					config.STRIPE_PORTAL_CONFIGURATION_ID,
				),
				config.STRIPE_MODE,
			)
			const session = await stripe.billingPortal.sessions.create({
				customer: customer.stripeCustomerId,
				configuration: config.STRIPE_PORTAL_CONFIGURATION_ID,
				return_url: new URL(`/ui/billing`, c.req.url).href,
			})
			return c.redirect(session.url, 303)
		} catch {
			// Stripe errors may include customer data or temporary portal credentials.
			console.error({ event: `billing_portal_failed` })
			return unavailable()
		}
	})
}
