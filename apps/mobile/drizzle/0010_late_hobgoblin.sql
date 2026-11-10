CREATE TABLE `attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`kind` text DEFAULT 'receipt' NOT NULL,
	`digest` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attachment_kind_check" CHECK("attachment"."kind" IN ('receipt'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachment_tx_digest_idx` ON `attachment` (`transaction_id`,`digest`);--> statement-breakpoint
CREATE INDEX `attachment_tx_idx` ON `attachment` (`transaction_id`);