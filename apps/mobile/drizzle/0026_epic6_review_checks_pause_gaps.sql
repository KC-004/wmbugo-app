PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_recurring_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`expected_amount_minor` integer NOT NULL,
	`cadence` text NOT NULL,
	`custom_every` integer,
	`custom_unit` text,
	`anchor_date` text NOT NULL,
	`account_id` text,
	`category_id` text,
	`kind` text DEFAULT 'other' NOT NULL,
	`paid_to` text,
	`ends_on` text,
	`paused_at` integer,
	`paused_on` text,
	`resumed_on` text,
	`ended_at` integer,
	`ended_on` text,
	`removed_at` integer,
	`created_at` integer NOT NULL,
	`remind_days` integer,
	`pause_gaps` text DEFAULT '[]' NOT NULL,
	CONSTRAINT "recurring_rule_cadence_check" CHECK("__new_recurring_rule"."cadence" IN ('weekly','monthly','quarterly','annual','custom')),
	CONSTRAINT "recurring_rule_kind_check" CHECK("__new_recurring_rule"."kind" IN ('subscription','rent','emi','utility','other')),
	CONSTRAINT "recurring_rule_amount_check" CHECK("__new_recurring_rule"."expected_amount_minor" > 0),
	CONSTRAINT "recurring_rule_dates_check" CHECK(length("__new_recurring_rule"."anchor_date") = 10 AND ("__new_recurring_rule"."ends_on" IS NULL OR length("__new_recurring_rule"."ends_on") = 10) AND ("__new_recurring_rule"."paused_on" IS NULL OR length("__new_recurring_rule"."paused_on") = 10) AND ("__new_recurring_rule"."resumed_on" IS NULL OR length("__new_recurring_rule"."resumed_on") = 10) AND ("__new_recurring_rule"."ended_on" IS NULL OR length("__new_recurring_rule"."ended_on") = 10)),
	CONSTRAINT "recurring_rule_remind_check" CHECK("__new_recurring_rule"."remind_days" IS NULL OR "__new_recurring_rule"."remind_days" IN (0,1,3)),
	CONSTRAINT "recurring_rule_pause_gaps_check" CHECK(json_valid("__new_recurring_rule"."pause_gaps")),
	CONSTRAINT "recurring_rule_custom_check" CHECK(("__new_recurring_rule"."cadence" <> 'custom' AND "__new_recurring_rule"."custom_every" IS NULL AND "__new_recurring_rule"."custom_unit" IS NULL) OR ("__new_recurring_rule"."cadence" = 'custom' AND "__new_recurring_rule"."custom_every" BETWEEN 1 AND 99 AND "__new_recurring_rule"."custom_unit" IN ('days','weeks','months')))
);
--> statement-breakpoint
INSERT INTO `__new_recurring_rule`("id", "title", "expected_amount_minor", "cadence", "custom_every", "custom_unit", "anchor_date", "account_id", "category_id", "kind", "paid_to", "ends_on", "paused_at", "paused_on", "resumed_on", "ended_at", "ended_on", "removed_at", "created_at", "remind_days", "pause_gaps") SELECT "id", "title", "expected_amount_minor", "cadence", "custom_every", "custom_unit", "anchor_date", "account_id", "category_id", "kind", "paid_to", "ends_on", "paused_at", "paused_on", "resumed_on", "ended_at", "ended_on", "removed_at", "created_at", "remind_days", '[]' FROM `recurring_rule`;--> statement-breakpoint
DROP TABLE `recurring_rule`;--> statement-breakpoint
ALTER TABLE `__new_recurring_rule` RENAME TO `recurring_rule`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_goal` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`target_minor` integer NOT NULL,
	`due_date` text,
	`icon` text NOT NULL,
	`color` text NOT NULL,
	`account_id` text,
	`state` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`removed_at` integer,
	CONSTRAINT "goal_state_check" CHECK("__new_goal"."state" IN ('active','paused','completed','archived')),
	CONSTRAINT "goal_target_check" CHECK("__new_goal"."target_minor" > 0),
	CONSTRAINT "goal_due_date_check" CHECK("__new_goal"."due_date" IS NULL OR length("__new_goal"."due_date") = 10)
);
--> statement-breakpoint
INSERT INTO `__new_goal`("id", "name", "target_minor", "due_date", "icon", "color", "account_id", "state", "created_at", "updated_at", "removed_at") SELECT "id", "name", "target_minor", "due_date", "icon", "color", "account_id", "state", "created_at", "updated_at", "removed_at" FROM `goal`;--> statement-breakpoint
DROP TABLE `goal`;--> statement-breakpoint
ALTER TABLE `__new_goal` RENAME TO `goal`;--> statement-breakpoint
CREATE TABLE `__new_goal_allocation` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`transaction_id` text,
	`local_date` text NOT NULL,
	`created_at` integer NOT NULL,
	`converted_minor` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goal`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "goal_allocation_kind_check" CHECK("__new_goal_allocation"."kind" IN ('set_aside','taken_back','moved')),
	CONSTRAINT "goal_allocation_amount_check" CHECK("__new_goal_allocation"."amount_minor" > 0),
	CONSTRAINT "goal_allocation_date_check" CHECK(length("__new_goal_allocation"."local_date") = 10),
	CONSTRAINT "goal_allocation_converted_check" CHECK("__new_goal_allocation"."converted_minor" >= 0 AND "__new_goal_allocation"."converted_minor" <= "__new_goal_allocation"."amount_minor"),
	CONSTRAINT "goal_allocation_transaction_check" CHECK(("__new_goal_allocation"."kind" = 'moved') = ("__new_goal_allocation"."transaction_id" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_goal_allocation`("id", "goal_id", "kind", "amount_minor", "transaction_id", "local_date", "created_at", "converted_minor") SELECT "id", "goal_id", "kind", "amount_minor", "transaction_id", "local_date", "created_at", "converted_minor" FROM `goal_allocation`;--> statement-breakpoint
DROP TABLE `goal_allocation`;--> statement-breakpoint
ALTER TABLE `__new_goal_allocation` RENAME TO `goal_allocation`;--> statement-breakpoint
CREATE INDEX `goal_allocation_goal_idx` ON `goal_allocation` (`goal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `goal_allocation_transaction_idx` ON `goal_allocation` (`transaction_id`) WHERE "goal_allocation"."transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_recurring_payment` (
	`rule_id` text NOT NULL,
	`due_date` text NOT NULL,
	`payment_kind` text NOT NULL,
	`transaction_id` text,
	`recorded_at` integer NOT NULL,
	PRIMARY KEY(`rule_id`, `due_date`),
	FOREIGN KEY (`rule_id`) REFERENCES `recurring_rule`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recurring_payment_kind_check" CHECK("__new_recurring_payment"."payment_kind" IN ('linked','marked')),
	CONSTRAINT "recurring_payment_date_check" CHECK(length("__new_recurring_payment"."due_date") = 10),
	CONSTRAINT "recurring_payment_transaction_check" CHECK(("__new_recurring_payment"."payment_kind" = 'linked') = ("__new_recurring_payment"."transaction_id" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_recurring_payment`("rule_id", "due_date", "payment_kind", "transaction_id", "recorded_at") SELECT "rule_id", "due_date", "payment_kind", "transaction_id", "recorded_at" FROM `recurring_payment`;--> statement-breakpoint
DROP TABLE `recurring_payment`;--> statement-breakpoint
ALTER TABLE `__new_recurring_payment` RENAME TO `recurring_payment`;--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_payment_transaction_idx` ON `recurring_payment` (`transaction_id`) WHERE "recurring_payment"."transaction_id" IS NOT NULL;