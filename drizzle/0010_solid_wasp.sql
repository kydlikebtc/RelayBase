ALTER TABLE `catalog_sync_state` ADD `credential_source` text;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `credential_id` text;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `credential_fingerprint` text;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `credential_state_version` integer;--> statement-breakpoint
ALTER TABLE `upstream_credentials` ADD `verified_scopes_json` text;--> statement-breakpoint
ALTER TABLE `upstream_credentials` ADD `expires_at` text;