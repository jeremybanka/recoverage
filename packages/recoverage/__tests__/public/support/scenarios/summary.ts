import assert from "node:assert/strict"

import { createCoverageMap } from "istanbul-lib-coverage"
import { getCoverageJsonSummary, getCoverageTextReport } from "recoverage/lib"

const map = createCoverageMap(
	await Bun.file(`coverage/coverage-final.json`).json(),
)
const summary = getCoverageJsonSummary(map)
assert.equal(summary.total.statements.total, 2)
assert.equal(summary.total.statements.covered, 1)
assert.equal(summary.total.statements.pct, 50)
assert.ok(getCoverageTextReport(map).trim().length > 0)
