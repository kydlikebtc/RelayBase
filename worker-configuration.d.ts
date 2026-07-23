/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    TIKHUB_API_KEY?: string;
    TIKHUB_BASE_URL?: string;
    RESELLER_AUTHORIZED?: string;
    PAYMENT_PROVIDER?: string;
    NOWPAYMENTS_API_KEY?: string;
    NOWPAYMENTS_IPN_SECRET?: string;
    CRYPTO_PAYMENTS_ENABLED?: string;
    LEGAL_REVIEW_CONFIRMED?: string;
    PUBLIC_APP_URL?: string;
    DEFAULT_REQUEST_COST_USD_MICROS?: string;
    API_RATE_LIMIT_RPM?: string;
    UPSTREAM_TIMEOUT_MS?: string;
    CATALOG_SYNC_SECRET?: string;
    PRICE_MARKUP_BPS?: string;
  }
}
