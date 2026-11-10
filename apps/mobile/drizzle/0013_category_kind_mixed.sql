PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_category` (
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
	CONSTRAINT "category_kind_check" CHECK("__new_category"."kind" IN ('expense','income','mixed')),
	CONSTRAINT "category_budget_type_check" CHECK("__new_category"."budget_type" IS NULL OR "__new_category"."budget_type" IN ('need','want')),
	CONSTRAINT "category_archived_check" CHECK("__new_category"."archived" IN (0,1))
);
--> statement-breakpoint
INSERT INTO `__new_category`("id", "parent_id", "name", "kind", "budget_type", "icon", "color_token", "sort_order", "archived") SELECT "id", "parent_id", "name", "kind", "budget_type", "icon", "color_token", "sort_order", "archived" FROM `category`;--> statement-breakpoint
DROP TABLE `category`;--> statement-breakpoint
ALTER TABLE `__new_category` RENAME TO `category`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `category_parent_order_idx` ON `category` (`parent_id`,`sort_order`);