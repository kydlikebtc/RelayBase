CREATE TABLE `proxy_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`api_key_id` text NOT NULL,
	`user_id` text NOT NULL,
	`idempotency_hash` text NOT NULL,
	`ledger_reference_id` text NOT NULL,
	`path` text NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`cost_usd_micros` integer NOT NULL,
	`response_status` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proxy_requests_key_idempotency_unique` ON `proxy_requests` (`api_key_id`,`idempotency_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `proxy_requests_ledger_reference_unique` ON `proxy_requests` (`ledger_reference_id`);--> statement-breakpoint
CREATE INDEX `proxy_requests_status_created_idx` ON `proxy_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `rate_limit_buckets` (
	`api_key_id` text NOT NULL,
	`minute_bucket` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_bucket_unique` ON `rate_limit_buckets` (`api_key_id`,`minute_bucket`);--> statement-breakpoint
CREATE INDEX `rate_limit_bucket_updated_idx` ON `rate_limit_buckets` (`updated_at`);