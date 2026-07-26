CREATE TABLE `request_rate_limit_state` (
	`scope` text NOT NULL,
	`subject_id` text NOT NULL,
	`theoretical_arrival_ms` integer NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `request_rate_limit_state_unique` ON `request_rate_limit_state` (`scope`,`subject_id`);--> statement-breakpoint
CREATE INDEX `request_rate_limit_state_updated_idx` ON `request_rate_limit_state` (`updated_at`);--> statement-breakpoint
CREATE TABLE `upstream_capacity_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'primary' NOT NULL,
	`label` text NOT NULL,
	`configured_rps_per_endpoint` integer DEFAULT 10 NOT NULL,
	`headroom_bps` integer DEFAULT 8000 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "upstream_capacity_groups_rps_range" CHECK("upstream_capacity_groups"."configured_rps_per_endpoint" BETWEEN 1 AND 10000),
	CONSTRAINT "upstream_capacity_groups_headroom_range" CHECK("upstream_capacity_groups"."headroom_bps" BETWEEN 1000 AND 10000),
	CONSTRAINT "upstream_capacity_groups_status_values" CHECK("upstream_capacity_groups"."status" IN ('active', 'draining', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upstream_capacity_groups_provider_label_unique` ON `upstream_capacity_groups` (`provider`,`label`);--> statement-breakpoint
CREATE INDEX `upstream_capacity_groups_status_idx` ON `upstream_capacity_groups` (`status`);--> statement-breakpoint
CREATE TABLE `upstream_credential_health` (
	`credential_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'healthy' NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`ewma_latency_ms` integer,
	`cooldown_until` text,
	`last_status_code` integer,
	`last_error_code` text,
	`last_success_at` text,
	`last_failure_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`credential_id`) REFERENCES `upstream_credentials`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "upstream_credential_health_state_values" CHECK("upstream_credential_health"."state" IN ('healthy', 'degraded', 'auth_failed', 'balance_low', 'circuit_open'))
);
--> statement-breakpoint
CREATE INDEX `upstream_credential_health_state_idx` ON `upstream_credential_health` (`state`,`cooldown_until`);--> statement-breakpoint
CREATE TABLE `upstream_rate_limit_state` (
	`capacity_group_id` text NOT NULL,
	`endpoint_path` text NOT NULL,
	`theoretical_arrival_ms` integer NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upstream_rate_limit_state_unique` ON `upstream_rate_limit_state` (`capacity_group_id`,`endpoint_path`);--> statement-breakpoint
CREATE INDEX `upstream_rate_limit_state_updated_idx` ON `upstream_rate_limit_state` (`updated_at`);--> statement-breakpoint
CREATE TABLE `upstream_request_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`context_type` text NOT NULL,
	`context_id` text NOT NULL,
	`endpoint_path` text NOT NULL,
	`capacity_group_id` text,
	`credential_id` text,
	`credential_fingerprint` text,
	`attempt_number` integer NOT NULL,
	`outcome` text NOT NULL,
	`status_code` integer,
	`latency_ms` integer NOT NULL,
	`upstream_request_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `upstream_request_attempts_context_idx` ON `upstream_request_attempts` (`context_type`,`context_id`);--> statement-breakpoint
CREATE INDEX `upstream_request_attempts_route_idx` ON `upstream_request_attempts` (`capacity_group_id`,`endpoint_path`,`created_at`);--> statement-breakpoint
CREATE TABLE `upstream_route_health` (
	`capacity_group_id` text NOT NULL,
	`endpoint_path` text NOT NULL,
	`state` text DEFAULT 'healthy' NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`consecutive_rate_limits` integer DEFAULT 0 NOT NULL,
	`cooldown_until` text,
	`last_status_code` integer,
	`last_failure_at` text,
	`last_success_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "upstream_route_health_state_values" CHECK("upstream_route_health"."state" IN ('healthy', 'rate_limited', 'degraded', 'circuit_open'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upstream_route_health_unique` ON `upstream_route_health` (`capacity_group_id`,`endpoint_path`);--> statement-breakpoint
CREATE INDEX `upstream_route_health_state_idx` ON `upstream_route_health` (`state`,`cooldown_until`);--> statement-breakpoint
ALTER TABLE `api_keys` ADD `rate_limit_rps` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `rate_limit_burst` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_sync_staging` ADD `rate_limit_raw` text;--> statement-breakpoint
ALTER TABLE `catalog_sync_staging` ADD `rate_limit_rps` integer;--> statement-breakpoint
ALTER TABLE `endpoint_catalog` ADD `rate_limit_raw` text;--> statement-breakpoint
ALTER TABLE `endpoint_catalog` ADD `rate_limit_rps` integer;--> statement-breakpoint
ALTER TABLE `upstream_credentials` ADD `capacity_group_id` text REFERENCES `upstream_capacity_groups`(`id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `upstream_credentials` ADD `routing_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `upstream_credentials` ADD `priority` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `upstream_credentials` ADD `weight` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
CREATE INDEX `upstream_credentials_capacity_group_idx` ON `upstream_credentials` (`capacity_group_id`,`routing_enabled`);--> statement-breakpoint
INSERT INTO `upstream_capacity_groups`
(`id`, `provider`, `label`, `configured_rps_per_endpoint`,
 `headroom_bps`, `status`, `created_at`, `updated_at`)
VALUES
('upg_primary_default', 'primary', 'TikHub primary account', 10, 8000,
 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);--> statement-breakpoint
UPDATE `upstream_credentials`
SET
  `capacity_group_id` = 'upg_primary_default',
  `routing_enabled` = CASE
    WHEN `revoked_at` IS NULL
      AND `verified_at` IS NOT NULL
      AND `id` = (
        SELECT `active_credential_id`
        FROM `upstream_credential_state`
        WHERE `provider` = 'primary'
      )
    THEN 1 ELSE 0
  END;--> statement-breakpoint
INSERT INTO `upstream_credential_health`
(`credential_id`, `state`, `consecutive_failures`, `updated_at`)
SELECT `id`, 'healthy', 0, CURRENT_TIMESTAMP
FROM `upstream_credentials`
WHERE `routing_enabled` = 1 AND `revoked_at` IS NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `rate_limit_rps` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `rate_limit_burst` integer DEFAULT 6 NOT NULL;
