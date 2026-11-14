import { expect, test } from "bun:test"

import { one } from "./example.ts"

test(`one`, () => {
	expect(one).toBe(1)
})
