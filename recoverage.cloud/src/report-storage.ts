// An ingress guard, not a plan entitlement or a promise that a row will fit D1.
// Allow JSON framing/escaping headroom over D1's 2,000,000-byte row limit,
// while bounding the buffers and parsed objects allocated by one upload.
export const reportRequestBytes = 4_000_000

export class ReportRequestTooLarge extends Error {}

export async function readReportBody(request: Request): Promise<string> {
	const declaredLength = Number(request.headers.get(`Content-Length`))
	if (declaredLength > reportRequestBytes) {
		await request.body?.cancel()
		throw new ReportRequestTooLarge()
	}
	const reader = request.body?.getReader()
	if (!reader) return ``
	const decoder = new TextDecoder()
	const chunks: string[] = []
	let bytes = 0
	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			bytes += value.byteLength
			if (bytes > reportRequestBytes) {
				await reader.cancel()
				throw new ReportRequestTooLarge()
			}
			chunks.push(decoder.decode(value, { stream: true }))
		}
		chunks.push(decoder.decode())
		return chunks.join(``)
	} finally {
		reader.releaseLock()
	}
}

export function isD1SizeError(error: unknown): boolean {
	const visited = new Set<unknown>()
	while (error instanceof Error && !visited.has(error)) {
		visited.add(error)
		// Inspect the database cause, not Drizzle's wrapper (which contains SQL
		// parameters supplied by the caller).
		if (/^D1_ERROR: (?:Error: )?string or blob too big\b/.test(error.message)) {
			return true
		}
		error = error.cause
	}
	return false
}

export async function storeReport({
	db,
	projectId,
	userId,
	ref,
	data,
	summary,
	allowance,
	exempt,
}: {
	db: D1Database
	projectId: string
	userId: number
	ref: string
	data: string
	summary: string
	allowance: number
	exempt: boolean
}): Promise<boolean> {
	// D1 executes this single statement atomically. Replacements are always
	// eligible; concurrent inserts must each observe the committed account count.
	const result = await db
		.prepare(`
		INSERT INTO reports (projectId, ref, data, jsonSummary)
		SELECT ?1, ?2, ?3, ?4
		WHERE EXISTS (SELECT 1 FROM projects WHERE id = ?1 AND userId = ?5)
		AND (?6 OR EXISTS (SELECT 1 FROM reports WHERE projectId = ?1 AND ref = ?2)
			OR (SELECT count(*) FROM reports r JOIN projects p ON p.id = r.projectId
				WHERE p.userId = ?5) < ?7)
		ON CONFLICT (projectId, ref) DO UPDATE SET
			data = excluded.data, jsonSummary = excluded.jsonSummary
	`)
		.bind(projectId, ref, data, summary, userId, exempt ? 1 : 0, allowance)
		.run()
	return result.meta.changes > 0
}
