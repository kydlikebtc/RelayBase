CREATE TABLE `catalog_sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_success_generation` text NOT NULL,
	`synced_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `endpoint_catalog_enabled_read_only_idx` ON `endpoint_catalog` (`enabled`,`read_only`);--> statement-breakpoint
CREATE INDEX `payment_orders_provider_status_updated_idx` ON `payment_orders` (`provider`,`status`,`updated_at`);