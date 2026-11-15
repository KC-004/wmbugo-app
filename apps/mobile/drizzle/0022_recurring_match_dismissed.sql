CREATE TABLE `recurring_match_dismissed` (
	`rule_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`dismissed_at` integer NOT NULL,
	PRIMARY KEY(`rule_id`, `transaction_id`),
	FOREIGN KEY (`rule_id`) REFERENCES `recurring_rule`(`id`) ON UPDATE no action ON DELETE no action
);
