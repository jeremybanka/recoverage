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
// Observe the hosted boundary rather than assuming a provider row-size limit.
// All three candidates stay below the unchanged 4 MB request guard.
const baseline = JSON.stringify({ mapData: {}, jsonSummary })
const observations: {
	pathBytes: number
	requestBytes: number
	status: number
	code?: string
}[] = []
async function preserved() {
	const retained = await fetch(url, { headers })
	if (!retained.ok || JSON.stringify(await retained.json()) !== `{}`)
		throw new Error(`The probe baseline was not preserved.`)
}
async function restore() {
	const response = await fetch(url, { method: `PUT`, headers, body: baseline })
	if (!response.ok)
		throw new Error(
			`Probe cleanup failed: HTTP ${response.status}; restore the disposable ref before continuing.`,
		)
	await preserved()
}
try {
	for (const pathBytes of [2_100_000, 3_000_000, 3_900_000]) {
		const mapData = {
			file: {
				path: `x`.repeat(pathBytes),
				statementMap: {},
				fnMap: {},
				branchMap: {},
				s: {},
				f: {},
				b: {},
			},
		}
		const body = JSON.stringify({ mapData, jsonSummary })
		const requestBytes = new TextEncoder().encode(body).length
		if (requestBytes >= 4_000_000)
			throw new Error(`Probe exceeds its reviewed ingress budget.`)
		const response = await fetch(url, { method: `PUT`, headers, body })
		const result = (await response.json()) as { code?: string }
		observations.push({
			pathBytes,
			requestBytes,
			status: response.status,
			...(result.code ? { code: result.code } : {}),
		})
		if (response.status === 413 && result.code === `REPORT_TOO_LARGE`) {
			await preserved()
			break
		}
		if (!response.ok)
			throw new Error(`Unexpected probe response: HTTP ${response.status}`)
		const stored = await fetch(url, { headers })
		if (
			!stored.ok ||
			JSON.stringify(await stored.json()) !== JSON.stringify(mapData)
		)
			throw new Error(`Accepted report did not round-trip correctly.`)
		await restore()
	}
	const ingress = await fetch(url, {
		method: `PUT`,
		headers,
		body: ` `.repeat(4_000_001),
	})
	const ingressResult = (await ingress.json()) as { code?: string }
	if (ingress.status !== 413 || ingressResult.code !== `REQUEST_TOO_LARGE`)
		throw new Error(`Ingress limit was not enforced: HTTP ${ingress.status}`)
	await preserved()
	console.info(
		JSON.stringify({
			ref,
			observations,
			ingress: `rejected and baseline preserved`,
			storageBoundary: observations.some(
				(value) => value.code === `REPORT_TOO_LARGE`,
			)
				? `observed`
				: `not reached; accepted sizes are observations, not a storage guarantee`,
		}),
	)
} finally {
	await restore()
}
