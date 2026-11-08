import { type } from "arktype"
import { and, eq } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { MiddlewareHandler } from "hono"
import { Hono } from "hono"

import { reporterPutType } from "./coverage-payload"
import { createDatabase } from "./db"
import type { Bindings } from "./env"
import { computeHash } from "./hash"
import { saveReport } from "./reports"
import type { Role } from "./roles-permissions"
import * as schema from "./schema"

type ReporterEnv = {
	Bindings: Bindings
	Variables: {
		drizzle: DrizzleD1Database<typeof schema>
		projectScope: string
		userRole: Role
		githubUserId: number
	}
}
export const reporterRoutes = new Hono<ReporterEnv>()

const reporterAuth: MiddlewareHandler<ReporterEnv> = async (c, next) => {
	const authHeader = c.req.header(`Authorization`)
	if (!authHeader?.startsWith(`Bearer `)) {
		return c.json({ error: `Unauthorized` }, 401)
	}
	const token = authHeader.slice(7) // Remove "Bearer "
	const [id, password] = token.split(`.`)
	if (!id || !password) {
		return c.json({ error: `Invalid token format` }, 401)
	}
	const db = createDatabase(c.env.DB)
	const tokenRecord = await db.query.tokens.findFirst({
		where: eq(schema.tokens.id, id),
		columns: {
			projectId: true,
			salt: true,
			hash: true,
		},
		with: {
			project: {
				with: {
					user: true,
				},
			},
		},
	})

	if (!tokenRecord) {
		return c.json({ error: `Token not found` }, 401)
	}

	const { projectId, salt, hash: realHash } = tokenRecord
	const suppliedHash = await computeHash(password, salt)
	if (suppliedHash !== realHash) {
		return c.json({ error: `Invalid token` }, 401)
	}
	c.set(`drizzle`, db)
	c.set(`projectScope`, projectId)
	c.set(`userRole`, tokenRecord.project.user.role)
	c.set(`githubUserId`, tokenRecord.project.user.id)
	await next()
}

reporterRoutes.get(`/:reportRef`, reporterAuth, async (c) => {
	const reportRef = c.req.param(`reportRef`)
	const projectScope = c.get(`projectScope`)
	const db = c.get(`drizzle`)
	const report = await db.query.reports.findFirst({
		where: and(
			eq(schema.reports.projectId, projectScope),
			eq(schema.reports.ref, reportRef),
		),
	})
	if (!report) {
		return c.json({ error: `No report found` }, 404)
	}
	c.header(`Content-Type`, `application/json`)
	return c.body(report.data)
})

reporterRoutes.put(`/:reportRef`, reporterAuth, async (c) => {
	const payload = reporterPutType(await c.req.json())
	if (payload instanceof type.errors)
		return c.json({ error: `Bad request`, typeErrors: payload.summary }, 400)
	await saveReport(
		c.get(`drizzle`),
		c.get(`projectScope`),
		c.get(`githubUserId`),
		c.get(`userRole`),
		c.req.param(`reportRef`),
		payload,
		401,
	)
	return c.json({ success: true })
})

export * from "./coverage-payload"
