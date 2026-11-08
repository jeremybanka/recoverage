import { and, asc, eq, sql } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"

import type { CoveragePayload } from "./coverage-payload"
import { parse, stringify } from "./json"
import { managementError } from "./management"
import {
	reportsAllowed,
	type Role,
	unlimitedReportGithubUserIds,
} from "./roles-permissions"
import * as schema from "./schema"

type Database = DrizzleD1Database<typeof schema>
type Report = typeof schema.reports.$inferSelect

export function validateReportRef(ref: string): void {
	if (
		!ref ||
		ref.length > 64 ||
		ref === `.` ||
		ref === `..` ||
		// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in report refs.
		/[/\\\u0000-\u001f\u007f]/.test(ref)
	)
		managementError(
			400,
			`Report ref must contain 1–64 characters and no slashes or control characters.`,
		)
}

export async function getReport(
	db: Database,
	projectId: string,
	ref: string,
): Promise<Report> {
	validateReportRef(ref)
	const report = await db.query.reports.findFirst({
		where: and(
			eq(schema.reports.projectId, projectId),
			eq(schema.reports.ref, ref),
		),
	})
	if (!report) managementError(404, `No report found`)
	return report
}

export async function listReports(
	db: Database,
	projectId: string,
): Promise<
	{
		ref: string
		createdAt: string
		jsonSummary: CoveragePayload[`jsonSummary`] | null
	}[]
> {
	const reports = await db
		.select({
			ref: schema.reports.ref,
			createdAt: schema.reports.createdAt,
			jsonSummary: schema.reports.jsonSummary,
		})
		.from(schema.reports)
		.where(eq(schema.reports.projectId, projectId))
		.orderBy(asc(schema.reports.ref))
	return reports.map((report) => ({
		...report,
		jsonSummary: report.jsonSummary ? parse(report.jsonSummary) : null,
	}))
}

export async function saveReport(
	db: Database,
	projectId: string,
	userId: number,
	role: Role,
	ref: string,
	payload: CoveragePayload,
	quotaStatus: 401 | 403 = 403,
): Promise<void> {
	validateReportRef(ref)
	const limit = unlimitedReportGithubUserIds.has(userId)
		? Number.MAX_SAFE_INTEGER
		: reportsAllowed.get(role)
	const data = stringify(payload.mapData)
	const summary = stringify(payload.jsonSummary)
	// Replacements consume no quota. Keep the count, insert, and upsert atomic.
	const [saved] = await db
		.insert(schema.reports)
		.select(sql`
		select ${ref} as ref, ${projectId} as projectId, ${data} as data,
		${summary} as jsonSummary, current_timestamp as createdAt
		where exists (select 1 from ${schema.reports} where ${schema.reports.projectId} = ${projectId} and ${schema.reports.ref} = ${ref})
		or (select count(*) from ${schema.reports} where ${schema.reports.projectId} = ${projectId}) < ${limit}
	`)
		.onConflictDoUpdate({
			target: [schema.reports.ref, schema.reports.projectId],
			set: { data, jsonSummary: summary },
		})
		.returning({ ref: schema.reports.ref })
	if (!saved) managementError(quotaStatus, `You may not create more reports`)
}

export async function deleteReport(
	db: Database,
	projectId: string,
	ref: string,
): Promise<void> {
	validateReportRef(ref)
	const [deleted] = await db
		.delete(schema.reports)
		.where(
			and(eq(schema.reports.projectId, projectId), eq(schema.reports.ref, ref)),
		)
		.returning({ ref: schema.reports.ref })
	if (!deleted) managementError(404, `No report found`)
}
