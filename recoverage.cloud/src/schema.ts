import type { $Type, SQL } from "drizzle-orm"
import { relations, sql } from "drizzle-orm"
import type { SQLiteTextBuilderInitial } from "drizzle-orm/sqlite-core"
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core"
import type { CoverageMap } from "istanbul-lib-coverage"
import type { JsonSummary } from "recoverage"

import type { Json } from "./json"
import type { Role } from "./roles-permissions"
import type { SQLTimestamp } from "./temporal"

export function sqlTimestamp(): $Type<
	SQLiteTextBuilderInitial<``, [string, ...string[]], undefined>,
	SQLTimestamp
> {
	return text().$type<SQLTimestamp>()
}

export const SQL_NOW: SQL<SQLTimestamp> = sql<SQLTimestamp>`(current_timestamp)`

export const users = sqliteTable(`users`, {
	id: integer().primaryKey(),
	manualRoleOverride: text().$type<Role>(),
	createdAt: sqlTimestamp().notNull().default(SQL_NOW),
})

export const stripeCustomers = sqliteTable(
	`stripeCustomers`,
	{
		userId: integer()
			.references(() => users.id, { onDelete: `cascade` })
			.primaryKey(),
		stripeCustomerId: text().notNull(),
		createdAt: sqlTimestamp().notNull().default(SQL_NOW),
	},
	(table) => [
		uniqueIndex(`stripeCustomers_stripeCustomerId_unique`).on(
			table.stripeCustomerId,
		),
	],
)
export const stripeCustomersRelations = relations(
	stripeCustomers,
	({ many, one }) => ({
		subscriptions: many(stripeSubscriptions),
		user: one(users, {
			fields: [stripeCustomers.userId],
			references: [users.id],
		}),
	}),
)

export type StripeSubscriptionStatus =
	| `active`
	| `canceled`
	| `incomplete_expired`
	| `incomplete`
	| `past_due`
	| `paused`
	| `trialing`
	| `unpaid`

export const stripeSubscriptions = sqliteTable(`stripeSubscriptions`, {
	stripeSubscriptionId: text().primaryKey(),
	stripeCustomerId: text()
		.references(() => stripeCustomers.stripeCustomerId, { onDelete: `cascade` })
		.notNull(),
	userId: integer()
		.references(() => users.id, { onDelete: `cascade` })
		.notNull(),
	priceId: text().notNull(),
	status: text().$type<StripeSubscriptionStatus>().notNull(),
	currentPeriodEnd: sqlTimestamp().notNull(),
	latestInvoiceId: text(),
	latestInvoicePaidAt: sqlTimestamp(),
	cancelAtPeriodEnd: integer({ mode: `boolean` }).default(false).notNull(),
	updatedAt: sqlTimestamp().notNull(),
})
export const stripeSubscriptionsRelations = relations(
	stripeSubscriptions,
	({ one }) => ({
		customer: one(stripeCustomers, {
			fields: [stripeSubscriptions.stripeCustomerId],
			references: [stripeCustomers.stripeCustomerId],
		}),
		user: one(users, {
			fields: [stripeSubscriptions.userId],
			references: [users.id],
		}),
	}),
)

export type StripeWebhookEventMode = `live` | `test`

export const stripeWebhookEvents = sqliteTable(`stripeWebhookEvents`, {
	stripeEventId: text().primaryKey(),
	type: text().notNull(),
	mode: text().$type<StripeWebhookEventMode>().notNull(),
	createdAt: sqlTimestamp().notNull().default(SQL_NOW),
	receivedAt: sqlTimestamp().notNull(),
	processedAt: sqlTimestamp(),
	payload: text().notNull().$type<Json.stringified<Json.Val>>(),
	processingError: text(),
})

export const projects = sqliteTable(`projects`, {
	id: text().primaryKey(),
	userId: integer()
		.references(() => users.id, { onDelete: `cascade` })
		.notNull(),
	name: text().notNull(),
	createdAt: sqlTimestamp().notNull().default(SQL_NOW),
})
export const projectsRelations = relations(projects, ({ many, one }) => ({
	tokens: many(tokens),
	reports: many(reports),
	user: one(users, {
		fields: [projects.userId],
		references: [users.id],
	}),
}))

export const tokens = sqliteTable(`tokens`, {
	id: text().primaryKey(),
	name: text().notNull(),
	hash: text().notNull(),
	salt: text().notNull(),
	projectId: text()
		.references(() => projects.id, { onDelete: `cascade` })
		.notNull(),
	createdAt: sqlTimestamp().notNull().default(SQL_NOW),
})
export const tokensRelations = relations(tokens, ({ one }) => ({
	project: one(projects, {
		fields: [tokens.projectId],
		references: [projects.id],
	}),
}))

export const reports = sqliteTable(
	`reports`,
	{
		ref: text().notNull(),
		projectId: text()
			.references(() => projects.id, { onDelete: `cascade` })
			.notNull(),
		data: text().notNull().$type<Json.stringified<CoverageMap>>(),
		jsonSummary: text().$type<Json.stringified<JsonSummary>>(),
		createdAt: sqlTimestamp().notNull().default(SQL_NOW),
	},
	(table) => [
		primaryKey({
			name: `projectIdRefPk`,
			columns: [table.projectId, table.ref],
		}),
	],
)
export const reportsRelations = relations(reports, ({ one }) => ({
	projects: one(projects, {
		fields: [reports.projectId],
		references: [projects.id],
	}),
}))
