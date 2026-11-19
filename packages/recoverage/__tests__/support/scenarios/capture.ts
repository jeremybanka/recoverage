import assert from "node:assert/strict"

import { refs } from "./report.ts"

const { capture, diff } = await import(`../../../src/recoverage.ts`)
const [mode, before, after, expected] = process.argv.slice(2)
await Bun.write(`coverage/lcov.info`, before)
if (mode === `compare`) {
	assert.equal(await capture({ silent: true }), 0)
	refs.current = `feature`
	await Bun.write(`coverage/lcov.info`, after)
	assert.equal(await capture({ silent: true }), 0)
	assert.equal(await diff(`main`, true), Number(expected))
} else {
	if (mode === `invalid-json`)
		await Bun.write(`coverage/coverage-final.json`, `{invalid`)
	if (mode === `invalid-json`)
		await assert.rejects(capture({ silent: true }), SyntaxError)
	else await assert.rejects(capture({ silent: true }))
	assert.equal(await Bun.file(`coverage.sqlite`).exists(), false)
}
