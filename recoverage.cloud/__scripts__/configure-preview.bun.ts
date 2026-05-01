#!/usr/bin/env bun

import * as fs from "node:fs"
import * as path from "node:path"

function requiredEnv(name: string): string {
	const value = process.env[name]
	if (!value) {
		throw new Error(`${name} is required`)
	}
	return value
}

const databaseId = requiredEnv(`DATABASE_ID`)
const databaseName = requiredEnv(`DATABASE_NAME`)
const workerName = requiredEnv(`WORKER_NAME`)

const projectRootPath = path.join(import.meta.dir, `..`)
const wranglerConfigPath = path.join(projectRootPath, `wrangler.jsonc`)
let content = fs.readFileSync(wranglerConfigPath, `utf8`)
// Remove single-line comments (basic regex, sufficient for simple JSONC)
content = content.replace(/\/\/.*$/gm, ``)
const config = JSON.parse(content)

// Update worker name
config.name = workerName
config.preview_urls = true
// Update database name and ID (assuming single database at index 0)
config.d1_databases[0].database_name = databaseName
config.d1_databases[0].database_id = databaseId

const wranglerPreviewConfigPath = path.join(
	projectRootPath,
	`wrangler-preview.jsonc`,
)
fs.writeFileSync(wranglerPreviewConfigPath, JSON.stringify(config, null, 2))
