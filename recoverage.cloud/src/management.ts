import { and, eq, inArray, sql } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import { HTTPException } from "hono/http-exception"
import { nanoid } from "nanoid"

import { computeHash } from "./hash"
import { getProjectLimit, type Role, tokensAllowed } from "./roles-permissions"
import * as schema from "./schema"

type Database = DrizzleD1Database<typeof schema>
type Project = typeof schema.projects.$inferSelect
type ListedProject = Project & {
	tokens: Pick<typeof schema.tokens.$inferSelect, `createdAt` | `id` | `name`>[]
	reports: Pick<
		typeof schema.reports.$inferSelect,
		`createdAt` | `jsonSummary` | `ref`
	>[]
}

export function managementError(
	status: 400 | 401 | 403 | 404 | 502,
	error: string,
): never {
	throw new HTTPException(status, {
		res: Response.json({ error }, { status }),
	})
}

function validateName(name: string) {
	if (!name.trim() || name.length > 128) {
		managementError(400, `Name must contain 1–128 characters.`)
	}
}

export async function listProjects(
	db: Database,
	userId: number,
): Promise<ListedProject[]> {
	return db.query.projects.findMany({
		where: eq(schema.projects.userId, userId),
		with: {
			tokens: { columns: { id: true, name: true, createdAt: true } },
			reports: { columns: { ref: true, jsonSummary: true, createdAt: true } },
		},
	})
}

export async function getProject(
	db: Database,
	userId: number,
	projectId: string,
): Promise<Project> {
	const project = await db.query.projects.findFirst({
		where: and(
			eq(schema.projects.id, projectId),
			eq(schema.projects.userId, userId),
		),
	})
	if (!project) managementError(404, `No project found`)
	return project
}

export async function renameProject(
	db: Database,
	userId: number,
	projectId: string,
	name: string,
): Promise<Project> {
	validateName(name)
	const [project] = await db
		.update(schema.projects)
		.set({ name })
		.where(
			and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
		)
		.returning()
	if (!project) managementError(404, `No project found`)
	return project
}

export async function deleteProject(
	db: Database,
	userId: number,
	projectId: string,
): Promise<Project> {
	const [project] = await db
		.delete(schema.projects)
		.where(
			and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
		)
		.returning()
	if (!project) managementError(404, `No project found`)
	return project
}

export async function createProject(
	db: Database,
	userId: number,
	role: Role,
	name: string,
): Promise<Project> {
	validateName(name)
	const limit = Math.min(getProjectLimit(role, userId), Number.MAX_SAFE_INTEGER)
	// Count and insert in one statement so concurrent clients cannot exceed quotas.
	const [project] = await db
		.insert(schema.projects)
		.select(sql`
		select ${nanoid()} as id, ${userId} as userId, ${name} as name,
		current_timestamp as createdAt
		where (select count(*) from ${schema.projects} where ${schema.projects.userId} = ${userId}) < ${limit}
	`)
		.returning()
	if (!project) managementError(403, `You may not create more projects`)
	return project
}

export async function createReporterToken(
	db: Database,
	userId: number,
	role: Role,
	projectId: string,
	name: string,
): Promise<{
	id: string
	name: string
	createdAt: string
	secret: string
	token: string
}> {
	validateName(name)
	await getProject(db, userId, projectId)
	const id = nanoid()
	const secret = nanoid(48)
	const salt = nanoid()
	const hash = await computeHash(secret, salt)
	const limit = tokensAllowed.get(role)
	const [token] = await db
		.insert(schema.tokens)
		.select(sql`
		select ${id} as id, ${name} as name, ${hash} as hash, ${salt} as salt,
		${projectId} as projectId, current_timestamp as createdAt
		where (select count(*) from ${schema.tokens} where ${schema.tokens.projectId} = ${projectId}) < ${limit}
	`)
		.returning({
			id: schema.tokens.id,
			name: schema.tokens.name,
			createdAt: schema.tokens.createdAt,
		})
	if (!token) managementError(403, `You may not create more tokens`)
	return { ...token, secret, token: `${id}.${secret}` }
}

export async function revokeReporterToken(
	db: Database,
	userId: number,
	tokenId: string,
): Promise<{ id: string; name: string }> {
	const [token] = await db
		.delete(schema.tokens)
		.where(
			and(
				eq(schema.tokens.id, tokenId),
				inArray(
					schema.tokens.projectId,
					db
						.select({ id: schema.projects.id })
						.from(schema.projects)
						.where(eq(schema.projects.userId, userId)),
				),
			),
		)
		.returning({ id: schema.tokens.id, name: schema.tokens.name })
	if (!token) managementError(404, `No token found`)
	return token
}
