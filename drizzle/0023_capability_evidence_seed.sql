CREATE TABLE `capability_evidence_seed` (
	`path` text NOT NULL,
	`http_method` text NOT NULL,
	`execution_mode` text NOT NULL,
	`native_batch_supported` integer NOT NULL,
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
	`evidence_status` text NOT NULL,
	`evidence_url` text,
	`evidence_note` text NOT NULL,
	`verified_at` text,
	PRIMARY KEY(`path`, `http_method`),
	CONSTRAINT "capability_evidence_seed_http_method_values" CHECK("capability_evidence_seed"."http_method" IN ('GET', 'POST')),
	CONSTRAINT "capability_evidence_seed_execution_mode_values" CHECK("capability_evidence_seed"."execution_mode" IN ('direct', 'native_batch', 'paginated', 'async_job', 'fanout')),
	CONSTRAINT "capability_evidence_seed_evidence_status_values" CHECK("capability_evidence_seed"."evidence_status" IN ('verified', 'openapi_inferred', 'pending'))
);
--> statement-breakpoint
ALTER TABLE `endpoint_capabilities` ADD `evidence_http_method` text;--> statement-breakpoint
INSERT INTO `capability_evidence_seed`
(`path`, `http_method`, `execution_mode`, `native_batch_supported`, `native_batch_max`,
 `target_field`, `target_encoding`,
 `pagination_style`, `pagination_request_field`, `pagination_response_field`,
 `pagination_page_size_field`, `pagination_page_size_max`,
 `typical_items_per_response`, `response_items_path`,
 `evidence_status`, `evidence_url`, `evidence_note`, `verified_at`)
VALUES
  ('/v1/tiktok/app/v3/fetch_multi_video', 'POST', 'native_batch', 1, 10,
   'aweme_ids', 'json_array',
   NULL, NULL, NULL, NULL, NULL,
   NULL, NULL,
   'verified', 'https://docs.tikhub.io/190419367e0',
   'TikHub endpoint documentation states that one POST accepts up to 10 aweme IDs and is billed per upstream request.',
   '2026-07-26'),
  ('/v1/tiktok/app/v3/fetch_multi_video_v2', 'POST', 'native_batch', 1, 25,
   'aweme_ids', 'json_array',
   NULL, NULL, NULL, NULL, NULL,
   NULL, NULL,
   'verified', 'https://docs.tikhub.io/258124428e0',
   'The endpoint-specific TikHub document states a maximum of 25 aweme IDs per POST. It is stronger evidence than a conflicting landing-page summary.',
   '2026-07-26'),
  ('/v1/douyin/app/v3/fetch_multi_video_v2', 'POST', 'native_batch', 1, 50,
   'aweme_ids', 'json_array',
   NULL, NULL, NULL, NULL, NULL,
   NULL, NULL,
   'verified', 'https://docs.tikhub.io/339033805e0',
   'TikHub endpoint documentation states that one POST accepts up to 50 aweme IDs and is billed per upstream request.',
   '2026-07-26'),
  ('/v1/douyin/web/fetch_multi_video', 'POST', 'native_batch', 1, 50,
   'aweme_ids', 'json_array',
   NULL, NULL, NULL, NULL, NULL,
   NULL, NULL,
   'verified', 'https://docs.tikhub.io/244469112e0',
   'TikHub endpoint documentation states that one POST accepts up to 50 aweme IDs.',
   '2026-07-26'),
  ('/v1/douyin/app/v3/fetch_multi_video_statistics', 'GET', 'native_batch', 1, 50,
   'aweme_ids', 'csv_query',
   NULL, NULL, NULL, NULL, NULL,
   NULL, NULL,
   'verified', 'https://docs.tikhub.io/256258480e0',
   'TikHub documents a comma-separated aweme_ids query parameter with a maximum of 50 IDs per GET.',
   '2026-07-26'),
  ('/v1/douyin/web/fetch_multi_video_high_quality_play_url', 'POST', 'native_batch', 1, 50,
   'aweme_ids', 'csv_body',
   NULL, NULL, NULL, NULL, NULL,
   NULL, NULL,
   'verified', 'https://docs.tikhub.io/360401424e0',
   'TikHub documents up to 50 comma-separated aweme IDs per POST and notes special minimum-50 charging and longer processing.',
   '2026-07-26'),
  ('/v1/instagram/v3/get_user_posts', 'GET', 'paginated', 0, NULL,
   NULL, NULL,
   'cursor', 'pagination_token', NULL, 'count', 50,
   NULL, NULL,
   'verified', 'https://docs.tikhub.io/419083061e0',
   'TikHub documents at most 50 posts per page. RelayBase never follows the next-page token implicitly.',
   '2026-07-26'),
  ('/v1/instagram/v3/get_user_following', 'GET', 'paginated', 0, NULL,
   NULL, NULL,
   'cursor', 'pagination_token', NULL, 'count', 100,
   NULL, NULL,
   'verified', 'https://docs.tikhub.io/419083077e0',
   'TikHub documents at most 100 following records per page. RelayBase treats each cursor page as one upstream request.',
   '2026-07-26');
