import { afterEach, expect, test, vi } from "vitest"

import { downloadCoverageReportFromCloud } from "../src/persist-cloud.ts"

afterEach(() => {
	vi.unstubAllGlobals()
})

test(`encodes report names as a single URL segment`, async () => {
	let requestedUrl = ``
	const fetch = vi.fn(async (url: URL | string) => {
		requestedUrl = String(url)
		const response = new Response(`{}`, { status: 200 })
		return Promise.resolve(response)
	})
	vi.stubGlobal(`fetch`, fetch)

	await downloadCoverageReportFromCloud(
		`@scope/package`,
		`token`,
		`https://example.com`,
	)

	expect(requestedUrl).toBe(`https://example.com/reporter/%40scope%2Fpackage`)
})
