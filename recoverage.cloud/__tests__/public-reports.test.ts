import { env } from "cloudflare:test"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { setSignedCookie } from "hono/cookie"
import { nanoid } from "nanoid"
import { downloadCoverageReportFromCloud } from "recoverage/lib"
import { istanbulReportFixture, jsonSummaryFixture } from "recoverage-fixtures"

import app from "../src"
import { createDatabase } from "../src/db"
import type { Bindings } from "../src/env"
import { computeHash } from "../src/hash"
import * as schema from "../src/schema"

const db = createDatabase(env.DB)
const ownerId = 1974010
const otherUserId = 1974011
const reportRef = `sample-package`
let projectId: string
let token: string
let cookie: string
let signedInUserId: number

beforeEach(async () => {
	signedInUserId = ownerId
	await db
		.insert(schema.users)
		.values([{ id: ownerId }, { id: otherUserId }])
		.onConflictDoNothing()
	projectId = nanoid()
	await db
		.insert(schema.projects)
		.values({ id: projectId, userId: ownerId, name: `Public report test` })
	const tokenId = nanoid()
	const password = nanoid()
	const salt = nanoid()
	token = `${tokenId}.${password}`
	await db.insert(schema.tokens).values({
		id: tokenId,
		projectId,
		name: `Reporter`,
		salt,
		hash: await computeHash(password, salt),
	})
	const uploaded = await app.request(
		`/reporter/${reportRef}`,
		{
			method: `PUT`,
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				mapData: istanbulReportFixture,
				jsonSummary: jsonSummaryFixture,
			}),
		},
		env,
	)
	expect(uploaded.status).toBe(200)
	const cookieApp = new Hono().get(`/`, async (c) => {
		await setSignedCookie(
			c,
			`github-access-token`,
			`public-test-token`,
			(env as unknown as Bindings).COOKIE_SECRET,
		)
		return c.text(`Signed in`)
	})
	const signedCookie = (await cookieApp.request(`/`)).headers.get(`set-cookie`)
	assert(signedCookie)
	cookie = signedCookie
	vi.spyOn(globalThis, `fetch`).mockImplementation(async (input, init) => {
		const request = new Request(input, init)
		if (request.url === `https://api.github.com/user`) {
			return Response.json({ id: signedInUserId, login: `testuser` })
		}
		return app.request(request, undefined, env)
	})
})

afterEach(async () => {
	vi.restoreAllMocks()
	await db.delete(schema.projects).where(eq(schema.projects.id, projectId))
})

function publicDownload(id = projectId, ref = reportRef) {
	return app.request(`/reporter/public/${id}/${ref}`, {}, env)
}

function setVisibility(body: string, authenticated = true, id = projectId) {
	return app.request(
		`/ui/project/${id}/visibility`,
		{
			method: `PUT`,
			headers: {
				"Content-Type": `application/x-www-form-urlencoded`,
				...(authenticated ? { Cookie: cookie } : {}),
			},
			body,
		},
		env,
	)
}

test(`reports start private and owners can enable and revoke public downloads`, async () => {
	const privateResponse = await publicDownload()
	expect(privateResponse.status).toBe(404)
	expect(privateResponse.headers.get(`Cache-Control`)).toBe(`no-store`)
	const privateHtml = await (
		await app.request(`/ui/project`, { headers: { Cookie: cookie } }, env)
	).text()
	expect(privateHtml).toContain(`Public reports`)
	expect(privateHtml).not.toMatch(/<input[^>]* checked/)
	expect(privateHtml).not.toContain(`RECOVERAGE_CLOUD_PROJECT_ID=`)

	const enabled = await setVisibility(`publicReports=on`)
	expect(enabled.status).toBe(200)
	const enabledHtml = await enabled.text()
	expect(enabledHtml).toMatch(/<input[^>]* checked/)
	expect(enabledHtml).toContain(`RECOVERAGE_CLOUD_PROJECT_ID=${projectId}`)
	const publicResponse = await publicDownload()
	expect(publicResponse.status).toBe(200)
	expect(publicResponse.headers.get(`Cache-Control`)).toBe(`no-store`)
	expect(await publicResponse.json()).toEqual(istanbulReportFixture)
	const reloadedHtml = await (
		await app.request(`/ui/project`, { headers: { Cookie: cookie } }, env)
	).text()
	expect(reloadedHtml).toMatch(/<input[^>]* checked/)

	const disabled = await setVisibility(``)
	expect(disabled.status).toBe(200)
	expect(await disabled.text()).not.toMatch(/<input[^>]* checked/)
	expect((await publicDownload()).status).toBe(404)
	const authenticated = await app.request(
		`/reporter/${reportRef}`,
		{ headers: { Authorization: `Bearer ${token}` } },
		env,
	)
	expect(authenticated.status).toBe(200)
	expect(await authenticated.json()).toEqual(istanbulReportFixture)
})

test(`only the owner can change visibility and invalid values do not publish reports`, async () => {
	expect((await setVisibility(`publicReports=on`, false)).status).toBe(401)
	signedInUserId = otherUserId
	expect((await setVisibility(`publicReports=on`)).status).toBe(404)
	expect((await publicDownload()).status).toBe(404)
	signedInUserId = ownerId
	expect((await setVisibility(`publicReports=false`)).status).toBe(400)
	expect((await publicDownload()).status).toBe(404)
	expect(
		(await setVisibility(`publicReports=on`, true, `missing-project`)).status,
	).toBe(404)
})

test(`public access stays scoped to the selected project and never authorizes uploads`, async () => {
	await setVisibility(`publicReports=on`)
	const privateProjectId = nanoid()
	await db
		.insert(schema.projects)
		.values({ id: privateProjectId, userId: ownerId, name: `Private project` })
	try {
		await db.insert(schema.reports).values({
			projectId: privateProjectId,
			ref: reportRef,
			data: JSON.stringify(istanbulReportFixture),
		})
		expect((await publicDownload(privateProjectId)).status).toBe(404)
		expect((await publicDownload(`missing-project`)).status).toBe(404)
		expect((await publicDownload(projectId, `missing-report`)).status).toBe(404)
		expect(
			(
				await app.request(
					`/reporter/${reportRef}`,
					{ method: `PUT`, body: `{}` },
					env,
				)
			).status,
		).toBe(401)
		expect(
			(
				await app.request(
					`/reporter/public/${projectId}/${reportRef}`,
					{ method: `PUT`, body: `{}` },
					env,
				)
			).status,
		).toBe(404)
		expect(await (await publicDownload()).json()).toEqual(istanbulReportFixture)
	} finally {
		await db
			.delete(schema.projects)
			.where(eq(schema.projects.id, privateProjectId))
	}
	await db.delete(schema.projects).where(eq(schema.projects.id, projectId))
	expect((await publicDownload()).status).toBe(404)
})

test(`the library downloads a public baseline without sending credentials`, async () => {
	await setVisibility(`publicReports=on`)
	const downloaded = await downloadCoverageReportFromCloud(
		reportRef,
		undefined,
		`https://recoverage.cloud`,
		projectId,
	)
	assert(typeof downloaded === `string`)
	expect(JSON.parse(downloaded)).toEqual(istanbulReportFixture)
	expect(fetch).toHaveBeenLastCalledWith(
		new URL(
			`https://recoverage.cloud/reporter/public/${projectId}/${reportRef}`,
		),
		{ method: `GET`, headers: {} },
	)
	await setVisibility(``)
	expect(
		await downloadCoverageReportFromCloud(
			reportRef,
			undefined,
			`https://recoverage.cloud`,
			projectId,
		),
	).toBeInstanceOf(Error)
})
