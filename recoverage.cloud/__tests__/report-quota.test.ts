import { env } from "cloudflare:test"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { nanoid } from "nanoid"
import { istanbulReportFixture, jsonSummaryFixture } from "recoverage-fixtures"

import app from "../src"
import { createDatabase } from "../src/db"
import { computeHash } from "../src/hash"
import { Project } from "../src/project"
import * as schema from "../src/schema"

const db = createDatabase(env.DB)
const payload = {
	mapData: istanbulReportFixture,
	jsonSummary: jsonSummaryFixture,
}
const projectIds: string[] = []

async function createReporter(userId: number) {
	await db.insert(schema.users).values({ id: userId }).onConflictDoNothing()
	const projectId = nanoid()
	projectIds.push(projectId)
	await db.insert(schema.projects).values({
		id: projectId,
		userId,
		name: `Quota test`,
	})
	const tokenId = nanoid()
	const password = nanoid()
	const salt = nanoid()
	await db.insert(schema.tokens).values({
		id: tokenId,
		projectId,
		name: `Quota test`,
		salt,
		hash: await computeHash(password, salt),
	})
	return { projectId, token: `${tokenId}.${password}` }
}

function upload(token: string, ref: string, body: unknown = payload) {
	return app.request(
		`/reporter/${ref}`,
		{
			method: `PUT`,
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify(body),
		},
		env,
	)
}

function download(token: string, ref: string) {
	return app.request(
		`/reporter/${ref}`,
		{ headers: { Authorization: `Bearer ${token}` } },
		env,
	)
}

afterEach(async () => {
	for (const projectId of projectIds.splice(0)) {
		await db.delete(schema.projects).where(eq(schema.projects.id, projectId))
	}
})

test(`the maintainer can upload, retain, and update reports beyond the quota`, async () => {
	const { token, projectId } = await createReporter(8570459)
	for (let idx = 0; idx < 5; idx++) {
		expect((await upload(token, `report-${idx}`)).status).toBe(200)
	}
	const updatedPayload = { ...payload, mapData: {} }
	expect((await upload(token, `report-0`, updatedPayload)).status).toBe(200)

	for (let idx = 0; idx < 5; idx++) {
		const response = await download(token, `report-${idx}`)
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual(idx === 0 ? {} : payload.mapData)
	}
	const reports = await db.query.reports.findMany({
		where: eq(schema.reports.projectId, projectId),
	})
	expect(reports).toHaveLength(5)

	const preview = new Hono().get(`/`, async (c) =>
		c.html(
			await Project({
				id: projectId,
				name: `Quota test`,
				tokens: [],
				reports,
				mode: `existing`,
				userRole: `free`,
			}),
		),
	)
	const html = await (await preview.request(`/`)).text()
	for (let idx = 0; idx < 5; idx++) {
		expect(html).toContain(`report-${idx}`)
	}
})

test(`other accounts keep their quota even if they claim the maintainer's identity`, async () => {
	const { token, projectId } = await createReporter(1974001)
	for (let idx = 0; idx < 3; idx++) {
		expect((await upload(token, `report-${idx}`)).status).toBe(200)
	}
	const rejected = await upload(token, `report-3`, {
		...payload,
		githubUserId: 8570459,
		login: `jeremybanka`,
		userId: 8570459,
	})
	expect(rejected.status).toBe(401)
	expect(await rejected.json()).toEqual({
		error: `You may not create more reports`,
	})
	expect((await download(token, `report-3`)).status).toBe(404)
	expect(
		await db.query.reports.findMany({
			where: eq(schema.reports.projectId, projectId),
		}),
	).toHaveLength(3)
})

test(`exempt accounts still require valid payloads, refs, and credentials`, async () => {
	const { token, projectId } = await createReporter(8570459)
	for (let idx = 0; idx < 3; idx++) {
		expect((await upload(token, `report-${idx}`)).status).toBe(200)
	}
	const invalidPayload = structuredClone(payload)
	Object.assign(invalidPayload.jsonSummary.total.statements, { pct: `Unknown` })
	const invalid = await upload(token, `invalid`, invalidPayload)
	expect(invalid.status).toBe(400)
	expect(await invalid.json()).toMatchObject({ error: `Bad request` })
	expect((await upload(token, `x`.repeat(65))).status).toBe(400)
	expect((await upload(`${token}wrong`, `invalid-token`)).status).toBe(401)
	expect(
		(await app.request(`/reporter/missing-token`, { method: `PUT` }, env))
			.status,
	).toBe(401)
	expect(
		await db.query.reports.findMany({
			where: eq(schema.reports.projectId, projectId),
		}),
	).toHaveLength(3)
})

test(`an exempt account's token stays scoped to its own project`, async () => {
	const owner = await createReporter(8570459)
	const otherProject = await createReporter(8570459)
	const otherAccount = await createReporter(1974001)
	for (const other of [otherProject, otherAccount]) {
		expect((await upload(other.token, `private-report`)).status).toBe(200)
	}
	expect((await download(owner.token, `private-report`)).status).toBe(404)
	expect(
		(
			await upload(owner.token, `private-report`, {
				...payload,
				mapData: {},
				projectId: otherAccount.projectId,
			})
		).status,
	).toBe(200)
	for (const other of [otherProject, otherAccount]) {
		expect(await (await download(other.token, `private-report`)).json()).toEqual(
			payload.mapData,
		)
	}
})
