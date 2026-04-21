import { ArkErrors } from "arktype"
import { v8ReportFixture } from "recoverage-fixtures"

import { v8CoverageMapType } from "../src/reporter.ts"

test(`validate schema`, () => {
	const a = v8CoverageMapType(v8ReportFixture)
	expect(a).not.toBeInstanceOf(ArkErrors)
})
