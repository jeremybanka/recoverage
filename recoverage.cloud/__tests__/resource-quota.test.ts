import { env } from "cloudflare:test"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { setSignedCookie } from "hono/cookie"
import { nanoid } from "nanoid"

import app from "../src"
import { createDatabase } from "../src/db"
import * as schema from "../src/schema"

const db = createDatabase(env.DB)
let nextUserId = 2_340_000
const userIds: number[] = []

afterEach(async () => {
	vi.restoreAllMocks()
	for (const id of userIds.splice(0)) {
		await db.delete(schema.users).where(eq(schema.users.id, id))
	}
})

async function account(role: `free` | `supporter`) {
	const userId = nextUserId++
	userIds.push(userId)
	await db.insert(schema.users).values({
		id: userId,
		manualRoleOverride: role === `free` ? null : role,
	})
	const signer = new Hono().get(`/`, async (c) => {
		await setSignedCookie(
			c,
			`github-access-token`,
			`gho_quota_test`,
			env.COOKIE_SECRET,
		)
		return c.text(`signed`)
	})
	const cookie = (await signer.request(`/`)).headers.get(`set-cookie`)
	assert(cookie)
	vi.spyOn(globalThis, `fetch`).mockImplementation((input, init) => {
		const request = new Request(input, init)
		expect(request.method).toBe(`GET`)
		expect(request.url).toBe(`https://api.github.com/user`)
		return Promise.resolve(Response.json({ id: userId, login: `quota-test` }))
	})
	return {
		userId,
		create(path: string) {
			return app.request(
				path,
				{
					method: `POST`,
					headers: {
						Cookie: cookie,
						"Content-Type": `application/x-www-form-urlencoded`,
					},
					body: new URLSearchParams({ name: nanoid() }).toString(),
				},
				env,
			)
		},
	}
}

test.each([
	[`free`, 3],
	[`supporter`, 100],
] as const)(
	`concurrent %s project creation admits only the remaining slot`,
	async (role, limit) => {
		const owner = await account(role)
		for (let index = 0; index < limit - 1; index++) {
			await db.insert(schema.projects).values({
				id: nanoid(),
				userId: owner.userId,
				name: `retained`,
			})
		}
		const responses = await Promise.all(
			Array.from({ length: 8 }, () => owner.create(`/ui/project`)),
		)
		expect(responses.filter((response) => response.status === 200)).toHaveLength(
			1,
		)
		expect(responses.filter((response) => response.status === 403)).toHaveLength(
			7,
		)
		expect(
			await db.query.projects.findMany({
				where: eq(schema.projects.userId, owner.userId),
			}),
		).toHaveLength(limit)
	},
)

test.each([
	[`free`, 5],
	[`supporter`, 10],
] as const)(
	`concurrent %s token creation admits only the remaining slot`,
	async (role, limit) => {
		const owner = await account(role)
		const projectId = nanoid()
		await db
			.insert(schema.projects)
			.values({ id: projectId, userId: owner.userId, name: `retained` })
		const retained = Array.from({ length: limit - 1 }, () => ({
			id: nanoid(),
			projectId,
			name: `retained`,
			hash: `hash`,
			salt: `salt`,
		}))
		await db.insert(schema.tokens).values(retained)
		const responses = await Promise.all(
			Array.from({ length: 8 }, () => owner.create(`/ui/token/${projectId}`)),
		)
		expect(responses.filter((response) => response.status === 200)).toHaveLength(
			1,
		)
		expect(responses.filter((response) => response.status === 403)).toHaveLength(
			7,
		)
		const tokens = await db.query.tokens.findMany({
			where: eq(schema.tokens.projectId, projectId),
		})
		expect(tokens).toHaveLength(limit)
		for (const token of retained)
			expect(tokens).toContainEqual(expect.objectContaining(token))
	},
)

test(`token creation remains restricted to the authenticated project owner`, async () => {
	const owner = await account(`free`)
	const otherUserId = nextUserId++
	userIds.push(otherUserId)
	await db.insert(schema.users).values({ id: otherUserId })
	const projectId = nanoid()
	await db
		.insert(schema.projects)
		.values({ id: projectId, userId: otherUserId, name: `private` })
	expect((await owner.create(`/ui/token/${projectId}`)).status).toBe(404)
	expect(
		await db.query.tokens.findMany({
			where: eq(schema.tokens.projectId, projectId),
		}),
	).toEqual([])
})
