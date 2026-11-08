import { env } from "cloudflare:test"
import { eq } from "drizzle-orm"
import { hc, parseResponse } from "hono/client"
import { generateSignedCookie } from "hono/cookie"
import { nanoid } from "nanoid"
import { istanbulReportFixture, jsonSummaryFixture } from "recoverage-fixtures"

import app from "../src"
import { apiContract } from "../src/api-contract"
import { createDatabase } from "../src/db"
import { computeHash } from "../src/hash"
import * as schema from "../src/schema"

const db = createDatabase(env.DB)
let userId = 4030100
let credential: string

beforeEach(async () => {
	userId++
	await db.insert(schema.users).values({ id: userId })
	const id = `rca_${nanoid()}`
	credential = `${id}.account-secret`
	await db.insert(schema.accountSessions).values({
		id,
		userId,
		githubLogin: `cli-user`,
		salt: `salt`,
		hash: await computeHash(`account-secret`, `salt`),
		expiresAt: Date.now() + 60_000,
	})
})

afterEach(async () => {
	vi.restoreAllMocks()
	await db.delete(schema.users).where(eq(schema.users.id, userId))
})

function api(route: string, method = `GET`, body?: unknown, token = credential) {
	return app.request(
		`/api/v1${route}`,
		{
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": `application/json`,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
		env,
	)
}

test(`Hono RPC client shares validated request bodies and server responses`, async () => {
	const client = hc<typeof apiContract>(`http://localhost`, {
		headers: { Authorization: `Bearer ${credential}` },
		fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
			apiContract.request(input, init, env),
	})
	const account = await parseResponse(client.account.$get())
	expect(account.login).toBe(`cli-user`)
	const created = await parseResponse(
		client.projects.$post({ json: { name: `RPC project` } }),
	)
	const { projects } = await parseResponse(client.projects.$get())
	expect(projects[0].id).toBe(created.id)
	const param = { projectId: created.id }
	const tokens = client.projects[`:projectId`].tokens
	const token = await parseResponse(
		tokens.$post({ param, json: { name: `RPC token` } }),
	)
	expect(token.token).toContain(`${token.id}.`)
	const deleted = await parseResponse(
		tokens[`:tokenId`].$delete({ param: { ...param, tokenId: token.id } }),
	)
	expect(deleted).toEqual({ success: true, id: token.id })
	expect(
		(await parseResponse(client.projects.$get())).projects[0].tokens,
	).toEqual([])
})

async function project() {
	const response = await api(`/projects`, `POST`, { name: `CLI project` })
	expect(response.status, await response.clone().text()).toBe(201)
	return response.json<{ id: string; name: string }>()
}

test(`device login exchanges GitHub identity for a separate, expiring account credential`, async () => {
	const githubToken = `github-token-never-persisted`
	const fetchMock = vi
		.spyOn(globalThis, `fetch`)
		.mockImplementation(async (input, init) => {
			const request = new Request(input, init)
			expect(request.url).not.toContain(`client_secret`)
			if (request.url === `https://github.com/login/device/code`) {
				expect(request.method).toBe(`POST`)
				expect((await request.formData()).get(`scope`)).toBe(`read:user`)
				return Response.json({
					device_code: `device`,
					user_code: `ABCD-EFGH`,
					verification_uri: `https://github.com/login/device`,
					expires_in: 900,
					interval: 5,
				})
			}
			if (request.url === `https://github.com/login/oauth/access_token`) {
				expect((await request.formData()).get(`device_code`)).toBe(`device`)
				return Response.json({ access_token: githubToken })
			}
			expect(request.url).toBe(`https://api.github.com/user`)
			return Response.json({ id: userId, login: `cli-user` })
		})
	const start = await api(`/auth/device`, `POST`, {})
	expect(start.status).toBe(200)
	expect(await start.json()).toEqual({
		deviceCode: `device`,
		userCode: `ABCD-EFGH`,
		verificationUri: `https://github.com/login/device`,
		expiresIn: 900,
		interval: 5,
	})
	const session = await api(`/auth/session`, `POST`, { deviceCode: `device` })
	expect(session.status).toBe(201)
	expect(session.headers.get(`Cache-Control`)).toBe(`no-store`)
	const data = await session.json<{ token: string; expiresAt: number }>()
	expect(data.token).toMatch(/^rca_[\w-]+\.[\w-]+$/)
	expect(data.expiresAt).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000)
	const records = await db
		.select()
		.from(schema.accountSessions)
		.where(eq(schema.accountSessions.userId, userId))
	expect(JSON.stringify(records)).not.toContain(githubToken)
	expect(JSON.stringify(records)).not.toContain(data.token.split(`.`)[1])
	expect((await api(`/account`, `GET`, undefined, data.token)).status).toBe(200)
	expect(fetchMock).toHaveBeenCalledTimes(3)
})

