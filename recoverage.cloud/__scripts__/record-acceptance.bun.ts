import { readFileSync, writeFileSync } from "node:fs"

import { Squirrel } from "varmint"

import {
	fixtureKey,
	fixtureRoot,
	type RecordedRequest,
	recordedRequest,
	type RecordedResponse,
} from "../acceptance/replay"

// Import responses freshly captured through the already-authorized provider
// connectors. No credential or external-call fallback exists in ordinary tests.
if (process.env[`CI`] || process.argv.length !== 4)
	throw new Error(
		`Use the explicit recording command with sanitized Stripe and GitHub captures outside CI.`,
	)
const stripe = JSON.parse(readFileSync(process.argv[2], `utf8`))
const github = JSON.parse(readFileSync(process.argv[3], `utf8`))
const entries = new Map<string, RecordedResponse>()
const requests: RecordedRequest[] = []
function capture(url: string, response: unknown, method = `GET`, body = ``) {
	const input = recordedRequest(new URL(url), method, body)
	requests.push(input)
	entries.set(fixtureKey(input), { status: 200, body: response })
}
capture(`https://api.github.com/user`, github)
for (const subscription of [stripe.active, stripe.canceled])
	capture(
		`https://api.stripe.com/v1/subscriptions/${subscription.id}?expand[]=customer&expand[]=latest_invoice`,
		subscription,
	)
const customer = stripe.customer.id
capture(
	`https://api.stripe.com/v1/subscriptions?customer=${customer}&status=all&limit=100`,
	stripe.emptySubscriptions,
)
capture(
	`https://api.stripe.com/v1/checkout/sessions?customer=${customer}&limit=100`,
	stripe.emptySessions,
)
capture(
	`https://api.stripe.com/v1/checkout/sessions/${stripe.session.id}`,
	stripe.session,
)
capture(
	`https://api.stripe.com/v1/checkout/sessions/${stripe.session.id}/line_items?limit=2`,
	stripe.lineItems,
)
const params = stripe.checkoutParameters
const creation = new URLSearchParams({
	client_reference_id: params.client_reference_id,
	customer,
	"line_items[0][price]": params.line_items[0].price,
	"line_items[0][quantity]": String(params.line_items[0].quantity),
	"metadata[recoveragePlan]": params.metadata.recoveragePlan,
	"metadata[recoverageUserId]": params.metadata.recoverageUserId,
	"metadata[recoverageAttemptId]": params.metadata.recoverageAttemptId,
	mode: params.mode,
	"subscription_data[metadata][recoveragePlan]":
		params.subscription_data.metadata.recoveragePlan,
	"subscription_data[metadata][recoverageUserId]":
		params.subscription_data.metadata.recoverageUserId,
	success_url: params.success_url,
	cancel_url: params.cancel_url,
	expires_at: String(params.expires_at),
})
capture(
	`https://api.stripe.com/v1/checkout/sessions`,
	stripe.session,
	`POST`,
	creation.toString(),
)
// Genuine provider authentication failures: public, intentionally invalid local
// placeholders, never account keys. Only the safe response crosses the cache.
for (const url of [
	`https://api.github.com/user`,
	`https://api.stripe.com/v1/subscriptions/${stripe.active.id}?expand[]=customer&expand[]=latest_invoice`,
]) {
	const input = recordedRequest(new URL(url), `GET`, ``, `rejected`)
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer replay-rejected`,
			"User-Agent": `Recoverage acceptance recorder`,
			...(input.provider === `stripe`
				? { "Stripe-Version": `2026-04-22.dahlia` }
				: {}),
		},
	})
	if (response.status !== 401)
		throw new Error(
			`Expected provider authentication rejection; recording stopped.`,
		)
	const body = (await response.json()) as any
	// Provider request-log URLs are account-specific and unnecessary for replay.
	if (body.error) delete body.error.request_log_url
	requests.push(input)
	entries.set(fixtureKey(input), { status: response.status, body })
}
const recording = new Squirrel(`write`, fixtureRoot).add(
	`provider-http`,
	(input: RecordedRequest) => {
		const response = entries.get(fixtureKey(input))
		if (!response) throw new Error(`Missing captured provider response`)
		return Promise.resolve(response)
	},
)
for (const input of requests) await recording.for(fixtureKey(input)).get(input)
writeFileSync(
	new URL(`../acceptance/provenance.json`, import.meta.url),
	JSON.stringify(
		{
			capturedAt: stripe.capturedAt,
			stripeSource: stripe.source,
			githubSource: `Authenticated gh api GET /user; retained id, login, avatar_url only`,
			rejectedResponses: `Live GET requests with deliberately invalid noncredential placeholders; API version 2026-04-22.dahlia for Stripe`,
			redactions: [
				`Contact/billing details and unused fields omitted`,
				`Checkout URL replaced with a nonfunctional redaction URL`,
				`Recording-only integration_identifier telemetry omitted from semantic request matching`,
			],
			responseCount: requests.length,
			checkoutRecordingExpiresAt: stripe.session.expires_at,
			fixture: {
				userId: github.id,
				customerId: customer,
				sessionId: stripe.session.id,
				attemptId: params.metadata.recoverageAttemptId,
				priceId: params.line_items[0].price,
				expiresAt: stripe.session.expires_at,
				recordedNow: stripe.session.expires_at - 3600,
				activeSubscriptionId: stripe.active.id,
				canceledSubscriptionId: stripe.canceled.id,
			},
		},
		null,
		`\t`,
	) + `\n`,
)
console.info(
	`Recorded ${requests.length} sanitized real-provider responses. No credentials were written.`,
)
