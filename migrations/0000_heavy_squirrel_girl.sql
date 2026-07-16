-- BASELINE MIGRATION.
-- Written with IF NOT EXISTS so it is a safe no-op against databases that
-- predate migrations (they were built by the old addColumnIfMissing hack in
-- storage.ts) while still creating everything from scratch on a fresh DB.
-- Later migrations need NOT be idempotent — only this baseline is special.

CREATE TABLE IF NOT EXISTS `catalysts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content_hash` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`theme` text NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text,
	`strength_score` real DEFAULT 0 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`ripple_analyzed` integer DEFAULT false NOT NULL,
	`ripple_cost_credits` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `catalysts_content_hash_unique` ON `catalysts` (`content_hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `catalysts_theme_idx` ON `catalysts` (`theme`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `catalysts_last_seen_idx` ON `catalysts` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `edges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_node_id` integer NOT NULL,
	`to_node_id` integer NOT NULL,
	`relation` text NOT NULL,
	`strength` real DEFAULT 0.5 NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `edges_from_idx` ON `edges` (`from_node_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `edges_to_idx` ON `edges` (`to_node_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `golden_eggs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`catalyst_id` integer NOT NULL,
	`ticker` text NOT NULL,
	`company_name` text NOT NULL,
	`thesis` text NOT NULL,
	`hop_distance` integer NOT NULL,
	`confidence` real NOT NULL,
	`novelty_score` real DEFAULT 0.5 NOT NULL,
	`timing_lag` text NOT NULL,
	`sector` text,
	`ripple_path` text,
	`price_at_flag` real,
	`price_at_flag_date` integer,
	`current_price` real,
	`price_refreshed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `eggs_catalyst_idx` ON `golden_eggs` (`catalyst_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `eggs_ticker_idx` ON `golden_eggs` (`ticker`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `eggs_confidence_idx` ON `golden_eggs` (`confidence`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `nodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`ticker` text,
	`description` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `nodes_slug_unique` ON `nodes` (`slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `nodes_kind_idx` ON `nodes` (`kind`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `nodes_ticker_idx` ON `nodes` (`ticker`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ripple_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`theme_hash` text NOT NULL,
	`theme_summary` text NOT NULL,
	`output_json` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `ripple_cache_theme_hash_unique` ON `ripple_cache` (`theme_hash`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scan_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`catalysts_ingested` integer DEFAULT 0 NOT NULL,
	`catalysts_new` integer DEFAULT 0 NOT NULL,
	`eggs_created` integer DEFAULT 0 NOT NULL,
	`cache_hits` integer DEFAULT 0 NOT NULL,
	`approx_credits` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`error_message` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `watchlist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`egg_id` integer NOT NULL,
	`added_at` integer NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `watchlist_egg_id_unique` ON `watchlist` (`egg_id`);