import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    rateLimitRpm: integer("rate_limit_rpm").notNull().default(60),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("api_keys_hash_unique").on(table.keyHash),
    index("api_keys_user_idx").on(table.userId),
  ],
);

export const authIdentities = sqliteTable(
  "auth_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    email: text("email"),
    walletAddress: text("wallet_address"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("auth_identities_provider_subject_unique").on(
      table.provider,
      table.subject,
    ),
    index("auth_identities_user_idx").on(table.userId),
  ],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("auth_sessions_user_idx").on(table.userId),
    index("auth_sessions_expires_idx").on(table.expiresAt),
  ],
);

export const authChallenges = sqliteTable(
  "auth_challenges",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    verifier: text("verifier"),
    subjectHint: text("subject_hint"),
    message: text("message"),
    returnTo: text("return_to").notNull().default("/console"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
  },
  (table) => [
    index("auth_challenges_expiry_idx").on(
      table.provider,
      table.expiresAt,
    ),
  ],
);

export const authRateLimitBuckets = sqliteTable(
  "auth_rate_limit_buckets",
  {
    scope: text("scope").notNull(),
    minuteBucket: text("minute_bucket").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("auth_rate_limit_bucket_unique").on(
      table.scope,
      table.minuteBucket,
    ),
    index("auth_rate_limit_bucket_updated_idx").on(table.updatedAt),
  ],
);

export const balanceLedger = sqliteTable(
  "balance_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entryType: text("entry_type").notNull(),
    deltaUsdMicros: integer("delta_usd_micros").notNull(),
    referenceId: text("reference_id").notNull(),
    description: text("description"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("balance_ledger_reference_unique").on(table.referenceId),
    index("balance_ledger_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const paymentOrders = sqliteTable(
  "payment_orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("nowpayments"),
    providerPaymentId: text("provider_payment_id"),
    idempotencyHash: text("idempotency_hash"),
    amountUsdMicros: integer("amount_usd_micros").notNull(),
    payCurrency: text("pay_currency").notNull(),
    payAmount: text("pay_amount"),
    payAddress: text("pay_address"),
    invoiceUrl: text("invoice_url"),
    status: text("status").notNull().default("creating"),
    creditedUsdMicros: integer("credited_usd_micros").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("payment_orders_provider_id_unique").on(
      table.providerPaymentId,
    ),
    uniqueIndex("payment_orders_user_idempotency_unique").on(
      table.userId,
      table.idempotencyHash,
    ),
    index("payment_orders_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("payment_orders_provider_status_updated_idx").on(
      table.provider,
      table.status,
      table.updatedAt,
    ),
  ],
);

export const paymentEvents = sqliteTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull().default("nowpayments"),
    providerPaymentId: text("provider_payment_id").notNull(),
    orderId: text("order_id").notNull(),
    paymentStatus: text("payment_status").notNull(),
    payloadJson: text("payload_json").notNull(),
    payloadHash: text("payload_hash").notNull(),
    receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    processedAt: text("processed_at"),
    processingError: text("processing_error"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: text("last_attempt_at"),
    nextAttemptAt: text("next_attempt_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("payment_events_payload_unique").on(
      table.provider,
      table.payloadHash,
    ),
    index("payment_events_unprocessed_idx").on(
      table.provider,
      table.processedAt,
      table.nextAttemptAt,
      table.receivedAt,
    ),
  ],
);

export const paymentReviewCases = sqliteTable(
  "payment_review_cases",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => paymentOrders.id, { onDelete: "cascade" }),
    providerPaymentId: text("provider_payment_id").notNull(),
    parentPaymentId: text("parent_payment_id"),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("open"),
    actuallyPaid: text("actually_paid"),
    payCurrency: text("pay_currency"),
    evidenceJson: text("evidence_json").notNull(),
    resolutionAction: text("resolution_action"),
    resolutionCreditUsdMicros: integer("resolution_credit_usd_micros"),
    resolutionRequestHash: text("resolution_request_hash"),
    resolutionNote: text("resolution_note"),
    resolutionReference: text("resolution_reference"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    uniqueIndex("payment_review_provider_unique").on(
      table.providerPaymentId,
    ),
    index("payment_review_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    index("payment_review_order_idx").on(table.orderId),
  ],
);

export const adminAuditLogs = sqliteTable(
  "admin_audit_logs",
  {
    id: text("id").primaryKey(),
    actorFingerprint: text("actor_fingerprint").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    detailsJson: text("details_json"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("admin_audit_created_idx").on(table.createdAt),
    index("admin_audit_target_idx").on(
      table.targetType,
      table.targetId,
    ),
  ],
);

export const operationHeartbeats = sqliteTable("operation_heartbeats", {
  name: text("name").primaryKey(),
  lastSuccessAt: text("last_success_at").notNull(),
  detailsJson: text("details_json"),
});

export const upstreamCredentials = sqliteTable(
  "upstream_credentials",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull().default("tikhub"),
    label: text("label").notNull(),
    encryptedSecret: text("encrypted_secret").notNull(),
    secretHash: text("secret_hash").notNull(),
    verifiedScopesJson: text("verified_scopes_json"),
    expiresAt: text("expires_at"),
    verifiedAt: text("verified_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("upstream_credentials_provider_hash_unique").on(
      table.provider,
      table.secretHash,
    ),
    index("upstream_credentials_provider_created_idx").on(
      table.provider,
      table.createdAt,
    ),
  ],
);

