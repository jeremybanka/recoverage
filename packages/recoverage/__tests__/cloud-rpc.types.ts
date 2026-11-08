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
	token.token satisfies string
}

cloudContract
