ALTER TABLE `projects` ADD `createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL;--> statement-breakpoint
ALTER TABLE `reports` ADD `createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL;--> statement-breakpoint
ALTER TABLE `tokens` ADD `createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL;