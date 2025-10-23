import { createCoverageMap } from "istanbul-lib-coverage"

import { v8ReportFixture } from "../../../recoverage.cloud/__tests__/report-fixture.ts"
import { getCoverageTextReport } from "../src/istanbul-reports.ts"

test(`verify that vitest's v4 format is still supported by the istanbul reporter`, () => {
	const hi = createCoverageMap(v8ReportFixture as any)
	const report = getCoverageTextReport(hi)
	// console.log(report)
	expect(report).toBeDefined()
})
