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
		write(
			`src/recoverage.ts`,
			`export function value(publicCall: boolean): string {
  if (publicCall) return "public";
  return "unit";
}`,
		)
		write(`src/recoverage.x.ts`, `export const cli = true;`)
		write(`src/git-status.ts`, `export const git = true;`)
		write(
			`build.ts`,
			`
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
const result = await Bun.build({ entrypoints: ["src/recoverage.ts"], outdir: "dist", target: "bun" });
if (!result.success) throw new Error("build failed");
// Model a clean runtime build that cannot emit declarations after instrumentation.
if (!readFileSync("src/recoverage.ts", "utf8").includes("__recoverageFs")) {
  writeFileSync("dist/recoverage.d.ts", "export declare function value(publicCall: boolean): string;");
}
`,
		)
		write(
			`vitest.config.ts`,
			`export default { test: { include: ["__tests__/unit.test.ts"] } };`,
		)
		write(
			`__tests__/unit.test.ts`,
			`
import { expect, test } from "vitest";
import { value } from "../src/recoverage.ts";
import { cli } from "../src/recoverage.x.ts";
import { git } from "../src/git-status.ts";
test("unit path", () => { expect(value(false)).toBe("unit"); expect(cli && git).toBe(true); });
`,
		)
		write(
			`__tests__/public/consumer/node_modules/contract-only/index.js`,
			`export const marker = "consumer dependency";`,
		)
		write(
			`__tests__/public/contract.test.ts`,
			`
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { marker } from "./consumer/node_modules/contract-only/index.js";
test("public path", () => {
  const result = spawnSync("bun", ["--eval", 'import { value } from "./dist/recoverage.js"; console.log(value(true));'], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("public");
  expect(readFileSync("dist/recoverage.d.ts", "utf8")).toContain("export declare function value");
  expect(marker).toBe("consumer dependency");
});
`,
		)
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
			`import { test } from "bun:test"; test("failure", () => { throw new Error("public contract failed"); });`,
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
