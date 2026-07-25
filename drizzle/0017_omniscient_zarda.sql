CREATE TABLE `x402_runtime_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`managed_enabled` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`pay_to` text,
	`facilitator_url` text DEFAULT 'https://api.cdp.coinbase.com/platform/v2/x402' NOT NULL,
	`encrypted_cdp_api_key_id` text,
	`cdp_api_key_id_hash` text,
	`encrypted_cdp_api_key_secret` text,
	`cdp_api_key_secret_hash` text,
	`encrypted_bearer_token` text,
	`bearer_token_hash` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "x402_runtime_config_singleton" CHECK("x402_runtime_config"."id" = 1)
);
--> statement-breakpoint
INSERT INTO `x402_runtime_config`
(`id`, `managed_enabled`, `enabled`, `facilitator_url`, `revision`)
VALUES
(1, 0, 0, 'https://api.cdp.coinbase.com/platform/v2/x402', 0);
