#!/usr/bin/env bun

import { readFileSync } from "node:fs"

import { storagePreviewOrigin } from "./storage-preview"

// Require the reviewed, generated nonsecret config before any network request.
const readConfig = (name: string) =>
	JSON.parse(
		readFileSync(new URL(`../${name}`, import.meta.url), `utf8`).replace(
			/^\s*\/\/.*$/gm,
			``,
		),
	)
const origin = storagePreviewOrigin(
	process.env[`BILLING_WORKER_URL`] ?? ``,
	readConfig(`wrangler-billing-preview.jsonc`),
	readConfig(`wrangler.jsonc`),
)
const token = process.env[`PREVIEW_REPORTER_TOKEN`]
if (
	process.env[`STRIPE_MODE`] !== `test` ||
	origin.protocol !== `https:` ||
	origin.hostname === `recoverage.cloud` ||
	origin.username ||
	origin.password ||
	!token
) {
	throw new Error(
		`Set a test preview HTTPS origin and PREVIEW_REPORTER_TOKEN for a disposable project.`,
	)
}
const ref = `storage-probe-${Date.now()}`
const url = new URL(`/reporter/${ref}`, origin)
const headers = {
	Authorization: `Bearer ${token}`,
	"Content-Type": `application/json`,
}
const metric = { total: 0, covered: 0, skipped: 0, pct: 100 }
const jsonSummary = {
	total: {
		lines: metric,
		statements: metric,
		functions: metric,
		branches: metric,
	},
}
const initial = await fetch(url, {
	method: `PUT`,
	headers,
	body: JSON.stringify({ mapData: {}, jsonSummary }),
})
if (!initial.ok)
	throw new Error(`Preview baseline upload failed: ${initial.status}`)
// A bounded 2.1 MB valid report, below the ingress guard but above D1's limit.
const mapData = {
	file: {
		path: `x`.repeat(2_100_000),
		statementMap: {},
		fnMap: {},
		branchMap: {},
		s: {},
		f: {},
		b: {},
	},
}
const rejected = await fetch(url, {
	method: `PUT`,
	headers,
	body: JSON.stringify({ mapData, jsonSummary }),
})
const result = (await rejected.json()) as { code?: string }
if (rejected.status !== 413 || result.code !== `REPORT_TOO_LARGE`)
	throw new Error(
		`Hosted D1 size verification failed: HTTP ${rejected.status}. Inspect the error shape in the isolated environment.`,
	)
const retained = await fetch(url, { headers })
if (!retained.ok || JSON.stringify(await retained.json()) !== `{}`)
	throw new Error(`Rejected replacement did not preserve the original report.`)
console.info(
	`Hosted size rejection and replacement preservation verified. Delete the disposable preview project when finished. Report ref: ${ref}`,
)
