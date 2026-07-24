import { sql } from "drizzle-orm";
import {
  check,
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

export const upstreamSourceConfig = sqliteTable(
  "upstream_source_config",
  {
    id: integer("id").primaryKey(),
    enabled: integer("enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    version: integer("version").notNull().default(0),
    configHash: text("config_hash").notNull(),
    sourceOrigin: text("source_origin").notNull(),
    apiPathPrefix: text("api_path_prefix").notNull(),
    openApiPath: text("openapi_path").notNull(),
    catalogPath: text("catalog_path").notNull(),
    credentialPath: text("credential_path").notNull(),
    catalogAuthMode: text("catalog_auth_mode").notNull(),
    publicExcludedPrefixesJson: text("public_excluded_prefixes_json")
      .notNull()
      .default("[]"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check("upstream_source_config_singleton", sql`${table.id} = 1`),
  ],
);

export const upstreamCredentials = sqliteTable(
  "upstream_credentials",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull().default("primary"),
    label: text("label").notNull(),
    encryptedSecret: text("encrypted_secret").notNull(),
    secretHash: text("secret_hash").notNull(),
    verifiedScopesJson: text("verified_scopes_json"),
    verifiedConfigHash: text("verified_config_hash"),
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
    dataType: text("data_type").notNull().default("other"),
    tagsJson: text("tags_json").notNull().default("[]"),
    surface: text("surface").notNull().default("other"),
    operationId: text("operation_id"),
    summary: text("summary"),
    description: text("description"),
    parameterSchemaJson: text("parameter_schema_json"),
    upstreamPriceUsdMicros: integer("upstream_price_usd_micros").notNull(),
    customerPriceUsdMicros: integer("customer_price_usd_micros").notNull(),
    priceVerified: integer("price_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    readOnly: integer("read_only", { mode: "boolean" }).notNull().default(false),
    safetyClassification: text("safety_classification")
      .notNull()
      .default("ambiguous"),
    safetyReasonsJson: text("safety_reasons_json"),
    safetyPolicyVersion: integer("safety_policy_version")
      .notNull()
      .default(1),
    revision: integer("revision").notNull().default(0),
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
    index("endpoint_catalog_data_type_enabled_idx").on(
      table.dataType,
      table.enabled,
    ),
    index("endpoint_catalog_surface_enabled_idx").on(
      table.surface,
      table.enabled,
    ),
  ],
);

export const catalogUnresolvedEndpoints = sqliteTable(
  "catalog_unresolved_endpoints",
  {
    path: text("path").primaryKey(),
    platform: text("platform").notNull(),
    dataType: text("data_type").notNull().default("other"),
    surface: text("surface").notNull().default("other"),
    summary: text("summary"),
    upstreamPriceUsdMicros: integer("upstream_price_usd_micros").notNull(),
    customerPriceUsdMicros: integer("customer_price_usd_micros").notNull(),
    priceVerified: integer("price_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    rateLimitRaw: text("rate_limit_raw"),
    rateLimitRps: integer("rate_limit_rps"),
    freeCredit: integer("free_credit", { mode: "boolean" }),
    volumeDiscount: integer("volume_discount", { mode: "boolean" }),
    sourceType: text("source_type"),
    sourceOwner: text("source_owner"),
    syncGeneration: text("sync_generation"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("catalog_unresolved_endpoints_platform_idx").on(table.platform),
    index("catalog_unresolved_endpoints_generation_idx").on(
      table.syncGeneration,
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
  sourceConfigVersion: integer("source_config_version"),
  sourceConfigHash: text("source_config_hash"),
  openApiVersion: text("openapi_version"),
  openApiOperationCount: integer("openapi_operation_count"),
  rawPriceRowCount: integer("raw_price_row_count"),
  normalizedPriceCount: integer("normalized_price_count"),
  openApiPriceMappedCount: integer("openapi_price_mapped_count"),
  priceOnlyCount: integer("price_only_count"),
  openApiOnlyCount: integer("openapi_only_count"),
  scopeExcludedCount: integer("scope_excluded_count"),
  matchedPriceCount: integer("matched_price_count"),
  positivePriceCount: integer("positive_price_count"),
  zeroPriceCount: integer("zero_price_count"),
  awaitingPriceCount: integer("awaiting_price_count"),
  openApiSnapshotHash: text("openapi_snapshot_hash"),
  priceSnapshotHash: text("price_snapshot_hash"),
  syncedAt: text("synced_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const catalogBatchPlans = sqliteTable(
  "catalog_batch_plans",
  {
    id: text("id").primaryKey(),
    actorFingerprint: text("actor_fingerprint").notNull(),
    previewIdempotencyHash: text("preview_idempotency_hash").notNull(),
    previewRequestHash: text("preview_request_hash").notNull(),
    policyVersion: integer("policy_version").notNull(),
    action: text("action").notNull(),
    status: text("status").notNull().default("preparing"),
    version: integer("version").notNull().default(0),
    filterPlatform: text("filter_platform"),
    filterQuery: text("filter_query"),
    filterStatus: text("filter_status").notNull(),
    filterSafety: text("filter_safety").notNull(),
    selectorJson: text("selector_json").notNull(),
    mutationJson: text("mutation_json").notNull(),
    markupBps: integer("markup_bps"),
    minimumCustomerPriceUsdMicros: integer(
      "minimum_customer_price_usd_micros",
    ),
    catalogGeneration: text("catalog_generation").notNull(),
    credentialSource: text("credential_source"),
    credentialId: text("credential_id"),
    credentialFingerprint: text("credential_fingerprint"),
    credentialStateVersion: integer("credential_state_version"),
    openApiSnapshotHash: text("openapi_snapshot_hash").notNull(),
    priceSnapshotHash: text("price_snapshot_hash").notNull(),
    matchedCount: integer("matched_count").notNull(),
    selectedCount: integer("selected_count").notNull(),
    excludedStaleCount: integer("excluded_stale_count").notNull(),
    excludedUnverifiedCount: integer(
      "excluded_unverified_count",
    ).notNull(),
    excludedUnsafeCount: integer("excluded_unsafe_count").notNull(),
    noChangeCount: integer("no_change_count").notNull(),
    priceIncreaseCount: integer("price_increase_count").notNull(),
    priceDecreaseCount: integer("price_decrease_count").notNull(),
    priceUnchangedCount: integer("price_unchanged_count").notNull(),
    blockedCount: integer("blocked_count").notNull(),
    upstreamTotalUsdMicros: integer(
      "upstream_total_usd_micros",
    ).notNull(),
    beforeCustomerTotalUsdMicros: integer(
      "before_customer_total_usd_micros",
    ).notNull(),
    afterCustomerTotalUsdMicros: integer(
      "after_customer_total_usd_micros",
    ).notNull(),
    targetDigest: text("target_digest").notNull(),
    beforeDigest: text("before_digest").notNull(),
    afterDigest: text("after_digest").notNull(),
    confirmationText: text("confirmation_text").notNull(),
    applyIdempotencyHash: text("apply_idempotency_hash"),
    applyRequestHash: text("apply_request_hash"),
    applyResultJson: text("apply_result_json"),
    appliedCount: integer("applied_count"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    previewedAt: text("previewed_at"),
    expiresAt: text("expires_at").notNull(),
    applyStartedAt: text("apply_started_at"),
    appliedAt: text("applied_at"),
  },
  (table) => [
    uniqueIndex("catalog_batch_plans_preview_idempotency_unique").on(
      table.previewIdempotencyHash,
    ),
    uniqueIndex("catalog_batch_plans_apply_idempotency_unique").on(
      table.applyIdempotencyHash,
    ),
    index("catalog_batch_plans_actor_created_idx").on(
      table.actorFingerprint,
      table.createdAt,
    ),
    index("catalog_batch_plans_status_expires_idx").on(
      table.status,
      table.expiresAt,
    ),
  ],
);

export const catalogBatchPlanItems = sqliteTable(
  "catalog_batch_plan_items",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => catalogBatchPlans.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    ordinal: integer("ordinal").notNull(),
    platform: text("platform").notNull(),
    httpMethod: text("http_method").notNull(),
    dataType: text("data_type").notNull().default("other"),
    tagsJson: text("tags_json").notNull().default("[]"),
    surface: text("surface").notNull().default("other"),
    operationId: text("operation_id"),
    summary: text("summary"),
    expectedRevision: integer("expected_revision").notNull(),
    originalUpstreamPriceUsdMicros: integer(
      "original_upstream_price_usd_micros",
    ).notNull(),
    originalCustomerPriceUsdMicros: integer(
      "original_customer_price_usd_micros",
    ).notNull(),
    originalPriceVerified: integer("original_price_verified", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    originalEnabled: integer("original_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    originalReadOnly: integer("original_read_only", { mode: "boolean" })
      .notNull()
      .default(false),
    originalSyncGeneration: text("original_sync_generation"),
    originalReviewedAt: text("original_reviewed_at"),
    originalUpdatedAt: text("original_updated_at").notNull(),
    targetCustomerPriceUsdMicros: integer(
      "target_customer_price_usd_micros",
    ).notNull(),
    targetEnabled: integer("target_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    targetReadOnly: integer("target_read_only", { mode: "boolean" })
      .notNull()
      .default(false),
    willChange: integer("will_change", { mode: "boolean" })
      .notNull()
      .default(false),
    blockerCode: text("blocker_code"),
    itemDigest: text("item_digest").notNull(),
  },
  (table) => [
    uniqueIndex("catalog_batch_plan_items_plan_path_unique").on(
      table.planId,
      table.path,
    ),
    uniqueIndex("catalog_batch_plan_items_plan_ordinal_unique").on(
      table.planId,
      table.ordinal,
    ),
    index("catalog_batch_plan_items_plan_idx").on(table.planId),
  ],
);

export const catalogSyncStaging = sqliteTable(
  "catalog_sync_staging",
  {
    id: text("id").primaryKey(),
    generation: text("generation").notNull(),
    path: text("path").notNull(),
    platform: text("platform").notNull(),
    httpMethod: text("http_method").notNull(),
    dataType: text("data_type").notNull().default("other"),
    tagsJson: text("tags_json").notNull().default("[]"),
    surface: text("surface").notNull().default("other"),
    operationId: text("operation_id"),
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
    safetyClassification: text("safety_classification")
      .notNull()
      .default("ambiguous"),
    safetyReasonsJson: text("safety_reasons_json"),
    safetyPolicyVersion: integer("safety_policy_version")
      .notNull()
      .default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("catalog_sync_staging_generation_idx").on(table.generation),
    uniqueIndex("catalog_sync_staging_generation_path_unique").on(
      table.generation,
      table.path,
    ),
  ],
);

export const catalogUnresolvedStaging = sqliteTable(
  "catalog_unresolved_staging",
  {
    id: text("id").primaryKey(),
    syncGeneration: text("sync_generation").notNull(),
    path: text("path").notNull(),
    platform: text("platform").notNull(),
    dataType: text("data_type").notNull().default("other"),
    surface: text("surface").notNull().default("other"),
    summary: text("summary"),
    upstreamPriceUsdMicros: integer("upstream_price_usd_micros").notNull(),
    customerPriceUsdMicros: integer("customer_price_usd_micros").notNull(),
    priceVerified: integer("price_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    rateLimitRaw: text("rate_limit_raw"),
    rateLimitRps: integer("rate_limit_rps"),
    freeCredit: integer("free_credit", { mode: "boolean" }),
    volumeDiscount: integer("volume_discount", { mode: "boolean" }),
    sourceType: text("source_type"),
    sourceOwner: text("source_owner"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("catalog_unresolved_staging_generation_idx").on(
      table.syncGeneration,
    ),
    uniqueIndex("catalog_unresolved_staging_generation_path_unique").on(
      table.syncGeneration,
      table.path,
    ),
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