test.each([`authorization_pending`, `slow_down`])(
	`returns %s without issuing credentials`,
	async (error) => {
		vi.spyOn(globalThis, `fetch`).mockResolvedValue(Response.json({ error }))
		const response = await api(`/auth/session`, `POST`, {
			deviceCode: `pending`,
		})
		expect(response.status).toBe(202)
		expect(await response.json()).toEqual({ error })
		expect(
			await db
				.select()
				.from(schema.accountSessions)
				.where(eq(schema.accountSessions.userId, userId)),
		).toHaveLength(1)
	},
)

test(`surfaces disabled device flow and denied or expired login`, async () => {
	vi.spyOn(globalThis, `fetch`).mockImplementation(() =>
		Promise.resolve(Response.json({ error: `access_denied` })),
	)
	expect((await api(`/auth/device`, `POST`, {})).status).toBe(502)
	expect(
		(await api(`/auth/session`, `POST`, { deviceCode: `denied` })).status,
	).toBe(401)
	expect((await api(`/auth/session`, `POST`, {})).status).toBe(400)
})

test.each([`network`, `html`, `invalid-json`])(
	`returns a JSON gateway error when GitHub returns %s`,
	async (failure) => {
		vi.spyOn(globalThis, `fetch`).mockImplementation((_input, init) => {
			expect(init?.signal).toBeDefined()
			if (failure === `network`)
				return Promise.reject(new Error(`connection failed`))
			return Promise.resolve(
				failure === `html`
					? new Response(`<html>unavailable</html>`, { status: 503 })
					: Response.json(null),
			)
		})
		for (const [route, body] of [
			[`/auth/device`, {}],
			[`/auth/session`, { deviceCode: `device` }],
		] as const) {
			const response = await api(route, `POST`, body)
			expect(response.status).toBe(502)
			expect(await response.json()).toEqual({
				error: `GitHub login is temporarily unavailable. Try again.`,
			})
		}
	},
)

test(`rejects missing, malformed, expired, and reporter credentials for management`, async () => {
	for (const token of [
		``,
		`rca_unknown.secret`,
		credential.replace(`account-secret`, `wrong`),
	]) {
		expect((await api(`/projects`, `GET`, undefined, token)).status).toBe(401)
	}
	const { id } = await project()
	const token = await (
		await api(`/projects/${id}/tokens`, `POST`, { name: `CI` })
	).json<{ token: string }>()
	expect((await api(`/account`, `GET`, undefined, token.token)).status).toBe(401)
	await db
		.update(schema.accountSessions)
		.set({ expiresAt: Date.now() - 1 })
		.where(eq(schema.accountSessions.userId, userId))
	expect((await api(`/projects`)).status).toBe(401)
})

test(`creates a project and reporter token, lists safe metadata, and revokes reporter access`, async () => {
	const { id } = await project()
	const response = await api(`/projects/${id}/tokens`, `POST`, { name: `CI` })
	expect(response.status).toBe(201)
	const token = await response.json<{ id: string; token: string }>()
	expect(Object.keys(token).sort()).toEqual([`createdAt`, `id`, `name`, `token`])
	const upload = await app.request(
		`/reporter/package`,
		{
			method: `PUT`,
			headers: { Authorization: `Bearer ${token.token}` },
			body: JSON.stringify({
				mapData: istanbulReportFixture,
				jsonSummary: jsonSummaryFixture,
			}),
		},
		env,
	)
	expect(upload.status).toBe(200)
	const listing = await api(`/projects`)
	const text = await listing.text()
	expect(text).toContain(`package`)
	expect(text).not.toContain(token.token.split(`.`)[1])
	expect(text).not.toContain(`"salt"`)
	expect(text).not.toContain(`"hash"`)
	const revoke = await api(`/projects/${id}/tokens/${token.id}`, `DELETE`)
	expect(revoke.status).toBe(200)
	const download = await app.request(
		`/reporter/package`,
		{ headers: { Authorization: `Bearer ${token.token}` } },
		env,
	)
	expect(download.status).toBe(401)
	expect(
		(await api(`/projects/${id}/tokens/${token.id}`, `DELETE`)).status,
	).toBe(404)
})

