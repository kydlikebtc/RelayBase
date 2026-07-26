CREATE TABLE `admin_memberships` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text DEFAULT 'auditor' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "admin_memberships_role_values" CHECK("admin_memberships"."role" IN ('owner', 'operator', 'auditor')),
	CONSTRAINT "admin_memberships_status_values" CHECK("admin_memberships"."status" IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE INDEX `admin_memberships_role_status_idx` ON `admin_memberships` (`role`,`status`);