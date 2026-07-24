CREATE TABLE `catalog_unresolved_endpoints` (
	`path` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`data_type` text DEFAULT 'other' NOT NULL,
	`surface` text DEFAULT 'other' NOT NULL,
	`summary` text,
	`upstream_price_usd_micros` integer NOT NULL,
	`customer_price_usd_micros` integer NOT NULL,
	`price_verified` integer DEFAULT false NOT NULL,
	`rate_limit_raw` text,
	`rate_limit_rps` integer,
	`free_credit` integer,
	`volume_discount` integer,
	`source_type` text,
	`source_owner` text,
	`sync_generation` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `catalog_unresolved_endpoints_platform_idx` ON `catalog_unresolved_endpoints` (`platform`);--> statement-breakpoint
CREATE INDEX `catalog_unresolved_endpoints_generation_idx` ON `catalog_unresolved_endpoints` (`sync_generation`);--> statement-breakpoint
CREATE TABLE `catalog_unresolved_staging` (
	`id` text PRIMARY KEY NOT NULL,
	`sync_generation` text NOT NULL,
	`path` text NOT NULL,
	`platform` text NOT NULL,
	`data_type` text DEFAULT 'other' NOT NULL,
	`surface` text DEFAULT 'other' NOT NULL,
	`summary` text,
	`upstream_price_usd_micros` integer NOT NULL,
	`customer_price_usd_micros` integer NOT NULL,
	`price_verified` integer DEFAULT false NOT NULL,
	`rate_limit_raw` text,
	`rate_limit_rps` integer,
	`free_credit` integer,
	`volume_discount` integer,
	`source_type` text,
	`source_owner` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `catalog_unresolved_staging_generation_idx` ON `catalog_unresolved_staging` (`sync_generation`);--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_unresolved_staging_generation_path_unique` ON `catalog_unresolved_staging` (`sync_generation`,`path`);--> statement-breakpoint
CREATE TABLE `upstream_source_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`config_hash` text NOT NULL,
	`source_origin` text NOT NULL,
	`api_path_prefix` text NOT NULL,
	`openapi_path` text NOT NULL,
	`catalog_path` text NOT NULL,
	`credential_path` text NOT NULL,
	`catalog_auth_mode` text NOT NULL,
	`public_excluded_prefixes_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "upstream_source_config_singleton" CHECK("upstream_source_config"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `source_config_version` integer;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `source_config_hash` text;--> statement-breakpoint
ALTER TABLE `upstream_credentials` ADD `verified_config_hash` text;--> statement-breakpoint
UPDATE `upstream_credentials`
SET
	`provider` = 'primary',
	`encrypted_secret` = 'revoked',
	`secret_hash` = lower(hex(randomblob(32))),
	`verified_scopes_json` = NULL,
	`verified_config_hash` = NULL,
	`verified_at` = NULL,
	`expires_at` = NULL,
	`revoked_at` = COALESCE(`revoked_at`, CURRENT_TIMESTAMP);--> statement-breakpoint
UPDATE `upstream_credential_state`
SET
	`provider` = 'primary',
	`managed_enabled` = false,
	`active_credential_id` = NULL,
	`version` = `version` + 1,
	`updated_at` = CURRENT_TIMESTAMP;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_upstream_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'primary' NOT NULL,
	`label` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`secret_hash` text NOT NULL,
	`verified_scopes_json` text,
	`verified_config_hash` text,
	`expires_at` text,
	`verified_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used_at` text,
	`revoked_at` text
);--> statement-breakpoint
INSERT INTO `__new_upstream_credentials`
(`id`, `provider`, `label`, `encrypted_secret`, `secret_hash`,
 `verified_scopes_json`, `verified_config_hash`, `expires_at`,
 `verified_at`, `created_at`, `last_used_at`, `revoked_at`)
SELECT `id`, `provider`, `label`, `encrypted_secret`, `secret_hash`,
       `verified_scopes_json`, `verified_config_hash`, `expires_at`,
       `verified_at`, `created_at`, `last_used_at`, `revoked_at`
FROM `upstream_credentials`;--> statement-breakpoint
DROP TABLE `upstream_credentials`;--> statement-breakpoint
ALTER TABLE `__new_upstream_credentials`
RENAME TO `upstream_credentials`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `upstream_credentials_provider_hash_unique`
ON `upstream_credentials` (`provider`,`secret_hash`);--> statement-breakpoint
CREATE INDEX `upstream_credentials_provider_created_idx`
ON `upstream_credentials` (`provider`,`created_at`);
