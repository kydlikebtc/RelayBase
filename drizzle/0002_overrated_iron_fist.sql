CREATE TABLE `upstream_rate_limit_buckets` (
	`endpoint_path` text NOT NULL,
	`second_bucket` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upstream_rate_limit_bucket_unique` ON `upstream_rate_limit_buckets` (`endpoint_path`,`second_bucket`);--> statement-breakpoint
CREATE INDEX `upstream_rate_limit_bucket_updated_idx` ON `upstream_rate_limit_buckets` (`updated_at`);--> statement-breakpoint
ALTER TABLE `api_calls` ADD `upstream_cost_usd_micros` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `endpoint_catalog` ADD `sync_generation` text;--> statement-breakpoint
ALTER TABLE `payment_orders` ADD `idempotency_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `payment_orders_user_idempotency_unique` ON `payment_orders` (`user_id`,`idempotency_hash`);