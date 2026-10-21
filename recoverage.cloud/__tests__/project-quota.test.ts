import { env } from "cloudflare:test"
import { and, eq } from "drizzle-orm"
import { generateSignedCookie } from "hono/cookie"
import { nanoid } from "nanoid"

import app from "../src"
import { createDatabase } from "../src/db"
import * as schema from "../src/schema"

const db = createDatabase(env.DB)
let projectName: string

beforeEach(() => {
	projectName = `Project quota ${nanoid()}`
})

afterEach(async () => {
	vi.restoreAllMocks()
	await db.delete(schema.projects).where(eq(schema.projects.name, projectName))
})

async function authenticate(githubUserId: number) {
	await db
		.insert(schema.users)
		.values({ id: githubUserId })
		.onConflictDoNothing()
	vi.spyOn(globalThis, `fetch`).mockImplementation(() =>
		Promise.resolve(Response.json({ id: githubUserId, login: `jeremybanka` })),
	)
	return generateSignedCookie(
		`github-access-token`,
		`quota-test-token`,
		env.COOKIE_SECRET,
	)
}

function projectButton(html: string) {
	const button = html.match(/<button\b[^>]*>\+ New project<\/button>/)?.[0]
	expect(button).toBeDefined()
	return button ?? ``
}

test.each([
	[8570459, 3, true],
	[8570459, 6, true],
	[1974002, 2, true],
	[1974002, 3, false],
] as const)(
	`account %i with %i projects has creation permission %s`,
	async (githubUserId, existingCount, allowed) => {
		const cookie = await authenticate(githubUserId)
		await db.insert(schema.projects).values(
			Array.from({ length: existingCount }, () => ({
				id: nanoid(),
				userId: githubUserId,
				name: projectName,
			})),
		)

		const listing = await app.request(
			`/ui/project`,
			{ headers: { Cookie: cookie } },
			env,
		)
		expect(listing.status).toBe(200)
		const button = projectButton(await listing.text())
		expect(/\bdisabled\b/.test(button)).toBe(!allowed)

		const form = await app.request(
			`/ui/project`,
			{ method: `POST`, headers: { Cookie: cookie }, body: new FormData() },
			env,
		)
		expect(form.status).toBe(allowed ? 200 : 401)
		if (allowed) expect(await form.text()).toContain(`name="name"`)

		const body = new FormData()
		body.set(`name`, projectName)
		body.set(`githubUserId`, `8570459`)
		body.set(`userId`, `8570459`)
		const creation = await app.request(
			`/ui/project`,
			{ method: `POST`, headers: { Cookie: cookie }, body },
			env,
		)
		expect(creation.status).toBe(allowed ? 200 : 401)
		if (!allowed) {
			expect(await creation.json()).toEqual({
				error: `You may not create more projects`,
			})
		}
		const projects = await db.query.projects.findMany({
			where: and(
				eq(schema.projects.userId, githubUserId),
				eq(schema.projects.name, projectName),
			),
		})
		expect(projects).toHaveLength(existingCount + Number(allowed))

		const updatedListing = await app.request(
			`/ui/project`,
			{ headers: { Cookie: cookie } },
			env,
		)
		expect(/\bdisabled\b/.test(projectButton(await updatedListing.text()))).toBe(
			githubUserId !== 8570459,
		)
	},
)

test(`project creation still requires authentication`, async () => {
	const response = await app.request(`/ui/project`, { method: `POST` }, env)
	expect(response.status).toBe(401)
})
