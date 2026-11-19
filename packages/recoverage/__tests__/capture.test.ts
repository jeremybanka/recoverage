import { runBun } from "./support/bun.ts"

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
			runBun(
				`capture.ts`,
				`compare`,
				lcov(before),
				lcov(after),
				String(expected),
			)
		})
	}

	it(`rejects invalid JSON without falling back to a valid LCOV report`, () => {
		runBun(`capture.ts`, `invalid-json`, lcov([1, 1]))
	})

	it.each([``, `SF:example.ts\nDA:1,\nend_of_record`])(
		`rejects empty or malformed LCOV before saving: %s`,
		(report) => {
			runBun(`capture.ts`, `invalid-lcov`, report)
		},
	)
})
