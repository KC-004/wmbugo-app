CREATE TABLE `audit_event` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`actor` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`change_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_event_entity_idx` ON `audit_event` (`entity_kind`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_event_created_idx` ON `audit_event` (`created_at`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`actor` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`delivered_at` integer
);
--> statement-breakpoint
CREATE INDEX `outbox_pending_idx` ON `outbox` (`delivered_at`,`created_at`);