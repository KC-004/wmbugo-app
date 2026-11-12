ALTER TABLE `transaction` ADD `category_guessed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transaction` ADD `category_set_by` text;