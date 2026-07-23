CREATE TABLE `catalog_sync_staging` (
	`id` text PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`path` text NOT NULL,
	`platform` text NOT NULL,
	`http_method` text NOT NULL,
	`summary` text,
	`description` text,
	`parameter_schema_json` text,
	`upstream_price_usd_micros` integer NOT NULL,
	`suggested_customer_price_usd_micros` integer NOT NULL,
	`price_verified` integer DEFAULT false NOT NULL,
	`looks_read_only` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `catalog_sync_staging_generation_idx` ON `catalog_sync_staging` (`generation`);--> statement-breakpoint
ALTER TABLE `endpoint_catalog` ADD `http_method` text DEFAULT 'GET' NOT NULL;--> statement-breakpoint
ALTER TABLE `endpoint_catalog` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `endpoint_catalog` ADD `description` text;--> statement-breakpoint
ALTER TABLE `endpoint_catalog` ADD `parameter_schema_json` text;--> statement-breakpoint
ALTER TABLE `endpoint_catalog` ADD `price_verified` integer DEFAULT false NOT NULL;