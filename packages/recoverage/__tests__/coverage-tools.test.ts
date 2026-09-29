import { spawnSync } from "node:child_process"
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { createCoverageMap } from "istanbul-lib-coverage"

import {
	instrumentSources,
	normalizedCoverage,
} from "../__scripts__/coverage-tools.ts"

test(`source and bundled Bun processes retain identical counters, including early exits`, () => {
	const directory = mkdtempSync(
		path.join(tmpdir(), `recoverage-instrumentation-`),
	)
	try {
		const source = path.join(directory, `src`)
		const destination = path.join(directory, `instrumented`)
		const counters = path.join(directory, `counters`)
		for (const dir of [source, destination, counters]) mkdirSync(dir)
		writeFileSync(
			path.join(source, `entry.ts`),
			`#!/usr/bin/env bun
export function choose(value: boolean): string {
  if (value) return "yes"
  return "no"
}
console.log(choose(process.argv.includes("yes")))
process.exit(0)
`,
		)
		writeFileSync(
			path.join(source, `unimported.ts`),
			`export const unused = () => 42\n`,
		)
		const merged = createCoverageMap(instrumentSources(source, destination))
		const entry = path.join(destination, `entry.ts`)
		const bundle = path.join(directory, `bundle.js`)
		const build = spawnSync(
			`bun`,
			[`build`, entry, `--target=bun`, `--outfile`, bundle],
			{ encoding: `utf8` },
		)
		expect(build.status, build.stderr).toBe(0)
		for (const args of [[entry, `yes`], [bundle]]) {
			const result = spawnSync(`bun`, args, {
				encoding: `utf8`,
				env: { ...process.env, RECOVERAGE_COUNTERS: counters },
			})
			expect(result.status, result.stderr).toBe(0)
		}
		const files = readdirSync(counters)
		expect(files).toHaveLength(2)
		const maps = files.map((name) =>
			JSON.parse(readFileSync(path.join(counters, name), `utf8`)),
		)
		const filename = path.join(source, `entry.ts`)
		expect(maps[0][filename].statementMap).toEqual(
			maps[1][filename].statementMap,
		)
		for (const map of maps) merged.merge(map)
		expect(merged.fileCoverageFor(filename).toSummary().statements.pct).toBe(100)
		expect(
			merged.fileCoverageFor(path.join(source, `unimported.ts`)).toSummary()
				.statements.pct,
		).toBe(0)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test(`coverage normalization rejects missing and empty baselines`, () => {
	const directory = mkdtempSync(path.join(tmpdir(), `recoverage-report-`))
	try {
		expect(() => normalizedCoverage(directory)).toThrow()
		mkdirSync(path.join(directory, `coverage`))
		writeFileSync(path.join(directory, `coverage/coverage-final.json`), `{}`)
		expect(() => normalizedCoverage(directory)).toThrow(`Empty coverage report`)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})
