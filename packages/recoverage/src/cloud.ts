import { execFile } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { hostname } from "node:os"
import path from "node:path"
import { createInterface } from "node:readline/promises"
import { promisify } from "node:util"

import {
	cloudEnvironment,
	cloudHost,
	projectFromConfig,
	readCloudStore,
	readProjectConfig,
	reporterKey,
	validateReport,
	writeCloudStore,
} from "./cloud-config.ts"

type Project = {
	id: string
	name: string
	tokens: { id: string; name: string; createdAt: string }[]
	reports: { ref: string; jsonSummary: string | null; createdAt: string }[]
}
type Account = {
	id: number
	login: string
	role: string
	expiresAt: number
	limits: { projects: number | null; reports: number | null; tokens: number }
}
export type CloudOptions = {
	host?: string | undefined
	json?: boolean | undefined
	project?: string | undefined
	name?: string | undefined
	report?: string | undefined
	noBrowser?: boolean | undefined
}

const exec = promisify(execFile)

class CloudRequestError extends Error {
	public readonly status: number
	public constructor(status: number, message: string) {
		super(message)
		this.status = status
	}
}

async function request<T>(
	host: string,
	route: string,
	token?: string,
	body?: unknown,
	method = body === undefined ? `GET` : `POST`,
): Promise<T> {
	const response = await fetch(new URL(`/api/v1${route}`, host), {
		method,
		redirect: `error`,
		signal: AbortSignal.timeout(30_000),
		headers: {
			Accept: `application/json`,
			...(body === undefined ? {} : { "Content-Type": `application/json` }),
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	})
	let data: { error?: string }
	try {
		data = (await response.json()) as { error?: string }
	} catch {
		throw new Error(
			`Cloud returned a non-JSON response (${response.status}). Check the host and deploy the CLI management API.`,
		)
	}
	if (!response.ok)
		throw new CloudRequestError(
			response.status,
			`Cloud request failed (${response.status}): ${data.error ?? response.statusText}`,
		)
	return data as T
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
	return { config, cloud, host, store, credential }
}

function output(json: boolean | undefined, data: unknown, message: string) {
	console.log(json ? JSON.stringify(data) : message)
}

export async function cloudLogin(options: CloudOptions): Promise<void> {
	const cloud = projectFromConfig(await readProjectConfig())
	const host = cloudHost(
		options.host ?? cloudEnvironment(`RECOVERAGE_CLOUD_URL`) ?? cloud?.host,
	)
	const store = await readCloudStore()
	const device = await request<{
		deviceCode: string
		userCode: string
		verificationUri: string
		expiresIn: number
		interval: number
	}>(host, `/auth/device`, undefined, {})
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
		const session = await request<{
			error?: string
			token: string
			expiresAt: number
			account: { id: number; login: string }
		}>(host, `/auth/session`, undefined, { deviceCode: device.deviceCode })
		if (session.error === `slow_down`) {
			interval += 5000
			continue
		}
		if (session.error === `authorization_pending`) continue
		if (
			!/^rca_[\w-]+\.[\w-]+$/.test(session.token) ||
			!Number.isFinite(session.expiresAt) ||
			!session.account?.login
		)
			throw new Error(`Cloud returned an invalid account credential.`)
		// Merge again after the potentially long browser flow.
		const latest = await readCloudStore()
		const old = store.accounts[host]
		latest.accounts[host] = {
			token: session.token,
			expiresAt: session.expiresAt,
		}
		await writeCloudStore(latest)
		if (old) {
			try {
				await request(host, `/auth/session`, old.token, undefined, `DELETE`)
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
	const { host, store, credential } = await context(options)
	try {
		await request(host, `/auth/session`, credential, undefined, `DELETE`)
	} catch (error) {
		// An expired or already-revoked credential can safely be removed locally.
		if (!(error instanceof CloudRequestError && error.status === 401))
			throw error
	}
	Reflect.deleteProperty(store.accounts, host)
	await writeCloudStore(store)
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
	const { config, cloud, host, credential } = await context(options)
	if (options.project && options.name)
		throw new Error(`Choose either --project or --name.`)
	const report = validateReport(
		options.report ?? cloud?.report ?? path.basename(process.cwd()),
	)
	const { projects } = await request<{ projects: Project[] }>(
		host,
		`/projects`,
		credential,
	)
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
	let project: Pick<Project, `id` | `name`> | undefined
	if (projectId) {
		project = projects.find((candidate) => candidate.id === projectId)
		if (!project)
			throw new Error(`Project not found in this account: ${projectId}`)
	} else {
		if (!name?.trim() || name.length > 128)
			throw new Error(`Project name must contain 1–128 characters.`)
		project = await request<Pick<Project, `id` | `name`>>(
			host,
			`/projects`,
			credential,
			{ name },
		)
	}
	const linked = { host, projectId: project.id, report }
	const store = await readCloudStore()
	const key = reporterKey(linked)
	const savedToken = store.reporters[key]
	const savedTokenId = savedToken?.match(/^([\w-]+)\.[\w-]+$/)?.[1]
	const tokenExists =
		savedTokenId &&
		projects
			.find((candidate) => candidate.id === project.id)
			?.tokens.some((token) => token.id === savedTokenId)
	if (!tokenExists) {
		const token = await request<{ token: string }>(
			host,
			`/projects/${encodeURIComponent(project.id)}/tokens`,
			credential,
			{ name: `local:${hostname()}`.slice(0, 128) },
		)
		store.reporters[key] = token.token
		await writeCloudStore(store)
	}
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
	const { host, cloud, credential } = await context(options)
	const account = await request<Account>(host, `/account`, credential)
	const { projects } = await request<{ projects: Project[] }>(
		host,
		`/projects`,
		credential,
	)
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
	const { host, cloud, credential } = await context(options)
	const projectId =
		options.project ?? (cloud?.host === host ? cloud.projectId : undefined)
	if (!projectId)
		throw new Error(`Run recoverage cloud init or specify --project=<id>.`)
	const route = `/projects/${encodeURIComponent(projectId)}/tokens`
	if (action === `create`) {
		if (!value.trim() || value.length > 128)
			throw new Error(`Token name must contain 1–128 characters.`)
		const token = await request<{ id: string; name: string; token: string }>(
			host,
			route,
			credential,
			{ name: value },
		)
		console.error(
			`Save this reporter token as RECOVERAGE_CLOUD_TOKEN in CI; it is shown only once.`,
		)
		output(options.json, token, token.token)
	} else {
		const result = await request<{ success: true; id: string }>(
			host,
			`${route}/${encodeURIComponent(value)}`,
			credential,
			undefined,
			`DELETE`,
		)
		const store = await readCloudStore()
		const key = reporterKey({ host, projectId })
		if (store.reporters[key]?.split(`.`)[0] === value) {
			Reflect.deleteProperty(store.reporters, key)
			await writeCloudStore(store)
		}
		output(options.json, result, `Revoked reporter token ${value}.`)
	}
}
