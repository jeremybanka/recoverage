#!/usr/bin/env bun

import * as fs from "node:fs"
import * as path from "node:path"

const projectRootPath = path.join(import.meta.dir, `..`)
const wranglerConfigPath = path.join(projectRootPath, `wrangler.jsonc`)
let content = fs.readFileSync(wranglerConfigPath, `utf8`)
// Remove single-line comments (basic regex, sufficient for simple JSONC)
content = content.replace(/\/\/.*$/gm, ``)
const config = JSON.parse(content)

// Update worker name
config.name = `preview-worker-pr-${process.env.PR_NUMBER}`
// Update database name and ID (assuming single database at index 0)
config.d1_databases[0].database_name = `preview-db-pr-${process.env.PR_NUMBER}`
config.d1_databases[0].database_id = process.env.DATABASE_ID

const wranglerPreviewConfigPath = path.join(
	projectRootPath,
	`wrangler-preview.jsonc`,
)
fs.writeFileSync(wranglerPreviewConfigPath, JSON.stringify(config, null, 2))
