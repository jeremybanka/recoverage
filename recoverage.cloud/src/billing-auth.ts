import type { Endpoints } from "@octokit/types"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { MiddlewareHandler } from "hono"

import type { Bindings } from "./env"
import type * as schema from "./schema"

export type BillingEnv = {
	Bindings: Bindings
	Variables: {
		drizzle: DrizzleD1Database<typeof schema>
		githubUserData: Endpoints[`GET /user`][`response`][`data`]
		userId: number
	}
}

// Browser POSTs must originate from this app; a sibling origin is not trusted.
export const billingSameOrigin: MiddlewareHandler<BillingEnv> = async (
	c,
	next,
) => {
	if (
		c.req.header(`origin`) !== new URL(c.req.url).origin ||
		(c.req.header(`sec-fetch-site`) !== undefined &&
			c.req.header(`sec-fetch-site`) !== `same-origin`)
	) {
		return c.json(
			{ error: `Open billing management from your account page.` },
			403,
		)
	}
	await next()
}
