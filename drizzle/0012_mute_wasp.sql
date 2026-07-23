CREATE TABLE `catalog_batch_plan_items` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`path` text NOT NULL,
	`ordinal` integer NOT NULL,
	`platform` text NOT NULL,
	`http_method` text NOT NULL,
	`summary` text,
	`expected_revision` integer NOT NULL,
	`original_upstream_price_usd_micros` integer NOT NULL,
	`original_customer_price_usd_micros` integer NOT NULL,
	`original_price_verified` integer DEFAULT false NOT NULL,
	`original_enabled` integer DEFAULT false NOT NULL,
	`original_read_only` integer DEFAULT false NOT NULL,
	`original_sync_generation` text,
	`original_reviewed_at` text,
	`original_updated_at` text NOT NULL,
	`target_customer_price_usd_micros` integer NOT NULL,
	`target_enabled` integer DEFAULT false NOT NULL,
	`target_read_only` integer DEFAULT false NOT NULL,
	`will_change` integer DEFAULT false NOT NULL,
	`blocker_code` text,
	`item_digest` text NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `catalog_batch_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_batch_plan_items_plan_path_unique` ON `catalog_batch_plan_items` (`plan_id`,`path`);--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_batch_plan_items_plan_ordinal_unique` ON `catalog_batch_plan_items` (`plan_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `catalog_batch_plan_items_plan_idx` ON `catalog_batch_plan_items` (`plan_id`);--> statement-breakpoint
CREATE TABLE `catalog_batch_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_fingerprint` text NOT NULL,
	`preview_idempotency_hash` text NOT NULL,
	`preview_request_hash` text NOT NULL,
	`policy_version` integer NOT NULL,
	`action` text NOT NULL,
	`status` text DEFAULT 'preparing' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`filter_platform` text,
	`filter_query` text,
	`filter_status` text NOT NULL,
	`filter_safety` text NOT NULL,
	`selector_json` text NOT NULL,
	`mutation_json` text NOT NULL,
	`markup_bps` integer,
	`minimum_customer_price_usd_micros` integer,
	`catalog_generation` text NOT NULL,
	`credential_source` text,
	`credential_id` text,
	`credential_fingerprint` text,
	`credential_state_version` integer,
	`openapi_snapshot_hash` text NOT NULL,
	`price_snapshot_hash` text NOT NULL,
	`matched_count` integer NOT NULL,
	`selected_count` integer NOT NULL,
	`excluded_stale_count` integer NOT NULL,
	`excluded_unverified_count` integer NOT NULL,
	`excluded_unsafe_count` integer NOT NULL,
	`no_change_count` integer NOT NULL,
	`price_increase_count` integer NOT NULL,
	`price_decrease_count` integer NOT NULL,
	`price_unchanged_count` integer NOT NULL,
	`blocked_count` integer NOT NULL,
	`upstream_total_usd_micros` integer NOT NULL,
	`before_customer_total_usd_micros` integer NOT NULL,
	`after_customer_total_usd_micros` integer NOT NULL,
	`target_digest` text NOT NULL,
	`before_digest` text NOT NULL,
	`after_digest` text NOT NULL,
	`confirmation_text` text NOT NULL,
	`apply_idempotency_hash` text,
	`apply_request_hash` text,
	`apply_result_json` text,
	`applied_count` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`previewed_at` text,
	`expires_at` text NOT NULL,
	`apply_started_at` text,
	`applied_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_batch_plans_preview_idempotency_unique` ON `catalog_batch_plans` (`preview_idempotency_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_batch_plans_apply_idempotency_unique` ON `catalog_batch_plans` (`apply_idempotency_hash`);--> statement-breakpoint
CREATE INDEX `catalog_batch_plans_actor_created_idx` ON `catalog_batch_plans` (`actor_fingerprint`,`created_at`);--> statement-breakpoint
CREATE INDEX `catalog_batch_plans_status_expires_idx` ON `catalog_batch_plans` (`status`,`expires_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_endpoint_catalog` (
	`path` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`http_method` text DEFAULT 'GET' NOT NULL,
	`summary` text,
	`description` text,
	`parameter_schema_json` text,
	`upstream_price_usd_micros` integer NOT NULL,
	`customer_price_usd_micros` integer NOT NULL,
	`price_verified` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`read_only` integer DEFAULT false NOT NULL,
	`safety_classification` text DEFAULT 'ambiguous' NOT NULL,
	`safety_reasons_json` text,
	`safety_policy_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`source_updated_at` text,
	`sync_generation` text,
	`reviewed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_endpoint_catalog`("path", "platform", "http_method", "summary", "description", "parameter_schema_json", "upstream_price_usd_micros", "customer_price_usd_micros", "price_verified", "enabled", "read_only", "safety_classification", "safety_reasons_json", "safety_policy_version", "revision", "source_updated_at", "sync_generation", "reviewed_at", "created_at", "updated_at") SELECT "path", "platform", "http_method", "summary", "description", "parameter_schema_json", "upstream_price_usd_micros", "customer_price_usd_micros", "price_verified", 0, 0, 'ambiguous', '["migration_requires_resync"]', 1, 0, "source_updated_at", "sync_generation", NULL, "created_at", "updated_at" FROM `endpoint_catalog`;--> statement-breakpoint
DROP TABLE `endpoint_catalog`;--> statement-breakpoint
ALTER TABLE `__new_endpoint_catalog` RENAME TO `endpoint_catalog`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `endpoint_catalog_platform_enabled_idx` ON `endpoint_catalog` (`platform`,`enabled`);--> statement-breakpoint
CREATE INDEX `endpoint_catalog_enabled_read_only_idx` ON `endpoint_catalog` (`enabled`,`read_only`);--> statement-breakpoint
ALTER TABLE `catalog_sync_staging` ADD `safety_classification` text DEFAULT 'ambiguous' NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_sync_staging` ADD `safety_reasons_json` text;--> statement-breakpoint
ALTER TABLE `catalog_sync_staging` ADD `safety_policy_version` integer DEFAULT 1 NOT NULL;
