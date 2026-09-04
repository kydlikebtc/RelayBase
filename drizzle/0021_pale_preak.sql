CREATE TABLE `balance_snapshots` (
	`user_id` text PRIMARY KEY NOT NULL,
	`balance_usd_micros` integer DEFAULT 0 NOT NULL,
	`through_created_at` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `balance_snapshots_updated_idx` ON `balance_snapshots` (`updated_at`);--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `taxonomy_verified_generation` text;