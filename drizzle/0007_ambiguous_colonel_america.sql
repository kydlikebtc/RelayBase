CREATE TABLE `admin_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_fingerprint` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`details_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_audit_created_idx` ON `admin_audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `admin_audit_target_idx` ON `admin_audit_logs` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`verifier` text,
	`subject_hint` text,
	`message` text,
	`return_to` text DEFAULT '/console' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text
);
--> statement-breakpoint
CREATE INDEX `auth_challenges_expiry_idx` ON `auth_challenges` (`provider`,`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`email` text,
	`wallet_address` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_identities_provider_subject_unique` ON `auth_identities` (`provider`,`subject`);--> statement-breakpoint
CREATE INDEX `auth_identities_user_idx` ON `auth_identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_rate_limit_buckets` (
	`scope` text NOT NULL,
	`minute_bucket` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_rate_limit_bucket_unique` ON `auth_rate_limit_buckets` (`scope`,`minute_bucket`);--> statement-breakpoint
CREATE INDEX `auth_rate_limit_bucket_updated_idx` ON `auth_rate_limit_buckets` (`updated_at`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_idx` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `operation_heartbeats` (
	`name` text PRIMARY KEY NOT NULL,
	`last_success_at` text NOT NULL,
	`details_json` text
);
--> statement-breakpoint
CREATE TABLE `payment_review_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`provider_payment_id` text NOT NULL,
	`parent_payment_id` text,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`actually_paid` text,
	`pay_currency` text,
	`evidence_json` text NOT NULL,
	`resolution_action` text,
	`resolution_note` text,
	`resolution_reference` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `payment_orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_review_provider_unique` ON `payment_review_cases` (`provider_payment_id`);--> statement-breakpoint
CREATE INDEX `payment_review_status_created_idx` ON `payment_review_cases` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `payment_review_order_idx` ON `payment_review_cases` (`order_id`);--> statement-breakpoint
DROP INDEX `payment_events_unprocessed_idx`;--> statement-breakpoint
DROP INDEX `payment_events_payload_unique`;--> statement-breakpoint
CREATE TABLE `__new_payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'nowpayments' NOT NULL,
	`provider_payment_id` text NOT NULL,
	`order_id` text NOT NULL,
	`payment_status` text NOT NULL,
	`payload_json` text NOT NULL,
	`payload_hash` text NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`processed_at` text,
	`processing_error` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` text,
	`next_attempt_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_payment_events`
(`id`, `provider`, `provider_payment_id`, `order_id`, `payment_status`,
 `payload_json`, `payload_hash`, `received_at`, `processed_at`,
 `processing_error`, `attempt_count`, `last_attempt_at`, `next_attempt_at`)
SELECT `id`, `provider`, `provider_payment_id`, `order_id`, `payment_status`,
       `payload_json`, `payload_hash`, `received_at`, `processed_at`,
       `processing_error`, 0, NULL, `received_at`
FROM `payment_events`;--> statement-breakpoint
DROP TABLE `payment_events`;--> statement-breakpoint
ALTER TABLE `__new_payment_events` RENAME TO `payment_events`;--> statement-breakpoint
CREATE UNIQUE INDEX `payment_events_payload_unique` ON `payment_events` (`provider`,`payload_hash`);--> statement-breakpoint
CREATE INDEX `payment_events_unprocessed_idx` ON `payment_events` (`provider`,`processed_at`,`next_attempt_at`,`received_at`);
