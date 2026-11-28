import { mock } from "bun:test"
import type { CoverageMapData } from "istanbul-lib-coverage"

export const refs: { current: string } = { current: `base` }
await mock.module(`../../../src/git-status.ts`, () => ({
	getCurrentGitRef: () => Promise.resolve(refs.current),
	getBaseGitRef: () => Promise.resolve(`base`),
}))
export function report(hits: readonly [number, number]): CoverageMapData {
	return {
		"example.ts": {
			path: `example.ts`,
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
	}
}
