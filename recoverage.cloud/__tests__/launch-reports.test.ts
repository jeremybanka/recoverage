import { env } from "cloudflare:test"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { createCoverageMap } from "istanbul-lib-coverage"
import { uploadCoverageReportToCloud } from "recoverage/lib"
import { istanbulReportFixture, jsonSummaryFixture } from "recoverage-fixtures"

import app from "../src"
import { createDatabase } from "../src/db"
import type { Bindings } from "../src/env"
import { computeHash } from "../src/hash"
import {
	isD1SizeError,
	readReportBody,
	reportRequestBytes,
	ReportRequestTooLarge,
} from "../src/report-storage"
import * as schema from "../src/schema"
import { AccountUsage, accountUsage } from "../src/usage"

const payload = JSON.stringify({
	mapData: istanbulReportFixture,
	jsonSummary: jsonSummaryFixture,
})
let nextId = 3_500_000

async function reporter(userId = nextId++, role: `supporter` | null = null) {
	const db = createDatabase(env.DB)
	await db
		.insert(schema.users)
		.values({ id: userId, manualRoleOverride: role })
		.onConflictDoNothing()
	const projectId = `launch-project-${nextId++}`
	const tokenId = `launch-token-${nextId++}`
	await db
		.insert(schema.projects)
		.values({ id: projectId, userId, name: projectId })
	await db.insert(schema.tokens).values({
		id: tokenId,
		projectId,
		name: tokenId,
		salt: `salt`,
		hash: await computeHash(`secret`, `salt`),
	})
	return { db, userId, projectId, tokenId, token: `${tokenId}.secret` }
}

function put(
	owner: Awaited<ReturnType<typeof reporter>>,
	ref: string,
	bindings: Bindings = env,
	body = payload,
) {
	return app.request(
		`/reporter/${ref}`,
		{ method: `PUT`, headers: { Authorization: `Bearer ${owner.token}` }, body },
		bindings,
	)
}

afterEach(() => vi.restoreAllMocks())

test(`concurrent uploads across projects cannot exceed the account quota`, async () => {
	const first = await reporter()
	const second = await reporter(first.userId)
	const responses = await Promise.all(
		Array.from({ length: 12 }, (_, i) =>
			put(i % 2 ? first : second, `report-${i}`),
		),
	)
	expect(responses.filter((response) => response.status === 200)).toHaveLength(3)
	expect(responses.filter((response) => response.status === 403)).toHaveLength(9)
	expect(await accountUsage(first.db, first.userId)).toEqual({
		projects: 2,
		reports: 3,
	})
})

test(`a 100-report Supporter burst succeeds; downgrade preserves reads and replacements`, async () => {
	const owner = await reporter(undefined, `supporter`)
	const responses = await Promise.all(
		Array.from({ length: 100 }, (_, i) => put(owner, `report-${i}`)),
	)
	expect(responses.map((response) => response.status)).toEqual(
		Array(100).fill(200),
	)
	await owner.db
		.update(schema.users)
		.set({ manualRoleOverride: null })
		.where(eq(schema.users.id, owner.userId))
	expect((await put(owner, `new-report`)).status).toBe(403)
	expect((await put(owner, `report-0`)).status).toBe(200)
	expect(
		(
			await app.request(
				`/reporter/report-0`,
				{ headers: { Authorization: `Bearer ${owner.token}` } },
				env,
			)
		).status,
	).toBe(200)
	expect(await accountUsage(owner.db, owner.userId)).toEqual({
		projects: 1,
		reports: 100,
	})
})

test(`rate budgets use verified IDs across tokens and reject before parsing`, async () => {
	const first = await reporter()
	const second = await reporter(first.userId)
	const tokenLimit = vi.fn((_options: { key: string }) =>
		Promise.resolve({ success: true }),
	)
	const accountLimit = vi.fn((_options: { key: string }) =>
		Promise.resolve({ success: false }),
	)
	const bindings = {
		...env,
		REPORT_TOKEN_LIMITER: { limit: tokenLimit },
		REPORT_ACCOUNT_LIMITER: { limit: accountLimit },
	}
	for (const owner of [first, second]) {
		const response = await put(owner, `report`, bindings, `not JSON`)
		expect(response.status).toBe(429)
		expect(response.headers.get(`Retry-After`)).toBe(`60`)
		expect(await response.json()).toMatchObject({ code: `RATE_LIMITED` })
	}
	expect(accountLimit.mock.calls[0]).toEqual(accountLimit.mock.calls[1])
	expect(JSON.stringify(tokenLimit.mock.calls)).toContain(first.tokenId)
	expect(JSON.stringify(tokenLimit.mock.calls)).toContain(second.tokenId)
	expect(JSON.stringify(tokenLimit.mock.calls)).not.toContain(`.secret`)
	const invalid = await put({ ...first, token: `bad.token` }, `report`, bindings)
	expect(invalid.status).toBe(401)
	expect(accountLimit).toHaveBeenCalledTimes(2)
	await app.request(
		`/reporter/report`,
		{ headers: { Authorization: `Bearer ${first.token}` } },
		bindings,
	)
	expect(accountLimit).toHaveBeenCalledTimes(2)
})

