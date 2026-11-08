import { type Type, type } from "arktype"
import type * as Istanbul from "istanbul-lib-coverage"
import type { CoverageEval, CoverageSummary, JsonSummary } from "recoverage"

const locationType: Type<Istanbul.Location> = type({
	line: `number.integer`,
	column: `number.integer`,
})

// Reusable schema for a source code location (start/end)
const rangeType: Type<Istanbul.Range> = type({
	start: locationType,
	end: locationType,
})

// Istanbul represents an implicit else branch without source coordinates.
// Keep this exception limited to completely empty branch locations.
const emptyLocationType = type({ "+": `reject` })
const implicitBranchRangeType = type({
	start: emptyLocationType,
	end: emptyLocationType,
})

// Coverage data for one file
const istanbulCoverageFileEntryType = type({
	path: `string`,
	statementMap: { "[string]": rangeType },
	fnMap: {
		"[string]": {
			name: `string`,
			line: `number.integer`,
			decl: rangeType,
			loc: rangeType,
		},
	},
	branchMap: {
		"[string]": {
			line: `number.integer`,
			type: `string`,
			locations: type([rangeType, `|`, implicitBranchRangeType], `[]`),
			loc: rangeType,
		},
	},
	// s, f, and b track how many times statements/functions/branches were hit
	s: { "[string]": `number.integer` },
	f: { "[string]": `number.integer` },
	b: { "[string]": `number.integer[]` },
})

// A coverage map is a record keyed by file path
export const istanbulCoverageMapType = type({
	"[string]": istanbulCoverageFileEntryType,
})
export type IstanbulCoverageMap = typeof istanbulCoverageMapType.infer

export type V8EndLocation = {
	line: number
	column: number | null
}
export const v8EndLocationType: Type<V8EndLocation> = type({
	line: `number.integer`,
	column: `null | number.integer`,
})
export type V8Range = {
	start: Istanbul.Location
	end: V8EndLocation
}
export const v8RangeType: Type<V8Range> = type({
	start: locationType,
	end: v8EndLocationType,
})
export type V8Function = {
	name: string
	decl: V8Range
	loc: V8Range
	line: number
}
export type V8Branch = {
	line: number
	type: string
	locations: (Empty | V8Range)[]
	loc: V8Range
}
export type V8FileCoverageEntry = {
	path: string
	statementMap: { [key: string]: V8Range }
	fnMap: { [key: string]: V8Function }
	branchMap: { [key: string]: V8Branch }
	s: { [key: string]: number }
	f: { [key: string]: number }
	b: { [key: string]: number[] }
	meta: {
		lastBranch: number
		lastFunction: number
		lastStatement: number
		seen: { [key: string]: number }
	}
}
export type Empty = Record<never, never>
export const emptyType: Type<Empty> = type({})
export const v8CoverageFileEntryType: Type<V8FileCoverageEntry> = type({
	path: `string`,
	statementMap: { "[string]": v8RangeType },
	fnMap: {
		"[string]": {
			name: `string`,
			decl: v8RangeType,
			loc: v8RangeType,
			line: `number.integer`,
		},
	},
	branchMap: {
		"[string]": {
			line: `number.integer`,
			type: `string`,
			locations: type([v8RangeType, `|`, emptyType], `[]`),
			loc: v8RangeType,
		},
	},
	s: { "[string]": `number.integer` },
	f: { "[string]": `number.integer` },
	b: { "[string]": `number.integer[]` },
	meta: {
		lastBranch: `number.integer`,
		lastFunction: `number.integer`,
		lastStatement: `number.integer`,
		seen: { "[string]": `number.integer` },
	},
})
export type V8CoverageMap = { [key: string]: V8FileCoverageEntry }
export const v8CoverageMapType: Type<V8CoverageMap> = type({
	"[string]": v8CoverageFileEntryType,
})

export const coverageEvalType: Type<CoverageEval> = type({
	total: `number.integer`,
	covered: `number.integer`,
	skipped: `number.integer`,
	pct: `number`,
})

export const jsonSummaryType: Type<CoverageSummary> = type({
	branches: coverageEvalType,
	functions: coverageEvalType,
	lines: coverageEvalType,
	statements: coverageEvalType,
})

export const jsonSummaryReportType: Type<JsonSummary> = type({
	total: jsonSummaryType,
	"[string]": jsonSummaryType,
})

export const reporterPutType = type({
	mapData: [istanbulCoverageMapType, `|`, v8CoverageMapType],
	jsonSummary: jsonSummaryReportType,
})

export type CoveragePayload = typeof reporterPutType.infer
