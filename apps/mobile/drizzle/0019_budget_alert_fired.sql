CREATE TABLE `budget_alert_fired` (
	`budget_id` text NOT NULL,
	`period_start` text NOT NULL,
	`threshold_pct` integer NOT NULL,
	`fired_at` integer NOT NULL,
	PRIMARY KEY(`budget_id`, `period_start`, `threshold_pct`),
	FOREIGN KEY (`budget_id`) REFERENCES `budget`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budget_alert_threshold_check" CHECK("budget_alert_fired"."threshold_pct" > 0)
);
