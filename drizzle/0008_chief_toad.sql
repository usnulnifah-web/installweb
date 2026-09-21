CREATE TABLE `passwordResetTokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tokenHash` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `passwordResetTokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `passwordResetTokens_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `thumbnailUrl` varchar(1000);--> statement-breakpoint
ALTER TABLE `settings` ADD `obfuscationEnabled` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `resetEmailEnabled` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `resetSecurityEnabled` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `googleLoginEnabled` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `assetDomain` varchar(255);--> statement-breakpoint
ALTER TABLE `settings` ADD `seoTitle` varchar(160);--> statement-breakpoint
ALTER TABLE `settings` ADD `seoDescription` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `logoUrl` varchar(1000);--> statement-breakpoint
ALTER TABLE `settings` ADD `faviconUrl` varchar(1000);--> statement-breakpoint
ALTER TABLE `settings` ADD `adsEnabled` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `adsClient` varchar(120);--> statement-breakpoint
ALTER TABLE `settings` ADD `adsSlot` varchar(120);--> statement-breakpoint
ALTER TABLE `settings` ADD `adsPlacement` varchar(20) DEFAULT 'top' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `username` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `securityQuestion` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `securityAnswerHash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_username_unique` UNIQUE(`username`);