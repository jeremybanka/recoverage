import { describe, expect, it } from "bun:test"

import { certifyBreakingChange } from "../release-compatibility.ts"

describe(`breaking release certification`, () => {
	const baseline = {
		baselineVersion: `0.1.18`,
		currentVersion: `0.1.18`,
		changesets: [],
		changelog: ``,
	}

	for (const [name, type, summary, accepted] of [
		[`recoverage`, `minor`, `💥 BREAKING CHANGE: Remove the old API.`, true],
		[`recoverage`, `major`, `💥 BREAKING CHANGE: Remove the old API.`, true],
		[`recoverage`, `patch`, `💥 BREAKING CHANGE: Remove the old API.`, false],
		[`recoverage`, `minor`, `Add a feature.`, false],
		[
			`recoverage.cloud`,
			`minor`,
			`💥 BREAKING CHANGE: Remove the old API.`,
			false,
		],
	] as const) {
		it(`${name} ${type}: ${summary}`, () => {
			expect(
				certifyBreakingChange({
					...baseline,
					changesets: [{ releases: [{ name, type }], summary }],
				}),
			).toBe(accepted)
		})
	}

	it(`does not combine an unrelated breaking note with a feature bump`, () => {
		expect(
			certifyBreakingChange({
				...baseline,
				changesets: [
					{
						releases: [{ name: `recoverage`, type: `minor` }],
						summary: `Feature.`,
					},
					{
						releases: [{ name: `other`, type: `major` }],
						summary: `💥 BREAKING CHANGE: Removed.`,
					},
				],
			}),
		).toBe(false)
	})

	it(`requires a major bump after 1.0`, () => {
		for (const type of [`patch`, `minor`, `major`]) {
			expect(
				certifyBreakingChange({
					...baseline,
					baselineVersion: `1.2.3`,
					currentVersion: `1.2.3`,
					changesets: [
						{
							releases: [{ name: `recoverage`, type }],
							summary: `💥 BREAKING CHANGE: Removed.`,
						},
					],
				}),
			).toBe(type === `major`)
		}
	})

	it(`accepts consumed changesets only with the actual version bump and its own note`, () => {
		for (const [currentVersion, accepted] of [
			[`0.1.19`, false],
			[`0.2.0`, true],
			[`1.0.0`, true],
		] as const) {
			expect(
				certifyBreakingChange({
					...baseline,
					currentVersion,
					changelog: `# recoverage\n\n## ${currentVersion}\n\n💥 BREAKING CHANGE: Removed.\n`,
				}),
			).toBe(accepted)
		}
		expect(
			certifyBreakingChange({
				...baseline,
				currentVersion: `0.2.0`,
				changelog: `# recoverage\n\n## 0.2.0\n\nFeature.\n\n## 0.1.0\n\n💥 BREAKING CHANGE: Old change.\n`,
			}),
		).toBe(false)
	})

	it(`rejects missing certification and a manifest older than its baseline`, () => {
		expect(certifyBreakingChange(baseline)).toBe(false)
		expect(
			certifyBreakingChange({
				...baseline,
				currentVersion: `0.1.17`,
				changesets: [
					{
						releases: [{ name: `recoverage`, type: `minor` }],
						summary: `💥 BREAKING CHANGE: Removed.`,
					},
				],
			}),
		).toBe(false)
	})
})
