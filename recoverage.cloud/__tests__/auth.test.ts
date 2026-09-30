import { env } from "cloudflare:test"
import { XMLParser } from "fast-xml-parser"
import { createCoverageMap } from "istanbul-lib-coverage"
import {
	downloadCoverageReportFromCloud,
	uploadCoverageReportToCloud,
} from "recoverage/lib"
import { istanbulReportFixture, jsonSummaryFixture } from "recoverage-fixtures"

import app from "../src"
import { GITHUB_CALLBACK_ENDPOINT } from "../src/env"

afterEach(() => {
	vi.restoreAllMocks()
})

test(`authentication flow`, async () => {
	vi.spyOn(globalThis, `fetch`).mockImplementation(async (input, init) => {
		await Promise.resolve()
		const request = new Request(input, init)
		const url = new URL(request.url)

		console.log(`[intercepted]`, request.method, url.origin + url.pathname)

		switch (`${request.method} ${url.origin}${url.pathname}`) {
			case `POST https://github.com/login/oauth/access_token`: {
				expect(url.search).toBe(``)
				const body = await request.formData()
				expect(body.get(`code`)).toBe(`mocked-github-token`)
				expect(body.get(`client_id`)).toBe(env.GITHUB_CLIENT_ID)
				expect(body.get(`client_secret`)).toBe(env.GITHUB_CLIENT_SECRET)
				expect(body.get(`redirect_uri`)).toBe(
					`https://recoverage.cloud${GITHUB_CALLBACK_ENDPOINT}`,
				)
				return new Response(`access_token=gho_fake&scope=user&token_type=bearer`)
			}
			case `GET https://api.github.com/user`:
				return Response.json({
					id: 12345,
					login: `testuser`,
					email: `testuser@example.com`,
				})

			default:
				// handle with the worker
				return app.request(input, init, env)
		}
	})

	const response = await app.request(`/`, { method: `GET` }, env)
	expect(response.status).toBe(200)

	expect(await response.text()).toContain(`href="/oauth/github"`)
	const start = await app.request(
		`https://recoverage.cloud/oauth/github`,
		{},
		env,
	)
	expect(start.status).toBe(302)
	expect(start.headers.get(`Cache-Control`)).toBe(`no-store`)
	const authorizeUrl = new URL(start.headers.get(`location`) ?? ``)
	expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(
		`https://github.com/login/oauth/authorize`,
	)
	const stateCookie = start.headers.get(`set-cookie`)
	assert(stateCookie)
	expect(stateCookie).toContain(`HttpOnly`)
	expect(stateCookie).toContain(`Secure`)
	expect(stateCookie).toContain(`SameSite=Lax`)
	expect(stateCookie).toContain(`Max-Age=600`)
	const callbackUrl = new URL(
		GITHUB_CALLBACK_ENDPOINT,
		`https://recoverage.cloud`,
	)
	callbackUrl.searchParams.set(`code`, `mocked-github-token`)
	callbackUrl.searchParams.set(
		`state`,
		authorizeUrl.searchParams.get(`state`) ?? ``,
	)
	const authRes = await app.request(
		callbackUrl.href,
		{ headers: { Cookie: stateCookie } },
		env,
	)
	expect(authRes.status).toBe(200)
	expect(authRes.headers.get(`Cache-Control`)).toBe(`no-store`)
	expect(
		authRes.headers
			.getSetCookie()
			.some(
				(cookie) =>
					cookie.startsWith(`github-oauth-state=`) &&
					cookie.includes(`Max-Age=0`),
			),
	).toBe(true)
	const githubAccessTokenCookie = authRes.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith(`github-access-token=`))

	assert(githubAccessTokenCookie)
	expect(githubAccessTokenCookie).toContain(`SameSite=Lax`)
	expect(githubAccessTokenCookie).toContain(`Secure`)
	expect(githubAccessTokenCookie).toContain(`HttpOnly`)
	expect(githubAccessTokenCookie).toContain(`Path=/`)

	const response2 = await fetch(`https://recoverage.cloud/`, {
		method: `GET`,
		headers: {
			Cookie: githubAccessTokenCookie,
		},
	})
	expect(response2.status).toBe(200)
	const response2Text = await response2.text()
	const htmxConfig = `<meta name="htmx-config" content="{&quot;noSwap&quot;:[204,304,&quot;4xx&quot;,&quot;5xx&quot;]}"/>`
	expect(response2Text).toContain(htmxConfig)
	expect(response2Text.indexOf(htmxConfig)).toBeLessThan(
		response2Text.indexOf(`<script>var htmx=`),
	)
	expect(response2Text).toContain(`Logged in as testuser (12345)`)
	expect(response2Text).toContain(`href="/ui/upgrade"`)

	const upgradeResponse = await fetch(`https://recoverage.cloud/ui/upgrade`, {
		method: `GET`,
		headers: {
			Cookie: githubAccessTokenCookie,
		},
	})
	expect(upgradeResponse.status).toBe(200)
	const upgradeText = await upgradeResponse.text()
	expect(upgradeText).toContain(`New subscriptions are currently unavailable.`)
	expect(upgradeText).not.toContain(`action="/billing/checkout"`)

	const project = await fetch(`https://recoverage.cloud/ui/project`, {
		method: `POST`,
		headers: {
			Cookie: githubAccessTokenCookie,
			"Content-Type": `application/x-www-form-urlencoded`,
		},
		body: `name=test`,
	})
	const projectText = await project.text()
	expect(project.headers.get(`HX-Trigger`)).toBe(`usage-changed`)

	const hxPost = projectText.match(/hx-post="([^"]+)"/)
	const postTokenToProjectPath = hxPost?.[1]
	assert(postTokenToProjectPath)
	const postTokenToProjectUrl = new URL(
		postTokenToProjectPath,
		`https://recoverage.cloud`,
	)
	console.log({ postTokenToProjectUrl: postTokenToProjectPath })
	const projectId = postTokenToProjectPath.split(`/`)[3]

	console.log({ projectId })

	const token = await fetch(postTokenToProjectUrl, {
		method: `POST`,
		headers: {
			Cookie: githubAccessTokenCookie,
			"Content-Type": `application/x-www-form-urlencoded`,
		},
		body: `name=test`,
	})

	const tokenText = await token.text()
	expect(token.headers.get(`HX-Trigger`)).toBe(`usage-changed`)
	const controls = await fetch(
		`https://recoverage.cloud/ui/token-usage/${projectId}`,
		{ headers: { Cookie: githubAccessTokenCookie } },
	)
	expect(await controls.text()).toContain(`1 / 5 tokens`)
	const counters = await Promise.all(
		[`usage`, `project-usage`].map((path) =>
			fetch(`https://recoverage.cloud/ui/${path}`, {
				headers: { Cookie: githubAccessTokenCookie },
			}),
		),
	)
	for (const counter of counters) expect(counter.status).toBe(200)
	expect(await counters[0].text()).toContain(`Projects: 1 / 3`)
	const parser = new XMLParser()
	const tokenXml = parser.parse(tokenText)
	const code = tokenXml.div.div[0].span.code
	console.log({ code })
	assert(code)

	const reportRef = `atom.io`
	const reportMissing = await fetch(
		`https://recoverage.cloud/reporter/${reportRef}`,
		{
			method: `GET`,
			headers: {
				Authorization: `Bearer ${code}`,
			},
		},
	)
	console.log(await reportMissing.json())
	expect(reportMissing.status).toBe(404)

	const reportMissingLib = await downloadCoverageReportFromCloud(reportRef, code)
	expect(reportMissingLib).toBeInstanceOf(Error)

	const reportPut = await fetch(
		`https://recoverage.cloud/reporter/${reportRef}`,
		{
			method: `PUT`,
			headers: {
				Authorization: `Bearer ${code}`,
			},
			body: JSON.stringify({
				mapData: istanbulReportFixture,
				jsonSummary: jsonSummaryFixture,
			}),
		},
	)
	const reportPutJson = await reportPut.json()
	console.log({ reportPutJson })
	expect(reportPut.status).toBe(200)
	const reportPutLibJson = await uploadCoverageReportToCloud(
		reportRef,
		createCoverageMap(istanbulReportFixture),
		jsonSummaryFixture,
		code,
	)
	expect(reportPutLibJson).toEqual(reportPutJson)

	const reportGet = await fetch(
		`https://recoverage.cloud/reporter/${reportRef}`,
		{
			method: `GET`,
			headers: {
				Authorization: `Bearer ${code}`,
			},
		},
	)
	expect(reportGet.status).toBe(200)
	const reportGetJson = await reportGet.json()
	expect(reportGetJson).toEqual(istanbulReportFixture)
	const reportGetLib = await downloadCoverageReportFromCloud(reportRef, code)
	assert(typeof reportGetLib === `string`)
	expect(JSON.parse(reportGetLib)).toEqual(istanbulReportFixture)
})

