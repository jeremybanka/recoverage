import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie"
import { css } from "hono/css"

import { assetsRoutes } from "./assets"
import { getUserRole } from "./billing"
import { billingRoutes } from "./billing-routes"
import { cachedFetch } from "./cached-fetch"
import { createDatabase } from "./db"
import type { Bindings } from "./env"
import { getEnv, GITHUB_CALLBACK_ENDPOINT } from "./env"
import { createGitHubClient } from "./github-client"
import { redactWebhookPayloads } from "./maintenance"
import { Page, SplashPage } from "./page"
import { RoleBadge } from "./pricing"
import { reporterRoutes } from "./reporter"
import * as schema from "./schema"
import { shieldsRoutes } from "./shields"
import { BillingSupport } from "./support"
import type { UiEnv } from "./ui"
import { uiRoutes } from "./ui"
import { AccountUsage, accountUsage, StorageHelp } from "./usage"

const app = new Hono<UiEnv>()

function requestCategory(path: string): string {
	if (path === `/`) return `account`
	const category = path.split(`/`)[1] ?? ``
	return [
		`assets`,
		`billing`,
		`reporter`,
		`ui`,
		`shields`,
		`oauth`,
		`support`,
	].includes(category)
		? category
		: `other`
}

app.use(`*`, async (c, next) => {
	const started = Date.now()
	await next()
	console.info({
		event: `request`,
		route: requestCategory(c.req.path),
		method: c.req.method,
		status: c.res.status,
		durationMs: Date.now() - started,
	})
})

app.onError((_error, c) => {
	console.error({
		event: `request_failed`,
		route: requestCategory(c.req.path),
	})
	return c.json(
		{
			code: `INTERNAL_ERROR`,
			error: `The service could not complete this request. Please retry later.`,
		},
		500,
	)
})

app.route(`assets`, assetsRoutes)
app.route(`billing`, billingRoutes)
app.route(`reporter`, reporterRoutes)
app.route(`ui`, uiRoutes)
app.route(`shields`, shieldsRoutes)

app.get(`/support`, (c) => {
	const config = getEnv(c.env)
	return c.html(
		<Page>
			<h1>Help and billing support</h1>
			<StorageHelp />
			<BillingSupport config={config} />
			{!config.BILLING_SUPPORT_EMAIL ? (
				<p>
					Billing support details will be published before subscriptions open.
				</p>
			) : null}
			<p>
				Existing reports remain readable and replaceable when your account
				reaches its report limit.
			</p>
		</Page>,
	)
})

app.get(`/`, async (c) => {
	const env = getEnv(c.env)
	const url = new URL(c.req.url)
	const githubAccessTokenCookie = await getSignedCookie(
		c,
		env.COOKIE_SECRET,
		`github-access-token`,
	)
	if (!githubAccessTokenCookie) {
		return c.html(
			<SplashPage currentUrl={url} githubClientId={env.GITHUB_CLIENT_ID} />,
		)
	}

	try {
		const octokit = createGitHubClient(githubAccessTokenCookie)

		const { data } = await octokit.request(`GET /user`, {
			request: { fetch: cachedFetch },
		})

		const db = createDatabase(c.env.DB)

		c.set(`drizzle`, db)
		let user = await db
			.select()
			.from(schema.users)
			.where(eq(schema.users.id, data.id))
			.get()
		user ??= (
			await db.insert(schema.users).values({ id: data.id }).returning()
		)[0]

		const userRole = await getUserRole({
			db,
			stripeSupporterPriceId: env.STRIPE_SUPPORTER_PRICE_ID,
			userId: user.id,
		})
		if (!userRole) {
			return c.json({ error: `User did not have a resolvable role.` }, 500)
		}
		const billingState = url.searchParams.get(`billing`)
		const usage = await accountUsage(db, user.id)

		return await c.html(
			<Page>
				<img
					src={data.avatar_url}
					alt={data.login}
					class={css`
					width: 50px;
					position: absolute;
					top: 0;
					left: 20px;
				`}
				/>
				<h1>Recoverage</h1>
				<p>
					Logged in as {data.login} ({data.id}){` `}
					{RoleBadge({
						href: `/ui/upgrade`,
						role: userRole,
					})}
				</p>
				{billingState === `success` ? (
					<p
						class={css`
							margin-top: -4px;
							color: var(--success);
						`}
					>
						Supporter checkout completed. Your account will refresh as Stripe
						events arrive.
					</p>
				) : billingState === `cancel` ? (
					<p
						class={css`
							margin-top: -4px;
							color: var(--color-fg-light);
						`}
					>
						Checkout cancelled.
					</p>
				) : null}
				<AccountUsage usage={usage} role={userRole} userId={user.id} />
				<BillingSupport config={env} />
				<h2>Your Projects</h2>
				<div
					hx-get="/ui/project"
					hx-trigger="load"
					class={css`
					display: flex;
					flex-flow: column;
					gap: 10px;
				`}
				/>
			</Page>,
		)
	} catch {
		console.error({ event: `account_load_failed` })
		deleteCookie(c, `github-access-token`)
		return c.html(
			<SplashPage currentUrl={url} githubClientId={env.GITHUB_CLIENT_ID} />,
		)
	}
})

app.get(GITHUB_CALLBACK_ENDPOINT, async (c) => {
	const env = getEnv(c.env)
	const code = c.req.query(`code`)
	if (!code) {
		return c.json({ error: `No code provided` }, 400)
	}
	const accessTokenUrl = new URL(`https://github.com/login/oauth/access_token`)
	accessTokenUrl.searchParams.set(`client_id`, env.GITHUB_CLIENT_ID)
	accessTokenUrl.searchParams.set(`client_secret`, env.GITHUB_CLIENT_SECRET)
	accessTokenUrl.searchParams.set(`code`, code)

	const accessTokenResponse = await cachedFetch(accessTokenUrl)

	if (!accessTokenResponse.ok) {
		return c.json({ error: `Failed to get access token` }, 400)
	}
	const accessTokenResponseText = await accessTokenResponse.text()

	const params = new URLSearchParams(accessTokenResponseText)
	const accessToken = params.get(`access_token`)
	if (!accessToken) {
		return c.json({ error: `Failed to get access token` }, 400)
	}
	await setSignedCookie(
		c,
		`github-access-token`,
		accessToken,
		env.COOKIE_SECRET,
		{
			sameSite: `strict`,
			httpOnly: true,
			path: `/`,
		},
	)

	return c.html(
		<Page reload>
			<h1>Redirecting...</h1>
		</Page>,
	)
})
export default Object.assign(app, {
	async scheduled(_event: ScheduledController, bindings: Bindings) {
		const redacted = await redactWebhookPayloads(bindings.DB)
		console.info({ event: `webhook_retention`, redacted })
	},
})
