CREATE TABLE `recurring_payment` (
	`rule_id` text NOT NULL,
	`due_date` text NOT NULL,
	`payment_kind` text NOT NULL,
	`transaction_id` text,
	`recorded_at` integer NOT NULL,
	PRIMARY KEY(`rule_id`, `due_date`),
	FOREIGN KEY (`rule_id`) REFERENCES `recurring_rule`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recurring_payment_kind_check" CHECK("recurring_payment"."payment_kind" IN ('linked','marked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_payment_transaction_idx` ON `recurring_payment` (`transaction_id`) WHERE "recurring_payment"."transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `recurring_rule` (
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
	CONSTRAINT "recurring_rule_cadence_check" CHECK("recurring_rule"."cadence" IN ('weekly','monthly','quarterly','annual','custom')),
	CONSTRAINT "recurring_rule_kind_check" CHECK("recurring_rule"."kind" IN ('subscription','rent','emi','utility','other')),
	CONSTRAINT "recurring_rule_amount_check" CHECK("recurring_rule"."expected_amount_minor" > 0),
	CONSTRAINT "recurring_rule_custom_check" CHECK(("recurring_rule"."cadence" <> 'custom' AND "recurring_rule"."custom_every" IS NULL AND "recurring_rule"."custom_unit" IS NULL) OR ("recurring_rule"."cadence" = 'custom' AND "recurring_rule"."custom_every" BETWEEN 1 AND 99 AND "recurring_rule"."custom_unit" IN ('days','weeks','months')))
);
