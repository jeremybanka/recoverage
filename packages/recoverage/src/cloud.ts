import { execFile } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { hostname } from "node:os"
import path from "node:path"
import { createInterface } from "node:readline/promises"
import { promisify } from "node:util"

import {
	type ClientResponse,
	DetailedError,
	hc,
	type InferResponseType,
	parseResponse,
} from "hono/client"
import { createCoverageMap } from "istanbul-lib-coverage"

import type { apiContract } from "./cloud-api.gen.d.ts"
import {
	cloudEnvironment,
	cloudHost,
	projectFromConfig,
	readCloudStore,
	readProjectConfig,
	reporterKey,
	updateCloudStore,
	validateReport,
} from "./cloud-config.ts"
import { getCoverageJsonSummary } from "./istanbul-reports.ts"
import { lineCoverage } from "./lcov.ts"

export type CloudOptions = {
	host?: string | undefined
	json?: boolean | undefined
	project?: string | undefined
	name?: string | undefined
	report?: string | undefined
	noBrowser?: boolean | undefined
	yes?: boolean | undefined
	file?: string | undefined
	output?: string | undefined
	markdown?: boolean | undefined
}

const exec = promisify(execFile)

class CloudRequestError extends Error {
	public readonly status: number
	public constructor(status: number, message: string) {
		super(message)
		this.status = status
	}
}

function createClient(host: string, token?: string) {
	return hc<typeof apiContract>(`${host}/api/v1`, {
		headers: {
			Accept: `application/json`,
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		init: { redirect: `error` },
		fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
			fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }),
	})
}

type Project = InferResponseType<
	ReturnType<typeof createClient>[`projects`][`$post`],
	201
>

async function request<T extends ClientResponse<unknown>>(pending: Promise<T>) {
	const response = await pending
	try {
		if (!response.headers.get(`Content-Type`)?.includes(`application/json`))
			throw new SyntaxError(`Expected JSON`)
		return await parseResponse(response)
	} catch (error) {
		if (error instanceof SyntaxError)
			throw new Error(
				`Cloud returned a non-JSON response (${response.status}). Check the host and deploy the CLI management API.`,
			)
		if (error instanceof DetailedError) {
			const detail: unknown = error.detail
			const data =
				detail && typeof detail === `object` && `data` in detail
					? detail.data
					: undefined
			const message =
				data &&
				typeof data === `object` &&
				`error` in data &&
				typeof data.error === `string`
					? data.error
					: response.statusText
			throw new CloudRequestError(
				response.status,
				`Cloud request failed (${response.status}): ${message}`,
			)
		}
		throw error
	}
}

async function context(options: CloudOptions) {
	const config = await readProjectConfig()
	const cloud = projectFromConfig(config)
	const host = cloudHost(
		options.host ?? cloudEnvironment(`RECOVERAGE_CLOUD_URL`) ?? cloud?.host,
	)
	const store = await readCloudStore()
	const credential =
		cloudEnvironment(`RECOVERAGE_CLOUD_ACCOUNT_TOKEN`) ??
		store.accounts[host]?.token
	if (!credential) throw new Error(`Run recoverage cloud login first.`)
	return {
		config,
		cloud,
		host,
		credential,
		client: createClient(host, credential),
	}
}

function output(json: boolean | undefined, data: unknown, message: string) {
	console.log(json ? JSON.stringify(data) : message)
}

