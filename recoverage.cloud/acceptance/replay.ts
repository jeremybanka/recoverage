import { createHash } from "node:crypto"
import path from "node:path"

import { Squirrel } from "varmint"

export type RecordedRequest = {
	provider: `github` | `stripe`
	method: string
	path: string
	query: [string, string][]
	body: [string, string][]
	credentialCase: `accepted` | `rejected`
}
export type RecordedResponse = {
	status: number
	body: unknown
}

export const fixtureRoot = path.join(import.meta.dirname, `.varmint`)
// Ordinary tests and CI are always offline. Recording is a separate command.
export const VARMINT_MODE = `read` as const

export function fixtureKey(input: RecordedRequest): string {
	return `${input.provider}-${input.method.toLowerCase()}-${createHash(`sha256`)
		.update(JSON.stringify(input))
		.digest(`hex`)
		.slice(0, 20)}`
}

export function recordedRequest(
	url: URL,
	method: string,
	body = ``,
	credentialCase: RecordedRequest[`credentialCase`] = `accepted`,
): RecordedRequest {
	if (![`api.github.com`, `api.stripe.com`].includes(url.hostname))
		throw new Error(`Unrecorded external host; outbound network is disabled.`)
	const sorted = (values: URLSearchParams) =>
		[...values.entries()]
			.map(([key, value]): [string, string] => [
				key.replace(/^expand\[\d+\]$/, `expand[]`),
				value,
			])
			.sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
	return {
		provider: url.hostname === `api.github.com` ? `github` : `stripe`,
		method,
		path: url.pathname,
		query: sorted(url.searchParams),
		body: sorted(new URLSearchParams(body)),
		credentialCase,
	}
}

const recordings = new Squirrel(VARMINT_MODE, fixtureRoot).add(
	`provider-http`,
	(_input: RecordedRequest): Promise<RecordedResponse> => {
		throw new Error(`Live recording is forbidden in the test runner.`)
	},
)

export async function replayProvider(request: Request): Promise<Response> {
	const credentialCase = request.headers
		.get(`authorization`)
		?.includes(`replay-rejected`)
		? `rejected`
		: `accepted`
	// Replay is limited to public, local test placeholders. Never accept an
	// account credential in this transport or record an authorization header.
	const auth = request.headers.get(`authorization`) ?? ``
	if (
		![
			`Bearer sk_test_replay`,
			`Bearer sk_test_replay-rejected`,
			`token replay-accepted`,
			`token replay-rejected`,
		].includes(auth)
	)
		throw new Error(`Only local replay credentials are allowed.`)
	const input = recordedRequest(
		new URL(request.url),
		request.method,
		await request.text(),
		credentialCase,
	)
	if (
		input.provider === `stripe` &&
		input.method === `POST` &&
		input.path === `/v1/checkout/sessions`
	) {
		const attempt = new URLSearchParams(input.body).get(
			`metadata[recoverageAttemptId]`,
		)
		if (
			request.headers.get(`idempotency-key`) !== `recoverage-checkout-${attempt}`
		)
			throw new Error(
				`Checkout replay requires the durable attempt idempotency key.`,
			)
	}
	const output = await recordings.for(fixtureKey(input)).get(input)
	return Response.json(output.body, { status: output.status })
}
