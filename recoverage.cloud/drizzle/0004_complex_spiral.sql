CREATE TABLE `stripeCustomers` (
	`userId` integer PRIMARY KEY NOT NULL,
	`stripeCustomerId` text NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stripeCustomers_stripeCustomerId_unique` ON `stripeCustomers` (`stripeCustomerId`);--> statement-breakpoint
CREATE TABLE `stripeSubscriptions` (
	`stripeSubscriptionId` text PRIMARY KEY NOT NULL,
	`stripeCustomerId` text NOT NULL,
	`userId` integer NOT NULL,
	`priceId` text NOT NULL,
	`status` text NOT NULL,
	`currentPeriodEnd` text NOT NULL,
	`latestInvoiceId` text,
	`latestInvoicePaidAt` text,
	`cancelAtPeriodEnd` integer DEFAULT false NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`stripeCustomerId`) REFERENCES `stripeCustomers`(`stripeCustomerId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `stripeWebhookEvents` (
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
ALTER TABLE `users` ADD `manualRoleOverride` text;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `role`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `createdAt`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `createdAt`;--> statement-breakpoint
ALTER TABLE `reports` DROP COLUMN `createdAt`;--> statement-breakpoint
ALTER TABLE `tokens` DROP COLUMN `createdAt`;