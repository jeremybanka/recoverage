import { execFileSync, spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { changesetsReleaseDelta } from "@breakage/changesets"
import { readChangesets } from "@changesets/read"
import { breakage, semverPolicy } from "breakage"

import {
	certifyBreakingChange,
	hasReleasedPublicTests,
} from "../../../scripts/release-compatibility.ts"

const root = path.resolve(import.meta.dirname, `../../..`)
const packageDirectory = path.join(root, `packages/recoverage`)

function run(...args: string[]): void {
	const result = spawnSync(`bun`, args, { cwd: root, stdio: `inherit` })
	if (result.error) throw result.error
	if (result.status !== 0) {
		throw new Error(`bun ${args.join(` `)} failed (${result.status}).`)
	}
}

if (execFileSync(`git`, [`status`, `--porcelain`], { cwd: root }).length) {
	throw new Error(`Commit or stash changes before running test:breakage.`)
}

// A failing current suite or build is never certified as a breaking release.
run(`run`, `--cwd`, packageDirectory, `build`)
run(`run`, `--cwd`, packageDirectory, `test:public`)

const outcome = await breakage({
	baseDirname: packageDirectory,
	// Match only this package's stable releases, including annotated tags.
	tagPattern: `\\trefs/tags/recoverage@(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:\\^\\{\\})?$`,
	// Existing integration tests provide a real baseline before the first release
	// containing the expanded public suite. Include their fixtures in restoration.
	testPattern: `__tests__/{diff-coverage.test.ts,sample-package-*/{**,.gitignore},public/**}`,
	test: `bun run test:public`,
	release: {
		resolveDelta: changesetsReleaseDelta(),
		policy: semverPolicy({ beforeV1: `minor` }),
	},
})

if (!(`breakingChangesFound` in outcome)) {
	console.error(outcome.summary)
	throw new Error(
		`Compatibility was not established; a release and public tests are required.`,
	)
}
if (
	!hasReleasedPublicTests(
		outcome.testsFound.map((file) => `packages/recoverage/${file}`),
	)
) {
	throw new Error(
		`The release baseline contains no executable public contracts; fixtures and helpers alone cannot establish compatibility.`,
	)
}
console.log(outcome.summary)
console.log(`Release baseline: ${outcome.lastReleaseTag}`)
if (outcome.breakingChangesFound) {
	console.error(outcome.testResult)
	const { version } = JSON.parse(
		await readFile(path.join(packageDirectory, `package.json`), `utf8`),
	) as { version: string }
	const certified = certifyBreakingChange({
		baselineVersion: outcome.lastReleaseTag.split(`@`).at(-1)!,
		currentVersion: version,
		changesets: await readChangesets(root),
		changelog: await readFile(
			path.join(packageDirectory, `CHANGELOG.md`),
			`utf8`,
		),
	})
	if (!outcome.release?.breaking || !certified) {
		throw new Error(
			`Breaking changes require a recoverage minor bump before 1.0 (major thereafter) and 💥 BREAKING CHANGE: release notes.`,
		)
	}
	console.log(`Breaking changes are documented with a compatible release bump.`)
}
