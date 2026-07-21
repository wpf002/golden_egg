CREATE TABLE `custom_themes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_themes_name_unique` ON `custom_themes` (`name`);--> statement-breakpoint
CREATE TABLE `theme_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`rationale` text NOT NULL,
	`evidence` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer
);
