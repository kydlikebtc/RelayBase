/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    UPSTREAM_API_KEY?: string;
    UPSTREAM_CREDENTIALS_ENCRYPTION_KEY?: string;
    UPSTREAM_BASE_URL?: string;
    RESELLER_AUTHORIZED?: string;
    PAYMENT_PROVIDER?: string;
    NOWPAYMENTS_API_KEY?: string;
    NOWPAYMENTS_IPN_SECRET?: string;
    CRYPTO_PAYMENTS_ENABLED?: string;
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED?: string;
    LEGAL_REVIEW_CONFIRMED?: string;
    PUBLIC_APP_URL?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    WALLET_LOGIN_ENABLED?: string;
    AUTH_SESSION_TTL_DAYS?: string;
    TRUST_SITES_IDENTITY_HEADERS?: string;
    API_RATE_LIMIT_RPM?: string;
    UPSTREAM_RATE_LIMIT_RPS?: string;
    ACCOUNT_CONCURRENCY_LIMIT?: string;
    UPSTREAM_TIMEOUT_MS?: string;
    UPSTREAM_MAX_RESPONSE_BYTES?: string;
    PAYMENT_CREATE_LIMIT_PER_MINUTE?: string;
    PAYMENT_PROVIDER_LIMIT_PER_MINUTE?: string;
    CATALOG_SYNC_SECRET?: string;
    RECONCILIATION_SECRET?: string;
    PAYMENT_ADMIN_SECRET?: string;
    ADMIN_MASTER_SECRET?: string;
    PRICE_MARKUP_BPS?: string;
  }
}
