CREATE TABLE `account_bind_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`consumed_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`consumed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `account_bind_tokens_user_idx` ON `account_bind_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `account_bind_tokens_expiry_idx` ON `account_bind_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `capability_stats` (
	`capability_id` text PRIMARY KEY NOT NULL,
	`window_days` integer DEFAULT 30 NOT NULL,
	`call_count` integer DEFAULT 0 NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`p95_latency_ms` integer,
	`computed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`capability_id`) REFERENCES `capabilities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "capability_stats_counts_non_negative" CHECK("capability_stats"."call_count" >= 0 AND "capability_stats"."success_count" >= 0),
	CONSTRAINT "capability_stats_success_within_calls" CHECK("capability_stats"."success_count" <= "capability_stats"."call_count"),
	CONSTRAINT "capability_stats_window_range" CHECK("capability_stats"."window_days" BETWEEN 1 AND 365)
);
--> statement-breakpoint
-- 外键在两次表重建全部完成之后才重新打开：期间的 DROP TABLE `users`
-- 会触发 api_keys.user_id 的 ON DELETE CASCADE，把存量 Key 全部删除。
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes_json` text DEFAULT '["*"]' NOT NULL,
	`spend_limit_usd_micros` integer,
	`spent_usd_micros` integer DEFAULT 0 NOT NULL,
	`rate_limit_rpm` integer DEFAULT 60 NOT NULL,
	`rate_limit_rps` integer DEFAULT 3 NOT NULL,
	`rate_limit_burst` integer DEFAULT 6 NOT NULL,
	`last_used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "api_keys_rate_limit_rps_range" CHECK("__new_api_keys"."rate_limit_rps" BETWEEN 1 AND 1000),
	CONSTRAINT "api_keys_rate_limit_burst_range" CHECK("__new_api_keys"."rate_limit_burst" BETWEEN "__new_api_keys"."rate_limit_rps" AND 2000),
	CONSTRAINT "api_keys_spend_limit_range" CHECK("__new_api_keys"."spend_limit_usd_micros" IS NULL OR "__new_api_keys"."spend_limit_usd_micros" BETWEEN 0 AND 1000000000000),
	CONSTRAINT "api_keys_spent_non_negative" CHECK("__new_api_keys"."spent_usd_micros" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_api_keys`("id", "user_id", "label", "key_prefix", "key_hash", "scopes_json", "spend_limit_usd_micros", "spent_usd_micros", "rate_limit_rpm", "rate_limit_rps", "rate_limit_burst", "last_used_at", "created_at", "revoked_at") SELECT "id", "user_id", "label", "key_prefix", "key_hash", '["*"]', NULL, 0, "rate_limit_rpm", "rate_limit_rps", "rate_limit_burst", "last_used_at", "created_at", "revoked_at" FROM `api_keys`;--> statement-breakpoint
DROP TABLE `api_keys`;--> statement-breakpoint
ALTER TABLE `__new_api_keys` RENAME TO `api_keys`;--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_user_idx` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`status` text DEFAULT 'active' NOT NULL,
	`account_kind` text DEFAULT 'human' NOT NULL,
	`rate_limit_rps` integer DEFAULT 3 NOT NULL,
	`rate_limit_burst` integer DEFAULT 6 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "users_account_kind_values" CHECK("__new_users"."account_kind" IN ('human', 'agent')),
	CONSTRAINT "users_rate_limit_rps_range" CHECK("__new_users"."rate_limit_rps" BETWEEN 1 AND 1000),
	CONSTRAINT "users_rate_limit_burst_range" CHECK("__new_users"."rate_limit_burst" BETWEEN "__new_users"."rate_limit_rps" AND 2000)
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "email", "display_name", "status", "account_kind", "rate_limit_rps", "rate_limit_burst", "created_at", "updated_at") SELECT "id", "email", "display_name", "status", 'human', "rate_limit_rps", "rate_limit_burst", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
