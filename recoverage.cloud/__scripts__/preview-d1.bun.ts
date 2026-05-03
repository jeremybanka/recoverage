#!/usr/bin/env bun

import { appendFile } from "node:fs/promises"

import Cloudflare from "cloudflare"
import type { D1 } from "cloudflare/resources/d1/d1"
import logger from "takua"

import { getPreviewD1Env, type PreviewD1Env } from "./preview-env.ts"

const LOG_PREFIX = `preview-d1`

type CommandResult = {
	exitCode: number
	stderr: string
	stdout: string
}

type Env = Record<string, string | undefined>

type EnsurePreviewD1Options = {
	databaseName: string
	env?: PreviewD1Env
	cloudflare?: Cloudflare
	runCommand?: typeof runCommand
	writeGithubOutput?: boolean
}

export function parseDatabaseIdFromText(text: string): string | undefined {
	const patterns = [
		/"database_id"\s*:\s*"([^"]+)"/,
		/database_id\s*=\s*"([^"]+)"/,
		/"uuid"\s*:\s*"([^"]+)"/,
		/"id"\s*:\s*"([^"]+)"/,
	]

	for (const pattern of patterns) {
		const match = pattern.exec(text)
		if (match?.[1]) {
			return match[1]
		}
	}

	return undefined
}

function databaseId(database: D1 | undefined): string | undefined {
	return database?.uuid
}

function requiredEnv(env: PreviewD1Env, name: keyof PreviewD1Env): string {
	const value = env[name]
	if (!value) {
		throw new Error(`${name} is required`)
	}
	return value
}

async function runCommand(
	command: string,
	args: string[],
	env: Env = process.env,
): Promise<CommandResult> {
	const proc = Bun.spawn([command, ...args], {
		env,
		stderr: `pipe`,
		stdout: `pipe`,
	})

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	])

	return { exitCode, stdout, stderr }
}

async function resolveAccountId(
	env: PreviewD1Env,
	run: typeof runCommand,
): Promise<string> {
	if (env.CLOUDFLARE_ACCOUNT_ID) {
		logger.info(LOG_PREFIX, `account_id resolved`, { source: `env` })
		return env.CLOUDFLARE_ACCOUNT_ID
	}

	logger.info(LOG_PREFIX, `account_id missing from env; asking wrangler`)
	const whoami = await run(`bun`, [`--bun`, `wrangler`, `whoami`, `--json`], env)
	logger.info(LOG_PREFIX, `wrangler whoami completed`, {
		exitCode: whoami.exitCode,
		stderr: whoami.stderr.trim(),
		stdoutLength: whoami.stdout.length,
	})

	if (whoami.exitCode !== 0) {
		throw new Error(
			`Failed to resolve Cloudflare account id with wrangler whoami`,
		)
	}

	const parsed = JSON.parse(whoami.stdout) as {
		accounts?: Array<{ id?: string }>
	}
	const accountId = parsed.accounts?.find((account) => account.id)?.id

	if (!accountId) {
		throw new Error(
			`Failed to resolve Cloudflare account id from wrangler whoami`,
		)
	}

	logger.info(LOG_PREFIX, `account_id resolved`, { source: `wrangler` })
	return accountId
}

async function findD1Database(
	cloudflare: Cloudflare,
	accountId: string,
	databaseName: string,
): Promise<D1 | undefined> {
	logger.info(LOG_PREFIX, `looking up d1 database`, { databaseName })

	let resultCount = 0
	for await (const database of cloudflare.d1.database.list({
		account_id: accountId,
		name: databaseName,
		per_page: 100,
	})) {
		resultCount += 1
		if (database.name === databaseName) {
			logger.info(LOG_PREFIX, `d1 database lookup completed`, {
				databaseName,
				found: true,
				resultCount,
			})
			return database
		}
	}

	logger.info(LOG_PREFIX, `d1 database lookup completed`, {
		databaseName,
		found: false,
		resultCount,
	})

	return undefined
}

