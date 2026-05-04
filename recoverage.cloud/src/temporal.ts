import { Temporal } from "@js-temporal/polyfill"
import { regex } from "arkregex"

export type ISO8601 = string & { __brand: `ISO8601` }

export function iso8601FromInstant(date: Temporal.Instant): ISO8601
export function iso8601FromInstant(date: Temporal.Instant | null): ISO8601 | null
export function iso8601FromInstant(
	instant: Temporal.Instant | null,
): ISO8601 | null {
	return (instant?.toString({ smallestUnit: `millisecond` }) as ISO8601) ?? null
}

export function instantFromISO8601(isoString: ISO8601): Temporal.Instant
export function instantFromISO8601(
	isoString: ISO8601 | null,
): Temporal.Instant | null
export function instantFromISO8601(
	isoString: ISO8601 | null,
): Temporal.Instant | null {
	return isoString ? Temporal.Instant.from(isoString) : null
}

export function isoNow(): ISO8601 {
	return iso8601FromInstant(Temporal.Now.instant())
}

export const iso8601 = regex.as<ISO8601>(
	`^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
)
