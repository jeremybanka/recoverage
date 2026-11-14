import assert from "node:assert/strict"

import { createCoverageMap } from "istanbul-lib-coverage"

import { getCoverageJsonSummary } from "../../../src/recoverage.lib.ts"

const {
	downloadCoverageReportFromCloud: download,
	uploadCoverageReportToCloud: upload,
} = await import(`../../../src/persist-cloud.ts`)
const networkError = new Error(`connection refused`)
let failure: unknown = networkError
globalThis.fetch = Object.assign(() => Promise.reject(failure), {
	preconnect: fetch.preconnect,
})
assert.equal(await download(`example`, `token`), networkError)
assert.equal(
	await upload(
		`example`,
		createCoverageMap({}),
		getCoverageJsonSummary(createCoverageMap({})),
		`token`,
	),
	networkError,
)
failure = `unexpected rejection`
await assert.rejects(download(`example`, `token`), (error) => error === failure)
await assert.rejects(
	upload(
		`example`,
		createCoverageMap({}),
		getCoverageJsonSummary(createCoverageMap({})),
		`token`,
	),
	(error) => error === failure,
)