test(`enforces ownership for token creation, revocation, and project listings`, async () => {
	const foreignUser = userId + 100_000
	await db.insert(schema.users).values({ id: foreignUser })
	try {
		const foreignProject = nanoid()
		const tokenId = nanoid()
		await db.insert(schema.projects).values({
			id: foreignProject,
			userId: foreignUser,
			name: `Foreign project`,
		})
		await db.insert(schema.tokens).values({
			id: tokenId,
			projectId: foreignProject,
			name: `Foreign token`,
			hash: `hash`,
			salt: `salt`,
		})
		expect(
			(
				await api(`/projects/${foreignProject}/tokens`, `POST`, {
					name: `attack`,
				})
			).status,
		).toBe(404)
		expect(
			(await api(`/projects/${foreignProject}/tokens/${tokenId}`, `DELETE`))
				.status,
		).toBe(404)
		const ownProject = await project()
		expect(
			(await api(`/projects/${ownProject.id}/tokens/${tokenId}`, `DELETE`))
				.status,
		).toBe(404)
		expect(await (await api(`/projects`)).text()).not.toContain(`Foreign`)
		expect(
			await db.query.tokens.findFirst({ where: eq(schema.tokens.id, tokenId) }),
		).toBeDefined()
	} finally {
		await db.delete(schema.users).where(eq(schema.users.id, foreignUser))
	}
})

test(`enforces project and token quotas even with concurrent API requests`, async () => {
	const { id } = await project()
	await project()
	const creations = await Promise.all([
		api(`/projects`, `POST`, { name: `Third` }),
		api(`/projects`, `POST`, { name: `Fourth` }),
	])
	expect(creations.map((response) => response.status).sort()).toEqual([201, 403])
	await db.insert(schema.tokens).values(
		Array.from({ length: 11 }, () => ({
			id: nanoid(),
			projectId: id,
			name: `Existing`,
			hash: `hash`,
			salt: `salt`,
		})),
	)
	const tokens = await Promise.all([
		api(`/projects/${id}/tokens`, `POST`, { name: `Last` }),
		api(`/projects/${id}/tokens`, `POST`, { name: `Excess` }),
	])
	expect(tokens.map((response) => response.status).sort()).toEqual([201, 403])
})

test(`browser and CLI use the same projects and token operations`, async () => {
	vi.spyOn(globalThis, `fetch`).mockImplementation(() =>
		Promise.resolve(Response.json({ id: userId, login: `cli-user` })),
	)
	const cookie = await generateSignedCookie(
		`github-access-token`,
		`github-browser-token`,
		env.COOKIE_SECRET,
	)
	const body = new FormData()
	body.set(`name`, `Browser project`)
	expect(
		(
			await app.request(
				`/ui/project`,
				{ method: `POST`, headers: { Cookie: cookie }, body },
				env,
			)
		).status,
	).toBe(200)
	const { projects } = await (await api(`/projects`)).json<{
		projects: { id: string; name: string }[]
	}>()
	expect(projects[0].name).toBe(`Browser project`)
	const token = await (
		await api(`/projects/${projects[0].id}/tokens`, `POST`, {
			name: `CLI token`,
		})
	).json<{ id: string }>()
	const browser = await app.request(
		`/ui/project`,
		{ headers: { Cookie: cookie } },
		env,
	)
	expect(await browser.text()).toContain(`CLI token`)
	expect(
		(
			await app.request(
				`/ui/token/${token.id}`,
				{ method: `DELETE`, headers: { Cookie: cookie } },
				env,
			)
		).status,
	).toBe(200)
	expect(
		await db.query.tokens.findFirst({ where: eq(schema.tokens.id, token.id) }),
	).toBeUndefined()
})

