CREATE TABLE `goal` (
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
	CONSTRAINT "goal_state_check" CHECK("goal"."state" IN ('active','paused','completed','archived')),
	CONSTRAINT "goal_target_check" CHECK("goal"."target_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE `goal_allocation` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`transaction_id` text,
	`local_date` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goal`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "goal_allocation_kind_check" CHECK("goal_allocation"."kind" IN ('set_aside','taken_back','moved')),
	CONSTRAINT "goal_allocation_amount_check" CHECK("goal_allocation"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE INDEX `goal_allocation_goal_idx` ON `goal_allocation` (`goal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `goal_allocation_transaction_idx` ON `goal_allocation` (`transaction_id`) WHERE "goal_allocation"."transaction_id" IS NOT NULL;