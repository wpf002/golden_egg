CREATE TABLE `coattail_picks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rider_ticker` text NOT NULL,
	`rider_name` text NOT NULL,
	`anchor_ticker` text NOT NULL,
	`anchor_name` text NOT NULL,
	`thesis` text NOT NULL,
	`linkage` text NOT NULL,
	`verdict` text NOT NULL,
	`rider_ratio` real,
	`anchor_ratio` real,
	`premium_pct` real,
	`size_ratio` real,
	`rider_market_cap_m` real,
	`rider_growth_pct` real,
	`rider_price_to_sales` real,
	`novelty_score` real DEFAULT 0.5 NOT NULL,
	`discovered_at` integer NOT NULL,
	`refreshed_at` integer
);
--> statement-breakpoint
CREATE INDEX `coattail_rider_idx` ON `coattail_picks` (`rider_ticker`);--> statement-breakpoint
CREATE INDEX `coattail_anchor_idx` ON `coattail_picks` (`anchor_ticker`);--> statement-breakpoint
CREATE UNIQUE INDEX `coattail_pair_idx` ON `coattail_picks` (`rider_ticker`,`anchor_ticker`);