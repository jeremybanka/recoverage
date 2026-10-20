import { rmSync, writeFileSync } from "node:fs"
import path from "node:path"

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test"

import { Consumer, packCurrentPackage } from "./support/consumer.ts"

let packed: ReturnType<typeof packCurrentPackage>
let consumer: Consumer

beforeAll(() => {
	packed = packCurrentPackage()
})
beforeEach(() => {
	consumer = new Consumer(packed.directory)
})
afterEach(() => {
	consumer?.remove()
})
afterAll(() => {
	packed?.remove()
})

function capture(): void {
	consumer.evaluate(
		`import { capture } from 'recoverage'; assert.equal(await capture({ defaultBranch: 'trunk', silent: true }), 0);`,
	)
}

function branch(): void {
	consumer.git(`checkout`, `-b`, `feature`)
	consumer.git(`commit`, `--allow-empty`, `-m`, `feature`)
}

function succeeds(args: string[]): void {
	const result = consumer.cli(...args)
	expect(result.status, result.stderr).toBe(0)
}

function lcovCoverage(hits: readonly [number, number]): void {
	writeFileSync(
		path.join(consumer.directory, `coverage/lcov.info`),
		`SF:example.ts\nDA:1,${hits[0]}\nDA:2,${hits[1]}\nend_of_record\n`,
	)
}

describe(`LCOV capture and comparison`, () => {
	it(`captures LCOV produced by Bun's built-in test runner`, () => {
		writeFileSync(
			path.join(consumer.directory, `example.test.ts`),
			`import { expect, test } from 'bun:test';
import { one } from './example.ts';
test('one', () => { expect(one).toBe(1); });
`,
		)
		const result = consumer.run(`bun`, [
			`test`,
			`--coverage`,
			`--coverage-reporter=lcov`,
		])
		expect(result.status, result.stderr).toBe(0)
		succeeds([`-b`, `trunk`])
	})

	for (const [label, before, after, expected] of [
		[`unchanged`, [1, 0], [1, 0], 0],
		[`increased`, [1, 0], [1, 1], 0],
		[`decreased`, [1, 1], [1, 0], 1],
	] as const) {
		it(`compares ${label} line coverage through the installed API and CLI`, () => {
			lcovCoverage(before)
			capture()
			branch()
			lcovCoverage(after)
			const result = consumer.cli(`-b`, `trunk`)
			expect(result.status, result.stderr).toBe(expected)
			consumer.evaluate(
				`import { diff } from 'recoverage'; assert.equal(await diff('trunk', true), ${expected});`,
			)
		})
	}

	it(`prefers Istanbul JSON when both reports exist`, () => {
		consumer.coverage([1, 1])
		lcovCoverage([1, 0])
		capture()
		branch()
		lcovCoverage([0, 0])
		succeeds([`-b`, `trunk`])
	})

	it(`fails on invalid Istanbul JSON even when LCOV is valid`, () => {
		consumer.coverage([1, 1])
		capture()
		branch()
		lcovCoverage([1, 1])
		writeFileSync(
			path.join(consumer.directory, `coverage/coverage-final.json`),
			`{invalid`,
		)
		expect(consumer.cli(`capture`, `-b`, `trunk`).status).toBe(1)
		consumer.evaluate(
			`import { diff } from 'recoverage'; assert.equal(await diff('trunk', true), 1);`,
		)
	})

	for (const report of [
		``,
		`SF:example.ts\nDA:1,\nend_of_record`,
		`SF:example.ts\nDA:1,1`,
	]) {
		it(`fails before saving empty or malformed LCOV: ${JSON.stringify(report)}`, () => {
			lcovCoverage([1, 1])
			capture()
			branch()
			writeFileSync(path.join(consumer.directory, `coverage/lcov.info`), report)
			expect(consumer.cli(`capture`, `-b`, `trunk`).status).toBe(1)
			consumer.evaluate(
				`import { diff } from 'recoverage'; assert.equal(await diff('trunk', true), 1);`,
			)
		})
	}

	it(`fails when neither supported report exists`, () => {
		const result = consumer.cli(`capture`, `-b`, `trunk`)
		expect(result.status).toBe(1)
	})
})

