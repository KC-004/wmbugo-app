CREATE TABLE `csv_format` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`header_signature` text NOT NULL,
	`mapping_json` text NOT NULL,
	`overrides_json` text DEFAULT '{}' NOT NULL,
	`flip_sign` integer DEFAULT 0 NOT NULL,
	`account_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "csv_format_flip_check" CHECK("csv_format"."flip_sign" IN (0,1)),
	CONSTRAINT "csv_format_json_check" CHECK(json_valid("csv_format"."mapping_json") AND json_valid("csv_format"."overrides_json") AND json_valid("csv_format"."account_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `csv_format_signature_idx` ON `csv_format` (`header_signature`);