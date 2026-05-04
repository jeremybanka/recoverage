import { Temporal } from "@js-temporal/polyfill"

import { instantFromISO8601, iso8601, iso8601FromInstant } from "../src/temporal"

test(`ISO8601 helper round-trips Temporal instants at millisecond precision`, () => {
	const instant = Temporal.Instant.from(`2026-02-16T14:00:00.123456789Z`)
	const isoString = iso8601FromInstant(instant)

	expect(isoString).toBe(`2026-02-16T14:00:00.123Z`)
	expect(iso8601.test(isoString)).toBe(true)
	expect(instantFromISO8601(isoString).toString()).toBe(
		`2026-02-16T14:00:00.123Z`,
	)
})
