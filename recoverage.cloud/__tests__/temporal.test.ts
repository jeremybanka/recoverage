import { Temporal } from "@js-temporal/polyfill"

import {
	instantFromSQLTimestamp,
	sqlTimestamp,
	sqlTimestampFromInstant,
} from "../src/temporal"

test(`SQL timestamp helper round-trips Temporal instants at second precision`, () => {
	const instant = Temporal.Instant.from(`2026-02-16T14:00:00.123456789Z`)
	const timestamp = sqlTimestampFromInstant(instant)

	expect(timestamp).toBe(`2026-02-16 14:00:00`)
	expect(sqlTimestamp.test(timestamp)).toBe(true)
	expect(instantFromSQLTimestamp(timestamp).toString()).toBe(
		`2026-02-16T14:00:00Z`,
	)
})