export async function cloudLogin(options: CloudOptions): Promise<void> {
	const cloud = projectFromConfig(await readProjectConfig())
	const host = cloudHost(
		options.host ?? cloudEnvironment(`RECOVERAGE_CLOUD_URL`) ?? cloud?.host,
	)
	await readCloudStore()
	const client = createClient(host)
	const device = await request(client.auth.device.$post())
	if (
		typeof device.deviceCode !== `string` ||
		typeof device.userCode !== `string` ||
		device.verificationUri !== `https://github.com/login/device` ||
		!Number.isFinite(device.expiresIn) ||
		device.expiresIn <= 0 ||
		!Number.isFinite(device.interval) ||
		device.interval < 1
	) {
		throw new Error(`Cloud returned an invalid device login response.`)
	}
	console.error(
		`Open ${device.verificationUri} and enter code ${device.userCode}.`,
	)
	if (!options.noBrowser && process.stdin.isTTY) {
		const command =
			process.platform === `darwin`
				? `open`
				: process.platform === `win32`
					? `rundll32`
					: `xdg-open`
		try {
			await exec(
				command,
				process.platform === `win32`
					? [`url.dll,FileProtocolHandler`, device.verificationUri]
					: [device.verificationUri],
				{ timeout: 10_000 },
			)
		} catch {
			/* The printed URL also supports headless sessions. */
		}
	}
	let interval = device.interval * 1000
	const deadline = Date.now() + Math.min(device.expiresIn, 900) * 1000
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, interval))
		const session = await request(
			client.auth.session.$post({ json: { deviceCode: device.deviceCode } }),
		)
		if (`error` in session && session.error === `slow_down`) {
			interval += 5000
			continue
		}
		if (`error` in session && session.error === `authorization_pending`) continue
		if (
			`error` in session ||
			!/^rca_[\w-]+\.[\w-]+$/.test(session.token) ||
			!Number.isFinite(session.expiresAt) ||
			!session.account?.login
		)
			throw new Error(`Cloud returned an invalid account credential.`)
		const old = await updateCloudStore((store) => {
			const previous = store.accounts[host]
			store.accounts[host] = {
				token: session.token,
				expiresAt: session.expiresAt,
			}
			return previous
		})
		if (old && old.token !== session.token) {
			try {
				await request(createClient(host, old.token).auth.session.$delete())
			} catch {
				/* Expired credentials need no revocation. */
			}
		}
		output(
			options.json,
			{ account: session.account, host, expiresAt: session.expiresAt },
			`Logged in to ${host} as ${session.account.login}.`,
		)
		return
	}
	throw new Error(`Login timed out. Run recoverage cloud login again.`)
}

export async function cloudLogout(options: CloudOptions): Promise<void> {
	const { host, credential, client } = await context(options)
	try {
		await request(client.auth.session.$delete())
	} catch (error) {
		// An expired or already-revoked credential can safely be removed locally.
		if (!(error instanceof CloudRequestError && error.status === 401))
			throw error
	}
	await updateCloudStore((store) => {
		if (store.accounts[host]?.token === credential)
			Reflect.deleteProperty(store.accounts, host)
	})
	output(options.json, { success: true, host }, `Logged out of ${host}.`)
}

async function prompt(message: string): Promise<string> {
	if (!process.stdin.isTTY)
		throw new Error(
			`Use --project=<id> to select a project or --name=<name> to create one without prompts.`,
		)
	const reader = createInterface({
		input: process.stdin,
		output: process.stderr,
	})
	try {
		return (await reader.question(message)).trim()
	} finally {
		reader.close()
	}
}

export async function cloudInit(options: CloudOptions): Promise<void> {
	const { config, cloud, host, client } = await context(options)
	if (options.project && options.name)
		throw new Error(`Choose either --project or --name.`)
	const report = validateReport(
		options.report ?? cloud?.report ?? path.basename(process.cwd()),
	)
	const { projects } = await request(client.projects.$get())
	let projectId =
		options.project ??
		(!options.name && cloud?.host === host ? cloud.projectId : undefined)
	let name = options.name
	if (!projectId && !name) {
		console.error(
			projects
				.map((project, index) => `${index + 1}. ${project.name} (${project.id})`)
				.join(`\n`),
		)
		const choice = await prompt(
			`Project number, or enter a name to create a project: `,
		)
		const index = /^\d+$/.test(choice) ? Number(choice) - 1 : -1
		if (index >= 0) {
			projectId = projects[index]?.id
			if (!projectId) throw new Error(`Invalid project number.`)
		} else {
			name = choice
		}
	}
	let project: Project | undefined
	if (projectId) {
		project = projects.find((candidate) => candidate.id === projectId)
		if (!project)
			throw new Error(`Project not found in this account: ${projectId}`)
	} else {
		if (!name?.trim() || name.length > 128)
			throw new Error(`Project name must contain 1–128 characters.`)
		project = await request(client.projects.$post({ json: { name } }))
	}
	const linked = { host, projectId: project.id, report }
	const key = reporterKey(linked)
	const tokens = client.projects[`:projectId`].tokens
	const param = { projectId: encodeURIComponent(project.id) }
	await updateCloudStore(async (store) => {
		const savedTokenId = store.reporters[key]?.match(/^([\w-]+)\.[\w-]+$/)?.[1]
		// Recheck under the lock: another initializer may just have issued a token.
		if (savedTokenId) {
			const current = await request(tokens.$get({ param }))
			if (current.tokens.some((token) => token.id === savedTokenId)) return
		}
		const token = await request(
			tokens.$post({
				param,
				json: { name: `local:${hostname()}`.slice(0, 128) },
			}),
		)
		store.reporters[key] = token.token
	})
	await writeFile(
		`recoverage.config.json`,
		`${JSON.stringify({ ...config, cloud: linked }, null, 2)}\n`,
	)
	output(
		options.json,
		{ project, cloud: linked },
		`Linked ${project.name} (${project.id}), report ${report}.\nSaved recoverage.config.json and a local reporter credential.\nFor CI, run recoverage cloud token create ci and save its token as RECOVERAGE_CLOUD_TOKEN.`,
	)
}

