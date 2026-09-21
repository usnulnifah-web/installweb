CREATE TABLE `settings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `adminFee` int NOT NULL DEFAULT 5000,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `transactions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `orderId` int,
  `type` enum('credit','debit') NOT NULL,
  `amount` int NOT NULL,
  `description` varchar(255) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `products` MODIFY COLUMN `status` enum('pending','published','rejected','blocked') NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE `orders` ADD `adminFee` int DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `products` ADD `scriptType` enum('full','api') DEFAULT 'full' NOT NULL;
--> statement-breakpoint
ALTER TABLE `products` ADD `publicScript` text;
--> statement-breakpoint
ALTER TABLE `products` ADD `secretScript` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(30);
--> statement-breakpoint
ALTER TABLE `users` ADD `avatarUrl` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `balance` int DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `isSuspended` int DEFAULT 0 NOT NULL;
