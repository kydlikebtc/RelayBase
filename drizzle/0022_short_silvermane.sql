CREATE TABLE `capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`category` text NOT NULL,
	`endpoint_path` text NOT NULL,
	`http_method` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`input_aliases_json` text DEFAULT '{}' NOT NULL,
	`pagination_json` text,
	`response_items_path` text,
	`summary_zh` text NOT NULL,
	`summary_en` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`endpoint_path`) REFERENCES `endpoint_catalog`(`path`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "capabilities_id_shape" CHECK(length(id) BETWEEN 3 AND 96 AND id NOT GLOB '*[^a-z0-9._]*' AND id GLOB '*.*' AND id NOT GLOB '*.*.*.*.*' AND id NOT GLOB '*..*' AND id NOT GLOB '.*' AND id NOT GLOB '*.' AND id NOT GLOB '_*' AND id NOT GLOB '*_' AND id NOT GLOB '*__*' AND id NOT GLOB '*._*' AND id NOT GLOB '*_.*'),
	CONSTRAINT "capabilities_http_method_values" CHECK("capabilities"."http_method" IN ('GET', 'POST')),
	CONSTRAINT "capabilities_status_values" CHECK("capabilities"."status" IN ('draft', 'published', 'deprecated')),
	CONSTRAINT "capabilities_revision_positive" CHECK("capabilities"."revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX `capabilities_endpoint_path_idx` ON `capabilities` (`endpoint_path`);--> statement-breakpoint
CREATE INDEX `capabilities_platform_status_idx` ON `capabilities` (`platform`,`status`);