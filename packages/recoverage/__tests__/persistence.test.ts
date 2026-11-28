import { runBun } from "./support/bun.ts"

describe(`cloud persistence workflows`, () => {
	it(`uploads the default branch with authentication, map, and summary`, () => {
		runBun(`cloud-upload.ts`)
	})

	it(`reports upload failure while preserving the local capture`, () => {
		runBun(`cloud-upload-failure.ts`)
	})

	it(`downloads a missing baseline, compares it, and reuses the local cache`, () => {
		runBun(`cloud-cache.ts`)
	})

	it(`fails a missing-baseline download without caching the error response`, () => {
		runBun(`cloud-download-failure.ts`)
	})
})

describe(`cloud transport failures`, () => {
	it(`returns network Errors and rethrows non-Error failures`, () => {
		runBun(`cloud-transport-failure.ts`)
	})
})

describe(`S3 persistence`, () => {
	it(`round-trips database bytes and propagates upload errors`, () => {
		runBun(`s3-round-trip.ts`)
	})

	it(`initializes an empty remote store and uploads only default-branch captures`, () => {
		runBun(`s3-capture.ts`)
	})
})
