import { spawnSync } from "node:child_process"
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "bun:test"

const source = path.resolve(import.meta.dirname, `../..`)
let directory: string

function invoke(command: string, args: string[]) {
	const result = spawnSync(command, args, {
		cwd: directory,
		encoding: `utf8`,
		timeout: 20_000,
		env: {
			...process.env,
			CI: `false`,
			RECOVERAGE_CLOUD_TOKEN: ``,
			S3_ACCESS_KEY_ID: ``,
			S3_SECRET_ACCESS_KEY: ``,
			NO_COLOR: `1`,
		},
	})
	expect(result.error).toBeUndefined()
	return result
}

function git(...args: string[]) {
	const result = invoke(`git`, args)
	expect(result.status, result.stderr).toBe(0)
}

function evaluate(script: string) {
	const result = invoke(`bun`, [`--eval`, script])
	expect(result.status, result.stderr).toBe(0)
	return result.stdout
}

function coverage(hits: number[]) {
	const file = path.join(directory, `example.ts`)
	writeFileSync(
		path.join(directory, `coverage/coverage-final.json`),
		JSON.stringify({
			[file]: {
				path: file,
				statementMap: {
					0: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
					1: { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } },
				},
				s: { 0: hits[0], 1: hits[1] },
				fnMap: {},
				f: {},
				branchMap: {},
				b: {},
			},
		}),
	)
}

beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), `recoverage-contract-`))
	const installed = path.join(directory, `node_modules/recoverage`)
	mkdirSync(installed, { recursive: true })
	for (const file of [`package.json`, `bin`, `dist`]) {
		cpSync(path.join(source, file), path.join(installed, file), {
			recursive: true,
		})
	}
	symlinkSync(
		path.join(source, `node_modules`),
		path.join(installed, `node_modules`),
	)
	writeFileSync(
		path.join(directory, `package.json`),
		JSON.stringify({ type: `module` }),
	)
	writeFileSync(
		path.join(directory, `.gitignore`),
		`node_modules/\ncoverage/\ncoverage.sqlite*\n`,
	)
	writeFileSync(
		path.join(directory, `example.ts`),
		`export const one = 1\nexport const two = 2\n`,
	)
	mkdirSync(path.join(directory, `coverage`))
	git(`init`, `--initial-branch=trunk`)
	git(`config`, `user.name`, `Recoverage contract`)
	git(`config`, `user.email`, `contract@example.com`)
	git(`add`, `.`)
	git(`commit`, `-m`, `baseline`)
})

afterEach(() => {
	rmSync(directory, { recursive: true, force: true })
})

describe(`published package contracts`, () => {
	for (const [label, before, after, expected] of [
		[`unchanged coverage`, [1, 0], [1, 0], 0],
		[`increased coverage`, [1, 0], [1, 1], 0],
		[`decreased coverage`, [1, 1], [1, 0], 1],
	] as const) {
		it(`capture/diff preserves return codes for ${label}`, () => {
			coverage([...before])
			expect(
				evaluate(
					`import { capture } from 'recoverage'; console.log(await capture({ defaultBranch: 'trunk', silent: true }))`,
				).trim(),
			).toBe(`0`)
			git(`checkout`, `-b`, `feature`)
			git(`commit`, `--allow-empty`, `-m`, `feature`)
			coverage([...after])
			expect(
				evaluate(
					`import { capture } from 'recoverage'; console.log(await capture({ defaultBranch: 'trunk', silent: true }))`,
				).trim(),
			).toBe(`0`)
			expect(
				evaluate(
					`import { diff } from 'recoverage'; console.log('RESULT', await diff('trunk', true))`,
				),
			).toContain(`RESULT ${expected}`)
		})
	}

	it(`fails when no baseline coverage has been captured`, () => {
		coverage([1, 1])
		git(`checkout`, `-b`, `feature`)
		git(`commit`, `--allow-empty`, `-m`, `feature`)
		evaluate(
			`import { capture } from 'recoverage'; await capture({ defaultBranch: 'trunk', silent: true })`,
		)
		expect(
			evaluate(
				`import { diff } from 'recoverage'; console.log(await diff('trunk', true))`,
			).trim(),
		).toBe(`1`)
	})

	it(`runs the shipped CLI with configuration and propagates a coverage regression`, () => {
		writeFileSync(
			path.join(directory, `recoverage.config.json`),
			JSON.stringify({ defaultBranch: `trunk` }),
		)
		git(`add`, `recoverage.config.json`)
		git(`commit`, `-m`, `configure default branch`)
		coverage([1, 1])
		const binary = `node_modules/recoverage/bin/recoverage.bin.js`
		const baseline = invoke(`bun`, [binary])
		expect(baseline.status, baseline.stderr).toBe(0)
		git(`checkout`, `-b`, `feature`)
		git(`commit`, `--allow-empty`, `-m`, `feature`)
		coverage([1, 0])
		const capture = invoke(`bun`, [binary, `capture`, `--default-branch=trunk`])
		expect(capture.status, capture.stderr).toBe(0)
		expect(invoke(`bun`, [binary, `diff`, `-b`, `trunk`]).status).toBe(1)
	})

	it(`exposes report generation through the lib subpath`, () => {
		coverage([1, 0])
		const output = evaluate(`
import { getCoverageJsonSummary, getCoverageTextReport } from 'recoverage/lib';
import { createCoverageMap } from './node_modules/recoverage/node_modules/istanbul-lib-coverage/index.js';
const map = createCoverageMap(await Bun.file('coverage/coverage-final.json').json());
const summary = getCoverageJsonSummary(map);
console.log(JSON.stringify(summary.total.statements));
console.log(getCoverageTextReport(map));
`)
		expect(JSON.parse(output.split(`\n`)[0])).toEqual({
			total: 2,
			covered: 1,
			skipped: 0,
			pct: 50,
		})
		expect(output).toContain(`example.ts`)
		expect(output).toContain(`50`)
	})

	it(`preserves the lib cloud request and error contracts`, () => {
		coverage([1, 0])
		const output = evaluate(`
import assert from 'node:assert/strict';
import { downloadCoverageReportFromCloud, uploadCoverageReportToCloud, getCoverageJsonSummary } from 'recoverage/lib';
import { createCoverageMap } from './node_modules/recoverage/node_modules/istanbul-lib-coverage/index.js';
const map = createCoverageMap(await Bun.file('coverage/coverage-final.json').json());
const summary = getCoverageJsonSummary(map);
const requests = [];
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  requests.push({ method: request.method, path: new URL(request.url).pathname, authorization: request.headers.get('Authorization'), body: request.method === 'PUT' ? await request.json() : undefined });
  return new Response(requests.length > 2 ? 'unavailable' : 'coverage contents', { status: requests.length > 2 ? 503 : 200 });
} });
try {
  assert.equal(await downloadCoverageReportFromCloud('example', 'token', server.url.href), 'coverage contents');
  assert.deepEqual(await uploadCoverageReportToCloud('example', map, summary, 'token', server.url.href), { success: true });
  const error = await downloadCoverageReportFromCloud('example', 'token', server.url.href);
  assert(error instanceof Error);
  assert.match(error.message, /503.*unavailable/);
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[1].method, 'PUT');
  for (const request of requests) {
    assert.equal(request.path, '/reporter/example');
    assert.equal(request.authorization, 'Bearer token');
  }
  assert.deepEqual(requests[1].body.jsonSummary, summary);
  assert.deepEqual(Object.keys(requests[1].body.mapData), map.files());
  console.log('cloud contracts passed');
} finally { server.stop(true); }
`)
		expect(output).toContain(`cloud contracts passed`)
	})
})
