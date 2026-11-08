CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`icon` text NOT NULL,
	`color_token` text NOT NULL,
	`credit_limit_minor` integer,
	`statement_due_minor` integer,
	`statement_due_date` text,
	`opening_minor` integer,
	`opening_effective_at` integer,
	`balance_not_set` integer DEFAULT 0 NOT NULL,
	`include_in_overview` integer DEFAULT 1 NOT NULL,
	`sort_order` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "account_type_check" CHECK("account"."type" IN ('cash','bank','wallet','savings_pot','card')),
	CONSTRAINT "account_status_check" CHECK("account"."status" IN ('active','archived')),
	CONSTRAINT "account_flags_check" CHECK("account"."balance_not_set" IN (0,1) AND "account"."include_in_overview" IN (0,1)),
	CONSTRAINT "account_credit_limit_check" CHECK("account"."credit_limit_minor" IS NULL OR "account"."credit_limit_minor" >= 0),
	CONSTRAINT "account_balance_known_check" CHECK("account"."balance_not_set" = 1 OR "account"."opening_minor" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `account_status_order_idx` ON `account` (`status`,`sort_order`);--> statement-breakpoint
CREATE TABLE `posting` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`account_id` text NOT NULL,
	`direction` text NOT NULL,
	`signed_amount_minor` integer NOT NULL,
	`posting_kind` text DEFAULT 'normal' NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "posting_direction_check" CHECK("posting"."direction" IN ('in','out')),
	CONSTRAINT "posting_kind_check" CHECK("posting"."posting_kind" IN ('normal','opening_balance','adjustment')),
	CONSTRAINT "posting_sign_check" CHECK(("posting"."direction" = 'in' AND "posting"."signed_amount_minor" >= 0) OR ("posting"."direction" = 'out' AND "posting"."signed_amount_minor" <= 0))
);
--> statement-breakpoint
CREATE INDEX `posting_account_tx_idx` ON `posting` (`account_id`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `posting_tx_idx` ON `posting` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `transaction` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`status` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`occurred_at_utc` integer NOT NULL,
	`local_date` text NOT NULL,
	`timezone_id` text NOT NULL,
	`merchant_id` text,
	`payee_id` text,
	`refund_of_transaction_id` text,
	`recurring_rule_id` text,
	`original_description` text,
	`note` text,
	`reference` text,
	`payment_method` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`capture_resolution` text,
	`needs_category` integer DEFAULT 0 NOT NULL,
	`foreign_amount_minor` integer,
	`foreign_currency` text,
	`foreign_currency_exponent` integer,
	`removed_at` integer,
	`removal_kind` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`reversed_by_id` text,
	CONSTRAINT "transaction_event_type_check" CHECK("transaction"."event_type" IN ('expense','income','transfer','opening_balance','adjustment','refund','reversal')),
	CONSTRAINT "transaction_status_check" CHECK("transaction"."status" IN ('needs_review','confirmed')),
	CONSTRAINT "transaction_amount_check" CHECK("transaction"."amount_minor" >= 0),
	CONSTRAINT "transaction_local_date_check" CHECK(length("transaction"."local_date") = 10),
	CONSTRAINT "transaction_removal_check" CHECK(("transaction"."removed_at" IS NULL) = ("transaction"."removal_kind" IS NULL)),
	CONSTRAINT "transaction_foreign_check" CHECK(("transaction"."foreign_amount_minor" IS NULL) = ("transaction"."foreign_currency" IS NULL) AND ("transaction"."foreign_currency" IS NULL) = ("transaction"."foreign_currency_exponent" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `transaction_date_idx` ON `transaction` (`local_date`,`id`);--> statement-breakpoint
CREATE INDEX `transaction_status_date_idx` ON `transaction` (`status`,`local_date`);--> statement-breakpoint
CREATE INDEX `transaction_removed_idx` ON `transaction` (`removed_at`);--> statement-breakpoint
CREATE INDEX `transaction_merchant_idx` ON `transaction` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `transaction_refund_idx` ON `transaction` (`refund_of_transaction_id`);--> statement-breakpoint
CREATE INDEX `transaction_recurring_idx` ON `transaction` (`recurring_rule_id`);