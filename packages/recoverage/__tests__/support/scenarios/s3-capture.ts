import assert from "node:assert/strict"

let remote: Uint8Array | undefined
const rejectUpload = false
const requests: {
	method: string
	path: string
	authorization?: string | null
	body?: string
}[] = []
const server = Bun.serve({
	hostname: `127.0.0.1`,
	port: 0,
	async fetch(request) {
		requests.push({
			method: request.method,
			path: new URL(request.url).pathname,
		})
		if (request.method === `PUT`) {
			if (rejectUpload)
				return new Response(
					`<Error><Code>AccessDenied</Code><Message>denied</Message></Error>`,
					{ status: 403 },
				)
			remote = new Uint8Array(await request.arrayBuffer())
			return new Response(null, { headers: { ETag: `"test-etag"` } })
		}
		if (!remote)
			return new Response(
				`<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>`,
				{ status: 404 },
			)
		return new Response(remote)
	},
})
const credentials = {
	accessKeyId: `test-key`,
	secretAccessKey: `test-secret`,
	bucket: `reports`,
	endpoint: server.url.origin,
}
import { refs, report } from "./report.ts"

process.env[`S3_ACCESS_KEY_ID`] = credentials.accessKeyId
process.env[`S3_SECRET_ACCESS_KEY`] = credentials.secretAccessKey
process.env[`S3_BUCKET`] = credentials.bucket
process.env[`S3_ENDPOINT`] = credentials.endpoint
const { capture } = await import(`../../../src/recoverage.ts`)
const { initDatabase } = await import(`../../../src/database.ts`)
try {
	await Bun.write(`coverage/coverage-final.json`, JSON.stringify(report([1, 1])))
	assert.equal(await capture({ silent: true }), 0)
	assert(remote && remote.length > 0)
	const { Database } = await import(`bun:sqlite`)
	const uploaded = Database.deserialize(remote)
	assert.equal(
		uploaded.query<{ git_ref: string }, []>(`select git_ref from coverage`).get()
			?.git_ref,
		`base`,
	)
	uploaded.close()
	const database = await initDatabase()
	assert.equal(await initDatabase(), database)
	const count = requests.length
	refs.current = `feature`
	assert.equal(await capture({ silent: true }), 0)
	assert.equal(requests.length, count)
} finally {
	await server.stop(true)
}
