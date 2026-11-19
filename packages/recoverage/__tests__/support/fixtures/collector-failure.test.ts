import { test } from "bun:test"

test(`failure`, () => {
	throw new Error(`public contract failed`)
})
