import { env } from "cloudflare:test"
import { istanbulReportFixture, jsonSummaryFixture } from "recoverage-fixtures"

import app from "../src"
import { createDatabase } from "../src/db"
import { computeHash } from "../src/hash"
import {
	hostedReportsAllowed,
	laws,
	projectsAllowed,
	type Role,
	tokensAllowed,
} from "../src/roles-permissions"
import * as schema from "../src/schema"

let nextId = 800_000

function uniqueId(prefix: string): string {
	nextId += 1
	return `${prefix}-${nextId}`
}

async function createProjectToken(role: Role, projectId = uniqueId(`project`)) {
	const db = createDatabase(env.DB)
	const userId = nextId++
	const tokenId = uniqueId(`token`)
	const secret = uniqueId(`secret`)
	const salt = uniqueId(`salt`)
	const hash = await computeHash(secret, salt)

	await db.insert(schema.users).values({
		id: userId,
		manualRoleOverride: role === `free` ? null : role,
	})
	await db
		.insert(schema.projects)
		.values({ id: projectId, userId, name: projectId })
	await db.insert(schema.tokens).values({
		id: tokenId,
		name: tokenId,
		projectId,
		hash,
		salt,
	})

	return {
		db,
		projectId,
		token: `${tokenId}.${secret}`,
		userId,
	}
}

async function createAdditionalProjectToken(userId: number) {
	const db = createDatabase(env.DB)
	const projectId = uniqueId(`project`)
	const tokenId = uniqueId(`token`)
	const secret = uniqueId(`secret`)
	const salt = uniqueId(`salt`)
	const hash = await computeHash(secret, salt)

	await db
		.insert(schema.projects)
		.values({ id: projectId, userId, name: projectId })
	await db.insert(schema.tokens).values({
		id: tokenId,
		name: tokenId,
		projectId,
		hash,
		salt,
	})

	return {
		projectId,
		token: `${tokenId}.${secret}`,
	}
}

async function putReport(
	token: string,
	reportRef: string,
	body = validReportBody,
) {
	return app.request(
		`/reporter/${reportRef}`,
		{
			method: `PUT`,
			headers: {
				Authorization: `Bearer ${token}`,
			},
			body,
		},
		env,
	)
}

const validReportBody = JSON.stringify({
	mapData: istanbulReportFixture,
	jsonSummary: jsonSummaryFixture,
})

test(`tier privileges encode the hosted report model`, () => {
	expect(laws.check(`supporter`, `hostReports_<=3`)).toBe(true)
	expect(laws.check(`supporter`, `hostReports_<=3_<=100`)).toBe(true)
	expect(laws.check(`supporter`, `hostReports_<=3_<=100_<=200`)).toBe(false)

	expect(projectsAllowed.get(`free`)).toBe(3)
	expect(projectsAllowed.get(`supporter`)).toBe(100)
	expect(projectsAllowed.get(`admin`)).toBe(200)

	expect(tokensAllowed.get(`free`)).toBe(5)
	expect(tokensAllowed.get(`supporter`)).toBe(10)
	expect(tokensAllowed.get(`admin`)).toBe(25)

	expect(hostedReportsAllowed.get(`free`)).toBe(3)
	expect(hostedReportsAllowed.get(`supporter`)).toBe(100)
	expect(hostedReportsAllowed.get(`admin`)).toBe(200)
})

test(`hosted report limits are counted across all projects for an account`, async () => {
	const firstProject = await createProjectToken(`free`)
	const secondProject = await createAdditionalProjectToken(firstProject.userId)

	expect(await putReport(firstProject.token, `atom.io`)).toHaveProperty(
		`status`,
		200,
	)
	expect(await putReport(firstProject.token, `treetrunks`)).toHaveProperty(
		`status`,
		200,
	)
	expect(await putReport(secondProject.token, `wayforge`)).toHaveProperty(
		`status`,
		200,
	)

	const fourthReport = await putReport(secondProject.token, `eris`)
	expect(fourthReport.status).toBe(401)
	await expect(fourthReport.json()).resolves.toMatchObject({
		error: `You may not create more hosted reports. Your account tier allows 3.`,
	})
})

test(`existing hosted reports can be updated when the account is at its limit`, async () => {
	const firstProject = await createProjectToken(`free`)
	const secondProject = await createAdditionalProjectToken(firstProject.userId)

	await putReport(firstProject.token, `atom.io`)
	await putReport(firstProject.token, `treetrunks`)
	await putReport(secondProject.token, `wayforge`)

	const existingReportUpdate = await putReport(firstProject.token, `atom.io`)
	expect(existingReportUpdate.status).toBe(200)
})
