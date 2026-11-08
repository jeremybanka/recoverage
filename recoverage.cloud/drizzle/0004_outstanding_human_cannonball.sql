CREATE TABLE `accountSessions` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` integer NOT NULL,
	`githubLogin` text NOT NULL,
	`hash` text NOT NULL,
	`salt` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
