import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)
const entry = path.resolve(import.meta.dirname, `../src/recoverage.x.ts`)
let directory: string
let host: string
let calls: { method: string; path: string; authorization: string | undefined }[]
let projects: {
	id: string
	name: string
	tokens: { id: string; name: string }[]
	reports: unknown[]
}[]
let polls: number
let failLogin: boolean
let revoked: boolean
let deviceOverrides: Record<string, unknown>
let invalidSession: boolean
let pendingError: string
let htmlResponse: boolean

const server = createServer(async (request, response) => {
	const route = request.url ?? ``
	const method = request.method ?? `GET`
	calls.push({
		method,
		path: route,
		authorization: request.headers.authorization,
	})
	const chunks: Buffer[] = []
	for await (const chunk of request) chunks.push(Buffer.from(chunk))
	const text = Buffer.concat(chunks).toString()
	const body = text ? (JSON.parse(text) as Record<string, string>) : {}
	response.setHeader(`Content-Type`, `application/json`)
	const send = (data: unknown, status = 200) => {
		response.statusCode = status
		response.end(JSON.stringify(data))
	}
	if (htmlResponse) {
		response.end(`<html>Not deployed</html>`)
		return
	}
	if (route === `/api/v1/auth/device`) {
		send({
			deviceCode: `device`,
			userCode: `ABCD-EFGH`,
			verificationUri: `https://github.com/login/device`,
			expiresIn: 30,
			interval: 1,
			...deviceOverrides,
		})
		return
	}
	if (route === `/api/v1/auth/session` && method === `POST`) {
		if (failLogin) {
			send({ error: `Login denied.` }, 401)
			return
		}
		if (polls++ === 0) {
			send({ error: pendingError }, 202)
			return
		}
		send(
			{
				token: invalidSession ? `invalid` : `rca_account.secret`,
				expiresAt: Date.now() + 60_000,
				account: { id: 123, login: `test-user` },
			},
			201,
		)
		return
	}
	if (request.headers.authorization !== `Bearer rca_account.secret` || revoked) {
		send({ error: `Unauthorized` }, 401)
		return
	}
	if (route === `/api/v1/auth/session` && method === `DELETE`) {
		revoked = true
		send({ success: true })
		return
	}
	if (route === `/api/v1/account`) {
		send({
			id: 123,
			login: `test-user`,
			role: `free`,
			expiresAt: Date.now() + 60_000,
			limits: { projects: 3, reports: 3, tokens: 12 },
		})
		return
	}
	if (route === `/api/v1/projects`) {
		if (method === `POST`) {
			const project = {
				id: `project-${projects.length}`,
				name: body[`name`] ?? ``,
				tokens: [],
				reports: [],
			}
			projects.push(project)
			send(project, 201)
			return
		}
		send({ projects })
		return
	}
	const tokenRoute = route.match(
		/^\/api\/v1\/projects\/([^/]+)\/tokens(?:\/([^/]+))?$/,
	)
	if (tokenRoute) {
		const project = projects.find((candidate) => candidate.id === tokenRoute[1])
		if (!project) {
			send({ error: `Project not found` }, 404)
			return
		}
		if (method === `POST`) {
			const token = {
				id: `token-${project.tokens.length}`,
				name: body[`name`] ?? ``,
			}
			project.tokens.push(token)
			send({ ...token, token: `${token.id}.reporter-secret` }, 201)
			return
		}
		project.tokens = project.tokens.filter((token) => token.id !== tokenRoute[2])
		send({ success: true, id: tokenRoute[2] })
		return
	}
	send({ error: `Unexpected route` }, 404)
})

server.keepAliveTimeout = 20_000

