CREATE TABLE `category` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`budget_type` text,
	`icon` text NOT NULL,
	`color_token` text NOT NULL,
	`sort_order` integer NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "category_kind_check" CHECK("category"."kind" IN ('expense','income')),
	CONSTRAINT "category_budget_type_check" CHECK("category"."budget_type" IS NULL OR "category"."budget_type" IN ('need','want')),
	CONSTRAINT "category_archived_check" CHECK("category"."archived" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `category_parent_order_idx` ON `category` (`parent_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `split` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`category_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`memo` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "split_amount_check" CHECK("split"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX `split_category_tx_idx` ON `split` (`category_id`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `split_tx_idx` ON `split` (`transaction_id`);
--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_food', 'Food & Drinks', 'expense', 'want', 'ForkKnife', 'cat-rose', 0, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_groceries', 'Groceries', 'expense', 'need', 'ShoppingCart', 'cat-lime', 1, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_transport', 'Transport', 'expense', 'need', 'Bus', 'cat-sky', 2, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_housing', 'Housing', 'expense', 'need', 'House', 'cat-brown', 3, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_bills', 'Bills & Utilities', 'expense', 'need', 'Receipt', 'cat-cyan', 4, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_shopping', 'Shopping', 'expense', 'want', 'ShoppingBag', 'cat-fuchsia', 5, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_health', 'Healthcare', 'expense', 'need', 'Heartbeat', 'cat-pink', 6, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_entertainment', 'Entertainment', 'expense', 'want', 'FilmSlate', 'cat-indigo', 7, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_education', 'Education', 'expense', 'need', 'GraduationCap', 'cat-olive', 8, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_travel', 'Travel', 'expense', 'want', 'Airplane', 'cat-emerald', 9, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_personal', 'Personal Care', 'expense', 'want', 'Flower', 'cat-rose', 10, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_family', 'Family', 'expense', 'need', 'UsersThree', 'cat-stone', 11, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_other', 'Other', 'expense', 'want', 'DotsThree', 'cat-slate', 12, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_uncategorised', 'Uncategorised', 'expense', NULL, 'Question', 'cat-slate', 13, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_in_salary', 'Salary', 'income', NULL, 'Briefcase', 'cat-emerald', 14, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_in_freelance', 'Freelance', 'income', NULL, 'Laptop', 'cat-cyan', 15, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_in_people', 'From people', 'income', NULL, 'HandHeart', 'cat-pink', 16, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_in_gifts', 'Gifts', 'income', NULL, 'Gift', 'cat-fuchsia', 17, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_in_interest', 'Interest', 'income', NULL, 'Percent', 'cat-lime', 18, 0);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `budget_type`, `icon`, `color_token`, `sort_order`, `archived`) VALUES ('cat_in_refunds', 'Refunds', 'income', NULL, 'ArrowUUpLeft', 'cat-sky', 19, 0);