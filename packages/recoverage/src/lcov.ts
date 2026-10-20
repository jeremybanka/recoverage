import path from "node:path"

import type { FileCoverageData } from "istanbul-lib-coverage"

// Recoverage compares statement percentages. One statement per executable LCOV
// line preserves LCOV's line coverage without inventing branch/function data.
export function lineCoverage(
	lcov: string,
	directory: string,
): Record<string, FileCoverageData> {
	const coverage = new Map<string, FileCoverageData>()
	let file: FileCoverageData | undefined
	for (const line of lcov.split(/\r?\n/)) {
		if (line.startsWith(`SF:`)) {
			const source = line.slice(3)
			if (file || !source.trim())
				throw new Error(`Invalid LCOV source record: ${line}`)
			const filename = path
				.relative(directory, path.resolve(directory, source))
				.split(path.sep)
				.join(`/`)
			file = coverage.get(filename) ?? {
				path: filename,
				statementMap: {},
				s: {},
				fnMap: {},
				f: {},
				branchMap: {},
				b: {},
			}
			coverage.set(filename, file)
		} else if (line === `end_of_record`) {
			if (!file) throw new Error(`Unexpected LCOV end_of_record`)
			file = undefined
		} else if (line.startsWith(`DA:`)) {
			const match = /^DA:(\d+),(\d+)(?:,[^,]+)?$/.exec(line)
			const number = Number(match?.[1])
			const hits = Number(match?.[2])
			if (
				!file ||
				!Number.isSafeInteger(number) ||
				number < 1 ||
				!Number.isSafeInteger(hits) ||
				hits < 0
			) {
				throw new Error(`Invalid LCOV line: ${line}`)
			}
			const id = String(number)
			const total = (file.s[id] ?? 0) + hits
			if (!Number.isSafeInteger(total))
				throw new Error(`Invalid LCOV hit total: ${line}`)
			file.statementMap[id] = {
				start: { line: number, column: 0 },
				end: { line: number, column: 1 },
			}
			file.s[id] = total
		}
	}
	if (file) throw new Error(`LCOV source record is missing end_of_record`)
	const executable = [...coverage].filter(
		([, data]) => Object.keys(data.s).length > 0,
	)
	if (executable.length === 0)
		throw new Error(`Coverage report contains no executable lines`)
	return Object.fromEntries(executable)
}
