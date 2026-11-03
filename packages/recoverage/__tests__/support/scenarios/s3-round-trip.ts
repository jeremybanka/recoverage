import assert from "node:assert/strict"

let remote: Uint8Array | undefined
let rejectUpload = false
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
const {
	initS3,
	uploadCoverageDatabaseToS3: upload,
	downloadCoverageDatabaseFromS3: download,
} = await import(`../../../src/persist-s3.ts`)
try {
	const bytes = new Uint8Array([0, 1, 2, 128, 255])
	await Bun.write(`coverage.sqlite`, bytes)
	await upload(credentials)
	assert.deepEqual(remote, bytes)
	const client = Bun.s3
	initS3(credentials)
	assert.equal(Bun.s3, client)
	await Bun.write(`coverage.sqlite`, `replaced`)
	await download(credentials)
	assert.deepEqual(
		new Uint8Array(await Bun.file(`coverage.sqlite`).arrayBuffer()),
		bytes,
	)
	assert(requests.every((request) => request.path.endsWith(`/coverage.sqlite`)))
	rejectUpload = true
	await assert.rejects(upload(credentials))
} finally {
	await server.stop(true)
}
