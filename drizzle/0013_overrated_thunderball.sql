ALTER TABLE `catalog_batch_plan_items` ADD `data_type` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_batch_plan_items` ADD `tags_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_batch_plan_items` ADD `surface` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_batch_plan_items` ADD `operation_id` text;--> statement-breakpoint
ALTER TABLE `catalog_sync_staging` ADD `data_type` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_sync_staging` ADD `tags_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_sync_staging` ADD `surface` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_sync_staging` ADD `operation_id` text;--> statement-breakpoint
DELETE FROM `catalog_sync_staging`;--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_sync_staging_generation_path_unique` ON `catalog_sync_staging` (`generation`,`path`);--> statement-breakpoint
ALTER TABLE `endpoint_catalog` ADD `data_type` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `endpoint_catalog` ADD `tags_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `endpoint_catalog` ADD `surface` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `endpoint_catalog` ADD `operation_id` text;--> statement-breakpoint
UPDATE `endpoint_catalog`
SET `enabled` = 0,
    `read_only` = 0,
    `reviewed_at` = NULL,
    `sync_generation` = NULL,
    `revision` = `revision` + 1,
    `updated_at` = CURRENT_TIMESTAMP;--> statement-breakpoint
DELETE FROM `catalog_sync_locks`;--> statement-breakpoint
DELETE FROM `catalog_sync_state`;--> statement-breakpoint
CREATE INDEX `endpoint_catalog_data_type_enabled_idx` ON `endpoint_catalog` (`data_type`,`enabled`);--> statement-breakpoint
CREATE INDEX `endpoint_catalog_surface_enabled_idx` ON `endpoint_catalog` (`surface`,`enabled`);--> statement-breakpoint
CREATE TRIGGER `balance_ledger_prevent_update`
BEFORE UPDATE ON `balance_ledger`
BEGIN
  SELECT RAISE(ABORT, 'balance_ledger is append-only');
END;--> statement-breakpoint
CREATE TRIGGER `balance_ledger_prevent_delete`
BEFORE DELETE ON `balance_ledger`
BEGIN
  SELECT RAISE(ABORT, 'balance_ledger is append-only');
END;--> statement-breakpoint
CREATE TRIGGER `payment_orders_prevent_delete`
BEFORE DELETE ON `payment_orders`
BEGIN
  SELECT RAISE(ABORT, 'payment_orders are retained for audit');
END;
