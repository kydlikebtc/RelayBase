CREATE TABLE `endpoint_capabilities` (
	`path` text PRIMARY KEY NOT NULL,
	`execution_mode` text DEFAULT 'direct' NOT NULL,
	`native_batch_supported` integer DEFAULT false NOT NULL,
	`native_batch_max` integer,
	`target_field` text,
	`target_encoding` text,
	`pagination_style` text,
	`pagination_request_field` text,
	`pagination_response_field` text,
	`pagination_page_size_field` text,
	`pagination_page_size_max` integer,
	`typical_items_per_response` integer,
	`response_items_path` text,
	`evidence_status` text DEFAULT 'pending' NOT NULL,
	`evidence_url` text,
	`evidence_note` text,
	`capability_revision` integer DEFAULT 1 NOT NULL,
	`verified_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`path`) REFERENCES `endpoint_catalog`(`path`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "endpoint_capabilities_execution_mode_values" CHECK("endpoint_capabilities"."execution_mode" IN ('direct', 'native_batch', 'paginated', 'async_job', 'fanout')),
	CONSTRAINT "endpoint_capabilities_target_encoding_values" CHECK("endpoint_capabilities"."target_encoding" IS NULL OR "endpoint_capabilities"."target_encoding" IN ('json_array', 'csv_query', 'csv_body')),
	CONSTRAINT "endpoint_capabilities_pagination_style_values" CHECK("endpoint_capabilities"."pagination_style" IS NULL OR "endpoint_capabilities"."pagination_style" IN ('cursor', 'page', 'offset', 'mixed')),
	CONSTRAINT "endpoint_capabilities_evidence_status_values" CHECK("endpoint_capabilities"."evidence_status" IN ('verified', 'openapi_inferred', 'pending')),
	CONSTRAINT "endpoint_capabilities_native_batch_range" CHECK("endpoint_capabilities"."native_batch_max" IS NULL OR "endpoint_capabilities"."native_batch_max" BETWEEN 1 AND 1000),
	CONSTRAINT "endpoint_capabilities_typical_items_range" CHECK("endpoint_capabilities"."typical_items_per_response" IS NULL OR "endpoint_capabilities"."typical_items_per_response" BETWEEN 1 AND 100000),
	CONSTRAINT "endpoint_capabilities_page_size_range" CHECK("endpoint_capabilities"."pagination_page_size_max" IS NULL OR "endpoint_capabilities"."pagination_page_size_max" BETWEEN 1 AND 100000)
);
--> statement-breakpoint
CREATE INDEX `endpoint_capabilities_mode_status_idx` ON `endpoint_capabilities` (`execution_mode`,`evidence_status`);--> statement-breakpoint
INSERT INTO `endpoint_capabilities`
(`path`, `execution_mode`, `native_batch_supported`, `evidence_status`,
 `evidence_note`, `capability_revision`, `updated_at`)
SELECT `path`, 'direct', 0, 'pending',
       'RelayBase currently forwards one customer request as one upstream request. Native batching, pagination response semantics, async behavior and returned-item counts require endpoint-specific evidence.',
       1, CURRENT_TIMESTAMP
FROM `endpoint_catalog`;--> statement-breakpoint
UPDATE `endpoint_capabilities`
SET `execution_mode` = 'native_batch',
    `native_batch_supported` = 1,
    `native_batch_max` = 10,
    `target_field` = 'aweme_ids',
    `target_encoding` = 'json_array',
    `evidence_status` = 'verified',
    `evidence_url` = 'https://docs.tikhub.io/190419367e0',
    `evidence_note` = 'TikHub endpoint documentation states that one POST accepts up to 10 aweme IDs and is billed per upstream request.',
    `verified_at` = '2026-07-26',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `path` = '/v1/tiktok/app/v3/fetch_multi_video';--> statement-breakpoint
UPDATE `endpoint_capabilities`
SET `execution_mode` = 'native_batch',
    `native_batch_supported` = 1,
    `native_batch_max` = 25,
    `target_field` = 'aweme_ids',
    `target_encoding` = 'json_array',
    `evidence_status` = 'verified',
    `evidence_url` = 'https://docs.tikhub.io/258124428e0',
    `evidence_note` = 'The endpoint-specific TikHub document states a maximum of 25 aweme IDs per POST.',
    `verified_at` = '2026-07-26',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `path` = '/v1/tiktok/app/v3/fetch_multi_video_v2';--> statement-breakpoint
UPDATE `endpoint_capabilities`
SET `execution_mode` = 'native_batch',
    `native_batch_supported` = 1,
    `native_batch_max` = 50,
    `target_field` = 'aweme_ids',
    `target_encoding` = 'json_array',
    `evidence_status` = 'verified',
    `evidence_url` = 'https://docs.tikhub.io/339033805e0',
    `evidence_note` = 'TikHub endpoint documentation states that one POST accepts up to 50 aweme IDs and is billed per upstream request.',
    `verified_at` = '2026-07-26',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `path` = '/v1/douyin/app/v3/fetch_multi_video_v2';--> statement-breakpoint
UPDATE `endpoint_capabilities`
SET `execution_mode` = 'native_batch',
    `native_batch_supported` = 1,
    `native_batch_max` = 50,
    `target_field` = 'aweme_ids',
    `target_encoding` = 'json_array',
    `evidence_status` = 'verified',
    `evidence_url` = 'https://docs.tikhub.io/244469112e0',
    `evidence_note` = 'TikHub endpoint documentation states that one POST accepts up to 50 aweme IDs.',
    `verified_at` = '2026-07-26',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `path` = '/v1/douyin/web/fetch_multi_video';--> statement-breakpoint
UPDATE `endpoint_capabilities`
SET `execution_mode` = 'native_batch',
    `native_batch_supported` = 1,
    `native_batch_max` = 50,
    `target_field` = 'aweme_ids',
    `target_encoding` = 'csv_query',
    `evidence_status` = 'verified',
    `evidence_url` = 'https://docs.tikhub.io/256258480e0',
    `evidence_note` = 'TikHub documents a comma-separated aweme_ids query parameter with a maximum of 50 IDs per GET.',
    `verified_at` = '2026-07-26',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `path` = '/v1/douyin/app/v3/fetch_multi_video_statistics';--> statement-breakpoint
UPDATE `endpoint_capabilities`
SET `execution_mode` = 'native_batch',
    `native_batch_supported` = 1,
    `native_batch_max` = 50,
    `target_field` = 'aweme_ids',
    `target_encoding` = 'csv_body',
    `evidence_status` = 'verified',
    `evidence_url` = 'https://docs.tikhub.io/360401424e0',
    `evidence_note` = 'TikHub documents up to 50 comma-separated aweme IDs per POST and special minimum-50 charging.',
    `verified_at` = '2026-07-26',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `path` = '/v1/douyin/web/fetch_multi_video_high_quality_play_url';--> statement-breakpoint
UPDATE `endpoint_capabilities`
SET `execution_mode` = 'paginated',
    `pagination_style` = 'cursor',
    `pagination_request_field` = 'pagination_token',
    `pagination_page_size_field` = 'count',
    `pagination_page_size_max` = 50,
    `evidence_status` = 'verified',
    `evidence_url` = 'https://docs.tikhub.io/419083061e0',
    `evidence_note` = 'TikHub documents at most 50 posts per page. RelayBase never follows the next-page token implicitly.',
    `verified_at` = '2026-07-26',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `path` = '/v1/instagram/v3/get_user_posts';--> statement-breakpoint
UPDATE `endpoint_capabilities`
SET `execution_mode` = 'paginated',
    `pagination_style` = 'cursor',
    `pagination_request_field` = 'pagination_token',
    `pagination_page_size_field` = 'count',
    `pagination_page_size_max` = 100,
    `evidence_status` = 'verified',
    `evidence_url` = 'https://docs.tikhub.io/419083077e0',
    `evidence_note` = 'TikHub documents at most 100 following records per page. RelayBase treats each cursor page as one upstream request.',
    `verified_at` = '2026-07-26',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `path` = '/v1/instagram/v3/get_user_following';--> statement-breakpoint
CREATE TRIGGER `endpoint_capabilities_after_catalog_insert`
AFTER INSERT ON `endpoint_catalog`
BEGIN
  INSERT OR IGNORE INTO `endpoint_capabilities`
  (`path`, `execution_mode`, `native_batch_supported`, `evidence_status`,
   `evidence_note`, `capability_revision`, `updated_at`)
  VALUES (
    NEW.`path`, 'direct', 0, 'pending',
    'RelayBase currently forwards one customer request as one upstream request. Native batching, pagination response semantics, async behavior and returned-item counts require endpoint-specific evidence.',
    1, CURRENT_TIMESTAMP
  );
END;--> statement-breakpoint
CREATE TABLE `upstream_capacity_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`context_type` text NOT NULL,
	`context_id` text NOT NULL,
	`capacity_group_id` text NOT NULL,
	`endpoint_path` text NOT NULL,
	`planned_requests` integer NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "upstream_capacity_leases_status_values" CHECK("upstream_capacity_leases"."status" IN ('reserved', 'consuming', 'released', 'expired')),
	CONSTRAINT "upstream_capacity_leases_request_range" CHECK("upstream_capacity_leases"."planned_requests" BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upstream_capacity_leases_context_unique` ON `upstream_capacity_leases` (`context_type`,`context_id`);--> statement-breakpoint
CREATE INDEX `upstream_capacity_leases_group_endpoint_idx` ON `upstream_capacity_leases` (`capacity_group_id`,`endpoint_path`,`status`,`expires_at`);--> statement-breakpoint
ALTER TABLE `api_calls` ADD `customer_request_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `api_calls` ADD `upstream_attempt_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `api_calls` ADD `target_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `api_calls` ADD `returned_item_count` integer;--> statement-breakpoint
ALTER TABLE `api_calls` ADD `pagination_unit_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `upstream_request_attempts` ADD `target_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `upstream_request_attempts` ADD `returned_item_count` integer;--> statement-breakpoint
ALTER TABLE `upstream_request_attempts` ADD `pagination_unit_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_x402_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_hash` text NOT NULL,
	`endpoint_path` text NOT NULL,
	`request_hash` text NOT NULL,
	`verified_quantity` integer NOT NULL,
	`unit_price_usd_micros` integer NOT NULL,
	`amount_usdc_atomic` integer NOT NULL,
	`upstream_cost_usd_micros` integer DEFAULT 0 NOT NULL,
	`execution_mode` text DEFAULT 'fanout' NOT NULL,
	`capability_revision` integer DEFAULT 1 NOT NULL,
	`planned_upstream_requests` integer DEFAULT 1 NOT NULL,
	`actual_upstream_attempts` integer DEFAULT 0 NOT NULL,
	`returned_item_count` integer,
	`capacity_group_id` text,
	`status` text DEFAULT 'quoted' NOT NULL,
	`network` text DEFAULT 'eip155:8453' NOT NULL,
	`asset` text NOT NULL,
	`pay_to` text NOT NULL,
	`payment_requirements_json` text NOT NULL,
	`payment_payload_hash` text,
	`payer_address` text,
	`transaction_hash` text,
	`facilitator_mode` text NOT NULL,
	`facilitator_receipt_json` text,
	`execution_response_json` text,
	`failure_code` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`quoted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`verified_at` text,
	`settled_at` text,
	`revenue_recognized_at` text,
	`execution_started_at` text,
	`completed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`endpoint_path`) REFERENCES `endpoint_catalog`(`path`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "x402_batches_quantity_range" CHECK("__new_x402_batches"."verified_quantity" BETWEEN 1 AND 1000),
	CONSTRAINT "x402_batches_unit_price_range" CHECK("__new_x402_batches"."unit_price_usd_micros" BETWEEN 1 AND 100000000),
	CONSTRAINT "x402_batches_amount_range" CHECK("__new_x402_batches"."amount_usdc_atomic" BETWEEN 1 AND 100000000000),
	CONSTRAINT "x402_batches_execution_mode_values" CHECK("__new_x402_batches"."execution_mode" IN ('native_batch', 'fanout')),
	CONSTRAINT "x402_batches_upstream_request_range" CHECK("__new_x402_batches"."planned_upstream_requests" BETWEEN 1 AND 1000 AND "__new_x402_batches"."actual_upstream_attempts" BETWEEN 0 AND 2000)
);
--> statement-breakpoint
INSERT INTO `__new_x402_batches`("id", "idempotency_hash", "endpoint_path", "request_hash", "verified_quantity", "unit_price_usd_micros", "amount_usdc_atomic", "upstream_cost_usd_micros", "execution_mode", "capability_revision", "planned_upstream_requests", "actual_upstream_attempts", "returned_item_count", "capacity_group_id", "status", "network", "asset", "pay_to", "payment_requirements_json", "payment_payload_hash", "payer_address", "transaction_hash", "facilitator_mode", "facilitator_receipt_json", "execution_response_json", "failure_code", "created_at", "quoted_at", "expires_at", "verified_at", "settled_at", "revenue_recognized_at", "execution_started_at", "completed_at", "updated_at") SELECT "id", "idempotency_hash", "endpoint_path", "request_hash", "verified_quantity", "unit_price_usd_micros", "amount_usdc_atomic", "upstream_cost_usd_micros", 'fanout', 1, "verified_quantity", 0, NULL, NULL, "status", "network", "asset", "pay_to", "payment_requirements_json", "payment_payload_hash", "payer_address", "transaction_hash", "facilitator_mode", "facilitator_receipt_json", "execution_response_json", "failure_code", "created_at", "quoted_at", "expires_at", "verified_at", "settled_at", "revenue_recognized_at", "execution_started_at", "completed_at", "updated_at" FROM `x402_batches`;--> statement-breakpoint
DROP TABLE `x402_batches`;--> statement-breakpoint
ALTER TABLE `__new_x402_batches` RENAME TO `x402_batches`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `x402_batches_idempotency_unique` ON `x402_batches` (`idempotency_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `x402_batches_payment_payload_unique` ON `x402_batches` (`payment_payload_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `x402_batches_transaction_unique` ON `x402_batches` (`transaction_hash`);--> statement-breakpoint
CREATE INDEX `x402_batches_status_created_idx` ON `x402_batches` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `x402_batches_endpoint_created_idx` ON `x402_batches` (`endpoint_path`,`created_at`);--> statement-breakpoint
CREATE INDEX `x402_batches_revenue_idx` ON `x402_batches` (`revenue_recognized_at`,`settled_at`);
