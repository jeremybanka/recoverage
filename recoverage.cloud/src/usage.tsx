import { eq, sql } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { HtmlEscapedString } from "hono/utils/html"

import type { Loadable } from "./loadable"
import {
	hostedReportsAllowed,
	projectsAllowed,
	type Role,
	unlimitedReportGithubUserIds,
} from "./roles-permissions"
import * as schema from "./schema"

export async function accountUsage(
	db: DrizzleD1Database<typeof schema>,
	userId: number,
): Promise<{ projects: number; reports: number }> {
	const [projects, reports] = await Promise.all([
		db
			.select({ count: sql<number>`count(*)` })
			.from(schema.projects)
			.where(eq(schema.projects.userId, userId))
			.get(),
		db
			.select({ count: sql<number>`count(*)` })
			.from(schema.reports)
			.innerJoin(
				schema.projects,
				eq(schema.reports.projectId, schema.projects.id),
			)
			.where(eq(schema.projects.userId, userId))
			.get(),
	])
	return { projects: projects?.count ?? 0, reports: reports?.count ?? 0 }
}

export function AccountUsage({
	usage,
	userId,
	role,
}: {
	usage: Awaited<ReturnType<typeof accountUsage>>
	userId: number
	role: Role
}): Loadable<HtmlEscapedString> {
	const reportLimit = hostedReportsAllowed.get(role)
	const projectLimit = projectsAllowed.get(role)
	const exempt = unlimitedReportGithubUserIds.has(userId)
	return (
		<section
			id="account-usage"
			aria-label="Account usage"
			hx-get="/ui/usage"
			hx-trigger="usage-changed from:body"
			hx-swap="outerHTML"
		>
			<p>
				Hosted reports: {usage.reports} /{` `}
				{exempt ? `exempt from report-count limit` : reportLimit}
			</p>
			<p>
				Projects: {usage.projects} / {projectLimit}
			</p>
			{!exempt && usage.reports >= reportLimit ? (
				<p>
					Your account is at its report limit. Existing reports can still be
					updated and read. Creating another report requires more available
					slots.
				</p>
			) : null}
			{usage.projects >= projectLimit ? (
				<p>
					Your account is at its project limit. Existing projects remain
					available.
				</p>
			) : null}
		</section>
	)
}

export function StorageHelp(): Loadable<HtmlEscapedString> {
	return (
		<p>
			Individual reports have the same storage limit on every plan. If a report
			is too large, reduce the files included in coverage or split it into
			smaller reports. Upgrading does not increase this limit.
		</p>
	)
}
