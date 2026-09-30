import { env } from "cloudflare:test"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { setSignedCookie } from "hono/cookie"
import { istanbulReportFixture, jsonSummaryFixture } from "recoverage-fixtures"

import app from "../src"
import { getEnv } from "../src/env"
import * as schema from "../src/schema"
import {
	accept,
	account,
	event,
	role,
	storedSubscription,
	subscription,
	supporterPriceId,
} from "./billing-webhook-fixture"

afterEach(() => {
	vi.restoreAllMocks()
})

const report = {
	mapData: istanbulReportFixture,
	jsonSummary: jsonSummaryFixture,
}

async function signedCookie() {
	const signer = new Hono().get(`/`, async (c) => {
		await setSignedCookie(
			c,
			`github-access-token`,
			`gho_downgrade_test`,
			getEnv(env).COOKIE_SECRET,
		)
		return c.text(`signed`)
	})
	const response = await signer.request(`/`)
	const cookie = response.headers.get(`set-cookie`)
	assert(cookie)
	return cookie
}

test(`canceling and resubscribing preserves above-Free resources and restores creation`, async () => {
	const owner = await account()
	const currentTime = Math.floor(Date.now() / 1000)
	const paidPeriod = {
		end: currentTime + 30 * 24 * 60 * 60,
		paidAt: currentTime,
	}
	await accept(
		event(
			`${owner.userId}_created`,
			`customer.subscription.created`,
			subscription(owner, paidPeriod),
		),
	)
	const cookie = await signedCookie()
	const bindings = { ...env, STRIPE_SUPPORTER_PRICE_ID: supporterPriceId }

	function github() {
		vi.spyOn(globalThis, `fetch`).mockImplementation((input, init) => {
			const request = new Request(input, init)
			expect(request.method).toBe(`GET`)
			expect(request.url).toBe(`https://api.github.com/user`)
			return Promise.resolve(
				Response.json({ id: owner.userId, login: `downgrade-test` }),
			)
		})
	}

	function ui(path: string, name?: string) {
		return app.request(
			path,
			{
				method: name ? `POST` : `GET`,
				headers: {
					Cookie: cookie,
					"Content-Type": `application/x-www-form-urlencoded`,
				},
				...(name ? { body: new URLSearchParams({ name }).toString() } : {}),
			},
			bindings,
		)
	}

	function upload(token: string, ref: string, mapData = report.mapData) {
		return app.request(
			`/reporter/${ref}`,
			{
				method: `PUT`,
				headers: { Authorization: `Bearer ${token}` },
				body: JSON.stringify({ ...report, mapData }),
			},
			bindings,
		)
	}

	function download(token: string, ref: string) {
		return app.request(
			`/reporter/${ref}`,
			{ headers: { Authorization: `Bearer ${token}` } },
			bindings,
		)
	}

	async function createToken(projectId: string, name: string) {
		const response = await ui(`/ui/token/${projectId}`, name)
		expect(response.status).toBe(200)
		const secret = (await response.text()).match(
			/<code[^>]*>([^<]+)<\/code>/u,
		)?.[1]
		assert(secret)
		return secret
	}

	github()
	const projects: { id: string; token: string }[] = []
	for (let index = 0; index < 4; index++) {
		const name = `retained-project-${index}`
		expect((await ui(`/ui/project`, name)).status).toBe(200)
		const project = await owner.db.query.projects.findFirst({
			where: eq(schema.projects.name, name),
		})
		assert(project)
		const token = await createToken(project.id, `retained-token-${index}`)
		projects.push({ id: project.id, token })
		expect((await upload(token, `report-${index}`)).status).toBe(200)
	}
	const first = projects[0]
	assert(first)
	const firstProjectTokens = [first.token]
	for (let index = 1; index < 6; index++) {
		firstProjectTokens.push(await createToken(first.id, `extra-token-${index}`))
	}
	const beforeTokens = await owner.db.query.tokens.findMany({
		where: eq(schema.tokens.projectId, first.id),
	})
	expect(beforeTokens).toHaveLength(6)

	const canceled = subscription(owner, { ...paidPeriod, status: `canceled` })
	await accept(
		event(`${owner.userId}_canceled`, `customer.subscription.deleted`, canceled),
	)
	expect(await role(owner, currentTime)).toBe(`free`)
	github()

	const projectsPage = await ui(`/ui/project`)
	expect(projectsPage.status).toBe(200)
	const html = await projectsPage.text()
	for (let index = 0; index < 4; index++) {
		expect(html).toContain(`retained-project-${index}`)
		expect(html).toContain(`report-${index}`)
	}
	for (let index = 1; index < 6; index++)
		expect(html).toContain(`extra-token-${index}`)
	expect((await ui(`/ui/project`, `blocked-project`)).status).toBe(403)
	expect((await ui(`/ui/token/${first.id}`, `blocked-token`)).status).toBe(403)
	const rejected = await upload(first.token, `blocked-report`)
	expect(rejected.status).toBe(403)
	expect(await rejected.json()).toMatchObject({ code: `REPORT_QUOTA_EXCEEDED` })

	// Every preexisting token remains usable, including those above the Free cap.
	for (const token of firstProjectTokens) {
		expect((await upload(token, `report-0`, {})).status).toBe(200)
		const response = await download(token, `report-0`)
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({})
	}
	for (const [index, project] of projects.entries()) {
		const response = await download(project.token, `report-${index}`)
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual(index === 0 ? {} : report.mapData)
	}
	expect(
		await owner.db.query.projects.findMany({
			where: eq(schema.projects.userId, owner.userId),
		}),
	).toHaveLength(4)
	expect(
		await owner.db.query.tokens.findMany({
			where: eq(schema.tokens.projectId, first.id),
		}),
	).toEqual(beforeTokens)

	const resubscribed = {
		...owner,
		subscriptionId: `${owner.subscriptionId}_new`,
		invoiceId: `${owner.invoiceId}_new`,
	}
	await accept(
		event(
			`${owner.userId}_resubscribed`,
			`customer.subscription.created`,
			subscription(resubscribed, paidPeriod),
		),
	)
	// Late events on the old terminal subscription must not revoke the new one.
	await accept(
		event(
			`${owner.userId}_old_canceled_late`,
			`customer.subscription.deleted`,
			canceled,
		),
	)
	expect(await storedSubscription(owner)).toMatchObject({ status: `canceled` })
	expect(await role(owner, currentTime)).toBe(`supporter`)
	github()
	expect((await ui(`/ui/project`, `restored-project`)).status).toBe(200)
	expect((await ui(`/ui/token/${first.id}`, `restored-token`)).status).toBe(200)
	expect((await upload(first.token, `restored-report`)).status).toBe(200)
	expect(
		await owner.db.query.projects.findMany({
			where: eq(schema.projects.userId, owner.userId),
		}),
	).toHaveLength(5)
	expect(
		await owner.db.query.tokens.findMany({
			where: eq(schema.tokens.projectId, first.id),
		}),
	).toHaveLength(7)
	expect(await (await download(first.token, `report-0`)).json()).toEqual({})
})
