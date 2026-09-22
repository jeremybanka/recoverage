#!/usr/bin/env bun

import { strict as assert } from "node:assert"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { Database } from "bun:sqlite"

// Exercise the generated SQL on representative existing data. Never connect
// this rehearsal to a deployed database and never modify migration files.
const db = new Database(`:memory:`)
db.exec(`PRAGMA foreign_keys = ON`)
const migrationsPath = path.join(import.meta.dir, `../drizzle`)
const migrations = readdirSync(migrationsPath)
	.filter((file) => file.endsWith(`.sql`))
	.sort()
for (const file of migrations) {
	if (file.startsWith(`0004_`)) {
		db.exec(`INSERT INTO users (id, role) VALUES (123, 'free');
			INSERT INTO projects (id, userId, name) VALUES ('existing-project', 123, 'Existing');
			INSERT INTO tokens (id, name, hash, salt, projectId) VALUES ('existing-token', 'CI', 'hash', 'salt', 'existing-project');
			INSERT INTO reports (projectId, ref, data, jsonSummary) VALUES ('existing-project', 'baseline', '{}', '{}');`)
	}
	db.exec(readFileSync(path.join(migrationsPath, file), `utf8`))
}
assert.deepEqual(db.query(`SELECT id, manualRoleOverride FROM users`).all(), [
	{ id: 123, manualRoleOverride: null },
])
assert.deepEqual(db.query(`SELECT projectId, ref, data FROM reports`).all(), [
	{ projectId: `existing-project`, ref: `baseline`, data: `{}` },
])
assert.deepEqual(db.query(`SELECT id FROM tokens`).all(), [
	{ id: `existing-token` },
])
assert.deepEqual(db.query(`PRAGMA foreign_key_check`).all(), [])
assert.throws(() => db.query(`SELECT role FROM users`).all())
db.close()
console.info(
	`Generated migrations preserve existing users, projects, tokens, and reports. Old Worker code requiring users.role is incompatible; use the schema-compatible rollback procedure.`,
)
