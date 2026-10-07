import type { CoverageMap } from "istanbul-lib-coverage"

import { stringify } from "./json.ts"
import type { JsonSummary } from "./recoverage.ts"

export async function downloadCoverageReportFromCloud(
	reportName: string,
	cloudToken: string | undefined,
	cloudHost = `https://recoverage.cloud`,
	publicProjectId?: string,
): Promise<Error | string> {
	if (!cloudToken && !publicProjectId) {
		return new Error(
			`A cloud token or public project ID is required to download coverage`,
		)
	}
	const reportPath = cloudToken
		? `/reporter/${encodeURIComponent(reportName)}`
		: `/reporter/public/${encodeURIComponent(publicProjectId ?? ``)}/${encodeURIComponent(reportName)}`
	const url = new URL(reportPath, cloudHost)
	try {
		const response = await fetch(url, {
			method: `GET`,
			headers: cloudToken ? { Authorization: `Bearer ${cloudToken}` } : {},
		})
		if (!response.ok) {
			const text = await response.text()
			return new Error(
				`Failed to fetch coverage report: [${response.status}] ${text}`,
			)
		}

		const text = await response.text()
		return text
	} catch (error) {
		if (error instanceof Error) {
			return error
		}
		throw error
	}
}

export async function uploadCoverageReportToCloud(
	reportName: string,
	coverageMap: CoverageMap,
	jsonSummary: JsonSummary,
	cloudToken: string,
	cloudHost = `https://recoverage.cloud`,
): Promise<Error | { success: true }> {
	const url = new URL(`/reporter/${reportName}`, cloudHost)
	try {
		const response = await fetch(url, {
			method: `PUT`,
			headers: {
				Authorization: `Bearer ${cloudToken}`,
			},
			body: stringify({ mapData: coverageMap, jsonSummary }),
		})
		if (!response.ok) {
			const text = await response.text()
			return new Error(
				`Failed to upload coverage report: [${response.status}] ${text}`,
			)
		}
		return { success: true }
	} catch (error) {
		if (error instanceof Error) {
			return error
		}
		throw error
	}
}
