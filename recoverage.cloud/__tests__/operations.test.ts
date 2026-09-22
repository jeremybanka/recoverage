import { env } from "cloudflare:test"
import type Stripe from "stripe"

import app from "../src"
import {
	billingModeMatches,
	checkoutEnabled,
	verifySupporterPrice,
} from "../src/billing-config"
import { redactWebhookPayloads } from "../src/maintenance"

const config = {
	STRIPE_MODE: `test` as const,
	STRIPE_SECRET_KEY: `sk_test_placeholder`,
	STRIPE_WEBHOOK_SECRET: `whsec_placeholder`,
	STRIPE_SUPPORTER_PRICE_ID: `price_supporter`,
	STRIPE_PORTAL_CONFIGURATION_ID: `bpc_test`,
	BILLING_SUPPORT_EMAIL: `billing@example.test`,
	BILLING_REFUND_POLICY: `Contact billing support to request a refund.`,
	CHECKOUT_ENABLED: `true`,
}

test(`checkout requires explicit enablement and complete consistent configuration`, async () => {
	expect(checkoutEnabled(config)).toBe(true)
	for (const name of Object.keys(config)) {
		expect(checkoutEnabled({ ...config, [name]: undefined })).toBe(false)
	}
	expect(
		billingModeMatches({ ...config, STRIPE_SECRET_KEY: `sk_live_placeholder` }),
	).toBe(false)
	const response = await app.request(
		`/billing/checkout`,
		{ method: `POST` },
		{ ...env, ...config, CHECKOUT_ENABLED: `false` },
	)
	expect(response.status).toBe(503)
	expect(await response.text()).not.toContain(`STRIPE_SECRET_KEY`)
})

test(`price validation rejects the wrong environment, amount, currency, or recurrence`, () => {
	const price = {
		livemode: false,
		active: true,
		currency: `usd`,
		unit_amount: 100,
		type: `recurring`,
		billing_scheme: `per_unit`,
		recurring: { interval: `month`, interval_count: 1, usage_type: `licensed` },
	} as Stripe.Price
	expect(() => {
		verifySupporterPrice(price, `test`)
	}).not.toThrow()
	for (const invalid of [
		{ livemode: true },
		{ active: false },
		{ currency: `eur` },
		{ unit_amount: 1000 },
		{ type: `one_time` },
		{ billing_scheme: `tiered` },
		{ recurring: null },
		{ recurring: { ...price.recurring, interval: `year` } },
		{ recurring: { ...price.recurring, interval_count: 2 } },
		{ recurring: { ...price.recurring, usage_type: `metered` } },
	]) {
		expect(() => {
			verifySupporterPrice({ ...price, ...invalid } as Stripe.Price, `test`)
		}).toThrow()
	}
})

test(`retention removes old payloads while preserving event IDs, outcomes, and retry records`, async () => {
	for (const [id, age, processed] of [
		[`processed-old`, 31, true],
		[`processed-new`, 1, true],
		[`failed-old`, 91, false],
		[`failed-recent`, 31, false],
	] as const) {
		await env.DB.prepare(`INSERT INTO stripeWebhookEvents (stripeEventId, type, mode, receivedAt, processedAt, payload, processingError)
			VALUES (?, 'invoice.paid', 'test', datetime('now', ?), ?, '{"private":"customer data"}', ?)`)
			.bind(
				id,
				`-${age} days`,
				processed ? `2026-01-01 00:00:00` : null,
				processed ? null : `Retry needed`,
			)
			.run()
	}
	expect(await redactWebhookPayloads(env.DB)).toBe(2)
	const rows = await env.DB.prepare(
		`SELECT stripeEventId, payload, processedAt, processingError FROM stripeWebhookEvents`,
	).all<{
		stripeEventId: string
		payload: string
		processedAt: string | null
		processingError: string | null
	}>()
	expect(rows.results).toHaveLength(4)
	for (const row of rows.results) {
		expect(row.payload === `{}`).toBe(row.stripeEventId.endsWith(`old`))
		if (row.stripeEventId.startsWith(`failed`)) {
			expect(row.processedAt).toBeNull()
			expect(row.processingError).toBe(`Retry needed`)
		}
	}
	expect(await redactWebhookPayloads(env.DB)).toBe(0)
})
