import { readFile } from "node:fs/promises"
import path from "node:path"

import { changesetsReleaseDelta } from "@breakage/changesets"
import { readChangesets } from "@changesets/read"
import type { ReleaseConfig } from "breakage"
import { semverPolicy } from "breakage"
import { simpleGit } from "simple-git"

import {
	certifyBreakingChange,
	hasReleasedPublicTests,
} from "../../../scripts/release-compatibility.ts"

/** Add Recoverage's contract and release-note requirements to the standard CLI. */
export function recoverageRelease(): ReleaseConfig {
	const resolveDelta = changesetsReleaseDelta()
	const permitsBreak = semverPolicy({ beforeV1: `minor` })
	// Breakage resolves evidence before calling its synchronous release policy.
	let documented = false
	return {
		async resolveDelta(context) {
			documented = false
			const { baseline, packageDirectory, currentVersion } = context
			if (!baseline?.commit) {
				throw new Error(`A released public-contract baseline is required.`)
			}
			const files = await simpleGit(packageDirectory).raw([
				`ls-tree`,
				`-r`,
				`--name-only`,
				`-z`,
				baseline.commit,
			])
			// The config restores all public contracts, excluding hidden paths just
			// as Breakage's glob does. Fixtures alone must never establish compatibility.
			if (
				!hasReleasedPublicTests(
					files
						.split(`\0`)
						.filter(
							(file) => !file.split(`/`).some((part) => part.startsWith(`.`)),
						)
						.map((file) => `packages/recoverage/${file}`),
				)
			) {
				throw new Error(
					`The release baseline contains no executable public contracts; fixtures and helpers alone cannot establish compatibility.`,
				)
			}
			const transition = await resolveDelta(context)
			documented = certifyBreakingChange({
				baselineVersion: baseline.version,
				currentVersion,
				changesets: await readChangesets(
					path.resolve(packageDirectory, `../..`),
				),
				changelog: await readFile(
					path.join(packageDirectory, `CHANGELOG.md`),
					`utf8`,
				),
			})
			return transition
		},
		policy: (transition) => permitsBreak(transition) && documented,
	}
}
