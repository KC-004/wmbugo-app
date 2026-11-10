CREATE TABLE `tombstone` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint_hash` text NOT NULL,
	`outcome` text NOT NULL,
	`purged_at` integer NOT NULL,
	CONSTRAINT "tombstone_outcome_check" CHECK("tombstone"."outcome" IN ('deleted','rejected'))
);
--> statement-breakpoint
CREATE INDEX `tombstone_hash_idx` ON `tombstone` (`fingerprint_hash`);