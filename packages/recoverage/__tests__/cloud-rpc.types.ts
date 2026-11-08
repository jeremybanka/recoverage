import type { hc } from "hono/client"
import { parseResponse } from "hono/client"

import type { apiContract } from "../src/cloud-api.gen.d.ts"

// Checked by check:tsc, without making network requests.
async function cloudContract(client: ReturnType<typeof hc<typeof apiContract>>) {
	await client.auth.session.$post({ json: { deviceCode: `device` } })
	await client.projects.$post({ json: { name: `project` } })
	await client.projects[`:projectId`].tokens.$post({
		param: { projectId: `project` },
		json: { name: `ci` },
	})
	await client.projects[`:projectId`].tokens[`:tokenId`].$delete({
		param: { projectId: `project`, tokenId: `token` },
	})
	// @ts-expect-error A project name is required by the server validator.
	await client.projects.$post({ json: {} })
	// @ts-expect-error Session exchange requires a string device code.
	await client.auth.session.$post({ json: { deviceCode: 123 } })
	// @ts-expect-error Token creation requires a project route parameter.
	await client.projects[`:projectId`].tokens.$post({ json: { name: `ci` } })
	// @ts-expect-error Undeclared API methods cannot be called.
	await client.account.$post()
	const account = await parseResponse(client.account.$get())
	account.login satisfies string
	account.limits.projects satisfies number | null
	// @ts-expect-error Account responses do not expose credentials.
	account.token
	const { projects } = await parseResponse(client.projects.$get())
	projects[0].name satisfies string
	projects[0].tokens[0].id satisfies string
	// @ts-expect-error Token listings do not expose secrets.
	projects[0].tokens[0].secret
	const token = await parseResponse(
		client.projects[`:projectId`].tokens.$post({
			param: { projectId: `project` },
			json: { name: `ci` },
		}),
	)
	const project = client.projects[`:projectId`]
	const param = { projectId: `project` }
	await project.$patch({ param, json: { name: `renamed` } })
	// @ts-expect-error Renaming requires a name.
	await project.$patch({ param, json: {} })
	const report = project.reports[`:reportRef`]
	const reportParam = { ...param, reportRef: `package` }
	const metadata = await parseResponse(report.$get({ param: reportParam }))
	metadata.ref satisfies string
	metadata.jsonSummary?.total.statements.pct satisfies number | undefined
	const data = await parseResponse(report.data.$get({ param: reportParam }))
	data.ref satisfies string
	// @ts-expect-error Uploads require the coverage map and summary.
	await report.$put({ param: reportParam, json: {} })
	await report.$put({
		param: reportParam,
		// @ts-expect-error Maps cannot be strings, and summaries require totals.
		json: { mapData: `bad`, jsonSummary: {} },
	})
	const badge = await parseResponse(report.badge.$get({ param: reportParam }))
	badge.markdown satisfies string
	const listing = await parseResponse(project.tokens.$get({ param }))
	// @ts-expect-error Token metadata cannot expose credentials.
	listing.tokens[0].hash
	token.token satisfies string
}

cloudContract
