#!/usr/bin/env bun

import {
	BillingConfigurationError,
	billingEvents,
	billingModeMatches,
	stripeApiVersion,
	verifySupporterPrice,
} from "../src/billing-config"
import { verifyPortalConfiguration } from "../src/portal-config"
import { createStripeClient } from "../src/stripe"

function required(name: string): string {
	const value = process.env[name]
	if (!value) throw new BillingConfigurationError(`${name} is required.`)
	return value
}

async function verify() {
	const mode = required(`STRIPE_MODE`)
	if (mode !== `test` && mode !== `live`)
		throw new BillingConfigurationError(`STRIPE_MODE must be test or live.`)
	const key = required(`STRIPE_SECRET_KEY`)
	if (!billingModeMatches({ STRIPE_MODE: mode, STRIPE_SECRET_KEY: key }))
		throw new BillingConfigurationError(`Stripe API key mode mismatch.`)
	for (const name of [
		`GITHUB_CLIENT_ID`,
		`GITHUB_CLIENT_SECRET`,
		`COOKIE_SECRET`,
		`STRIPE_WEBHOOK_SECRET`,
		`BILLING_SUPPORT_EMAIL`,
		`BILLING_REFUND_POLICY`,
	])
		required(name)
	const workerUrl = new URL(required(`BILLING_WORKER_URL`))
	if (
		workerUrl.protocol !== `https:` ||
		workerUrl.username ||
		workerUrl.password ||
		workerUrl.pathname !== `/` ||
		workerUrl.search ||
		workerUrl.hash
	)
		throw new BillingConfigurationError(
			`BILLING_WORKER_URL must be an HTTPS origin.`,
		)
	const stripe = createStripeClient(key)
	const price = await stripe.prices.retrieve(
		required(`STRIPE_SUPPORTER_PRICE_ID`),
	)
	verifySupporterPrice(price, mode)
	const portal = await stripe.billingPortal.configurations.retrieve(
		required(`STRIPE_PORTAL_CONFIGURATION_ID`),
	)
	verifyPortalConfiguration(portal, mode)
	const endpoint = await stripe.webhookEndpoints.retrieve(
		required(`STRIPE_WEBHOOK_ENDPOINT_ID`),
	)
	if (
		endpoint.url !== new URL(`/billing/webhook`, workerUrl).href ||
		endpoint.livemode !== (mode === `live`) ||
		endpoint.status !== `enabled` ||
		endpoint.api_version !== stripeApiVersion
	)
		throw new BillingConfigurationError(
			`Webhook endpoint URL, mode, status, or API version does not match.`,
		)
	if (
		!endpoint.enabled_events.includes(`*`) &&
		billingEvents.some((event) => !endpoint.enabled_events.includes(event))
	)
		throw new BillingConfigurationError(
			`Webhook endpoint is missing required subscription, checkout, or invoice events.`,
		)
	console.info({
		verified: true,
		mode,
		worker: workerUrl.origin,
		priceId: price.id,
		portalConfigurationId: portal.id,
		endpointId: endpoint.id,
		apiVersion: endpoint.api_version,
	})
	console.info(
		`Read-only checks passed. Verify deployed secrets with a real signed delivery; confirm the OAuth callback and isolated D1 binding before enabling checkout.`,
	)
}

try {
	await verify()
} catch (error) {
	// Stripe exceptions may contain request details. Do not dump credentials or
	// customer data to CI logs; inspect configuration and Stripe's request log.
	console.error(
		error instanceof BillingConfigurationError
			? error.message
			: `Billing verification failed. Check the required environment values and Stripe price/webhook configuration against OPERATIONS.md.`,
	)
	process.exitCode = 1
}