test(`rejects invalid input and revokes the account session on logout`, async () => {
	for (const name of [``, ` `, `x`.repeat(129), 42]) {
		expect((await api(`/projects`, `POST`, { name })).status).toBe(400)
	}
	const malformed = await app.request(
		`/api/v1/projects`,
		{
			method: `POST`,
			headers: { Authorization: `Bearer ${credential}` },
			body: `{bad`,
		},
		env,
	)
	expect(malformed.status).toBe(400)
	expect((await api(`/auth/session`, `DELETE`)).status).toBe(200)
	expect((await api(`/account`)).status).toBe(401)
})

const coveragePayload = {
	mapData: istanbulReportFixture,
	jsonSummary: jsonSummaryFixture,
}

test(`roundtrips report maps and summaries, builds badges, and atomically replaces at quota`, async () => {
	const { id } = await project()
	const base = `/projects/${id}/reports`
	for (const ref of [`alpha`, `space % report`, `omega`]) {
		const response = await api(
			`${base}/${encodeURIComponent(ref)}`,
			`PUT`,
			coveragePayload,
		)
		expect(response.status, await response.clone().text()).toBe(200)
	}
	const listing = await api(base)
	const text = await listing.text()
	expect(text).not.toContain(`statementMap`)
	expect(
		JSON.parse(text).reports.map((report: { ref: string }) => report.ref),
	).toEqual([`alpha`, `omega`, `space % report`])
	const original = await (await api(`${base}/alpha`)).json<{
		createdAt: string
	}>()
	const replacement = {
		...coveragePayload,
		jsonSummary: {
			...jsonSummaryFixture,
			total: {
				...jsonSummaryFixture.total,
				statements: { ...jsonSummaryFixture.total.statements, pct: 42 },
			},
		},
	}
	expect((await api(`${base}/alpha`, `PUT`, replacement)).status).toBe(200)
	expect(await (await api(`${base}/alpha`)).json()).toMatchObject({
		ref: `alpha`,
		createdAt: original.createdAt,
		jsonSummary: replacement.jsonSummary,
	})
	expect(await (await api(`${base}/alpha/data`)).json()).toEqual({
		ref: `alpha`,
		mapData: istanbulReportFixture,
	})
	const badge = await (await api(`${base}/space%20%25%20report/badge`)).json<{
		endpoint: string
		image: string
		markdown: string
	}>()
	expect(new URL(badge.endpoint).pathname).toBe(
		`/shields/${id}/space%20%25%20report`,
	)
	expect(new URL(badge.image).searchParams.get(`url`)).toBe(badge.endpoint)
	expect(badge.markdown).toBe(`![Statement coverage](${badge.image})`)
	expect((await app.request(badge.endpoint, {}, env)).status).toBe(200)
	expect((await api(`${base}/excess`, `PUT`, coveragePayload)).status).toBe(403)
	const token = await (
		await api(`/projects/${id}/tokens`, `POST`, { name: `CI` })
	).json<{ token: string }>()
	const reporter = (ref: string) =>
		app.request(
			`/reporter/${ref}`,
			{
				method: `PUT`,
				headers: { Authorization: `Bearer ${token.token}` },
				body: JSON.stringify(coveragePayload),
			},
			env,
		)
	expect((await reporter(`alpha`)).status).toBe(200)
	expect((await reporter(`excess`)).status).toBe(401)
	expect((await api(`${base}/alpha`, `DELETE`)).status).toBe(200)
	for (const suffix of [``, `/data`, `/badge`])
		expect((await api(`${base}/alpha${suffix}`)).status).toBe(404)
	expect((await api(`${base}/alpha`, `DELETE`)).status).toBe(404)
	const lastSlot = await Promise.all([
		api(`${base}/new`, `PUT`, coveragePayload),
		api(`${base}/other`, `PUT`, coveragePayload),
	])
	expect(lastSlot.map((response) => response.status).sort()).toEqual([200, 403])
})

