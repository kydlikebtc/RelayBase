CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'nowpayments' NOT NULL,
	`provider_payment_id` text NOT NULL,
	`order_id` text NOT NULL,
	`payment_status` text NOT NULL,
	`payload_json` text NOT NULL,
	`payload_hash` text NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`processed_at` text,
	`processing_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_events_payload_unique` ON `payment_events` (`provider`,`payload_hash`);--> statement-breakpoint
CREATE INDEX `payment_events_unprocessed_idx` ON `payment_events` (`provider`,`processed_at`,`received_at`);--> statement-breakpoint
CREATE TABLE `payment_rate_limit_buckets` (
	`scope` text NOT NULL,
	`minute_bucket` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_rate_limit_bucket_unique` ON `payment_rate_limit_buckets` (`scope`,`minute_bucket`);--> statement-breakpoint
CREATE INDEX `payment_rate_limit_bucket_updated_idx` ON `payment_rate_limit_buckets` (`updated_at`);