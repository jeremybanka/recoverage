import type { Permissions, Roles } from "jurist"
import { Escalator, Laws, optional, required } from "jurist"

export type Role = Roles<typeof laws>
export type Permission = Permissions<typeof laws>
// Stable GitHub user IDs verified via GET /users/{login}. These IDs are stored
// in users.id during GitHub OAuth; never trust an ID supplied in an upload.
export const unlimitedReportGithubUserIds: ReadonlySet<number> = new Set([
	8570459, // jeremybanka
])

export const laws = new Laws({
	roles: [`free`, `supporter`, `admin`],
	permissions: required({
		ownProjects: optional({
			"<=3": optional({
				"<=100": optional({
					"<=200": null,
				}),
			}),
			attachTokens: optional({
				"<=5": optional({
					"<=10": optional({
						"<=25": null,
					}),
				}),
			}),
		}),
		hostReports: optional({
			"<=3": optional({
				"<=100": optional({
					"<=200": null,
				}),
			}),
		}),
	}),
	rolePermissions: {
		free: new Set([
			`ownProjects_<=3`,
			`ownProjects_attachTokens_<=5`,
			`hostReports_<=3`,
		] as const),
		supporter: new Set([
			`ownProjects_<=3_<=100`,
			`ownProjects_attachTokens_<=5_<=10`,
			`hostReports_<=3_<=100`,
		] as const),
		admin: new Set([
			`ownProjects_<=3_<=100_<=200`,
			`ownProjects_attachTokens_<=5_<=10_<=25`,
			`hostReports_<=3_<=100_<=200`,
		] as const),
	},
})

export const projectsAllowed = new Escalator({
	style: `untilMiss`,
	laws,
	permissionData: [
		[`ownProjects_<=3`, 3],
		[`ownProjects_<=3_<=100`, 100],
		[`ownProjects_<=3_<=100_<=200`, 200],
	] as const,
	fallback: 0 as const,
})

export const tokensAllowed = new Escalator({
	style: `untilMiss`,
	laws,
	permissionData: [
		[`ownProjects_attachTokens_<=5`, 5],
		[`ownProjects_attachTokens_<=5_<=10`, 10],
		[`ownProjects_attachTokens_<=5_<=10_<=25`, 25],
	] as const,
	fallback: 0 as const,
})

export const hostedReportsAllowed = new Escalator({
	style: `untilMiss`,
	laws,
	permissionData: [
		[`hostReports_<=3`, 3],
		[`hostReports_<=3_<=100`, 100],
		[`hostReports_<=3_<=100_<=200`, 200],
	] as const,
	fallback: 0 as const,
})
