ALTER TABLE `settings` ADD COLUMN `seoTitle` varchar(160);
ALTER TABLE `settings` ADD COLUMN `seoDescription` text;
ALTER TABLE `settings` ADD COLUMN `adsEnabled` int NOT NULL DEFAULT 0;
ALTER TABLE `settings` ADD COLUMN `adsClient` varchar(120);
ALTER TABLE `settings` ADD COLUMN `adsSlot` varchar(120);
ALTER TABLE `settings` ADD COLUMN `adsPlacement` varchar(20) NOT NULL DEFAULT 'top';
