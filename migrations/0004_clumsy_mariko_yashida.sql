CREATE TABLE `daily_closes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticker` text NOT NULL,
	`date` text NOT NULL,
	`close` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_closes_ticker_date_unique` ON `daily_closes` (`ticker`,`date`);--> statement-breakpoint
CREATE INDEX `daily_closes_ticker_idx` ON `daily_closes` (`ticker`);--> statement-breakpoint
CREATE INDEX `daily_closes_date_idx` ON `daily_closes` (`date`);