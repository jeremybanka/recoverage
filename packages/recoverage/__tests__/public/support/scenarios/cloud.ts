import assert from "node:assert/strict"

import { createCoverageMap } from "istanbul-lib-coverage"
import {
	downloadCoverageReportFromCloud,
	getCoverageJsonSummary,
	uploadCoverageReportToCloud,
} from "recoverage/lib"

const map = createCoverageMap(
	await Bun.file(`coverage/coverage-final.json`).json(),
)
const summary = getCoverageJsonSummary(map)
let status = 200
const server = Bun.serve({
	hostname: `127.0.0.1`,
	port: 0,
	fetch() {
		return new Response(`coverage contents`, { status })
	},
})
try {
	assert.equal(
		await downloadCoverageReportFromCloud(`example`, `token`, server.url.href),
		`coverage contents`,
	)
	const uploaded = await uploadCoverageReportToCloud(
		`example`,
		map,
		summary,
		`token`,
		server.url.href,
	)
	assert(!(uploaded instanceof Error))
	assert.equal(uploaded.success, true)
	status = 503
	assert(
		(await downloadCoverageReportFromCloud(
			`example`,
			`token`,
			server.url.href,
		)) instanceof Error,
	)
	assert(
		(await uploadCoverageReportToCloud(
			`example`,
			map,
			summary,
			`token`,
			server.url.href,
		)) instanceof Error,
	)
} finally {
	await server.stop(true)
}