beforeAll(async () => {
	await new Promise<void>((resolve) => server.listen(0, `127.0.0.1`, resolve))
	host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

beforeEach(async () => {
	directory = await mkdtemp(path.join(tmpdir(), `recoverage-cloud-cli-`))
	calls = []
	projects = []
	polls = 0
	failLogin = false
	revoked = false
	deviceOverrides = {}
	invalidSession = false
	pendingError = `authorization_pending`
	htmlResponse = false
	await mkdir(path.join(directory, `credentials/recoverage`), {
		recursive: true,
	})
	await writeFile(
		path.join(directory, `credentials/recoverage/cloud.json`),
		JSON.stringify({
			accounts: {
				[host]: { token: `rca_account.secret`, expiresAt: Date.now() + 60_000 },
			},
			reporters: {},
		}),
	)
	await writeFile(
		path.join(directory, `tty.ts`),
		`Object.defineProperty(process.stdin, "isTTY", { value: true });`,
	)
})

afterEach(async () => {
	await rm(directory, { recursive: true, force: true })
})
afterAll(async () => {
	await new Promise<void>((resolve, reject) =>
		server.close((error) => {
			error ? reject(error) : resolve()
		}),
	)
})

async function invoke(args: string[], input?: string) {
	try {
		const execution = exec(
			`bun`,
			[
				...(input === undefined
					? []
					: [`--preload`, path.join(directory, `tty.ts`)]),
				entry,
				`cloud`,
				...args,
			],
			{
				cwd: directory,
				timeout: 15_000,
				env: {
					...process.env,
					PATH: `${path.join(directory, `bin`)}${path.delimiter}${process.env[`PATH`] ?? ``}`,
					RECOVERAGE_TEST_BROWSER_FILE: path.join(directory, `browser-url`),
					XDG_CONFIG_HOME: path.join(directory, `credentials`),
					RECOVERAGE_CLOUD_URL: host,
					RECOVERAGE_CLOUD_ACCOUNT_TOKEN: ``,
					RECOVERAGE_CLOUD_TOKEN: ``,
					NO_COLOR: `1`,
				},
			},
		)
		if (input !== undefined) execution.child.stdin?.end(input)
		return {
			...(await execution),
			code: 0,
		}
	} catch (error) {
		return error as { code: number; stdout: string; stderr: string }
	}
}

test(`interactive initialization selects projects, creates named projects, and rejects invalid selections`, async () => {
	projects.push({ id: `existing`, name: `Existing`, tokens: [], reports: [] })
	const selected = await invoke([`init`, `--report=pkg`, `--json`], `1\n`)
	expect(selected.code, selected.stderr).toBe(0)
	expect(JSON.parse(selected.stdout).project.id).toBe(`existing`)
	expect(selected.stderr).toContain(`1. Existing`)
	await rm(path.join(directory, `recoverage.config.json`))
	const invalid = await invoke([`init`, `--report=pkg`, `--json`], `99\n`)
	expect(invalid.code).toBe(1)
	expect(invalid.stderr).toContain(`Invalid project number`)
	const created = await invoke(
		[`init`, `--report=pkg`, `--json`],
		`New project\n`,
	)
	expect(created.code, created.stderr).toBe(0)
	expect(JSON.parse(created.stdout).project.name).toBe(`New project`)
	expect(projects).toHaveLength(2)
})

test.each([
	[`null`, `configuration object`],
	[`{invalid`, `JSON`],
	[
		JSON.stringify({
			cloud: { host: `https://recoverage.cloud`, report: `pkg` },
		}),
		`Invalid cloud configuration`,
	],
	[
		JSON.stringify({
			cloud: { host: `https://recoverage.cloud`, projectId: ``, report: `pkg` },
		}),
		`projectId must not be empty`,
	],
])(
	`rejects invalid project configuration before cloud access: %s`,
	async (config, message) => {
		await writeFile(path.join(directory, `recoverage.config.json`), config)
		const result = await invoke([`status`, `--json`])
		expect(result.code).toBe(1)
		expect(result.stderr).toContain(message)
		expect(calls).toHaveLength(0)
	},
)

test.each([
	`{invalid`,
	JSON.stringify({ accounts: { invalid: 42 }, reporters: {} }),
])(
	`rejects invalid credential storage without replacing it: %s`,
	async (config) => {
		const destination = path.join(directory, `credentials/recoverage/cloud.json`)
		await writeFile(destination, config)
		const result = await invoke([`status`, `--json`])
		expect(result.code).toBe(1)
		expect(await readFile(destination, `utf8`)).toBe(config)
		expect(calls).toHaveLength(0)
	},
)

test(`reports project and report metadata and rejects unavailable projects and invalid token names`, async () => {
	projects.push({
		id: `existing`,
		name: `Existing`,
		tokens: [],
		reports: [{ ref: `pkg`, jsonSummary: null }],
	})
	const unlinked = await invoke([`status`])
	expect(unlinked.code, unlinked.stderr).toBe(0)
	expect(unlinked.stdout).toContain(`Existing (existing)`)
	const selected = await invoke([`status`, `--project=existing`])
	expect(selected.stdout).toContain(`Report: pkg`)
	const missing = await invoke([`status`, `--project=missing`, `--json`])
	expect(missing.code).toBe(1)
	expect(missing.stderr).toContain(`unavailable`)
	expect((await invoke([`token`, `create`, `ci`])).stderr).toContain(
		`cloud init`,
	)
	expect(
		(await invoke([`token`, `create`, ` `, `--project=existing`])).stderr,
	).toContain(`Token name`)
	expect((await invoke([`init`, `--name= `, `--report=pkg`])).stderr).toContain(
		`Project name`,
	)
	expect(calls.some((call) => call.method === `POST`)).toBe(false)
})

test(`rejects a server without the management API and malformed device and account responses`, async () => {
	htmlResponse = true
	expect((await invoke([`login`, `--no-browser`])).stderr).toContain(`non-JSON`)
	htmlResponse = false
	deviceOverrides = { verificationUri: `https://unexpected.example/login` }
	expect((await invoke([`login`, `--no-browser`])).stderr).toContain(
		`invalid device login response`,
	)
	deviceOverrides = {}
	invalidSession = true
	const invalid = await invoke([`login`, `--no-browser`])
	expect(invalid.code).toBe(1)
	expect(invalid.stderr).toContain(`invalid account credential`)
})

test(`expires device login rather than polling indefinitely`, async () => {
	deviceOverrides = { expiresIn: 0.001 }
	const result = await invoke([`login`, `--no-browser`])
	expect(result.code).toBe(1)
	expect(result.stderr).toContain(`timed out`)
})

test(`honors GitHub polling slowdowns and revokes the replaced account credential`, async () => {
	pendingError = `slow_down`
	const result = await invoke([`login`, `--no-browser`, `--json`])
	expect(result.code, result.stderr).toBe(0)
	expect(
		calls.filter(
			(call) => call.path === `/api/v1/auth/session` && call.method === `POST`,
		),
	).toHaveLength(2)
	expect(calls.find((call) => call.method === `DELETE`)?.authorization).toBe(
		`Bearer rca_account.secret`,
	)
}, 15_000)

test(`opens the verification URL for terminal login without exposing credentials`, async () => {
	// Replace only the browser launcher; still run the real CLI and HTTP flow.
	await mkdir(path.join(directory, `bin`))
	await writeFile(
		path.join(
			directory,
			`bin`,
			process.platform === `darwin` ? `open` : `xdg-open`,
		),
		`#!/bin/sh\nprintf '%s\\n' "$1" > "$RECOVERAGE_TEST_BROWSER_FILE"\n`,
		{ mode: 0o755 },
	)
	await rm(path.join(directory, `credentials/recoverage/cloud.json`))
	const result = await invoke([`login`, `--json`], ``)
	expect(result.code, result.stderr).toBe(0)
	expect(await readFile(path.join(directory, `browser-url`), `utf8`)).toBe(
		`https://github.com/login/device\n`,
	)
	expect(result.stdout).not.toContain(`secret`)
})

test(`logs in using device approval, stores private credentials, and logs out`, async () => {
	// Begin with no stored account so login must complete the device flow.
	await rm(path.join(directory, `credentials/recoverage/cloud.json`))
	const login = await invoke([`login`, `--no-browser`, `--json`])
	expect(login.code, login.stderr).toBe(0)
	expect(JSON.parse(login.stdout).account.login).toBe(`test-user`)
	expect(login.stdout).not.toContain(`rca_account.secret`)
	expect(login.stderr).toContain(`ABCD-EFGH`)
	const destination = path.join(directory, `credentials/recoverage/cloud.json`)
	if (process.platform !== `win32`) {
		expect((await stat(destination)).mode & 0o777).toBe(0o600)
		expect((await stat(path.dirname(destination))).mode & 0o777).toBe(0o700)
	}
	expect(
		JSON.parse(await readFile(destination, `utf8`)).accounts[host].token,
	).toBe(`rca_account.secret`)
	const logout = await invoke([`logout`, `--json`])
	expect(logout.code, logout.stderr).toBe(0)
	expect(JSON.parse(logout.stdout).success).toBe(true)
	expect(
		JSON.parse(await readFile(destination, `utf8`)).accounts[host],
	).toBeUndefined()
	expect((await invoke([`status`])).code).toBe(1)
})

test(`logout clears an already-invalid session but preserves credentials when revocation cannot be confirmed`, async () => {
	const destination = path.join(directory, `credentials/recoverage/cloud.json`)
	htmlResponse = true
	const unavailable = await invoke([`logout`, `--json`])
	expect(unavailable.code).toBe(1)
	expect(
		JSON.parse(await readFile(destination, `utf8`)).accounts[host],
	).toBeDefined()
	htmlResponse = false
	revoked = true
	const expired = await invoke([`logout`, `--json`])
	expect(expired.code, expired.stderr).toBe(0)
	expect(
		JSON.parse(await readFile(destination, `utf8`)).accounts[host],
	).toBeUndefined()
})

test(`initialization replaces a malformed saved reporter credential`, async () => {
	projects.push({
		id: `existing`,
		name: `Existing`,
		tokens: [{ id: `token-0`, name: `Old` }],
		reports: [],
	})
	const destination = path.join(directory, `credentials/recoverage/cloud.json`)
	const store = JSON.parse(await readFile(destination, `utf8`))
	store.reporters[`${host}/existing`] = `token-0`
	await writeFile(destination, JSON.stringify(store))
	const result = await invoke([
		`init`,
		`--project=existing`,
		`--report=pkg`,
		`--json`,
	])
	expect(result.code, result.stderr).toBe(0)
	expect(
		JSON.parse(await readFile(destination, `utf8`)).reporters[
			`${host}/existing`
		],
	).toBe(`token-1.reporter-secret`)
})

test(`initializes a project, preserves config, reports status, creates and revokes CI tokens`, async () => {
	await writeFile(
		path.join(directory, `recoverage.config.json`),
		JSON.stringify({ defaultBranch: `trunk`, custom: `preserve` }),
	)
	const init = await invoke([
		`init`,
		`--name=my-project`,
		`--report=my-package`,
		`--json`,
	])
	expect(init.code, init.stderr).toBe(0)
	const config = JSON.parse(
		await readFile(path.join(directory, `recoverage.config.json`), `utf8`),
	)
	expect(config).toEqual({
		defaultBranch: `trunk`,
		custom: `preserve`,
		cloud: { host, projectId: `project-0`, report: `my-package` },
	})
	expect(init.stdout).not.toContain(`reporter-secret`)
	expect(
		JSON.parse(
			await readFile(
				path.join(directory, `credentials/recoverage/cloud.json`),
				`utf8`,
			),
		).reporters[`${host}/project-0`],
	).toBe(`token-0.reporter-secret`)
	const rerun = await invoke([`init`, `--json`])
	expect(rerun.code, rerun.stderr).toBe(0)
	expect(projects).toHaveLength(1)
	expect(projects[0].tokens).toHaveLength(1)
	const create = await invoke([`token`, `create`, `ci`, `--json`])
	expect(create.code, create.stderr).toBe(0)
	expect(JSON.parse(create.stdout)).toEqual({
		id: `token-1`,
		name: `ci`,
		token: `token-1.reporter-secret`,
	})
	expect(create.stderr).toContain(`RECOVERAGE_CLOUD_TOKEN`)
	const status = await invoke([`status`, `--json`])
	expect(status.code, status.stderr).toBe(0)
	expect(JSON.parse(status.stdout).projects[0].tokens).toHaveLength(2)
	expect(status.stdout).not.toContain(`secret`)
	expect((await invoke([`token`, `revoke`, `token-1`, `--json`])).code).toBe(0)
	expect(projects[0].tokens).toHaveLength(1)
	const humanStatus = await invoke([`status`])
	expect(humanStatus.stdout).toContain(`my-project`)
	expect(humanStatus.stdout).toContain(`token-0`)
	expect(
		calls
			.filter((call) => !call.path.startsWith(`/api/v1/auth/`))
			.every((call) => call.authorization === `Bearer rca_account.secret`),
	).toBe(true)
})

test(`links an existing project and removes revoked local reporter credentials`, async () => {
	projects.push({ id: `existing`, name: `Existing`, tokens: [], reports: [] })
	const result = await invoke([
		`init`,
		`--project=existing`,
		`--report=pkg`,
		`--json`,
	])
	expect(result.code, result.stderr).toBe(0)
	expect(projects).toHaveLength(1)
	expect((await invoke([`token`, `revoke`, `token-0`])).code).toBe(0)
	expect(
		JSON.parse(
			await readFile(
				path.join(directory, `credentials/recoverage/cloud.json`),
				`utf8`,
			),
		).reporters,
	).toEqual({})
	expect((await invoke([`init`, `--json`])).code).toBe(0)
	expect(projects[0].tokens).toHaveLength(1)
})

test(`fails noninteractive ambiguous init and invalid input before mutations`, async () => {
	for (const args of [
		[],
		[`--project=missing`],
		[`--name=new`, `--project=existing`],
		[`--name=new`, `--report=bad/name`],
	]) {
		const result = await invoke([`init`, ...args, `--json`])
		expect(result.code).toBe(1)
		expect(result.stdout).toBe(``)
		expect(JSON.parse(result.stderr).error).toBeTruthy()
	}
	expect(calls.some((call) => call.method === `POST`)).toBe(false)
	expect(projects).toHaveLength(0)
})

test(`rejects unsafe hosts and keeps denied login credentials out of output and storage`, async () => {
	const unsafe = await invoke([
		`login`,
		`--host=http://example.com`,
		`--no-browser`,
		`--json`,
	])
	expect(unsafe.code).toBe(1)
	expect(calls).toHaveLength(0)
	failLogin = true
	const denied = await invoke([`login`, `--no-browser`, `--json`])
	expect(denied.code).toBe(1)
	expect(denied.stdout).toBe(``)
	expect(denied.stderr).toContain(`Login denied`)
	expect(denied.stderr).not.toContain(`rca_account.secret`)
})
