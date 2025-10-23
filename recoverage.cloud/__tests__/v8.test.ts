import { createCoverageMap } from "istanbul-lib-coverage"

import { v8CoverageMapType } from "../src/reporter.ts"
import { v8ReportFixture } from "./report-fixture.ts"

test(`validate schema`, () => {
	const a = v8CoverageMapType(v8ReportFixture as any)
	console.log(a)
})
