#!/usr/bin/env bun

import * as fs from "node:fs"
import * as path from "node:path"

import { getPreviewConfigEnv } from "./preview-env"

const env = getPreviewConfigEnv()
const root = path.join(import.meta.dir, `..`)
const config = JSON.parse(
	fs
		.readFileSync(path.join(root, `wrangler.jsonc`), `utf8`)
		.replace(/^\s*\/\/.*$/gm, ``),
)
if (
	!/^[a-z0-9-]+$/.test(env.WORKER_NAME) ||
	env.WORKER_NAME === config.name ||
	env.DATABASE_ID === config.d1_databases[0].database_id ||
	env.DATABASE_NAME === config.d1_databases[0].database_name
) {
	throw new Error(`Billing preview must use its own Worker and D1 database.`)
}
config.name = env.WORKER_NAME
config.preview_urls = false
config.vars = {
	REPORT_RATE_SCOPE: config.name,
	STRIPE_MODE: `test`,
	CHECKOUT_ENABLED: `false`,
}
config.d1_databases[0].database_name = env.DATABASE_NAME
config.d1_databases[0].database_id = env.DATABASE_ID
const output = path.join(root, `wrangler-billing-preview.jsonc`)
fs.writeFileSync(output, JSON.stringify(config, null, 2))
console.info(
	`Wrote ${output}. Configure separate OAuth and Stripe test secrets before deploying. Checkout remains disabled.`,
)
