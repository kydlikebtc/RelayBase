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
    index("payment_orders_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const endpointCatalog = sqliteTable(
  "endpoint_catalog",
  {
    path: text("path").primaryKey(),
    platform: text("platform").notNull(),
    upstreamPriceUsdMicros: integer("upstream_price_usd_micros").notNull(),
    customerPriceUsdMicros: integer("customer_price_usd_micros").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    readOnly: integer("read_only", { mode: "boolean" }).notNull().default(true),
    sourceUpdatedAt: text("source_updated_at"),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("endpoint_catalog_platform_enabled_idx").on(
      table.platform,
      table.enabled,
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
