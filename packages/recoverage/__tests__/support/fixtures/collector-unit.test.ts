import { expect, test } from "vitest"

import { git } from "../src/git-status.ts"
import { value } from "../src/recoverage.ts"
import { cli } from "../src/recoverage.x.ts"

test(`unit path`, () => {
	expect(value(false)).toBe(`unit`)
	expect(cli && git).toBe(true)
})