test.each([undefined, `1`])(
	`streamed byte limits work with Content-Length %s and cancel the stream`,
	async (length) => {
		let cancelled = false
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(new Uint8Array(1_000_001))
			},
			cancel() {
				cancelled = true
			},
		})
		const request = new Request(`https://example.test`, {
			method: `PUT`,
			body: stream,
			headers: length ? { "Content-Length": length } : {},
		})
		await expect(readReportBody(request)).rejects.toBeInstanceOf(
			ReportRequestTooLarge,
		)
		expect(cancelled).toBe(true)
	},
)

test(`oversized replacements leave the stored report intact`, async () => {
	const owner = await reporter()
	expect((await put(owner, `baseline`)).status).toBe(200)
	const response = await put(
		owner,
		`baseline`,
		env,
		`x`.repeat(reportRequestBytes + 1),
	)
	expect(response.status).toBe(413)
	expect(await response.json()).toMatchObject({ code: `REQUEST_TOO_LARGE` })
	const stored = await app.request(
		`/reporter/baseline`,
		{ headers: { Authorization: `Bearer ${owner.token}` } },
		env,
	)
	expect(await stored.json()).toEqual(istanbulReportFixture)
})

test(`D1 size classification ignores SQL parameters and unrelated failures`, () => {
	const databaseError = new Error(
		`D1_ERROR: string or blob too big: SQLITE_TOOBIG`,
	)
	expect(isD1SizeError(databaseError)).toBe(true)
	expect(
		isD1SizeError(new Error(`query failed`, { cause: databaseError })),
	).toBe(true)
	expect(isD1SizeError(new Error(`Failed query: INSERT 'SQLITE_TOOBIG'`))).toBe(
		false,
	)
	expect(isD1SizeError(new Error(`D1_ERROR: database is locked`))).toBe(false)
	expect(
		isD1SizeError(new Error(`D1_ERROR: statement too long: SQLITE_TOOBIG`)),
	).toBe(false)
})

test.each([
	{
		message: `D1_ERROR: string or blob too big: SQLITE_TOOBIG`,
		status: 413,
		code: `REPORT_TOO_LARGE`,
	},
	{
		message: `D1_ERROR: database is locked; private query parameters`,
		status: 500,
		code: `INTERNAL_ERROR`,
	},
])(
	`failed replacements preserve the report and return $code without logging parameters`,
	async ({ message, status, code }) => {
		const owner = await reporter()
		await put(owner, `baseline`)
		const info = vi.spyOn(console, `info`).mockImplementation(() => {})
		const errorLog = vi.spyOn(console, `error`).mockImplementation(() => {})
		const failingDB = {
			prepare(query: string) {
				if (query.trimStart().startsWith(`INSERT INTO reports`)) {
					return {
						bind: () => ({ run: () => Promise.reject(new Error(message)) }),
					}
				}
				return env.DB.prepare(query)
			},
		} as unknown as D1Database
		const response = await put(owner, `baseline`, { ...env, DB: failingDB })
		expect(response.status).toBe(status)
		expect(await response.json()).toMatchObject({ code })
		const retained = await app.request(
			`/reporter/baseline`,
			{ headers: { Authorization: `Bearer ${owner.token}` } },
			env,
		)
		expect(await retained.json()).toEqual(istanbulReportFixture)
		const logs = JSON.stringify([info.mock.calls, errorLog.mock.calls])
		expect(logs).not.toContain(`private query parameters`)
		expect(logs).not.toContain(owner.token)
		expect(logs).not.toContain(`mapData`)
	},
)

test(`usage shows the combined count and the explicit exemption`, async () => {
	const first = await reporter()
	const second = await reporter(first.userId)
	await put(first, `one`)
	await put(first, `two`)
	await put(second, `three`)
	const usage = await accountUsage(first.db, first.userId)
	const render = (userId: number) =>
		new Hono()
			.get(`/`, (c) => c.html(AccountUsage({ usage, userId, role: `free` })))
			.request(`/`)
	const ordinary = await (await render(first.userId)).text()
	expect(ordinary).toContain(`Hosted reports: 3 / 3`)
	expect(ordinary).toContain(`Projects: 2 / 3`)
	expect(ordinary).toContain(`Existing reports can still be updated`)
	const exempt = await (await render(8570459)).text()
	expect(exempt).toContain(`exempt from report-count limit`)
	expect(exempt).not.toContain(`at its report limit`)
})

test(`the CLI upload client surfaces throttling and does not retry indefinitely`, async () => {
	const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
		new Response(
			JSON.stringify({
				code: `RATE_LIMITED`,
				error: `Retry after 60 seconds.`,
			}),
			{ status: 429, headers: { "Retry-After": `60` } },
		),
	)
	const result = await uploadCoverageReportToCloud(
		`baseline`,
		createCoverageMap(istanbulReportFixture),
		jsonSummaryFixture,
		`fake-token`,
	)
	expect(result).toBeInstanceOf(Error)
	assert(result instanceof Error)
	expect(result.message).toContain(`[429]`)
	assert(result instanceof Error)
	expect(result.message).toContain(`Retry after 60 seconds`)
	expect(fetchMock).toHaveBeenCalledTimes(1)
})
