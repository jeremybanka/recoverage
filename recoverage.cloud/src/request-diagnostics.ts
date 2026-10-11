// Never log provider messages, SQL parameters, URLs, headers or stack traces.
// Inspect errors only to select a fixed, non-sensitive diagnostic category.
export function failureCategory(error: unknown): string {
	const seen = new Set<unknown>()
	while (error instanceof Error && !seen.has(error)) {
		seen.add(error)
		if (error.message.startsWith(`D1_ERROR:`)) return `database`
		if (`status` in error && typeof error.status === `number`) {
			if (error.status === 401) return `upstream_authentication`
			if (error.status === 429) return `upstream_rate_limit`
			if (error.status >= 500) return `upstream_unavailable`
		}
		error = error.cause
	}
	return `unclassified`
}
