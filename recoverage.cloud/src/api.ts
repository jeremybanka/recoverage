import { and, eq, gt, lte } from "drizzle-orm"
import { Hono } from "hono"
import { validator } from "hono/validator"
import { nanoid } from "nanoid"
import { Octokit } from "octokit"

import { createDatabase } from "./db"
import type { Bindings } from "./env"
import { computeHash } from "./hash"
import {
	createProject,
	createReporterToken,
	getProject,
	listProjects,
	managementError,
	revokeReporterToken,
} from "./management"
import {
	getProjectLimit,
	reportsAllowed,
	tokensAllowed,
	unlimitedReportGithubUserIds,
} from "./roles-permissions"
import * as schema from "./schema"

type ApiEnv = {
	Bindings: Bindings
	Variables: {
		drizzle: ReturnType<typeof createDatabase>
		user: typeof schema.users.$inferSelect
		session: typeof schema.accountSessions.$inferSelect
	}
}

function jsonObject(value: unknown): Record<string, unknown> {
	if (value && typeof value === `object` && !Array.isArray(value))
		return value as Record<string, unknown>
	return managementError(400, `Expected a JSON object.`)
}

function stringField(body: Record<string, unknown>, field: string) {
	const value = body[field]
	if (typeof value !== `string` || !value || value.length > 512) {
		managementError(400, `Invalid ${field}.`)
	}
	return value
}

async function githubPost(
	url: string,
	body: URLSearchParams,
): Promise<{ response: Response; data: Record<string, unknown> }> {
	try {
		const response = await fetch(url, {
			method: `POST`,
			signal: AbortSignal.timeout(10_000),
			headers: {
				Accept: `application/json`,
				"Content-Type": `application/x-www-form-urlencoded`,
			},
			body,
		})
		const data = await response.json<unknown>()
		if (!data || typeof data !== `object` || Array.isArray(data))
			throw new Error(`Invalid response`)
		return { response, data: data as Record<string, unknown> }
	} catch {
		return managementError(
			502,
			`GitHub login is temporarily unavailable. Try again.`,
		)
	}
}

