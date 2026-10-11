CREATE TABLE `stripeCheckoutAttempts` (
	`userId` integer PRIMARY KEY NOT NULL,
	`attemptId` text NOT NULL,
	`priceId` text NOT NULL,
	`origin` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`stripeSessionId` text,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