export const upstreamCredentialState = sqliteTable(
  "upstream_credential_state",
  {
    provider: text("provider").primaryKey(),
    managedEnabled: integer("managed_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    activeCredentialId: text("active_credential_id").references(
      () => upstreamCredentials.id,
      { onDelete: "restrict" },
    ),
    version: integer("version").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("upstream_credential_state_active_unique").on(
      table.activeCredentialId,
    ),
  ],
);

export const paymentRateLimitBuckets = sqliteTable(
  "payment_rate_limit_buckets",
  {
    scope: text("scope").notNull(),
    minuteBucket: text("minute_bucket").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("payment_rate_limit_bucket_unique").on(
      table.scope,
      table.minuteBucket,
    ),
    index("payment_rate_limit_bucket_updated_idx").on(table.updatedAt),
  ],
);

export const endpointCatalog = sqliteTable(
  "endpoint_catalog",
  {
    path: text("path").primaryKey(),
    platform: text("platform").notNull(),
    httpMethod: text("http_method").notNull().default("GET"),
    summary: text("summary"),
    description: text("description"),
    parameterSchemaJson: text("parameter_schema_json"),
    upstreamPriceUsdMicros: integer("upstream_price_usd_micros").notNull(),
    customerPriceUsdMicros: integer("customer_price_usd_micros").notNull(),
    priceVerified: integer("price_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    readOnly: integer("read_only", { mode: "boolean" }).notNull().default(true),
    sourceUpdatedAt: text("source_updated_at"),
    syncGeneration: text("sync_generation"),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("endpoint_catalog_platform_enabled_idx").on(
      table.platform,
      table.enabled,
    ),
    index("endpoint_catalog_enabled_read_only_idx").on(
      table.enabled,
      table.readOnly,
    ),
  ],
);

export const catalogSyncLocks = sqliteTable("catalog_sync_locks", {
  id: integer("id").primaryKey(),
  generation: text("generation").notNull(),
  lockedAt: text("locked_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const catalogSyncState = sqliteTable("catalog_sync_state", {
  id: integer("id").primaryKey(),
  lastSuccessGeneration: text("last_success_generation").notNull(),
  credentialSource: text("credential_source"),
  credentialId: text("credential_id"),
  credentialFingerprint: text("credential_fingerprint"),
  credentialStateVersion: integer("credential_state_version"),
  syncedAt: text("synced_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const catalogSyncStaging = sqliteTable(
  "catalog_sync_staging",
  {
    id: text("id").primaryKey(),
    generation: text("generation").notNull(),
    path: text("path").notNull(),
    platform: text("platform").notNull(),
    httpMethod: text("http_method").notNull(),
    summary: text("summary"),
    description: text("description"),
    parameterSchemaJson: text("parameter_schema_json"),
    upstreamPriceUsdMicros: integer("upstream_price_usd_micros").notNull(),
    suggestedCustomerPriceUsdMicros: integer(
      "suggested_customer_price_usd_micros",
    ).notNull(),
    priceVerified: integer("price_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    looksReadOnly: integer("looks_read_only", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("catalog_sync_staging_generation_idx").on(table.generation),
  ],
);

export const rateLimitBuckets = sqliteTable(
  "rate_limit_buckets",
  {
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    minuteBucket: text("minute_bucket").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("rate_limit_bucket_unique").on(
      table.apiKeyId,
      table.minuteBucket,
    ),
    index("rate_limit_bucket_updated_idx").on(table.updatedAt),
  ],
);

export const upstreamRateLimitBuckets = sqliteTable(
  "upstream_rate_limit_buckets",
  {
    endpointPath: text("endpoint_path").notNull(),
    secondBucket: text("second_bucket").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("upstream_rate_limit_bucket_unique").on(
      table.endpointPath,
      table.secondBucket,
    ),
    index("upstream_rate_limit_bucket_updated_idx").on(table.updatedAt),
  ],
);

export const proxyRequests = sqliteTable(
  "proxy_requests",
  {
    id: text("id").primaryKey(),
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    idempotencyHash: text("idempotency_hash").notNull(),
    ledgerReferenceId: text("ledger_reference_id").notNull(),
    path: text("path").notNull(),
    status: text("status").notNull().default("processing"),
    costUsdMicros: integer("cost_usd_micros").notNull(),
    responseStatus: integer("response_status"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("proxy_requests_key_idempotency_unique").on(
      table.apiKeyId,
      table.idempotencyHash,
    ),
    uniqueIndex("proxy_requests_ledger_reference_unique").on(
      table.ledgerReferenceId,
    ),
    index("proxy_requests_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);

export const apiCalls = sqliteTable(
  "api_calls",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "restrict" }),
    method: text("method").notNull(),
    upstreamPath: text("upstream_path").notNull(),
    platform: text("platform").notNull(),
    statusCode: integer("status_code").notNull(),
    costUsdMicros: integer("cost_usd_micros").notNull(),
    upstreamCostUsdMicros: integer("upstream_cost_usd_micros")
      .notNull()
      .default(0),
    latencyMs: integer("latency_ms").notNull(),
    refunded: integer("refunded", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("api_calls_user_created_idx").on(table.userId, table.createdAt),
    index("api_calls_key_created_idx").on(table.apiKeyId, table.createdAt),
  ],
);