async function createD1Database(
	cloudflare: Cloudflare,
	accountId: string,
	databaseName: string,
): Promise<D1> {
	logger.info(LOG_PREFIX, `creating d1 database`, { databaseName })

	try {
		const database = await cloudflare.d1.database.create({
			account_id: accountId,
			name: databaseName,
		})

		logger.info(LOG_PREFIX, `d1 database create completed`, {
			databaseName,
			hasDatabaseId: Boolean(databaseId(database)),
			resultKeys: Object.keys(database),
		})
		return database
	} catch (error) {
		const code =
			typeof error === `object` && error && `code` in error
				? error.code
				: undefined
		if (code === 7502) {
			logger.warn(
				LOG_PREFIX,
				`d1 database already exists after create attempt`,
				{
					databaseName,
				},
			)
			const database = await findD1Database(cloudflare, accountId, databaseName)
			if (database) {
				return database
			}
		}

		throw error
	}
}

async function writeGithubOutput(
	env: PreviewD1Env,
	databaseIdValue: string,
): Promise<void> {
	if (!env.GITHUB_OUTPUT) {
		logger.info(LOG_PREFIX, `GITHUB_OUTPUT not set; skipping output write`)
		return
	}

	await appendFile(env.GITHUB_OUTPUT, `database_id=${databaseIdValue}\n`)
	logger.info(LOG_PREFIX, `wrote database_id to GITHUB_OUTPUT`)
}

export async function ensurePreviewD1Database({
	databaseName,
	env = getPreviewD1Env(),
	cloudflare = new Cloudflare({
		apiToken: requiredEnv(env, `CLOUDFLARE_API_TOKEN`),
	}),
	runCommand: run = runCommand,
	writeGithubOutput: shouldWriteGithubOutput = true,
}: EnsurePreviewD1Options): Promise<string> {
	logger.makeChronicle({ inline: true })
	logger.info(LOG_PREFIX, `starting preview d1 setup`, { databaseName })

	const accountId = await resolveAccountId(env, run)
	logger.chronicle?.mark(`resolved account id`)

	const existing = await findD1Database(cloudflare, accountId, databaseName)
	const database =
		existing ?? (await createD1Database(cloudflare, accountId, databaseName))
	logger.chronicle?.mark(existing ? `found existing d1` : `created d1`)

	const id = databaseId(database)
	if (!id) {
		throw new Error(`Failed to find database_id for ${databaseName}`)
	}

	logger.info(LOG_PREFIX, `resolved database_id`, {
		databaseName,
		databaseId: id,
		source: existing ? `existing` : `created`,
	})

	if (shouldWriteGithubOutput) {
		await writeGithubOutput(env, id)
	}

	logger.chronicle?.logMarks()
	return id
}

function databaseNameFromArgs(args: string[], env: PreviewD1Env): string {
	const arg = args.find((value) => value.startsWith(`--database-name=`))
	const fromArg = arg?.slice(`--database-name=`.length)
	return fromArg ?? requiredEnv(env, `DATABASE_NAME`)
}

function selfTest(): 0 | 1 {
	const samples = [
		{
			name: `jsonc`,
			text: `"database_id": "11111111-1111-1111-1111-111111111111"`,
			want: `11111111-1111-1111-1111-111111111111`,
		},
		{
			name: `toml`,
			text: `database_id = "22222222-2222-2222-2222-222222222222"`,
			want: `22222222-2222-2222-2222-222222222222`,
		},
		{
			name: `api uuid`,
			text: `"uuid": "33333333-3333-3333-3333-333333333333"`,
			want: `33333333-3333-3333-3333-333333333333`,
		},
	]

	for (const sample of samples) {
		const got = parseDatabaseIdFromText(sample.text)
		if (got !== sample.want) {
			logger.error(LOG_PREFIX, `self-test failed`, sample)
			return 1
		}
		logger.info(LOG_PREFIX, `self-test passed`, { name: sample.name })
	}

	return 0
}

if (import.meta.main) {
	if (process.argv.includes(`--self-test`)) {
		process.exit(selfTest())
	}

	try {
		const env = getPreviewD1Env()
		await ensurePreviewD1Database({
			databaseName: databaseNameFromArgs(process.argv.slice(2), env),
			env,
		})
	} catch (error) {
		logger.error(LOG_PREFIX, `preview d1 setup failed`, error)
		process.exit(1)
	}
}
