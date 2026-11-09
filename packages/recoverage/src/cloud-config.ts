import { randomUUID } from "node:crypto"
import {
	chmod,
	mkdir,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import { type Type, type } from "arktype"
import { lock } from "proper-lockfile"

import type { CloudProject } from "./cloud-types.ts"

export const cloudProjectType: Type<CloudProject> = type({
	host: `string`,
	projectId: `string`,
	report: `string`,
})

export function cloudEnvironment(name: string): string | undefined {
	const value = process.env[name]
	return value === `` ? undefined : value
}

export function cloudHost(value = `https://recoverage.cloud`): string {
	const url = new URL(value)
	if (
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== `/` ||
		(url.protocol !== `https:` &&
			!(
				url.protocol === `http:` &&
				[`localhost`, `127.0.0.1`, `[::1]`].includes(url.hostname)
			))
	) {
		throw new Error(
			`Cloud host must be an HTTPS origin (HTTP is allowed on localhost).`,
		)
	}
	return url.origin
}

export function validateReport(report: string): string {
	if (!/^[\w.-]{1,64}$/.test(report) || report === `.` || report === `..`)
		throw new Error(
			`Report name must contain 1–64 letters, numbers, dots, underscores, or hyphens.`,
		)
	return report
}

export async function readProjectConfig(): Promise<Record<string, unknown>> {
	try {
		const config = JSON.parse(await readFile(`recoverage.config.json`, `utf8`))
		if (!config || typeof config !== `object` || Array.isArray(config))
			throw new Error(`Expected a configuration object.`)
		return config
	} catch (error) {
		if (isMissing(error)) return {}
		throw error
	}
}

export function projectFromConfig(
	config: Record<string, unknown>,
): CloudProject | undefined {
	if (config[`cloud`] === undefined) return undefined
	const cloud = cloudProjectType(config[`cloud`])
	if (cloud instanceof type.errors)
		throw new Error(`Invalid cloud configuration: ${cloud.summary}`)
	if (!cloud.projectId) throw new Error(`Cloud projectId must not be empty.`)
	return {
		...cloud,
		host: cloudHost(cloud.host),
		report: validateReport(cloud.report),
	}
}

function isMissing(error: unknown) {
	return error instanceof Error && `code` in error && error.code === `ENOENT`
}

const accountType = type({ token: `string`, expiresAt: `number` })
type Store = {
	accounts: Record<string, { token: string; expiresAt: number }>
	reporters: Record<string, string>
}
const storeType: Type<Store> = type({
	accounts: { "[string]": accountType },
	reporters: { "[string]": `string` },
})

function storePath() {
	return path.join(
		cloudEnvironment(`XDG_CONFIG_HOME`) ?? path.join(homedir(), `.config`),
		`recoverage`,
		`cloud.json`,
	)
}

export async function readCloudStore(): Promise<Store> {
	return readStore(storePath())
}

async function readStore(destination: string): Promise<Store> {
	try {
		const store = storeType(JSON.parse(await readFile(destination, `utf8`)))
		if (store instanceof type.errors)
			throw new Error(`Invalid cloud credential file: ${store.summary}`)
		return store
	} catch (error) {
		if (isMissing(error)) return { accounts: {}, reporters: {} }
		throw error
	}
}

async function writeCloudStore(
	destination: string,
	store: Store,
): Promise<void> {
	const temporary = `${destination}.${randomUUID()}.tmp`
	try {
		await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, {
			mode: 0o600,
			flag: `wx`,
		})
		await rename(temporary, destination)
	} finally {
		await rm(temporary, { force: true })
	}
}

export async function updateCloudStore<T>(
	update: (store: Store) => Promise<T> | T,
): Promise<T> {
	const directory = path.dirname(storePath())
	await mkdir(directory, { recursive: true, mode: 0o700 })
	await chmod(directory, 0o700)
	// Resolve the parent, since the store may not exist yet. Aliases must share a lock.
	const destination = path.join(await realpath(directory), `cloud.json`)
	const release = await lock(destination, {
		realpath: false,
		retries: { retries: 180, factor: 1, minTimeout: 500, maxTimeout: 500 },
	})
	try {
		const store = await readStore(destination)
		const result = await update(store)
		await writeCloudStore(destination, store)
		return result
	} finally {
		await release()
	}
}

export function reporterKey(
	cloud: Pick<CloudProject, `host` | `projectId`>,
): string {
	return `${cloudHost(cloud.host)}/${cloud.projectId}`
}

export async function reporterCredentials(
	cloud?: CloudProject,
): Promise<{ host: string; token: string | undefined; report: string }> {
	const host = cloudHost(cloudEnvironment(`RECOVERAGE_CLOUD_URL`) ?? cloud?.host)
	const report = cloud
		? validateReport(cloud.report)
		: path.basename(process.cwd())
	const token =
		cloudEnvironment(`RECOVERAGE_CLOUD_TOKEN`) ??
		(cloud
			? (await readCloudStore()).reporters[
					reporterKey({ host, projectId: cloud.projectId })
				]
			: undefined)
	return { host, token, report }
}
