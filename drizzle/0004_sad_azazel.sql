CREATE TABLE `catalog_sync_locks` (
	`id` integer PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`locked_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