export const apiRoutes = new Hono<ApiEnv>()
	.use(`*`, async (c, next) => {
		c.header(`Cache-Control`, `no-store`)
		await next()
	})
	.post(`/auth/device`, async (c) => {
		const { response, data } = await githubPost(
			`https://github.com/login/device/code`,
			new URLSearchParams({
				client_id: c.env.GITHUB_CLIENT_ID,
				scope: `read:user`,
			}),
		)
		if (
			!response.ok ||
			typeof data[`device_code`] !== `string` ||
			typeof data[`user_code`] !== `string` ||
			typeof data[`verification_uri`] !== `string` ||
			typeof data[`expires_in`] !== `number` ||
			typeof data[`interval`] !== `number`
		) {
			return c.json(
				{
					error: `GitHub device login is unavailable. Enable device flow for the OAuth app.`,
				},
				502,
			)
		}
		return c.json(
			{
				deviceCode: data[`device_code`],
				userCode: data[`user_code`],
				verificationUri: data[`verification_uri`],
				expiresIn: data[`expires_in`],
				interval: data[`interval`],
			},
			200,
		)
	})
	.post(
		`/auth/session`,
		validator(`json`, (value) => ({
			deviceCode: stringField(jsonObject(value), `deviceCode`),
		})),
		async (c) => {
			const { deviceCode } = c.req.valid(`json`)
			const { response, data } = await githubPost(
				`https://github.com/login/oauth/access_token`,
				new URLSearchParams({
					client_id: c.env.GITHUB_CLIENT_ID,
					client_secret: c.env.GITHUB_CLIENT_SECRET,
					device_code: deviceCode,
					grant_type: `urn:ietf:params:oauth:grant-type:device_code`,
				}),
			)
			if (
				data[`error`] === `authorization_pending` ||
				data[`error`] === `slow_down`
			) {
				return c.json({ error: data[`error`] }, 202)
			}
			if (!response.ok || typeof data[`access_token`] !== `string`) {
				return c.json(
					{
						error: `GitHub login expired or was denied. Run cloud login again.`,
					},
					401,
				)
			}
			let githubUser: { id: number; login: string }
			try {
				const octokit = new Octokit({ auth: data[`access_token`] })
				githubUser = (
					await octokit.request(`GET /user`, {
						request: { signal: AbortSignal.timeout(10_000) },
					})
				).data
			} catch {
				return c.json({ error: `Could not verify GitHub identity.` }, 401)
			}
			if (
				!Number.isSafeInteger(githubUser.id) ||
				githubUser.id <= 0 ||
				typeof githubUser.login !== `string` ||
				!githubUser.login
			) {
				return c.json({ error: `GitHub returned an unsupported identity.` }, 502)
			}
			const db = createDatabase(c.env.DB)
			await db
				.insert(schema.users)
				.values({ id: githubUser.id })
				.onConflictDoNothing()
			await db
				.delete(schema.accountSessions)
				.where(lte(schema.accountSessions.expiresAt, Date.now()))
			const id = `rca_${nanoid()}`
			const secret = nanoid(48)
			const salt = nanoid()
			const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000
			await db.insert(schema.accountSessions).values({
				id,
				userId: githubUser.id,
				githubLogin: githubUser.login,
				hash: await computeHash(secret, salt),
				salt,
				expiresAt,
			})
			return c.json(
				{
					token: `${id}.${secret}`,
					expiresAt,
					account: { id: githubUser.id, login: githubUser.login },
				},
				201,
			)
		},
	)
	.use(`*`, async (c, next) => {
		const credential = c.req
			.header(`Authorization`)
			?.match(/^Bearer (rca_[\w-]+)\.([\w-]+)$/)
		if (!credential)
			return c.json(
				{ error: `Run recoverage cloud login to authenticate.` },
				401,
			)
		const db = createDatabase(c.env.DB)
		const session = await db
			.select()
			.from(schema.accountSessions)
			.where(
				and(
					eq(schema.accountSessions.id, credential[1]),
					gt(schema.accountSessions.expiresAt, Date.now()),
				),
			)
			.get()
		const unauthorized = () =>
			c.json(
				{
					error: `Account credential is invalid or expired. Run recoverage cloud login.`,
				},
				401,
			)
		if (!session) return unauthorized()
		if ((await computeHash(credential[2], session.salt)) !== session.hash)
			return unauthorized()
		const user = await db
			.select()
			.from(schema.users)
			.where(eq(schema.users.id, session.userId))
			.get()
		if (!user) return c.json({ error: `Account not found.` }, 401)
		c.set(`drizzle`, db)
		c.set(`session`, session)
		c.set(`user`, user)
		await next()
	})
	.delete(`/auth/session`, async (c) => {
		await c
			.get(`drizzle`)
			.delete(schema.accountSessions)
			.where(eq(schema.accountSessions.id, c.get(`session`).id))
		return c.json({ success: true }, 200)
	})
	.get(`/account`, (c) => {
		const user = c.get(`user`)
		return c.json(
			{
				id: user.id,
				login: c.get(`session`).githubLogin,
				role: user.role,
				expiresAt: c.get(`session`).expiresAt,
				limits: {
					projects: Number.isFinite(getProjectLimit(user.role, user.id))
						? getProjectLimit(user.role, user.id)
						: null,
					reports: unlimitedReportGithubUserIds.has(user.id)
						? null
						: reportsAllowed.get(user.role),
					tokens: tokensAllowed.get(user.role),
				},
			},
			200,
		)
	})
	.get(`/projects`, async (c) =>
		c.json(
			{ projects: await listProjects(c.get(`drizzle`), c.get(`user`).id) },
			200,
		),
	)

	.post(
		`/projects`,
		validator(`json`, (value) => ({
			name: stringField(jsonObject(value), `name`),
		})),
		async (c) => {
			const { name } = c.req.valid(`json`)
			const user = c.get(`user`)
			return c.json(
				await createProject(c.get(`drizzle`), user.id, user.role, name),
				201,
			)
		},
	)
	.post(
		`/projects/:projectId/tokens`,
		validator(`json`, (value) => ({
			name: stringField(jsonObject(value), `name`),
		})),
		async (c) => {
			const { name } = c.req.valid(`json`)
			const user = c.get(`user`)
			const { secret: _secret, ...token } = await createReporterToken(
				c.get(`drizzle`),
				user.id,
				user.role,
				c.req.param(`projectId`),
				name,
			)
			return c.json(token, 201)
		},
	)
	.delete(`/projects/:projectId/tokens/:tokenId`, async (c) => {
		const db = c.get(`drizzle`)
		const userId = c.get(`user`).id
		const projectId = c.req.param(`projectId`)
		await getProject(db, userId, projectId)
		const tokenId = c.req.param(`tokenId`)
		const token = await db.query.tokens.findFirst({
			where: and(
				eq(schema.tokens.id, tokenId),
				eq(schema.tokens.projectId, projectId),
			),
			columns: { id: true },
		})
		if (!token) return c.json({ error: `No token found` }, 404)
		await revokeReporterToken(db, userId, tokenId)
		return c.json({ success: true, id: tokenId }, 200)
	})

export type CloudApi = typeof apiRoutes
