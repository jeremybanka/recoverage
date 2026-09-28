import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import Database from "bun:sqlite"

import {
	collectCloud,
	collectPackage,
	localEnvironment,
	normalizedCoverage,
	packagePaths,
	repositoryRoot,
	run,
} from "./coverage-tools.ts"

const requestedRef = process.argv[2] ?? `origin/main`
// Resolve once. The same immutable commit supplies source and the database key.
const base = execFileSync(
	`git`,
	[`rev-parse`, `--verify`, `${requestedRef}^{commit}`],
	{ cwd: repositoryRoot, encoding: `utf8` },
).trim()
const scratch = mkdtempSync(path.join(tmpdir(), `recoverage-base-`))
try {
	const baseline = path.join(scratch, `baseline`)
	mkdirSync(baseline)
	const archive = path.join(scratch, `baseline.tar`)
	run([`git`, `archive`, `--output`, archive, base], repositoryRoot)
	run([`tar`, `-xf`, archive, `-C`, baseline], repositoryRoot)
	run([`bun`, `install`, `--frozen-lockfile`], baseline)
	const cwd = path.resolve(process.cwd())
	const selected =
		cwd === repositoryRoot
			? packagePaths
			: packagePaths.filter((name) => path.join(repositoryRoot, name) === cwd)
	if (selected.length === 0)
		throw new Error(
			`Run cov:check from the repository root or a package directory`,
		)
	for (const name of selected) {
		console.log(`\nComparing ${name} against ${base}`)
		const basePackage = path.join(baseline, name)
		if (name === `recoverage.cloud`) {
			run([`bun`, `run`, `build`], path.join(baseline, `packages/recoverage`))
			run([`bun`, `run`, `gen:scripts`], basePackage)
			collectCloud(basePackage)
		} else collectPackage(basePackage, path.join(scratch, `instrumented`))
		const comparison = path.join(scratch, `compare`, name)
		mkdirSync(path.join(comparison, `coverage`), { recursive: true })
		const db = new Database(path.join(comparison, `coverage.sqlite`))
		db.run(
			`create table coverage (git_ref text, coverage text, last_updated text default current_timestamp)`,
		)
		db.prepare(`insert into coverage (git_ref, coverage) values (?, ?)`).run(
			base.slice(0, 7),
			JSON.stringify(normalizedCoverage(basePackage)),
		)
		db.close()
		writeFileSync(
			path.join(comparison, `coverage/coverage-final.json`),
			JSON.stringify(normalizedCoverage(path.join(repositoryRoot, name))),
		)
		// Local SQLite comparison is deliberately independent of cloud credentials
		// and of a moving origin/main. The public CLI still performs the check.
		const env = { ...localEnvironment, CI: `false` }
		run(
			[
				`bun`,
				path.join(repositoryRoot, `packages/recoverage/bin/recoverage.bin.js`),
				`--default-branch`,
				base,
			],
			comparison,
			env,
		)
	}
} finally {
	rmSync(scratch, { recursive: true, force: true })
}
