import semver from "semver"

type Changeset = {
	releases: { name: string; type: string }[]
	summary: string
}

const breakingMarker = /💥\s+BREAKING CHANGE:/

export function hasReleasedPublicTests(files: string[]): boolean {
	return files.some((file) =>
		/^packages\/recoverage\/__tests__\/(?:diff-coverage\.test\.ts|public\/.*\.(?:test|spec)\.[cm]?[jt]sx?)$/.test(
			file,
		),
	)
}

export function certifyBreakingChange({
	baselineVersion,
	currentVersion,
	changesets,
	changelog,
}: {
	baselineVersion: string
	currentVersion: string
	changesets: Changeset[]
	changelog: string
}): boolean {
	const baseline = new semver.SemVer(baselineVersion)
	const current = new semver.SemVer(currentVersion)
	if (semver.lt(current, baseline)) return false
	const required = baseline.major === 0 ? [`minor`, `major`] : [`major`]
	if (
		changesets.some(
			({ releases, summary }) =>
				breakingMarker.test(summary) &&
				releases.some(
					({ name, type }) => name === `recoverage` && required.includes(type),
				),
		)
	)
		return true

	// Changesets consumes pending notes in the version PR. Check that PR's exact
	// changelog section and manifest bump, rather than accepting old release notes.
	const bumped =
		current.major > baseline.major ||
		(baseline.major === 0 && current.minor > baseline.minor)
	const section = changelog
		.split(/^## /m)
		.find((entry) => entry.split(`\n`, 1)[0]?.trim() === current.version)
	return bumped && section !== undefined && breakingMarker.test(section)
}
