import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

import { expect, test } from "bun:test"

import { marker } from "./consumer/node_modules/contract-only/index.js"

test(`public path`, () => {
	const result = spawnSync(`bun`, [`__tests__/public/consume.ts`], {
		encoding: `utf8`,
	})
	expect(result.status).toBe(0)
	expect(result.stdout.trim()).toBe(`public`)
	expect(readFileSync(`dist/recoverage.d.ts`, `utf8`)).toContain(
		`export declare function value`,
	)
	expect(marker).toBe(`consumer dependency`)
})
