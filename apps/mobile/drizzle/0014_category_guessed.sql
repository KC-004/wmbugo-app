ALTER TABLE `transaction` ADD `category_guessed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transaction` ADD `category_set_by` text;
--> statement-breakpoint
UPDATE `transaction` SET `category_guessed` = 1, `category_set_by` = 'suggester' WHERE `capture_resolution` = 'auto_approved' AND `needs_category` = 0;--> statement-breakpoint
UPDATE `transaction` SET `category_set_by` = 'user' WHERE `category_set_by` IS NULL AND `needs_category` = 0;
