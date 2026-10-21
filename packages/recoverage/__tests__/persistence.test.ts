import { runBun, sourceModule } from "./support/bun.ts"

const reportSetup = `
const report = (hits) => ({
  "example.ts": {
    path: "example.ts",
    statementMap: {
      0: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
      1: { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } },
    },
    s: { 0: hits[0], 1: hits[1] }, fnMap: {}, f: {}, branchMap: {}, b: {},
  },
});
let current = "base";
mock.module(${sourceModule(`git-status.ts`)}, () => ({
  getCurrentGitRef: async () => current,
  getBaseGitRef: async () => "base",
}));
`

const cloudSetup = `
${reportSetup}
const requests = [];
let status = 200;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  requests.push({ method: request.method, path: new URL(request.url).pathname,
    authorization: request.headers.get("authorization"), body: await request.text() });
  return new Response(status === 200 ? JSON.stringify(report([1, 0])) : "unavailable", { status });
} });
process.env.RECOVERAGE_CLOUD_TOKEN = "test-token";
process.env.RECOVERAGE_CLOUD_URL = server.url.href;
const { capture, diff } = await import(${sourceModule(`recoverage.ts`)});
const { initDatabase, getCoverage } = await import(${sourceModule(`database.ts`)});
await Bun.write("coverage/coverage-final.json", JSON.stringify(report([1, 1])));
`

describe(`cloud persistence workflows`, () => {
	it(`uploads the default branch with authentication, map, and summary`, () => {
		runBun(`${cloudSetup}
try {
  assert.equal(await capture({ silent: true }), 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "PUT");
  assert.equal(requests[0].path, "/reporter/" + process.cwd().split("/").at(-1));
  assert.equal(requests[0].authorization, "Bearer test-token");
  const body = JSON.parse(requests[0].body);
  assert.deepEqual(body.mapData, report([1, 1]));
  assert.equal(body.jsonSummary.total.statements.pct, 100);
  current = "feature";
  assert.equal(await capture({ silent: true }), 0);
  assert.equal(requests.length, 1, "feature captures must stay local");
} finally { server.stop(true); }
`)
	})

	it(`reports upload failure while preserving the local capture`, () => {
		runBun(`${cloudSetup}
try {
  status = 503;
  assert.equal(await capture({ silent: true }), 1);
  const saved = getCoverage(await initDatabase()).all("base");
  assert.equal(saved.length, 1);
  assert.deepEqual(JSON.parse(saved[0].coverage), report([1, 1]));
} finally { server.stop(true); }
`)
	})

	it(`downloads a missing baseline, compares it, and reuses the local cache`, () => {
		runBun(`${cloudSetup}
try {
  current = "feature";
  assert.equal(await capture({ silent: true }), 0);
  assert.equal(await diff("main", true), 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].authorization, "Bearer test-token");
  assert.deepEqual(JSON.parse(getCoverage(await initDatabase()).all("base")[0].coverage), report([1, 0]));
  status = 503;
  assert.equal(await diff("main", true), 0);
  assert.equal(requests.length, 1, "cached baselines must not be fetched again");
} finally { server.stop(true); }
`)
	})

	it(`fails a missing-baseline download without caching the error response`, () => {
		runBun(`${cloudSetup}
try {
  current = "feature";
  assert.equal(await capture({ silent: true }), 0);
  status = 503;
  assert.equal(await diff("main", true), 1);
  assert.equal(getCoverage(await initDatabase()).all("base").length, 0);
  status = 200;
  assert.equal(await diff("main", true), 0);
  assert.equal(requests.length, 2);
} finally { server.stop(true); }
`)
	})
})

describe(`cloud transport failures`, () => {
	it(`returns network Errors and rethrows non-Error failures`, () => {
		runBun(`
const { downloadCoverageReportFromCloud: download, uploadCoverageReportToCloud: upload } =
  await import(${sourceModule(`persist-cloud.ts`)});
const networkError = new Error("connection refused");
let failure = networkError;
globalThis.fetch = async () => { throw failure; };
assert.equal(await download("example", "token"), networkError);
assert.equal(await upload("example", {}, {}, "token"), networkError);
failure = "unexpected rejection";
await assert.rejects(download("example", "token"), (error) => error === failure);
await assert.rejects(upload("example", {}, {}, "token"), (error) => error === failure);
`)
	})
})

const s3Setup = `
let remote;
let rejectUpload = false;
const requests = [];
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  requests.push({ method: request.method, path: new URL(request.url).pathname });
  if (request.method === "PUT") {
    if (rejectUpload) return new Response("<Error><Code>AccessDenied</Code><Message>denied</Message></Error>", { status: 403 });
    remote = new Uint8Array(await request.arrayBuffer());
    return new Response(null, { headers: { ETag: '"test-etag"' } });
  }
  if (!remote) return new Response("<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>", { status: 404 });
  return new Response(remote);
} });
const credentials = { accessKeyId: "test-key", secretAccessKey: "test-secret", bucket: "reports", endpoint: server.url.origin };
`

describe(`S3 persistence`, () => {
	it(`round-trips database bytes and propagates upload errors`, () => {
		runBun(`${s3Setup}
const { initS3, uploadCoverageDatabaseToS3: upload, downloadCoverageDatabaseFromS3: download } =
  await import(${sourceModule(`persist-s3.ts`)});
try {
  const bytes = new Uint8Array([0, 1, 2, 128, 255]);
  await Bun.write("coverage.sqlite", bytes);
  await upload(credentials);
  assert.deepEqual(remote, bytes);
  const client = Bun.s3;
  initS3(credentials);
  assert.equal(Bun.s3, client);
  await Bun.write("coverage.sqlite", "replaced");
  await download(credentials);
  assert.deepEqual(new Uint8Array(await Bun.file("coverage.sqlite").arrayBuffer()), bytes);
  assert(requests.every((request) => request.path.endsWith("/coverage.sqlite")));
  rejectUpload = true;
  await assert.rejects(upload(credentials));
} finally { server.stop(true); }
`)
	})

	it(`initializes an empty remote store and uploads only default-branch captures`, () => {
		runBun(`${s3Setup}
${reportSetup}
process.env.S3_ACCESS_KEY_ID = credentials.accessKeyId;
process.env.S3_SECRET_ACCESS_KEY = credentials.secretAccessKey;
process.env.S3_BUCKET = credentials.bucket;
process.env.S3_ENDPOINT = credentials.endpoint;
const { capture } = await import(${sourceModule(`recoverage.ts`)});
const { initDatabase } = await import(${sourceModule(`database.ts`)});
try {
  await Bun.write("coverage/coverage-final.json", JSON.stringify(report([1, 1])));
  assert.equal(await capture({ silent: true }), 0);
  assert(remote.length > 0);
  const { Database } = await import("bun:sqlite");
  const uploaded = Database.deserialize(remote);
  assert.equal(uploaded.query("select git_ref from coverage").get().git_ref, "base");
  uploaded.close();
  const database = await initDatabase();
  assert.equal(await initDatabase(), database);
  const count = requests.length;
  current = "feature";
  assert.equal(await capture({ silent: true }), 0);
  assert.equal(requests.length, count);
} finally { server.stop(true); }
`)
	})
})
