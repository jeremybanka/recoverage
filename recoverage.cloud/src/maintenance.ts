export async function redactWebhookPayloads(db: D1Database): Promise<number> {
	// Keep the compact event ID/outcome for deduplication. A later delivery
	// supplies its own signed body, so redaction does not prevent retries.
	const result = await db
		.prepare(`UPDATE stripeWebhookEvents SET payload = '{}'
		WHERE payload != '{}' AND (
			(processedAt IS NOT NULL AND receivedAt < datetime('now', '-30 days')) OR
			(processedAt IS NULL AND receivedAt < datetime('now', '-90 days'))
		)`)
		.run()
	return result.meta.changes
}
