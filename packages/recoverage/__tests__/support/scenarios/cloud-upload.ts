import assert from "node:assert/strict"

import { refs, report } from "./report.ts"

const requests: {
	method: string
	path: string
	authorization?: string | null
	body?: string
}[] = []
const status = 200
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
const { capture } = await import(`../../../src/recoverage.ts`)
await Bun.write(`coverage/coverage-final.json`, JSON.stringify(report([1, 1])))
try {
	assert.equal(await capture({ silent: true }), 0)
	assert.equal(requests.length, 1)
	assert.equal(requests[0].method, `PUT`)
	assert.equal(requests[0].path, `/reporter/` + process.cwd().split(`/`).at(-1))
	assert.equal(requests[0].authorization, `Bearer test-token`)
	assert.equal(typeof requests[0].body, `string`)
	const body = JSON.parse(requests[0].body ?? ``)
	assert.deepEqual(body.mapData, report([1, 1]))
	assert.equal(body.jsonSummary.total.statements.pct, 100)
	refs.current = `feature`
	assert.equal(await capture({ silent: true }), 0)
	assert.equal(requests.length, 1, `feature captures must stay local`)
} finally {
	await server.stop(true)
}
