PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` integer NOT NULL,
	`name` text NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "userId", "name", "createdAt") SELECT "id", "userId", "name", "createdAt" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_reports` (
	`ref` text NOT NULL,
	`projectId` text NOT NULL,
	`data` text NOT NULL,
	`jsonSummary` text,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`projectId`, `ref`),
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_reports`("ref", "projectId", "data", "jsonSummary", "createdAt") SELECT "ref", "projectId", "data", "jsonSummary", "createdAt" FROM `reports`;--> statement-breakpoint
DROP TABLE `reports`;--> statement-breakpoint
ALTER TABLE `__new_reports` RENAME TO `reports`;--> statement-breakpoint
CREATE TABLE `__new_stripeCustomers` (
	`userId` integer PRIMARY KEY NOT NULL,
	`stripeCustomerId` text NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_stripeCustomers`("userId", "stripeCustomerId", "createdAt") SELECT "userId", "stripeCustomerId", "createdAt" FROM `stripeCustomers`;--> statement-breakpoint
DROP TABLE `stripeCustomers`;--> statement-breakpoint
ALTER TABLE `__new_stripeCustomers` RENAME TO `stripeCustomers`;--> statement-breakpoint
CREATE UNIQUE INDEX `stripeCustomers_stripeCustomerId_unique` ON `stripeCustomers` (`stripeCustomerId`);--> statement-breakpoint
CREATE TABLE `__new_stripeWebhookEvents` (
	`stripeEventId` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`mode` text NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`receivedAt` text NOT NULL,
	`processedAt` text,
	`payload` text NOT NULL,
	`processingError` text
);
--> statement-breakpoint
INSERT INTO `__new_stripeWebhookEvents`("stripeEventId", "type", "mode", "createdAt", "receivedAt", "processedAt", "payload", "processingError") SELECT "stripeEventId", "type", "mode", "createdAt", "receivedAt", "processedAt", "payload", "processingError" FROM `stripeWebhookEvents`;--> statement-breakpoint
DROP TABLE `stripeWebhookEvents`;--> statement-breakpoint
ALTER TABLE `__new_stripeWebhookEvents` RENAME TO `stripeWebhookEvents`;--> statement-breakpoint
CREATE TABLE `__new_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`hash` text NOT NULL,
	`salt` text NOT NULL,
	`projectId` text NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_tokens`("id", "name", "hash", "salt", "projectId", "createdAt") SELECT "id", "name", "hash", "salt", "projectId", "createdAt" FROM `tokens`;--> statement-breakpoint
DROP TABLE `tokens`;--> statement-breakpoint
ALTER TABLE `__new_tokens` RENAME TO `tokens`;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY NOT NULL,
	`manualRoleOverride` text,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "manualRoleOverride", "createdAt") SELECT "id", "manualRoleOverride", "createdAt" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;