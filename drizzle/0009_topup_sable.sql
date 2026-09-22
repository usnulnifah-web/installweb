ALTER TABLE `settings` ADD `topupMethod` varchar(20) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `manualTopupInstructions` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `autoTopupWebhookSecret` varchar(128);--> statement-breakpoint
CREATE TABLE `topupRequests` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `amount` int NOT NULL,
  `method` enum('manual','automatic') NOT NULL,
  `status` enum('pending','paid','rejected') NOT NULL DEFAULT 'pending',
  `reference` varchar(120) NOT NULL,
  `note` varchar(500),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `topupRequests_id` PRIMARY KEY(`id`)
);--> statement-breakpoint
