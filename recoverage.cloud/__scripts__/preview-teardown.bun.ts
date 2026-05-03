#!/usr/bin/env bun

import Cloudflare from "cloudflare"
import type { D1 } from "cloudflare/resources/d1/d1"
import logger from "takua"

import {
	isNotFoundError,
	requiredEnv,
	resolvePreviewAccountId,
} from "./preview-cloudflare.ts"
import { getPreviewTeardownEnv, type PreviewTeardownEnv } from "./preview-env.ts"

const LOG_PREFIX = `preview-teardown`

type EnsurePreviewTeardownOptions = {
	databaseName: string
	env?: PreviewTeardownEnv
	cloudflare?: Cloudflare
	workerName: string
}

function databaseId(database: D1 | undefined): string | undefined {
	return database?.uuid
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

async function deletePreviewWorker(
	cloudflare: Cloudflare,
	accountId: string,
	workerName: string,
): Promise<void> {
	logger.info(LOG_PREFIX, `deleting preview worker`, { workerName })

	try {
		await cloudflare.workers.scripts.delete(workerName, {
			account_id: accountId,
		})
		logger.info(LOG_PREFIX, `deleted preview worker`, { workerName })
	} catch (error) {
		if (isNotFoundError(error)) {
			logger.info(LOG_PREFIX, `preview worker already absent`, { workerName })
			return
		}
		throw error
	}
}

async function deletePreviewD1Database(
	cloudflare: Cloudflare,
	accountId: string,
	databaseName: string,
): Promise<void> {
	const database = await findD1Database(cloudflare, accountId, databaseName)
	const id = databaseId(database)

	if (!database || !id) {
		logger.info(LOG_PREFIX, `preview d1 database already absent`, {
			databaseName,
			hasDatabaseId: Boolean(id),
		})
		return
	}

	logger.info(LOG_PREFIX, `deleting preview d1 database`, {
		databaseId: id,
		databaseName,
	})
	await cloudflare.d1.database.delete(id, { account_id: accountId })
	logger.info(LOG_PREFIX, `deleted preview d1 database`, {
		databaseId: id,
		databaseName,
	})
}

export async function ensurePreviewTeardown({
	databaseName,
	env = getPreviewTeardownEnv(),
	cloudflare = new Cloudflare({
		apiToken: requiredEnv(env, `CLOUDFLARE_API_TOKEN`),
	}),
	workerName,
}: EnsurePreviewTeardownOptions): Promise<void> {
	logger.makeChronicle({ inline: true })
	logger.info(LOG_PREFIX, `starting preview teardown`, {
		databaseName,
		workerName,
	})

	const accountId = await resolvePreviewAccountId(cloudflare, LOG_PREFIX)
	logger.chronicle?.mark(`resolved account id`)

	await deletePreviewWorker(cloudflare, accountId, workerName)
	logger.chronicle?.mark(`deleted worker`)

	await deletePreviewD1Database(cloudflare, accountId, databaseName)
	logger.chronicle?.mark(`deleted d1`)

	logger.chronicle?.logMarks()
}

function valueFromArgs(
	args: string[],
	name: string,
	env: PreviewTeardownEnv,
	envName: keyof PreviewTeardownEnv,
): string {
	const prefix = `--${name}=`
	const arg = args.find((value) => value.startsWith(prefix))
	const fromArg = arg?.slice(prefix.length)
	return fromArg ?? requiredEnv(env, envName)
}

if (import.meta.main) {
	try {
		const env = getPreviewTeardownEnv()
		const args = process.argv.slice(2)
		await ensurePreviewTeardown({
			databaseName: valueFromArgs(args, `database-name`, env, `DATABASE_NAME`),
			env,
			workerName: valueFromArgs(args, `worker-name`, env, `WORKER_NAME`),
		})
	} catch (error) {
		logger.error(LOG_PREFIX, `preview teardown failed`, error)
		process.exit(1)
	}
}