describe(`published package contracts`, () => {
	for (const [label, before, after, expected] of [
		[`unchanged coverage`, [1, 0], [1, 0], 0],
		[`increased coverage`, [1, 0], [1, 1], 0],
		[`decreased coverage`, [1, 1], [1, 0], 1],
	] as const) {
		it(`capture/diff preserves return codes for ${label}`, () => {
			consumer.coverage(before)
			capture()
			branch()
			consumer.coverage(after)
			capture()
			consumer.evaluate(
				`import { diff } from 'recoverage'; assert.equal(await diff('trunk', true), ${expected});`,
			)
		})
	}

	it(`fails when no baseline coverage has been captured`, () => {
		consumer.coverage([1, 1])
		branch()
		capture()
		consumer.evaluate(
			`import { diff } from 'recoverage'; assert.equal(await diff('trunk', true), 1);`,
		)
	})

	it(`compiles ordinary consumers through both published declaration exports`, () => {
		consumer.compile()
	})

	for (const [label, before, after, expected] of [
		[`increase`, [1, 0], [1, 1], 0],
		[`decrease`, [1, 1], [1, 0], 1],
	] as const) {
		it(`compares a current ${label} with data captured by recoverage@0.1.18`, () => {
			consumer.installDataProducer()
			consumer.coverage(before)
			consumer.evaluate(
				`import { capture } from 'recoverage-0-1-18'; assert.equal(await capture({ defaultBranch: 'trunk', silent: true }), 0);`,
			)
			branch()
			consumer.coverage(after)
			capture()
			consumer.evaluate(
				`import { diff } from 'recoverage'; assert.equal(await diff('trunk', true), ${expected});`,
			)
		})
	}

	it(`accepts consumer-owned Istanbul maps through the lib subpath`, () => {
		consumer.coverage([1, 0])
		consumer.evaluate(`
import { getCoverageJsonSummary, getCoverageTextReport } from 'recoverage/lib';
import { createCoverageMap } from 'istanbul-lib-coverage';
const map = createCoverageMap(await Bun.file('coverage/coverage-final.json').json());
const summary = getCoverageJsonSummary(map);
assert.equal(summary.total.statements.total, 2);
assert.equal(summary.total.statements.covered, 1);
assert.equal(summary.total.statements.pct, 50);
assert.ok(getCoverageTextReport(map).trim().length > 0);
`)
	})

	it(`returns cloud results and errors without prescribing HTTP implementation details`, () => {
		consumer.coverage([1, 0])
		consumer.evaluate(`
import { downloadCoverageReportFromCloud, uploadCoverageReportToCloud, getCoverageJsonSummary } from 'recoverage/lib';
import { createCoverageMap } from 'istanbul-lib-coverage';
const map = createCoverageMap(await Bun.file('coverage/coverage-final.json').json());
const summary = getCoverageJsonSummary(map);
let status = 200;
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
  return new Response('coverage contents', { status });
} });
try {
  assert.equal(await downloadCoverageReportFromCloud('example', 'token', server.url.href), 'coverage contents');
  const uploaded = await uploadCoverageReportToCloud('example', map, summary, 'token', server.url.href);
  assert(!(uploaded instanceof Error));
  assert.equal(uploaded.success, true);
  status = 503;
  assert(await downloadCoverageReportFromCloud('example', 'token', server.url.href) instanceof Error);
  assert(await uploadCoverageReportToCloud('example', map, summary, 'token', server.url.href) instanceof Error);
} finally { server.stop(true); }
`)
	})
})

describe(`documented installed CLI behavior`, () => {
	for (const flag of [`--default-branch`, `--defaultBranch`, `-b`]) {
		it(`honors ${flag} on capture, diff, and the combined command`, () => {
			consumer.coverage([1, 1])
			succeeds([`capture`, flag, `trunk`])
			succeeds([`diff`, flag, `trunk`])
			succeeds([flag, `trunk`])
		})
	}

	it(`defaults to main and propagates a regression from the combined command`, () => {
		consumer.git(`branch`, `-m`, `main`)
		consumer.coverage([1, 1])
		succeeds([`capture`])
		succeeds([`diff`])
		branch()
		consumer.coverage([1, 0])
		expect(consumer.cli().status).toBe(1)
	})

	it(`uses configuration for all coverage commands and lets CLI options override it`, () => {
		consumer.coverage([1, 1])
		consumer.configure({ defaultBranch: `trunk` })
		for (const command of [[`capture`], [`diff`], []]) succeeds(command)
		consumer.configure({ defaultBranch: `no-such-branch` })
		for (const command of [[`capture`], [`diff`], []])
			succeeds([...command, `--default-branch=trunk`])
	})

	for (const invalid of [`{invalid`, { defaultBranch: 123 }]) {
		it(`rejects invalid config without capturing coverage: ${JSON.stringify(invalid)}`, () => {
			consumer.coverage([1, 0])
			capture()
			branch()
			consumer.coverage([1, 1])
			consumer.configure(invalid)
			const result = consumer.cli(`capture`, `-b`, `trunk`)
			expect(result.status).not.toBe(0)
			rmSync(path.join(consumer.directory, `recoverage.config.json`))
			// Observe absence of capture through the public API, without reading tables.
			consumer.evaluate(
				`import { diff } from 'recoverage'; assert.equal(await diff('trunk', true), 1);`,
			)
		})
	}

	it(`keeps unknown-option warnings advisory`, () => {
		consumer.coverage([1, 1])
		capture()
		const result = consumer.cli(`diff`, `-b`, `trunk`, `--unknown-option`)
		expect(result.status, result.stderr).toBe(0)
		expect(result.stderr.trim().length).toBeGreaterThan(0)
	})

	it(`provides help and completion without running coverage`, () => {
		rmSync(path.join(consumer.directory, `.git`), { recursive: true })
		const help = consumer.cli(`help`)
		expect(help.status, help.stderr).toBe(0)
		expect(help.stdout).toContain(`capture`)
		expect(help.stdout).toContain(`diff`)
		consumer.configure(`{invalid`)
		for (const shell of [`bash`, `zsh`, `fish`, `nushell`, `carapace`]) {
			const completion = consumer.cli(`completion`, shell)
			expect(completion.status, completion.stderr).toBe(0)
			expect(completion.stdout.trim().length).toBeGreaterThan(0)
		}
	})
})
