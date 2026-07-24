CREATE TABLE `upstream_credential_state` (
	`provider` text PRIMARY KEY NOT NULL,
	`managed_enabled` integer DEFAULT false NOT NULL,
	`active_credential_id` text,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`active_credential_id`) REFERENCES `upstream_credentials`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upstream_credential_state_active_unique` ON `upstream_credential_state` (`active_credential_id`);--> statement-breakpoint
CREATE TABLE `upstream_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'primary' NOT NULL,
	`label` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`secret_hash` text NOT NULL,
	`verified_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upstream_credentials_provider_hash_unique` ON `upstream_credentials` (`provider`,`secret_hash`);--> statement-breakpoint
CREATE INDEX `upstream_credentials_provider_created_idx` ON `upstream_credentials` (`provider`,`created_at`);--> statement-breakpoint
INSERT INTO `upstream_credential_state`
(`provider`, `managed_enabled`, `active_credential_id`, `version`, `updated_at`)
VALUES ('primary', 0, NULL, 0, CURRENT_TIMESTAMP);
