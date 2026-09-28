import { createCoverageMap } from "istanbul-lib-coverage"
import type { RecoverageOptions } from "recoverage"
import { capture, diff } from "recoverage"
import {
	downloadCoverageReportFromCloud,
	getCoverageJsonSummary,
	getCoverageTextReport,
	uploadCoverageReportToCloud,
} from "recoverage/lib"

// This is compiled, not executed: ordinary consumer calls must remain valid.
// Assignability allows added options/properties without imposing exact shapes.
const options: RecoverageOptions = { defaultBranch: `trunk`, silent: true }
const captured: 0 | 1 = await capture(options)
const defaultCapture: 0 | 1 = await capture()
const compared: 0 | 1 = await diff(`trunk`, true)
const defaultDiff: 0 | 1 = await diff()
const map = createCoverageMap({})
const summary = getCoverageJsonSummary(map)
const percentage: number = summary.total.statements.pct
const report: string = getCoverageTextReport(map)
const downloaded = await downloadCoverageReportFromCloud(`project`, `token`)
if (!(downloaded instanceof Error)) {
	const contents: string = downloaded
	JSON.stringify(contents)
}
const uploaded = await uploadCoverageReportToCloud(
	`project`,
	map,
	summary,
	`token`,
)
if (!(uploaded instanceof Error)) {
	const success: boolean = uploaded.success
	JSON.stringify(success)
}
JSON.stringify({
	captured,
	defaultCapture,
	compared,
	defaultDiff,
	percentage,
	report,
})