test(`renames and deletes projects with cascading reports and tokens`, async () => {
	const { id } = await project()
	const url = `/projects/${id}`
	expect((await api(url)).status).toBe(200)
	expect((await api(url, `PATCH`, { name: `Renamed` })).status).toBe(200)
	expect(await (await api(url)).json()).toMatchObject({ id, name: `Renamed` })
	for (const name of [``, ` `, `x`.repeat(129), 42])
		expect((await api(url, `PATCH`, { name })).status).toBe(400)
	const token = await (await api(`${url}/tokens`, `POST`, { name: `CI` })).json<{
		id: string
		token: string
	}>()
	const listing = await (await api(`${url}/tokens`)).text()
	expect(listing).toContain(token.id)
	for (const secret of [token.token, `"hash"`, `"salt"`])
		expect(listing).not.toContain(secret)
	await api(`${url}/reports/pkg`, `PUT`, coveragePayload)
	expect((await api(url, `DELETE`)).status).toBe(200)
	expect((await api(url)).status).toBe(404)
	expect((await api(url, `PATCH`, { name: `Absent` })).status).toBe(404)
	expect((await api(url, `DELETE`)).status).toBe(404)
	expect(
		await db.query.tokens.findFirst({ where: eq(schema.tokens.id, token.id) }),
	).toBeUndefined()
	expect((await app.request(`/shields/${id}/pkg`, {}, env)).status).toBe(404)
	expect(
		(
			await app.request(
				`/reporter/pkg`,
				{ headers: { Authorization: `Bearer ${token.token}` } },
				env,
			)
		).status,
	).toBe(401)
})

test(`requires ownership and account credentials for every management operation`, async () => {
	const foreignUser = userId + 100_000
	await db.insert(schema.users).values({ id: foreignUser })
	try {
		const foreignProject = nanoid()
		await db
			.insert(schema.projects)
			.values({ id: foreignProject, userId: foreignUser, name: `Foreign` })
		await db.insert(schema.reports).values({
			projectId: foreignProject,
			ref: `pkg`,
			data: JSON.stringify(istanbulReportFixture),
			jsonSummary: JSON.stringify(jsonSummaryFixture),
		})
		const own = await project()
		const token = await (
			await api(`/projects/${own.id}/tokens`, `POST`, { name: `Reporter` })
		).json<{ token: string }>()
		for (const [suffix, method, body] of [
			[``, `GET`, undefined],
			[``, `PATCH`, { name: `Attack` }],
			[``, `DELETE`, undefined],
			[`/tokens`, `GET`, undefined],
			[`/reports`, `GET`, undefined],
			[`/reports/pkg`, `GET`, undefined],
			[`/reports/pkg/data`, `GET`, undefined],
			[`/reports/pkg/badge`, `GET`, undefined],
			[`/reports/pkg`, `PUT`, coveragePayload],
			[`/reports/pkg`, `DELETE`, undefined],
		] as const) {
			expect(
				(await api(`/projects/${foreignProject}${suffix}`, method, body)).status,
			).toBe(404)
			expect(
				(await api(`/projects/${own.id}${suffix}`, method, body, token.token))
					.status,
			).toBe(401)
		}
	} finally {
		await db.delete(schema.users).where(eq(schema.users.id, foreignUser))
	}
})

test(`validates payloads and refs and handles legacy reports without summaries`, async () => {
	const { id } = await project()
	const base = `/projects/${id}/reports`
	for (const body of [
		null,
		{},
		{ mapData: {}, jsonSummary: {} },
		{ ...coveragePayload, mapData: `invalid` },
	])
		expect((await api(`${base}/pkg`, `PUT`, body)).status).toBe(400)
	for (const ref of [`bad/name`, `bad\\name`, `bad\u0000name`, `x`.repeat(65)])
		expect(
			(await api(`${base}/${encodeURIComponent(ref)}`, `PUT`, coveragePayload))
				.status,
		).toBe(400)
	expect(await (await api(base)).json()).toEqual({ reports: [] })
	await db.insert(schema.reports).values({
		projectId: id,
		ref: `legacy`,
		data: JSON.stringify(istanbulReportFixture),
	})
	expect(await (await api(`${base}/legacy`)).json()).toMatchObject({
		ref: `legacy`,
		jsonSummary: null,
	})
	expect(await (await api(base)).json()).toMatchObject({
		reports: [{ ref: `legacy`, jsonSummary: null }],
	})
	expect((await api(`${base}/legacy/badge`)).status).toBe(409)
})
