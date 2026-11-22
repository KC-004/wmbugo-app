CREATE TABLE `receipt_item` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`name` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`allocated_minor` integer NOT NULL,
	`category_id` text NOT NULL,
	`line_index` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "receipt_item_amounts_check" CHECK("receipt_item"."amount_minor" >= 0 AND "receipt_item"."discount_minor" >= 0 AND "receipt_item"."allocated_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX `receipt_item_tx_idx` ON `receipt_item` (`transaction_id`,`line_index`);