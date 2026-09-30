import { env } from "cloudflare:test"
import { Hono } from "hono"
import { setSignedCookie } from "hono/cookie"

import app from "../src"

const origin = `https://recoverage.cloud`
const protectedWrites = [
	`/ui/project`,
	`/billing/checkout`,
	`/billing/portal`,
] as const

afterEach(() => vi.restoreAllMocks())

async function signedSession() {
	const signer = new Hono().get(`/`, async (c) => {
		await setSignedCookie(
			c,
			`github-access-token`,
			`expired-test-token`,
			env.COOKIE_SECRET,
			{ path: `/` },
		)
		return c.text(`signed`)
	})
	const cookie = (await signer.request(`/`)).headers.get(`set-cookie`)
	assert(cookie)
	return cookie
}

function request(
	path: string,
	cookie: string,
	databaseAccess: ReturnType<typeof vi.fn>,
	headers: Record<string, string> = {},
) {
	return app.request(
		`${origin}${path}`,
		{
			method: `POST`,
			headers: {
				Cookie: cookie,
				Origin: origin,
				"Content-Type": `application/x-www-form-urlencoded`,
				...headers,
			},
			body: `name=should-not-be-created`,
		},
		{
			...env,
			DB: { prepare: databaseAccess } as unknown as D1Database,
			STRIPE_MODE: `test`,
			STRIPE_SECRET_KEY: `sk_test_placeholder`,
			STRIPE_SUPPORTER_PRICE_ID: `price_test`,
			STRIPE_PORTAL_CONFIGURATION_ID: `bpc_test`,
			STRIPE_WEBHOOK_SECRET: `whsec_placeholder`,
			CHECKOUT_ENABLED: `true`,
			BILLING_SUPPORT_EMAIL: `support@example.com`,
			BILLING_REFUND_POLICY: `Contact support.`,
		},
	)
}

function rejectGitHub(status: number) {
	return vi.spyOn(globalThis, `fetch`).mockImplementation((input, init) => {
		const outgoing = new Request(input, init)
		expect(outgoing.method).toBe(`GET`)
		expect(outgoing.url).toBe(`https://api.github.com/user`)
		return Promise.resolve(
			Response.json(
				{ message: status === 401 ? `Bad credentials` : `Service unavailable` },
				{ status },
			),
		)
	})
}

test.each(protectedWrites)(
	`expired or revoked GitHub token blocks %s before database or Stripe work`,
	async (path) => {
		const cookie = await signedSession()
		const databaseAccess = vi.fn(() => {
			throw new Error(`Unexpected database access`)
		})
		const lookup = rejectGitHub(401)
		const response = await request(path, cookie, databaseAccess)
		expect(response.status).toBe(401)
		expect(response.headers.get(`HX-Redirect`)).toBeNull()
		await expect(response.json()).resolves.toEqual({
			error: `Your GitHub session has expired or been revoked. Please sign in again.`,
			loginUrl: `/oauth/github`,
		})
		expect(response.headers.get(`set-cookie`)).toContain(`github-access-token=;`)
		expect(response.headers.get(`set-cookie`)).toContain(`Path=/`)
		expect(response.headers.get(`set-cookie`)).toContain(`Max-Age=0`)
		expect(response.headers.get(`Cache-Control`)).toBe(`no-store`)
		expect(databaseAccess).not.toHaveBeenCalled()
		expect(lookup).toHaveBeenCalledTimes(1)
	},
)

test(`transient GitHub failures preserve UI and billing sessions and never reach mutations`, async () => {
	const cookie = await signedSession()
	const databaseAccess = vi.fn(() => {
		throw new Error(`Unexpected database access`)
	})
	rejectGitHub(503)
	const responses = await Promise.all([
		request(`/ui/project`, cookie, databaseAccess),
		request(`/billing/portal`, cookie, databaseAccess),
	])
	for (const response of responses) {
		expect(response.status).toBe(500)
		expect(response.headers.get(`set-cookie`)).toBeNull()
		await expect(response.json()).resolves.toMatchObject({
			code: `INTERNAL_ERROR`,
		})
	}
	expect(databaseAccess).not.toHaveBeenCalled()
}, 20_000)

test(`the account page clears an invalid GitHub session and offers sign-in`, async () => {
	const cookie = await signedSession()
	const lookup = rejectGitHub(401)
	const databaseAccess = vi.fn(() => {
		throw new Error(`Unexpected database access`)
	})
	const response = await app.request(
		`${origin}/`,
		{ headers: { Cookie: cookie } },
		{
			...env,
			DB: { prepare: databaseAccess } as unknown as D1Database,
		},
	)
	expect(response.status).toBe(200)
	expect(await response.text()).toContain(`href="/oauth/github"`)
	expect(response.headers.get(`set-cookie`)).toContain(`Max-Age=0`)
	expect(databaseAccess).not.toHaveBeenCalled()
	expect(lookup).toHaveBeenCalledTimes(1)
})

test(`an expired HTMX session returns to the sign-in page`, async () => {
	const cookie = await signedSession()
	const databaseAccess = vi.fn(() => {
		throw new Error(`Unexpected database access`)
	})
	rejectGitHub(401)
	const response = await request(`/ui/project`, cookie, databaseAccess, {
		"HX-Request": `true`,
	})
	expect(response.status).toBe(401)
	expect(response.headers.get(`HX-Redirect`)).toBe(`/`)
	expect(databaseAccess).not.toHaveBeenCalled()
})
