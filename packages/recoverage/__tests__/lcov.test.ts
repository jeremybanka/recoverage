import { createCoverageMap } from "istanbul-lib-coverage"
import { describe, expect, it } from "vitest"

import { getCoverageJsonSummary } from "../src/istanbul-reports.ts"
import { lineCoverage } from "../src/lcov.ts"

const lcov = [
	`SF:src/example.ts`,
	`DA:1,3`,
	`DA:2,0`,
	`end_of_record`,
	`SF:__tests__/helper.ts`,
	`DA:1,1`,
	`end_of_record`,
	`SF:../../../../../tmp/fixture/breakage.config.ts`,
	`DA:1,1`,
	`end_of_record`,
].join(`\n`)

describe(`LCOV line coverage adapter`, () => {
	it(`preserves hit and missed lines for every reported source file`, () => {
		const coverage = lineCoverage(lcov, `/checkout/packages/breakage`)
		expect(Object.keys(coverage)).toEqual([
			`src/example.ts`,
			`__tests__/helper.ts`,
			`../../../tmp/fixture/breakage.config.ts`,
		])
		expect(coverage[`src/example.ts`]?.s).toEqual({ 1: 3, 2: 0 })
		expect(coverage[`src/example.ts`]?.statementMap[`2`]).toEqual({
			start: { line: 2, column: 0 },
			end: { line: 2, column: 1 },
		})
	})

	it(`uses the same paths for absolute filenames in different checkouts`, () => {
		const first = lineCoverage(
			lcov.replace(`SF:src/`, `SF:/first/src/`),
			`/first`,
		)
		const second = lineCoverage(
			lcov.replace(`SF:src/`, `SF:/second/src/`),
			`/second`,
		)
		expect(first).toEqual(second)
	})

	it.each([``, `TN:empty`, `SF:src/empty.ts\nend_of_record`])(
		`rejects reports with no executable source lines: %s`,
		(input) => {
			expect(() => lineCoverage(input, `/checkout`)).toThrow(
				`no executable lines`,
			)
		},
	)

	it.each([
		`DA:0,1`,
		`DA:1,-1`,
		`DA:1,NaN`,
		`DA:1`,
		`DA:1.5,1`,
		`DA:1,`,
		`DA:,1`,
		`DA:1,1e2`,
		`DA:1,9007199254740992`,
		`DA:9007199254740992,1`,
	])(`rejects malformed counters: %s`, (input) => {
		expect(() =>
			lineCoverage(`SF:src/example.ts\n${input}\nend_of_record`, `/checkout`),
		).toThrow(`Invalid LCOV line`)
	})

	it(`merges test records and duplicate lines before calculating coverage`, () => {
		const coverage = lineCoverage(
			[
				`TN:first`,
				`SF:lib/example.js`,
				`DA:1,2,checksum`,
				`DA:2,0`,
				`end_of_record`,
				`TN:second`,
				`SF:/checkout/lib/example.js`,
				`DA:1,0`,
				`DA:2,3`,
				`DA:2,1`,
				`DA:3,0`,
				`end_of_record`,
			].join(`\r\n`),
			`/checkout`,
		)
		expect(coverage[`lib/example.js`]?.s).toEqual({ 1: 2, 2: 4, 3: 0 })
		const summary = getCoverageJsonSummary(createCoverageMap(coverage))
		expect(summary.total.statements).toMatchObject({ total: 3, covered: 2 })
		expect(summary.total.lines).toEqual(summary.total.statements)
		expect(summary.total.functions.total).toBe(0)
		expect(summary.total.branches.total).toBe(0)
	})

	it(`includes entirely uncovered files and ignores function/branch metadata`, () => {
		const coverage = lineCoverage(
			`SF:app/end_of_record.tsx\nFN:1,render\nFNDA:0,render\nBRDA:1,0,0,-\nDA:1,0\nDA:2,0\nLF:2\nLH:0\nend_of_record\n`,
			`/checkout`,
		)
		const summary = getCoverageJsonSummary(createCoverageMap(coverage))
		expect(summary.total.statements).toMatchObject({
			total: 2,
			covered: 0,
			pct: 0,
		})
	})

	it.each([
		`DA:1,1\nend_of_record`,
		`SF:\nDA:1,1\nend_of_record`,
		`SF:example.ts\nDA:1,1`,
		`SF:example.ts\nDA:1,1\nSF:other.ts\nDA:1,0\nend_of_record`,
		`end_of_record`,
		`SF:example.ts\nDA:1,9007199254740991\nDA:1,1\nend_of_record`,
	])(`rejects malformed source records or overflowing counts: %s`, (input) => {
		expect(() => lineCoverage(input, `/checkout`)).toThrow()
	})
})
