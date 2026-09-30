import type { Endpoints } from "@octokit/types"
import { type } from "arktype"
import { and, eq } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { MiddlewareHandler } from "hono"
import { Hono } from "hono"
import { deleteCookie, getSignedCookie } from "hono/cookie"
import { css } from "hono/css"
import { nanoid } from "nanoid"

import { getUserRole } from "./billing"
import { billingAccount, BillingAccountPage } from "./billing-account"
import { cachedFetch } from "./cached-fetch"
import { createDatabase } from "./db"
import { type Bindings, getEnv } from "./env"
import { createGitHubClient } from "./github-client"
import { computeHash } from "./hash"
import { Page } from "./page"
import { PricingPage } from "./pricing"
import { Project, ProjectControls, ProjectToken, TokenControls } from "./project"
import { projectsAllowed, type Role, tokensAllowed } from "./roles-permissions"
import * as schema from "./schema"
import { AccountUsage, accountUsage } from "./usage"

type GithubUserData = Endpoints[`GET /user`][`response`][`data`] & {
	id: number
}

export type UiEnv = {
	Bindings: Bindings
	Variables: {
		drizzle: DrizzleD1Database<typeof schema>
		githubUserData: GithubUserData
		userRole: Role
		projectScope: string
		requestId: string
	}
}
export const uiRoutes = new Hono<UiEnv>()

const uiAuth: MiddlewareHandler<UiEnv> = async (c, next) => {
	const env = getEnv(c.env)
	const githubAccessTokenCookie = await getSignedCookie(
		c,
		env.COOKIE_SECRET,
		`github-access-token`,
	)

	if (!githubAccessTokenCookie) {
		return c.json({ error: `Unauthorized` }, 401)
	}

	const octokit = createGitHubClient(githubAccessTokenCookie)

	const userResponse = await octokit
		.request(`GET /user`, {
			request: { fetch: cachedFetch },
		})
		.catch((error: unknown) => {
			// Only an actual authentication rejection should end the session.
			// Outages and rate limits must propagate without discarding the cookie.
			if (error instanceof Error && `status` in error && error.status === 401)
				return null
			throw error
		})
	if (!userResponse) {
		deleteCookie(c, `github-access-token`, { path: `/` })
		c.header(`Cache-Control`, `no-store`)
		if (c.req.header(`HX-Request`) === `true`) c.header(`HX-Redirect`, `/`)
		return c.json(
			{
				error: `Your GitHub session has expired or been revoked. Please sign in again.`,
				loginUrl: `/oauth/github`,
			},
			401,
		)
	}
	const { data, status } = userResponse
	if (status !== 200)
		throw new Error(`GitHub user lookup returned an unexpected response.`)
	if (typeof data.id !== `number` || !Number.isSafeInteger(data.id)) {
		return c.json({ error: `GitHub returned an unsupported user ID.` }, 500)
	}

	const db = createDatabase(c.env.DB)

	const maybeUser = await db.query.users.findFirst({
		where: eq(schema.users.id, data.id),
		columns: { id: true },
	})

	if (!maybeUser) {
		deleteCookie(c, `github-access-token`)
		return c.json(
			{ error: `User did not move through the expected auth flow.` },
			500,
		)
	}
	const userRole = await getUserRole({
		db,
		stripeSupporterPriceId: env.STRIPE_SUPPORTER_PRICE_ID,
		userId: maybeUser.id,
	})
	if (!userRole) {
		return c.json({ error: `User did not have a resolvable role.` }, 500)
	}

	c.set(`drizzle`, db)
	c.set(`githubUserData`, data)
	c.set(`userRole`, userRole)

	await next()
}

uiRoutes.get(`/billing`, uiAuth, async (c) => {
	c.header(`Cache-Control`, `no-store`)
	return c.html(
		<Page>
			<BillingAccountPage
				account={
					await billingAccount(
						c.get(`drizzle`),
						c.get(`githubUserData`).id,
						c.get(`userRole`),
					)
				}
				config={getEnv(c.env)}
				returnState={c.req.query(`billing`)}
			/>
		</Page>,
	)
})

uiRoutes.get(`/upgrade`, uiAuth, async (c) => {
	const account = await billingAccount(
		c.get(`drizzle`),
		c.get(`githubUserData`).id,
		c.get(`userRole`),
	)
	c.header(`Cache-Control`, `no-store`)
	return c.html(
		<Page>
			<PricingPage
				currentRole={c.get(`userRole`)}
				config={getEnv(c.env)}
				hasExistingSubscription={account.subscriptions.some(
					(subscription) =>
						subscription.status !== `canceled` &&
						subscription.status !== `incomplete_expired`,
				)}
			/>
		</Page>,
	)
})

uiRoutes.get(`/usage`, uiAuth, async (c) => {
	const userId = c.get(`githubUserData`).id
	return c.html(
		<AccountUsage
			usage={await accountUsage(c.get(`drizzle`), userId)}
			userId={userId}
			role={c.get(`userRole`)}
		/>,
	)
})

uiRoutes.get(`/project-usage`, uiAuth, async (c) => {
	const usage = await accountUsage(c.get(`drizzle`), c.get(`githubUserData`).id)
	return c.html(
		<ProjectControls count={usage.projects} role={c.get(`userRole`)} />,
	)
})

uiRoutes.get(`/token-usage/:projectId`, uiAuth, async (c) => {
	const project = await c.get(`drizzle`).query.projects.findFirst({
		where: and(
			eq(schema.projects.id, c.req.param(`projectId`)),
			eq(schema.projects.userId, c.get(`githubUserData`).id),
		),
		with: { tokens: { columns: { id: true } } },
	})
	if (!project) return c.text(`No project found`, 404)
	return c.html(
		<TokenControls
			projectId={project.id}
			count={project.tokens.length}
			role={c.get(`userRole`)}
		/>,
	)
})