test.each([
	`missing-cookie`,
	`missing-state`,
	`mismatch`,
	`expired`,
	`tampered`,
] as const)(
	`OAuth rejects %s state before contacting GitHub`,
	async (scenario) => {
		if (scenario === `expired`)
			vi.spyOn(Date, `now`).mockReturnValue(Date.now() - 11 * 60 * 1000)
		const start = await app.request(
			`https://recoverage.cloud/oauth/github`,
			{},
			env,
		)
		vi.restoreAllMocks()
		const authorizeUrl = new URL(start.headers.get(`location`) ?? ``)
		let cookie = start.headers.get(`set-cookie`) ?? ``
		if (scenario === `tampered`)
			cookie = cookie.replace(
				`github-oauth-state=`,
				`github-oauth-state=tampered`,
			)
		const callbackUrl = new URL(
			GITHUB_CALLBACK_ENDPOINT,
			`https://recoverage.cloud`,
		)
		callbackUrl.searchParams.set(`code`, `attacker-code`)
		if (scenario !== `missing-state`)
			callbackUrl.searchParams.set(
				`state`,
				scenario === `mismatch`
					? `attacker-state`
					: (authorizeUrl.searchParams.get(`state`) ?? ``),
			)
		const lookup = vi.spyOn(globalThis, `fetch`)
		const response = await app.request(
			callbackUrl.href,
			{ headers: scenario === `missing-cookie` ? {} : { Cookie: cookie } },
			env,
		)
		expect(response.status).toBe(400)
		expect(lookup).not.toHaveBeenCalled()
		expect(response.headers.get(`set-cookie`)).toContain(`Max-Age=0`)
		expect(response.headers.get(`set-cookie`)).not.toContain(
			`github-access-token=`,
		)
	},
)
