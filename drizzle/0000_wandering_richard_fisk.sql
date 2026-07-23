CREATE TABLE `api_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`api_key_id` text NOT NULL,
	`method` text NOT NULL,
	`upstream_path` text NOT NULL,
	`platform` text NOT NULL,
	`status_code` integer NOT NULL,
	`cost_usd_micros` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`refunded` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `api_calls_user_created_idx` ON `api_calls` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `api_calls_key_created_idx` ON `api_calls` (`api_key_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`rate_limit_rpm` integer DEFAULT 60 NOT NULL,
	`last_used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_user_idx` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE TABLE `balance_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`entry_type` text NOT NULL,
	`delta_usd_micros` integer NOT NULL,
	`reference_id` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `balance_ledger_reference_unique` ON `balance_ledger` (`reference_id`);--> statement-breakpoint
CREATE INDEX `balance_ledger_user_created_idx` ON `balance_ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `endpoint_catalog` (
	`path` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`upstream_price_usd_micros` integer NOT NULL,
	`customer_price_usd_micros` integer NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`read_only` integer DEFAULT true NOT NULL,
	`source_updated_at` text,
	`reviewed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `endpoint_catalog_platform_enabled_idx` ON `endpoint_catalog` (`platform`,`enabled`);--> statement-breakpoint
CREATE TABLE `payment_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text DEFAULT 'nowpayments' NOT NULL,
	`provider_payment_id` text,
	`amount_usd_micros` integer NOT NULL,
	`pay_currency` text NOT NULL,
	`pay_amount` text,
	`pay_address` text,
	`invoice_url` text,
	`status` text DEFAULT 'creating' NOT NULL,
	`credited_usd_micros` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_orders_provider_id_unique` ON `payment_orders` (`provider_payment_id`);--> statement-breakpoint
CREATE INDEX `payment_orders_user_created_idx` ON `payment_orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
INSERT INTO `endpoint_catalog` (
	`path`,
	`platform`,
	`upstream_price_usd_micros`,
	`customer_price_usd_micros`,
	`enabled`,
	`read_only`,
	`source_updated_at`,
	`reviewed_at`
) VALUES (
	'/v1/tiktok/web/fetch_user_profile',
	'tiktok',
	1000,
	2000,
	0,
	1,
	NULL,
	NULL
);