export async function cloudStatus(options: CloudOptions): Promise<void> {
	const { host, cloud, client } = await context(options)
	const account = await request(client.account.$get())
	const { projects } = await request(client.projects.$get())
	const projectId =
		options.project ?? (cloud?.host === host ? cloud.projectId : undefined)
	const project = projectId
		? projects.find((candidate) => candidate.id === projectId)
		: undefined
	if (projectId && !project)
		throw new Error(`Configured project is unavailable: ${projectId}`)
	output(
		options.json,
		{ host, account, cloud: cloud?.host === host ? cloud : null, projects },
		[
			`Logged in to ${host} as ${account.login} (${account.role}).`,
			`Projects: ${projects.length}/${account.limits.projects ?? `unlimited`}.`,
			...(project
				? [
						`Linked project: ${project.name} (${project.id}).`,
						`Reports: ${project.reports.length}/${account.limits.reports ?? `unlimited`}; tokens: ${project.tokens.length}/${account.limits.tokens}.`,
						...project.reports.map((report) => `  Report: ${report.ref}`),
						...project.tokens.map(
							(token) => `  Token: ${token.name} (${token.id})`,
						),
					]
				: projects.map((candidate) => `  ${candidate.name} (${candidate.id})`)),
		].join(`\n`),
	)
}

export async function cloudToken(
	action: `create` | `revoke`,
	value: string,
	options: CloudOptions,
): Promise<void> {
	const { host, cloud, client } = await context(options)
	const projectId =
		options.project ?? (cloud?.host === host ? cloud.projectId : undefined)
	if (!projectId)
		throw new Error(`Run recoverage cloud init or specify --project=<id>.`)
	const tokens = client.projects[`:projectId`].tokens
	const param = { projectId: encodeURIComponent(projectId) }
	if (action === `create`) {
		if (!value.trim() || value.length > 128)
			throw new Error(`Token name must contain 1–128 characters.`)
		const token = await request(tokens.$post({ param, json: { name: value } }))
		console.error(
			`Save this reporter token as RECOVERAGE_CLOUD_TOKEN in CI; it is shown only once.`,
		)
		output(options.json, token, token.token)
	} else {
		const result = await request(
			tokens[`:tokenId`].$delete({
				param: { ...param, tokenId: encodeURIComponent(value) },
			}),
		)
		const key = reporterKey({ host, projectId })
		await updateCloudStore((store) => {
			if (store.reporters[key]?.split(`.`)[0] === value)
				Reflect.deleteProperty(store.reporters, key)
		})
		output(options.json, result, `Revoked reporter token ${value}.`)
	}
}

async function projectContext(options: CloudOptions) {
	const ctx = await context(options)
	const id =
		options.project ??
		(ctx.cloud?.host === ctx.host ? ctx.cloud.projectId : undefined)
	if (!id)
		throw new Error(`Run recoverage cloud init or specify --project=<id>.`)
	return {
		...ctx,
		project: ctx.client.projects[`:projectId`],
		param: { projectId: encodeURIComponent(id) },
	}
}

async function confirmDelete(description: string, options: CloudOptions) {
	if (options.yes) return
	if (!process.stdin.isTTY)
		throw new Error(`Use --yes to ${description} without a prompt.`)
	const reader = createInterface({
		input: process.stdin,
		output: process.stderr,
	})
	try {
		if (
			!/^y(?:es)?$/i.test(
				(await reader.question(`${description}? [y/N] `)).trim(),
			)
		)
			throw new Error(`Deletion cancelled.`)
	} finally {
		reader.close()
	}
}

