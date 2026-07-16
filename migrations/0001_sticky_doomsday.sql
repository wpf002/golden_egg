CREATE TABLE `price_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`egg_id` integer NOT NULL,
	`direction` text NOT NULL,
	`threshold_pct` real NOT NULL,
	`return_pct` real NOT NULL,
	`price_at_alert` real NOT NULL,
	`created_at` integer NOT NULL,
	`acknowledged_at` integer
);
--> statement-breakpoint
CREATE INDEX `price_alerts_egg_idx` ON `price_alerts` (`egg_id`);--> statement-breakpoint
CREATE INDEX `price_alerts_created_idx` ON `price_alerts` (`created_at`);