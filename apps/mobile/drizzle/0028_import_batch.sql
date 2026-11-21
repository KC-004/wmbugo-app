CREATE TABLE `import_batch` (
	`id` text PRIMARY KEY NOT NULL,
	`file_digest` text NOT NULL,
	`format_id` text,
	`mapping_json` text NOT NULL,
	`account_id` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`row_count` integer NOT NULL,
	`committed_through_row` integer DEFAULT 0 NOT NULL,
	`imported_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`raw_path` text,
	`retain_until` integer,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	CONSTRAINT "import_batch_status_check" CHECK("import_batch"."status" IN ('planned','importing','paused','completed','abandoned')),
	CONSTRAINT "import_batch_json_check" CHECK(json_valid("import_batch"."mapping_json"))
);
--> statement-breakpoint
CREATE INDEX `import_batch_status_idx` ON `import_batch` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `import_batch_digest_idx` ON `import_batch` (`file_digest`);--> statement-breakpoint
CREATE TABLE `import_row_error` (
	`id` text PRIMARY KEY NOT NULL,
	`import_batch_id` text NOT NULL,
	`file_row` integer NOT NULL,
	`code` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batch`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `import_row_error_batch_idx` ON `import_row_error` (`import_batch_id`,`file_row`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_review_candidate` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`matched_transaction_id` text,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`undo_json` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matched_transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_candidate_reason_check" CHECK("__new_review_candidate"."reason" IN ('duplicate','foreign_currency','pending','other','transfer_pair','held_pair','edge_day')),
	CONSTRAINT "review_candidate_status_check" CHECK("__new_review_candidate"."status" IN ('open','resolved'))
);
--> statement-breakpoint
INSERT INTO `__new_review_candidate`("id", "transaction_id", "matched_transaction_id", "reason", "status", "created_at", "resolved_at", "undo_json") SELECT "id", "transaction_id", "matched_transaction_id", "reason", "status", "created_at", "resolved_at", "undo_json" FROM `review_candidate`;--> statement-breakpoint
DROP TABLE `review_candidate`;--> statement-breakpoint
ALTER TABLE `__new_review_candidate` RENAME TO `review_candidate`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `review_candidate_status_idx` ON `review_candidate` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `review_candidate_tx_idx` ON `review_candidate` (`transaction_id`);--> statement-breakpoint
ALTER TABLE `source_record` ADD `import_batch_id` text;--> statement-breakpoint
ALTER TABLE `source_record` ADD `file_row` integer;--> statement-breakpoint
CREATE INDEX `source_record_batch_idx` ON `source_record` (`import_batch_id`);