export async function cloudProject(
	action: `create` | `delete` | `list` | `rename` | `show`,
	value: string,
	options: CloudOptions,
	name?: string,
): Promise<void> {
	const { client, host, cloud, config } = await context(options)
	if (action === `list`) {
		const result = await request(client.projects.$get())
		output(
			options.json,
			result,
			result.projects
				.map((project) => `${project.id}\t${project.name}`)
				.join(`\n`),
		)
		return
	}
	if (action === `create`) {
		const result = await request(
			client.projects.$post({ json: { name: value } }),
		)
		output(options.json, result, `Created ${result.name} (${result.id}).`)
		return
	}
	const project = client.projects[`:projectId`]
	const param = { projectId: encodeURIComponent(value) }
	if (action === `show`) {
		const result = await request(project.$get({ param }))
		output(
			options.json,
			result,
			`${result.name} (${result.id}), created ${result.createdAt}.`,
		)
	} else if (action === `rename`) {
		const result = await request(
			project.$patch({ param, json: { name: name ?? `` } }),
		)
		output(options.json, result, `Renamed ${result.id} to ${result.name}.`)
	} else {
		const target = await request(project.$get({ param }))
		await confirmDelete(
			`Delete project ${target.name} (${target.id}) and all its reports and tokens`,
			options,
		)
		const result = await request(project.$delete({ param }))
		await updateCloudStore((store) => {
			Reflect.deleteProperty(
				store.reporters,
				reporterKey({ host, projectId: value }),
			)
		})
		if (cloud?.host === host && cloud.projectId === value) {
			Reflect.deleteProperty(config, `cloud`)
			await writeFile(
				`recoverage.config.json`,
				`${JSON.stringify(config, null, 2)}\n`,
			)
		}
		output(options.json, result, `Deleted project ${value}.`)
	}
}

export async function cloudTokenList(options: CloudOptions): Promise<void> {
	const { project, param } = await projectContext(options)
	const result = await request(project.tokens.$get({ param }))
	output(
		options.json,
		result,
		result.tokens
			.map((token) => `${token.id}\t${token.name}\t${token.createdAt}`)
			.join(`\n`),
	)
}

export async function cloudReport(
	action: `delete` | `download` | `list` | `show` | `upload`,
	ref: string,
	options: CloudOptions,
): Promise<void> {
	const ctx = await projectContext(options)
	if (action === `list`) {
		const result = await request(ctx.project.reports.$get({ param: ctx.param }))
		output(
			options.json,
			result,
			result.reports
				.map(
					(report) =>
						`${report.ref}\t${report.jsonSummary?.total.statements.pct ?? `unknown`}%\t${report.createdAt}`,
				)
				.join(`\n`),
		)
		return
	}
	const report = ctx.project.reports[`:reportRef`]
	const param = { ...ctx.param, reportRef: encodeURIComponent(ref) }
	if (action === `show`) {
		const result = await request(report.$get({ param }))
		output(
			options.json,
			result,
			`${result.ref}, created ${result.createdAt}\n${JSON.stringify(result.jsonSummary, null, 2)}`,
		)
	} else if (action === `upload`) {
		let filename = options.file ?? `coverage/coverage-final.json`
		let text: string
		try {
			text = await readFile(filename, `utf8`)
		} catch (error) {
			if (
				options.file ||
				!(error instanceof Error && `code` in error && error.code === `ENOENT`)
			)
				throw error
			filename = `coverage/lcov.info`
			text = await readFile(filename, `utf8`)
		}
		const map = createCoverageMap(
			/\.(?:info|lcov)$/i.test(filename)
				? lineCoverage(text, process.cwd())
				: JSON.parse(text),
		)
		const jsonSummary = getCoverageJsonSummary(map)
		if (jsonSummary.total.statements.total === 0)
			throw new Error(`Coverage report contains no executable statements.`)
		const result = await request(
			report.$put({ param, json: { mapData: map.toJSON(), jsonSummary } }),
		)
		output(
			options.json,
			result,
			`Uploaded ${ref}: ${jsonSummary.total.statements.pct}% statement coverage.`,
		)
	} else if (action === `download`) {
		const result = await request(report.data.$get({ param }))
		const data = `${JSON.stringify(result.mapData, null, 2)}\n`
		if (options.output) {
			await writeFile(options.output, data, { flag: `wx` })
			output(
				options.json,
				{ ref, output: path.resolve(options.output) },
				`Saved ${ref} to ${options.output}.`,
			)
		} else {
			process.stdout.write(data)
		}
	} else {
		await request(report.$get({ param }))
		await confirmDelete(`Delete report ${ref}`, options)
		const result = await request(report.$delete({ param }))
		output(options.json, result, `Deleted report ${ref}.`)
	}
}

export async function cloudBadge(
	ref: string,
	options: CloudOptions,
): Promise<void> {
	const { project, param } = await projectContext(options)
	const result = await request(
		project.reports[`:reportRef`].badge.$get({
			param: { ...param, reportRef: encodeURIComponent(ref) },
		}),
	)
	output(options.json, result, options.markdown ? result.markdown : result.image)
}
