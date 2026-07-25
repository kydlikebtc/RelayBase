CREATE TABLE `endpoint_x402_config` (
	`path` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`unit_price_usd_micros` integer NOT NULL,
	`max_batch_size` integer DEFAULT 25 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`path`) REFERENCES `endpoint_catalog`(`path`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "endpoint_x402_config_unit_price_range" CHECK("endpoint_x402_config"."unit_price_usd_micros" BETWEEN 1 AND 100000000),
	CONSTRAINT "endpoint_x402_config_batch_size_range" CHECK("endpoint_x402_config"."max_batch_size" BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE INDEX `endpoint_x402_config_enabled_idx` ON `endpoint_x402_config` (`enabled`);--> statement-breakpoint
CREATE TABLE `x402_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_hash` text NOT NULL,
	`endpoint_path` text NOT NULL,
	`request_hash` text NOT NULL,
	`verified_quantity` integer NOT NULL,
	`unit_price_usd_micros` integer NOT NULL,
	`amount_usdc_atomic` integer NOT NULL,
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
	CONSTRAINT "x402_batches_quantity_range" CHECK("x402_batches"."verified_quantity" BETWEEN 1 AND 1000),
	CONSTRAINT "x402_batches_unit_price_range" CHECK("x402_batches"."unit_price_usd_micros" BETWEEN 1 AND 100000000),
	CONSTRAINT "x402_batches_amount_range" CHECK("x402_batches"."amount_usdc_atomic" BETWEEN 1 AND 100000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `x402_batches_idempotency_unique` ON `x402_batches` (`idempotency_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `x402_batches_payment_payload_unique` ON `x402_batches` (`payment_payload_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `x402_batches_transaction_unique` ON `x402_batches` (`transaction_hash`);--> statement-breakpoint
CREATE INDEX `x402_batches_status_created_idx` ON `x402_batches` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `x402_batches_endpoint_created_idx` ON `x402_batches` (`endpoint_path`,`created_at`);--> statement-breakpoint
CREATE INDEX `x402_batches_revenue_idx` ON `x402_batches` (`revenue_recognized_at`,`settled_at`);