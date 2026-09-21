ALTER TABLE `settings`
  ADD `resetEmailEnabled` int NOT NULL DEFAULT 1,
  ADD `resetSecurityEnabled` int NOT NULL DEFAULT 1;
