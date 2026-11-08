CREATE TABLE `profile` (
	`id` text PRIMARY KEY NOT NULL,
	`region` text NOT NULL,
	`currency_code` text NOT NULL,
	`currency_exponent` integer NOT NULL,
	`locale` text NOT NULL,
	`timezone_id` text NOT NULL,
	`payday_rule` text,
	`payday_day` integer,
	`clock_wall_ms` integer,
	`clock_elapsed_ms` integer,
	`clock_boot_count` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prompt_state` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`last_shown_at` integer
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` integer NOT NULL
);
