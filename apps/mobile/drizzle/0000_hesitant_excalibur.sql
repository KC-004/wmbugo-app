CREATE TABLE `schema_migration` (
	`version` integer PRIMARY KEY NOT NULL,
	`tag` text NOT NULL,
	`checksum` text NOT NULL,
	`applied_at` integer NOT NULL
);
