CREATE TABLE `budget` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope` text NOT NULL,
	`scope_category_ids` text DEFAULT '[]' NOT NULL,
	`scope_budget_type` text,
	`account_ids` text,
	`period_rule` text DEFAULT 'default' NOT NULL,
	`custom_start` text,
	`custom_end` text,
	`template` text,
	`alert_rule` text,
	`muted` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`removed_at` integer,
	CONSTRAINT "budget_scope_check" CHECK("budget"."scope" IN ('overall','category','budget_type','savings')),
	CONSTRAINT "budget_period_rule_check" CHECK("budget"."period_rule" IN ('default','monthly','weekly','custom')),
	CONSTRAINT "budget_type_scope_check" CHECK("budget"."scope_budget_type" IS NULL OR "budget"."scope_budget_type" IN ('need','want')),
	CONSTRAINT "budget_custom_range_check" CHECK("budget"."period_rule" <> 'custom' OR ("budget"."custom_start" IS NOT NULL AND "budget"."custom_end" IS NOT NULL AND "budget"."custom_start" <= "budget"."custom_end")),
	CONSTRAINT "budget_muted_check" CHECK("budget"."muted" IN (0,1))
);
--> statement-breakpoint
CREATE TABLE `budget_period` (
	`budget_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`target_minor` integer NOT NULL,
	`shortened` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`budget_id`, `start_date`),
	FOREIGN KEY (`budget_id`) REFERENCES `budget`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budget_period_shortened_check" CHECK("budget_period"."shortened" IN (0,1))
);
--> statement-breakpoint
CREATE TABLE `budget_target_version` (
	`budget_id` text NOT NULL,
	`version` integer NOT NULL,
	`target_minor` integer NOT NULL,
	`effective_from` text NOT NULL,
	PRIMARY KEY(`budget_id`, `version`),
	FOREIGN KEY (`budget_id`) REFERENCES `budget`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budget_target_nonnegative_check" CHECK("budget_target_version"."target_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX `budget_target_effective_idx` ON `budget_target_version` (`budget_id`,`effective_from`);