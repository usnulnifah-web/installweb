ALTER TABLE `orders` ADD `expiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `products` ADD `saleMode` enum('one_time','subscription') DEFAULT 'one_time' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `subscriptionDays` int DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `isActive` int DEFAULT 1 NOT NULL;