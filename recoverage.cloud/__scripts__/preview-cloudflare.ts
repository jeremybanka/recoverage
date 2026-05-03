import type Cloudflare from "cloudflare"
import type { Account } from "cloudflare/resources/accounts/accounts"
import logger from "takua"

export function requiredEnv<TEnv extends Record<string, string | undefined>>(
	env: TEnv,
	name: keyof TEnv,
): string {
	const value = env[name]
	if (!value) {
		throw new Error(`${String(name)} is required`)
	}
	return value
}

export function apiErrorStatus(error: unknown): number | undefined {
	return typeof error === `object` && error && `status` in error
		? Number(error.status)
		: undefined
}

export function apiErrorCode(error: unknown): unknown {
	return typeof error === `object` && error && `code` in error
		? error.code
		: undefined
}

export function isNotFoundError(error: unknown): boolean {
	return apiErrorStatus(error) === 404
}

export async function resolvePreviewAccountId(
	cloudflare: Cloudflare,
	logPrefix: string,
): Promise<string> {
	logger.info(logPrefix, `resolving account_id from token accounts`)
	const accounts: Account[] = []
	for await (const account of cloudflare.accounts.list()) {
		accounts.push(account)
	}

	logger.info(logPrefix, `cloudflare account lookup completed`, {
		accountCount: accounts.length,
		accountNames: accounts.map((account) => account.name),
	})

	if (accounts.length !== 1) {
		throw new Error(
			`Failed to resolve Cloudflare account id: expected the API token to access exactly one account, found ${accounts.length}.`,
		)
	}

	const accountId = accounts[0]?.id
	if (!accountId) {
		throw new Error(`Failed to resolve Cloudflare account id from accounts list`)
	}

	logger.info(logPrefix, `account_id resolved`, { source: `token accounts` })
	return accountId
}
