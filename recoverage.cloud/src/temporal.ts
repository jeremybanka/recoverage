import { Temporal } from "@js-temporal/polyfill"
import { regex } from "arkregex"

export type SQLTimestamp = string & { __brand: `SQLTimestamp` }

function iso8601FromInstant(instant: Temporal.Instant): string {
	return instant.toString({ smallestUnit: `second` })
}

export function sqlTimestampFromInstant(instant: Temporal.Instant): SQLTimestamp
export function sqlTimestampFromInstant(
	instant: Temporal.Instant | null,
): SQLTimestamp | null
export function sqlTimestampFromInstant(
	instant: Temporal.Instant | null,
): SQLTimestamp | null {
	return instant
		? (iso8601FromInstant(instant)
				.replace(`T`, ` `)
				.replace(`Z`, ``) as SQLTimestamp)
		: null
}

export function instantFromSQLTimestamp(
	timestamp: SQLTimestamp,
): Temporal.Instant
export function instantFromSQLTimestamp(
	timestamp: SQLTimestamp | null,
): Temporal.Instant | null
export function instantFromSQLTimestamp(
	timestamp: SQLTimestamp | null,
): Temporal.Instant | null {
	return timestamp
		? Temporal.Instant.from(timestamp.replace(` `, `T`) + `Z`)
		: null
}

export function sqlNow(): SQLTimestamp {
	return sqlTimestampFromInstant(Temporal.Now.instant())
}

export function sqlTimestampFromUnixSeconds(seconds: number): SQLTimestamp
export function sqlTimestampFromUnixSeconds(
	seconds: number | null,
): SQLTimestamp | null
export function sqlTimestampFromUnixSeconds(
	seconds: number | null,
): SQLTimestamp | null {
	return seconds === null
		? null
		: sqlTimestampFromInstant(
				Temporal.Instant.fromEpochMilliseconds(seconds * 1000),
			)
}

export const sqlTimestamp = regex.as<SQLTimestamp>(
	`^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$`,
)
