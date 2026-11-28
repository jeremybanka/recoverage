import assert from "node:assert/strict"

import { refs, report } from "./report.ts"

const requests: {
	method: string
	path: string
	authorization?: string | null
	body?: string
}[] = []
let status = 200
const server = Bun.serve({
	hostname: `127.0.0.1`,
	port: 0,
	async fetch(request) {
		requests.push({
			method: request.method,
			path: new URL(request.url).pathname,
			authorization: request.headers.get(`authorization`),
			body: await request.text(),
		})
		return new Response(
			status === 200 ? JSON.stringify(report([1, 0])) : `unavailable`,
			{ status },
		)
	},
})
process.env[`RECOVERAGE_CLOUD_TOKEN`] = `test-token`
process.env[`RECOVERAGE_CLOUD_URL`] = server.url.href
const { capture, diff } = await import(`../../../src/recoverage.ts`)
const { initDatabase, getCoverage } = await import(`../../../src/database.ts`)
await Bun.write(`coverage/coverage-final.json`, JSON.stringify(report([1, 1])))
try {
	refs.current = `feature`
	assert.equal(await capture({ silent: true }), 0)
	status = 503
	assert.equal(await diff(`main`, true), 1)
	assert.equal(getCoverage(await initDatabase()).all(`base`).length, 0)
	status = 200
	assert.equal(await diff(`main`, true), 0)
	assert.equal(requests.length, 2)
} finally {
	await server.stop(true)
}
