import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { localEnvironment } from "../../__scripts__/coverage-tools.ts"

export function sourceModule(name: string): string {
	return JSON.stringify(path.resolve(import.meta.dirname, `../../src`, name))
}

// A fresh process isolates Bun module mocks, environment, and database caches.
// Preserve RECOVERAGE_COUNTERS so these tests contribute to the normal report.
export function runBun(script: string): void {
	const directory = mkdtempSync(path.join(tmpdir(), `recoverage-behavior-`))
	try {
		mkdirSync(path.join(directory, `coverage`))
		const result = spawnSync(
			`bun`,
			[
				`--eval`,
				`
import assert from "node:assert/strict";
import { mock } from "bun:test";
${script}
`,
			],
			{
				cwd: directory,
				encoding: `utf8`,
				timeout: 15_000,
				env: { ...localEnvironment, CI: `false` },
			},
		)
		expect(result.error).toBeUndefined()
		expect(result.status, result.stdout + result.stderr).toBe(0)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}