uiRoutes.get(`/project`, uiAuth, async (c) => {
	const db = c.get(`drizzle`)
	const user = c.get(`githubUserData`)
	const projects = await db.query.projects.findMany({
		where: eq(schema.projects.userId, user.id),
		with: {
			tokens: true,
			reports: {
				columns: {
					ref: true,
					jsonSummary: true,
				},
			},
		},
	})

	const userRole = c.get(`userRole`)
	return c.html(
		<>
			<div
				id="project-list"
				class={css`
				display: flex;
				flex-direction: column;
				gap: 10px;
			`}
			>
				{projects.map((project) => (
					<Project
						{...project}
						mode="existing"
						userRole={userRole}
						key={project.id}
					/>
				))}
			</div>
			<ProjectControls count={projects.length} role={userRole} />
		</>,
	)
})

uiRoutes.post(`/project`, uiAuth, async (c) => {
	const userRole = c.get(`userRole`)
	const numberOfProjectsAllowed = projectsAllowed.get(userRole)
	const { id: userId } = c.get(`githubUserData`)

	const formData = await c.req.formData()
	const name = type(`string`)(formData.get(`name`))

	if (name instanceof type.errors) {
		return c.html(<Project mode="creator" />)
	}
	// Admission and insertion share one statement so concurrent requests cannot
	// spend the same remaining project slot.
	const project = await c.env.DB.prepare(
		`INSERT INTO projects (id, userId, name)
		 SELECT ?1, ?2, ?3
		 WHERE (SELECT count(*) FROM projects WHERE userId = ?2) < ?4
		 RETURNING *`,
	)
		.bind(nanoid(), userId, name, numberOfProjectsAllowed)
		.first<typeof schema.projects.$inferSelect>()
	if (!project) {
		return c.json(
			{
				error: `Your account is at its project limit. Existing projects remain available.`,
			},
			403,
		)
	}
	c.header(`HX-Trigger`, `usage-changed`)
	return c.html(
		<Project
			{...project}
			mode="existing"
			userRole={userRole}
			tokens={[]}
			reports={[]}
		/>,
	)
})

uiRoutes.delete(`/project/:projectId`, uiAuth, async (c) => {
	const db = c.get(`drizzle`)
	const projectId = c.req.param(`projectId`)
	const userId = c.get(`githubUserData`).id
	const project = await db.query.projects.findFirst({
		with: {
			tokens: true,
			reports: true,
		},
		where: and(
			eq(schema.projects.id, projectId),
			eq(schema.projects.userId, userId),
		),
	})
	if (!project) {
		return c.json({ error: `No project found` }, 404)
	}

	await db
		.delete(schema.projects)
		.where(
			and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
		)
	c.header(`HX-Trigger`, `usage-changed`)
	return c.html(
		<Project
			{...project}
			userRole={c.get(`userRole`)}
			tokens={project.tokens.map((token) => ({ ...token, mode: `deleted` }))}
			mode="deleted"
		/>,
	)
})

uiRoutes.post(`/token/:projectId`, uiAuth, async (c) => {
	const db = c.get(`drizzle`)
	const userId = c.get(`githubUserData`).id

	const formData = await c.req.formData()
	const name = type(`string`)(formData.get(`name`))
	const projectId = c.req.param(`projectId`)

	const project = await db.query.projects.findFirst({
		where: and(
			eq(schema.projects.id, projectId),
			eq(schema.projects.userId, userId),
		),
		columns: { id: true },
	})

	if (!project) {
		return c.json({ error: `No project found` }, 404)
	}
	const numberOfTokensAllowed = tokensAllowed.get(c.get(`userRole`))
	if (name instanceof type.errors) {
		return c.html(<ProjectToken mode="creator" projectId={projectId} />)
	}
	const id = nanoid()
	const secret = nanoid()
	const salt = nanoid()
	const hash = await computeHash(secret, salt)

	// Recheck ownership in the atomic write as well as the initial UI lookup.
	const token = await c.env.DB.prepare(
		`INSERT INTO tokens (id, name, hash, salt, projectId)
		 SELECT ?1, ?2, ?3, ?4, ?5
		 WHERE EXISTS (SELECT 1 FROM projects WHERE id = ?5 AND userId = ?6)
		 AND (SELECT count(*) FROM tokens WHERE projectId = ?5) < ?7
		 RETURNING *`,
	)
		.bind(id, name, hash, salt, projectId, userId, numberOfTokensAllowed)
		.first<typeof schema.tokens.$inferSelect>()
	if (!token) {
		return c.json(
			{
				error: `This project is at its token limit. Existing tokens remain usable.`,
			},
			403,
		)
	}
	c.header(`HX-Trigger`, `usage-changed`)
	return c.html(
		<ProjectToken {...token} mode="existing" secretShownOnce={secret} />,
	)
})

uiRoutes.delete(`/token/:tokenId`, uiAuth, async (c) => {
	const db = c.get(`drizzle`)
	const tokenId = c.req.param(`tokenId`)
	const userId = c.get(`githubUserData`).id
	const token = await db.query.tokens.findFirst({
		with: {
			project: {
				with: {
					user: true,
				},
			},
		},
		where: eq(schema.tokens.id, tokenId),
	})
	if (!token) {
		return c.json({ error: `No token found` }, 404)
	}
	if (token.project.user.id !== userId) {
		return c.json({ error: `Not your token` }, 401)
	}

	await db.delete(schema.tokens).where(eq(schema.tokens.id, tokenId)).run()

	c.header(`HX-Trigger`, `usage-changed`)
	return c.html(<ProjectToken {...token} mode="deleted" />)
})
