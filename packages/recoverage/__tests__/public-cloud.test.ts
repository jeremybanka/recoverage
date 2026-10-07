import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { istanbulReportFixture } from "recoverage-fixtures"

const entry = path.resolve(import.meta.dirname, `../src/recoverage.x.ts`)
const gitModule = path.resolve(import.meta.dirname, `../src/git-status.ts`)
let directory: string

beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), `recoverage-public-cloud-`))
	mkdirSync(path.join(directory, `coverage`))
})

afterEach(() => {
	rmSync(directory, { recursive: true, force: true })
})

function invoke({ decreased = false, status = 200, token = `` } = {}) {
	const current = structuredClone(istanbulReportFixture)
	if (decreased) {
		for (const file of Object.values(current)) {
			for (const statement of Object.keys(file.s)) file.s[statement] = 0
		}
	}
	writeFileSync(
		path.join(directory, `coverage/coverage-final.json`),
		JSON.stringify(current),
	)
	const preload = path.join(directory, `preload.ts`)
	writeFileSync(
		preload,
		`
import assert from "node:assert/strict"
import { mock } from "bun:test"
mock.module(${JSON.stringify(gitModule)}, () => ({
  getCurrentGitRef: async () => "feature",
  getBaseGitRef: async () => "baseline",
}))
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), ${JSON.stringify(`https://public.example.test/reporter/${token ? `` : `public/project-id/`}${path.basename(directory)}`)})
  assert.equal(options.method, "GET")
  assert.deepEqual(options.headers, ${JSON.stringify(token ? { Authorization: `Bearer ${token}` } : {})})
  console.log("baseline downloaded")
  return Response.json(${JSON.stringify(istanbulReportFixture)}, { status: ${status} })
}
`,
	)
	return spawnSync(`bun`, [`--preload`, preload, entry], {
		cwd: directory,
		env: {
			...process.env,
			RECOVERAGE_CLOUD_TOKEN: token,
			RECOVERAGE_CLOUD_PROJECT_ID: `project-id`,
			RECOVERAGE_CLOUD_URL: `https://public.example.test`,
			S3_ACCESS_KEY_ID: ``,
			S3_BUCKET: ``,
			S3_ENDPOINT: ``,
			S3_SECRET_ACCESS_KEY: ``,
		},
		encoding: `utf8`,
		timeout: 10_000,
	})
}

test.each([
	{ decreased: false, expected: 0 },
	{ decreased: true, expected: 1 },
])(
	`token-free comparison returns $expected when decreased=$decreased`,
	({ decreased, expected }) => {
		const result = invoke({ decreased })
		expect(result.error).toBeUndefined()
		expect(result.status, result.stderr).toBe(expected)
		expect(result.stdout).toContain(`baseline downloaded`)
		const cached = invoke({ decreased })
		expect(cached.status, cached.stderr).toBe(expected)
		expect(cached.stdout).not.toContain(`baseline downloaded`)
	},
)

test(`a private or missing public baseline fails comparison`, () => {
	const result = invoke({ status: 404 })
	expect(result.status).toBe(1)
	expect(result.stderr).toContain(`Failed to fetch coverage report: [404]`)
})

test(`a configured token takes precedence over a public project ID`, () => {
	const result = invoke({ token: `test-token` })
	expect(result.status, result.stderr).toBe(0)
	expect(result.stdout).toContain(`baseline downloaded`)
})
