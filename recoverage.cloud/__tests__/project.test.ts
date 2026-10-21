import { XMLParser } from "fast-xml-parser"
import { Hono } from "hono"

import { Project } from "../src/project"

const parser = new XMLParser({
	isArray: (_name, path) =>
		path === `div.section` ||
		path === `div.section.div.div` ||
		path === `div.section.div.div.span`,
})

async function renderReports(
	reportCount: number,
	githubUserId: number,
	mode: `deleted` | `existing` = `existing`,
) {
	const preview = new Hono().get(`/`, async (c) =>
		c.html(
			await Project({
				id: `report-slots`,
				name: `Report slots`,
				tokens: [],
				reports: Array.from({ length: reportCount }, (_, index) => ({
					ref: `report-${index}`,
					jsonSummary: null,
				})),
				mode,
				userRole: `free`,
				githubUserId,
			}),
		),
	)
	const html = await (await preview.request(`/`)).text()
	const project = parser.parse(html) as {
		div: { section: { div: { div: { span: unknown[] }[] } }[] }
	}
	return { html, rows: project.div.section[0].div.div }
}

for (const mode of [`existing`, `deleted`] as const) {
	describe(`${mode} project report slots`, () => {
		test.each([0, 1, 2, 3])(
			`keeps three slots for a limited account with %i reports`,
			async (reportCount) => {
				const { rows } = await renderReports(reportCount, 1974001, mode)
				expect(rows.map((row) => row.span.length)).toEqual([3])
			},
		)

		test.each([
			[0, [6]],
			[3, [6]],
			[5, [6]],
			[6, [6, 6]],
			[7, [6, 6]],
			[11, [6, 6]],
			[12, [6, 6, 6]],
			[13, [6, 6, 6]],
			[18, [6, 6, 6, 6]],
		] as const)(
			`expands an eligible account's rows with %i reports`,
			async (reportCount, expectedRowSizes) => {
				const { html, rows } = await renderReports(reportCount, 8570459, mode)
				expect(rows.map((row) => row.span.length)).toEqual(expectedRowSizes)
				for (let index = 0; index < reportCount; index++) {
					expect(html).toContain(`>report-${index}<`)
				}
			},
		)

		test(`preserves saved reports above an account's current quota`, async () => {
			const { html, rows } = await renderReports(7, 1974001, mode)
			expect(rows.map((row) => row.span.length)).toEqual([6, 1])
			expect(html).toContain(`>report-6<`)
		})
	})
}
