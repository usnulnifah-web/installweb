ALTER TABLE `users`
  ADD `username` varchar(64) NULL,
  ADD `passwordHash` varchar(255) NULL,
  ADD `securityQuestion` varchar(255) NULL,
  ADD `securityAnswerHash` varchar(255) NULL;

CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);

CREATE TABLE `passwordResetTokens` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `tokenHash` varchar(128) NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `usedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `passwordResetTokens_id` PRIMARY KEY(`id`),
  CONSTRAINT `passwordResetTokens_tokenHash_unique` UNIQUE(`tokenHash`)
);