--> statement-breakpoint
DROP TRIGGER `endpoint_capabilities_after_catalog_insert`;--> statement-breakpoint
CREATE TRIGGER `endpoint_capabilities_after_catalog_insert`
AFTER INSERT ON `endpoint_catalog`
BEGIN
  INSERT OR IGNORE INTO `endpoint_capabilities`
  (`path`, `execution_mode`, `native_batch_supported`, `native_batch_max`,
   `target_field`, `target_encoding`,
   `pagination_style`, `pagination_request_field`, `pagination_response_field`,
   `pagination_page_size_field`, `pagination_page_size_max`,
   `typical_items_per_response`, `response_items_path`,
   `evidence_status`, `evidence_url`, `evidence_note`, `evidence_http_method`,
   `capability_revision`, `verified_at`, `updated_at`)
  SELECT
    NEW.`path`,
    COALESCE(s.`execution_mode`, 'direct'),
    COALESCE(s.`native_batch_supported`, 0),
    s.`native_batch_max`,
    s.`target_field`,
    s.`target_encoding`,
    s.`pagination_style`,
    s.`pagination_request_field`,
    s.`pagination_response_field`,
    s.`pagination_page_size_field`,
    s.`pagination_page_size_max`,
    s.`typical_items_per_response`,
    s.`response_items_path`,
    COALESCE(s.`evidence_status`, 'pending'),
    s.`evidence_url`,
    COALESCE(s.`evidence_note`, 'RelayBase currently forwards one customer request as one upstream request. Native batching, pagination response semantics, async behavior and returned-item counts require endpoint-specific evidence.'),
    s.`http_method`,
    1,
    s.`verified_at`,
    CURRENT_TIMESTAMP
  FROM (SELECT 1) AS `one`
  LEFT JOIN `capability_evidence_seed` s
    ON s.`path` = NEW.`path` AND s.`http_method` = NEW.`http_method`;
END;
--> statement-breakpoint
-- Existing deployments that synced their catalog after 0019 hold rows the
-- original seeding never reached. Record which HTTP method each evidence row
-- applies to first; the runtime compares it against the catalog method on every
-- lookup, exactly as the removed VERIFIED_ENDPOINT_METHODS constant did.
UPDATE `endpoint_capabilities`
SET `evidence_http_method` = (
      SELECT s.`http_method` FROM `capability_evidence_seed` s
      WHERE s.`path` = `endpoint_capabilities`.`path`
    )
WHERE `evidence_http_method` IS NULL
  AND EXISTS (
    SELECT 1 FROM `capability_evidence_seed` s
    WHERE s.`path` = `endpoint_capabilities`.`path`
  );
--> statement-breakpoint
-- Promote rows that never received the 0019 evidence. Operator-confirmed rows
-- are protected by the evidence_status guard.
UPDATE `endpoint_capabilities`
SET
    `execution_mode` = (SELECT s.`execution_mode` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `native_batch_supported` = (SELECT s.`native_batch_supported` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `native_batch_max` = (SELECT s.`native_batch_max` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `target_field` = (SELECT s.`target_field` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `target_encoding` = (SELECT s.`target_encoding` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `pagination_style` = (SELECT s.`pagination_style` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `pagination_request_field` = (SELECT s.`pagination_request_field` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `pagination_response_field` = (SELECT s.`pagination_response_field` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `pagination_page_size_field` = (SELECT s.`pagination_page_size_field` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `pagination_page_size_max` = (SELECT s.`pagination_page_size_max` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `typical_items_per_response` = (SELECT s.`typical_items_per_response` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `response_items_path` = (SELECT s.`response_items_path` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `evidence_status` = (SELECT s.`evidence_status` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `evidence_url` = (SELECT s.`evidence_url` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `evidence_note` = (SELECT s.`evidence_note` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `verified_at` = (SELECT s.`verified_at` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`)
WHERE `evidence_status` <> 'verified'
  AND EXISTS (
    SELECT 1 FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`
  );
--> statement-breakpoint
-- Converge rows 0019 seeded verbatim onto the seed's wording so that upgraded
-- and freshly migrated databases expose identical evidence. Scoped to rows whose
-- evidence_url still matches the seed, so an operator who verified an endpoint
-- against a different source is never overwritten.
UPDATE `endpoint_capabilities`
SET
    `execution_mode` = (SELECT s.`execution_mode` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `native_batch_supported` = (SELECT s.`native_batch_supported` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `native_batch_max` = (SELECT s.`native_batch_max` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `target_field` = (SELECT s.`target_field` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `target_encoding` = (SELECT s.`target_encoding` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `pagination_style` = (SELECT s.`pagination_style` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `pagination_request_field` = (SELECT s.`pagination_request_field` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `pagination_response_field` = (SELECT s.`pagination_response_field` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `pagination_page_size_field` = (SELECT s.`pagination_page_size_field` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `pagination_page_size_max` = (SELECT s.`pagination_page_size_max` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `typical_items_per_response` = (SELECT s.`typical_items_per_response` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `response_items_path` = (SELECT s.`response_items_path` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `evidence_status` = (SELECT s.`evidence_status` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `evidence_url` = (SELECT s.`evidence_url` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `evidence_note` = (SELECT s.`evidence_note` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`),
    `verified_at` = (SELECT s.`verified_at` FROM `capability_evidence_seed` s
     JOIN `endpoint_catalog` c ON c.`path` = s.`path`
     WHERE s.`path` = `endpoint_capabilities`.`path`
       AND s.`http_method` = c.`http_method`)
WHERE `evidence_status` = 'verified'
  AND EXISTS (
    SELECT 1 FROM `capability_evidence_seed` s
    JOIN `endpoint_catalog` c ON c.`path` = s.`path`
    WHERE s.`path` = `endpoint_capabilities`.`path`
      AND s.`http_method` = c.`http_method`
      AND s.`evidence_url` IS `endpoint_capabilities`.`evidence_url`
  );
