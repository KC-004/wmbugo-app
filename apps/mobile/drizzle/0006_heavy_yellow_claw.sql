CREATE TABLE `review_candidate` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`matched_transaction_id` text,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matched_transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_candidate_reason_check" CHECK("review_candidate"."reason" IN ('duplicate','foreign_currency','pending','other')),
	CONSTRAINT "review_candidate_status_check" CHECK("review_candidate"."status" IN ('open','resolved'))
);
--> statement-breakpoint
CREATE INDEX `review_candidate_status_idx` ON `review_candidate` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `review_candidate_tx_idx` ON `review_candidate` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `source_record` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`fingerprint` text NOT NULL,
	`reference` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "source_record_kind_check" CHECK("source_record"."source_kind" IN ('manual','upi','sms','receipt','csv','notification','share'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_record_fingerprint_idx` ON `source_record` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `source_record_tx_idx` ON `source_record` (`transaction_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_transaction` (
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
	CONSTRAINT "transaction_event_type_check" CHECK("__new_transaction"."event_type" IN ('expense','income','transfer','opening_balance','adjustment','refund','reversal')),
	CONSTRAINT "transaction_status_check" CHECK("__new_transaction"."status" IN ('draft','needs_review','confirmed','excluded','reversed')),
	CONSTRAINT "transaction_resolution_check" CHECK("__new_transaction"."capture_resolution" IS NULL OR "__new_transaction"."capture_resolution" IN ('user_approved','auto_approved','auto_linked','rejected')),
	CONSTRAINT "transaction_amount_check" CHECK("__new_transaction"."amount_minor" >= 0),
	CONSTRAINT "transaction_local_date_check" CHECK(length("__new_transaction"."local_date") = 10),
	CONSTRAINT "transaction_removal_check" CHECK(("__new_transaction"."removed_at" IS NULL) = ("__new_transaction"."removal_kind" IS NULL)),
	CONSTRAINT "transaction_foreign_check" CHECK(("__new_transaction"."foreign_amount_minor" IS NULL) = ("__new_transaction"."foreign_currency" IS NULL) AND ("__new_transaction"."foreign_currency" IS NULL) = ("__new_transaction"."foreign_currency_exponent" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_transaction`("id", "event_type", "status", "amount_minor", "occurred_at_utc", "local_date", "timezone_id", "merchant_id", "payee_id", "refund_of_transaction_id", "recurring_rule_id", "original_description", "note", "reference", "payment_method", "tags_json", "capture_resolution", "needs_category", "foreign_amount_minor", "foreign_currency", "foreign_currency_exponent", "removed_at", "removal_kind", "created_at", "updated_at", "reversed_by_id") SELECT "id", "event_type", "status", "amount_minor", "occurred_at_utc", "local_date", "timezone_id", "merchant_id", "payee_id", "refund_of_transaction_id", "recurring_rule_id", "original_description", "note", "reference", "payment_method", "tags_json", "capture_resolution", "needs_category", "foreign_amount_minor", "foreign_currency", "foreign_currency_exponent", "removed_at", "removal_kind", "created_at", "updated_at", "reversed_by_id" FROM `transaction`;--> statement-breakpoint
DROP TABLE `transaction`;--> statement-breakpoint
ALTER TABLE `__new_transaction` RENAME TO `transaction`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `transaction_date_idx` ON `transaction` (`local_date`,`id`);--> statement-breakpoint
CREATE INDEX `transaction_status_date_idx` ON `transaction` (`status`,`local_date`);--> statement-breakpoint
CREATE INDEX `transaction_removed_idx` ON `transaction` (`removed_at`);--> statement-breakpoint
CREATE INDEX `transaction_merchant_idx` ON `transaction` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `transaction_refund_idx` ON `transaction` (`refund_of_transaction_id`);--> statement-breakpoint
CREATE INDEX `transaction_recurring_idx` ON `transaction` (`recurring_rule_id`);