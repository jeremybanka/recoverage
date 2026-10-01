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
const billingFactsQuery = `SELECT stripeSubscriptionId, stripeCustomerId, userId,
	priceId, status, currentPeriodEnd, latestInvoiceId, latestInvoicePaidAt,
	cancelAtPeriodEnd, updatedAt FROM stripeSubscriptions ORDER BY stripeSubscriptionId`
let previousBillingFacts: unknown[] = []
for (const file of migrations) {
	if (file.startsWith(`0004_`)) {
		db.exec(`INSERT INTO users (id, role) VALUES (123, 'free');
			INSERT INTO projects (id, userId, name) VALUES ('existing-project', 123, 'Existing');
			INSERT INTO tokens (id, name, hash, salt, projectId) VALUES ('existing-token', 'CI', 'hash', 'salt', 'existing-project');
			INSERT INTO reports (projectId, ref, data, jsonSummary) VALUES ('existing-project', 'baseline', '{}', '{}');`)
	}
	if (file.startsWith(`0006_`)) {
		db.exec(`INSERT INTO stripeCustomers (userId, stripeCustomerId) VALUES (123, 'cus_existing');
			INSERT INTO stripeSubscriptions (stripeSubscriptionId, stripeCustomerId, userId,
				priceId, status, currentPeriodEnd, latestInvoiceId, latestInvoicePaidAt, cancelAtPeriodEnd, updatedAt)
			VALUES ('sub_paid', 'cus_existing', 123, 'price_supporter', 'active', '2026-10-30 00:00:00',
				'in_paid', '2026-09-30 00:00:00', 1, '2026-09-30 00:00:01'),
				('sub_unpaid', 'cus_existing', 123, 'price_supporter', 'past_due', '2026-10-30 00:00:00',
				'in_unpaid', NULL, 0, '2026-09-30 00:00:02');`)
		previousBillingFacts = db.query(billingFactsQuery).all()
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
assert.deepEqual(db.query(billingFactsQuery).all(), previousBillingFacts)
assert.deepEqual(
	db.query(`SELECT userId, stripeCustomerId FROM stripeCustomers`).all(),
	[{ userId: 123, stripeCustomerId: `cus_existing` }],
)
assert.deepEqual(
	db
		.query(
			`SELECT stripeSubscriptionId, syncRevision FROM stripeSubscriptions ORDER BY stripeSubscriptionId`,
		)
		.all(),
	[
		{ stripeSubscriptionId: `sub_paid`, syncRevision: 0 },
		{ stripeSubscriptionId: `sub_unpaid`, syncRevision: 0 },
	],
)
assert.deepEqual(db.query(`PRAGMA foreign_key_check`).all(), [])
assert.throws(() => db.query(`SELECT role FROM users`).all())
db.close()
console.info(
	`Generated migrations preserve existing users, projects, tokens, reports, and billing facts; existing subscription synchronization revisions start at zero. Old Worker code requiring users.role is incompatible; use the schema-compatible rollback procedure.`,
)
