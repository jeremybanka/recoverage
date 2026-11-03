import { spawnSync } from "node:child_process"
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { createCoverageMap } from "istanbul-lib-coverage"

import {
	collectPackage,
	instrumentSources,
	normalizedCoverage,
} from "../__scripts__/coverage-tools.ts"

function fixture(name: string): string {
	return readFileSync(
		path.resolve(import.meta.dirname, `support/fixtures`, name),
		`utf8`,
	)
}

test(`source and bundled Bun processes retain identical counters, including early exits`, () => {
	const directory = mkdtempSync(
		path.join(tmpdir(), `recoverage-instrumentation-`),
	)
	try {
		const source = path.join(directory, `src`)
		const destination = path.join(directory, `instrumented`)
		const counters = path.join(directory, `counters`)
		for (const dir of [source, destination, counters]) mkdirSync(dir)
		writeFileSync(path.join(source, `entry.ts`), fixture(`entry.ts`))
		writeFileSync(path.join(source, `unimported.ts`), fixture(`unimported.ts`))
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

test(`collection includes public-only code and preserves declarations and consumer dependencies`, () => {
	const directory = mkdtempSync(path.join(tmpdir(), `recoverage-collector-`))
	const packageDirectory = path.join(directory, `packages/recoverage`)
	const original = path.resolve(import.meta.dirname, `..`)
	const write = (name: string, contents: string) => {
		const filename = path.join(packageDirectory, name)
		mkdirSync(path.dirname(filename), { recursive: true })
		writeFileSync(filename, contents)
	}
	try {
		mkdirSync(packageDirectory, { recursive: true })
		writeFileSync(path.join(directory, `package.json`), `{"type":"module"}`)
		writeFileSync(path.join(directory, `tsconfig.json`), `{}`)
		symlinkSync(
			path.resolve(original, `../../node_modules`),
			path.join(directory, `node_modules`),
			`dir`,
		)
		symlinkSync(
			path.join(original, `node_modules`),
			path.join(packageDirectory, `node_modules`),
			`dir`,
		)
		write(
			`package.json`,
			JSON.stringify({
				name: `collector-fixture`,
				type: `module`,
				scripts: {
					build: `bun build.ts`,
					"test:public-api": `bun test __tests__/public`,
				},
			}),
		)
		write(`src/recoverage.ts`, fixture(`collector-source.ts`))
		write(`src/recoverage.x.ts`, fixture(`collector-cli.ts`))
		write(`src/git-status.ts`, fixture(`collector-git.ts`))
		write(`build.ts`, fixture(`collector-build.ts`))
		write(`recoverage.d.ts`, fixture(`recoverage.d.ts`))
		write(`vitest.config.ts`, fixture(`collector-vitest.config.ts`))
		write(`__tests__/unit.test.ts`, fixture(`collector-unit.test.ts`))
		write(
			`__tests__/public/consumer/node_modules/contract-only/index.js`,
			fixture(`consumer-dependency.js`),
		)
		write(
			`__tests__/public/contract.test.ts`,
			fixture(`collector-public.test.ts`),
		)
		write(`__tests__/public/consume.ts`, fixture(`consume.ts`))
		collectPackage(packageDirectory, path.join(directory, `scratch`))
		const coverage = createCoverageMap(normalizedCoverage(packageDirectory))
		expect(
			coverage.fileCoverageFor(`src/recoverage.ts`).toSummary().statements.pct,
		).toBe(100)
		expect(
			coverage.fileCoverageFor(`src/recoverage.ts`).toSummary().branches.pct,
		).toBe(100)

		// A failing public contract must fail collection rather than produce a
		// seemingly healthy report based only on the Vitest half of the suite.
		write(
			`__tests__/public/contract.test.ts`,
			fixture(`collector-failure.test.ts`),
		)
		expect(() => {
			collectPackage(packageDirectory, path.join(directory, `failing`))
		}).toThrow(`test:public-api failed`)

		write(
			`package.json`,
			JSON.stringify({
				name: `collector-fixture`,
				type: `module`,
				scripts: { build: `bun build.ts` },
			}),
		)
		collectPackage(packageDirectory, path.join(directory, `historical`))
		const historical = createCoverageMap(normalizedCoverage(packageDirectory))
		expect(
			historical.fileCoverageFor(`src/recoverage.ts`).toSummary().branches.pct,
		).toBe(50)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}, 30_000)
