ALTER TABLE `catalog_sync_state` ADD `openapi_version` text;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `openapi_operation_count` integer;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `raw_price_row_count` integer;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `normalized_price_count` integer;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `openapi_price_mapped_count` integer;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `price_only_count` integer;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `openapi_only_count` integer;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `scope_excluded_count` integer;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `matched_price_count` integer;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `positive_price_count` integer;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `zero_price_count` integer;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `awaiting_price_count` integer;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `openapi_snapshot_hash` text;--> statement-breakpoint
ALTER TABLE `catalog_sync_state` ADD `price_snapshot_hash` text;
