import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const coverageModule = path.resolve(import.meta.dirname, `../src/recoverage.ts`)
const gitModule = path.resolve(import.meta.dirname, `../src/git-status.ts`)
let directory: string
let preload: string

beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), `recoverage-capture-`))
	mkdirSync(path.join(directory, `coverage`))
	preload = path.join(directory, `git.ts`)
	writeFileSync(
		preload,
		`import { mock } from "bun:test";
mock.module(${JSON.stringify(gitModule)}, () => ({
  getCurrentGitRef: async () => process.env.RECOVERAGE_TEST_REF ?? "base",
  getBaseGitRef: async () => "base",
}));
`,
	)
})

afterEach(() => {
	rmSync(directory, { recursive: true, force: true })
})

function evaluate(script: string): void {
	const result = spawnSync(
		`bun`,
		[
			`--preload`,
			preload,
			`--eval`,
			`import assert from "node:assert/strict";
import { capture, diff } from ${JSON.stringify(coverageModule)};
${script}`,
		],
		{
			cwd: directory,
			encoding: `utf8`,
			timeout: 10_000,
			env: {
				...process.env,
				RECOVERAGE_TEST_REF: `base`,
				RECOVERAGE_CLOUD_TOKEN: ``,
				S3_ACCESS_KEY_ID: ``,
				S3_SECRET_ACCESS_KEY: ``,
			},
		},
	)
	expect(result.error).toBeUndefined()
	expect(result.status, result.stderr).toBe(0)
}

function lcov(hits: readonly [number, number]): string {
	return `SF:lib/example.js\nDA:1,${hits[0]},checksum\nDA:2,${hits[1]}\nend_of_record\n`
}

describe(`capture report selection`, () => {
	for (const [label, before, after, expected] of [
		[`unchanged`, [1, 0], [1, 0], 0],
		[`increased`, [1, 0], [1, 1], 0],
		[`decreased`, [1, 1], [1, 0], 1],
	] as const) {
		it(`captures and compares ${label} LCOV coverage through Bun`, () => {
			writeFileSync(path.join(directory, `coverage/lcov.info`), lcov(before))
			evaluate(`
assert.equal(await capture({ silent: true }), 0);
process.env.RECOVERAGE_TEST_REF = "feature";
await Bun.write("coverage/lcov.info", ${JSON.stringify(lcov(after))});
assert.equal(await capture({ silent: true }), 0);
assert.equal(await diff("main", true), ${expected});
`)
		})
	}

	it(`rejects invalid JSON without falling back to a valid LCOV report`, () => {
		writeFileSync(
			path.join(directory, `coverage/coverage-final.json`),
			`{invalid`,
		)
		writeFileSync(path.join(directory, `coverage/lcov.info`), lcov([1, 1]))
		evaluate(`
await assert.rejects(capture({ silent: true }), SyntaxError);
assert.equal(await Bun.file("coverage.sqlite").exists(), false);
`)
	})

	it.each([``, `SF:example.ts\nDA:1,\nend_of_record`])(
		`rejects empty or malformed LCOV before saving: %s`,
		(report) => {
			writeFileSync(path.join(directory, `coverage/lcov.info`), report)
			evaluate(`
await assert.rejects(capture({ silent: true }));
assert.equal(await Bun.file("coverage.sqlite").exists(), false);
`)
		},
	)
})
