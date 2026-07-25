import { recoverMessageAddress } from "viem";
import packageJson from "../package.json";
import {
  PROVIDER_DATA_TYPES,
  PROVIDER_SURFACES,
  providerDataTypeFor,
  providerSurfaceForPath,
} from "../shared/provider-taxonomy.mjs";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const SESSION_COOKIE = "rb_session";
const OAUTH_STATE_COOKIE = "rb_oauth_state";
const MAX_DASHBOARD_BODY_BYTES = 16 * 1024;
const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
const MAX_CATALOG_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_OPENAPI_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_OPENAPI_INPUT_SCHEMA_BYTES = 16 * 1024;
const MAX_OPENAPI_REFERENCE_DEPTH = 16;
const MAX_OPENAPI_REFERENCE_NODES = 4_000;
const MAX_OPENAPI_REFERENCE_BYTES = 64 * 1024;
const MAX_OPENAPI_REFERENCE_STRING_BYTES = 16 * 1024;
const MAX_OPENAPI_REFERENCE_ITEMS = 1_000;
const MAX_OPENAPI_REFERENCES = 512;
const MAX_PROXY_BODY_BYTES = 256 * 1024;
const CATALOG_SAFETY_POLICY_VERSION = 1;
const PRIMARY_UPSTREAM_PROVIDER = "primary";
const MAX_CATALOG_BATCH_TARGETS = 2_000;
const MAX_CATALOG_BATCH_PUBLISH_TARGETS = 500;
const CATALOG_BATCH_TTL_MINUTES = 30;
const PAYMENT_AMOUNTS = new Set([10, 25, 50, 100]);
const PAYMENT_CURRENCIES = new Set([
  "usdttrc20",
  "usdterc20",
  "usdtbsc",
  "usdcbase",
  "usdcpolygon",
  "usdcsol",
]);
const NOWPAYMENTS_STATUSES = new Set([
  "waiting",
  "confirming",
  "confirmed",
  "sending",
  "partially_paid",
  "finished",
  "failed",
  "refunded",
  "expired",
]);
const NOWPAYMENTS_REVIEW_CREDITABLE_STATUSES = new Set([
  "finished",
]);
const CATALOG_COVERAGE_WHERE = `
  openapi_operation_count BETWEEN 1 AND 5000
  AND raw_price_row_count BETWEEN 1 AND 100000
  AND normalized_price_count BETWEEN 1 AND raw_price_row_count
  AND openapi_price_mapped_count BETWEEN 1 AND normalized_price_count
  AND openapi_price_mapped_count <= openapi_operation_count
  AND price_only_count = normalized_price_count -
      openapi_price_mapped_count
  AND openapi_only_count = openapi_operation_count -
      openapi_price_mapped_count
  AND scope_excluded_count BETWEEN 0 AND openapi_price_mapped_count
  AND matched_price_count = openapi_price_mapped_count -
      scope_excluded_count
  AND matched_price_count >= 1
  AND positive_price_count BETWEEN 0 AND matched_price_count
  AND zero_price_count BETWEEN 0 AND matched_price_count
  AND positive_price_count + zero_price_count = matched_price_count
  AND awaiting_price_count BETWEEN 0 AND openapi_operation_count
  AND matched_price_count + awaiting_price_count =
      openapi_operation_count
  AND length(openapi_snapshot_hash) = 64
  AND openapi_snapshot_hash NOT GLOB '*[^0-9a-f]*'
  AND length(price_snapshot_hash) = 64
  AND price_snapshot_hash NOT GLOB '*[^0-9a-f]*'
`;
const CATALOG_DATA_TYPE_SQL_VALUES =
  "'account','analytics_trends','comments','commerce_marketing'," +
  "'content','email','live','media_download','profile_creator'," +
  "'search_discovery','social_graph','system','taxonomy','utility','other'";
const CATALOG_SURFACE_SQL_VALUES = "'app','web','app_web','other'";

function catalogTaxonomyValidWhere(alias: string): string {
  const safeTags =
    `CASE WHEN json_valid(${alias}.tags_json) ` +
    `AND json_type(${alias}.tags_json) = 'array' ` +
    `THEN ${alias}.tags_json ELSE '[]' END`;
  return `
    ${alias}.data_type IN (${CATALOG_DATA_TYPE_SQL_VALUES})
    AND ${alias}.surface IN (${CATALOG_SURFACE_SQL_VALUES})
    AND json_valid(${alias}.tags_json)
    AND json_type(${alias}.tags_json) = 'array'
    AND json_array_length(${alias}.tags_json) BETWEEN 0 AND 100
    AND NOT EXISTS (
      SELECT 1 FROM json_each(${safeTags}) AS taxonomy_tag
      WHERE taxonomy_tag.type != 'text'
        OR length(taxonomy_tag.value) NOT BETWEEN 1 AND 160
        OR trim(taxonomy_tag.value) != taxonomy_tag.value
    )
    AND (
      SELECT COUNT(*) FROM json_each(${safeTags})
    ) = (
      SELECT COUNT(DISTINCT taxonomy_tag.value)
      FROM json_each(${safeTags}) AS taxonomy_tag
    )
    AND (
      ${alias}.operation_id IS NULL
      OR length(${alias}.operation_id) BETWEEN 1 AND 500
    )
  `;
}

export interface PlatformEnv {
  DB?: D1Database;
  UPSTREAM_API_KEY?: string;
  UPSTREAM_CREDENTIALS_ENCRYPTION_KEY?: string;
  UPSTREAM_ALLOWED_ORIGINS?: string;
  RESELLER_AUTHORIZED?: string;
  PAYMENT_PROVIDER?: string;
  NOWPAYMENTS_API_KEY?: string;
  NOWPAYMENTS_IPN_SECRET?: string;
  CRYPTO_PAYMENTS_ENABLED?: string;
  UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED?: string;
  LEGAL_REVIEW_CONFIRMED?: string;
  PUBLIC_APP_URL?: string;
  API_RATE_LIMIT_RPM?: string;
  UPSTREAM_TIMEOUT_MS?: string;
  UPSTREAM_MAX_RESPONSE_BYTES?: string;
  CATALOG_SYNC_SECRET?: string;
  RECONCILIATION_SECRET?: string;
  PAYMENT_ADMIN_SECRET?: string;
  ADMIN_MASTER_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  WALLET_LOGIN_ENABLED?: string;
  AUTH_SESSION_TTL_DAYS?: string;
  TRUST_SITES_IDENTITY_HEADERS?: string;
  PRICE_MARKUP_BPS?: string;
  UPSTREAM_RATE_LIMIT_RPS?: string;
  ACCOUNT_CONCURRENCY_LIMIT?: string;
  PAYMENT_CREATE_LIMIT_PER_MINUTE?: string;
  PAYMENT_PROVIDER_LIMIT_PER_MINUTE?: string;
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  provider: "google" | "wallet" | "chatgpt";
  walletAddress: string | null;
};

type ApiKeyRecord = {
  id: string;
  user_id: string;
  rate_limit_rpm: number;
};

type CatalogRecord = {
  path: string;
  platform: string;
  http_method: string;
  data_type: CatalogDataType;
  tags_json: string;
  surface: MarketplaceSurface;
  operation_id: string | null;
  upstream_price_usd_micros: number;
  customer_price_usd_micros: number;
  price_verified: number;
  enabled: number;
  read_only: number;
  safety_classification:
    | "safe_data_read"
    | "ambiguous"
    | "prohibited";
  safety_policy_version: number;
  sync_generation: string | null;
  coverage_verified: number;
};

type MarketplaceSurface = "app" | "web" | "app_web" | "other";
type CatalogDataType =
  | "account"
  | "analytics_trends"
  | "comments"
  | "commerce_marketing"
  | "content"
  | "email"
  | "live"
  | "media_download"
  | "profile_creator"
  | "search_discovery"
  | "social_graph"
  | "system"
  | "taxonomy"
  | "utility"
  | "other";
type MarketplaceAvailability = "available" | "pending" | "restricted";
type MarketplaceDocumentationStatus = "complete" | "pending";

type MarketplaceReferenceEndpoint = {
  id: string;
  path: string;
  platform: string;
  dataType: string;
  method: "GET" | "POST" | null;
  surface: MarketplaceSurface;
  categories: string[];
  summary: string | null;
  description: string | null;
  parameters: Record<string, unknown>[];
  requestBody: Record<string, unknown> | null;
  documentationStatus: MarketplaceDocumentationStatus;
};

type MarketplaceReference = {
  catalog: {
    revision: string | null;
    updatedAt: string | null;
    complete: boolean;
    serviceCount: number;
  };
  stats: {
    total: number;
    get: number;
    post: number;
    platforms: number;
    dataTypes: number;
  };
  endpoints: MarketplaceReferenceEndpoint[];
};

type MarketplaceCatalogOverlay = {
  path: string;
  platform: string;
  http_method: string;
  data_type: CatalogDataType;
  tags_json: string;
  surface: MarketplaceSurface;
  operation_id: string | null;
  summary: string | null;
  description: string | null;
  parameter_schema_json: string | null;
  customer_price_usd_micros: number;
  price_verified: number;
  enabled: number;
  read_only: number;
  safety_classification: CatalogSafetyClassification;
  safety_policy_version: number;
  updated_at: string;
  catalog_openapi_snapshot_hash: string | null;
  catalog_openapi_operation_count: number | null;
  catalog_price_only_count: number | null;
  catalog_generation: string | null;
};

type MarketplaceUnresolvedOverlay = {
  path: string;
  platform: string;
  data_type: CatalogDataType;
  surface: MarketplaceSurface;
  summary: string | null;
  customer_price_usd_micros: number;
  price_verified: number;
  rate_limit_rps: number | null;
  updated_at: string;
  sync_generation: string;
};

type MarketplaceOverlayRow = {
  path: string;
  platform: string;
  httpMethod: "GET" | "POST" | null;
  dataType: CatalogDataType;
  tags: string[];
  surface: MarketplaceSurface;
  operationId: string | null;
  summary: string | null;
  description: string | null;
  parameterSchema: unknown;
  customerPriceUsdMicros: number;
  priceVerified: boolean;
  enabled: boolean;
  readOnly: boolean;
  safetyClassification: CatalogSafetyClassification;
  safetyPolicyVersion: number;
  rateLimitRps: number | null;
  updatedAt: string;
  documentationStatus: MarketplaceDocumentationStatus;
};

type UpstreamSourceConfigRecord = {
  id: number;
  enabled: number;
  version: number;
  config_hash: string;
  source_origin: string;
  api_path_prefix: string;
  openapi_path: string;
  catalog_path: string;
  credential_path: string;
  catalog_auth_mode: "none" | "optional" | "required";
  public_excluded_prefixes_json: string;
  updated_at: string;
};

type UpstreamSourceConfig = {
  enabled: boolean;
  version: number;
  hash: string;
  origin: string;
  apiPathPrefix: string;
  openApiPath: string;
  catalogPath: string;
  credentialPath: string;
  catalogAuthMode: "none" | "optional" | "required";
  publicExcludedPrefixes: string[];
  updatedAt: string;
};

type CatalogSafetyClassification =
  | "safe_data_read"
  | "ambiguous"
  | "prohibited";

type CatalogSafetyAssessment = {
  classification: CatalogSafetyClassification;
  reasons: string[];
};

type CatalogBatchAction = "publish" | "reprice" | "disable";
type CatalogBatchStatus =
  | "preparing"
  | "ready"
  | "blocked"
  | "applying"
  | "applied"
  | "stale"
  | "expired";

type CatalogBatchPlanRecord = {
  id: string;
  actor_fingerprint: string;
  preview_idempotency_hash: string;
  preview_request_hash: string;
  policy_version: number;
  action: CatalogBatchAction;
  status: CatalogBatchStatus;
  version: number;
  filter_platform: string | null;
  filter_query: string | null;
  filter_status: string;
  filter_safety: string;
  selector_json: string;
  mutation_json: string;
  markup_bps: number | null;
  minimum_customer_price_usd_micros: number | null;
  catalog_generation: string;
  credential_source: string | null;
  credential_id: string | null;
  credential_fingerprint: string | null;
  credential_state_version: number | null;
  openapi_snapshot_hash: string;
  price_snapshot_hash: string;
  matched_count: number;
  selected_count: number;
  excluded_stale_count: number;
  excluded_unverified_count: number;
  excluded_unsafe_count: number;
  no_change_count: number;
  price_increase_count: number;
  price_decrease_count: number;
  price_unchanged_count: number;
  blocked_count: number;
  upstream_total_usd_micros: number;
  before_customer_total_usd_micros: number;
  after_customer_total_usd_micros: number;
  target_digest: string;
  before_digest: string;
  after_digest: string;
  confirmation_text: string;
  apply_idempotency_hash: string | null;
  apply_request_hash: string | null;
  apply_result_json: string | null;
  applied_count: number | null;
  created_at: string;
  previewed_at: string | null;
  expires_at: string;
  apply_started_at: string | null;
  applied_at: string | null;
};

type CatalogBatchItemRecord = {
  path: string;
  ordinal: number;
  platform: string;
  http_method: string;
  data_type: CatalogDataType;
  tags_json: string;
  surface: MarketplaceSurface;
  operation_id: string | null;
  summary: string | null;
  expected_revision: number;
  original_upstream_price_usd_micros: number;
  original_customer_price_usd_micros: number;
  original_price_verified: number;
  original_enabled: number;
  original_read_only: number;
  original_sync_generation: string | null;
  original_reviewed_at: string | null;
  original_updated_at: string;
  target_customer_price_usd_micros: number;
  target_enabled: number;
  target_read_only: number;
  will_change: number;
  blocker_code: string | null;
  item_digest: string;
};

type PaymentOrderRecord = {
  id: string;
  user_id: string;
  provider_payment_id: string | null;
  idempotency_hash: string | null;
  amount_usd_micros: number;
  pay_currency: string;
  pay_amount: string | null;
  pay_address: string | null;
  invoice_url: string | null;
  status: string;
  credited_usd_micros: number;
  created_at: string;
  updated_at: string;
};

type ManagedUpstreamCredentialRecord = {
  id: string;
  label: string;
  encrypted_secret: string;
  secret_hash: string;
  verified_scopes_json: string | null;
  verified_config_hash: string | null;
  expires_at: string | null;
  status: "active" | "standby" | "revoked";
  verified_at: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type ResolvedUpstreamProviderCredential = {
  secret: string;
  fingerprint: string;
  source: "managed" | "environment";
  id: string | null;
  scopes: string[] | null;
  expiresAt: string | null;
  stateVersion: number;
  configHash: string;
};

type UpstreamProviderCredentialVerification = {
  scopes: string[];
  expiresAt: string | null;
  configHash: string;
};

type NowPaymentsPayment = {
  payment_id?: string | number;
  payment_status?: string;
  pay_address?: string;
  price_amount?: number | string;
  price_currency?: string;
  pay_amount?: number | string;
  actually_paid?: number | string;
  pay_currency?: string;
  order_id?: string;
  parent_payment_id?: string | number;
  invoice_url?: string;
  updated_at?: string;
};

class PlatformError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function handlePlatformRequest(
  request: Request,
  env: PlatformEnv,
  ctx: WorkerExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  const requestId = crypto.randomUUID();

  try {
    if (
      (url.pathname === "/console" || url.pathname.startsWith("/console/")) &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const redirectResponse = await handleConsolePageGate(request, env);
      if (redirectResponse) return redirectResponse;
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      const readiness = await operationalReadiness(env);
      return jsonResponse(
        {
          ok: true,
          service: "relaybase-api",
          version: packageJson.version,
          ready: readiness.ready,
          mode: readiness.mode,
          capabilities: readiness.capabilities,
          missing: readiness.missing,
          timestamp: new Date().toISOString(),
        },
        200,
        requestId,
      );
    }

    if (url.pathname === "/api/readiness" && request.method === "GET") {
      const readiness = await operationalReadiness(env);
      return jsonResponse(
        {
          ok: readiness.ready,
          service: "relaybase-api",
          version: packageJson.version,
          mode: readiness.mode,
          capabilities: readiness.capabilities,
          missing: readiness.missing,
          timestamp: new Date().toISOString(),
        },
        readiness.ready ? 200 : 503,
        requestId,
      );
    }

    if (url.pathname === "/api/catalog" && request.method === "GET") {
      return await handlePublicCatalog(request, env, requestId);
    }

    if (url.pathname === "/api/marketplace" && request.method === "GET") {
      return await handleMarketplace(request, env, requestId);
    }

    if (
      url.pathname === "/api/marketplace/detail" &&
      request.method === "GET"
    ) {
      return await handleMarketplaceDetail(request, env, requestId);
    }

    if (
      url.pathname === "/api/auth/providers" &&
      request.method === "GET"
    ) {
      return handleAuthProviders(env, requestId);
    }

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      return await handleAuthMe(request, env, requestId);
    }

    if (
      url.pathname === "/api/auth/google/start" &&
      request.method === "GET"
    ) {
      return await handleGoogleAuthStart(request, env);
    }

    if (
      url.pathname === "/api/auth/google/callback" &&
      request.method === "GET"
    ) {
      return await handleGoogleAuthCallback(request, env);
    }

    if (
      url.pathname === "/api/auth/wallet/challenge" &&
      request.method === "POST"
    ) {
      return await handleWalletChallenge(request, env, requestId);
    }

    if (
      url.pathname === "/api/auth/wallet/verify" &&
      request.method === "POST"
    ) {
      return await handleWalletVerify(request, env, requestId);
    }

    if (
      url.pathname === "/api/auth/signout" &&
      request.method === "POST"
    ) {
      return await handleAuthSignOut(request, env, requestId);
    }

    if (
      url.pathname === "/api/payments/nowpayments/ipn" &&
      request.method === "POST"
    ) {
      return await handleNowPaymentsWebhook(request, env, ctx, requestId);
    }

    if (url.pathname === "/api/dashboard" && request.method === "GET") {
      return await handleDashboard(request, env, requestId);
    }

    if (url.pathname === "/api/keys" && request.method === "POST") {
      return await handleCreateApiKey(request, env, requestId);
    }

    if (url.pathname === "/api/keys" && request.method === "DELETE") {
      return await handleRevokeApiKey(request, env, requestId);
    }

    if (url.pathname === "/api/payments" && request.method === "POST") {
      return await handleCreatePayment(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/upstream-credentials" &&
      request.method === "GET"
    ) {
      return await handleUpstreamCredentialsList(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/upstream-credentials" &&
      request.method === "POST"
    ) {
      return await handleUpstreamCredentialCreate(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/upstream-credentials" &&
      request.method === "PATCH"
    ) {
      return await handleUpstreamCredentialUpdate(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/upstream-config" &&
      request.method === "GET"
    ) {
      return await handleUpstreamConfigGet(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/upstream-config" &&
      request.method === "PUT"
    ) {
      return await handleUpstreamConfigPut(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/catalog/sync" &&
      request.method === "POST"
    ) {
      return await handleCatalogSync(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/catalog/batches/preview" &&
      request.method === "POST"
    ) {
      return await handleCatalogBatchPreview(request, env, requestId);
    }

    if (
      /^\/api\/admin\/catalog\/batches\/[^/]+\/apply$/.test(
        url.pathname,
      ) &&
      request.method === "POST"
    ) {
      return await handleCatalogBatchApply(request, env, requestId);
    }

    if (
      /^\/api\/admin\/catalog\/batches\/[^/]+$/.test(url.pathname) &&
      request.method === "GET"
    ) {
      return await handleCatalogBatchGet(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/catalog" &&
      request.method === "GET"
    ) {
      return await handleCatalogList(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/catalog/pending" &&
      request.method === "GET"
    ) {
      return await handlePendingCatalogList(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/catalog/pending" &&
      request.method === "PATCH"
    ) {
      return await handlePendingCatalogPriceUpdate(
        request,
        env,
        requestId,
      );
    }

    if (
      url.pathname === "/api/admin/catalog" &&
      request.method === "PATCH"
    ) {
      return await handleCatalogUpdate(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/catalog/confirm" &&
      request.method === "POST"
    ) {
      return await handleCatalogConfirm(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/overview" &&
      request.method === "GET"
    ) {
      return await handleAdminOverview(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/users" &&
      request.method === "GET"
    ) {
      return await handleAdminUsers(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/users" &&
      request.method === "PATCH"
    ) {
      return await handleAdminUserUpdate(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/payments" &&
      request.method === "GET"
    ) {
      return await handleAdminPayments(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/payments/recover" &&
      request.method === "POST"
    ) {
      return await handleRecoverPayment(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/payment-reviews" &&
      request.method === "GET"
    ) {
      return await handlePaymentReviewList(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/payment-reviews/resolve" &&
      request.method === "POST"
    ) {
      return await handlePaymentReviewResolve(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/audit" &&
      request.method === "GET"
    ) {
      return await handleAdminAuditList(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/reconcile" &&
      request.method === "POST"
    ) {
      return await handleReconciliation(request, env, requestId);
    }

    if (url.pathname.startsWith("/v1/")) {
      return await handleProxyRequest(request, env, ctx, requestId);
    }

    return null;
  } catch (error) {
    if (error instanceof PlatformError) {
      return errorResponse(
        error.status,
        error.code,
        error.message,
        requestId,
      );
    }

    console.error("RelayBase request failed", {
      requestId,
      path: url.pathname,
      error: error instanceof Error ? error.message : "unknown error",
    });
    return errorResponse(
      500,
      "internal_error",
      "服务暂时不可用，请稍后重试。",
      requestId,
    );
  }
}

function handleAuthProviders(
  env: PlatformEnv,
  requestId: string,
): Response {
  return jsonResponse(
    {
      google: {
        enabled:
          hasConfiguredCredential(env.GOOGLE_CLIENT_ID) &&
          hasConfiguredCredential(env.GOOGLE_CLIENT_SECRET),
      },
      wallet: { enabled: env.WALLET_LOGIN_ENABLED === "true" },
      chatgpt: {
        enabled: env.TRUST_SITES_IDENTITY_HEADERS === "true",
      },
    },
    200,
    requestId,
  );
}

async function handleConsolePageGate(
  request: Request,
  env: PlatformEnv,
): Promise<Response | null> {
  const sessionToken = cookieValue(request, SESSION_COOKIE);
  const hasSessionCookie = Boolean(
    sessionToken && /^[A-Za-z0-9_-]{32,160}$/.test(sessionToken),
  );
  const identityEmail = request.headers
    .get(USER_EMAIL_HEADER)
    ?.trim()
    .toLowerCase();
  const hasTrustedIdentity = Boolean(
    env.TRUST_SITES_IDENTITY_HEADERS === "true" &&
      identityEmail &&
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(identityEmail),
  );

  if (!hasSessionCookie && !hasTrustedIdentity) {
    return consoleLoginRedirect(request);
  }

  try {
    await requireAuthenticatedUser(request, requireDb(env), env);
    return null;
  } catch (error) {
    if (
      error instanceof PlatformError &&
      (error.status === 401 || error.status === 403)
    ) {
      return consoleLoginRedirect(
        request,
        error.status === 403 ? "account_suspended" : null,
      );
    }
    throw error;
  }
}

function consoleLoginRedirect(
  request: Request,
  errorCode: string | null = null,
): Response {
  const requestUrl = new URL(request.url);
  const returnToSearch = new URLSearchParams(requestUrl.searchParams);
  returnToSearch.delete("_rsc");
  const returnTo = `${requestUrl.pathname}${
    returnToSearch.size > 0 ? `?${returnToSearch.toString()}` : ""
  }`;
  const location = new URL("/login", request.url);
  location.searchParams.set("return_to", returnTo);
  if (errorCode) location.searchParams.set("error", errorCode);

  return new Response(null, {
    status: 307,
    headers: {
      location: location.toString(),
      "cache-control": "private, no-store",
      vary: [
        "cookie",
        USER_EMAIL_HEADER,
        USER_NAME_HEADER,
        USER_NAME_ENCODING_HEADER,
      ].join(", "),
    },
  });
}

async function handleAuthMe(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  const user = await requireAuthenticatedUser(request, requireDb(env), env);
  return jsonResponse({ user: publicAuthUser(user) }, 200, requestId);
}

async function handleGoogleAuthStart(
  request: Request,
  env: PlatformEnv,
): Promise<Response> {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (
    !hasConfiguredCredential(clientId) ||
    !hasConfiguredCredential(clientSecret)
  ) {
    return oauthFailureRedirect(
      request,
      env,
      "google_not_configured",
      "/console",
    );
  }

  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("return_to"));
  const origin = canonicalAppOrigin(request, env);
  const db = requireDb(env);
  await consumeAuthChallengeRateLimit(db, request, "google", null);
  const challengeId = `auth_${randomBase64Url(24)}`;
  const verifier = randomBase64Url(48);
  const nonce = randomAlphaNumeric(24);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const codeChallenge = await sha256Base64Url(verifier);

  await db
    .prepare(
      `INSERT INTO auth_challenges
       (id, provider, verifier, subject_hint, return_to, created_at, expires_at)
       VALUES (?, 'google', ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    )
    .bind(challengeId, verifier, nonce, returnTo, expiresAt)
    .run();

  const authorizationUrl = new URL(
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set(
    "redirect_uri",
    `${origin}/api/auth/google/callback`,
  );
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", challengeId);
  authorizationUrl.searchParams.set("nonce", nonce);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("prompt", "select_account");

  return new Response(null, {
    status: 302,
    headers: {
      location: authorizationUrl.toString(),
      "cache-control": "no-store",
      "set-cookie": authCookie(
        OAUTH_STATE_COOKIE,
        challengeId,
        10 * 60,
        origin,
        "/api/auth/google",
      ),
    },
  });
}

async function handleGoogleAuthCallback(
  request: Request,
  env: PlatformEnv,
): Promise<Response> {
  let returnTo = "/console";
  try {
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    if (
      !hasConfiguredCredential(clientId) ||
      !hasConfiguredCredential(clientSecret)
    ) {
      throw new PlatformError(
        503,
        "google_not_configured",
        "Google 登录尚未配置。",
      );
    }

    const url = new URL(request.url);
    const state = url.searchParams.get("state") ?? "";
    const stateCookie = cookieValue(request, OAUTH_STATE_COOKIE) ?? "";
    if (
      url.searchParams.getAll("state").length !== 1 ||
      !/^auth_[A-Za-z0-9_-]{20,80}$/.test(state) ||
      !constantTimeEqual(state, stateCookie)
    ) {
      throw new PlatformError(
        401,
        "oauth_state_invalid",
        "Google 登录请求已过期。",
      );
    }

    const db = requireDb(env);
    const challenge = await db
      .prepare(
        `SELECT verifier, subject_hint, return_to
         FROM auth_challenges
         WHERE id = ? AND provider = 'google'
           AND consumed_at IS NULL
           AND datetime(expires_at) > datetime('now')`,
      )
      .bind(state)
      .first<{
        verifier: string | null;
        subject_hint: string | null;
        return_to: string;
      }>();
    if (!challenge?.verifier || !challenge.subject_hint) {
      throw new PlatformError(
        401,
        "oauth_state_invalid",
        "Google 登录请求已过期。",
      );
    }
    returnTo = safeReturnTo(challenge.return_to);

    const consumed = await db
      .prepare(
        `UPDATE auth_challenges
         SET consumed_at = CURRENT_TIMESTAMP
         WHERE id = ? AND provider = 'google'
           AND consumed_at IS NULL
           AND datetime(expires_at) > datetime('now')`,
      )
      .bind(state)
      .run();
    if (Number(consumed.meta?.changes ?? 0) !== 1) {
      throw new PlatformError(
        401,
        "oauth_state_invalid",
        "Google 登录请求已使用或已过期。",
      );
    }

    if (url.searchParams.has("error")) {
      throw new PlatformError(
        401,
        "google_denied",
        "Google 授权未完成。",
      );
    }
    const code = url.searchParams.get("code") ?? "";
    if (
      url.searchParams.getAll("code").length !== 1 ||
      code.length < 8 ||
      code.length > 4_096
    ) {
      throw new PlatformError(
        401,
        "oauth_callback_failed",
        "Google 登录回调缺少有效授权码。",
      );
    }

    const origin = canonicalAppOrigin(request, env);
    let tokenResponse: Response;
    try {
      tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: `${origin}/api/auth/google/callback`,
          grant_type: "authorization_code",
          code_verifier: challenge.verifier,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new PlatformError(
        502,
        "oauth_callback_failed",
        "Google 登录服务暂时不可用。",
      );
    }
    const tokenPayload = await readResponseJson(
      tokenResponse,
      64 * 1024,
      "oauth_callback_failed",
    );
    if (!tokenResponse.ok || !isPlainRecord(tokenPayload)) {
      throw new PlatformError(
        401,
        "oauth_callback_failed",
        "Google 授权码验证失败。",
      );
    }
    const idToken = firstString(tokenPayload, ["id_token"]);
    if (
      !idToken ||
      idToken.length > 16_384 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(idToken)
    ) {
      throw new PlatformError(
        401,
        "oauth_callback_failed",
        "Google 身份令牌无效。",
      );
    }

    const tokenInfoUrl = new URL(
      "https://oauth2.googleapis.com/tokeninfo",
    );
    tokenInfoUrl.searchParams.set("id_token", idToken);
    let tokenInfoResponse: Response;
    try {
      tokenInfoResponse = await fetch(tokenInfoUrl, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new PlatformError(
        502,
        "oauth_callback_failed",
        "Google 身份验证服务暂时不可用。",
      );
    }
    const tokenInfo = await readResponseJson(
      tokenInfoResponse,
      64 * 1024,
      "oauth_callback_failed",
    );
    if (!tokenInfoResponse.ok || !isPlainRecord(tokenInfo)) {
      throw new PlatformError(
        401,
        "oauth_callback_failed",
        "Google 身份令牌验证失败。",
      );
    }

    const issuer = firstString(tokenInfo, ["iss"]);
    const audience = firstString(tokenInfo, ["aud"]);
    const subject = firstString(tokenInfo, ["sub"]);
    const email = firstString(tokenInfo, ["email"])?.toLowerCase() ?? "";
    const verified =
      tokenInfo.email_verified === true ||
      tokenInfo.email_verified === "true";
    const expiration = Number(tokenInfo.exp);
    const returnedNonce = firstString(tokenInfo, ["nonce"]);
    if (
      (issuer !== "accounts.google.com" &&
        issuer !== "https://accounts.google.com") ||
      audience !== clientId ||
      !subject ||
      !/^[A-Za-z0-9_-]{6,255}$/.test(subject) ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
      !verified ||
      !Number.isFinite(expiration) ||
      expiration * 1_000 <= Date.now() ||
      returnedNonce !== challenge.subject_hint
    ) {
      throw new PlatformError(
        401,
        "oauth_callback_failed",
        "Google 身份声明无法验证。",
      );
    }

    const displayName =
      compactIdentityName(tokenInfo.name) ?? email.split("@")[0] ?? email;
    const user = await upsertAuthIdentity(db, {
      provider: "google",
      subject,
      email,
      displayName,
      walletAddress: null,
    });
    const session = await createAuthSession(db, user, env, origin);
    return new Response(null, {
      status: 302,
      headers: {
        location: new URL(returnTo, origin).toString(),
        "cache-control": "no-store",
        "set-cookie": session.cookie,
      },
    });
  } catch (error) {
    const code =
      error instanceof PlatformError
        ? error.code
        : "oauth_callback_failed";
    console.error("Google authentication failed", {
      code,
      error: error instanceof Error ? error.message : "unknown error",
    });
    return oauthFailureRedirect(request, env, code, returnTo);
  }
}

async function handleWalletChallenge(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  if (env.WALLET_LOGIN_ENABLED !== "true") {
    throw new PlatformError(
      503,
      "wallet_login_disabled",
      "钱包登录尚未启用。",
    );
  }
  const body = await readJsonBody<{
    address?: unknown;
    chainId?: unknown;
    returnTo?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const address =
    typeof body.address === "string" ? body.address.trim() : "";
  const chainIdRaw =
    typeof body.chainId === "string" ? body.chainId.trim() : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new PlatformError(400, "invalid_wallet_address", "钱包地址无效。");
  }
  if (!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(chainIdRaw)) {
    throw new PlatformError(400, "invalid_chain_id", "钱包网络编号无效。");
  }
  const chainId = BigInt(chainIdRaw);
  if (chainId < BigInt(1) || chainId > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PlatformError(400, "invalid_chain_id", "钱包网络编号无效。");
  }

  const origin = canonicalAppOrigin(request, env);
  const host = new URL(origin).host;
  const db = requireDb(env);
  await consumeAuthChallengeRateLimit(
    db,
    request,
    "wallet",
    address.toLowerCase(),
  );
  const challengeId = `auth_${randomBase64Url(24)}`;
  const nonce = randomAlphaNumeric(24);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 10 * 60_000);
  const message = `${host} wants you to sign in with your Ethereum account:
${address}

Sign in to RelayBase. This request does not send a transaction.

URI: ${origin}
Version: 1
Chain ID: ${chainId.toString()}
Nonce: ${nonce}
Issued At: ${issuedAt.toISOString()}
Expiration Time: ${expiresAt.toISOString()}
Request ID: ${challengeId}`;
  const returnTo = safeReturnTo(
    typeof body.returnTo === "string" ? body.returnTo : null,
  );

  await db
    .prepare(
      `INSERT INTO auth_challenges
       (id, provider, subject_hint, message, return_to, created_at, expires_at)
       VALUES (?, 'wallet', ?, ?, ?, ?, ?)`,
    )
    .bind(
      challengeId,
      address.toLowerCase(),
      message,
      returnTo,
      issuedAt.toISOString(),
      expiresAt.toISOString(),
    )
    .run();

  return jsonResponse(
    {
      challengeId,
      message,
      expiresAt: expiresAt.toISOString(),
    },
    200,
    requestId,
  );
}

async function handleWalletVerify(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  if (env.WALLET_LOGIN_ENABLED !== "true") {
    throw new PlatformError(
      503,
      "wallet_login_disabled",
      "钱包登录尚未启用。",
    );
  }
  const body = await readJsonBody<{
    challengeId?: unknown;
    address?: unknown;
    signature?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const challengeId =
    typeof body.challengeId === "string" ? body.challengeId.trim() : "";
  const address =
    typeof body.address === "string" ? body.address.trim() : "";
  const signature =
    typeof body.signature === "string" ? body.signature.trim() : "";
  if (!/^auth_[A-Za-z0-9_-]{20,80}$/.test(challengeId)) {
    throw new PlatformError(
      400,
      "invalid_wallet_challenge",
      "钱包登录请求无效。",
    );
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new PlatformError(400, "invalid_wallet_address", "钱包地址无效。");
  }
  if (!/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(signature)) {
    throw new PlatformError(
      400,
      "invalid_wallet_signature",
      "钱包签名格式无效。",
    );
  }

  const db = requireDb(env);
  await consumeWalletVerificationRateLimit(
    db,
    request,
    challengeId,
  );
  const challenge = await db
    .prepare(
      `SELECT subject_hint, message, return_to
       FROM auth_challenges
       WHERE id = ? AND provider = 'wallet'
         AND consumed_at IS NULL
         AND datetime(expires_at) > datetime('now')`,
    )
    .bind(challengeId)
    .first<{
      subject_hint: string | null;
      message: string | null;
      return_to: string;
    }>();
  if (
    !challenge?.message ||
    !challenge.subject_hint ||
    challenge.subject_hint !== address.toLowerCase()
  ) {
    throw new PlatformError(
      401,
      "wallet_challenge_expired",
      "钱包登录请求已过期或地址不匹配。",
    );
  }

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({
      message: challenge.message,
      signature: signature as `0x${string}`,
    });
  } catch {
    throw new PlatformError(
      401,
      "wallet_signature_invalid",
      "钱包签名无法验证。",
    );
  }
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw new PlatformError(
      401,
      "wallet_signature_invalid",
      "钱包签名与所选地址不匹配。",
    );
  }

  const consumed = await db
    .prepare(
      `UPDATE auth_challenges
       SET consumed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND provider = 'wallet'
         AND consumed_at IS NULL
         AND datetime(expires_at) > datetime('now')`,
    )
    .bind(challengeId)
    .run();
  if (Number(consumed.meta?.changes ?? 0) !== 1) {
    throw new PlatformError(
      409,
      "wallet_challenge_used",
      "钱包登录请求已使用，请重新发起。",
    );
  }

  const normalizedAddress = address.toLowerCase();
  const user = await upsertAuthIdentity(db, {
    provider: "wallet",
    subject: normalizedAddress,
    email: null,
    displayName: `${address.slice(0, 6)}…${address.slice(-4)}`,
    walletAddress: normalizedAddress,
  });
  const origin = canonicalAppOrigin(request, env);
  const session = await createAuthSession(db, user, env, origin);
  return jsonResponse(
    {
      ok: true,
      returnTo: safeReturnTo(challenge.return_to),
      user: publicAuthUser(user),
    },
    200,
    requestId,
    { "set-cookie": session.cookie },
  );
}

async function handleAuthSignOut(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  const token = cookieValue(request, SESSION_COOKIE);
  if (token && /^[A-Za-z0-9_-]{32,160}$/.test(token)) {
    await requireDb(env)
      .prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`)
      .bind(await sha256Hex(token))
      .run();
  }
  const origin = canonicalAppOrigin(request, env);
  return jsonResponse(
    { ok: true },
    200,
    requestId,
    {
      "set-cookie": authCookie(
        SESSION_COOKIE,
        "",
        0,
        origin,
        "/",
      ),
    },
  );
}

function oauthFailureRedirect(
  request: Request,
  env: PlatformEnv,
  code: string,
  returnTo: string,
): Response {
  let origin: string;
  try {
    origin = canonicalAppOrigin(request, env);
  } catch {
    origin = new URL(request.url).origin;
  }
  const login = new URL("/login", origin);
  login.searchParams.set("error", /^[a-z0-9_]{1,64}$/.test(code) ? code : "oauth_callback_failed");
  login.searchParams.set("return_to", safeReturnTo(returnTo));
  return new Response(null, {
    status: 302,
    headers: {
      location: login.toString(),
      "cache-control": "no-store",
      "set-cookie": authCookie(
        OAUTH_STATE_COOKIE,
        "",
        0,
        origin,
        "/api/auth/google",
      ),
    },
  });
}

function publicAuthUser(user: AuthenticatedUser) {
  return {
    displayName: user.displayName,
    email: user.provider === "wallet" ? null : user.email,
    walletAddress: user.walletAddress,
    provider: user.provider,
  };
}

async function upsertAuthIdentity(
  db: D1Database,
  input: {
    provider: "google" | "wallet";
    subject: string;
    email: string | null;
    displayName: string;
    walletAddress: string | null;
  },
): Promise<AuthenticatedUser> {
  const existing = await db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.status,
              ai.wallet_address
       FROM auth_identities ai
       JOIN users u ON u.id = ai.user_id
       WHERE ai.provider = ? AND ai.subject = ?`,
    )
    .bind(input.provider, input.subject)
    .first<{
      id: string;
      email: string;
      display_name: string | null;
      status: string;
      wallet_address: string | null;
    }>();
  if (existing) {
    if (existing.status !== "active") {
      throw new PlatformError(403, "account_suspended", "账户当前不可用。");
    }
    if (input.email && input.email !== existing.email) {
      const emailUpdate = await db
        .prepare(
          `UPDATE users
           SET email = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
             AND NOT EXISTS (
               SELECT 1 FROM users
               WHERE email = ? AND id != ?
             )`,
        )
        .bind(input.email, existing.id, input.email, existing.id)
        .run();
      if (Number(emailUpdate.meta?.changes ?? 0) !== 1) {
        throw new PlatformError(
          409,
          "identity_email_conflict",
          "该 Google 邮箱已属于另一账户，请联系支持完成受控账户恢复。",
        );
      }
    }
    await db.batch([
      db
        .prepare(
          `UPDATE auth_identities
           SET email = ?, wallet_address = ?, updated_at = CURRENT_TIMESTAMP
           WHERE provider = ? AND subject = ?`,
        )
        .bind(
          input.email,
          input.walletAddress,
          input.provider,
          input.subject,
        ),
      db
        .prepare(
          `UPDATE users
           SET display_name = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'active'`,
        )
        .bind(input.displayName, existing.id),
    ]);
    return {
      id: existing.id,
      email: input.email ?? existing.email,
      displayName: input.displayName,
      provider: input.provider,
      walletAddress: input.walletAddress,
    };
  }

  const syntheticEmail =
    input.email ??
    `${input.subject.replace(/^0x/, "")}@wallet.relaybase.invalid`;
  const candidateUserId = `usr_${(
    await sha256Hex(`${input.provider}:${input.subject}`)
  ).slice(0, 24)}`;
  const identityId = `aid_${(
    await sha256Hex(`${input.provider}:${input.subject}`)
  ).slice(0, 28)}`;
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO users
         (id, email, display_name, status, created_at, updated_at)
         SELECT ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         WHERE NOT EXISTS (
           SELECT 1
           FROM auth_identities
           WHERE provider = ? AND subject = ?
         )`,
      )
      .bind(
        candidateUserId,
        syntheticEmail,
        input.displayName,
        input.provider,
        input.subject,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO auth_identities
         (id, user_id, provider, subject, email, wallet_address,
          created_at, updated_at)
         SELECT ?, u.id, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         FROM users u
         WHERE u.id = ?
           AND u.email = ?
           AND u.status = 'active'`,
      )
      .bind(
        identityId,
        input.provider,
        input.subject,
        input.email,
        input.walletAddress,
        candidateUserId,
        syntheticEmail,
      ),
  ]);
  const linked = await db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.status,
              ai.wallet_address
       FROM auth_identities ai
       JOIN users u ON u.id = ai.user_id
       WHERE ai.provider = ? AND ai.subject = ?`,
    )
    .bind(input.provider, input.subject)
    .first<{
      id: string;
      email: string;
      display_name: string | null;
      status: string;
      wallet_address: string | null;
    }>();
  if (linked?.status === "active") {
    return {
      id: linked.id,
      email: linked.email,
      displayName: linked.display_name ?? input.displayName,
      provider: input.provider,
      walletAddress: linked.wallet_address,
    };
  }
  if (linked) {
    throw new PlatformError(403, "account_suspended", "账户当前不可用。");
  }
  const candidate = await db
    .prepare(`SELECT status FROM users WHERE id = ? AND email = ?`)
    .bind(candidateUserId, syntheticEmail)
    .first<{ status: string }>();
  if (candidate && candidate.status !== "active") {
    throw new PlatformError(403, "account_suspended", "账户当前不可用。");
  }
  throw new PlatformError(
    409,
    "identity_link_required",
    "该邮箱已有 RelayBase 账户；为保护余额与 API Key，请通过受控账户恢复完成关联。",
  );
}

async function createAuthSession(
  db: D1Database,
  user: AuthenticatedUser,
  env: PlatformEnv,
  origin: string,
): Promise<{ cookie: string }> {
  const token = randomBase64Url(48);
  const tokenHash = await sha256Hex(token);
  const ttlDays = clampInteger(env.AUTH_SESSION_TTL_DAYS, 30, 1, 90);
  const expiresAt = new Date(
    Date.now() + ttlDays * 24 * 60 * 60_000,
  ).toISOString();
  const sessionResults = await db.batch([
    db
      .prepare(
        `DELETE FROM auth_sessions
         WHERE user_id = ? AND datetime(expires_at) <= datetime('now')`,
      )
      .bind(user.id),
    db
      .prepare(
        `DELETE FROM auth_sessions
         WHERE user_id = ?
           AND token_hash IN (
             SELECT token_hash
             FROM auth_sessions
             WHERE user_id = ?
               AND datetime(expires_at) > datetime('now')
             ORDER BY created_at DESC
             LIMIT -1 OFFSET 9
           )`,
      )
      .bind(user.id, user.id),
    db
      .prepare(
        `INSERT INTO auth_sessions
         (token_hash, user_id, provider, created_at, last_seen_at, expires_at)
         SELECT ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?
         WHERE EXISTS (
           SELECT 1 FROM users
           WHERE id = ? AND status = 'active'
         )`,
      )
      .bind(tokenHash, user.id, user.provider, expiresAt, user.id),
  ]);
  if (Number(sessionResults[2]?.meta?.changes ?? 0) !== 1) {
    throw new PlatformError(403, "account_suspended", "账户当前不可用。");
  }
  return {
    cookie: authCookie(
      SESSION_COOKIE,
      token,
      ttlDays * 24 * 60 * 60,
      origin,
      "/",
    ),
  };
}

async function consumeAuthChallengeRateLimit(
  db: D1Database,
  request: Request,
  provider: "google" | "wallet",
  subject: string | null,
): Promise<void> {
  const forwardedIp = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  const ipMaterial =
    forwardedIp &&
    forwardedIp.length <= 64 &&
    !/[\u0000-\u001F\u007F]/.test(forwardedIp)
      ? forwardedIp
      : "unknown";
  const ipFingerprint = (await sha256Hex(ipMaterial)).slice(0, 24);
  const scopes: Array<[string, number]> = [
    [`auth:${provider}:global`, provider === "google" ? 120 : 180],
    [
      `auth:${provider}:ip:${ipFingerprint}`,
      ipMaterial === "unknown" ? 30 : provider === "google" ? 10 : 20,
    ],
  ];
  if (subject) {
    scopes.push([
      `auth:${provider}:subject:${(await sha256Hex(subject)).slice(0, 24)}`,
      5,
    ]);
  }
  await consumeAtomicAuthRateLimits(db, scopes);

  const capacity = subject
    ? await db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM auth_challenges
           WHERE provider = ? AND subject_hint = ?
             AND consumed_at IS NULL
             AND datetime(expires_at) > datetime('now')`,
        )
        .bind(provider, subject)
        .first<{ count: number }>()
    : await db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM auth_challenges
           WHERE provider = ?
             AND consumed_at IS NULL
             AND datetime(expires_at) > datetime('now')`,
        )
        .bind(provider)
        .first<{ count: number }>();
  const maxOutstanding = subject ? 3 : 2_000;
  if (Number(capacity?.count ?? 0) >= maxOutstanding) {
    throw new PlatformError(
      429,
      "auth_challenge_limit",
      "当前已有未完成的登录请求，请先完成或稍后重试。",
    );
  }
}

async function consumeWalletVerificationRateLimit(
  db: D1Database,
  request: Request,
  challengeId: string,
): Promise<void> {
  const forwardedIp = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  const ipMaterial =
    forwardedIp &&
    forwardedIp.length <= 64 &&
    !/[\u0000-\u001F\u007F]/.test(forwardedIp)
      ? forwardedIp
      : "unknown";
  await consumeAtomicAuthRateLimits(db, [
    ["auth:wallet-verify:global", 300],
    [
      `auth:wallet-verify:ip:${(await sha256Hex(ipMaterial)).slice(0, 24)}`,
      ipMaterial === "unknown" ? 40 : 30,
    ],
    [
      `auth:wallet-verify:challenge:${(
        await sha256Hex(challengeId)
      ).slice(0, 24)}`,
      8,
    ],
  ]);
}

async function consumeAtomicAuthRateLimits(
  db: D1Database,
  scopes: Array<[string, number]>,
): Promise<void> {
  const minuteBucket = new Date().toISOString().slice(0, 16);
  const valueSlots = scopes.map(() => "(?, ?)").join(", ");
  const parameters = scopes.flatMap(([scope, limit]) => [scope, limit]);
  const admitted = await db
    .prepare(
      `WITH requested(scope, max_count) AS (
         VALUES ${valueSlots}
       ),
       admission(minute_bucket) AS (
         SELECT ?
         WHERE NOT EXISTS (
           SELECT 1
           FROM requested r
           LEFT JOIN auth_rate_limit_buckets b
             ON b.scope = r.scope AND b.minute_bucket = ?
           WHERE COALESCE(b.request_count, 0) >= r.max_count
         )
       )
       INSERT INTO auth_rate_limit_buckets
       (scope, minute_bucket, request_count, updated_at)
       SELECT r.scope, a.minute_bucket, 1, CURRENT_TIMESTAMP
       FROM requested r
       CROSS JOIN admission a
       WHERE 1 = 1
       ON CONFLICT(scope, minute_bucket) DO UPDATE SET
         request_count = auth_rate_limit_buckets.request_count + 1,
         updated_at = CURRENT_TIMESTAMP
       RETURNING scope`,
    )
    .bind(...parameters, minuteBucket, minuteBucket)
    .all<{ scope: string }>();
  if ((admitted.results?.length ?? 0) !== scopes.length) {
    throw new PlatformError(
      429,
      "auth_rate_limit_exceeded",
      "登录请求过于频繁，请稍后重试。",
    );
  }
}

function authCookie(
  name: string,
  value: string,
  maxAge: number,
  origin: string,
  path: string,
): string {
  const parts = [
    `${name}=${value}`,
    `Path=${path}`,
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (new URL(origin).protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const values: string[] = [];
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    values.push(part.slice(separator + 1).trim());
  }
  return values.length === 1 ? values[0] || null : null;
}

function safeReturnTo(value: string | null | undefined): string {
  const fallback = "/console";
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  try {
    const parsed = new URL(value, "https://relaybase.local");
    if (
      parsed.origin !== "https://relaybase.local" ||
      parsed.pathname === "/login" ||
      parsed.pathname.startsWith("/api/auth/")
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`.slice(0, 2_000);
  } catch {
    return fallback;
  }
}

function compactIdentityName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 160) : null;
}

function randomAlphaNumeric(length: number): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let result = "";
  for (const byte of bytes) result += alphabet[byte % alphabet.length];
  return result;
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    ),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function handleDashboard(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  const db = requireDb(env);
  const user = await requireAuthenticatedUser(request, db, env);
  const readiness = await operationalReadiness(env);

  const [
    balanceResult,
    statsResult,
    keysResult,
    paymentsResult,
    callsResult,
  ] = await db.batch([
    db
      .prepare(
        `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
         FROM balance_ledger
         WHERE user_id = ?`,
      )
      .bind(user.id),
    db
      .prepare(
        `SELECT
           COUNT(*) AS calls_30d,
           COALESCE(SUM(CASE WHEN refunded = 0 THEN cost_usd_micros ELSE 0 END), 0) AS spend_30d,
           COALESCE(SUM(CASE WHEN status_code = 200 THEN 1 ELSE 0 END), 0) AS successful_30d
         FROM api_calls
         WHERE user_id = ?
           AND datetime(created_at) >= datetime('now', '-30 days')`,
      )
      .bind(user.id),
    db
      .prepare(
        `SELECT id, label, key_prefix, created_at, last_used_at, revoked_at
         FROM api_keys
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 20`,
      )
      .bind(user.id),
    db
      .prepare(
        `SELECT p.id, p.amount_usd_micros, p.pay_currency, p.pay_amount,
                p.pay_address, p.invoice_url, p.status,
                p.credited_usd_micros,
                COALESCE((
                  SELECT -SUM(l.delta_usd_micros)
                  FROM balance_ledger l
                  WHERE l.user_id = p.user_id
                    AND l.delta_usd_micros < 0
                    AND (
                      l.reference_id =
                        'nowpayments:' || p.provider_payment_id || ':reversal'
                      OR EXISTS (
                        SELECT 1
                        FROM payment_review_cases r
                        WHERE r.order_id = p.id
                          AND l.reference_id =
                            'nowpayments-review:' || r.id || ':reversal'
                      )
                    )
                ), 0) AS reversed_usd_micros,
                (
                  SELECT r.reason
                  FROM payment_review_cases r
                  WHERE r.order_id = p.id
                  ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END,
                           r.created_at DESC
                  LIMIT 1
                ) AS review_reason,
                (
                  SELECT r.status
                  FROM payment_review_cases r
                  WHERE r.order_id = p.id
                  ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END,
                           r.created_at DESC
                  LIMIT 1
                ) AS review_status,
                p.created_at, p.updated_at
         FROM payment_orders p
         WHERE p.user_id = ?
         ORDER BY p.created_at DESC
         LIMIT 10`,
      )
      .bind(user.id),
    db
      .prepare(
        `SELECT id, method, upstream_path, platform, status_code,
                cost_usd_micros, latency_ms, refunded, created_at
         FROM api_calls
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 20`,
      )
      .bind(user.id),
  ]);

  const balanceRow = firstResult<{ balance: number }>(balanceResult);
  const statsRow = firstResult<{
    calls_30d: number;
    spend_30d: number;
    successful_30d: number;
  }>(statsResult);
  const calls30d = Number(statsRow?.calls_30d ?? 0);
  const successful30d = Number(statsRow?.successful_30d ?? 0);

  return jsonResponse(
    {
      user: {
        email: user.email,
        displayName: user.displayName,
      },
      balanceUsdMicros: Number(balanceRow?.balance ?? 0),
      capabilities: readiness.capabilities,
      stats: {
        calls30d,
        spend30dUsdMicros: Number(statsRow?.spend_30d ?? 0),
        successRate:
          calls30d === 0
            ? 1
            : Math.round((successful30d / calls30d) * 10000) / 10000,
      },
      keys: resultRows<{
        id: string;
        label: string;
        key_prefix: string;
        created_at: string;
        last_used_at: string | null;
        revoked_at: string | null;
      }>(keysResult).map((row) => ({
        id: row.id,
        label: row.label,
        prefix: row.key_prefix,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at,
      })),
      payments: resultRows<{
        id: string;
        amount_usd_micros: number;
        pay_currency: string;
        pay_amount: string | null;
        pay_address: string | null;
        invoice_url: string | null;
        status: string;
        credited_usd_micros: number;
        reversed_usd_micros: number;
        review_reason: string | null;
        review_status: string | null;
        created_at: string;
        updated_at: string;
      }>(paymentsResult).map((row) => ({
        id: row.id,
        amountUsdMicros: row.amount_usd_micros,
        payCurrency: row.pay_currency,
        payAmount: row.pay_amount,
        payAddress: row.pay_address,
        invoiceUrl: safeInvoiceUrl(row.invoice_url),
        status: row.status,
        creditedUsdMicros: Number(row.credited_usd_micros),
        reversedUsdMicros: Number(row.reversed_usd_micros),
        reviewReason: row.review_reason,
        reviewStatus: row.review_status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      calls: resultRows<{
        id: string;
        method: string;
        upstream_path: string;
        platform: string;
        status_code: number;
        cost_usd_micros: number;
        latency_ms: number;
        refunded: number;
        created_at: string;
      }>(callsResult).map((row) => ({
        id: row.id,
        method: row.method,
        path: row.upstream_path,
        platform: row.platform,
        statusCode: row.status_code,
        costUsdMicros: row.cost_usd_micros,
        refunded: row.refunded === 1,
        latencyMs: row.latency_ms,
        createdAt: row.created_at,
      })),
    },
    200,
    requestId,
  );
}

async function handleCreateApiKey(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  const db = requireDb(env);
  const user = await requireAuthenticatedUser(request, db, env);
  const body = await readJsonBody<{ label?: unknown }>(
    request,
    MAX_DASHBOARD_BODY_BYTES,
  );
  const label = sanitizeLabel(body.label);

  const id = `key_${randomBase64Url(12)}`;
  const secret = `rb_live_${randomBase64Url(32)}`;
  const keyHash = await sha256Hex(secret);
  const prefix = `${secret.slice(0, 16)}…`;
  const rateLimit = clampInteger(env.API_RATE_LIMIT_RPM, 60, 1, 600);
  const createdAt = new Date().toISOString();

  const [inserted, statusResult] = await db.batch([
    db
      .prepare(
        `INSERT INTO api_keys
         (id, user_id, label, key_prefix, key_hash, rate_limit_rpm, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM users
           WHERE id = ? AND status = 'active'
         )
           AND (
             SELECT COUNT(*)
             FROM api_keys
             WHERE user_id = ? AND revoked_at IS NULL
           ) < 5`,
      )
      .bind(
        id,
        user.id,
        label,
        prefix,
        keyHash,
        rateLimit,
        createdAt,
        user.id,
        user.id,
      ),
    db
      .prepare(`SELECT status FROM users WHERE id = ?`)
      .bind(user.id),
  ]);
  if (Number(inserted.meta?.changes ?? 0) !== 1) {
    const currentStatus = firstResult<{ status: string }>(statusResult)?.status;
    if (currentStatus !== "active") {
      throw new PlatformError(403, "account_suspended", "账户当前不可用。");
    }
    throw new PlatformError(
      409,
      "api_key_limit",
      "每个账户最多保留 5 个有效 API Key。",
    );
  }

  return jsonResponse(
    {
      key: {
        id,
        label,
        prefix,
        secret,
        createdAt,
      },
    },
    201,
    requestId,
  );
}

async function handleRevokeApiKey(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  const db = requireDb(env);
  const user = await requireAuthenticatedUser(request, db, env);
  const body = await readJsonBody<{ id?: unknown }>(
    request,
    MAX_DASHBOARD_BODY_BYTES,
  );
  if (typeof body.id !== "string" || !/^key_[A-Za-z0-9_-]+$/.test(body.id)) {
    throw new PlatformError(400, "invalid_key_id", "API Key 编号无效。");
  }

  const result = await db
    .prepare(
      `UPDATE api_keys
       SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
       WHERE id = ? AND user_id = ?`,
    )
    .bind(body.id, user.id)
    .run();
  if (Number(result.meta?.changes ?? 0) === 0) {
    throw new PlatformError(404, "key_not_found", "没有找到这个 API Key。");
  }

  return jsonResponse({ ok: true }, 200, requestId);
}

async function handleCreatePayment(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  if (
    env.CRYPTO_PAYMENTS_ENABLED !== "true" ||
    env.LEGAL_REVIEW_CONFIRMED !== "true"
  ) {
    throw new PlatformError(
      503,
      "payments_in_sandbox",
      "真实加密充值尚未启用；完成商户审核与法律审查后方可开放。",
    );
  }
  if (env.UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED !== "true") {
    throw new PlatformError(
      503,
      "commercial_clearance_required",
      "UpstreamProvider 对稳定币仅作为 API 服务付款方式的书面澄清尚未归档，真实充值保持关闭。",
    );
  }
  const readiness = await operationalReadiness(env);
  if (!readiness.capabilities.schemaReady) {
    throw new PlatformError(
      503,
      "database_migrations_required",
      "数据库迁移尚未完成，暂不接受充值。",
    );
  }
  if (!readiness.capabilities.proxyEnabled) {
    throw new PlatformError(
      503,
      "service_not_ready",
      "数据代理尚未完成授权与配置，暂不接受充值。",
    );
  }
  if ((env.PAYMENT_PROVIDER ?? "nowpayments") !== "nowpayments") {
    throw new PlatformError(
      503,
      "payment_provider_unavailable",
      "当前支付服务商尚未配置。",
    );
  }

  const apiKey = env.NOWPAYMENTS_API_KEY;
  if (!apiKey || !env.NOWPAYMENTS_IPN_SECRET) {
    throw new PlatformError(
      503,
      "payment_provider_unavailable",
      "支付服务商密钥或回调验证密钥尚未配置。",
    );
  }

  const db = requireDb(env);
  const user = await requireAuthenticatedUser(request, db, env);
  const idempotencyKey = requireIdempotencyKey(request);
  const idempotencyHash = await sha256Hex(
    `${user.id}:${idempotencyKey}`,
  );
  const body = await readJsonBody<{
    amountUsd?: unknown;
    payCurrency?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const amountUsd =
    typeof body.amountUsd === "number" &&
    Number.isSafeInteger(body.amountUsd)
      ? body.amountUsd
      : Number.NaN;
  const payCurrency =
    typeof body.payCurrency === "string"
      ? body.payCurrency.trim().toLowerCase()
      : "";
  if (!PAYMENT_AMOUNTS.has(amountUsd)) {
    throw new PlatformError(
      400,
      "invalid_payment_amount",
      "充值金额仅支持 10、25、50 或 100 美元。",
    );
  }
  if (!PAYMENT_CURRENCIES.has(payCurrency)) {
    throw new PlatformError(
      400,
      "invalid_payment_currency",
      "请选择受支持的币种和网络。",
    );
  }

  const existingOrder = await paymentOrderByIdempotency(
    db,
    user.id,
    idempotencyHash,
  );
  if (existingOrder) {
    if (
      existingOrder.amount_usd_micros !== amountUsd * 1_000_000 ||
      existingOrder.pay_currency.toLowerCase() !== payCurrency
    ) {
      throw new PlatformError(
        409,
        "idempotency_payload_conflict",
        "该 Idempotency-Key 已用于不同金额或币种的充值单。",
      );
    }
    return paymentOrderResponse(existingOrder, 200, requestId);
  }
  if (!readiness.capabilities.catalogReady) {
    throw new PlatformError(
      503,
      "catalog_not_ready",
      "当前尚无已审核并开放的接口，暂不接受充值。",
    );
  }
  if (!readiness.ready) {
    throw new PlatformError(
      503,
      "service_not_ready",
      "支付管理、自动对账或运行配置尚未就绪，暂不接受充值。",
    );
  }

  await consumePaymentCreateRateLimit(db, user.id, env);
  const pending = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM payment_orders
       WHERE user_id = ?
         AND status NOT IN (
           'finished', 'refunded', 'failed', 'expired',
           'provider_error', 'manual_resolved'
         )
         AND datetime(created_at) >= datetime('now', '-24 hours')`,
    )
    .bind(user.id)
    .first<{ count: number }>();
  if (Number(pending?.count ?? 0) >= 3) {
    throw new PlatformError(
      409,
      "too_many_pending_payments",
      "你已有 3 个待处理充值单，请先完成、等待确认或联系支持处理。",
    );
  }

  const orderId = `pay_${randomBase64Url(16)}`;
  const amountUsdMicros = amountUsd * 1_000_000;
  const appOrigin = canonicalAppOrigin(request, env);
  const createdAt = new Date().toISOString();

  try {
    await db
      .prepare(
        `INSERT INTO payment_orders
         (id, user_id, provider, idempotency_hash, amount_usd_micros,
          pay_currency, status, created_at, updated_at)
         VALUES (?, ?, 'nowpayments', ?, ?, ?, 'creating', ?, ?)`,
      )
      .bind(
        orderId,
        user.id,
        idempotencyHash,
        amountUsdMicros,
        payCurrency,
        createdAt,
        createdAt,
      )
      .run();
  } catch {
    const racedOrder = await paymentOrderByIdempotency(
      db,
      user.id,
      idempotencyHash,
    );
    if (racedOrder) {
      if (
        racedOrder.amount_usd_micros !== amountUsdMicros ||
        racedOrder.pay_currency.toLowerCase() !== payCurrency
      ) {
        throw new PlatformError(
          409,
          "idempotency_payload_conflict",
          "该 Idempotency-Key 已用于不同金额或币种的充值单。",
        );
      }
      return paymentOrderResponse(racedOrder, 200, requestId);
    }
    throw new PlatformError(
      409,
      "payment_creation_conflict",
      "充值单正在创建，请使用同一 Idempotency-Key 重试。",
    );
  }

  let payment: NowPaymentsPayment;
  try {
    payment = await createNowPaymentsPayment(apiKey, {
      amountUsd,
      payCurrency,
      orderId,
      appOrigin,
    });
  } catch (error) {
    await db
      .prepare(
        `UPDATE payment_orders
         SET status = 'provider_error', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(orderId)
      .run();
    throw error;
  }

  const providerPaymentId = String(payment.payment_id ?? "");

  const update = await db
    .prepare(
      `UPDATE payment_orders
       SET provider_payment_id = ?, pay_amount = ?, pay_address = ?,
           invoice_url = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND provider_payment_id IS NULL`,
    )
    .bind(
      providerPaymentId,
      String(payment.pay_amount ?? ""),
      payment.pay_address ?? null,
      payment.invoice_url ?? null,
      payment.payment_status ?? "waiting",
      orderId,
    )
    .run();
  if (Number(update.meta?.changes ?? 0) !== 1) {
    throw new PlatformError(
      409,
      "payment_creation_conflict",
      "充值单已被其他请求更新，请使用同一 Idempotency-Key 查询。",
    );
  }

  const createdOrder = await paymentOrderById(db, orderId, user.id);
  if (!createdOrder) {
    throw new PlatformError(
      500,
      "payment_record_missing",
      "充值单已创建但本地记录暂时不可用，请使用同一 Idempotency-Key 重试。",
    );
  }
  return paymentOrderResponse(createdOrder, 201, requestId);
}

async function handleNowPaymentsWebhook(
  request: Request,
  env: PlatformEnv,
  ctx: WorkerExecutionContext,
  requestId: string,
): Promise<Response> {
  const ipnSecret = env.NOWPAYMENTS_IPN_SECRET;
  const apiKey = env.NOWPAYMENTS_API_KEY;
  if (!ipnSecret || !apiKey) {
    throw new PlatformError(
      503,
      "payment_provider_unavailable",
      "支付回调尚未配置。",
    );
  }

  const rawBody = await readBodyText(request, MAX_WEBHOOK_BODY_BYTES);
  let payload: NowPaymentsPayment;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!isPlainRecord(parsed)) {
      throw new Error("Webhook payload must be an object");
    }
    if (containsUnsafeJsonNumber(parsed)) {
      throw new Error("Webhook payload contains an unsafe number");
    }
    payload = parsed as NowPaymentsPayment;
  } catch {
    throw new PlatformError(400, "invalid_webhook", "支付回调格式无效。");
  }

  const signature = request.headers.get("x-nowpayments-sig") ?? "";
  const expectedSignature = await hmacSha512Hex(
    ipnSecret,
    JSON.stringify(sortObjectDeep(payload)),
  );
  if (!constantTimeEqual(signature.toLowerCase(), expectedSignature)) {
    throw new PlatformError(
      401,
      "invalid_webhook_signature",
      "支付回调签名无效。",
    );
  }

  const paymentId = String(payload.payment_id ?? "");
  const payloadOrderId =
    typeof payload.order_id === "string" ? payload.order_id.trim() : "";
  const parentPaymentId = String(payload.parent_payment_id ?? "").trim();
  const paymentStatus =
    typeof payload.payment_status === "string"
      ? payload.payment_status.trim().toLowerCase()
      : "";
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(paymentId) ||
    !/^[a-z_]{1,64}$/.test(paymentStatus) ||
    (!/^pay_[A-Za-z0-9_-]+$/.test(payloadOrderId) &&
      !/^[A-Za-z0-9_-]{1,128}$/.test(parentPaymentId))
  ) {
    throw new PlatformError(400, "invalid_webhook", "支付回调缺少订单信息。");
  }

  const db = requireDb(env);
  let orderId = payloadOrderId;
  if (!/^pay_[A-Za-z0-9_-]+$/.test(orderId)) {
    const parentOrder = await db
      .prepare(
        `SELECT id
         FROM payment_orders
         WHERE provider = 'nowpayments' AND provider_payment_id = ?
         LIMIT 1`,
      )
      .bind(parentPaymentId)
      .first<{ id: string }>();
    if (!parentOrder) {
      throw new PlatformError(
        404,
        "payment_not_found",
        "重复入金对应的原充值单不存在。",
      );
    }
    orderId = parentOrder.id;
  }
  const canonicalPayload = JSON.stringify(sortObjectDeep(payload));
  const payloadHash = await sha256Hex(canonicalPayload);
  const eventId = `evt_${payloadHash.slice(0, 40)}`;
  const storedEvent = await db
    .prepare(
      `INSERT OR IGNORE INTO payment_events
       (id, provider, provider_payment_id, order_id, payment_status,
        payload_json, payload_hash, received_at, next_attempt_at)
       VALUES (?, 'nowpayments', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP,
               CURRENT_TIMESTAMP)`,
    )
    .bind(
      eventId,
      paymentId,
      orderId,
      paymentStatus,
      canonicalPayload,
      payloadHash,
    )
    .run();

  let shouldProcess = Number(storedEvent.meta?.changes ?? 0) === 1;
  if (!shouldProcess) {
    const existingEvent = await db
      .prepare(
        `SELECT processed_at, processing_error,
                datetime(next_attempt_at) <= datetime('now') AS retry_due
         FROM payment_events
         WHERE id = ?`,
      )
      .bind(eventId)
      .first<{
        processed_at: string | null;
        processing_error: string | null;
        retry_due: number;
      }>();
    shouldProcess =
      existingEvent?.processed_at == null &&
      Boolean(existingEvent?.processing_error) &&
      existingEvent?.retry_due === 1;
  }
  if (shouldProcess) {
    ctx.waitUntil(
      processNowPaymentsEvent(db, apiKey, {
        eventId,
        paymentId,
        orderId,
        requestId,
      }),
    );
  }
  return paymentWebhookAck(requestId);
}

async function processNowPaymentsEvent(
  db: D1Database,
  apiKey: string,
  input: {
    eventId: string;
    paymentId: string;
    orderId: string;
    requestId: string;
  },
): Promise<void> {
  try {
    const verified = await getNowPaymentsPayment(apiKey, input.paymentId);
    await applyVerifiedNowPayment(db, verified, input);
    await db
      .prepare(
        `UPDATE payment_events
         SET processed_at = CURRENT_TIMESTAMP, processing_error = NULL,
             last_attempt_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(input.eventId)
      .run();
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "unknown error";
    await db
      .prepare(
        `UPDATE payment_events
         SET processing_error = ?,
             attempt_count = attempt_count + 1,
             last_attempt_at = CURRENT_TIMESTAMP,
             next_attempt_at = datetime(
               'now',
               CASE
                 WHEN attempt_count >= 5 THEN '+1 hour'
                 WHEN attempt_count >= 2 THEN '+15 minutes'
                 ELSE '+2 minutes'
               END
             )
         WHERE id = ? AND processed_at IS NULL`,
      )
      .bind(message, input.eventId)
      .run();
    console.error("NOWPayments event processing failed", {
      requestId: input.requestId,
      eventId: input.eventId,
      orderId: input.orderId,
      paymentId: input.paymentId,
      error: message,
    });
  }
}

async function applyVerifiedNowPayment(
  db: D1Database,
  verified: NowPaymentsPayment,
  input: {
    paymentId: string;
    orderId: string;
    requestId: string;
    allowManualReviewRecovery?: boolean;
  },
): Promise<void> {
  if (String(verified.payment_id ?? "") !== input.paymentId) {
    throw new PlatformError(
      409,
      "payment_order_mismatch",
      "支付订单信息不匹配。",
    );
  }

  const order = await paymentOrderById(db, input.orderId);
  if (!order) {
    throw new PlatformError(404, "payment_not_found", "支付订单不存在。");
  }
  const parentPaymentId = String(
    verified.parent_payment_id ?? "",
  ).trim();
  const isBoundChild =
    Boolean(parentPaymentId) &&
    order.provider_payment_id != null &&
    parentPaymentId === order.provider_payment_id &&
    (verified.order_id == null ||
      verified.order_id === "" ||
      verified.order_id === input.orderId);
  if (!isBoundChild && verified.order_id !== input.orderId) {
    throw new PlatformError(
      409,
      "payment_order_mismatch",
      "支付订单信息不匹配。",
    );
  }
  const status =
    typeof verified.payment_status === "string"
      ? verified.payment_status.trim().toLowerCase()
      : "";
  const actualPaidPositive =
    normalizedPositiveDecimal(verified.actually_paid) != null;
  const exactReview = await db
    .prepare(
      `SELECT id, status, reason, resolution_action
       FROM payment_review_cases
       WHERE order_id = ? AND provider_payment_id = ?
       LIMIT 1`,
    )
    .bind(input.orderId, input.paymentId)
    .first<{
      id: string;
      status: string;
      reason: string;
      resolution_action: string | null;
    }>();
  const exactRejectedReview =
    exactReview?.status === "resolved" &&
    exactReview.resolution_action === "reject";
  if (isBoundChild && status === "refunded") {
    await reversePaymentReviewCredits(
      db,
      input.orderId,
      input.paymentId,
    );
    return;
  }
  if (
    isBoundChild
  ) {
    if (exactRejectedReview) {
      if (actualPaidPositive) {
        await persistPaymentReviewCase(db, {
          orderId: input.orderId,
          providerPaymentId: input.paymentId,
          parentPaymentId,
          reason: "funds_after_manual_rejection",
          verified,
        });
      }
      return;
    }
    await persistPaymentReviewCase(db, {
      orderId: input.orderId,
      providerPaymentId: input.paymentId,
      parentPaymentId,
      reason: "repeated_deposit",
      verified,
    });
    console.warn("Repeated deposit moved to manual review", {
      requestId: input.requestId,
      orderId: input.orderId,
      paymentId: input.paymentId,
      parentPaymentId,
    });
    return;
  }
  if (
    order.provider_payment_id != null &&
    order.provider_payment_id !== input.paymentId
  ) {
    throw new PlatformError(
      409,
      "payment_order_mismatch",
      "支付服务商订单编号不匹配。",
    );
  }
  if (status === "refunded") {
    await reversePaymentReviewCredits(
      db,
      input.orderId,
      input.paymentId,
    );
    await reverseOriginalPaymentCredit(
      db,
      input.orderId,
      input.paymentId,
    );
    return;
  }

  if (exactReview?.status === "open") {
    await persistPaymentReviewCase(db, {
      orderId: input.orderId,
      providerPaymentId: input.paymentId,
      parentPaymentId: parentPaymentId || null,
      reason: exactReview.reason,
      verified,
    });
    return;
  }
  if (exactRejectedReview) {
    if (actualPaidPositive) {
      await persistPaymentReviewCase(db, {
        orderId: input.orderId,
        providerPaymentId: input.paymentId,
        parentPaymentId: parentPaymentId || null,
        reason: "funds_after_manual_rejection",
        verified,
      });
    }
    return;
  }
  if (order.status === "manual_resolved") return;
  const verifiedUsdMicros = parseUsdMicros(verified.price_amount);
  const currencyMatches =
    typeof verified.pay_currency === "string" &&
    verified.pay_currency.toLowerCase() === order.pay_currency.toLowerCase();
  const priceCurrencyMatches =
    typeof verified.price_currency === "string" &&
    verified.price_currency.toLowerCase() === "usd";
  const priceMatches = verifiedUsdMicros === order.amount_usd_micros;
  const providerPayAmount = normalizedPositiveDecimal(verified.pay_amount);
  const expectedPayAmount =
    normalizedPositiveDecimal(order.pay_amount) ?? providerPayAmount;
  const actualCoversExpected =
    expectedPayAmount != null &&
    verified.actually_paid != null &&
    compareDecimalAmounts(verified.actually_paid, expectedPayAmount) >= 0;
  const materiallyOverpaid =
    expectedPayAmount != null &&
    verified.actually_paid != null &&
    isMaterialOverpayment(verified.actually_paid, expectedPayAmount);
  const invoiceUrl = safeInvoiceUrl(
    typeof verified.invoice_url === "string" ? verified.invoice_url : null,
  );
  const payAddress =
    typeof verified.pay_address === "string" &&
    verified.pay_address.length >= 8 &&
    verified.pay_address.length <= 256
      ? verified.pay_address
      : null;

  if (
    !NOWPAYMENTS_STATUSES.has(status) ||
    !currencyMatches ||
    !priceCurrencyMatches ||
    !priceMatches ||
    providerPayAmount == null ||
    (status === "finished" && !actualCoversExpected) ||
    (status === "finished" && materiallyOverpaid) ||
    status === "partially_paid" ||
    ((status === "failed" || status === "expired") && actualPaidPositive)
  ) {
    const reason =
      status === "partially_paid"
        ? "partially_paid"
        : (status === "failed" || status === "expired") &&
            actualPaidPositive
          ? "terminal_with_funds"
          : status === "finished" && materiallyOverpaid
            ? "overpaid_finished"
          : status === "finished" && !actualCoversExpected
            ? "underpaid_finished"
            : "provider_data_mismatch";
    await persistPaymentReviewCase(db, {
      orderId: input.orderId,
      providerPaymentId: input.paymentId,
      parentPaymentId: parentPaymentId || null,
      reason,
      verified,
    });
    console.warn("Payment moved to manual review", {
      requestId: input.requestId,
      orderId: input.orderId,
      paymentId: input.paymentId,
      status,
      currencyMatches,
      priceCurrencyMatches,
      priceMatches,
      actualCoversExpected,
      materiallyOverpaid,
    });
    return;
  }

  if (order.provider_payment_id == null) {
    const binding = await db
      .prepare(
        `UPDATE payment_orders
         SET provider_payment_id = ?, pay_amount = ?,
             pay_address = COALESCE(pay_address, ?),
             invoice_url = COALESCE(invoice_url, ?),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND provider_payment_id IS NULL
           AND (
             status IN ('creating', 'provider_error', 'waiting', 'confirming',
                        'confirmed', 'sending', 'partially_paid')
             OR (status = 'manual_review' AND ? = 1)
           )`,
      )
      .bind(
        input.paymentId,
        providerPayAmount,
        payAddress,
        invoiceUrl,
        input.orderId,
        input.allowManualReviewRecovery ? 1 : 0,
      )
      .run();
    if (Number(binding.meta?.changes ?? 0) !== 1) {
      const rebound = await paymentOrderById(db, input.orderId);
      if (rebound?.provider_payment_id !== input.paymentId) {
        throw new PlatformError(
          409,
          "payment_binding_conflict",
          "支付订单绑定发生冲突，已停止自动入账。",
        );
      }
    }
  }

  const updatedAt = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];

  if (status === "finished") {
    statements.push(
      db
        .prepare(
          `UPDATE payment_orders
           SET status = 'finished', pay_amount = ?,
               pay_address = COALESCE(pay_address, ?),
               invoice_url = COALESCE(invoice_url, ?),
               updated_at = ?
           WHERE id = ?
             AND status NOT IN ('refunded', 'manual_resolved')
             AND (status != 'manual_review' OR ? = 1)
             AND NOT EXISTS (
               SELECT 1
               FROM payment_review_cases r
               JOIN balance_ledger l
                 ON l.reference_id =
                    'nowpayments-review:' || r.id || ':credit'
               WHERE r.order_id = payment_orders.id
                 AND r.provider_payment_id = ?
                 AND l.delta_usd_micros > 0
             )`,
        )
        .bind(
          providerPayAmount,
          payAddress,
          invoiceUrl,
          updatedAt,
          input.orderId,
          input.allowManualReviewRecovery ? 1 : 0,
          input.paymentId,
        ),
      db
        .prepare(
          `INSERT OR IGNORE INTO balance_ledger
           (id, user_id, entry_type, delta_usd_micros, reference_id, description, created_at)
           SELECT ?, user_id, 'payment_credit', amount_usd_micros, ?,
                  'Stablecoin balance top-up', ?
           FROM payment_orders
           WHERE id = ? AND status = 'finished'
             AND NOT EXISTS (
               SELECT 1
               FROM payment_review_cases r
               JOIN balance_ledger l
                 ON l.reference_id =
                    'nowpayments-review:' || r.id || ':credit'
               WHERE r.order_id = payment_orders.id
                 AND r.provider_payment_id = ?
                 AND l.delta_usd_micros > 0
             )`,
        )
        .bind(
          `led_${randomBase64Url(16)}`,
          `nowpayments:${input.paymentId}:credit`,
          updatedAt,
          input.orderId,
          input.paymentId,
        ),
      db
        .prepare(
          `UPDATE payment_orders
           SET credited_usd_micros = amount_usd_micros, updated_at = ?
           WHERE id = ? AND status = 'finished'`,
        )
        .bind(updatedAt, input.orderId),
    );
  } else {
    statements.push(
      db
        .prepare(
          `UPDATE payment_orders
           SET status = ?, pay_amount = ?,
               pay_address = COALESCE(pay_address, ?),
               invoice_url = COALESCE(invoice_url, ?),
               updated_at = ?
           WHERE id = ?
             AND status NOT IN ('finished', 'refunded', 'manual_review')`,
        )
        .bind(
          status,
          providerPayAmount,
          payAddress,
          invoiceUrl,
          updatedAt,
          input.orderId,
        ),
    );
  }

  await db.batch(statements);
}

async function reverseOriginalPaymentCredit(
  db: D1Database,
  orderId: string,
  paymentId: string,
): Promise<void> {
  const creditReference = `nowpayments:${paymentId}:credit`;
  const reversalReference = `nowpayments:${paymentId}:reversal`;
  await db.batch([
    db
      .prepare(
        `UPDATE payment_orders
         SET status = 'refunded', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(orderId),
    db
      .prepare(
        `INSERT OR IGNORE INTO balance_ledger
         (id, user_id, entry_type, delta_usd_micros, reference_id,
          description, created_at)
         SELECT ?, user_id, 'payment_reversal', -delta_usd_micros, ?,
                'Stablecoin payment refunded', CURRENT_TIMESTAMP
         FROM balance_ledger
         WHERE reference_id = ? AND delta_usd_micros > 0
         LIMIT 1`,
      )
      .bind(
        `led_${randomBase64Url(16)}`,
        reversalReference,
        creditReference,
      ),
    paymentCreditedRecalculation(db, orderId),
  ]);
}

async function reversePaymentReviewCredits(
  db: D1Database,
  orderId: string,
  providerPaymentId: string,
): Promise<void> {
  const cases = await db
    .prepare(
      `SELECT id
       FROM payment_review_cases
       WHERE order_id = ? AND provider_payment_id = ?`,
    )
    .bind(orderId, providerPaymentId)
    .all<{ id: string }>();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE payment_review_cases
         SET status = 'resolved',
             resolution_action = CASE
               WHEN resolution_action = 'credit'
                 THEN 'credited_then_refunded'
               WHEN resolution_action IS NULL
                 THEN 'refund_confirmed'
               ELSE resolution_action
             END,
             resolution_note = CASE
               WHEN resolution_action = 'credit'
                 THEN substr(
                   COALESCE(resolution_note || ' · ', '') ||
                   'Provider-confirmed refund reversed the review credit',
                   1, 500
                 )
               ELSE COALESCE(
                 resolution_note,
                 'Provider-confirmed refund processed automatically'
               )
             END,
             resolution_reference =
               'nowpayments-review:' || id || ':reversal',
             resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)
         WHERE order_id = ? AND provider_payment_id = ?`,
      )
      .bind(orderId, providerPaymentId),
  ];
  for (const reviewCase of cases.results ?? []) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO balance_ledger
           (id, user_id, entry_type, delta_usd_micros, reference_id,
            description, created_at)
           SELECT ?, user_id, 'payment_review_reversal',
                  -delta_usd_micros, ?,
                  'Operator-reviewed payment refunded', CURRENT_TIMESTAMP
           FROM balance_ledger
           WHERE reference_id = ? AND delta_usd_micros > 0
           LIMIT 1`,
        )
        .bind(
          `led_${randomBase64Url(16)}`,
          `nowpayments-review:${reviewCase.id}:reversal`,
          `nowpayments-review:${reviewCase.id}:credit`,
        ),
    );
  }
  statements.push(
    paymentCreditedRecalculation(db, orderId),
    db
      .prepare(
        `UPDATE payment_orders
         SET status = CASE
               WHEN EXISTS (
                 SELECT 1 FROM payment_review_cases
                 WHERE order_id = ? AND status = 'open'
               ) THEN 'manual_review'
               ELSE 'manual_resolved'
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status != 'refunded'`,
      )
      .bind(orderId, orderId),
  );
  await db.batch(statements);
}

function paymentCreditedRecalculation(
  db: D1Database,
  orderId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE payment_orders
       SET credited_usd_micros = (
             SELECT COALESCE(SUM(l.delta_usd_micros), 0)
             FROM balance_ledger l
             WHERE l.reference_id IN (
                     'nowpayments:' ||
                     COALESCE(payment_orders.provider_payment_id, '') ||
                     ':credit',
                     'nowpayments:' ||
                     COALESCE(payment_orders.provider_payment_id, '') ||
                     ':reversal'
                   )
                OR EXISTS (
                  SELECT 1
                  FROM payment_review_cases r
                  WHERE r.order_id = payment_orders.id
                    AND l.reference_id IN (
                      'nowpayments-review:' || r.id || ':credit',
                      'nowpayments-review:' || r.id || ':reversal'
                    )
                )
           ),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(orderId);
}

async function persistPaymentReviewCase(
  db: D1Database,
  input: {
    orderId: string;
    providerPaymentId: string;
    parentPaymentId: string | null;
    reason: string;
    verified: NowPaymentsPayment;
  },
): Promise<void> {
  const evidence = JSON.stringify({
    observationId: `obs_${randomBase64Url(12)}`,
    paymentId: String(input.verified.payment_id ?? "").slice(0, 128),
    parentPaymentId: input.parentPaymentId?.slice(0, 128) ?? null,
    orderId:
      typeof input.verified.order_id === "string"
        ? input.verified.order_id.slice(0, 160)
        : null,
    paymentStatus:
      typeof input.verified.payment_status === "string"
        ? input.verified.payment_status.slice(0, 64)
        : null,
    priceAmount: safeEvidenceScalar(input.verified.price_amount),
    priceCurrency:
      typeof input.verified.price_currency === "string"
        ? input.verified.price_currency.slice(0, 32)
        : null,
    payAmount: safeEvidenceScalar(input.verified.pay_amount),
    actuallyPaid: safeEvidenceScalar(input.verified.actually_paid),
    payCurrency:
      typeof input.verified.pay_currency === "string"
        ? input.verified.pay_currency.slice(0, 32)
        : null,
  });
  await db.batch([
    db
      .prepare(
        `INSERT INTO payment_review_cases
         (id, order_id, provider_payment_id, parent_payment_id, reason,
          status, actually_paid, pay_currency, evidence_json, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(provider_payment_id) DO UPDATE SET
           parent_payment_id = excluded.parent_payment_id,
           reason = excluded.reason,
           status = 'open',
           actually_paid = excluded.actually_paid,
           pay_currency = excluded.pay_currency,
           evidence_json = excluded.evidence_json,
           resolution_action = NULL,
           resolution_credit_usd_micros = NULL,
           resolution_request_hash = NULL,
           resolution_note = NULL,
           resolution_reference = NULL,
           resolved_at = NULL
         WHERE (
             payment_review_cases.status = 'open'
             OR (
               payment_review_cases.status = 'resolved'
               AND payment_review_cases.resolution_action = 'reject'
               AND ? = 1
             )
           )
           AND payment_review_cases.order_id = excluded.order_id`,
      )
      .bind(
        `prv_${randomBase64Url(18)}`,
        input.orderId,
        input.providerPaymentId,
        input.parentPaymentId,
        input.reason,
        safeEvidenceScalar(input.verified.actually_paid),
        typeof input.verified.pay_currency === "string"
          ? input.verified.pay_currency.slice(0, 32)
          : null,
        evidence,
        normalizedPositiveDecimal(input.verified.actually_paid) != null
          ? 1
          : 0,
      ),
    db
      .prepare(
        `UPDATE payment_orders
         SET status = 'manual_review', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status != 'refunded'
           AND EXISTS (
             SELECT 1 FROM payment_review_cases
             WHERE provider_payment_id = ? AND status = 'open'
           )`,
      )
      .bind(input.orderId, input.providerPaymentId),
  ]);
}

function safeEvidenceScalar(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text || text.length > 128 || /[\u0000-\u001F\u007F]/.test(text)) {
    return null;
  }
  return text;
}

async function handleProxyRequest(
  request: Request,
  env: PlatformEnv,
  ctx: WorkerExecutionContext,
  requestId: string,
): Promise<Response> {
  const readiness = await operationalReadiness(env);
  if (
    readiness.capabilities.databaseConfigured &&
    !readiness.capabilities.schemaReady
  ) {
    throw new PlatformError(
      503,
      "service_not_ready",
      "数据库迁移尚未完成，已停止真实调用与扣费。",
    );
  }
  if (
    readiness.capabilities.databaseConfigured &&
    readiness.capabilities.configurationValid &&
    readiness.capabilities.legalReviewConfirmed &&
    readiness.capabilities.resellerAuthorized &&
    readiness.capabilities.upstreamConfigured &&
    !readiness.capabilities.commercialClearanceConfirmed
  ) {
    throw new PlatformError(
      503,
      "commercial_clearance_required",
      "UpstreamProvider 对稳定币仅作为 API 服务付款方式的书面澄清尚未归档，真实代理保持关闭。",
    );
  }
  if (!readiness.capabilities.proxyEnabled) {
    throw new PlatformError(
      503,
      "upstream_not_authorized",
      "上游转售尚未启用；需先完成 UpstreamProvider 经销/白标授权并配置服务端密钥。",
    );
  }
  if (
    !readiness.capabilities.reconciliationConfigured ||
    !readiness.capabilities.catalogReady
  ) {
    throw new PlatformError(
      503,
      "service_not_ready",
      "计费数据库、接口目录或自动对账尚未就绪，已停止真实调用。",
    );
  }
  const db = requireDb(env);
  if (request.method !== "GET" && request.method !== "POST") {
    throw new PlatformError(
      405,
      "method_not_allowed",
      "仅支持目录中经过审核的 GET 或 POST 数据查询。",
    );
  }

  const url = new URL(request.url);
  validateProxyPath(url.pathname);
  let reconciliationRecent = false;
  try {
    const heartbeat = await db
      .prepare(
        `SELECT EXISTS(
           SELECT 1 FROM operation_heartbeats
           WHERE name = 'reconciliation'
             AND datetime(last_success_at) >
                 datetime('now', '-5 minutes')
         ) AS recent`,
      )
      .first<{ recent: number }>();
    reconciliationRecent = Number(heartbeat?.recent ?? 0) === 1;
  } catch {
    throw new PlatformError(
      503,
      "service_not_ready",
      "数据库迁移尚未完成，已停止真实调用与扣费。",
    );
  }
  if (!reconciliationRecent) {
    throw new PlatformError(
      503,
      "reconciliation_stale",
      "自动对账心跳已超时，已停止真实调用与扣费。",
    );
  }
  let catalog: CatalogRecord | null;
  try {
    catalog = await db
      .prepare(
        `SELECT path, platform, http_method, data_type, tags_json, surface,
                operation_id, upstream_price_usd_micros,
                customer_price_usd_micros, price_verified,
                enabled, read_only, safety_classification,
                safety_policy_version, sync_generation,
                EXISTS(
                  SELECT 1
                  FROM catalog_sync_state
                  WHERE id = 1
                    AND ${CATALOG_COVERAGE_WHERE}
                ) AS coverage_verified,
                (SELECT request_count
                 FROM upstream_rate_limit_buckets LIMIT 1)
                  AS _upstream_rate_limit_schema,
                (SELECT request_count
                 FROM payment_rate_limit_buckets LIMIT 1)
                  AS _payment_rate_limit_schema,
                (SELECT next_attempt_at FROM payment_events LIMIT 1)
                  AS _payment_events_schema,
                (SELECT generation FROM catalog_sync_locks LIMIT 1)
                  AS _catalog_sync_locks_schema,
                (SELECT last_success_generation
                 FROM catalog_sync_state LIMIT 1)
                  AS _catalog_sync_state_schema,
                (SELECT openapi_operation_count
                 FROM catalog_sync_state LIMIT 1)
                  AS _catalog_coverage_schema,
                (SELECT generation FROM catalog_sync_staging LIMIT 1)
                  AS _catalog_sync_staging_schema,
                (SELECT safety_classification
                 FROM catalog_sync_staging LIMIT 1)
                  AS _catalog_staging_safety_schema,
                (SELECT data_type || tags_json || surface ||
                        COALESCE(operation_id, '')
                 FROM catalog_sync_staging LIMIT 1)
                  AS _catalog_staging_taxonomy_schema,
                (SELECT idempotency_hash FROM payment_orders LIMIT 1)
                  AS _payment_idempotency_schema,
                (SELECT upstream_cost_usd_micros FROM api_calls LIMIT 1)
                  AS _upstream_cost_schema,
                (SELECT sync_generation FROM endpoint_catalog LIMIT 1)
                  AS _sync_generation_schema,
                (SELECT revision FROM endpoint_catalog LIMIT 1)
                  AS _catalog_revision_schema,
                (SELECT target_digest FROM catalog_batch_plans LIMIT 1)
                  AS _catalog_batch_plans_schema,
                (SELECT expected_revision
                 FROM catalog_batch_plan_items LIMIT 1)
                  AS _catalog_batch_items_schema,
                (SELECT data_type || tags_json || surface ||
                        COALESCE(operation_id, '')
                 FROM catalog_batch_plan_items LIMIT 1)
                  AS _catalog_batch_items_taxonomy_schema
         FROM endpoint_catalog
         WHERE path = ?
           AND price_verified = 1
           AND ${catalogTaxonomyValidWhere("endpoint_catalog")}
           AND sync_generation = (
             SELECT last_success_generation
             FROM catalog_sync_state
             WHERE id = 1
           )`,
      )
      .bind(url.pathname)
      .first<CatalogRecord>();
  } catch {
    throw new PlatformError(
      503,
      "service_not_ready",
      "数据库迁移尚未完成，已停止真实调用与扣费。",
    );
  }
  if (!catalog) {
    throw new PlatformError(
      404,
      "endpoint_not_enabled",
      "该端点尚未通过只读与价格审核。",
    );
  }
  strictStoredCatalogTaxonomy(catalog);
  if (catalog.coverage_verified !== 1) {
    throw new PlatformError(
      503,
      "catalog_coverage_unverified",
      "最近目录缺少完整覆盖证据，已停止真实调用与扣费；请重新同步 UpstreamProvider。",
    );
  }
  if (catalog.enabled !== 1 || catalog.read_only !== 1) {
    throw new PlatformError(
      404,
      "endpoint_not_enabled",
      "该端点尚未通过只读与价格审核。",
    );
  }
  if (
    catalog.safety_policy_version !== CATALOG_SAFETY_POLICY_VERSION ||
    catalog.safety_classification !== "safe_data_read" ||
    isHardProhibitedCatalogOperation(
      catalog.path,
      catalog.http_method as "GET" | "POST",
    )
  ) {
    throw new PlatformError(
      403,
      "unsafe_endpoint",
      "该端点的安全分类已经变化，必须重新同步并审核后才能调用。",
    );
  }
  if (request.method !== catalog.http_method) {
    throw new PlatformError(
      405,
      "method_not_allowed",
      `该端点仅允许 ${catalog.http_method} 请求。`,
    );
  }
  let upstreamBody: string | undefined;
  let parsedUpstreamBody: unknown = null;
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      throw new PlatformError(
        415,
        "unsupported_media_type",
        "POST 数据查询仅接受 application/json 请求体。",
      );
    }
    upstreamBody = await readBodyText(request, MAX_PROXY_BODY_BYTES);
    try {
      const parsed = JSON.parse(upstreamBody) as unknown;
      if (
        (!isPlainRecord(parsed) && !Array.isArray(parsed)) ||
        containsUnsafeJsonNumber(parsed)
      ) {
        throw new Error("unsafe json");
      }
      parsedUpstreamBody = parsed;
    } catch {
      throw new PlatformError(
        400,
        "invalid_json",
        "POST 请求体必须是有效的 JSON 对象或数组。",
      );
    }
  }
  validateCatalogProxyInputs(url, parsedUpstreamBody);

  const secret = bearerToken(request);
  if (!secret || !secret.startsWith("rb_live_")) {
    throw new PlatformError(
      401,
      "invalid_api_key",
      "请使用 Authorization: Bearer rb_live_… 提供 API Key。",
    );
  }
  const keyHash = await sha256Hex(secret);
  const key = await db
    .prepare(
      `SELECT k.id, k.user_id, k.rate_limit_rpm
       FROM api_keys k
       JOIN users u ON u.id = k.user_id
       WHERE k.key_hash = ? AND k.revoked_at IS NULL AND u.status = 'active'`,
    )
    .bind(keyHash)
    .first<ApiKeyRecord>();
  if (!key) {
    throw new PlatformError(
      401,
      "invalid_api_key",
      "API Key 无效或已撤销。",
    );
  }

  const suppliedIdempotencyKey = requireIdempotencyKey(request);
  const idempotencyHash = await sha256Hex(
    `${key.id}:${suppliedIdempotencyKey}`,
  );
  const ledgerReferenceId = `api:${key.id}:${idempotencyHash}:debit`;
  const previous = await db
    .prepare(
      `SELECT id, status
       FROM proxy_requests
       WHERE api_key_id = ? AND idempotency_hash = ?`,
    )
    .bind(key.id, idempotencyHash)
    .first<{ id: string; status: string }>();
  if (previous) {
    throw new PlatformError(
      409,
      "idempotency_conflict",
      `该 Idempotency-Key 已用于请求 ${previous.id}（${previous.status}），未重复调用或扣费。`,
    );
  }
  const maxCostHeader = request.headers.get(
    "x-relaybase-max-cost-usd-micros",
  );
  let maxCostUsdMicros: number | null = null;
  if (maxCostHeader !== null) {
    if (!/^(?:0|[1-9]\d{0,8})$/.test(maxCostHeader)) {
      throw new PlatformError(
        400,
        "invalid_max_cost",
        "X-RelayBase-Max-Cost-Usd-Micros 必须是 0–100000000 的整数。",
      );
    }
    maxCostUsdMicros = Number(maxCostHeader);
    if (
      !Number.isSafeInteger(maxCostUsdMicros) ||
      maxCostUsdMicros > 100_000_000
    ) {
      throw new PlatformError(
        400,
        "invalid_max_cost",
        "X-RelayBase-Max-Cost-Usd-Micros 必须是 0–100000000 的整数。",
      );
    }
    if (catalog.customer_price_usd_micros > maxCostUsdMicros) {
      throw new PlatformError(
        409,
        "price_quote_exceeded",
        "当前接口价格超过请求声明的最高成本，未调用上游或扣费；请刷新目录后重试。",
      );
    }
  }
  const sourceConfig = await loadUpstreamSourceConfig(db, env, true);
  const upstreamCredential = await resolveUpstreamProviderCredential(
    env,
    db,
    sourceConfig,
  );
  if (!upstreamCredential) {
    throw new PlatformError(
      503,
      "upstream_not_configured",
      "UpstreamProvider 服务端密钥尚未配置。",
    );
  }
  if (
    !upstreamProviderCredentialAllowsPath(
      upstreamCredential.scopes,
      url.pathname,
      sourceConfig.apiPathPrefix,
    )
  ) {
    throw new PlatformError(
      403,
      "upstream_credential_scope_denied",
      "当前 UpstreamProvider 活动凭据没有调用该数据接口的权限。",
    );
  }
  const currentCatalogCredential = await db
    .prepare(
      `SELECT EXISTS(
         SELECT 1 FROM catalog_sync_state
         WHERE id = 1 AND last_success_generation = ?
           AND credential_source = ?
           AND credential_id IS ?
           AND credential_fingerprint = ?
           AND credential_state_version = ?
           AND source_config_version = ?
           AND source_config_hash = ?
       ) AS matches_current`,
    )
    .bind(
      catalog.sync_generation,
      upstreamCredential.source,
      upstreamCredential.id,
      upstreamCredential.fingerprint,
      upstreamCredential.stateVersion,
      sourceConfig.version,
      sourceConfig.hash,
    )
    .first<{ matches_current: number }>();
  if (Number(currentCatalogCredential?.matches_current ?? 0) !== 1) {
    throw new PlatformError(
      409,
      "catalog_credential_changed",
      "UpstreamProvider 活动凭据在请求准备期间发生变化，请稍后重试。",
    );
  }

  const minuteBucket = new Date().toISOString().slice(0, 16);
  const rateSlot = await db
    .prepare(
      `INSERT INTO rate_limit_buckets
       (api_key_id, minute_bucket, request_count, updated_at)
       VALUES (?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(api_key_id, minute_bucket) DO UPDATE SET
         request_count = rate_limit_buckets.request_count + 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE rate_limit_buckets.request_count < ?
       RETURNING request_count`,
    )
    .bind(key.id, minuteBucket, key.rate_limit_rpm)
    .first<{ request_count: number }>();
  if (!rateSlot) {
    throw new PlatformError(
      429,
      "rate_limit_exceeded",
      `已达到 ${key.rate_limit_rpm} RPM 限制，请稍后重试。`,
    );
  }

  const reservation = await db
    .prepare(
      `INSERT OR IGNORE INTO proxy_requests
       (id, api_key_id, user_id, idempotency_hash, ledger_reference_id,
        path, status, cost_usd_micros, created_at)
       SELECT ?, ?, ?, ?, ?, ?, 'processing', ?, CURRENT_TIMESTAMP
       WHERE (
         SELECT COUNT(*)
         FROM proxy_requests
         WHERE user_id = ?
           AND status IN ('processing', 'charged')
           AND datetime(created_at) >= datetime('now', '-2 minutes')
       ) < ?`,
    )
    .bind(
      requestId,
      key.id,
      key.user_id,
      idempotencyHash,
      ledgerReferenceId,
      url.pathname,
      catalog.customer_price_usd_micros,
      key.user_id,
      clampInteger(env.ACCOUNT_CONCURRENCY_LIMIT, 5, 1, 50),
    )
    .run();
  if (Number(reservation.meta?.changes ?? 0) !== 1) {
    const previous = await db
      .prepare(
        `SELECT id, status
         FROM proxy_requests
         WHERE api_key_id = ? AND idempotency_hash = ?`,
      )
      .bind(key.id, idempotencyHash)
      .first<{ id: string; status: string }>();
    if (previous) {
      throw new PlatformError(
        409,
        "idempotency_conflict",
        `该 Idempotency-Key 已用于请求 ${previous.id}（${previous.status}），未重复调用或扣费。`,
      );
    }
    throw new PlatformError(
      429,
      "account_concurrency_exceeded",
      "账户并发请求数已达上限，请等待正在处理的请求完成。",
    );
  }

  if (crypto.getRandomValues(new Uint8Array(1))[0] === 0) {
    ctx.waitUntil(
      db
        .prepare(
          `DELETE FROM rate_limit_buckets
           WHERE datetime(updated_at) < datetime('now', '-2 days')`,
        )
        .run(),
    );
    ctx.waitUntil(
      db
        .prepare(
          `DELETE FROM upstream_rate_limit_buckets
           WHERE datetime(updated_at) < datetime('now', '-10 minutes')`,
        )
        .run(),
    );
  }

  const costUsdMicros = catalog.customer_price_usd_micros;
  const debitResult = await db
    .prepare(
      `INSERT INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id, description, created_at)
       SELECT ?, ?, 'api_debit', ?, ?, ?, ?
       WHERE (
         SELECT COALESCE(SUM(delta_usd_micros), 0)
         FROM balance_ledger
         WHERE user_id = ?
       ) >= ?`,
    )
    .bind(
      `led_${randomBase64Url(16)}`,
      key.user_id,
      -costUsdMicros,
      ledgerReferenceId,
      `${request.method} ${url.pathname}`,
      new Date().toISOString(),
      key.user_id,
      costUsdMicros,
    )
    .run();
  if (Number(debitResult.meta?.changes ?? 0) !== 1) {
    await db
      .prepare(`DELETE FROM proxy_requests WHERE id = ? AND status = 'processing'`)
      .bind(requestId)
      .run();
    throw new PlatformError(
      402,
      "insufficient_balance",
      "余额不足，请充值后重试。",
    );
  }

  const upstreamSlot = await db
    .prepare(
      `INSERT INTO upstream_rate_limit_buckets
       (endpoint_path, second_bucket, request_count, updated_at)
       VALUES (?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(endpoint_path, second_bucket) DO UPDATE SET
         request_count = upstream_rate_limit_buckets.request_count + 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE upstream_rate_limit_buckets.request_count < ?
       RETURNING request_count`,
    )
    .bind(
      "__global__",
      new Date().toISOString().slice(0, 19),
      clampInteger(env.UPSTREAM_RATE_LIMIT_RPS, 8, 1, 100),
    )
    .first<{ request_count: number }>();
  if (!upstreamSlot) {
    await refundRequest(
      db,
      key.user_id,
      ledgerReferenceId,
      costUsdMicros,
    );
    await markProxyRequest(db, requestId, "rate_limited", 429);
    throw new PlatformError(
      429,
      "upstream_rate_limit_exceeded",
      "共享上游已达到瞬时速率上限，请在 1 秒后重试。本次未扣费。",
    );
  }
  await markProxyRequest(db, requestId, "charged", null);

  const upstreamUrl = new URL(
    upstreamConfigUrl(
      sourceConfig,
      `${sourceConfig.apiPathPrefix}${url.pathname}`,
    ),
  );
  upstreamUrl.search = url.search;
  const upstreamHeaders = new Headers({
    authorization: `Bearer ${upstreamCredential.secret}`,
    accept: request.headers.get("accept") ?? "application/json",
    "user-agent": "RelayBase-API/1.0",
  });
  if (upstreamBody != null) {
    upstreamHeaders.set("content-type", "application/json");
  }

  const startedAt = Date.now();
  if (upstreamCredential.id) {
    ctx.waitUntil(
      db
        .prepare(
          `UPDATE upstream_credentials
           SET last_used_at = CURRENT_TIMESTAMP
           WHERE id = ? AND provider = 'primary' AND revoked_at IS NULL
             AND EXISTS (
               SELECT 1 FROM upstream_credential_state
               WHERE provider = 'primary'
                 AND active_credential_id = upstream_credentials.id
             )`,
        )
        .bind(upstreamCredential.id)
        .run(),
    );
  }
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body: upstreamBody,
      redirect: "error",
      signal: AbortSignal.timeout(
        clampInteger(env.UPSTREAM_TIMEOUT_MS, 45_000, 30_000, 60_000),
      ),
    });
  } catch {
    await refundRequest(
      db,
      key.user_id,
      ledgerReferenceId,
      costUsdMicros,
    );
    await logApiCall(db, {
      requestId,
      key,
      method: request.method,
      path: url.pathname,
      platform: catalog.platform,
      statusCode: 502,
      costUsdMicros,
      upstreamCostUsdMicros: catalog.upstream_price_usd_micros,
      latencyMs: Date.now() - startedAt,
      refunded: true,
    });
    throw new PlatformError(
      502,
      "upstream_unavailable",
      "上游数据服务暂时不可用，本次未扣费。",
    );
  }

  let successfulPayload: unknown = null;
  if (upstreamResponse.status === 200) {
    try {
      const contentType =
        upstreamResponse.headers.get("content-type")?.toLowerCase() ?? "";
      if (
        !/(?:^|[;\s])application\/(?:[a-z0-9.+-]*\+)?json(?:[;\s]|$)/.test(
          contentType,
        )
      ) {
        throw new Error("upstream success was not JSON");
      }
      const successfulBodyText = await readResponseText(
        upstreamResponse,
        clampInteger(
          env.UPSTREAM_MAX_RESPONSE_BYTES,
          8 * 1024 * 1024,
          64 * 1024,
          16 * 1024 * 1024,
        ),
        "upstream_invalid_response",
      );
      const parsed = JSON.parse(successfulBodyText) as unknown;
      if (!isPlainRecord(parsed) && !Array.isArray(parsed)) {
        throw new Error("upstream JSON must be an object or array");
      }
      successfulPayload =
        isPlainRecord(parsed) &&
        Object.hasOwn(parsed, "data") &&
        (Object.hasOwn(parsed, "code") ||
          Object.hasOwn(parsed, "request_id") ||
          Object.hasOwn(parsed, "requestId"))
          ? parsed.data
          : parsed;
    } catch {
      await refundRequest(
        db,
        key.user_id,
        ledgerReferenceId,
        costUsdMicros,
      );
      try {
        await logApiCall(db, {
          requestId,
          key,
          method: request.method,
          path: url.pathname,
          platform: catalog.platform,
          statusCode: 502,
          costUsdMicros,
          upstreamCostUsdMicros: catalog.upstream_price_usd_micros,
          latencyMs: Date.now() - startedAt,
          refunded: true,
        });
      } catch {
        await markProxyRequest(db, requestId, "reconciled", 500);
      }
      const balance = await currentBalance(db, key.user_id);
      return upstreamErrorResponse(
        502,
        "数据服务返回了不完整、超限或非 JSON 的响应，本次未扣费。",
        requestId,
        new Headers({
          "x-relaybase-cost-usd-micros": "0",
          "x-relaybase-balance-usd-micros": String(balance),
          "cache-control": "private, no-store",
        }),
      );
    }
  }

  const requestState = await db
    .prepare(`SELECT status FROM proxy_requests WHERE id = ?`)
    .bind(requestId)
    .first<{ status: string }>();
  const refunded =
    upstreamResponse.status !== 200 || requestState?.status === "reconciled";
  if (upstreamResponse.status !== 200) {
    await refundRequest(
      db,
      key.user_id,
      ledgerReferenceId,
      costUsdMicros,
    );
  }

  try {
    await logApiCall(db, {
      requestId,
      key,
      method: request.method,
      path: url.pathname,
      platform: catalog.platform,
      statusCode: upstreamResponse.status,
      costUsdMicros,
      upstreamCostUsdMicros: catalog.upstream_price_usd_micros,
      latencyMs: Date.now() - startedAt,
      refunded,
    });
  } catch {
    await refundRequest(
      db,
      key.user_id,
      ledgerReferenceId,
      costUsdMicros,
    );
    await markProxyRequest(db, requestId, "reconciled", 500);
    throw new PlatformError(
      500,
      "request_record_failed",
      "请求记录写入失败，本次已退回余额。",
    );
  }

  const balance = await currentBalance(db, key.user_id);
  const responseHeaders = sanitizeUpstreamHeaders(upstreamResponse.headers);
  responseHeaders.set("x-request-id", requestId);
  responseHeaders.set(
    "x-relaybase-cost-usd-micros",
    refunded ? "0" : String(costUsdMicros),
  );
  responseHeaders.set("x-relaybase-balance-usd-micros", String(balance));
  responseHeaders.set("cache-control", "private, no-store");
  responseHeaders.set("x-content-type-options", "nosniff");

  if (upstreamResponse.status !== 200) {
    const upstreamMessage =
      await providerNeutralUpstreamErrorMessage(upstreamResponse);
    return upstreamErrorResponse(
      upstreamResponse.status,
      upstreamMessage,
      requestId,
      responseHeaders,
    );
  }

  return jsonResponse(
    {
      success: true,
      data: successfulPayload,
    },
    200,
    requestId,
    responseHeaders,
  );
}

const marketplaceReferenceSafetyCache = new Map<
  string,
  ReturnType<typeof classifyCatalogSafety>
>();
const EMPTY_MARKETPLACE_CATALOG: MarketplaceReference["catalog"] = {
  revision: "cat_pending",
  updatedAt: null,
  complete: false,
  serviceCount: 0,
};
type MarketplaceOverlay = {
  rows: Map<string, MarketplaceOverlayRow>;
  catalogReady: boolean;
  catalog: MarketplaceReference["catalog"];
};
const marketplaceOverlayCache = new WeakMap<
  object,
  {
    expiresAt: number;
    value: Promise<MarketplaceOverlay>;
  }
>();

function marketplaceGeneratedSummary(path: string): string {
  const capability = path
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/[_-]+/g, " ")
    .trim();
  return capability
    ? capability.replace(/\b[a-z]/g, (character) =>
        character.toUpperCase(),
      )
    : "Data query";
}

function marketplaceServiceId(
  method: "GET" | "POST" | null,
  path: string,
): string {
  const input = `${method ?? "UNKNOWN"}:${path}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const hint = (path.split("/").pop() ?? "service")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .slice(0, 48);
  return `svc_${hash.toString(36)}_${hint || "service"}`;
}

function marketplaceGeneratedDescription(
  platform: string,
  dataType: CatalogDataType,
): string {
  return `通过 RelayBase 查询 ${platform} 的 ${dataType} 数据。请求参数来自当前运行时目录，只有已审核并核价的服务可以调用。`;
}

function marketplacePublicInputSchema(
  value: unknown,
  depth = 0,
  context: "default" | "properties" | "content" = "default",
): unknown {
  if (depth > 32) return null;
  if (Array.isArray(value)) {
    return value
      .slice(0, 200)
      .map((item) =>
        marketplacePublicInputSchema(item, depth + 1, "default"),
      );
  }
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (
      value.length > 160 ||
      /https?:\/\/|[\u0000-\u001F\u007F]/i.test(value)
    ) {
      return null;
    }
    return value;
  }
  if (!isPlainRecord(value)) return null;
  const allowed = new Set([
    "name",
    "in",
    "required",
    "deprecated",
    "schema",
    "content",
    "type",
    "format",
    "enum",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "items",
    "properties",
    "additionalProperties",
    "nullable",
    "oneOf",
    "anyOf",
    "allOf",
  ]);
  const entries: Array<[string, unknown]> = [];
  for (const [key, child] of Object.entries(value)) {
    if (entries.length >= 200) continue;
    let childContext: "default" | "properties" | "content" =
      "default";
    if (context === "properties") {
      if (
        !/^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/.test(key) ||
        catalogInputFieldRisk(key) !== null
      ) {
        continue;
      }
    } else if (context === "content") {
      if (
        !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(key)
      ) {
        continue;
      }
    } else {
      if (!allowed.has(key)) continue;
      if (key === "properties") childContext = "properties";
      if (key === "content") childContext = "content";
    }
    const sanitized = marketplacePublicInputSchema(
      child,
      depth + 1,
      childContext,
    );
    if (sanitized !== null) entries.push([key, sanitized]);
  }
  return Object.fromEntries(entries);
}

async function loadMarketplaceCatalogOverlay(
  env: PlatformEnv,
): Promise<MarketplaceOverlay> {
  if (!env.DB) {
    return {
      rows: new Map(),
      catalogReady: false,
      catalog: EMPTY_MARKETPLACE_CATALOG,
    };
  }
  const readiness = await operationalReadiness(env);
  if (!readiness.capabilities.schemaReady) {
    return {
      rows: new Map(),
      catalogReady: false,
      catalog: EMPTY_MARKETPLACE_CATALOG,
    };
  }
  try {
    const config = await loadUpstreamSourceConfig(env.DB, env, false);
    if (!config) {
      return {
        rows: new Map(),
        catalogReady: false,
        catalog: EMPTY_MARKETPLACE_CATALOG,
      };
    }
    const [catalogResult, unresolvedResult, stateRow] = await Promise.all([
      env.DB.prepare(
      `SELECT endpoint.path, endpoint.platform, endpoint.http_method,
              endpoint.data_type, endpoint.tags_json, endpoint.surface,
              endpoint.operation_id,
              endpoint.summary, endpoint.description,
              endpoint.parameter_schema_json,
              endpoint.customer_price_usd_micros,
              endpoint.price_verified, endpoint.enabled,
              endpoint.read_only, endpoint.safety_classification,
              endpoint.safety_policy_version, endpoint.updated_at,
              state.openapi_snapshot_hash
                AS catalog_openapi_snapshot_hash,
              state.openapi_operation_count
                AS catalog_openapi_operation_count,
              state.price_only_count AS catalog_price_only_count,
              state.last_success_generation AS catalog_generation
       FROM endpoint_catalog AS endpoint
       JOIN catalog_sync_state AS state
         ON state.id = 1
        AND endpoint.sync_generation = state.last_success_generation
        AND state.source_config_version = ?
        AND state.source_config_hash = ?
       ORDER BY endpoint.path ASC`,
      )
        .bind(config.version, config.hash)
        .all(),
      env.DB.prepare(
        `SELECT unresolved.path, unresolved.platform,
                unresolved.data_type, unresolved.surface,
                unresolved.summary,
                unresolved.customer_price_usd_micros,
                unresolved.price_verified, unresolved.rate_limit_rps,
                unresolved.updated_at, unresolved.sync_generation
         FROM catalog_unresolved_endpoints AS unresolved
         JOIN catalog_sync_state AS state
           ON state.id = 1
          AND unresolved.sync_generation = state.last_success_generation
          AND state.source_config_version = ?
          AND state.source_config_hash = ?
         ORDER BY unresolved.path ASC`,
      )
        .bind(config.version, config.hash)
        .all(),
      env.DB.prepare(
        `SELECT last_success_generation, openapi_operation_count,
                price_only_count, openapi_snapshot_hash,
                price_snapshot_hash, synced_at
         FROM catalog_sync_state
         WHERE id = 1 AND source_config_version = ?
           AND source_config_hash = ?`,
      )
        .bind(config.version, config.hash)
        .first<{
          last_success_generation: string;
          openapi_operation_count: number;
          price_only_count: number;
          openapi_snapshot_hash: string;
          price_snapshot_hash: string;
          synced_at: string;
        }>(),
    ]);
    const catalogRows =
      resultRows<MarketplaceCatalogOverlay>(catalogResult);
    const unresolvedRows =
      resultRows<MarketplaceUnresolvedOverlay>(unresolvedResult);
    const excluded = (path: string) =>
      config.publicExcludedPrefixes.some((prefix) => {
        const exact = prefix.replace(/\/$/, "");
        return path === exact || path.startsWith(prefix);
      });
    const publicCatalogRows = catalogRows.filter(
      (row) => !excluded(row.path),
    );
    const publicUnresolvedRows = unresolvedRows.filter(
      (row) => !excluded(row.path),
    );
    const rows = new Map<string, MarketplaceOverlayRow>();
    for (const row of publicCatalogRows) {
      const method = row.http_method.toUpperCase();
      if (method !== "GET" && method !== "POST") {
        throw new Error("unsupported catalog method");
      }
      const taxonomy = strictStoredCatalogTaxonomy(
        row,
        500,
        "marketplace_overlay_taxonomy_invalid",
        "实时目录分类元数据无效，API 市场已停止发布。",
      );
      rows.set(`${method}:${row.path}`, {
        path: row.path,
        platform: row.platform,
        httpMethod: method,
        dataType: taxonomy.dataType,
        tags: taxonomy.tags,
        surface: taxonomy.surface,
        operationId: taxonomy.operationId,
        summary: row.summary,
        description: row.description,
        parameterSchema: safeStoredJson(row.parameter_schema_json),
        customerPriceUsdMicros: Number(row.customer_price_usd_micros),
        priceVerified: Number(row.price_verified) === 1,
        enabled: Number(row.enabled) === 1,
        readOnly: Number(row.read_only) === 1,
        safetyClassification: row.safety_classification,
        safetyPolicyVersion: Number(row.safety_policy_version),
        rateLimitRps: null,
        updatedAt: row.updated_at,
        documentationStatus: "complete",
      });
    }
    for (const row of publicUnresolvedRows) {
      rows.set(`UNKNOWN:${row.path}`, {
        path: row.path,
        platform: row.platform,
        httpMethod: null,
        dataType: row.data_type,
        tags: [],
        surface: row.surface,
        operationId: null,
        summary: row.summary,
        description: null,
        parameterSchema: null,
        customerPriceUsdMicros: Number(row.customer_price_usd_micros),
        priceVerified: Number(row.price_verified) === 1,
        enabled: false,
        readOnly: false,
        safetyClassification: "ambiguous",
        safetyPolicyVersion: CATALOG_SAFETY_POLICY_VERSION,
        rateLimitRps:
          row.rate_limit_rps == null ? null : Number(row.rate_limit_rps),
        updatedAt: row.updated_at,
        documentationStatus: "pending",
      });
    }
    const stateOperationCount = Number(
      stateRow?.openapi_operation_count ?? 0,
    );
    const statePriceOnlyCount = Number(stateRow?.price_only_count ?? 0);
    const catalogStateMatches =
      stateRow != null &&
      stateOperationCount > 0 &&
      catalogRows.length === stateOperationCount &&
      unresolvedRows.length === statePriceOnlyCount &&
      new Set(
        catalogRows.map(
          (row) => `${row.http_method.toUpperCase()}:${row.path}`,
        ),
      ).size === catalogRows.length &&
      /^[0-9a-f]{64}$/.test(stateRow.openapi_snapshot_hash) &&
      /^[0-9a-f]{64}$/.test(stateRow.price_snapshot_hash);
    const latestUpdate = [...publicCatalogRows, ...publicUnresolvedRows]
      .map((row) => row.updated_at)
      .filter((value) => typeof value === "string" && value.length > 0)
      .sort()
      .at(-1);
    return {
      rows,
      catalogReady:
        catalogStateMatches &&
        readiness.capabilities.catalogReady &&
        readiness.capabilities.proxyEnabled &&
        readiness.capabilities.reconciliationConfigured &&
        readiness.capabilities.reconciliationRecent,
      catalog: {
        revision: stateRow?.last_success_generation ?? null,
        updatedAt: latestUpdate ?? stateRow?.synced_at ?? null,
        complete: catalogStateMatches,
        serviceCount: rows.size,
      },
    };
  } catch (error) {
    console.error("Marketplace overlay unavailable", {
      error: error instanceof Error ? error.message : "unknown error",
    });
    return {
      rows: new Map(),
      catalogReady: false,
      catalog: EMPTY_MARKETPLACE_CATALOG,
    };
  }
}

async function marketplaceCatalogOverlay(
  env: PlatformEnv,
): Promise<MarketplaceOverlay> {
  if (!env.DB || typeof env.DB !== "object") {
    return loadMarketplaceCatalogOverlay(env);
  }
  const cacheKey = env as object;
  const now = Date.now();
  const cached = marketplaceOverlayCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = loadMarketplaceCatalogOverlay(env);
  marketplaceOverlayCache.set(cacheKey, {
    expiresAt: now + 5_000,
    value,
  });
  return value;
}

function mergedMarketplaceEndpoints(
  overlay: Awaited<ReturnType<typeof marketplaceCatalogOverlay>>,
): Array<
  MarketplaceReferenceEndpoint & {
    availability: MarketplaceAvailability;
    pricing: {
      amountUsdMicros: number | null;
      currency: "USD";
      unit: "request";
      verified: boolean;
    };
    rateLimitRps: number | null;
    updatedAt: string | null;
  }
> {
  return [...overlay.rows.values()].map((row) => {
    const path = normalizeCatalogPath(row.path);
    if (row.platform !== path.split("/")[2]) {
      throw new PlatformError(
        500,
        "marketplace_catalog_invalid",
        "运行时目录的平台分类无效。",
      );
    }
    const schema = row.parameterSchema;
    const parameters =
      isPlainRecord(schema) &&
      Array.isArray(schema.parameters) &&
      schema.parameters.length <= 200 &&
      schema.parameters.every(isPlainRecord)
        ? (marketplacePublicInputSchema(
            schema.parameters,
          ) as Record<string, unknown>[])
        : [];
    const requestBody =
      isPlainRecord(schema) && isPlainRecord(schema.requestBody)
        ? (marketplacePublicInputSchema(
            schema.requestBody,
          ) as Record<string, unknown>)
        : null;
    const endpoint: MarketplaceReferenceEndpoint = {
      path,
      id: marketplaceServiceId(row.httpMethod, path),
      platform: row.platform,
      dataType: row.dataType,
      method: row.httpMethod,
      surface: row.surface,
      categories: [row.dataType, row.surface].sort(),
      summary: marketplaceGeneratedSummary(path),
      description: marketplaceGeneratedDescription(
        row.platform,
        row.dataType,
      ),
      parameters,
      requestBody,
      documentationStatus: row.documentationStatus,
    };
    const key = `${endpoint.method ?? "UNKNOWN"}:${endpoint.path}`;
    let staticSafety = marketplaceReferenceSafetyCache.get(key);
    if (!staticSafety && endpoint.method !== null) {
      staticSafety = classifyCatalogSafety(
        endpoint.path,
        endpoint.method,
        {
          summary: endpoint.summary,
          operationId: row.operationId,
          parameters: endpoint.parameters,
          requestBody: endpoint.requestBody,
        },
      );
      marketplaceReferenceSafetyCache.set(key, staticSafety);
    }
    const restricted =
      row.safetyClassification === "prohibited" ||
      staticSafety?.classification === "prohibited";
    const available =
      !restricted &&
      endpoint.method !== null &&
      overlay.catalogReady &&
      row.enabled &&
      row.readOnly &&
      row.priceVerified &&
      row.safetyClassification === "safe_data_read" &&
      row.safetyPolicyVersion === CATALOG_SAFETY_POLICY_VERSION;
    return {
      ...endpoint,
      availability: available
        ? ("available" as const)
        : restricted
          ? ("restricted" as const)
          : ("pending" as const),
      pricing: {
        amountUsdMicros: row.priceVerified
          ? Math.max(0, row.customerPriceUsdMicros)
          : null,
        currency: "USD" as const,
        unit: "request" as const,
        verified: row.priceVerified,
      },
      rateLimitRps: row.rateLimitRps,
      updatedAt: row.updatedAt ?? null,
    };
  });
}

function marketplaceFacet<T extends string>(
  values: T[],
  labels: Partial<Record<T, string>> = {},
) {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({
      value,
      label: labels[value] ?? value,
      count,
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.label.localeCompare(right.label, "zh-CN"),
    );
}

function marketplaceFilters(url: URL) {
  const single = (name: string, maxLength: number): string | null => {
    if (url.searchParams.getAll(name).length > 1) {
      throw new PlatformError(
        400,
        "invalid_marketplace_filter",
        `API 市场筛选参数 ${name} 重复。`,
      );
    }
    const value = url.searchParams.get(name)?.trim() ?? "";
    if (
      value.length > maxLength ||
      /[\u0000-\u001F\u007F]/.test(value)
    ) {
      throw new PlatformError(
        400,
        "invalid_marketplace_filter",
        `API 市场筛选参数 ${name} 无效。`,
      );
    }
    return value || null;
  };
  const q = single("q", 160);
  const platform = single("platform", 64)?.toLowerCase() ?? null;
  const category = single("category", 160)?.toLowerCase() ?? null;
  const dataType = single("dataType", 80)?.toLowerCase() ?? null;
  const methodRaw = single("method", 8)?.toUpperCase() ?? null;
  const surfaceRaw = single("surface", 16)?.toLowerCase() ?? null;
  const availabilityRaw =
    single("availability", 16)?.toLowerCase() ?? null;
  if (methodRaw && methodRaw !== "GET" && methodRaw !== "POST") {
    throw new PlatformError(
      400,
      "invalid_marketplace_filter",
      "API 市场请求方法筛选无效。",
    );
  }
  if (
    surfaceRaw &&
    !["app", "web", "app_web", "other"].includes(surfaceRaw)
  ) {
    throw new PlatformError(
      400,
      "invalid_marketplace_filter",
      "API 市场端类型筛选无效。",
    );
  }
  if (
    availabilityRaw &&
    !["available", "pending", "restricted"].includes(availabilityRaw)
  ) {
    throw new PlatformError(
      400,
      "invalid_marketplace_filter",
      "API 市场可用状态筛选无效。",
    );
  }
  const rawLimit = single("limit", 4);
  const limit = rawLimit == null ? 20 : Number(rawLimit);
  const rawOffset = single("offset", 5);
  const offset = rawOffset == null ? 0 : Number(rawOffset);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 5_000
  ) {
    throw new PlatformError(
      400,
      "invalid_pagination",
      "API 市场分页参数无效。",
    );
  }
  return {
    q: q?.normalize("NFKC").toLowerCase() ?? null,
    platform,
    category,
    dataType,
    method: methodRaw as "GET" | "POST" | null,
    surface: surfaceRaw as MarketplaceSurface | null,
    availability:
      availabilityRaw as MarketplaceAvailability | null,
    limit,
    offset,
  };
}

function marketplacePublicEndpoint(
  endpoint: ReturnType<typeof mergedMarketplaceEndpoints>[number],
) {
  return {
    id: endpoint.id,
    path: endpoint.path,
    platform: endpoint.platform,
    dataType: endpoint.dataType,
    method: endpoint.method,
    surface: endpoint.surface,
    availability: endpoint.availability,
    summary: endpoint.summary,
    pricing: endpoint.pricing,
    rateLimitRps: endpoint.rateLimitRps,
    documentationStatus: endpoint.documentationStatus,
  };
}

function marketplaceResponseShape(
  endpoints: ReturnType<typeof mergedMarketplaceEndpoints>,
  catalog: MarketplaceReference["catalog"],
) {
  const total = endpoints.length;
  const available = endpoints.filter(
    (endpoint) => endpoint.availability === "available",
  ).length;
  const restricted = endpoints.filter(
    (endpoint) => endpoint.availability === "restricted",
  ).length;
  return {
    catalog,
    stats: {
      total,
      available,
      pending: total - available - restricted,
      restricted,
      platforms: new Set(endpoints.map((endpoint) => endpoint.platform))
        .size,
      categories: new Set(
        endpoints.flatMap((endpoint) => endpoint.categories),
      ).size,
      dataTypes: new Set(endpoints.map((endpoint) => endpoint.dataType))
        .size,
    },
    facets: {
      platforms: marketplaceFacet(
        endpoints.map((endpoint) => endpoint.platform),
        {
          bilibili: "Bilibili",
          demo: "Demo",
          douyin: "抖音 / Douyin",
          health: "Health",
          hybrid: "Hybrid",
          instagram: "Instagram",
          ios_shortcut: "iOS Shortcut",
          kuaishou: "快手 / Kuaishou",
          lemon8: "Lemon8",
          linkedin: "LinkedIn",
          pipixia: "皮皮虾 / Pipixia",
          reddit: "Reddit",
          telegram: "Telegram",
          temp_mail: "Temp Mail",
          threads: "Threads",
          tiktok: "TikTok",
          toutiao: "今日头条 / Toutiao",
          twitter: "X / Twitter",
          wechat_channels: "微信视频号",
          wechat_mp: "微信公众号",
          wechat_search: "微信搜索",
          weibo: "微博 / Weibo",
          xiaohongshu: "小红书 / Xiaohongshu",
          xigua: "西瓜视频 / Xigua",
          youtube: "YouTube",
          zhihu: "知乎 / Zhihu",
        },
      ),
      dataTypes: marketplaceFacet(
        endpoints.map((endpoint) => endpoint.dataType),
        {
          account: "账户 / Account",
          analytics_trends: "分析与趋势",
          comments: "评论 / Comments",
          commerce_marketing: "电商与营销",
          content: "内容与作品",
          email: "邮件 / Email",
          live: "直播 / Live",
          media_download: "媒体下载",
          other: "其他 / Other",
          profile_creator: "用户与创作者",
          search_discovery: "搜索与发现",
          social_graph: "关注与社交关系",
          system: "系统 / System",
          taxonomy: "话题与分类",
          utility: "工具 / Utility",
        },
      ),
      categories: marketplaceFacet(
        endpoints.flatMap((endpoint) => endpoint.categories),
      ),
      methods: marketplaceFacet(
        endpoints
          .map((endpoint) => endpoint.method)
          .filter(
            (method): method is "GET" | "POST" => method !== null,
          ),
      ),
      surfaces: marketplaceFacet(
        endpoints.map((endpoint) => endpoint.surface),
        {
          app: "APP",
          web: "WEB",
          app_web: "APP + WEB",
          other: "OTHER",
        },
      ),
      availability: marketplaceFacet(
        endpoints.map((endpoint) => endpoint.availability),
        {
          available: "已开放",
          pending: "待审核",
          restricted: "不开放",
        },
      ),
    },
  };
}

async function handleMarketplace(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const filters = marketplaceFilters(url);
  const overlay = await marketplaceCatalogOverlay(env);
  const endpoints = mergedMarketplaceEndpoints(overlay);
  const summary = marketplaceResponseShape(endpoints, overlay.catalog);
  const filtered = endpoints.filter((endpoint) => {
    if (
      filters.platform &&
      endpoint.platform.toLowerCase() !== filters.platform
    ) {
      return false;
    }
    if (
      filters.dataType &&
      endpoint.dataType.toLowerCase() !== filters.dataType
    ) {
      return false;
    }
    if (
      filters.category &&
      !endpoint.categories.some(
        (category) => category.toLowerCase() === filters.category,
      )
    ) {
      return false;
    }
    if (filters.method && endpoint.method !== filters.method) return false;
    if (filters.surface && endpoint.surface !== filters.surface) return false;
    if (
      filters.availability &&
      endpoint.availability !== filters.availability
    ) {
      return false;
    }
    if (filters.q) {
      const searchable = [
        endpoint.path,
        endpoint.platform,
        endpoint.dataType,
        endpoint.summary ?? "",
        endpoint.description ?? "",
        ...endpoint.categories,
      ]
        .join(" ")
        .normalize("NFKC")
        .toLowerCase();
      if (!searchable.includes(filters.q)) return false;
    }
    return true;
  });
  const page = filtered.slice(
    filters.offset,
    filters.offset + filters.limit,
  );
  return jsonResponse(
    {
      ...summary,
      endpoints: page.map(marketplacePublicEndpoint),
      count: page.length,
      total: filtered.length,
      offset: filters.offset,
      nextOffset:
        filters.offset + page.length < filtered.length
          ? filters.offset + page.length
          : null,
    },
    200,
    requestId,
    { "cache-control": "no-store" },
  );
}

function marketplaceExampleScalar(
  parameter: Record<string, unknown>,
): string {
  const schema = isPlainRecord(parameter.schema)
    ? parameter.schema
    : {};
  const candidates = [
    parameter.example,
    schema.example,
    schema.default,
    Array.isArray(schema.enum) ? schema.enum[0] : undefined,
  ];
  for (const candidate of candidates) {
    if (
      typeof candidate === "string" &&
      candidate.length > 0 &&
      candidate.length <= 120 &&
      !/[\u0000-\u001F\u007F]/.test(candidate)
    ) {
      return candidate;
    }
    if (
      typeof candidate === "number" &&
      Number.isFinite(candidate)
    ) {
      return String(candidate);
    }
    if (typeof candidate === "boolean") return String(candidate);
  }
  if (schema.type === "integer" || schema.type === "number") return "1";
  if (schema.type === "boolean") return "true";
  return `YOUR_${String(parameter.name ?? "VALUE")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase()
    .slice(0, 48)}`;
}

function marketplaceRequestBodyExample(
  requestBody: Record<string, unknown> | null,
): unknown {
  if (!requestBody) return {};
  const content = isPlainRecord(requestBody.content)
    ? requestBody.content
    : null;
  const media = content && isPlainRecord(content["application/json"])
    ? content["application/json"]
    : null;
  const schema = media && isPlainRecord(media.schema) ? media.schema : null;
  const boundedExample = (value: unknown): unknown | undefined => {
    if (value === undefined) return undefined;
    try {
      const serialized = JSON.stringify(value);
      if (
        typeof serialized !== "string" ||
        serialized.length > MAX_OPENAPI_INPUT_SCHEMA_BYTES
      ) {
        return undefined;
      }
      return JSON.parse(serialized) as unknown;
    } catch {
      return undefined;
    }
  };
  const mediaExample = boundedExample(
    redactCatalogExampleAgainstSchema(media?.example, schema),
  );
  if (mediaExample !== undefined) return mediaExample;
  const build = (
    node: Record<string, unknown> | null,
    depth: number,
    fieldName?: string,
  ): unknown => {
    if (!node || depth > 4) return {};
    if (fieldName && catalogInputFieldRisk(fieldName) != null) {
      return redactedCatalogExample(fieldName);
    }
    const declaredExample = boundedExample(
      redactCatalogExampleAgainstSchema(node.example, node, fieldName),
    );
    if (declaredExample !== undefined) return declaredExample;
    if (
      typeof node.default === "string" ||
      typeof node.default === "number" ||
      typeof node.default === "boolean"
    ) {
      return node.default;
    }
    if (Array.isArray(node.enum) && node.enum.length > 0) {
      return node.enum[0];
    }
    if (node.type === "array") {
      return [
        build(
          isPlainRecord(node.items) ? node.items : null,
          depth + 1,
          fieldName,
        ),
      ];
    }
    if (isPlainRecord(node.properties)) {
      return Object.fromEntries(
        Object.entries(node.properties)
          .slice(0, 12)
          .map(([name, child]) => [
            name,
            build(
              isPlainRecord(child) ? child : null,
              depth + 1,
              name,
            ),
          ]),
      );
    }
    if (node.type === "integer" || node.type === "number") return 1;
    if (node.type === "boolean") return true;
    return "YOUR_VALUE";
  };
  return build(schema, 0);
}

function marketplaceCodeExamples(
  request: Request,
  endpoint: ReturnType<typeof mergedMarketplaceEndpoints>[number],
) {
  if (endpoint.method === null) {
    return { curl: "", javascript: "", python: "" };
  }
  const origin = new URL(request.url).origin;
  const queryParameters = endpoint.parameters
    .filter(
      (parameter) =>
        parameter.in === "query" &&
        typeof parameter.name === "string" &&
        catalogInputFieldRisk(parameter.name) == null,
    )
    .slice(0, 20);
  const query = new URLSearchParams();
  for (const parameter of queryParameters) {
    query.set(String(parameter.name), marketplaceExampleScalar(parameter));
  }
  const url = `${origin}${endpoint.path}${
    query.size > 0 ? `?${query.toString()}` : ""
  }`;
  const body = marketplaceRequestBodyExample(endpoint.requestBody);
  const bodyJson = JSON.stringify(body, null, 2);
  const hasBody = endpoint.method === "POST";
  const curl = [
    `curl --request ${endpoint.method} \\`,
    `  '${url}' \\`,
    "  --header 'Authorization: Bearer rb_live_YOUR_KEY' \\",
    "  --header 'Idempotency-Key: marketplace-example-001' \\",
    ...(endpoint.pricing.amountUsdMicros !== null
      ? [
          `  --header 'X-RelayBase-Max-Cost-Usd-Micros: ${endpoint.pricing.amountUsdMicros}' \\`,
        ]
      : []),
    ...(hasBody
      ? [
          "  --header 'Content-Type: application/json' \\",
          `  --data '${bodyJson.replaceAll("'", "'\\''")}'`,
        ]
      : ["  --header 'Accept: application/json'"]),
  ].join("\n");
  const javascript = `const response = await fetch(${JSON.stringify(url)}, {
  method: "${endpoint.method}",
  headers: {
    Authorization: "Bearer rb_live_YOUR_KEY",
    "Idempotency-Key": "marketplace-example-001",
    ${
      endpoint.pricing.amountUsdMicros !== null
        ? `"X-RelayBase-Max-Cost-Usd-Micros": "${endpoint.pricing.amountUsdMicros}",`
        : ""
    }
    Accept: "application/json",${
      hasBody ? '\n    "Content-Type": "application/json",' : ""
    }
  },${hasBody ? `\n  body: JSON.stringify(${bodyJson}),` : ""}
});

const payload = await response.json();
if (!response.ok) throw new Error(payload.error?.message ?? "Request failed");`;
  const pythonParams = Object.fromEntries(
    queryParameters.map((parameter) => [
      String(parameter.name),
      marketplaceExampleScalar(parameter),
    ]),
  );
  const python = `import json
import requests

response = requests.${endpoint.method.toLowerCase()}(
    ${JSON.stringify(`${origin}${endpoint.path}`)},
    headers={
        "Authorization": "Bearer rb_live_YOUR_KEY",
        "Idempotency-Key": "marketplace-example-001",
        ${
          endpoint.pricing.amountUsdMicros !== null
            ? `"X-RelayBase-Max-Cost-Usd-Micros": "${endpoint.pricing.amountUsdMicros}",`
            : ""
        }
        "Accept": "application/json",
    },${
      Object.keys(pythonParams).length > 0
        ? `\n    params=${JSON.stringify(pythonParams, null, 4)},`
        : ""
    }${
      hasBody
        ? `\n    json=json.loads(${JSON.stringify(JSON.stringify(body))}),`
        : ""
    }
    timeout=30,
)
response.raise_for_status()
payload = response.json()`;
  return { curl, javascript, python };
}

async function handleMarketplaceDetail(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    url.searchParams.getAll("path").length !== 1 ||
    url.searchParams.getAll("method").length > 1
  ) {
    throw new PlatformError(
      400,
      "invalid_marketplace_endpoint",
      "API 市场详情参数无效。",
    );
  }
  const path = normalizeCatalogPath(url.searchParams.get("path") ?? "");
  const rawMethod = url.searchParams.get("method");
  const method = rawMethod?.toUpperCase() ?? null;
  if (method !== null && method !== "GET" && method !== "POST") {
    throw new PlatformError(
      400,
      "invalid_marketplace_endpoint",
      "API 市场请求方法无效。",
    );
  }
  const overlay = await marketplaceCatalogOverlay(env);
  const endpoint = mergedMarketplaceEndpoints(overlay).find(
    (candidate) =>
      candidate.path === path &&
      (method === null
        ? candidate.method === null
        : candidate.method === method),
  );
  if (!endpoint) {
    throw new PlatformError(
      404,
      "marketplace_endpoint_not_found",
      "API 市场中没有这个端点。",
    );
  }
  return jsonResponse(
    {
      catalog: overlay.catalog,
      endpoint: {
        ...marketplacePublicEndpoint(endpoint),
        categories: endpoint.categories,
        description: endpoint.description,
        input: {
          parameters:
            endpoint.documentationStatus === "complete"
              ? endpoint.parameters
              : null,
          requestBody:
            endpoint.documentationStatus === "complete"
              ? endpoint.requestBody
              : null,
        },
        response: {
          contentType: "application/json",
          mode: "relaybase_envelope",
          schema: null,
          description:
            "成功时返回 RelayBase 的 { success: true, data } JSON 包装；外部服务控制字段不会透传。",
        },
      },
      examples: marketplaceCodeExamples(request, endpoint),
    },
    200,
    requestId,
    { "cache-control": "no-store" },
  );
}

type CatalogListFilters = {
  q: string | null;
  platform: string | null;
  dataType: CatalogDataType | null;
  tag: string | null;
  surface: MarketplaceSurface | null;
  method: "GET" | "POST" | null;
  status: "all" | "enabled" | "disabled" | "review";
  safety:
    | "all"
    | "safe_data_read"
    | "ambiguous"
    | "prohibited";
  limit: number;
  offset: number;
};

function normalizeCatalogListFilters(
  url: URL,
  options: {
    admin: boolean;
    defaultLimit: number;
    maxLimit: number;
    maxOffset: number;
  },
): CatalogListFilters {
  const single = (name: string, maxLength: number): string | null => {
    if (url.searchParams.getAll(name).length > 1) {
      throw new PlatformError(
        400,
        "invalid_catalog_filter",
        `目录筛选参数 ${name} 重复。`,
      );
    }
    const value = url.searchParams.get(name)?.trim() ?? "";
    if (
      value.length > maxLength ||
      /[\u0000-\u001F\u007F]/.test(value)
    ) {
      throw new PlatformError(
        400,
        "invalid_catalog_filter",
        `目录筛选参数 ${name} 无效。`,
      );
    }
    return value || null;
  };
  const q = single("q", 160)?.normalize("NFKC").toLowerCase() ?? null;
  const platform =
    single("platform", 64)?.normalize("NFKC").toLowerCase() ?? null;
  if (
    platform !== null &&
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(platform)
  ) {
    throw new PlatformError(
      400,
      "invalid_catalog_filter",
      "目录平台筛选参数无效。",
    );
  }
  const dataTypeRaw =
    single("dataType", 80)?.normalize("NFKC").toLowerCase() ?? null;
  if (dataTypeRaw && !PROVIDER_DATA_TYPES.includes(dataTypeRaw)) {
    throw new PlatformError(
      400,
      "invalid_catalog_filter",
      "目录数据类型筛选参数无效。",
    );
  }
  const tag =
    single("tag", 160)?.normalize("NFKC").toLowerCase() ?? null;
  const surfaceRaw =
    single("surface", 16)?.normalize("NFKC").toLowerCase() ?? null;
  if (surfaceRaw && !PROVIDER_SURFACES.includes(surfaceRaw)) {
    throw new PlatformError(
      400,
      "invalid_catalog_filter",
      "目录端类型筛选参数无效。",
    );
  }
  const methodRaw = single("method", 8)?.toUpperCase() ?? null;
  if (methodRaw && methodRaw !== "GET" && methodRaw !== "POST") {
    throw new PlatformError(
      400,
      "invalid_catalog_filter",
      "目录请求方法筛选参数无效。",
    );
  }
  const statusRaw =
    single("status", 16)?.normalize("NFKC").toLowerCase() ?? "all";
  const safetyRaw =
    single("safety", 32)?.normalize("NFKC").toLowerCase() ?? "all";
  if (
    (!options.admin &&
      (url.searchParams.has("status") ||
        url.searchParams.has("safety"))) ||
    !["all", "enabled", "disabled", "review"].includes(statusRaw) ||
    ![
      "all",
      "safe_data_read",
      "ambiguous",
      "prohibited",
    ].includes(safetyRaw)
  ) {
    throw new PlatformError(
      400,
      "invalid_catalog_filter",
      "目录状态或安全分类筛选参数无效。",
    );
  }
  const rawLimit = single("limit", 6);
  const limit =
    rawLimit == null ? options.defaultLimit : Number(rawLimit);
  const rawOffset = single("offset", 8);
  const offset = rawOffset == null ? 0 : Number(rawOffset);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > options.maxLimit ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > options.maxOffset
  ) {
    throw new PlatformError(
      400,
      "invalid_pagination",
      "目录分页参数无效。",
    );
  }
  return {
    q,
    platform,
    dataType: dataTypeRaw as CatalogDataType | null,
    tag,
    surface: surfaceRaw as MarketplaceSurface | null,
    method: methodRaw as "GET" | "POST" | null,
    status: statusRaw as CatalogListFilters["status"],
    safety: safetyRaw as CatalogListFilters["safety"],
    limit,
    offset,
  };
}

function appendCatalogTaxonomyFilters(
  clauses: string[],
  bindings: unknown[],
  filters: CatalogListFilters,
  alias = "endpoint_catalog",
): void {
  if (filters.platform) {
    clauses.push(`${alias}.platform = ?`);
    bindings.push(filters.platform);
  }
  if (filters.dataType) {
    clauses.push(`${alias}.data_type = ?`);
    bindings.push(filters.dataType);
  }
  if (filters.surface) {
    clauses.push(`${alias}.surface = ?`);
    bindings.push(filters.surface);
  }
  if (filters.method) {
    clauses.push(`${alias}.http_method = ?`);
    bindings.push(filters.method);
  }
  if (filters.tag) {
    clauses.push(
      `EXISTS (
         SELECT 1
         FROM json_each(${alias}.tags_json) AS catalog_tag
         WHERE lower(catalog_tag.value) = ?
       )`,
    );
    bindings.push(filters.tag);
  }
  if (filters.q) {
    const escaped = filters.q
      .replaceAll("\\", "\\\\")
      .replaceAll("%", "\\%")
      .replaceAll("_", "\\_");
    clauses.push(
      `(lower(${alias}.path) LIKE ? ESCAPE '\\' OR
        lower(${alias}.platform) LIKE ? ESCAPE '\\' OR
        lower(${alias}.data_type) LIKE ? ESCAPE '\\' OR
        lower(COALESCE(${alias}.summary, '')) LIKE ? ESCAPE '\\' OR
        lower(COALESCE(${alias}.operation_id, '')) LIKE ? ESCAPE '\\')`,
    );
    bindings.push(
      `%${escaped}%`,
      `%${escaped}%`,
      `%${escaped}%`,
      `%${escaped}%`,
      `%${escaped}%`,
    );
  }
}

async function handlePublicCatalog(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  const db = requireDb(env);
  const url = new URL(request.url);
  const sourceConfig = await loadUpstreamSourceConfig(db, env, false);
  const filters = normalizeCatalogListFilters(url, {
    admin: false,
    defaultLimit: 200,
    maxLimit: 200,
    maxOffset: 5_000,
  });
  await assertStoredCatalogTaxonomyIntegrity(db);
  if (!sourceConfig) {
    const readiness = await operationalReadiness(env);
    return jsonResponse(
      {
        mode: readiness.mode,
        catalog: {
          revision: "cat_pending",
          updatedAt: null,
          complete: false,
        },
        endpoints: [],
        count: 0,
        total: 0,
        offset: filters.offset,
        nextOffset: null,
      },
      200,
      requestId,
      { "cache-control": "public, max-age=30, s-maxage=60" },
    );
  }
  const clauses = [
    "endpoint_catalog.enabled = 1",
    "endpoint_catalog.read_only = 1",
    "endpoint_catalog.price_verified = 1",
    "endpoint_catalog.safety_classification = 'safe_data_read'",
    `endpoint_catalog.safety_policy_version =
       ${CATALOG_SAFETY_POLICY_VERSION}`,
    catalogTaxonomyValidWhere("endpoint_catalog"),
    `endpoint_catalog.sync_generation = (
       SELECT last_success_generation
       FROM catalog_sync_state
       WHERE id = 1
     )`,
    `EXISTS (
       SELECT 1 FROM catalog_sync_state
       WHERE id = 1 AND ${CATALOG_COVERAGE_WHERE}
         AND source_config_version = ?
         AND source_config_hash = ?
     )`,
  ];
  const bindings: unknown[] = [
    sourceConfig.version,
    sourceConfig.hash,
  ];
  for (const prefix of sourceConfig.publicExcludedPrefixes) {
    clauses.push(
      "endpoint_catalog.path != ? AND endpoint_catalog.path NOT LIKE ?",
    );
    bindings.push(prefix.replace(/\/$/, ""), `${prefix}%`);
  }
  appendCatalogTaxonomyFilters(clauses, bindings, filters);
  const where = clauses.join(" AND ");
  const query = db
    .prepare(
      `SELECT path, platform, http_method, data_type, tags_json, surface,
              operation_id, summary, customer_price_usd_micros, updated_at
       FROM endpoint_catalog
       WHERE ${where}
       ORDER BY platform ASC, path ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, filters.limit, filters.offset);
  const countQuery = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM endpoint_catalog
       WHERE ${where}`,
    )
    .bind(...bindings);
  const rows = await query.all<{
    path: string;
    platform: string;
    http_method: string;
    data_type: CatalogDataType;
    tags_json: string;
    surface: MarketplaceSurface;
    operation_id: string | null;
    summary: string | null;
    customer_price_usd_micros: number;
    updated_at: string;
  }>();
  const endpoints = (rows.results ?? []).map((row) => {
    const taxonomy = strictStoredCatalogTaxonomy(row);
    return {
      id: marketplaceServiceId(
        row.http_method as "GET" | "POST",
        row.path,
      ),
      path: row.path,
      platform: row.platform,
      dataType: taxonomy.dataType,
      categories: [taxonomy.dataType, taxonomy.surface].sort(),
      surface: taxonomy.surface,
      method: row.http_method,
      summary: marketplaceGeneratedSummary(row.path),
      pricing: {
        amountUsdMicros: row.customer_price_usd_micros,
        currency: "USD",
        unit: "request",
        verified: true,
      },
      updatedAt: row.updated_at,
    };
  });
  const countRow = await countQuery.first<{ count: number }>();
  const catalogState = await db
    .prepare(
      `SELECT last_success_generation, synced_at,
              CASE WHEN ${CATALOG_COVERAGE_WHERE}
                   THEN 1 ELSE 0 END AS complete
       FROM catalog_sync_state
       WHERE id = 1 AND source_config_version = ?
         AND source_config_hash = ?`,
    )
    .bind(sourceConfig.version, sourceConfig.hash)
    .first<{
      last_success_generation: string;
      synced_at: string;
      complete: number;
    }>();
  const total = Number(countRow?.count ?? 0);
  const nextOffset =
    filters.offset + endpoints.length < total &&
    filters.offset + endpoints.length < 5_000
      ? filters.offset + endpoints.length
      : null;
  const readiness = await operationalReadiness(env);

  return jsonResponse(
    {
      mode: readiness.mode,
      catalog: {
        revision:
          catalogState?.last_success_generation ?? "cat_pending",
        updatedAt:
          endpoints
            .map((endpoint) => endpoint.updatedAt)
            .sort()
            .at(-1) ??
          catalogState?.synced_at ??
          null,
        complete: Number(catalogState?.complete ?? 0) === 1,
      },
      endpoints,
      count: endpoints.length,
      total,
      offset: filters.offset,
      nextOffset,
    },
    200,
    requestId,
    {
      "cache-control": "public, max-age=30, s-maxage=60",
    },
  );
}

async function handleCatalogList(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "catalog");
  const db = requireDb(env);
  const url = new URL(request.url);
  const filters = normalizeCatalogListFilters(url, {
    admin: true,
    defaultLimit: 200,
    maxLimit: 500,
    maxOffset: 100_000,
  });
  await assertStoredCatalogTaxonomyIntegrity(db);
  const clauses = ["1 = 1"];
  const bindings: unknown[] = [];
  appendCatalogTaxonomyFilters(clauses, bindings, filters);
  if (filters.status === "enabled") {
    clauses.push("endpoint_catalog.enabled = 1");
  } else if (filters.status === "disabled") {
    clauses.push("endpoint_catalog.enabled = 0");
  } else if (filters.status === "review") {
    clauses.push(
      `(endpoint_catalog.reviewed_at IS NULL OR
        endpoint_catalog.sync_generation IS NULL OR
        endpoint_catalog.sync_generation != (
          SELECT last_success_generation
          FROM catalog_sync_state
          WHERE id = 1
        ) OR
        endpoint_catalog.price_verified != 1 OR
        endpoint_catalog.safety_classification != 'safe_data_read' OR
        endpoint_catalog.safety_policy_version !=
          ${CATALOG_SAFETY_POLICY_VERSION})`,
    );
  }
  if (filters.safety !== "all") {
    clauses.push("endpoint_catalog.safety_classification = ?");
    bindings.push(filters.safety);
  }
  const where = clauses.join(" AND ");
  const rows = await db
    .prepare(
      `SELECT path, platform, http_method, summary, description,
              data_type, tags_json, surface, operation_id,
              parameter_schema_json, upstream_price_usd_micros,
              customer_price_usd_micros, price_verified, enabled, read_only,
              safety_classification, safety_reasons_json,
              safety_policy_version, revision,
              source_updated_at, sync_generation, reviewed_at, updated_at,
              sync_generation = (
                SELECT last_success_generation
                FROM catalog_sync_state
                WHERE id = 1
              ) AS present_in_latest_sync
       FROM endpoint_catalog
       WHERE ${where}
       ORDER BY platform ASC, path ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, filters.limit, filters.offset)
    .all<{
      path: string;
      platform: string;
      http_method: string;
      data_type: CatalogDataType;
      tags_json: string;
      surface: MarketplaceSurface;
      operation_id: string | null;
      summary: string | null;
      description: string | null;
      parameter_schema_json: string | null;
      upstream_price_usd_micros: number;
      customer_price_usd_micros: number;
      price_verified: number;
      enabled: number;
      read_only: number;
      safety_classification: CatalogSafetyClassification;
      safety_reasons_json: string | null;
      safety_policy_version: number;
      revision: number;
      source_updated_at: string | null;
      sync_generation: string | null;
      present_in_latest_sync: number | null;
      reviewed_at: string | null;
      updated_at: string;
    }>();

  const totalRow = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM endpoint_catalog
       WHERE ${where}`,
    )
    .bind(...bindings)
    .first<{ count: number }>();
  const syncRow = await db
    .prepare(
      `SELECT last_success_generation, credential_fingerprint,
              openapi_version, openapi_operation_count,
              raw_price_row_count, normalized_price_count,
              openapi_price_mapped_count, price_only_count,
              openapi_only_count, scope_excluded_count,
              matched_price_count, positive_price_count,
              zero_price_count, awaiting_price_count,
              openapi_snapshot_hash, price_snapshot_hash, synced_at,
              CASE
                  WHEN ${CATALOG_COVERAGE_WHERE} THEN 1
                  ELSE 0
                END AS coverage_verified
       FROM catalog_sync_state
       WHERE id = 1`,
    )
    .first<{
      last_success_generation: string;
      credential_fingerprint: string | null;
      openapi_version: string | null;
      openapi_operation_count: number | null;
      raw_price_row_count: number | null;
      normalized_price_count: number | null;
      openapi_price_mapped_count: number | null;
      price_only_count: number | null;
      openapi_only_count: number | null;
      scope_excluded_count: number | null;
      matched_price_count: number | null;
      positive_price_count: number | null;
      zero_price_count: number | null;
      awaiting_price_count: number | null;
      openapi_snapshot_hash: string | null;
      price_snapshot_hash: string | null;
      synced_at: string;
      coverage_verified: number;
    }>();
  const marketplaceOverlay = await marketplaceCatalogOverlay(env);
  const marketplaceAvailabilityByKey = new Map<
    string,
    MarketplaceAvailability
  >(
    mergedMarketplaceEndpoints(marketplaceOverlay)
      .filter((endpoint) => endpoint.method !== null)
      .map((endpoint) => [
        `${endpoint.method}:${endpoint.path}`,
        endpoint.availability,
      ] as const),
  );
  const total = Number(totalRow?.count ?? 0);
  const endpoints = (rows.results ?? []).map((row) => {
    const taxonomy = strictStoredCatalogTaxonomy(row);
    const marketplaceAvailability =
      marketplaceAvailabilityByKey.get(
        `${row.http_method.toUpperCase()}:${row.path}`,
      ) ?? "pending";
    const availabilityReasons: string[] = [];
    if (!marketplaceAvailabilityByKey.has(
      `${row.http_method.toUpperCase()}:${row.path}`,
    )) {
      availabilityReasons.push("not_in_public_catalog");
    }
    if (row.enabled !== 1) {
      availabilityReasons.push("pending_confirmation");
    }
    if (row.read_only !== 1) {
      availabilityReasons.push("read_only_not_confirmed");
    }
    if (row.price_verified !== 1) {
      availabilityReasons.push("price_unverified");
    }
    if (row.present_in_latest_sync !== 1) {
      availabilityReasons.push("not_in_latest_sync");
    }
    if (
      row.safety_classification !== "safe_data_read" ||
      row.safety_policy_version !== CATALOG_SAFETY_POLICY_VERSION
    ) {
      availabilityReasons.push("safety_not_approved");
    }
    if (!marketplaceOverlay.catalogReady) {
      availabilityReasons.push("runtime_not_ready");
    }
    if (
      marketplaceAvailability === "restricted" &&
      !availabilityReasons.includes("safety_not_approved")
    ) {
      availabilityReasons.push("safety_restricted");
    }
    return {
      path: row.path,
      platform: row.platform,
      dataType: taxonomy.dataType,
      tags: taxonomy.tags,
      surface: taxonomy.surface,
      operationId: taxonomy.operationId,
      method: row.http_method,
      summary: row.summary,
      description: row.description,
      parameterSchema: safeStoredJson(row.parameter_schema_json),
      upstreamPriceUsdMicros: row.upstream_price_usd_micros,
      customerPriceUsdMicros: row.customer_price_usd_micros,
      priceVerified: row.price_verified === 1,
      enabled: row.enabled === 1,
      readOnly: row.read_only === 1,
      safetyClassification: row.safety_classification,
      safetyReasons: safeStoredStringArray(row.safety_reasons_json),
      safetyPolicyVersion: row.safety_policy_version,
      revision: row.revision,
      sourceUpdatedAt: row.source_updated_at,
      presentInLatestSync: row.present_in_latest_sync === 1,
      marketplaceAvailability,
      availabilityReasons,
      reviewedAt: row.reviewed_at,
      updatedAt: row.updated_at,
    };
  });

  return jsonResponse(
    {
      endpoints,
      count: endpoints.length,
      total,
      offset: filters.offset,
      nextOffset:
        filters.offset + endpoints.length < total
          ? filters.offset + endpoints.length
          : null,
      sync: syncRow
        ? {
            generation: syncRow.last_success_generation,
            credentialFingerprint: syncRow.credential_fingerprint,
            syncedAt: syncRow.synced_at,
            coverage:
              syncRow.coverage_verified === 1 &&
              syncRow.openapi_operation_count != null &&
              syncRow.raw_price_row_count != null &&
              syncRow.normalized_price_count != null &&
              syncRow.openapi_price_mapped_count != null &&
              syncRow.price_only_count != null &&
              syncRow.openapi_only_count != null &&
              syncRow.scope_excluded_count != null &&
              syncRow.matched_price_count != null &&
              syncRow.positive_price_count != null &&
              syncRow.zero_price_count != null &&
              syncRow.awaiting_price_count != null
                ? {
                    openApiVersion: syncRow.openapi_version,
                    openApiOperations: syncRow.openapi_operation_count,
                    rawPriceRows: syncRow.raw_price_row_count,
                    normalizedPrices: syncRow.normalized_price_count,
                    openApiPriceMapped:
                      syncRow.openapi_price_mapped_count,
                    priceOnly: syncRow.price_only_count,
                    openApiOnly: syncRow.openapi_only_count,
                    scopeExcluded: syncRow.scope_excluded_count,
                    matchedPrices: syncRow.matched_price_count,
                    positivePrices: syncRow.positive_price_count,
                    zeroPrices: syncRow.zero_price_count,
                    awaitingPrice: syncRow.awaiting_price_count,
                    openApiSnapshotHash: syncRow.openapi_snapshot_hash,
                    priceSnapshotHash: syncRow.price_snapshot_hash,
                  }
                : null,
          }
        : null,
    },
    200,
    requestId,
  );
}

async function handlePendingCatalogList(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "catalog");
  const db = requireDb(env);
  const url = new URL(request.url);
  const single = (name: string, maxLength: number): string => {
    if (url.searchParams.getAll(name).length > 1) {
      throw new PlatformError(
        400,
        "invalid_catalog_filter",
        `待补全文档目录筛选参数 ${name} 重复。`,
      );
    }
    const value = url.searchParams.get(name)?.trim() ?? "";
    if (
      value.length > maxLength ||
      /[\u0000-\u001F\u007F]/.test(value)
    ) {
      throw new PlatformError(
        400,
        "invalid_catalog_filter",
        `待补全文档目录筛选参数 ${name} 无效。`,
      );
    }
    return value;
  };
  const limit = Number(single("limit", 4) || "200");
  const offset = Number(single("offset", 6) || "0");
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 500 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100_000
  ) {
    throw new PlatformError(
      400,
      "invalid_pagination",
      "待补全文档目录分页参数无效。",
    );
  }
  const q = single("q", 160).normalize("NFKC").toLowerCase();
  const platform = single("platform", 80).toLowerCase();
  const dataType = single("dataType", 80).toLowerCase();
  const surface = single("surface", 16).toLowerCase();
  if (dataType && !PROVIDER_DATA_TYPES.includes(dataType)) {
    throw new PlatformError(
      400,
      "invalid_catalog_filter",
      "待补全文档目录数据类型筛选无效。",
    );
  }
  if (surface && !PROVIDER_SURFACES.includes(surface)) {
    throw new PlatformError(
      400,
      "invalid_catalog_filter",
      "待补全文档目录入口筛选无效。",
    );
  }
  const clauses = [
    `sync_generation = (
       SELECT last_success_generation
       FROM catalog_sync_state
       WHERE id = 1
     )`,
  ];
  const bindings: unknown[] = [];
  if (platform) {
    clauses.push("platform = ?");
    bindings.push(platform);
  }
  if (dataType) {
    clauses.push("data_type = ?");
    bindings.push(dataType);
  }
  if (surface) {
    clauses.push("surface = ?");
    bindings.push(surface);
  }
  if (q) {
    const escaped = q
      .replaceAll("\\", "\\\\")
      .replaceAll("%", "\\%")
      .replaceAll("_", "\\_");
    clauses.push(
      `(lower(path) LIKE ? ESCAPE '\\' OR
        lower(platform) LIKE ? ESCAPE '\\' OR
        lower(data_type) LIKE ? ESCAPE '\\' OR
        lower(COALESCE(summary, '')) LIKE ? ESCAPE '\\')`,
    );
    for (let index = 0; index < 4; index += 1) {
      bindings.push(`%${escaped}%`);
    }
  }
  const where = clauses.join(" AND ");
  const [rowsResult, countResult] = await db.batch([
    db
      .prepare(
        `SELECT path, platform, data_type, surface, summary,
                upstream_price_usd_micros,
                customer_price_usd_micros, price_verified,
                rate_limit_raw, rate_limit_rps, updated_at
         FROM catalog_unresolved_endpoints
         WHERE ${where}
         ORDER BY platform ASC, path ASC
         LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, limit, offset),
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM catalog_unresolved_endpoints
         WHERE ${where}`,
      )
      .bind(...bindings),
  ]);
  const endpoints = resultRows<{
    path: string;
    platform: string;
    data_type: CatalogDataType;
    surface: MarketplaceSurface;
    summary: string | null;
    upstream_price_usd_micros: number;
    customer_price_usd_micros: number;
    price_verified: number;
    rate_limit_raw: string | null;
    rate_limit_rps: number | null;
    updated_at: string;
  }>(rowsResult).map((row) => ({
    id: marketplaceServiceId(null, row.path),
    path: row.path,
    platform: row.platform,
    dataType: row.data_type,
    surface: row.surface,
    method: null,
    summary: marketplaceGeneratedSummary(row.path),
    upstreamPriceUsdMicros: Number(row.upstream_price_usd_micros),
    customerPriceUsdMicros: Number(row.customer_price_usd_micros),
    priceVerified: Number(row.price_verified) === 1,
    rateLimit: row.rate_limit_raw,
    rateLimitRps:
      row.rate_limit_rps == null ? null : Number(row.rate_limit_rps),
    documentationStatus: "pending" as const,
    callable: false,
    updatedAt: row.updated_at,
  }));
  const total = Number(
    firstResult<{ count: number }>(countResult)?.count ?? 0,
  );
  return jsonResponse(
    {
      endpoints,
      count: endpoints.length,
      total,
      offset,
      nextOffset:
        offset + endpoints.length < total
          ? offset + endpoints.length
          : null,
    },
    200,
    requestId,
  );
}

async function handlePendingCatalogPriceUpdate(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  requireAdminSecret(request, env, "catalog");
  const body = await readJsonBody<{
    path?: unknown;
    customerPriceUsdMicros?: unknown;
    expectedUpdatedAt?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  if (
    typeof body.path !== "string" ||
    typeof body.expectedUpdatedAt !== "string" ||
    !Number.isFinite(Date.parse(body.expectedUpdatedAt))
  ) {
    throw new PlatformError(
      400,
      "invalid_pending_catalog_update",
      "待补全文档目录更新参数无效。",
    );
  }
  const path = normalizeCatalogPath(body.path);
  const customerPriceUsdMicros =
    typeof body.customerPriceUsdMicros === "number"
      ? body.customerPriceUsdMicros
      : Number.NaN;
  if (
    !Number.isSafeInteger(customerPriceUsdMicros) ||
    customerPriceUsdMicros < 0 ||
    customerPriceUsdMicros > 100_000_000
  ) {
    throw new PlatformError(
      400,
      "invalid_endpoint_price",
      "客户价格必须是 0–100 美元的微单位整数。",
    );
  }
  const db = requireDb(env);
  const updatedAt = new Date().toISOString();
  const audit = await prepareAdminAuditStatement(db, request, {
    action: "catalog.pending_repriced",
    targetType: "catalog_pending_endpoint",
    targetId: path,
    details: { customerPriceUsdMicros, updatedAt },
    pendingCatalogPriceUpdate: {
      path,
      customerPriceUsdMicros,
      updatedAt,
    },
  });
  const results = await db.batch([
    db.prepare(
      `UPDATE catalog_unresolved_endpoints
       SET customer_price_usd_micros = ?, updated_at = ?
       WHERE path = ? AND updated_at = ?
         AND upstream_price_usd_micros <= ?
         AND sync_generation = (
           SELECT last_success_generation
           FROM catalog_sync_state
           WHERE id = 1
         )`,
    ).bind(
      customerPriceUsdMicros,
      updatedAt,
      path,
      body.expectedUpdatedAt,
      customerPriceUsdMicros,
    ),
    audit,
  ]);
  if (
    Number(results[0]?.meta?.changes ?? 0) !== 1 ||
    Number(results[1]?.meta?.changes ?? 0) !== 1
  ) {
    const current = await db
      .prepare(
        `SELECT upstream_price_usd_micros
         FROM catalog_unresolved_endpoints
         WHERE path = ?`,
      )
      .bind(path)
      .first<{ upstream_price_usd_micros: number }>();
    if (!current) {
      throw new PlatformError(
        404,
        "pending_endpoint_not_found",
        "未找到这个待补全文档服务。",
      );
    }
    if (
      customerPriceUsdMicros <
      Number(current.upstream_price_usd_micros)
    ) {
      throw new PlatformError(
        400,
        "price_below_upstream",
        "客户价格不能低于当前上游成本。",
      );
    }
    throw new PlatformError(
      409,
      "pending_endpoint_update_conflict",
      "待补全文档服务已发生变化，请刷新后重试。",
    );
  }
  return jsonResponse(
    {
      ok: true,
      path,
      customerPriceUsdMicros,
      updatedAt,
      callable: false,
      documentationStatus: "pending",
    },
    200,
    requestId,
  );
}

type NormalizedCatalogBatchPreview = {
  action: CatalogBatchAction;
  expectedCatalogGeneration: string;
  selection: {
    platform: string | null;
    dataType: CatalogDataType | null;
    tag: string | null;
    surface: MarketplaceSurface | null;
    query: string;
    status: "all" | "enabled" | "disabled" | "review";
    safety:
      | "all"
      | "safe_data_read"
      | "ambiguous"
      | "prohibited";
  };
  pricing: {
    markupBps: number;
    minimumCustomerPriceUsdMicros: number;
  } | null;
};

type CatalogBatchSourceRow = {
  path: string;
  platform: string;
  http_method: "GET" | "POST";
  data_type: CatalogDataType;
  tags_json: string;
  surface: MarketplaceSurface;
  operation_id: string | null;
  summary: string | null;
  upstream_price_usd_micros: number;
  customer_price_usd_micros: number;
  price_verified: number;
  enabled: number;
  read_only: number;
  safety_classification: CatalogSafetyClassification;
  safety_policy_version: number;
  revision: number;
  sync_generation: string | null;
  reviewed_at: string | null;
  updated_at: string;
};

type CatalogBatchSyncRecord = {
  last_success_generation: string;
  credential_source: string | null;
  credential_id: string | null;
  credential_fingerprint: string | null;
  credential_state_version: number | null;
  openapi_snapshot_hash: string;
  price_snapshot_hash: string;
  coverage_verified: number;
  sync_locked: number;
};

function normalizeCatalogBatchPreview(
  body: unknown,
): NormalizedCatalogBatchPreview {
  if (!isPlainRecord(body)) {
    throw new PlatformError(
      400,
      "invalid_catalog_batch",
      "批量目录预览请求格式无效。",
    );
  }
  const action = body.action;
  if (
    action !== "publish" &&
    action !== "reprice" &&
    action !== "disable"
  ) {
    throw new PlatformError(
      400,
      "invalid_catalog_batch_action",
      "批量目录操作仅支持 publish、reprice 或 disable。",
    );
  }
  if (
    typeof body.expectedCatalogGeneration !== "string" ||
    !/^sync_[A-Za-z0-9_-]{16,80}$/.test(
      body.expectedCatalogGeneration,
    )
  ) {
    throw new PlatformError(
      400,
      "invalid_catalog_generation",
      "必须提交当前目录同步代次。",
    );
  }
  if (!isPlainRecord(body.selection)) {
    throw new PlatformError(
      400,
      "invalid_catalog_batch_selection",
      "批量目录筛选条件无效。",
    );
  }
  const platform =
    body.selection.platform === null
      ? null
      : typeof body.selection.platform === "string"
        ? body.selection.platform.trim().toLowerCase()
        : "";
  if (
    platform !== null &&
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(platform)
  ) {
    throw new PlatformError(
      400,
      "invalid_catalog_platform",
      "目录平台筛选条件无效。",
    );
  }
  const dataTypeRaw =
    body.selection.dataType == null
      ? null
      : typeof body.selection.dataType === "string"
        ? body.selection.dataType.trim().normalize("NFKC").toLowerCase()
        : "";
  if (
    dataTypeRaw !== null &&
    !PROVIDER_DATA_TYPES.includes(dataTypeRaw)
  ) {
    throw new PlatformError(
      400,
      "invalid_catalog_data_type",
      "目录数据类型筛选条件无效。",
    );
  }
  const tag =
    body.selection.tag == null
      ? null
      : typeof body.selection.tag === "string"
        ? body.selection.tag.trim().normalize("NFKC").toLowerCase()
        : "";
  if (
    tag !== null &&
    (tag.length < 1 ||
      tag.length > 160 ||
      /[?&#=\u0000-\u001F\u007F]/.test(tag))
  ) {
    throw new PlatformError(
      400,
      "invalid_catalog_tag",
      "目录标签筛选条件无效。",
    );
  }
  const surfaceRaw =
    body.selection.surface == null
      ? null
      : typeof body.selection.surface === "string"
        ? body.selection.surface.trim().normalize("NFKC").toLowerCase()
        : "";
  if (
    surfaceRaw !== null &&
    !PROVIDER_SURFACES.includes(surfaceRaw)
  ) {
    throw new PlatformError(
      400,
      "invalid_catalog_surface",
      "目录端类型筛选条件无效。",
    );
  }
  const query =
    typeof body.selection.query === "string"
      ? body.selection.query.replace(/\s+/g, " ").trim().toLowerCase()
      : "";
  if (
    query.length > 120 ||
    /[\u0000-\u001F\u007F]/.test(query)
  ) {
    throw new PlatformError(
      400,
      "invalid_catalog_query",
      "目录搜索条件无效。",
    );
  }
  const status = body.selection.status;
  if (
    status !== "all" &&
    status !== "enabled" &&
    status !== "disabled" &&
    status !== "review"
  ) {
    throw new PlatformError(
      400,
      "invalid_catalog_status",
      "目录状态筛选条件无效。",
    );
  }
  const safety = body.selection.safety;
  if (
    safety !== "all" &&
    safety !== "safe_data_read" &&
    safety !== "ambiguous" &&
    safety !== "prohibited"
  ) {
    throw new PlatformError(
      400,
      "invalid_catalog_safety",
      "目录安全分类筛选条件无效。",
    );
  }
  let pricing: NormalizedCatalogBatchPreview["pricing"] = null;
  if (action === "publish" || action === "reprice") {
    if (!isPlainRecord(body.pricing)) {
      throw new PlatformError(
        400,
        "invalid_catalog_batch_pricing",
        "批量上架或调价必须提交定价规则。",
      );
    }
    const markupBps = body.pricing.markupBps;
    const minimumCustomerPriceUsdMicros =
      body.pricing.minimumCustomerPriceUsdMicros;
    if (
      !Number.isSafeInteger(markupBps) ||
      (markupBps as number) < 0 ||
      (markupBps as number) > 50_000 ||
      !Number.isSafeInteger(minimumCustomerPriceUsdMicros) ||
      (minimumCustomerPriceUsdMicros as number) < 1 ||
      (minimumCustomerPriceUsdMicros as number) > 100_000_000
    ) {
      throw new PlatformError(
        400,
        "invalid_catalog_batch_pricing",
        "加价比例或最低客户价格无效。",
      );
    }
    pricing = {
      markupBps: markupBps as number,
      minimumCustomerPriceUsdMicros:
        minimumCustomerPriceUsdMicros as number,
    };
  } else if (body.pricing != null) {
    throw new PlatformError(
      400,
      "invalid_catalog_batch_pricing",
      "批量下架不能同时提交定价规则。",
    );
  }
  return {
    action,
    expectedCatalogGeneration: body.expectedCatalogGeneration,
    selection: {
      platform,
      dataType: dataTypeRaw as CatalogDataType | null,
      tag,
      surface: surfaceRaw as MarketplaceSurface | null,
      query,
      status,
      safety,
    },
    pricing,
  };
}

async function handleCatalogBatchPreview(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "catalog");
  const idempotencyKey = requireIdempotencyKey(request);
  const body = normalizeCatalogBatchPreview(
    await readJsonBody<unknown>(request, MAX_DASHBOARD_BODY_BYTES),
  );
  const supplied = bearerToken(request);
  if (!supplied) {
    throw new PlatformError(401, "admin_unauthorized", "管理员凭证无效。");
  }
  const actorFingerprint = await sha256Hex(supplied);
  const previewIdempotencyHash = await sha256Hex(
    `catalog-preview:${actorFingerprint}:${idempotencyKey}`,
  );
  const canonicalRequest = JSON.stringify(sortObjectDeep(body));
  const previewRequestHash = await sha256Hex(canonicalRequest);
  const db = requireDb(env);
  await assertStoredCatalogTaxonomyIntegrity(db);
  const replay = await catalogBatchPlanByPreviewIdempotency(
    db,
    previewIdempotencyHash,
  );
  if (replay) {
    if (
      replay.actor_fingerprint !== actorFingerprint ||
      replay.preview_request_hash !== previewRequestHash
    ) {
      throw new PlatformError(
        409,
        "catalog_batch_idempotency_conflict",
        "该批量预览幂等键已经用于其他请求。",
      );
    }
    if (replay.status !== "preparing") {
      return await catalogBatchResponse(
        db,
        replay,
        requestId,
        true,
        100,
        0,
      );
    }
    const abandoned = await db
      .prepare(
        `DELETE FROM catalog_batch_plans
         WHERE id = ? AND status = 'preparing' AND version = 0
           AND datetime(created_at) <= datetime('now', '-2 minutes')`,
      )
      .bind(replay.id)
      .run();
    if (Number(abandoned.meta?.changes ?? 0) !== 1) {
      const current = await catalogBatchPlanByPreviewIdempotency(
        db,
        previewIdempotencyHash,
      );
      if (current && current.status !== "preparing") {
        return await catalogBatchResponse(
          db,
          current,
          requestId,
          true,
          100,
          0,
        );
      }
      throw new PlatformError(
        409,
        "catalog_batch_preview_in_progress",
        "相同批量预览正在生成，请稍后使用相同幂等键重试。",
      );
    }
  }

  const sync = await db
    .prepare(
      `SELECT last_success_generation, credential_source, credential_id,
              credential_fingerprint, credential_state_version,
              openapi_snapshot_hash, price_snapshot_hash,
              CASE WHEN ${CATALOG_COVERAGE_WHERE} THEN 1 ELSE 0 END
                AS coverage_verified,
              EXISTS(
                SELECT 1 FROM catalog_sync_locks
                WHERE id = 1
                  AND datetime(locked_at) >= datetime('now', '-15 minutes')
              ) AS sync_locked
       FROM catalog_sync_state
       WHERE id = 1`,
    )
    .first<CatalogBatchSyncRecord>();
  if (
    !sync ||
    sync.last_success_generation !== body.expectedCatalogGeneration ||
    sync.coverage_verified !== 1
  ) {
    throw new PlatformError(
      409,
      "catalog_batch_snapshot_stale",
      "目录同步代次或覆盖证明已经变化，请刷新后重新生成预览。",
    );
  }
  if (sync.sync_locked === 1) {
    throw new PlatformError(
      409,
      "catalog_sync_in_progress",
      "目录正在同步，请完成同步后再生成批量预览。",
    );
  }

  const clauses: string[] = ["1 = 1"];
  const bindings: unknown[] = [];
  if (body.selection.platform !== null) {
    clauses.push("platform = ?");
    bindings.push(body.selection.platform);
  }
  if (body.selection.dataType !== null) {
    clauses.push("data_type = ?");
    bindings.push(body.selection.dataType);
  }
  if (body.selection.surface !== null) {
    clauses.push("surface = ?");
    bindings.push(body.selection.surface);
  }
  if (body.selection.tag !== null) {
    clauses.push(
      `EXISTS (
         SELECT 1
         FROM json_each(tags_json) AS catalog_tag
         WHERE lower(catalog_tag.value) = ?
       )`,
    );
    bindings.push(body.selection.tag);
  }
  if (body.selection.query) {
    const escaped = body.selection.query
      .replaceAll("\\", "\\\\")
      .replaceAll("%", "\\%")
      .replaceAll("_", "\\_");
    clauses.push(
      `(lower(path) LIKE ? ESCAPE '\\' OR
        lower(platform) LIKE ? ESCAPE '\\' OR
        lower(COALESCE(summary, '')) LIKE ? ESCAPE '\\')`,
    );
    bindings.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
  }
  if (body.selection.status === "enabled") {
    clauses.push("enabled = 1");
  } else if (body.selection.status === "disabled") {
    clauses.push("enabled = 0");
  } else if (body.selection.status === "review") {
    clauses.push(
      `(reviewed_at IS NULL OR sync_generation IS NULL OR
        sync_generation != ? OR price_verified != 1 OR
        safety_classification != 'safe_data_read' OR
        safety_policy_version != ?)`,
    );
    bindings.push(
      body.expectedCatalogGeneration,
      CATALOG_SAFETY_POLICY_VERSION,
    );
  }
  if (body.selection.safety !== "all") {
    clauses.push("safety_classification = ?");
    bindings.push(body.selection.safety);
  }
  const maxTargets =
    body.action === "publish"
      ? MAX_CATALOG_BATCH_PUBLISH_TARGETS
      : MAX_CATALOG_BATCH_TARGETS;
  const rows = await db
    .prepare(
      `SELECT path, platform, http_method, data_type, tags_json, surface,
              operation_id, summary,
              upstream_price_usd_micros, customer_price_usd_micros,
              price_verified, enabled, read_only, safety_classification,
              safety_policy_version, revision, sync_generation,
              reviewed_at, updated_at
       FROM endpoint_catalog
       WHERE ${clauses.join(" AND ")}
       ORDER BY platform ASC, path ASC
       LIMIT ?`,
    )
    .bind(...bindings, maxTargets + 1)
    .all<CatalogBatchSourceRow>();
  const sourceRows = rows.results ?? [];
  if (sourceRows.length > maxTargets) {
    throw new PlatformError(
      409,
      "catalog_batch_target_limit",
      `本次操作超过 ${maxTargets} 个端点，请缩小服务端筛选范围后重试。`,
    );
  }

  const planned = await Promise.all(
    sourceRows.map(async (row, ordinal) => {
      const taxonomy = strictStoredCatalogTaxonomy(row);
      let blockerCode: string | null = null;
      if (body.action !== "disable") {
        if (row.sync_generation !== body.expectedCatalogGeneration) {
          blockerCode = "stale_endpoint";
        } else if (row.price_verified !== 1) {
          blockerCode = "price_unverified";
        } else if (
          row.safety_classification !== "safe_data_read" ||
          row.safety_policy_version !== CATALOG_SAFETY_POLICY_VERSION ||
          isHardProhibitedCatalogOperation(row.path, row.http_method)
        ) {
          blockerCode = "unsafe_operation";
        }
      }
      let targetPrice = row.customer_price_usd_micros;
      if (body.pricing) {
        const markupPrice = Math.ceil(
          (row.upstream_price_usd_micros *
            (10_000 + body.pricing.markupBps)) /
            10_000,
        );
        targetPrice = Math.max(
          row.upstream_price_usd_micros,
          body.pricing.minimumCustomerPriceUsdMicros,
          markupPrice,
        );
        if (
          !Number.isSafeInteger(targetPrice) ||
          targetPrice < row.upstream_price_usd_micros ||
          targetPrice < 1 ||
          targetPrice > 100_000_000
        ) {
          blockerCode ??= "price_out_of_range";
        }
      }
      const targetEnabled =
        body.action === "publish"
          ? 1
          : body.action === "disable"
            ? 0
            : row.enabled;
      const targetReadOnly =
        body.action === "publish" ? 1 : row.read_only;
      const willChange =
        blockerCode == null &&
        (targetPrice !== row.customer_price_usd_micros ||
          targetEnabled !== row.enabled ||
          targetReadOnly !== row.read_only);
      const before = {
        path: row.path,
        dataType: taxonomy.dataType,
        tags: taxonomy.tags,
        surface: taxonomy.surface,
        operationId: taxonomy.operationId,
        revision: row.revision,
        upstreamPriceUsdMicros: row.upstream_price_usd_micros,
        customerPriceUsdMicros: row.customer_price_usd_micros,
        priceVerified: row.price_verified === 1,
        enabled: row.enabled === 1,
        readOnly: row.read_only === 1,
        syncGeneration: row.sync_generation,
        reviewedAt: row.reviewed_at,
        updatedAt: row.updated_at,
      };
      const after = {
        customerPriceUsdMicros: targetPrice,
        enabled: targetEnabled === 1,
        readOnly: targetReadOnly === 1,
      };
      const itemDigest = await sha256Hex(
        JSON.stringify(
          sortObjectDeep({
            ordinal,
            platform: row.platform,
            method: row.http_method,
            before,
            after,
            willChange,
            blockerCode,
          }),
        ),
      );
      return {
        row,
        ordinal,
        targetPrice,
        targetEnabled,
        targetReadOnly,
        willChange,
        blockerCode,
        before,
        after,
        itemDigest,
      };
    }),
  );
  const targetDigest = await sha256Hex(
    JSON.stringify(
      planned.map((item) => ({
        path: item.row.path,
        revision: item.row.revision,
        itemDigest: item.itemDigest,
      })),
    ),
  );
  const beforeDigest = await sha256Hex(
    JSON.stringify(planned.map((item) => item.before)),
  );
  const afterDigest = await sha256Hex(
    JSON.stringify(
      planned.map((item) => ({
        path: item.row.path,
        ...item.after,
      })),
    ),
  );
  const matchedCount = planned.length;
  const selectedCount = planned.filter((item) => item.willChange).length;
  const blockedCount = planned.filter(
    (item) => item.blockerCode != null,
  ).length;
  const staleCount = planned.filter(
    (item) => item.blockerCode === "stale_endpoint",
  ).length;
  const unverifiedCount = planned.filter(
    (item) => item.blockerCode === "price_unverified",
  ).length;
  const unsafeCount = planned.filter(
    (item) => item.blockerCode === "unsafe_operation",
  ).length;
  const noChangeCount = planned.filter(
    (item) => item.blockerCode == null && !item.willChange,
  ).length;
  const priceIncreaseCount = planned.filter(
    (item) =>
      item.targetPrice > item.row.customer_price_usd_micros,
  ).length;
  const priceDecreaseCount = planned.filter(
    (item) =>
      item.targetPrice < item.row.customer_price_usd_micros,
  ).length;
  const priceUnchangedCount =
    matchedCount - priceIncreaseCount - priceDecreaseCount;
  const upstreamTotal = planned.reduce(
    (total, item) => total + item.row.upstream_price_usd_micros,
    0,
  );
  const beforeCustomerTotal = planned.reduce(
    (total, item) => total + item.row.customer_price_usd_micros,
    0,
  );
  const afterCustomerTotal = planned.reduce(
    (total, item) => total + item.targetPrice,
    0,
  );
  const planId = `cbp_${randomBase64Url(18)}`;
  const expiresAt = new Date(
    Date.now() + CATALOG_BATCH_TTL_MINUTES * 60_000,
  ).toISOString();
  const finalStatus: CatalogBatchStatus =
    blockedCount > 0 || matchedCount === 0 || selectedCount === 0
      ? "blocked"
      : "ready";
  const confirmationText =
    `APPLY ${body.action.toUpperCase()} ${selectedCount}/${matchedCount} ` +
    `${targetDigest.slice(0, 12)} ` +
    `${body.expectedCatalogGeneration.slice(-12)}`;
  const selectorJson = JSON.stringify(sortObjectDeep(body.selection));
  const mutationJson = JSON.stringify(
    sortObjectDeep({ action: body.action, pricing: body.pricing }),
  );
  try {
    await db
      .prepare(
        `INSERT INTO catalog_batch_plans
         (id, actor_fingerprint, preview_idempotency_hash,
          preview_request_hash, policy_version, action, status, version,
          filter_platform, filter_query, filter_status, filter_safety,
          selector_json, mutation_json, markup_bps,
          minimum_customer_price_usd_micros, catalog_generation,
          credential_source, credential_id, credential_fingerprint,
          credential_state_version, openapi_snapshot_hash,
          price_snapshot_hash, matched_count, selected_count,
          excluded_stale_count, excluded_unverified_count,
          excluded_unsafe_count, no_change_count, price_increase_count,
          price_decrease_count, price_unchanged_count, blocked_count,
          upstream_total_usd_micros,
          before_customer_total_usd_micros,
          after_customer_total_usd_micros, target_digest, before_digest,
          after_digest, confirmation_text, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'preparing', 0, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        planId,
        actorFingerprint,
        previewIdempotencyHash,
        previewRequestHash,
        CATALOG_SAFETY_POLICY_VERSION,
        body.action,
        body.selection.platform,
        body.selection.query || null,
        body.selection.status,
        body.selection.safety,
        selectorJson,
        mutationJson,
        body.pricing?.markupBps ?? null,
        body.pricing?.minimumCustomerPriceUsdMicros ?? null,
        body.expectedCatalogGeneration,
        sync.credential_source,
        sync.credential_id,
        sync.credential_fingerprint,
        sync.credential_state_version,
        sync.openapi_snapshot_hash,
        sync.price_snapshot_hash,
        matchedCount,
        selectedCount,
        staleCount,
        unverifiedCount,
        unsafeCount,
        noChangeCount,
        priceIncreaseCount,
        priceDecreaseCount,
        priceUnchangedCount,
        blockedCount,
        upstreamTotal,
        beforeCustomerTotal,
        afterCustomerTotal,
        targetDigest,
        beforeDigest,
        afterDigest,
        confirmationText,
        expiresAt,
      )
      .run();
  } catch {
    const concurrent = await catalogBatchPlanByPreviewIdempotency(
      db,
      previewIdempotencyHash,
    );
    if (
      concurrent &&
      concurrent.actor_fingerprint === actorFingerprint &&
      concurrent.preview_request_hash === previewRequestHash
    ) {
      if (concurrent.status === "preparing") {
        throw new PlatformError(
          409,
          "catalog_batch_preview_in_progress",
          "相同批量预览正在生成，请稍后使用相同幂等键重试。",
        );
      }
      return await catalogBatchResponse(
        db,
        concurrent,
        requestId,
        true,
        100,
        0,
      );
    }
    throw new PlatformError(
      409,
      "catalog_batch_idempotency_conflict",
      "该批量预览幂等键已经用于其他请求。",
    );
  }

  try {
    for (let offset = 0; offset < planned.length; offset += 50) {
      await db.batch(
        planned.slice(offset, offset + 50).map((item) =>
          db
            .prepare(
              `INSERT INTO catalog_batch_plan_items
               (id, plan_id, path, ordinal, platform, http_method, summary,
                data_type, tags_json, surface, operation_id,
                expected_revision, original_upstream_price_usd_micros,
                original_customer_price_usd_micros,
                original_price_verified, original_enabled,
                original_read_only, original_sync_generation,
                original_reviewed_at, original_updated_at,
                target_customer_price_usd_micros, target_enabled,
                target_read_only, will_change, blocker_code, item_digest)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                       ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              `${planId}:${item.ordinal}`,
              planId,
              item.row.path,
              item.ordinal,
              item.row.platform,
              item.row.http_method,
              item.row.summary,
              item.row.data_type,
              item.row.tags_json,
              item.row.surface,
              item.row.operation_id,
              item.row.revision,
              item.row.upstream_price_usd_micros,
              item.row.customer_price_usd_micros,
              item.row.price_verified,
              item.row.enabled,
              item.row.read_only,
              item.row.sync_generation,
              item.row.reviewed_at,
              item.row.updated_at,
              item.targetPrice,
              item.targetEnabled,
              item.targetReadOnly,
              item.willChange ? 1 : 0,
              item.blockerCode,
              item.itemDigest,
            ),
        ),
      );
    }
    const previewAuditId = `aud_${(
      await sha256Hex(`catalog.batch_previewed:${planId}`)
    ).slice(0, 32)}`;
    const previewedAt = new Date().toISOString();
    const finalized = await db.batch([
      db
        .prepare(
          `UPDATE catalog_batch_plans
           SET status = ?, version = 1, previewed_at = ?
           WHERE id = ? AND status = 'preparing' AND version = 0
             AND matched_count = (
               SELECT COUNT(*) FROM catalog_batch_plan_items
               WHERE plan_id = ?
             )
             AND matched_count = (
               SELECT COUNT(*)
               FROM catalog_batch_plan_items i
               JOIN endpoint_catalog e ON e.path = i.path
               WHERE i.plan_id = ?
                 AND e.revision = i.expected_revision
                 AND e.platform = i.platform
                 AND e.http_method = i.http_method
                 AND e.data_type = i.data_type
                 AND e.tags_json = i.tags_json
                 AND e.surface = i.surface
                 AND e.operation_id IS i.operation_id
                 AND e.upstream_price_usd_micros =
                     i.original_upstream_price_usd_micros
                 AND e.customer_price_usd_micros =
                     i.original_customer_price_usd_micros
                 AND e.price_verified = i.original_price_verified
                 AND e.enabled = i.original_enabled
                 AND e.read_only = i.original_read_only
                 AND e.sync_generation IS i.original_sync_generation
             )
             AND NOT EXISTS (
               SELECT 1 FROM catalog_sync_locks
               WHERE id = 1
                 AND datetime(locked_at) >= datetime('now', '-15 minutes')
             )
             AND EXISTS (
               SELECT 1 FROM catalog_sync_state s
               WHERE s.id = 1
                 AND s.last_success_generation =
                     catalog_batch_plans.catalog_generation
                 AND s.credential_source IS
                     catalog_batch_plans.credential_source
                 AND s.credential_id IS
                     catalog_batch_plans.credential_id
                 AND s.credential_fingerprint IS
                     catalog_batch_plans.credential_fingerprint
                 AND s.credential_state_version IS
                     catalog_batch_plans.credential_state_version
                 AND s.openapi_snapshot_hash =
                     catalog_batch_plans.openapi_snapshot_hash
                 AND s.price_snapshot_hash =
                     catalog_batch_plans.price_snapshot_hash
                 AND ${CATALOG_COVERAGE_WHERE}
             )`,
        )
        .bind(finalStatus, previewedAt, planId, planId, planId),
      db
        .prepare(
          `INSERT OR IGNORE INTO admin_audit_logs
           (id, actor_fingerprint, action, target_type, target_id,
            details_json, created_at)
           SELECT ?, actor_fingerprint, 'catalog.batch_previewed',
                  'catalog_batch_plan', id, ?, ?
           FROM catalog_batch_plans
           WHERE id = ? AND status = ? AND version = 1`,
        )
        .bind(
          previewAuditId,
          JSON.stringify({
            action: body.action,
            selection: body.selection,
            pricing: body.pricing,
            matchedCount,
            selectedCount,
            blockedCount,
            targetDigest,
            catalogGeneration: body.expectedCatalogGeneration,
          }),
          previewedAt,
          planId,
          finalStatus,
        ),
    ]);
    if (
      Number(finalized[0]?.meta?.changes ?? 0) !== 1 ||
      Number(finalized[1]?.meta?.changes ?? 0) !== 1
    ) {
      await db
        .prepare(
          `UPDATE catalog_batch_plans
           SET status = 'stale', version = version + 1
           WHERE id = ? AND status = 'preparing'`,
        )
        .bind(planId)
        .run();
      throw new PlatformError(
        409,
        "catalog_batch_snapshot_stale",
        "目录在生成预览期间发生变化，请刷新后重试。",
      );
    }
  } catch (error) {
    if (!(error instanceof PlatformError)) {
      await db
        .prepare(
          `DELETE FROM catalog_batch_plans
           WHERE id = ? AND status = 'preparing'`,
        )
        .bind(planId)
        .run()
        .catch(() => undefined);
    }
    throw error;
  }
  const plan = await catalogBatchPlanById(db, planId, actorFingerprint);
  if (!plan) {
    throw new PlatformError(
      500,
      "catalog_batch_preview_failed",
      "批量目录预览保存失败。",
    );
  }
  return await catalogBatchResponse(db, plan, requestId, false, 100, 0);
}

async function handleCatalogBatchGet(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "catalog");
  const supplied = bearerToken(request);
  if (!supplied) {
    throw new PlatformError(401, "admin_unauthorized", "管理员凭证无效。");
  }
  const actorFingerprint = await sha256Hex(supplied);
  const url = new URL(request.url);
  const planId = normalizeCatalogBatchPlanId(
    url.pathname.split("/").at(-1) ?? "",
  );
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  if (
    url.searchParams.getAll("limit").length > 1 ||
    url.searchParams.getAll("offset").length > 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > MAX_CATALOG_BATCH_TARGETS
  ) {
    throw new PlatformError(
      400,
      "invalid_pagination",
      "批量预览分页参数无效。",
    );
  }
  const db = requireDb(env);
  const plan = await catalogBatchPlanById(db, planId, actorFingerprint);
  if (!plan) {
    throw new PlatformError(
      404,
      "catalog_batch_not_found",
      "没有找到这个批量目录预览。",
    );
  }
  return await catalogBatchResponse(
    db,
    plan,
    requestId,
    false,
    limit,
    offset,
  );
}

async function handleCatalogBatchApply(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "catalog");
  const idempotencyKey = requireIdempotencyKey(request);
  const supplied = bearerToken(request);
  if (!supplied) {
    throw new PlatformError(401, "admin_unauthorized", "管理员凭证无效。");
  }
  const actorFingerprint = await sha256Hex(supplied);
  const url = new URL(request.url);
  const parts = url.pathname.split("/");
  const planId = normalizeCatalogBatchPlanId(parts.at(-2) ?? "");
  const raw = await readJsonBody<unknown>(
    request,
    MAX_DASHBOARD_BODY_BYTES,
  );
  if (
    !isPlainRecord(raw) ||
    !Number.isSafeInteger(raw.expectedVersion) ||
    (raw.expectedVersion as number) < 1 ||
    typeof raw.previewDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(raw.previewDigest) ||
    typeof raw.confirmation !== "string" ||
    raw.confirmation.length > 240
  ) {
    throw new PlatformError(
      400,
      "invalid_catalog_batch_confirmation",
      "批量目录应用确认信息无效。",
    );
  }
  const normalizedApply = {
    planId,
    expectedVersion: raw.expectedVersion as number,
    previewDigest: raw.previewDigest,
    confirmation: raw.confirmation,
  };
  const applyRequestHash = await sha256Hex(
    JSON.stringify(sortObjectDeep(normalizedApply)),
  );
  const applyIdempotencyHash = await sha256Hex(
    `catalog-apply:${actorFingerprint}:${idempotencyKey}`,
  );
  const db = requireDb(env);
  await assertStoredCatalogTaxonomyIntegrity(db);
  const existingApplyKey = await db
    .prepare(
      `SELECT id, actor_fingerprint, apply_request_hash, status
       FROM catalog_batch_plans
       WHERE apply_idempotency_hash = ?`,
    )
    .bind(applyIdempotencyHash)
    .first<{
      id: string;
      actor_fingerprint: string;
      apply_request_hash: string | null;
      status: string;
    }>();
  if (
    existingApplyKey &&
    (existingApplyKey.id !== planId ||
      existingApplyKey.actor_fingerprint !== actorFingerprint ||
      existingApplyKey.apply_request_hash !== applyRequestHash)
  ) {
    throw new PlatformError(
      409,
      "catalog_batch_idempotency_conflict",
      "该批量应用幂等键已经用于其他请求。",
    );
  }
  let plan = await catalogBatchPlanById(db, planId, actorFingerprint);
  if (!plan) {
    throw new PlatformError(
      404,
      "catalog_batch_not_found",
      "没有找到这个批量目录预览。",
    );
  }
  if (plan.status === "applied") {
    if (
      plan.apply_idempotency_hash === applyIdempotencyHash &&
      plan.apply_request_hash === applyRequestHash
    ) {
      return await catalogBatchResponse(
        db,
        plan,
        requestId,
        true,
        100,
        0,
      );
    }
    throw new PlatformError(
      409,
      "catalog_batch_already_applied",
      "这个批量目录预览已经由其他请求应用。",
    );
  }
  if (
    plan.version !== normalizedApply.expectedVersion ||
    plan.target_digest !== normalizedApply.previewDigest ||
    plan.confirmation_text !== normalizedApply.confirmation
  ) {
    throw new PlatformError(
      409,
      "catalog_batch_confirmation_conflict",
      "批量目录预览版本、摘要或确认文本不匹配。",
    );
  }
  if (plan.status !== "ready" || plan.blocked_count !== 0) {
    throw new PlatformError(
      409,
      "catalog_batch_not_applicable",
      "这个批量目录预览当前不能应用。",
    );
  }
  if (Date.parse(plan.expires_at) <= Date.now()) {
    await db
      .prepare(
        `UPDATE catalog_batch_plans
         SET status = 'expired', version = version + 1
         WHERE id = ? AND status = 'ready' AND version = ?`,
      )
      .bind(plan.id, plan.version)
      .run();
    throw new PlatformError(
      410,
      "catalog_batch_expired",
      "这个批量目录预览已经过期，请重新生成。",
    );
  }
  const appliedAt = new Date().toISOString();
  const resultPayload = {
    batchId: plan.id,
    action: plan.action,
    matched: plan.matched_count,
    changed: plan.selected_count,
    targetDigest: plan.target_digest,
    catalogGeneration: plan.catalog_generation,
    appliedAt,
  };
  const storedSelector = parseCatalogBatchMetadata(
    plan.selector_json,
    "selector",
  );
  const storedMutation = parseCatalogBatchMetadata(
    plan.mutation_json,
    "mutation",
  );
  const strictSourceClause =
    plan.action === "disable"
      ? "1 = 1"
      : `NOT EXISTS (
           SELECT 1 FROM catalog_sync_locks
           WHERE id = 1
             AND datetime(locked_at) >= datetime('now', '-15 minutes')
         )
         AND EXISTS (
           SELECT 1 FROM catalog_sync_state s
           WHERE s.id = 1
             AND s.last_success_generation =
                 catalog_batch_plans.catalog_generation
             AND s.credential_source IS
                 catalog_batch_plans.credential_source
             AND s.credential_id IS catalog_batch_plans.credential_id
             AND s.credential_fingerprint IS
                 catalog_batch_plans.credential_fingerprint
             AND s.credential_state_version IS
                 catalog_batch_plans.credential_state_version
             AND s.openapi_snapshot_hash =
                 catalog_batch_plans.openapi_snapshot_hash
             AND s.price_snapshot_hash =
                 catalog_batch_plans.price_snapshot_hash
             AND ${CATALOG_COVERAGE_WHERE}
         )`;
  const auditId = `aud_${(
    await sha256Hex(`catalog.batch_applied:${plan.id}`)
  ).slice(0, 32)}`;
  const applyResults = await db.batch([
    db
      .prepare(
        `UPDATE catalog_batch_plans
         SET status = 'applying', version = version + 1,
             apply_idempotency_hash = ?, apply_request_hash = ?,
             apply_started_at = ?
         WHERE id = ? AND actor_fingerprint = ?
           AND status = 'ready' AND version = ?
           AND policy_version = ${CATALOG_SAFETY_POLICY_VERSION}
           AND target_digest = ? AND confirmation_text = ?
           AND blocked_count = 0 AND selected_count > 0
           AND datetime(expires_at) > datetime(?)
           AND ${strictSourceClause}
           AND matched_count = (
             SELECT COUNT(*) FROM catalog_batch_plan_items
             WHERE plan_id = catalog_batch_plans.id
           )
           AND matched_count = (
             SELECT COUNT(*)
             FROM catalog_batch_plan_items i
             JOIN endpoint_catalog e ON e.path = i.path
             WHERE i.plan_id = catalog_batch_plans.id
               AND e.revision = i.expected_revision
               AND e.platform = i.platform
               AND e.http_method = i.http_method
               AND e.data_type = i.data_type
               AND e.tags_json = i.tags_json
               AND e.surface = i.surface
               AND e.operation_id IS i.operation_id
               AND e.upstream_price_usd_micros =
                   i.original_upstream_price_usd_micros
               AND e.customer_price_usd_micros =
                   i.original_customer_price_usd_micros
               AND e.price_verified = i.original_price_verified
               AND e.enabled = i.original_enabled
               AND e.read_only = i.original_read_only
               AND e.sync_generation IS i.original_sync_generation
               AND (
                 catalog_batch_plans.action = 'disable'
                 OR (
                   e.safety_classification = 'safe_data_read'
                   AND e.safety_policy_version =
                       ${CATALOG_SAFETY_POLICY_VERSION}
                 )
               )
           )`,
      )
      .bind(
        applyIdempotencyHash,
        applyRequestHash,
        appliedAt,
        plan.id,
        actorFingerprint,
        plan.version,
        plan.target_digest,
        plan.confirmation_text,
        appliedAt,
      ),
    db
      .prepare(
        `UPDATE endpoint_catalog
         SET customer_price_usd_micros = (
               SELECT i.target_customer_price_usd_micros
               FROM catalog_batch_plan_items i
               WHERE i.plan_id = ? AND i.path = endpoint_catalog.path
             ),
             enabled = (
               SELECT i.target_enabled
               FROM catalog_batch_plan_items i
               WHERE i.plan_id = ? AND i.path = endpoint_catalog.path
             ),
             read_only = (
               SELECT i.target_read_only
               FROM catalog_batch_plan_items i
               WHERE i.plan_id = ? AND i.path = endpoint_catalog.path
             ),
             reviewed_at = CASE
               WHEN (
                 SELECT action FROM catalog_batch_plans WHERE id = ?
               ) = 'publish'
               THEN ?
               ELSE reviewed_at
             END,
             revision = revision + 1,
             updated_at = ?
         WHERE path IN (
           SELECT i.path FROM catalog_batch_plan_items i
           WHERE i.plan_id = ? AND i.will_change = 1
         )
           AND EXISTS (
             SELECT 1 FROM catalog_batch_plans p
             WHERE p.id = ? AND p.status = 'applying'
               AND p.apply_idempotency_hash = ?
               AND p.apply_request_hash = ?
           )`,
      )
      .bind(
        plan.id,
        plan.id,
        plan.id,
        plan.id,
        appliedAt,
        appliedAt,
        plan.id,
        plan.id,
        applyIdempotencyHash,
        applyRequestHash,
      ),
    db
      .prepare(
        `UPDATE catalog_batch_plans
         SET status = 'applied', version = version + 1,
             apply_result_json = ?, applied_count = selected_count,
             applied_at = ?
         WHERE id = ? AND status = 'applying'
           AND apply_idempotency_hash = ? AND apply_request_hash = ?
           AND selected_count = (
             SELECT COUNT(*)
             FROM catalog_batch_plan_items i
             JOIN endpoint_catalog e ON e.path = i.path
             WHERE i.plan_id = catalog_batch_plans.id
               AND i.will_change = 1
               AND e.revision = i.expected_revision + 1
               AND e.platform = i.platform
               AND e.http_method = i.http_method
               AND e.data_type = i.data_type
               AND e.tags_json = i.tags_json
               AND e.surface = i.surface
               AND e.operation_id IS i.operation_id
               AND e.customer_price_usd_micros =
                   i.target_customer_price_usd_micros
               AND e.enabled = i.target_enabled
               AND e.read_only = i.target_read_only
           )`,
      )
      .bind(
        JSON.stringify(resultPayload),
        appliedAt,
        plan.id,
        applyIdempotencyHash,
        applyRequestHash,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO admin_audit_logs
         (id, actor_fingerprint, action, target_type, target_id,
          details_json, created_at)
         SELECT ?, actor_fingerprint, 'catalog.batch_applied',
                'catalog_batch_plan', id, ?, ?
         FROM catalog_batch_plans
         WHERE id = ? AND status = 'applied'
           AND apply_idempotency_hash = ? AND apply_request_hash = ?`,
      )
      .bind(
        auditId,
        JSON.stringify({
          action: plan.action,
          selection: storedSelector,
          mutation: storedMutation,
          matchedCount: plan.matched_count,
          selectedCount: plan.selected_count,
          targetDigest: plan.target_digest,
          beforeDigest: plan.before_digest,
          afterDigest: plan.after_digest,
          catalogGeneration: plan.catalog_generation,
          credentialFingerprint: plan.credential_fingerprint,
          openApiSnapshotHash: plan.openapi_snapshot_hash,
          priceSnapshotHash: plan.price_snapshot_hash,
          policyVersion: plan.policy_version,
          applyRequestHash,
        }),
        appliedAt,
        plan.id,
        applyIdempotencyHash,
        applyRequestHash,
      ),
  ]);
  if (
    Number(applyResults[0]?.meta?.changes ?? 0) !== 1 ||
    Number(applyResults[1]?.meta?.changes ?? 0) !== plan.selected_count ||
    Number(applyResults[2]?.meta?.changes ?? 0) !== 1 ||
    Number(applyResults[3]?.meta?.changes ?? 0) !== 1
  ) {
    plan = await catalogBatchPlanById(db, plan.id, actorFingerprint);
    if (
      plan?.status === "applied" &&
      plan.apply_idempotency_hash === applyIdempotencyHash &&
      plan.apply_request_hash === applyRequestHash
    ) {
      return await catalogBatchResponse(
        db,
        plan,
        requestId,
        true,
        100,
        0,
      );
    }
    if (plan?.status === "ready") {
      await db
        .prepare(
          `UPDATE catalog_batch_plans
           SET status = 'stale', version = version + 1
           WHERE id = ? AND status = 'ready' AND version = ?`,
        )
        .bind(plan.id, plan.version)
        .run();
    }
    throw new PlatformError(
      409,
      "catalog_batch_apply_conflict",
      "目录、数据源或预览目标已经变化，整批未应用，请重新生成预览。",
    );
  }
  plan = await catalogBatchPlanById(db, plan.id, actorFingerprint);
  if (!plan || plan.status !== "applied") {
    throw new PlatformError(
      500,
      "catalog_batch_apply_failed",
      "批量目录应用结果无法确认。",
    );
  }
  return await catalogBatchResponse(db, plan, requestId, false, 100, 0);
}

function normalizeCatalogBatchPlanId(value: string): string {
  if (!/^cbp_[A-Za-z0-9_-]{20,80}$/.test(value)) {
    throw new PlatformError(
      400,
      "invalid_catalog_batch_id",
      "批量目录预览编号无效。",
    );
  }
  return value;
}

async function catalogBatchPlanById(
  db: D1Database,
  id: string,
  actorFingerprint: string,
): Promise<CatalogBatchPlanRecord | null> {
  return await db
    .prepare(
      `SELECT * FROM catalog_batch_plans
       WHERE id = ? AND actor_fingerprint = ?`,
    )
    .bind(id, actorFingerprint)
    .first<CatalogBatchPlanRecord>();
}

async function catalogBatchPlanByPreviewIdempotency(
  db: D1Database,
  previewIdempotencyHash: string,
): Promise<CatalogBatchPlanRecord | null> {
  return await db
    .prepare(
      `SELECT * FROM catalog_batch_plans
       WHERE preview_idempotency_hash = ?`,
    )
    .bind(previewIdempotencyHash)
    .first<CatalogBatchPlanRecord>();
}

function parseCatalogBatchMetadata(
  value: string,
  kind: "selector" | "mutation",
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isPlainRecord(parsed)) throw new Error("invalid metadata");
    return parsed;
  } catch {
    throw new PlatformError(
      500,
      "catalog_batch_metadata_invalid",
      `批量目录${kind === "selector" ? "筛选" : "变更"}元数据损坏。`,
    );
  }
}

async function catalogBatchResponse(
  db: D1Database,
  plan: CatalogBatchPlanRecord,
  requestId: string,
  replayed: boolean,
  limit: number,
  offset: number,
): Promise<Response> {
  const itemsResult = await db
    .prepare(
      `SELECT path, ordinal, platform, http_method, data_type, tags_json,
              surface, operation_id, summary,
              expected_revision, original_upstream_price_usd_micros,
              original_customer_price_usd_micros, original_price_verified,
              original_enabled, original_read_only,
              original_sync_generation, original_reviewed_at,
              original_updated_at, target_customer_price_usd_micros,
              target_enabled, target_read_only, will_change, blocker_code,
              item_digest
       FROM catalog_batch_plan_items
       WHERE plan_id = ?
       ORDER BY ordinal ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(plan.id, limit, offset)
    .all<CatalogBatchItemRecord>();
  const items = (itemsResult.results ?? []).map((item) => {
    const taxonomy = strictStoredCatalogTaxonomy(item);
    return {
      path: item.path,
      platform: item.platform,
      dataType: taxonomy.dataType,
      tags: taxonomy.tags,
      surface: taxonomy.surface,
      operationId: taxonomy.operationId,
      method: item.http_method,
      summary: item.summary,
      expectedRevision: item.expected_revision,
      before: {
        upstreamPriceUsdMicros: item.original_upstream_price_usd_micros,
        customerPriceUsdMicros: item.original_customer_price_usd_micros,
        priceVerified: item.original_price_verified === 1,
        enabled: item.original_enabled === 1,
        readOnly: item.original_read_only === 1,
        syncGeneration: item.original_sync_generation,
        reviewedAt: item.original_reviewed_at,
        updatedAt: item.original_updated_at,
      },
      after: {
        customerPriceUsdMicros: item.target_customer_price_usd_micros,
        enabled: item.target_enabled === 1,
        readOnly: item.target_read_only === 1,
      },
      willChange: item.will_change === 1,
      blockerCode: item.blocker_code,
      itemDigest: item.item_digest,
    };
  });
  const nextOffset =
    offset + items.length < plan.matched_count
      ? offset + items.length
      : null;
  let applyResult: unknown = null;
  if (plan.apply_result_json) {
    try {
      applyResult = JSON.parse(plan.apply_result_json) as unknown;
    } catch {
      throw new PlatformError(
        500,
        "catalog_batch_result_invalid",
        "批量目录应用回执损坏。",
      );
    }
  }
  return jsonResponse(
    {
      replayed,
      batch: {
        id: plan.id,
        status: plan.status,
        version: plan.version,
        action: plan.action,
        selection: parseCatalogBatchMetadata(
          plan.selector_json,
          "selector",
        ),
        mutation: parseCatalogBatchMetadata(
          plan.mutation_json,
          "mutation",
        ),
        catalogGeneration: plan.catalog_generation,
        counts: {
          matched: plan.matched_count,
          selected: plan.selected_count,
          blocked: plan.blocked_count,
          stale: plan.excluded_stale_count,
          unverified: plan.excluded_unverified_count,
          unsafe: plan.excluded_unsafe_count,
          noChange: plan.no_change_count,
          priceIncrease: plan.price_increase_count,
          priceDecrease: plan.price_decrease_count,
          priceUnchanged: plan.price_unchanged_count,
        },
        totals: {
          upstream: plan.upstream_total_usd_micros,
          beforeCustomer: plan.before_customer_total_usd_micros,
          afterCustomer: plan.after_customer_total_usd_micros,
        },
        targetDigest: plan.target_digest,
        beforeDigest: plan.before_digest,
        afterDigest: plan.after_digest,
        confirmationText: plan.confirmation_text,
        previewedAt: plan.previewed_at,
        expiresAt: plan.expires_at,
        appliedAt: plan.applied_at,
        applyResult,
      },
      items,
      offset,
      nextOffset,
    },
    200,
    requestId,
  );
}

async function handleAdminOverview(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "platform");
  const db = requireDb(env);
  const readiness = await operationalReadiness(env);
  const upstreamConfig = await loadUpstreamSourceConfig(
    db,
    env,
    false,
  );
  const upstreamSnapshot = await managedUpstreamProviderCredentialsSnapshot(db);
  const activeManagedCredential =
    upstreamSnapshot.credentials.find(
      (credential) => credential.status === "active",
    ) ?? null;
  const environmentUpstreamKey = env.UPSTREAM_API_KEY;
  const environmentUpstreamConfigured = hasConfiguredCredential(
    environmentUpstreamKey,
  );
  const environmentUpstreamFingerprint =
    environmentUpstreamConfigured && !upstreamSnapshot.managedEnabled
      ? (await sha256Hex(environmentUpstreamKey)).slice(0, 16)
      : null;
  const [
    usersResult,
    callsResult,
    balanceResult,
    paymentsResult,
    recentCallsResult,
  ] = await db.batch([
    db.prepare(
      `SELECT COUNT(*) AS total_users,
              COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0)
                AS active_users
       FROM users`,
    ),
    db.prepare(
      `SELECT COUNT(*) AS calls_30d,
              COALESCE(SUM(CASE WHEN status_code = 200 THEN 1 ELSE 0 END), 0)
                AS successful_30d,
              COALESCE(SUM(
                CASE WHEN refunded = 0 THEN cost_usd_micros ELSE 0 END
              ), 0) AS gross_revenue_30d,
              COALESCE(SUM(
                CASE WHEN refunded = 0
                     THEN upstream_cost_usd_micros ELSE 0 END
              ), 0) AS upstream_cost_30d
       FROM api_calls
       WHERE datetime(created_at) >= datetime('now', '-30 days')`,
    ),
    db.prepare(
      `SELECT COALESCE(
         SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END),
         0
       ) AS outstanding_balance
       FROM (
         SELECT user_id, SUM(delta_usd_micros) AS balance
         FROM balance_ledger
         GROUP BY user_id
       )`,
    ),
    db.prepare(
      `SELECT COUNT(*) AS manual_review_payments
       FROM payment_orders
       WHERE status = 'manual_review'`,
    ),
    db.prepare(
      `SELECT c.id, u.email, c.upstream_path, c.platform,
              c.status_code, c.cost_usd_micros,
              c.upstream_cost_usd_micros, c.refunded, c.created_at
       FROM api_calls c
       JOIN users u ON u.id = c.user_id
       ORDER BY c.created_at DESC
       LIMIT 30`,
    ),
  ]);

  const users = firstResult<{
    total_users: number;
    active_users: number;
  }>(usersResult);
  const calls = firstResult<{
    calls_30d: number;
    successful_30d: number;
    gross_revenue_30d: number;
    upstream_cost_30d: number;
  }>(callsResult);
  const balances = firstResult<{ outstanding_balance: number }>(
    balanceResult,
  );
  const payments = firstResult<{ manual_review_payments: number }>(
    paymentsResult,
  );
  const calls30d = Number(calls?.calls_30d ?? 0);
  const successful30d = Number(calls?.successful_30d ?? 0);
  const grossRevenueUsdMicros = Number(
    calls?.gross_revenue_30d ?? 0,
  );
  const upstreamCostUsdMicros = Number(
    calls?.upstream_cost_30d ?? 0,
  );

  return jsonResponse(
    {
      summary: {
        totalUsers: Number(users?.total_users ?? 0),
        activeUsers: Number(users?.active_users ?? 0),
        calls30d,
        successRate:
          calls30d === 0
            ? 1
            : Math.round((successful30d / calls30d) * 10_000) / 10_000,
        grossRevenueUsdMicros,
        upstreamCostUsdMicros,
        grossMarginUsdMicros:
          grossRevenueUsdMicros - upstreamCostUsdMicros,
        outstandingBalanceUsdMicros: Math.max(
          0,
          Number(balances?.outstanding_balance ?? 0),
        ),
        manualReviewPayments: Number(
          payments?.manual_review_payments ?? 0,
        ),
      },
      recentCalls: resultRows<{
        id: string;
        email: string;
        upstream_path: string;
        platform: string;
        status_code: number;
        cost_usd_micros: number;
        upstream_cost_usd_micros: number;
        refunded: number;
        created_at: string;
      }>(recentCallsResult).map((row) => ({
        id: row.id,
        userEmail: row.email,
        path: row.upstream_path,
        platform: row.platform,
        statusCode: row.status_code,
        customerCostUsdMicros: row.cost_usd_micros,
        upstreamCostUsdMicros: row.upstream_cost_usd_micros,
        refunded: row.refunded === 1,
        createdAt: row.created_at,
      })),
      readiness: {
        ready: readiness.ready,
        mode: readiness.mode,
        missing: readiness.missing,
      },
      upstream: {
        configured: readiness.capabilities.upstreamConfigured,
        keyFingerprint:
          activeManagedCredential?.secret_hash.slice(0, 16) ??
          environmentUpstreamFingerprint,
        source: activeManagedCredential
          ? "managed"
          : !upstreamSnapshot.managedEnabled &&
              environmentUpstreamConfigured
            ? "environment"
            : "none",
        managedEnabled: upstreamSnapshot.managedEnabled,
        managedCredentialCount: upstreamSnapshot.credentials.length,
        stateVersion: upstreamSnapshot.stateVersion,
        encryptionConfigured: hasValidUpstreamProviderCredentialsEncryptionKey(
          env.UPSTREAM_CREDENTIALS_ENCRYPTION_KEY,
        ),
        sourceConfigured: upstreamConfig !== null,
        sourceEnabled: upstreamConfig?.enabled ?? false,
        sourceVersion: upstreamConfig?.version ?? null,
      },
      generatedAt: new Date().toISOString(),
    },
    200,
    requestId,
  );
}

async function handleAdminUsers(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "platform");
  const db = requireDb(env);
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  if (
    url.searchParams.getAll("limit").length > 1 ||
    url.searchParams.getAll("offset").length > 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100_000
  ) {
    throw new PlatformError(
      400,
      "invalid_pagination",
      "分页参数无效。",
    );
  }

  const [usersResult, countResult] = await db.batch([
    db
      .prepare(
        `WITH balances AS (
           SELECT user_id, COALESCE(SUM(delta_usd_micros), 0) AS balance
           FROM balance_ledger
           GROUP BY user_id
         ),
         usage AS (
           SELECT user_id,
                  COALESCE(SUM(
                    CASE WHEN datetime(created_at) >= datetime('now', '-30 days')
                         THEN 1 ELSE 0 END
                  ), 0) AS calls_30d,
                  COALESCE(SUM(
                    CASE WHEN datetime(created_at) >= datetime('now', '-30 days')
                              AND refunded = 0
                         THEN cost_usd_micros ELSE 0 END
                  ), 0) AS spend_30d,
                  MAX(created_at) AS last_call_at
           FROM api_calls
           GROUP BY user_id
         ),
         identity_providers AS (
           SELECT DISTINCT user_id, provider
           FROM auth_identities
         ),
         identities AS (
           SELECT p.user_id, json_group_array(p.provider) AS providers_json,
                  (
                    SELECT MAX(a.wallet_address)
                    FROM auth_identities a
                    WHERE a.user_id = p.user_id AND a.provider = 'wallet'
                  ) AS wallet_address
           FROM identity_providers p
           GROUP BY p.user_id
         ),
         active_keys AS (
           SELECT user_id, COUNT(*) AS active_key_count
           FROM api_keys
           WHERE revoked_at IS NULL
           GROUP BY user_id
         ),
         active_sessions AS (
           SELECT user_id, COUNT(*) AS active_session_count
           FROM auth_sessions
           WHERE datetime(expires_at) > datetime('now')
           GROUP BY user_id
         )
         SELECT u.id, u.email, u.display_name, u.status, u.created_at,
                COALESCE(b.balance, 0) AS balance,
                COALESCE(g.calls_30d, 0) AS calls_30d,
                COALESCE(g.spend_30d, 0) AS spend_30d,
                g.last_call_at,
                COALESCE(i.providers_json, '["sites"]') AS providers_json,
                i.wallet_address,
                COALESCE(k.active_key_count, 0) AS active_key_count,
                COALESCE(s.active_session_count, 0) AS active_session_count
         FROM users u
         LEFT JOIN balances b ON b.user_id = u.id
         LEFT JOIN usage g ON g.user_id = u.id
         LEFT JOIN identities i ON i.user_id = u.id
         LEFT JOIN active_keys k ON k.user_id = u.id
         LEFT JOIN active_sessions s ON s.user_id = u.id
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(limit, offset),
    db.prepare(`SELECT COUNT(*) AS count FROM users`),
  ]);
  const count = Number(
    firstResult<{ count: number }>(countResult)?.count ?? 0,
  );
  const users = resultRows<{
    id: string;
    email: string;
    display_name: string | null;
    status: string;
    created_at: string;
    balance: number;
    calls_30d: number;
    spend_30d: number;
    last_call_at: string | null;
    providers_json: string;
    wallet_address: string | null;
    active_key_count: number;
    active_session_count: number;
  }>(usersResult).map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name ?? row.email.split("@")[0],
    status: row.status,
    balanceUsdMicros: Number(row.balance),
    calls30d: Number(row.calls_30d),
    spend30dUsdMicros: Number(row.spend_30d),
    lastCallAt: row.last_call_at,
    providers: safeStoredStringArray(row.providers_json),
    walletAddress: row.wallet_address,
    activeKeyCount: Number(row.active_key_count),
    activeSessionCount: Number(row.active_session_count),
    createdAt: row.created_at,
  }));

  return jsonResponse(
    {
      users,
      count: users.length,
      total: count,
      offset,
      nextOffset:
        offset + users.length < count ? offset + users.length : null,
    },
    200,
    requestId,
  );
}

async function handleAdminUserUpdate(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "platform");
  const body = await readJsonBody<{
    userId?: unknown;
    status?: unknown;
    expectedStatus?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const userId =
    typeof body.userId === "string" ? body.userId.trim() : "";
  const status =
    typeof body.status === "string" ? body.status.trim() : "";
  const expectedStatus =
    typeof body.expectedStatus === "string"
      ? body.expectedStatus.trim()
      : "";
  if (!/^usr_[A-Za-z0-9_-]{8,128}$/.test(userId)) {
    throw new PlatformError(400, "invalid_user_id", "用户编号无效。");
  }
  if (status !== "active" && status !== "suspended") {
    throw new PlatformError(
      400,
      "invalid_user_status",
      "用户状态仅支持 active 或 suspended。",
    );
  }
  if (
    (expectedStatus !== "active" && expectedStatus !== "suspended") ||
    expectedStatus === status
  ) {
    throw new PlatformError(
      400,
      "invalid_expected_user_status",
      "必须提交与目标状态不同的当前用户状态。",
    );
  }

  const db = requireDb(env);
  const auditStatement = await prepareAdminAuditStatement(db, request, {
    action: "user.status_updated",
    targetType: "user",
    targetId: userId,
    details: {
      status,
      expectedStatus,
      credentialsInvalidated: status === "suspended",
    },
    userStatusUpdate: { userId, status },
  });
  const results = await db.batch([
    db
      .prepare(
        `UPDATE users
         SET status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = ?`,
      )
      .bind(status, userId, expectedStatus),
    auditStatement,
    db
      .prepare(
        `UPDATE api_keys
         SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
         WHERE user_id = ? AND ? = 'suspended'`,
      )
      .bind(userId, status),
    db
      .prepare(
        `DELETE FROM auth_sessions
         WHERE user_id = ? AND ? = 'suspended'`,
      )
      .bind(userId, status),
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    const exists = await db
      .prepare(`SELECT 1 AS present FROM users WHERE id = ?`)
      .bind(userId)
      .first<{ present: number }>();
    if (!exists) {
      throw new PlatformError(404, "user_not_found", "没有找到这个用户。");
    }
    throw new PlatformError(
      409,
      "user_status_conflict",
      "用户状态已变化，请刷新后重新操作。",
    );
  }
  return jsonResponse({ ok: true, userId, status }, 200, requestId);
}

async function handleAdminPayments(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "payments");
  const db = requireDb(env);
  const url = new URL(request.url);
  const status = url.searchParams.get("status")?.trim().toLowerCase();
  if (status && !/^[a-z_]{1,64}$/.test(status)) {
    throw new PlatformError(
      400,
      "invalid_payment_status",
      "支付状态筛选值无效。",
    );
  }
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  if (
    url.searchParams.getAll("limit").length > 1 ||
    url.searchParams.getAll("offset").length > 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100_000
  ) {
    throw new PlatformError(400, "invalid_pagination", "分页参数无效。");
  }
  const query = status
    ? db
        .prepare(
          `SELECT p.id, p.provider_payment_id, p.amount_usd_micros,
                  p.pay_currency, p.pay_amount, p.pay_address,
                  p.invoice_url, p.status, p.credited_usd_micros,
                  p.created_at, p.updated_at, u.email
           FROM payment_orders p
           JOIN users u ON u.id = p.user_id
           WHERE p.status = ?
           ORDER BY p.updated_at DESC
           LIMIT ? OFFSET ?`,
        )
        .bind(status, limit, offset)
    : db.prepare(
        `SELECT p.id, p.provider_payment_id, p.amount_usd_micros,
                p.pay_currency, p.pay_amount, p.pay_address,
                p.invoice_url, p.status, p.credited_usd_micros,
                p.created_at, p.updated_at, u.email
         FROM payment_orders p
         JOIN users u ON u.id = p.user_id
         ORDER BY p.updated_at DESC
         LIMIT ? OFFSET ?`,
      ).bind(limit, offset);
  const countQuery = status
    ? db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM payment_orders
           WHERE status = ?`,
        )
        .bind(status)
    : db.prepare(`SELECT COUNT(*) AS count FROM payment_orders`);
  const [rowsResult, countResult] = await db.batch([query, countQuery]);
  const rows = resultRows<
    Omit<PaymentOrderRecord, "user_id" | "idempotency_hash"> & {
      email: string;
    }
  >(rowsResult);
  const total = Number(
    firstResult<{ count: number }>(countResult)?.count ?? 0,
  );

  return jsonResponse(
    {
      payments: rows.map((row) => ({
        id: row.id,
        userEmail: row.email,
        providerPaymentId: row.provider_payment_id,
        amountUsdMicros: row.amount_usd_micros,
        payCurrency: row.pay_currency,
        payAmount: row.pay_amount,
        payAddress: row.pay_address,
        invoiceUrl: safeInvoiceUrl(row.invoice_url),
        status: row.status,
        creditedUsdMicros: row.credited_usd_micros,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      count: rows.length,
      total,
      offset,
      nextOffset:
        offset + rows.length < total ? offset + rows.length : null,
    },
    200,
    requestId,
  );
}

async function handleRecoverPayment(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "payments");
  const apiKey = env.NOWPAYMENTS_API_KEY;
  if (!apiKey) {
    throw new PlatformError(
      503,
      "payment_provider_unavailable",
      "支付服务商密钥尚未配置。",
    );
  }
  const body = await readJsonBody<{
    orderId?: unknown;
    paymentId?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const orderId =
    typeof body.orderId === "string" ? body.orderId.trim() : "";
  const paymentId =
    typeof body.paymentId === "string" ? body.paymentId.trim() : "";
  if (
    !/^pay_[A-Za-z0-9_-]+$/.test(orderId) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(paymentId)
  ) {
    throw new PlatformError(
      400,
      "invalid_payment_recovery",
      "充值单编号或支付服务商编号无效。",
    );
  }

  const db = requireDb(env);
  const order = await paymentOrderById(db, orderId);
  if (!order) {
    throw new PlatformError(404, "payment_not_found", "支付订单不存在。");
  }
  if (
    order.provider_payment_id != null &&
    order.provider_payment_id !== paymentId
  ) {
    throw new PlatformError(
      409,
      "payment_binding_conflict",
      "充值单已绑定到其他支付服务商编号。",
    );
  }
  const openReview = await db
    .prepare(
      `SELECT id
       FROM payment_review_cases
       WHERE order_id = ? AND status = 'open'
       LIMIT 1`,
    )
    .bind(orderId)
    .first<{ id: string }>();
  if (openReview) {
    throw new PlatformError(
      409,
      "payment_review_required",
      "该充值单存在待处理资金复核，请先在支付复核中显式处置。",
    );
  }

  const verified = await getNowPaymentsPayment(apiKey, paymentId);
  await applyVerifiedNowPayment(db, verified, {
    paymentId,
    orderId,
    requestId,
    allowManualReviewRecovery: true,
  });
  const recovered = await paymentOrderById(db, orderId);
  if (!recovered) {
    throw new PlatformError(
      500,
      "payment_record_missing",
      "恢复后的充值单记录不可用。",
    );
  }
  await writeAdminAudit(db, request, {
    action: "payment.recovered",
    targetType: "payment_order",
    targetId: orderId,
    details: { paymentId, status: recovered.status },
  });
  return paymentOrderResponse(recovered, 200, requestId);
}

async function handlePaymentReviewList(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "payments");
  const url = new URL(request.url);
  const status = (url.searchParams.get("status") ?? "open")
    .trim()
    .toLowerCase();
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  if (
    (status !== "open" && status !== "resolved" && status !== "all") ||
    url.searchParams.getAll("status").length > 1 ||
    url.searchParams.getAll("limit").length > 1 ||
    url.searchParams.getAll("offset").length > 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100_000
  ) {
    throw new PlatformError(
      400,
      "invalid_review_filter",
      "支付复核筛选参数无效。",
    );
  }
  const db = requireDb(env);
  const predicate = status === "all" ? "" : "WHERE r.status = ?";
  const list = status === "all"
    ? db
        .prepare(
          `SELECT r.id, r.order_id, r.provider_payment_id,
                  r.parent_payment_id, r.reason, r.status,
                  r.actually_paid, r.pay_currency, r.evidence_json,
                  r.resolution_action, r.resolution_note,
                  r.resolution_reference, r.created_at, r.resolved_at,
                  p.user_id, u.email
           FROM payment_review_cases r
           JOIN payment_orders p ON p.id = r.order_id
           JOIN users u ON u.id = p.user_id
           ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END,
                    r.created_at DESC
           LIMIT ? OFFSET ?`,
        )
        .bind(limit, offset)
    : db
        .prepare(
          `SELECT r.id, r.order_id, r.provider_payment_id,
                  r.parent_payment_id, r.reason, r.status,
                  r.actually_paid, r.pay_currency, r.evidence_json,
                  r.resolution_action, r.resolution_note,
                  r.resolution_reference, r.created_at, r.resolved_at,
                  p.user_id, u.email
           FROM payment_review_cases r
           JOIN payment_orders p ON p.id = r.order_id
           JOIN users u ON u.id = p.user_id
           ${predicate}
           ORDER BY r.created_at DESC
           LIMIT ? OFFSET ?`,
        )
        .bind(status, limit, offset);
  const countQuery =
    status === "all"
      ? db.prepare(`SELECT COUNT(*) AS count FROM payment_review_cases`)
      : db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM payment_review_cases
             WHERE status = ?`,
          )
          .bind(status);
  const [rowsResult, countResult] = await db.batch([list, countQuery]);
  const rows = resultRows<{
    id: string;
    order_id: string;
    provider_payment_id: string;
    parent_payment_id: string | null;
    reason: string;
    status: string;
    actually_paid: string | null;
    pay_currency: string | null;
    evidence_json: string;
    resolution_action: string | null;
    resolution_note: string | null;
    resolution_reference: string | null;
    created_at: string;
    resolved_at: string | null;
    user_id: string;
    email: string;
  }>(rowsResult);
  return jsonResponse(
    {
      reviews: rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        userId: row.user_id,
        email: row.email,
        providerPaymentId: row.provider_payment_id,
        parentPaymentId: row.parent_payment_id,
        reason: row.reason,
        status: row.status,
        actuallyPaid: row.actually_paid,
        payCurrency: row.pay_currency,
        evidence: safeStoredJson(row.evidence_json),
        resolutionAction: row.resolution_action,
        resolutionNote: row.resolution_note,
        resolutionReference: row.resolution_reference,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
      })),
      count: rows.length,
      total: Number(
        firstResult<{ count: number }>(countResult)?.count ?? 0,
      ),
      status,
      offset,
      nextOffset:
        offset + rows.length <
        Number(firstResult<{ count: number }>(countResult)?.count ?? 0)
          ? offset + rows.length
          : null,
    },
    200,
    requestId,
  );
}

async function handlePaymentReviewResolve(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "payments");
  const apiKey = env.NOWPAYMENTS_API_KEY;
  if (!hasConfiguredCredential(apiKey)) {
    throw new PlatformError(
      503,
      "payment_provider_unavailable",
      "支付服务商密钥尚未配置。",
    );
  }
  const body = await readJsonBody<{
    caseId?: unknown;
    action?: unknown;
    creditUsdMicros?: unknown;
    note?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const caseId =
    typeof body.caseId === "string" ? body.caseId.trim() : "";
  const action =
    typeof body.action === "string" ? body.action.trim() : "";
  const note =
    typeof body.note === "string"
      ? body.note.replace(/\s+/g, " ").trim()
      : "";
  if (!/^prv_[A-Za-z0-9_-]{12,100}$/.test(caseId)) {
    throw new PlatformError(400, "invalid_review_case", "复核案件编号无效。");
  }
  if (
    action !== "credit" &&
    action !== "refund_confirmed" &&
    action !== "reject"
  ) {
    throw new PlatformError(400, "invalid_review_action", "复核操作无效。");
  }
  if (note.length < 4 || note.length > 500) {
    throw new PlatformError(
      400,
      "invalid_review_note",
      "复核备注必须为 4–500 个字符。",
    );
  }
  const creditUsdMicros =
    action === "credit" &&
    typeof body.creditUsdMicros === "number" &&
    Number.isSafeInteger(body.creditUsdMicros)
      ? body.creditUsdMicros
      : null;
  if (
    action === "credit" &&
    (creditUsdMicros == null || creditUsdMicros < 1)
  ) {
    throw new PlatformError(
      400,
      "invalid_review_credit",
      "人工入账金额必须是大于 0 的美元微单位整数。",
    );
  }
  const resolutionRequestHash = await sha256Hex(
    JSON.stringify({
      action,
      creditUsdMicros,
      note,
    }),
  );

  const db = requireDb(env);
  const review = await db
    .prepare(
      `SELECT r.id, r.order_id, r.provider_payment_id,
              r.parent_payment_id, r.reason, r.status, r.evidence_json,
              r.resolution_action, r.resolution_credit_usd_micros,
              r.resolution_request_hash,
              p.user_id, p.provider_payment_id AS order_payment_id,
              p.amount_usd_micros, p.pay_currency, p.pay_amount
       FROM payment_review_cases r
       JOIN payment_orders p ON p.id = r.order_id
       WHERE r.id = ?`,
    )
    .bind(caseId)
    .first<{
      id: string;
      order_id: string;
      provider_payment_id: string;
      parent_payment_id: string | null;
      reason: string;
      status: string;
      evidence_json: string;
      resolution_action: string | null;
      resolution_credit_usd_micros: number | null;
      resolution_request_hash: string | null;
      user_id: string;
      order_payment_id: string | null;
      amount_usd_micros: number;
      pay_currency: string;
      pay_amount: string | null;
    }>();
  if (!review) {
    throw new PlatformError(404, "review_case_not_found", "复核案件不存在。");
  }
  if (review.status === "resolved") {
    if (
      review.resolution_action !== action ||
      review.resolution_request_hash !== resolutionRequestHash ||
      review.resolution_credit_usd_micros !== creditUsdMicros
    ) {
      throw new PlatformError(
        409,
        "review_already_resolved",
        "该案件已用其他参数处理；请刷新并核对已落账金额与备注。",
      );
    }
    return jsonResponse(
      { ok: true, caseId, status: "resolved", action },
      200,
      requestId,
    );
  }

  if (
    action === "credit" &&
    creditUsdMicros != null &&
    creditUsdMicros > review.amount_usd_micros
  ) {
    throw new PlatformError(
      400,
      "invalid_review_credit",
      "人工入账金额必须是大于 0 且不超过原充值单金额的美元微单位整数。",
    );
  }

  const verified = await getNowPaymentsPayment(
    apiKey,
    review.provider_payment_id,
  );
  const verifiedPaymentId = String(verified.payment_id ?? "");
  const verifiedParentId = String(verified.parent_payment_id ?? "").trim();
  const verifiedStatus =
    typeof verified.payment_status === "string"
      ? verified.payment_status.trim().toLowerCase()
      : "";
  const verifiedOrderMatches =
    review.parent_payment_id != null
      ? verifiedParentId === review.parent_payment_id &&
        review.order_payment_id === review.parent_payment_id &&
        (verified.order_id == null ||
          verified.order_id === "" ||
          verified.order_id === review.order_id)
      : verified.order_id === review.order_id &&
        (review.order_payment_id == null ||
          review.order_payment_id === review.provider_payment_id);
  if (
    verifiedPaymentId !== review.provider_payment_id ||
    !verifiedOrderMatches
  ) {
    throw new PlatformError(
      409,
      "payment_review_mismatch",
      "服务商复核结果与案件绑定信息不一致。",
    );
  }
  if (
    action === "credit" &&
    (!NOWPAYMENTS_REVIEW_CREDITABLE_STATUSES.has(verifiedStatus) ||
      normalizedPositiveDecimal(verified.actually_paid) == null ||
      typeof verified.pay_currency !== "string" ||
      verified.pay_currency.toLowerCase() !==
        review.pay_currency.toLowerCase())
  ) {
    throw new PlatformError(
      409,
      "payment_review_not_creditable",
      "服务商状态尚未确认可入账资金，或到账币种不匹配，不能人工入账。",
    );
  }
  if (action === "credit" && creditUsdMicros != null) {
    const expectedPayAmount =
      normalizedPositiveDecimal(review.pay_amount) ??
      normalizedPositiveDecimal(verified.pay_amount);
    const maxCreditUsdMicros =
      expectedPayAmount == null
        ? null
        : proportionalPaymentCreditUsdMicros(
            review.amount_usd_micros,
            verified.actually_paid,
            expectedPayAmount,
          );
    if (
      maxCreditUsdMicros == null ||
      creditUsdMicros > maxCreditUsdMicros
    ) {
      throw new PlatformError(
        400,
        "review_credit_exceeds_verified_payment",
        maxCreditUsdMicros == null
          ? "无法从服务商证据计算可入账上限，不能人工入账。"
          : `人工入账不能超过已验证到账比例对应的 ${maxCreditUsdMicros} 美元微单位。`,
      );
    }
  }
  if (action === "refund_confirmed" && verifiedStatus !== "refunded") {
    throw new PlatformError(
      409,
      "refund_not_confirmed",
      "服务商状态尚未确认退款，不能关闭为已退款。",
    );
  }
  if (action === "reject") {
    const actualPaid = decimalToScaledInteger(
      verified.actually_paid,
      18,
    );
    if (
      (verifiedStatus !== "failed" && verifiedStatus !== "expired") ||
      actualPaid !== BigInt(0)
    ) {
      throw new PlatformError(
        409,
        "payment_review_reject_not_safe",
        "只有服务商已确认失败或过期且实际到账为零的案件才能拒绝；已收到资金的案件必须入账、冻结或确认退款。",
      );
    }
  }

  const ledgerReference = `nowpayments-review:${caseId}:credit`;
  const originalCreditReference =
    `nowpayments:${review.provider_payment_id}:credit`;
  const resolutionReference =
    action === "credit"
      ? ledgerReference
      : `nowpayments:${review.provider_payment_id}:${verifiedStatus || "unknown"}`;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE payment_review_cases
         SET status = 'resolved', resolution_action = ?,
             resolution_credit_usd_micros = ?,
             resolution_request_hash = ?,
             resolution_note = ?, resolution_reference = ?,
             resolved_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'open'
           AND (? != 'reject' OR evidence_json = ?)
           AND (
             ? != 'credit'
             OR NOT EXISTS (
               SELECT 1
               FROM balance_ledger
               WHERE reference_id = ?
                 AND delta_usd_micros > 0
             )
           )`,
      )
      .bind(
        action,
        creditUsdMicros,
        resolutionRequestHash,
        note,
        resolutionReference,
        caseId,
        action,
        review.evidence_json,
        action,
        originalCreditReference,
      ),
  ];
  if (action === "credit" && creditUsdMicros != null) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO balance_ledger
           (id, user_id, entry_type, delta_usd_micros, reference_id,
            description, created_at)
           SELECT ?, ?, 'payment_review_credit', ?, ?,
                  'Operator-reviewed stablecoin credit', CURRENT_TIMESTAMP
           WHERE EXISTS (
             SELECT 1 FROM payment_review_cases
             WHERE id = ? AND status = 'resolved'
               AND resolution_action = 'credit'
               AND resolution_request_hash = ?
           )
             AND NOT EXISTS (
               SELECT 1
               FROM balance_ledger
               WHERE reference_id = ?
                 AND delta_usd_micros > 0
             )`,
        )
        .bind(
          `led_${randomBase64Url(16)}`,
          review.user_id,
          creditUsdMicros,
          ledgerReference,
          caseId,
          resolutionRequestHash,
          originalCreditReference,
        ),
      paymentCreditedRecalculation(db, review.order_id),
    );
  }
  if (action === "refund_confirmed") {
    if (review.order_payment_id === review.provider_payment_id) {
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO balance_ledger
             (id, user_id, entry_type, delta_usd_micros, reference_id,
              description, created_at)
             SELECT ?, user_id, 'payment_reversal',
                    -delta_usd_micros, ?,
                    'Provider-confirmed payment refund', CURRENT_TIMESTAMP
             FROM balance_ledger
             WHERE reference_id = ? AND delta_usd_micros > 0
               AND EXISTS (
                 SELECT 1
                 FROM payment_review_cases
                 WHERE id = ? AND status = 'resolved'
                   AND resolution_action = 'refund_confirmed'
                   AND resolution_request_hash = ?
               )
             LIMIT 1`,
          )
          .bind(
            `led_${randomBase64Url(16)}`,
            `nowpayments:${review.provider_payment_id}:reversal`,
            `nowpayments:${review.provider_payment_id}:credit`,
            caseId,
            resolutionRequestHash,
          ),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO balance_ledger
           (id, user_id, entry_type, delta_usd_micros, reference_id,
            description, created_at)
           SELECT ?, user_id, 'payment_review_reversal',
                  -delta_usd_micros, ?,
                  'Provider-confirmed reviewed payment refund',
                  CURRENT_TIMESTAMP
           FROM balance_ledger
           WHERE reference_id = ? AND delta_usd_micros > 0
             AND EXISTS (
               SELECT 1
               FROM payment_review_cases
               WHERE id = ? AND status = 'resolved'
                 AND resolution_action = 'refund_confirmed'
                 AND resolution_request_hash = ?
             )
           LIMIT 1`,
        )
        .bind(
          `led_${randomBase64Url(16)}`,
          `nowpayments-review:${caseId}:reversal`,
          `nowpayments-review:${caseId}:credit`,
          caseId,
          resolutionRequestHash,
        ),
      paymentCreditedRecalculation(db, review.order_id),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE payment_orders
         SET status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND EXISTS (
             SELECT 1
             FROM payment_review_cases
             WHERE id = ? AND status = 'resolved'
               AND resolution_action = ?
               AND resolution_request_hash = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM payment_review_cases
             WHERE order_id = ? AND status = 'open'
           )`,
      )
      .bind(
        action === "refund_confirmed" &&
          review.order_payment_id === review.provider_payment_id
          ? "refunded"
          : "manual_resolved",
        review.order_id,
        caseId,
        action,
        resolutionRequestHash,
        review.order_id,
      ),
  );
  statements.push(
    await prepareAdminAuditStatement(db, request, {
      action: `payment_review.${action}`,
      targetType: "payment_review_case",
      targetId: caseId,
      idempotencyKey: resolutionRequestHash,
      paymentReviewResolution: {
        caseId,
        action,
        requestHash: resolutionRequestHash,
      },
      details: {
        orderId: review.order_id,
        providerPaymentId: review.provider_payment_id,
        creditUsdMicros,
        note,
      },
    }),
  );
  const results = await db.batch(statements);
  const resolutionChanged =
    Number(results[0]?.meta?.changes ?? 0) === 1;
  const reviewCreditChanged =
    action !== "credit" ||
    Number(results[1]?.meta?.changes ?? 0) === 1;
  if (!resolutionChanged || !reviewCreditChanged) {
    const current = await db
      .prepare(
        `SELECT status, resolution_action,
                resolution_credit_usd_micros,
                resolution_request_hash, evidence_json
         FROM payment_review_cases
         WHERE id = ?`,
      )
      .bind(caseId)
      .first<{
        status: string;
        resolution_action: string | null;
        resolution_credit_usd_micros: number | null;
        resolution_request_hash: string | null;
        evidence_json: string;
      }>();
    const exactReplay =
      current?.status === "resolved" &&
      current.resolution_action === action &&
      current.resolution_credit_usd_micros === creditUsdMicros &&
      current.resolution_request_hash === resolutionRequestHash;
    if (!exactReplay) {
      if (
        action === "reject" &&
        current?.status === "open" &&
        current.evidence_json !== review.evidence_json
      ) {
        throw new PlatformError(
          409,
          "payment_review_evidence_changed",
          "案件在拒绝处理期间收到了新的服务商证据；已保留为待复核，请刷新后重新核对。",
        );
      }
      if (action === "credit") {
        const originalCredit = await db
          .prepare(
            `SELECT 1 AS present
             FROM balance_ledger
             WHERE reference_id = ? AND delta_usd_micros > 0
             LIMIT 1`,
          )
          .bind(originalCreditReference)
          .first<{ present: number }>();
        if (originalCredit) {
          throw new PlatformError(
            409,
            "payment_already_credited",
            "该服务商支付已自动入账，不能再次人工入账。",
          );
        }
      }
      throw new PlatformError(
        409,
        "review_resolution_conflict",
        "复核案件已被其他管理员处理，请刷新。",
      );
    }
  }
  return jsonResponse(
    { ok: true, caseId, status: "resolved", action },
    200,
    requestId,
  );
}

async function handleAdminAuditList(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "platform");
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "100");
  if (
    url.searchParams.getAll("limit").length > 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  ) {
    throw new PlatformError(400, "invalid_limit", "limit 参数无效。");
  }
  const rows = await requireDb(env)
    .prepare(
      `SELECT id, actor_fingerprint, action, target_type, target_id,
              details_json, created_at
       FROM admin_audit_logs
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<{
      id: string;
      actor_fingerprint: string;
      action: string;
      target_type: string;
      target_id: string;
      details_json: string | null;
      created_at: string;
    }>();
  return jsonResponse(
    {
      events: (rows.results ?? []).map((row) => ({
        id: row.id,
        actorFingerprint: row.actor_fingerprint,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        details: safeStoredJson(row.details_json),
        createdAt: row.created_at,
      })),
      count: rows.results?.length ?? 0,
    },
    200,
    requestId,
  );
}

async function handleUpstreamConfigGet(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "platform");
  const config = await loadUpstreamSourceConfig(requireDb(env), env, false);
  return jsonResponse(
    {
      configured: config !== null,
      config: config
        ? {
            enabled: config.enabled,
            version: config.version,
            sourceOrigin: config.origin,
            apiPathPrefix: config.apiPathPrefix,
            openApiPath: config.openApiPath,
            catalogPath: config.catalogPath,
            credentialPath: config.credentialPath,
            catalogAuthMode: config.catalogAuthMode,
            publicExcludedPrefixes: config.publicExcludedPrefixes,
            updatedAt: config.updatedAt,
          }
        : null,
      originAllowlistConfigured:
        parseUpstreamAllowedOrigins(env.UPSTREAM_ALLOWED_ORIGINS).size > 0,
    },
    200,
    requestId,
  );
}

async function handleUpstreamConfigPut(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  requireAdminSecret(request, env, "platform");
  const body = await readJsonBody<Record<string, unknown>>(
    request,
    MAX_DASHBOARD_BODY_BYTES,
  );
  const expectedVersion =
    typeof body.expectedVersion === "number"
      ? body.expectedVersion
      : Number.NaN;
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0 ||
    expectedVersion > 2_147_483_647
  ) {
    throw new PlatformError(
      400,
      "invalid_upstream_config_version",
      "保存数据源配置时必须提供当前版本。",
    );
  }
  const normalized = normalizeUpstreamSourceConfigInput(body, env);
  const configHash = await sha256Hex(
    JSON.stringify({
      enabled: normalized.enabled,
      sourceOrigin: normalized.origin,
      apiPathPrefix: normalized.apiPathPrefix,
      openApiPath: normalized.openApiPath,
      catalogPath: normalized.catalogPath,
      credentialPath: normalized.credentialPath,
      catalogAuthMode: normalized.catalogAuthMode,
      publicExcludedPrefixes: normalized.publicExcludedPrefixes,
    }),
  );
  const db = requireDb(env);
  const current = await db
    .prepare(`SELECT version FROM upstream_source_config WHERE id = 1`)
    .first<{ version: number }>();
  const currentVersion = Number(current?.version ?? 0);
  if (currentVersion !== expectedVersion) {
    throw new PlatformError(
      409,
      "upstream_config_update_conflict",
      "数据源配置已被其他操作更新，请刷新后重试。",
    );
  }
  const nextVersion = expectedVersion + 1;
  const mutationDigits = Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (byte) => String(byte % 10),
  ).join("");
  const configUpdatedAt = new Date()
    .toISOString()
    .replace(/Z$/, `${mutationDigits}Z`);
  const audit = await prepareAdminAuditStatement(db, request, {
    action: "upstream_config.updated",
    targetType: "upstream_config",
    targetId: "primary",
    upstreamConfigUpdate: {
      version: nextVersion,
      configHash,
      updatedAt: configUpdatedAt,
    },
    details: {
      enabled: normalized.enabled,
      version: nextVersion,
      publicExcludedPrefixCount:
        normalized.publicExcludedPrefixes.length,
    },
  });
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO upstream_source_config
         (id, enabled, version, config_hash, source_origin,
          api_path_prefix, openapi_path, catalog_path, credential_path,
          catalog_auth_mode, public_excluded_prefixes_json, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           enabled = excluded.enabled,
           version = excluded.version,
           config_hash = excluded.config_hash,
           source_origin = excluded.source_origin,
           api_path_prefix = excluded.api_path_prefix,
           openapi_path = excluded.openapi_path,
           catalog_path = excluded.catalog_path,
           credential_path = excluded.credential_path,
           catalog_auth_mode = excluded.catalog_auth_mode,
           public_excluded_prefixes_json =
             excluded.public_excluded_prefixes_json,
           updated_at = excluded.updated_at
         WHERE upstream_source_config.version = ?`,
      )
      .bind(
        normalized.enabled ? 1 : 0,
        nextVersion,
        configHash,
        normalized.origin,
        normalized.apiPathPrefix,
        normalized.openApiPath,
        normalized.catalogPath,
        normalized.credentialPath,
        normalized.catalogAuthMode,
        JSON.stringify(normalized.publicExcludedPrefixes),
        configUpdatedAt,
        expectedVersion,
      ),
    db
      .prepare(
        `DELETE FROM catalog_sync_state
         WHERE id = 1
           AND EXISTS (
             SELECT 1 FROM upstream_source_config
             WHERE id = 1 AND version = ? AND config_hash = ?
               AND updated_at = ?
           )`,
      )
      .bind(nextVersion, configHash, configUpdatedAt),
    db.prepare(
      `UPDATE endpoint_catalog
       SET enabled = 0, read_only = 0, reviewed_at = NULL,
           sync_generation = NULL, revision = revision + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE EXISTS (
         SELECT 1 FROM upstream_source_config
         WHERE id = 1 AND version = ? AND config_hash = ?
           AND updated_at = ?
       )`,
    ).bind(nextVersion, configHash, configUpdatedAt),
    db
      .prepare(
        `DELETE FROM catalog_unresolved_endpoints
         WHERE EXISTS (
           SELECT 1 FROM upstream_source_config
           WHERE id = 1 AND version = ? AND config_hash = ?
             AND updated_at = ?
         )`,
      )
      .bind(nextVersion, configHash, configUpdatedAt),
    db.prepare(
      `UPDATE upstream_credentials
       SET verified_scopes_json = NULL, verified_config_hash = NULL,
           verified_at = NULL, expires_at = NULL
       WHERE revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM upstream_source_config
           WHERE id = 1 AND version = ? AND config_hash = ?
             AND updated_at = ?
         )`,
    ).bind(nextVersion, configHash, configUpdatedAt),
    db.prepare(
      `UPDATE upstream_credential_state
       SET active_credential_id = NULL, version = version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE EXISTS (
         SELECT 1 FROM upstream_source_config
         WHERE id = 1 AND version = ? AND config_hash = ?
           AND updated_at = ?
       )`,
    ).bind(nextVersion, configHash, configUpdatedAt),
    audit,
  ]);
  if (
    Number(results[0]?.meta?.changes ?? 0) !== 1 ||
    Number(results[6]?.meta?.changes ?? 0) !== 1
  ) {
    throw new PlatformError(
      409,
      "upstream_config_update_conflict",
      "数据源配置已发生变化，请刷新后重试。",
    );
  }
  const saved = await loadUpstreamSourceConfig(db, env, false);
  if (!saved) {
    throw new PlatformError(
      500,
      "upstream_config_write_failed",
      "数据源配置保存后无法读取。",
    );
  }
  return jsonResponse(
    {
      config: {
        enabled: saved.enabled,
        version: saved.version,
        sourceOrigin: saved.origin,
        apiPathPrefix: saved.apiPathPrefix,
        openApiPath: saved.openApiPath,
        catalogPath: saved.catalogPath,
        credentialPath: saved.credentialPath,
        catalogAuthMode: saved.catalogAuthMode,
        publicExcludedPrefixes: saved.publicExcludedPrefixes,
        updatedAt: saved.updatedAt,
      },
      catalogInvalidated: true,
      credentialsRequireVerification: true,
    },
    200,
    requestId,
  );
}

async function handleUpstreamCredentialsList(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "platform");
  const db = requireDb(env);
  const snapshot = await managedUpstreamProviderCredentialsSnapshot(db);
  const active =
    snapshot.credentials.find((row) => row.status === "active") ?? null;
  const environmentKey = env.UPSTREAM_API_KEY;
  const environmentConfigured = hasConfiguredCredential(environmentKey);
  const environmentFingerprint = environmentConfigured
    ? (await sha256Hex(environmentKey)).slice(0, 16)
    : null;

  return jsonResponse(
    {
      credentials: snapshot.credentials.map(publicManagedUpstreamProviderCredential),
      activeSource: active
        ? "managed"
        : !snapshot.managedEnabled && environmentConfigured
          ? "environment"
          : "none",
      activeCredentialId: snapshot.activeCredentialId,
      activeFingerprint:
        active?.secret_hash.slice(0, 16) ??
        (!snapshot.managedEnabled ? environmentFingerprint : null),
      stateVersion: snapshot.stateVersion,
      managedEnabled: snapshot.managedEnabled,
      encryptionConfigured: hasValidUpstreamProviderCredentialsEncryptionKey(
        env.UPSTREAM_CREDENTIALS_ENCRYPTION_KEY,
      ),
      environmentFallbackConfigured: environmentConfigured,
    },
    200,
    requestId,
  );
}

async function handleUpstreamCredentialCreate(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  requireAdminSecret(request, env, "platform");
  const encryptionKey = requireUpstreamProviderCredentialsEncryptionKey(env);
  const body = await readJsonBody<{
    label?: unknown;
    apiKey?: unknown;
    activate?: unknown;
    expectedVersion?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const label = sanitizeUpstreamCredentialLabel(body.label);
  const apiKey =
    typeof body.apiKey === "string" ? body.apiKey : "";
  if (!isValidUpstreamProviderApiKey(apiKey)) {
    throw new PlatformError(
      400,
      "invalid_upstream_credential",
      "UpstreamProvider API Key 格式无效。",
    );
  }
  if (typeof body.activate !== "boolean") {
    throw new PlatformError(
      400,
      "invalid_upstream_credential_action",
      "必须明确选择是否在保存后验证并启用。",
    );
  }
  const expectedVersion =
    typeof body.expectedVersion === "number"
      ? body.expectedVersion
      : Number.NaN;
  if (
    body.activate &&
    (!Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      expectedVersion > 2_147_483_647)
  ) {
    throw new PlatformError(
      400,
      "invalid_upstream_credential_version",
      "启用 UpstreamProvider 凭据时必须提供当前状态版本。",
    );
  }

  const db = requireDb(env);
  const sourceConfig = body.activate
    ? await loadUpstreamSourceConfig(db, env, true)
    : null;
  if (body.activate) {
    const currentState = await upstreamCredentialState(db);
    if (currentState.version !== expectedVersion) {
      throw new PlatformError(
        409,
        "upstream_credential_update_conflict",
        "UpstreamProvider 活动凭据已发生变化，请刷新后重试。",
      );
    }
  }
  const verification = body.activate
    ? await verifyUpstreamProviderApiKey(
        apiKey,
        env,
        sourceConfig as UpstreamSourceConfig,
      )
    : null;

  const id = `upc_${randomBase64Url(18)}`;
  const secretHash = await sha256Hex(apiKey);
  const fingerprint = secretHash.slice(0, 16);
  const encryptedSecret = await encryptUpstreamProviderApiKey(
    apiKey,
    encryptionKey,
    id,
  );
  const createStatement = db.prepare(
      `INSERT INTO upstream_credentials
       (id, provider, label, encrypted_secret, secret_hash,
        verified_scopes_json, verified_config_hash, expires_at,
        verified_at, created_at)
       SELECT ?, 'primary', ?, ?, ?, ?, ?, ?,
              CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
              CURRENT_TIMESTAMP
       WHERE NOT EXISTS (
         SELECT 1 FROM upstream_credentials
         WHERE provider = 'primary' AND secret_hash = ?
       )
       AND (
         SELECT COUNT(*)
         FROM upstream_credentials
         WHERE provider = 'primary' AND revoked_at IS NULL
       ) < 100`,
    )
    .bind(
      id,
      label,
      encryptedSecret,
      secretHash,
      verification ? JSON.stringify(verification.scopes) : null,
      verification?.configHash ?? null,
      verification?.expiresAt ?? null,
      body.activate ? 1 : 0,
      secretHash,
    );
  const createAudit = await prepareAdminAuditStatement(db, request, {
    action: "upstream_credential.created",
    targetType: "upstream_credential",
    targetId: id,
    upstreamCredentialExists: { id, secretHash },
    details: {
      provider: PRIMARY_UPSTREAM_PROVIDER,
      label,
      fingerprint,
      activateRequested: body.activate,
    },
  });
  const created = await db.batch([createStatement, createAudit]);
  if (
    Number(created[0]?.meta?.changes ?? 0) !== 1 ||
    Number(created[1]?.meta?.changes ?? 0) !== 1
  ) {
    const duplicate = await db
      .prepare(
        `SELECT 1 AS present
         FROM upstream_credentials
         WHERE provider = 'primary' AND secret_hash = ?
         LIMIT 1`,
      )
      .bind(secretHash)
      .first<{ present: number }>();
    if (duplicate) {
      throw new PlatformError(
        409,
        "upstream_credential_exists",
        "相同 UpstreamProvider API Key 已经存在。",
      );
    }
    throw new PlatformError(
      409,
      "upstream_credential_limit",
      "当前未撤销的 UpstreamProvider 凭据已达到 100 条安全上限。",
    );
  }

  let activationConflict = false;
  if (body.activate) {
    try {
      await activateManagedUpstreamProviderCredential(
        db,
        request,
        id,
        expectedVersion,
        verification as UpstreamProviderCredentialVerification,
      );
    } catch (error) {
      if (
        error instanceof PlatformError &&
        error.code === "upstream_credential_update_conflict"
      ) {
        activationConflict = true;
      } else {
        throw error;
      }
    }
  }
  const stored = await managedUpstreamProviderCredentialById(db, id);
  if (!stored) {
    throw new PlatformError(
      500,
      "upstream_credential_write_failed",
      "UpstreamProvider 凭据保存失败。",
    );
  }
  return jsonResponse(
    {
      credential: publicManagedUpstreamProviderCredential(stored),
      verified: body.activate,
      activationConflict,
    },
    activationConflict ? 202 : 201,
    requestId,
  );
}

async function handleUpstreamCredentialUpdate(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  requireAdminSecret(request, env, "platform");
  const body = await readJsonBody<{
    id?: unknown;
    action?: unknown;
    expectedVersion?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const action =
    typeof body.action === "string" ? body.action.trim() : "";
  if (!/^upc_[A-Za-z0-9_-]{16,80}$/.test(id)) {
    throw new PlatformError(
      400,
      "invalid_upstream_credential_id",
      "UpstreamProvider 凭据编号无效。",
    );
  }
  if (action !== "activate" && action !== "revoke") {
    throw new PlatformError(
      400,
      "invalid_upstream_credential_action",
      "UpstreamProvider 凭据操作仅支持 activate 或 revoke。",
    );
  }
  const expectedVersion =
    typeof body.expectedVersion === "number"
      ? body.expectedVersion
      : Number.NaN;
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0 ||
    expectedVersion > 2_147_483_647
  ) {
    throw new PlatformError(
      400,
      "invalid_upstream_credential_version",
      "UpstreamProvider 凭据操作必须提供当前状态版本。",
    );
  }

  const db = requireDb(env);
  const existing = await managedUpstreamProviderCredentialById(db, id);
  if (!existing) {
    throw new PlatformError(
      404,
      "upstream_credential_not_found",
      "没有找到这个 UpstreamProvider 凭据。",
    );
  }
  if (existing.status === "revoked") {
    throw new PlatformError(
      409,
      "upstream_credential_revoked",
      "已撤销的 UpstreamProvider 凭据不能再次使用。",
    );
  }

  if (action === "activate") {
    const currentState = await upstreamCredentialState(db);
    if (currentState.version !== expectedVersion) {
      throw new PlatformError(
        409,
        "upstream_credential_update_conflict",
        "UpstreamProvider 活动凭据已发生变化，请刷新后重试。",
      );
    }
    const encryptionKey = requireUpstreamProviderCredentialsEncryptionKey(env);
    const apiKey = await decryptUpstreamProviderApiKey(
      existing.encrypted_secret,
      encryptionKey,
      existing.id,
    );
    const sourceConfig = await loadUpstreamSourceConfig(db, env, true);
    const verification = await verifyUpstreamProviderApiKey(
      apiKey,
      env,
      sourceConfig,
    );
    await activateManagedUpstreamProviderCredential(
      db,
      request,
      id,
      expectedVersion,
      verification,
    );
  } else {
    const revokedAt = new Date().toISOString();
    const revokedSecretHash = await sha256Hex(
      `revoked:${id}:${revokedAt}:${randomBase64Url(18)}`,
    );
    const revokeAudit = await prepareAdminAuditStatement(db, request, {
      action: "upstream_credential.revoked",
      targetType: "upstream_credential",
      targetId: id,
      upstreamCredentialRevocation: { id, revokedAt },
      details: {
        provider: PRIMARY_UPSTREAM_PROVIDER,
        label: existing.label,
        fingerprint: existing.secret_hash.slice(0, 16),
      },
    });
    if (existing.status === "active") {
      const revokedActive = await db.batch([
        db
          .prepare(
            `UPDATE upstream_credential_state
             SET active_credential_id = NULL, version = version + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE provider = 'primary' AND active_credential_id = ?
               AND version = ?`,
          )
          .bind(id, expectedVersion),
        db
          .prepare(
            `UPDATE upstream_credentials
             SET revoked_at = ?,
                 encrypted_secret = 'revoked',
                 secret_hash = ?
             WHERE id = ? AND provider = 'primary' AND revoked_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM upstream_credential_state
                 WHERE provider = 'primary' AND managed_enabled = 1
                   AND active_credential_id IS NULL AND version = ?
               )`,
          )
          .bind(
            revokedAt,
            revokedSecretHash,
            id,
            expectedVersion + 1,
          ),
        db
          .prepare(
            `DELETE FROM catalog_sync_state
             WHERE id = 1
               AND EXISTS (
                 SELECT 1 FROM upstream_credential_state
                 WHERE provider = 'primary' AND managed_enabled = 1
                   AND active_credential_id IS NULL AND version = ?
               )`,
          )
          .bind(expectedVersion + 1),
        revokeAudit,
      ]);
      if (
        Number(revokedActive[0]?.meta?.changes ?? 0) !== 1 ||
        Number(revokedActive[1]?.meta?.changes ?? 0) !== 1 ||
        Number(revokedActive[3]?.meta?.changes ?? 0) !== 1
      ) {
        throw new PlatformError(
          409,
          "upstream_credential_update_conflict",
          "UpstreamProvider 活动凭据已发生变化，请刷新后重试。",
        );
      }
    } else {
      const revoked = await db.batch([
        db
          .prepare(
          `UPDATE upstream_credentials
           SET revoked_at = ?,
               encrypted_secret = 'revoked',
               secret_hash = ?
           WHERE id = ? AND provider = 'primary' AND revoked_at IS NULL
             AND EXISTS (
               SELECT 1 FROM upstream_credential_state
               WHERE provider = 'primary' AND version = ?
                 AND (
                   active_credential_id IS NULL OR
                   active_credential_id != ?
                 )
             )`,
          )
          .bind(
            revokedAt,
            revokedSecretHash,
            id,
            expectedVersion,
            id,
          ),
        revokeAudit,
      ]);
      if (
        Number(revoked[0]?.meta?.changes ?? 0) !== 1 ||
        Number(revoked[1]?.meta?.changes ?? 0) !== 1
      ) {
        throw new PlatformError(
          409,
          "upstream_credential_update_conflict",
          "UpstreamProvider 凭据状态已发生变化，请刷新后重试。",
        );
      }
    }
  }

  const updated = await managedUpstreamProviderCredentialById(db, id);
  if (!updated) {
    throw new PlatformError(
      500,
      "upstream_credential_write_failed",
      "UpstreamProvider 凭据状态更新失败。",
    );
  }
  return jsonResponse(
    { credential: publicManagedUpstreamProviderCredential(updated) },
    200,
    requestId,
  );
}

async function handleCatalogSync(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "catalog");
  const db = requireDb(env);
  const syncGeneration = `sync_${randomBase64Url(16)}`;
  const acquiredLock = await db
    .prepare(
      `INSERT INTO catalog_sync_locks (id, generation, locked_at)
       VALUES (1, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         generation = excluded.generation,
         locked_at = CURRENT_TIMESTAMP
       WHERE datetime(catalog_sync_locks.locked_at) <
             datetime('now', '-15 minutes')
       RETURNING generation`,
    )
    .bind(syncGeneration)
    .first<{ generation: string }>();
  if (acquiredLock?.generation !== syncGeneration) {
    throw new PlatformError(
      409,
      "catalog_sync_in_progress",
      "已有目录同步正在进行，请稍后重试。",
    );
  }

  try {
    const sourceConfig = await loadUpstreamSourceConfig(db, env, true);
    const credential = await resolveUpstreamProviderCredential(
      env,
      db,
      sourceConfig,
    );
    if (sourceConfig.catalogAuthMode === "required" && !credential) {
      throw new PlatformError(
        503,
        "upstream_not_configured",
        "数据源目录要求认证，请先配置并验证服务端密钥。",
      );
    }
    const credentialState = await upstreamCredentialState(db);
    const credentialSource = credential?.source ?? null;
    const credentialId = credential?.id ?? null;
    const credentialFingerprint = credential?.fingerprint ?? null;
    const credentialScopes = credential?.scopes ?? null;
    const catalogHeaders = new Headers({
      accept: "application/json",
      "user-agent": "RelayBase-API/1.0",
    });
    if (credential && sourceConfig.catalogAuthMode !== "none") {
      catalogHeaders.set(
        "authorization",
        `Bearer ${credential.secret}`,
      );
    }

    let response: Response;
    try {
      response = await fetch(upstreamConfigUrl(
        sourceConfig,
        sourceConfig.catalogPath,
      ), {
        headers: catalogHeaders,
        redirect: "manual",
        signal: AbortSignal.timeout(
          clampInteger(
            env.UPSTREAM_TIMEOUT_MS,
            45_000,
            30_000,
            60_000,
          ),
        ),
      });
    } catch (error) {
      logSourceFetchFailure(
        "catalog",
        error,
        sourceConfig.origin,
        requestId,
      );
      throw new PlatformError(
        502,
        "catalog_sync_failed",
        "UpstreamProvider 端点目录暂时不可用。",
      );
    }
    if (!response.ok) {
      throw new PlatformError(
        502,
        "catalog_sync_failed",
        `UpstreamProvider 端点目录同步失败（${response.status}）。`,
      );
    }

    const priceSnapshot = await readResponseJsonSnapshot(
      response,
      MAX_CATALOG_RESPONSE_BYTES,
      "catalog_sync_failed",
    );
    const payload = priceSnapshot.payload;
    let openApiResponse: Response;
    try {
      openApiResponse = await fetch(upstreamConfigUrl(
        sourceConfig,
        sourceConfig.openApiPath,
      ), {
        headers: catalogHeaders,
        redirect: "manual",
        signal: AbortSignal.timeout(
          clampInteger(
            env.UPSTREAM_TIMEOUT_MS,
            45_000,
            30_000,
            60_000,
          ),
        ),
      });
    } catch (error) {
      logSourceFetchFailure(
        "openapi",
        error,
        sourceConfig.origin,
        requestId,
      );
      throw new PlatformError(
        502,
        "catalog_schema_sync_failed",
        "UpstreamProvider OpenAPI 文档暂时不可用。",
      );
    }
    if (!openApiResponse.ok) {
      throw new PlatformError(
        502,
        "catalog_schema_sync_failed",
        `UpstreamProvider OpenAPI 文档同步失败（${openApiResponse.status}）。`,
      );
    }
    const openApiSnapshot = await readResponseJsonSnapshot(
      openApiResponse,
      MAX_OPENAPI_RESPONSE_BYTES,
      "catalog_schema_sync_failed",
    );
    const openApiPayload = openApiSnapshot.payload;
    const priceCatalog = extractCatalogPrices(
      payload,
      sourceConfig.apiPathPrefix,
    );
    const prices = priceCatalog.entries;
    const openApi = extractOpenApiCatalog(
      openApiPayload,
      sourceConfig.apiPathPrefix,
    );
    const entries = mergeCatalogEntries(
      prices,
      openApi,
      credentialScopes,
      sourceConfig.apiPathPrefix,
    );
    const coverageBreakdown = catalogCoverageBreakdown(
      prices,
      openApi,
      credentialScopes,
      sourceConfig.apiPathPrefix,
    );
    const unresolvedEntries = unresolvedCatalogEntries(
      prices,
      openApi,
    );
    const pricedEntries = entries.filter(
      (entry) => entry.priceVerified,
    ).length;
    const positivePriceEntries = entries.filter(
      (entry) =>
        entry.priceVerified && entry.upstreamPriceUsdMicros > 0,
    ).length;
    const zeroPriceEntries = entries.filter(
      (entry) =>
        entry.priceVerified && entry.upstreamPriceUsdMicros === 0,
    ).length;
    const awaitingPriceEntries = entries.length - pricedEntries;
    if (
      coverageBreakdown.openApiPriceMapped -
        coverageBreakdown.scopeExcluded !==
        pricedEntries ||
      unresolvedEntries.length !== coverageBreakdown.priceOnly
    ) {
      throw new PlatformError(
        502,
        "catalog_coverage_inconsistent",
        "目录覆盖计算不一致，本次同步已停止。",
      );
    }
    const openApiVersion = extractOpenApiVersion(openApiPayload);
    const openApiSnapshotHash = openApiSnapshot.snapshotHash;
    const priceSnapshotHash = priceSnapshot.snapshotHash;
    if (
      prices.length === 0 ||
      openApi.size === 0 ||
      entries.length === 0 ||
      pricedEntries === 0
    ) {
      throw new PlatformError(
        502,
        "catalog_sync_failed",
        "上游响应中没有识别到完整端点与价格，请人工检查响应格式。",
      );
    }
    if (entries.length > 5_000) {
      throw new PlatformError(
        502,
        "catalog_sync_failed",
        "上游端点目录超过安全处理上限，请人工检查响应。",
      );
    }
    if (unresolvedEntries.length > 100_000) {
      throw new PlatformError(
        502,
        "catalog_sync_failed",
        "数据源待补全文档目录超过安全处理上限，请人工检查响应。",
      );
    }

    const currentCount = await db
      .prepare(
        `SELECT COUNT(*) AS count,
                (
                  SELECT openapi_operation_count
                  FROM catalog_sync_state
                  WHERE id = 1
                ) AS expected_count,
                (
                  SELECT matched_price_count
                  FROM catalog_sync_state
                  WHERE id = 1
                ) AS expected_matched_count,
                (
                  SELECT credential_source
                  FROM catalog_sync_state
                  WHERE id = 1
                ) AS previous_credential_source,
                (
                  SELECT credential_id
                  FROM catalog_sync_state
                  WHERE id = 1
                ) AS previous_credential_id,
                (
                  SELECT credential_fingerprint
                  FROM catalog_sync_state
                  WHERE id = 1
                ) AS previous_credential_fingerprint,
                (
                  SELECT credential_state_version
                  FROM catalog_sync_state
                  WHERE id = 1
                ) AS previous_credential_state_version,
                (
                  SELECT openapi_snapshot_hash
                  FROM catalog_sync_state
                  WHERE id = 1
                ) AS previous_openapi_snapshot_hash,
                (
                  SELECT source_config_version
                  FROM catalog_sync_state
                  WHERE id = 1
                ) AS previous_source_config_version,
                (
                  SELECT source_config_hash
                  FROM catalog_sync_state
                  WHERE id = 1
                ) AS previous_source_config_hash
         FROM endpoint_catalog
         WHERE sync_generation = (
           SELECT last_success_generation
           FROM catalog_sync_state
           WHERE id = 1
         )`,
      )
      .first<{
        count: number;
        expected_count: number | null;
        expected_matched_count: number | null;
        previous_credential_source: string | null;
        previous_credential_id: string | null;
        previous_credential_fingerprint: string | null;
        previous_credential_state_version: number | null;
        previous_openapi_snapshot_hash: string | null;
        previous_source_config_version: number | null;
        previous_source_config_hash: string | null;
      }>();
    const knownCount = Number(currentCount?.count ?? 0);
    if (
      currentCount?.expected_count != null &&
      Number(currentCount.expected_count) !== knownCount
    ) {
      throw new PlatformError(
        409,
        "catalog_previous_snapshot_inconsistent",
        "上一成功目录的覆盖证据与实际端点数量不一致，本次同步已停止。",
      );
    }
    if (knownCount >= 20 && entries.length < Math.floor(knownCount / 2)) {
      throw new PlatformError(
        502,
        "catalog_snapshot_incomplete",
        "本次目录数量较历史记录异常减少，已停止同步以避免误停端点。",
      );
    }
    const comparableCredential =
      currentCount?.previous_credential_source === credentialSource &&
      currentCount.previous_credential_id === credentialId &&
      currentCount.previous_credential_fingerprint ===
        credentialFingerprint &&
      Number(currentCount.previous_credential_state_version) ===
        credentialState.version &&
      Number(currentCount.previous_source_config_version) ===
        sourceConfig.version &&
      currentCount.previous_source_config_hash === sourceConfig.hash;
    const previousMatchedCount = Number(
      currentCount?.expected_matched_count ?? 0,
    );
    if (
      comparableCredential &&
      previousMatchedCount >= 20 &&
      ((currentCount.previous_openapi_snapshot_hash ===
        openApiSnapshotHash &&
        pricedEntries < previousMatchedCount) ||
        pricedEntries < Math.floor(previousMatchedCount / 2))
    ) {
      throw new PlatformError(
        502,
        "catalog_price_snapshot_incomplete",
        "本次可验证价格覆盖较上一成功目录异常减少，已停止同步以避免批量下架。",
      );
    }

    const markupBps = clampInteger(
      env.PRICE_MARKUP_BPS,
      3000,
      0,
      50_000,
    );
    let synced = 0;
    let unresolvedSynced = 0;
    await db.batch([
      db.prepare(
        `DELETE FROM catalog_sync_staging
         WHERE datetime(created_at) < datetime('now', '-1 day')`,
      ),
      db.prepare(
        `DELETE FROM catalog_unresolved_staging
         WHERE datetime(created_at) < datetime('now', '-1 day')`,
      ),
    ]);
    for (let offset = 0; offset < entries.length; offset += 50) {
      const renewal = await db
        .prepare(
          `UPDATE catalog_sync_locks
           SET locked_at = CURRENT_TIMESTAMP
           WHERE id = 1 AND generation = ?`,
        )
        .bind(syncGeneration)
        .run();
      if (Number(renewal.meta?.changes ?? 0) !== 1) {
        throw new PlatformError(
          409,
          "catalog_sync_lease_lost",
          "目录同步租约已失效，本次快照不会发布。",
        );
      }
      const statements = entries
        .slice(offset, offset + 50)
        .map((entry, batchIndex) => {
          const customerPrice = Math.max(
            entry.upstreamPriceUsdMicros,
            Math.ceil(
              (entry.upstreamPriceUsdMicros * (10_000 + markupBps)) /
                10_000,
            ),
          );
          return db
            .prepare(
              `INSERT INTO catalog_sync_staging
               (id, generation, path, platform, http_method, summary,
                data_type, tags_json, surface, operation_id,
                description, parameter_schema_json,
                upstream_price_usd_micros,
                suggested_customer_price_usd_micros,
                price_verified, looks_read_only, safety_classification,
                safety_reasons_json, safety_policy_version, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                       ?, ?, ?, CURRENT_TIMESTAMP)`,
            )
            .bind(
              `${syncGeneration}:${offset + batchIndex}`,
              syncGeneration,
              entry.path,
              entry.platform,
              entry.httpMethod,
              entry.summary,
              entry.dataType,
              JSON.stringify(entry.tags),
              entry.surface,
              entry.operationId,
              entry.description,
              entry.parameterSchemaJson,
              entry.upstreamPriceUsdMicros,
              customerPrice,
              entry.priceVerified ? 1 : 0,
              entry.looksReadOnly ? 1 : 0,
              entry.safetyClassification,
              JSON.stringify(entry.safetyReasons),
              entry.safetyPolicyVersion,
            );
        });
      await db.batch(statements);
      synced += statements.length;
    }
    for (
      let offset = 0;
      offset < unresolvedEntries.length;
      offset += 50
    ) {
      const renewal = await db
        .prepare(
          `UPDATE catalog_sync_locks
           SET locked_at = CURRENT_TIMESTAMP
           WHERE id = 1 AND generation = ?`,
        )
        .bind(syncGeneration)
        .run();
      if (Number(renewal.meta?.changes ?? 0) !== 1) {
        throw new PlatformError(
          409,
          "catalog_sync_lease_lost",
          "目录同步租约已失效，本次快照不会发布。",
        );
      }
      const statements = unresolvedEntries
        .slice(offset, offset + 50)
        .map((entry, batchIndex) => {
          const customerPrice = Math.max(
            entry.upstreamPriceUsdMicros,
            Math.ceil(
              (entry.upstreamPriceUsdMicros *
                (10_000 + markupBps)) /
                10_000,
            ),
          );
          return db
            .prepare(
              `INSERT INTO catalog_unresolved_staging
               (id, sync_generation, path, platform, data_type, surface,
                summary, upstream_price_usd_micros,
                customer_price_usd_micros, price_verified,
                rate_limit_raw, rate_limit_rps, free_credit,
                volume_discount, source_type, source_owner,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?,
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            )
            .bind(
              `${syncGeneration}:pending:${offset + batchIndex}`,
              syncGeneration,
              entry.path,
              entry.platform,
              entry.dataType,
              entry.surface,
              entry.summary,
              entry.upstreamPriceUsdMicros,
              customerPrice,
              entry.rateLimitRaw,
              entry.rateLimitRps,
              entry.freeCredit == null
                ? null
                : entry.freeCredit
                  ? 1
                  : 0,
              entry.volumeDiscount == null
                ? null
                : entry.volumeDiscount
                  ? 1
                  : 0,
              entry.sourceType,
              entry.sourceOwner,
            );
        });
      await db.batch(statements);
      unresolvedSynced += statements.length;
    }
    const staged = await db
      .prepare(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(
                  CASE
                    WHEN data_type IN (
                      'account', 'analytics_trends', 'comments',
                      'commerce_marketing', 'content', 'email', 'live',
                      'media_download', 'profile_creator',
                      'search_discovery', 'social_graph', 'system',
                      'taxonomy', 'utility', 'other'
                    )
                      AND surface IN ('app', 'web', 'app_web', 'other')
                      AND json_valid(tags_json)
                      AND json_type(
                        CASE WHEN json_valid(tags_json)
                             THEN tags_json ELSE '[]' END
                      ) = 'array'
                      AND json_array_length(
                        CASE WHEN json_valid(tags_json)
                             THEN tags_json ELSE '[]' END
                      ) <= 100
                      AND NOT EXISTS (
                        SELECT 1
                        FROM json_each(
                          CASE WHEN json_valid(tags_json)
                               THEN tags_json ELSE '[]' END
                        )
                        WHERE type != 'text' OR length(value) < 1
                          OR length(value) > 160 OR trim(value) != value
                      )
                      AND json_array_length(
                        CASE WHEN json_valid(tags_json)
                             THEN tags_json ELSE '[]' END
                      ) = (
                        SELECT COUNT(DISTINCT value)
                        FROM json_each(
                          CASE WHEN json_valid(tags_json)
                               THEN tags_json ELSE '[]' END
                        )
                      )
                      AND (
                        operation_id IS NULL OR
                        length(operation_id) BETWEEN 1 AND 500
                      )
                    THEN 1 ELSE 0
                  END
                ), 0) AS metadata_complete
         FROM catalog_sync_staging
         WHERE generation = ?`,
      )
      .bind(syncGeneration)
      .first<{ count: number; metadata_complete: number }>();
    if (
      Number(staged?.count ?? 0) !== entries.length ||
      Number(staged?.metadata_complete ?? 0) !== entries.length
    ) {
      throw new PlatformError(
        409,
        "catalog_snapshot_incomplete",
        "目录暂存快照或数据类型元数据不完整，本次不会发布。",
      );
    }
    const unresolvedStaged = await db
      .prepare(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(
                  CASE
                    WHEN data_type IN (
                      'account', 'analytics_trends', 'comments',
                      'commerce_marketing', 'content', 'email', 'live',
                      'media_download', 'profile_creator',
                      'search_discovery', 'social_graph', 'system',
                      'taxonomy', 'utility', 'other'
                    )
                      AND surface IN ('app', 'web', 'app_web', 'other')
                      AND price_verified = 1
                      AND upstream_price_usd_micros >= 0
                      AND customer_price_usd_micros >=
                          upstream_price_usd_micros
                    THEN 1 ELSE 0
                  END
                ), 0) AS metadata_complete
         FROM catalog_unresolved_staging
         WHERE sync_generation = ?`,
      )
      .bind(syncGeneration)
      .first<{ count: number; metadata_complete: number }>();
    if (
      Number(unresolvedStaged?.count ?? 0) !==
        unresolvedEntries.length ||
      Number(unresolvedStaged?.metadata_complete ?? 0) !==
        unresolvedEntries.length
    ) {
      throw new PlatformError(
        409,
        "catalog_snapshot_incomplete",
        "待补全文档目录暂存快照不完整，本次不会发布。",
      );
    }

    const publishConfig = await loadUpstreamSourceConfig(db, env, true);
    const publishCredentialState = await upstreamCredentialState(db);
    const publishCredential = await resolveUpstreamProviderCredential(
      env,
      db,
      publishConfig,
    );
    if (
      publishConfig.version !== sourceConfig.version ||
      publishConfig.hash !== sourceConfig.hash ||
      publishCredentialState.version !== credentialState.version ||
      (publishCredential?.id ?? null) !== credentialId ||
      (publishCredential?.source ?? null) !== credentialSource ||
      (publishCredential?.fingerprint ?? null) !==
        credentialFingerprint
    ) {
      throw new PlatformError(
        409,
        "catalog_sync_source_changed",
        "数据源配置或活动凭据在同步期间发生变化，本次快照不会发布。",
      );
    }
    const managedCredentialFlag =
      credentialState.managedEnabled ? 1 : 0;
    const syncAudit = await prepareAdminAuditStatement(db, request, {
      action: "catalog.synced",
      targetType: "catalog_generation",
      targetId: syncGeneration,
      catalogSyncGeneration: syncGeneration,
      details: {
        synced,
        pendingDocumentation: unresolvedSynced,
        sourceConfigVersion: sourceConfig.version,
        openApiVersion,
        openApiOperations: openApi.size,
        rawPriceRows: priceCatalog.rawRecordCount,
        normalizedPrices: prices.length,
        openApiPriceMapped: coverageBreakdown.openApiPriceMapped,
        priceOnly: coverageBreakdown.priceOnly,
        openApiOnly: coverageBreakdown.openApiOnly,
        scopeExcluded: coverageBreakdown.scopeExcluded,
        priced: pricedEntries,
        positivePrice: positivePriceEntries,
        zeroPrice: zeroPriceEntries,
        awaitingPrice: awaitingPriceEntries,
        openApiSnapshotHash,
        priceSnapshotHash,
      },
    });
    const finalization = await db.batch([
      db
        .prepare(
          `INSERT INTO endpoint_catalog
           (path, platform, http_method, data_type, tags_json, surface,
            operation_id, summary, description, parameter_schema_json,
            upstream_price_usd_micros,
            customer_price_usd_micros, price_verified, enabled, read_only,
            safety_classification, safety_reasons_json,
            safety_policy_version, revision, source_updated_at,
            sync_generation, created_at, updated_at)
           SELECT s.path, s.platform, s.http_method, s.data_type,
                  s.tags_json, s.surface, s.operation_id, s.summary,
                  s.description, s.parameter_schema_json,
                  s.upstream_price_usd_micros,
                  s.suggested_customer_price_usd_micros,
                  s.price_verified, 0, 0, s.safety_classification,
                  s.safety_reasons_json, s.safety_policy_version, 0,
                  CURRENT_TIMESTAMP, s.generation,
                  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
           FROM catalog_sync_staging s
           WHERE s.generation = ?
             AND EXISTS (
               SELECT 1 FROM catalog_sync_locks l
               WHERE l.id = 1 AND l.generation = ?
             )
             AND EXISTS (
               SELECT 1 FROM upstream_source_config c
               WHERE c.id = 1 AND c.enabled = 1
                 AND c.version = ? AND c.config_hash = ?
             )
             AND EXISTS (
               SELECT 1 FROM upstream_credential_state u
               WHERE u.provider = 'primary' AND u.version = ?
                 AND u.managed_enabled = ?
                 AND u.active_credential_id IS ?
             )
           ON CONFLICT(path) DO UPDATE SET
             platform = excluded.platform,
             http_method = excluded.http_method,
             data_type = excluded.data_type,
             tags_json = excluded.tags_json,
             surface = excluded.surface,
             operation_id = excluded.operation_id,
             summary = excluded.summary,
             description = excluded.description,
             parameter_schema_json = excluded.parameter_schema_json,
             upstream_price_usd_micros = excluded.upstream_price_usd_micros,
             price_verified = excluded.price_verified,
             safety_classification = excluded.safety_classification,
             safety_reasons_json = excluded.safety_reasons_json,
             safety_policy_version = excluded.safety_policy_version,
             customer_price_usd_micros =
               endpoint_catalog.customer_price_usd_micros,
             enabled = CASE
               WHEN excluded.price_verified = 0
                 OR endpoint_catalog.http_method != excluded.http_method
                 OR endpoint_catalog.upstream_price_usd_micros !=
                    excluded.upstream_price_usd_micros
                 OR endpoint_catalog.data_type != excluded.data_type
                 OR endpoint_catalog.tags_json != excluded.tags_json
                 OR endpoint_catalog.surface != excluded.surface
                 OR endpoint_catalog.operation_id IS NOT
                    excluded.operation_id
                 OR endpoint_catalog.safety_classification !=
                    excluded.safety_classification
                 OR endpoint_catalog.safety_policy_version !=
                    excluded.safety_policy_version
                 OR excluded.safety_classification = 'prohibited'
               THEN 0
               ELSE endpoint_catalog.enabled
             END,
             read_only = CASE
               WHEN endpoint_catalog.data_type != excluded.data_type
                 OR endpoint_catalog.tags_json != excluded.tags_json
                 OR endpoint_catalog.surface != excluded.surface
                 OR endpoint_catalog.operation_id IS NOT
                    excluded.operation_id
                 OR endpoint_catalog.safety_classification !=
                      excluded.safety_classification
                 OR endpoint_catalog.safety_policy_version !=
                      excluded.safety_policy_version
                 OR excluded.safety_classification = 'prohibited'
               THEN 0
               ELSE endpoint_catalog.read_only
             END,
             reviewed_at = CASE
               WHEN excluded.price_verified = 0
                 OR endpoint_catalog.http_method != excluded.http_method
                 OR endpoint_catalog.upstream_price_usd_micros !=
                    excluded.upstream_price_usd_micros
                 OR endpoint_catalog.data_type != excluded.data_type
                 OR endpoint_catalog.tags_json != excluded.tags_json
                 OR endpoint_catalog.surface != excluded.surface
                 OR endpoint_catalog.operation_id IS NOT
                    excluded.operation_id
                 OR endpoint_catalog.safety_classification !=
                    excluded.safety_classification
                 OR endpoint_catalog.safety_policy_version !=
                    excluded.safety_policy_version
                 OR excluded.safety_classification = 'prohibited'
               THEN NULL
               ELSE endpoint_catalog.reviewed_at
             END,
             revision = endpoint_catalog.revision + 1,
             sync_generation = excluded.sync_generation,
             source_updated_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          syncGeneration,
          syncGeneration,
          sourceConfig.version,
          sourceConfig.hash,
          credentialState.version,
          managedCredentialFlag,
          credentialId,
        ),
      db
        .prepare(
          `UPDATE endpoint_catalog
           SET enabled = 0, read_only = 0, reviewed_at = NULL,
               source_updated_at = NULL,
               sync_generation = NULL, revision = revision + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE NOT EXISTS (
             SELECT 1
             FROM catalog_sync_staging s
             WHERE s.generation = ? AND s.path = endpoint_catalog.path
           )
             AND EXISTS (
               SELECT 1 FROM catalog_sync_locks l
               WHERE l.id = 1 AND l.generation = ?
             )
             AND EXISTS (
               SELECT 1 FROM upstream_source_config c
               WHERE c.id = 1 AND c.enabled = 1
                 AND c.version = ? AND c.config_hash = ?
             )
             AND EXISTS (
               SELECT 1 FROM upstream_credential_state u
               WHERE u.provider = 'primary' AND u.version = ?
                 AND u.managed_enabled = ?
                 AND u.active_credential_id IS ?
             )`,
        )
        .bind(
          syncGeneration,
          syncGeneration,
          sourceConfig.version,
          sourceConfig.hash,
          credentialState.version,
          managedCredentialFlag,
          credentialId,
        ),
      db
        .prepare(
          `INSERT INTO catalog_unresolved_endpoints
           (path, platform, data_type, surface, summary,
            upstream_price_usd_micros, customer_price_usd_micros,
            price_verified, rate_limit_raw, rate_limit_rps,
            free_credit, volume_discount, source_type, source_owner,
            sync_generation, created_at, updated_at)
           SELECT s.path, s.platform, s.data_type, s.surface, s.summary,
                  s.upstream_price_usd_micros,
                  s.customer_price_usd_micros, s.price_verified,
                  s.rate_limit_raw, s.rate_limit_rps, s.free_credit,
                  s.volume_discount, s.source_type, s.source_owner,
                  s.sync_generation, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
           FROM catalog_unresolved_staging s
           WHERE s.sync_generation = ?
             AND EXISTS (
               SELECT 1 FROM catalog_sync_locks l
               WHERE l.id = 1 AND l.generation = ?
             )
             AND EXISTS (
               SELECT 1 FROM upstream_source_config c
               WHERE c.id = 1 AND c.enabled = 1
                 AND c.version = ? AND c.config_hash = ?
             )
             AND EXISTS (
               SELECT 1 FROM upstream_credential_state u
               WHERE u.provider = 'primary' AND u.version = ?
                 AND u.managed_enabled = ?
                 AND u.active_credential_id IS ?
             )
           ON CONFLICT(path) DO UPDATE SET
             platform = excluded.platform,
             data_type = excluded.data_type,
             surface = excluded.surface,
             summary = excluded.summary,
             customer_price_usd_micros = CASE
               WHEN catalog_unresolved_endpoints
                      .upstream_price_usd_micros !=
                    excluded.upstream_price_usd_micros
               THEN excluded.customer_price_usd_micros
               ELSE catalog_unresolved_endpoints
                      .customer_price_usd_micros
             END,
             upstream_price_usd_micros =
               excluded.upstream_price_usd_micros,
             price_verified = excluded.price_verified,
             rate_limit_raw = excluded.rate_limit_raw,
             rate_limit_rps = excluded.rate_limit_rps,
             free_credit = excluded.free_credit,
             volume_discount = excluded.volume_discount,
             source_type = excluded.source_type,
             source_owner = excluded.source_owner,
             sync_generation = excluded.sync_generation,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          syncGeneration,
          syncGeneration,
          sourceConfig.version,
          sourceConfig.hash,
          credentialState.version,
          managedCredentialFlag,
          credentialId,
        ),
      db
        .prepare(
          `DELETE FROM catalog_unresolved_endpoints
           WHERE NOT EXISTS (
             SELECT 1
             FROM catalog_unresolved_staging s
             WHERE s.sync_generation = ?
               AND s.path = catalog_unresolved_endpoints.path
           )
             AND EXISTS (
               SELECT 1 FROM catalog_sync_locks l
               WHERE l.id = 1 AND l.generation = ?
             )
             AND EXISTS (
               SELECT 1 FROM upstream_source_config c
               WHERE c.id = 1 AND c.enabled = 1
                 AND c.version = ? AND c.config_hash = ?
             )
             AND EXISTS (
               SELECT 1 FROM upstream_credential_state u
               WHERE u.provider = 'primary' AND u.version = ?
                 AND u.managed_enabled = ?
                 AND u.active_credential_id IS ?
             )`,
        )
        .bind(
          syncGeneration,
          syncGeneration,
          sourceConfig.version,
          sourceConfig.hash,
          credentialState.version,
          managedCredentialFlag,
          credentialId,
        ),
      db
        .prepare(
          `INSERT INTO catalog_sync_state
           (id, last_success_generation, credential_source,
            credential_id, credential_fingerprint,
            credential_state_version, source_config_version,
            source_config_hash, openapi_version,
            openapi_operation_count, raw_price_row_count,
            normalized_price_count, openapi_price_mapped_count,
            price_only_count, openapi_only_count,
            scope_excluded_count, matched_price_count,
            positive_price_count, zero_price_count,
            awaiting_price_count, openapi_snapshot_hash,
            price_snapshot_hash, synced_at)
           SELECT 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  ?, ?, ?, ?, ?,
                  CURRENT_TIMESTAMP
           WHERE EXISTS (
             SELECT 1 FROM catalog_sync_locks
             WHERE id = 1 AND generation = ?
             )
             AND EXISTS (
               SELECT 1 FROM upstream_source_config c
               WHERE c.id = 1 AND c.enabled = 1
                 AND c.version = ? AND c.config_hash = ?
             )
             AND EXISTS (
               SELECT 1 FROM upstream_credential_state u
               WHERE u.provider = 'primary' AND u.version = ?
                 AND u.managed_enabled = ?
                 AND u.active_credential_id IS ?
             )
           ON CONFLICT(id) DO UPDATE SET
             last_success_generation = excluded.last_success_generation,
             credential_source = excluded.credential_source,
             credential_id = excluded.credential_id,
             credential_fingerprint = excluded.credential_fingerprint,
             credential_state_version =
               excluded.credential_state_version,
             source_config_version = excluded.source_config_version,
             source_config_hash = excluded.source_config_hash,
             openapi_version = excluded.openapi_version,
             openapi_operation_count = excluded.openapi_operation_count,
             raw_price_row_count = excluded.raw_price_row_count,
             normalized_price_count = excluded.normalized_price_count,
             openapi_price_mapped_count =
               excluded.openapi_price_mapped_count,
             price_only_count = excluded.price_only_count,
             openapi_only_count = excluded.openapi_only_count,
             scope_excluded_count = excluded.scope_excluded_count,
             matched_price_count = excluded.matched_price_count,
             positive_price_count = excluded.positive_price_count,
             zero_price_count = excluded.zero_price_count,
             awaiting_price_count = excluded.awaiting_price_count,
             openapi_snapshot_hash = excluded.openapi_snapshot_hash,
             price_snapshot_hash = excluded.price_snapshot_hash,
             synced_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          syncGeneration,
          credentialSource,
          credentialId,
          credentialFingerprint,
          credentialState.version,
          sourceConfig.version,
          sourceConfig.hash,
          openApiVersion,
          openApi.size,
          priceCatalog.rawRecordCount,
          prices.length,
          coverageBreakdown.openApiPriceMapped,
          coverageBreakdown.priceOnly,
          coverageBreakdown.openApiOnly,
          coverageBreakdown.scopeExcluded,
          pricedEntries,
          positivePriceEntries,
          zeroPriceEntries,
          awaitingPriceEntries,
          openApiSnapshotHash,
          priceSnapshotHash,
          syncGeneration,
          sourceConfig.version,
          sourceConfig.hash,
          credentialState.version,
          managedCredentialFlag,
          credentialId,
        ),
      syncAudit,
      db
        .prepare(
          `DELETE FROM catalog_sync_staging
           WHERE generation = ?`,
        )
        .bind(syncGeneration),
      db
        .prepare(
          `DELETE FROM catalog_unresolved_staging
           WHERE sync_generation = ?`,
        )
        .bind(syncGeneration),
    ]);
    if (
      Number(finalization[4]?.meta?.changes ?? 0) !== 1 ||
      Number(finalization[5]?.meta?.changes ?? 0) !== 1
    ) {
      throw new PlatformError(
        409,
        "catalog_sync_lease_lost",
        "目录同步发布或审计未能原子确认，本次快照不可用。",
      );
    }
    const published = await db
      .prepare(
        `SELECT last_success_generation, credential_source,
                credential_id, credential_fingerprint,
                credential_state_version, source_config_version,
                source_config_hash
         FROM catalog_sync_state
         WHERE id = 1`,
      )
      .first<{
        last_success_generation: string;
        credential_source: string | null;
        credential_id: string | null;
        credential_fingerprint: string | null;
        credential_state_version: number | null;
        source_config_version: number | null;
        source_config_hash: string | null;
      }>();
    if (
      published?.last_success_generation !== syncGeneration ||
      published.credential_source !== credentialSource ||
      published.credential_id !== credentialId ||
      published.credential_fingerprint !== credentialFingerprint ||
      Number(published.credential_state_version) !==
        credentialState.version ||
      Number(published.source_config_version) !==
        sourceConfig.version ||
      published.source_config_hash !== sourceConfig.hash
    ) {
      throw new PlatformError(
        409,
        "catalog_sync_lease_lost",
        "目录同步租约已失效，本次快照未发布。",
      );
    }
    return jsonResponse(
      {
        synced,
        pendingDocumentation: unresolvedSynced,
        openApiVersion,
        openApiOperations: openApi.size,
        rawPriceRows: priceCatalog.rawRecordCount,
        normalizedPrices: prices.length,
        openApiPriceMapped: coverageBreakdown.openApiPriceMapped,
        priceOnly: coverageBreakdown.priceOnly,
        openApiOnly: coverageBreakdown.openApiOnly,
        scopeExcluded: coverageBreakdown.scopeExcluded,
        priced: pricedEntries,
        positivePrice: positivePriceEntries,
        zeroPrice: zeroPriceEntries,
        awaitingPrice: awaitingPriceEntries,
        openApiSnapshotHash,
        priceSnapshotHash,
        disabledMissing: Number(finalization[1]?.meta?.changes ?? 0),
        note: "新端点默认禁用；已审核端点的上游价格一旦变化会自动停用并清除审核状态，客户价格不会被同步任务静默覆盖。",
      },
      200,
      requestId,
    );
  } finally {
    await db.batch([
      db
        .prepare(
          `DELETE FROM catalog_sync_staging
           WHERE generation = ?`,
        )
        .bind(syncGeneration),
      db
        .prepare(
          `DELETE FROM catalog_unresolved_staging
           WHERE sync_generation = ?`,
        )
        .bind(syncGeneration),
      db
        .prepare(
          `DELETE FROM catalog_sync_locks
           WHERE id = 1 AND generation = ?`,
        )
        .bind(syncGeneration),
    ]);
  }
}

async function handleCatalogUpdate(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "catalog");
  const body = await readJsonBody<{
    path?: unknown;
    enabled?: unknown;
    readOnly?: unknown;
    customerPriceUsdMicros?: unknown;
    expectedRevision?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  if (typeof body.path !== "string") {
    throw new PlatformError(400, "invalid_endpoint", "端点路径无效。");
  }
  const path = normalizeCatalogPath(body.path);
  if (
    typeof body.enabled !== "boolean" ||
    typeof body.readOnly !== "boolean" ||
    !Number.isSafeInteger(body.expectedRevision) ||
    (body.expectedRevision as number) < 0
  ) {
    throw new PlatformError(
      400,
      "invalid_endpoint_review",
      "必须明确设置 enabled、readOnly 与当前 revision。",
    );
  }
  if (body.enabled && !body.readOnly) {
    throw new PlatformError(
      400,
      "unsafe_endpoint",
      "MVP 不允许启用非只读端点。",
    );
  }
  const price =
    typeof body.customerPriceUsdMicros === "number"
      ? body.customerPriceUsdMicros
      : Number.NaN;
  if (!Number.isSafeInteger(price) || price < 1 || price > 100_000_000) {
    throw new PlatformError(
      400,
      "invalid_endpoint_price",
      "客户价格必须是有效的美元微单位整数。",
    );
  }

  const db = requireDb(env);
  await assertStoredCatalogTaxonomyIntegrity(db);
  const existing = await db
    .prepare(
      `SELECT http_method, upstream_price_usd_micros,
              customer_price_usd_micros, price_verified, enabled,
              data_type, tags_json, surface, operation_id,
              read_only, safety_classification, safety_policy_version,
              revision, sync_generation,
              (
                SELECT last_success_generation
                FROM catalog_sync_state
                WHERE id = 1
              ) AS last_success_generation
       FROM endpoint_catalog
       WHERE path = ?`,
    )
    .bind(path)
    .first<{
      upstream_price_usd_micros: number;
      customer_price_usd_micros: number;
      http_method: string;
      price_verified: number;
      enabled: number;
      data_type: CatalogDataType;
      tags_json: string;
      surface: MarketplaceSurface;
      operation_id: string | null;
      read_only: number;
      safety_classification: CatalogSafetyClassification;
      safety_policy_version: number;
      revision: number;
      sync_generation: string | null;
      last_success_generation: string | null;
    }>();
  if (!existing) {
    throw new PlatformError(
      404,
      "endpoint_not_found",
      "目录中没有这个端点，请先同步上游目录。",
    );
  }
  const existingTaxonomy = strictStoredCatalogTaxonomy(existing);
  if (
    body.enabled &&
    (existing.sync_generation == null ||
      existing.sync_generation !== existing.last_success_generation)
  ) {
    throw new PlatformError(
      409,
      "endpoint_not_in_latest_catalog",
      "该端点不在最近一次成功同步的上游目录中，不能重新启用。",
    );
  }
  if (price < existing.upstream_price_usd_micros) {
    throw new PlatformError(
      400,
      "price_below_upstream_cost",
      "客户价格不能低于当前上游成本。",
    );
  }
  if (
    body.readOnly &&
    (existing.http_method !== "GET" && existing.http_method !== "POST")
  ) {
    throw new PlatformError(
      409,
      "unsupported_endpoint_method",
      "该端点的请求方法不受支持。",
    );
  }
  if (
    body.readOnly &&
    (existing.safety_classification !== "safe_data_read" ||
      existing.safety_policy_version !== CATALOG_SAFETY_POLICY_VERSION ||
      isHardProhibitedCatalogOperation(
        path,
        existing.http_method as "GET" | "POST",
      ))
  ) {
    throw new PlatformError(
      403,
      "unsafe_endpoint",
      "账户、Cookie、发布、互动或其他高风险端点不能标记为公开只读服务。",
    );
  }
  if (body.enabled && existing.price_verified !== 1) {
    throw new PlatformError(
      409,
      "endpoint_price_unverified",
      "该端点尚未从 UpstreamProvider 价格目录获得可验证价格，不能启用。",
    );
  }
  const nextRevision = existing.revision + 1;
  const updateStatement = db.prepare(
      `UPDATE endpoint_catalog
       SET enabled = ?, read_only = ?, customer_price_usd_micros = ?,
           reviewed_at = CURRENT_TIMESTAMP, revision = revision + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE path = ?
         AND revision = ?
         AND http_method = ?
         AND upstream_price_usd_micros = ?
         AND customer_price_usd_micros = ?
         AND price_verified = ?
         AND enabled = ?
         AND read_only = ?
         AND sync_generation IS ?
         AND ? >= upstream_price_usd_micros
         AND (
           ? = 0
           OR (
             price_verified = 1
             AND sync_generation = (
               SELECT last_success_generation
               FROM catalog_sync_state
               WHERE id = 1
             )
           )
         )`,
    )
    .bind(
      body.enabled ? 1 : 0,
      body.readOnly ? 1 : 0,
      price,
      path,
      body.expectedRevision,
      existing.http_method,
      existing.upstream_price_usd_micros,
      existing.customer_price_usd_micros,
      existing.price_verified,
      existing.enabled,
      existing.read_only,
      existing.sync_generation,
      price,
      body.enabled ? 1 : 0,
    );
  const auditStatement = await prepareAdminAuditStatement(db, request, {
    action: "catalog.endpoint_updated",
    targetType: "catalog_endpoint",
    targetId: path,
    catalogEndpointRevision: { path, revision: nextRevision },
    details: {
      before: {
        revision: existing.revision,
        enabled: existing.enabled === 1,
        readOnly: existing.read_only === 1,
        customerPriceUsdMicros: existing.customer_price_usd_micros,
      },
      after: {
        revision: nextRevision,
        enabled: body.enabled,
        readOnly: body.readOnly,
        customerPriceUsdMicros: price,
      },
      safetyClassification: existing.safety_classification,
      taxonomy: existingTaxonomy,
      upstreamPriceUsdMicros: existing.upstream_price_usd_micros,
      syncGeneration: existing.sync_generation,
    },
  });
  const results = await db.batch([updateStatement, auditStatement]);
  if (
    Number(results[0]?.meta?.changes ?? 0) !== 1 ||
    Number(results[1]?.meta?.changes ?? 0) !== 1
  ) {
    throw new PlatformError(
      409,
      "catalog_update_conflict",
      "目录在审核期间发生变化，请刷新后重新确认成本与状态。",
    );
  }
  marketplaceOverlayCache.delete(env as object);
  return jsonResponse(
    {
      ok: true,
      path,
      enabled: body.enabled,
      readOnly: body.readOnly,
      revision: nextRevision,
    },
    200,
    requestId,
  );
}

async function handleCatalogConfirm(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "catalog");
  const body = await readJsonBody<{ items?: unknown }>(
    request,
    MAX_DASHBOARD_BODY_BYTES,
  );
  if (
    !Array.isArray(body.items) ||
    body.items.length < 1 ||
    body.items.length > 100
  ) {
    throw new PlatformError(
      400,
      "invalid_catalog_confirmation",
      "请选择 1–100 个待确认端点。",
    );
  }
  const items = body.items.map((value) => {
    if (
      !isPlainRecord(value) ||
      typeof value.path !== "string" ||
      !Number.isSafeInteger(value.expectedRevision) ||
      Number(value.expectedRevision) < 0 ||
      Number(value.expectedRevision) > 2_147_483_647
    ) {
      throw new PlatformError(
        400,
        "invalid_catalog_confirmation",
        "待确认端点必须包含有效路径与当前 revision。",
      );
    }
    return {
      path: normalizeCatalogPath(value.path),
      expectedRevision: Number(value.expectedRevision),
    };
  });
  if (new Set(items.map((item) => item.path)).size !== items.length) {
    throw new PlatformError(
      400,
      "duplicate_catalog_confirmation",
      "待确认端点不能重复。",
    );
  }

  const db = requireDb(env);
  await assertStoredCatalogTaxonomyIntegrity(db);
  const pathPlaceholders = items.map(() => "?").join(", ");
  const existingRows = await db
    .prepare(
      `SELECT path, http_method, upstream_price_usd_micros,
              customer_price_usd_micros, price_verified, enabled,
              read_only, safety_classification, safety_policy_version,
              revision, sync_generation,
              (
                SELECT last_success_generation
                FROM catalog_sync_state
                WHERE id = 1
              ) AS last_success_generation
       FROM endpoint_catalog
       WHERE path IN (${pathPlaceholders})`,
    )
    .bind(...items.map((item) => item.path))
    .all<{
      path: string;
      http_method: string;
      upstream_price_usd_micros: number;
      customer_price_usd_micros: number;
      price_verified: number;
      enabled: number;
      read_only: number;
      safety_classification: CatalogSafetyClassification;
      safety_policy_version: number;
      revision: number;
      sync_generation: string | null;
      last_success_generation: string | null;
    }>();
  const existingByPath = new Map(
    (existingRows.results ?? []).map((row) => [row.path, row]),
  );
  for (const item of items) {
    const existing = existingByPath.get(item.path);
    if (!existing) {
      throw new PlatformError(
        404,
        "endpoint_not_found",
        "待确认列表中包含目录不存在的端点，请刷新后重试。",
      );
    }
    if (
      existing.revision !== item.expectedRevision ||
      existing.enabled === 1
    ) {
      throw new PlatformError(
        409,
        "catalog_confirmation_conflict",
        "待确认端点的状态已经变化，请刷新后重新选择。",
      );
    }
    if (
      existing.sync_generation == null ||
      existing.sync_generation !== existing.last_success_generation ||
      existing.price_verified !== 1 ||
      existing.customer_price_usd_micros <
        existing.upstream_price_usd_micros ||
      (existing.http_method !== "GET" &&
        existing.http_method !== "POST") ||
      existing.safety_classification !== "safe_data_read" ||
      existing.safety_policy_version !== CATALOG_SAFETY_POLICY_VERSION ||
      isHardProhibitedCatalogOperation(
        item.path,
        existing.http_method as "GET" | "POST",
      )
    ) {
      throw new PlatformError(
        409,
        "catalog_confirmation_blocked",
        "待确认端点尚未满足最新同步、成本和安全策略要求。",
      );
    }
  }

  const selection = (prefix: string) =>
    items
      .map(() => `(${prefix}path = ? AND ${prefix}revision = ?)`)
      .join(" OR ");
  const selectionBindings = items.flatMap((item) => [
    item.path,
    item.expectedRevision,
  ]);
  const eligibility = (prefix: string) =>
    `${prefix}enabled = 0
     AND ${prefix}price_verified = 1
     AND ${prefix}customer_price_usd_micros >=
         ${prefix}upstream_price_usd_micros
     AND ${prefix}http_method IN ('GET', 'POST')
     AND ${prefix}safety_classification = 'safe_data_read'
     AND ${prefix}safety_policy_version =
         ${CATALOG_SAFETY_POLICY_VERSION}
     AND ${prefix}sync_generation = (
       SELECT last_success_generation
       FROM catalog_sync_state
       WHERE id = 1
     )`;
  const update = db
    .prepare(
      `UPDATE endpoint_catalog
       SET enabled = 1, read_only = 1,
           reviewed_at = CURRENT_TIMESTAMP,
           revision = revision + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE (${selection("")})
         AND ${eligibility("")}
         AND ? = (
           SELECT COUNT(*)
           FROM endpoint_catalog candidate
           WHERE (${selection("candidate.")})
             AND ${eligibility("candidate.")}
         )`,
    )
    .bind(
      ...selectionBindings,
      items.length,
      ...selectionBindings,
    );
  const supplied = bearerToken(request);
  if (!supplied) {
    throw new PlatformError(401, "admin_unauthorized", "管理员凭证无效。");
  }
  const selectionDigest = await sha256Hex(
    JSON.stringify(
      [...items].sort((left, right) =>
        left.path.localeCompare(right.path, "en-US"),
      ),
    ),
  );
  const auditId = `aud_${(
    await sha256Hex(`catalog.endpoints_confirmed:${selectionDigest}`)
  ).slice(0, 32)}`;
  const audit = db
    .prepare(
      `INSERT OR IGNORE INTO admin_audit_logs
       (id, actor_fingerprint, action, target_type, target_id,
        details_json, created_at)
       SELECT ?, ?, 'catalog.endpoints_confirmed',
              'catalog_endpoint_batch', ?, ?, CURRENT_TIMESTAMP
       WHERE changes() = ?`,
    )
    .bind(
      auditId,
      (await sha256Hex(supplied)).slice(0, 16),
      `confirm_${selectionDigest.slice(0, 24)}`,
      JSON.stringify({
        count: items.length,
        selectionDigest,
        samplePaths: items.slice(0, 20).map((item) => item.path),
      }),
      items.length,
    );
  const results = await db.batch([update, audit]);
  if (
    Number(results[0]?.meta?.changes ?? 0) !== items.length ||
    Number(results[1]?.meta?.changes ?? 0) !== 1
  ) {
    throw new PlatformError(
      409,
      "catalog_confirmation_conflict",
      "待确认端点在操作期间发生变化，整批未应用，请刷新后重试。",
    );
  }
  marketplaceOverlayCache.delete(env as object);
  return jsonResponse(
    {
      ok: true,
      count: items.length,
      paths: items.map((item) => item.path),
    },
    200,
    requestId,
  );
}

async function handleReconciliation(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "reconciliation");
  const db = requireDb(env);
  const stale = await db
    .prepare(
      `SELECT id, user_id, ledger_reference_id, cost_usd_micros
       FROM proxy_requests
       WHERE status IN ('processing', 'charged')
         AND datetime(created_at) < datetime('now', '-2 minutes')
       ORDER BY created_at ASC
       LIMIT 100`,
    )
    .all<{
      id: string;
      user_id: string;
      ledger_reference_id: string;
      cost_usd_micros: number;
    }>();

  let refunded = 0;
  for (const item of stale.results ?? []) {
    const refund = await db
      .prepare(
        `INSERT OR IGNORE INTO balance_ledger
         (id, user_id, entry_type, delta_usd_micros, reference_id, description, created_at)
         SELECT ?, ?, 'api_reconciliation', ?, ?,
                'Stale proxy request reconciliation', CURRENT_TIMESTAMP
         WHERE EXISTS (
           SELECT 1 FROM balance_ledger
           WHERE reference_id = ? AND delta_usd_micros = ?
         )
         AND EXISTS (
           SELECT 1 FROM proxy_requests
           WHERE id = ?
             AND status IN ('processing', 'charged')
             AND datetime(created_at) < datetime('now', '-2 minutes')
         )`,
      )
      .bind(
        `led_${randomBase64Url(16)}`,
        item.user_id,
        item.cost_usd_micros,
        `${item.ledger_reference_id}:refund`,
        item.ledger_reference_id,
        -item.cost_usd_micros,
        item.id,
      )
      .run();
    const changes = Number(refund.meta?.changes ?? 0);
    refunded += changes;
    const refundReference = `${item.ledger_reference_id}:refund`;
    const refundRecorded =
      changes === 1 ||
      Boolean(
        await db
          .prepare(
            `SELECT 1 AS present
             FROM balance_ledger
             WHERE reference_id = ?
             LIMIT 1`,
          )
          .bind(refundReference)
          .first<{ present: number }>(),
      );
    if (refundRecorded) {
      await db
        .prepare(
          `UPDATE proxy_requests
           SET status = 'reconciled', response_status = 500,
               completed_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status IN ('processing', 'charged')`,
        )
        .bind(item.id)
        .run();
    }
  }

  let paymentEventsProcessed = 0;
  let paymentsPolled = 0;
  let creditedPaymentsPolled = 0;
  let rejectedPaymentsPolled = 0;
  let paymentErrors = 0;
  let paymentProviderAttempts = 0;
  const paymentApiKey = env.NOWPAYMENTS_API_KEY;
  if (paymentApiKey) {
    const events = await db
      .prepare(
        `SELECT id, provider_payment_id, order_id
         FROM payment_events
         WHERE provider = 'nowpayments' AND processed_at IS NULL
           AND datetime(next_attempt_at) <= datetime('now')
         ORDER BY attempt_count ASC, next_attempt_at ASC, received_at ASC
         LIMIT 12`,
      )
      .all<{
        id: string;
        provider_payment_id: string;
        order_id: string;
      }>();
    const eventRows = events.results ?? [];
    paymentProviderAttempts += eventRows.length;
    for (let offset = 0; offset < eventRows.length; offset += 3) {
      await Promise.all(
        eventRows.slice(offset, offset + 3).map(async (event) => {
          await processNowPaymentsEvent(db, paymentApiKey, {
            eventId: event.id,
            paymentId: event.provider_payment_id,
            orderId: event.order_id,
            requestId,
          });
          const processed = await db
            .prepare(
              `SELECT processed_at
               FROM payment_events
               WHERE id = ?`,
            )
            .bind(event.id)
            .first<{ processed_at: string | null }>();
          if (processed?.processed_at) paymentEventsProcessed += 1;
          else paymentErrors += 1;
        }),
      );
    }

    const pendingPayments = await db
      .prepare(
        `SELECT id, provider_payment_id
         FROM payment_orders
         WHERE provider = 'nowpayments'
           AND provider_payment_id IS NOT NULL
           AND (
             (
               status IN ('waiting', 'confirming', 'confirmed', 'sending',
                          'creating')
               AND datetime(updated_at) < datetime('now', '-1 minute')
             )
             OR (
               status IN ('expired', 'failed')
               AND datetime(updated_at) < datetime('now', '-6 hours')
               AND datetime(created_at) >= datetime('now', '-7 days')
             )
           )
         ORDER BY updated_at ASC
         LIMIT 12`,
      )
      .all<{ id: string; provider_payment_id: string }>();
    const pendingRows = pendingPayments.results ?? [];
    paymentProviderAttempts += pendingRows.length;
    for (let offset = 0; offset < pendingRows.length; offset += 3) {
      await Promise.all(
        pendingRows.slice(offset, offset + 3).map(async (payment) => {
          try {
            const verified = await getNowPaymentsPayment(
              paymentApiKey,
              payment.provider_payment_id,
            );
            await applyVerifiedNowPayment(db, verified, {
              paymentId: payment.provider_payment_id,
              orderId: payment.id,
              requestId,
            });
            await db
              .prepare(
                `INSERT INTO operation_heartbeats
                 (name, last_success_at, details_json)
                 VALUES (?, CURRENT_TIMESTAMP, ?)
                 ON CONFLICT(name) DO UPDATE SET
                   last_success_at = CURRENT_TIMESTAMP,
                   details_json = excluded.details_json`,
              )
              .bind(
                `payment-status:${payment.provider_payment_id}`,
                JSON.stringify({
                  orderId: payment.id,
                  source: "pending_reconciliation",
                }),
              )
              .run();
            paymentsPolled += 1;
          } catch (error) {
            paymentErrors += 1;
            await db
              .prepare(
                `UPDATE payment_orders
                 SET updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
              )
              .bind(payment.id)
              .run();
            console.error("Payment reconciliation failed", {
              requestId,
              orderId: payment.id,
              paymentId: payment.provider_payment_id,
              error: error instanceof Error ? error.message : "unknown error",
            });
          }
        }),
      );
    }

    const rejectedCandidates = await db
      .prepare(
        `SELECT r.order_id, r.provider_payment_id
         FROM payment_review_cases r
         JOIN payment_orders p ON p.id = r.order_id
         LEFT JOIN operation_heartbeats h
           ON h.name =
              'payment-rejected-status:' || r.provider_payment_id
         WHERE p.provider = 'nowpayments'
           AND r.status = 'resolved'
           AND r.resolution_action = 'reject'
           AND r.resolved_at IS NOT NULL
           AND datetime(r.resolved_at) >= datetime('now', '-7 days')
           AND datetime(r.resolved_at) <= datetime('now', '-6 hours')
           AND NOT EXISTS (
             SELECT 1
             FROM balance_ledger l
             WHERE l.delta_usd_micros > 0
               AND l.reference_id IN (
                 'nowpayments:' || r.provider_payment_id || ':credit',
                 'nowpayments-review:' || r.id || ':credit'
               )
           )
           AND (
             h.name IS NULL
             OR datetime(h.last_success_at) <
                datetime('now', '-6 hours')
           )
         ORDER BY COALESCE(h.last_success_at, r.resolved_at) ASC,
                  r.provider_payment_id ASC
         LIMIT 4`,
      )
      .all<{ order_id: string; provider_payment_id: string }>();
    const rejectedRows = rejectedCandidates.results ?? [];
    for (let offset = 0; offset < rejectedRows.length; offset += 2) {
      await Promise.all(
        rejectedRows.slice(offset, offset + 2).map(async (payment) => {
          const heartbeatName =
            `payment-rejected-status:${payment.provider_payment_id}`;
          const claimed = await db
            .prepare(
              `INSERT INTO operation_heartbeats
               (name, last_success_at, details_json)
               VALUES (?, CURRENT_TIMESTAMP, ?)
               ON CONFLICT(name) DO UPDATE SET
                 last_success_at = CURRENT_TIMESTAMP,
                 details_json = excluded.details_json
               WHERE datetime(operation_heartbeats.last_success_at) <
                     datetime('now', '-6 hours')
               RETURNING name`,
            )
            .bind(
              heartbeatName,
              JSON.stringify({
                orderId: payment.order_id,
                source: "rejected_payment_reconciliation",
                state: "polling",
              }),
            )
            .first<{ name: string }>();
          if (!claimed) return;
          paymentProviderAttempts += 1;
          let pollError: string | null = null;
          try {
            const verified = await getNowPaymentsPayment(
              paymentApiKey,
              payment.provider_payment_id,
            );
            await applyVerifiedNowPayment(db, verified, {
              paymentId: payment.provider_payment_id,
              orderId: payment.order_id,
              requestId,
            });
            rejectedPaymentsPolled += 1;
          } catch (error) {
            paymentErrors += 1;
            pollError =
              error instanceof Error
                ? error.message.slice(0, 300)
                : "unknown error";
            console.error("Rejected payment status polling failed", {
              requestId,
              orderId: payment.order_id,
              paymentId: payment.provider_payment_id,
              error: pollError,
            });
          } finally {
            const nextRotationTimestamp = new Date(
              Date.now() - (pollError ? 5 * 60 * 60_000 : 0),
            ).toISOString();
            await db
              .prepare(
                `INSERT INTO operation_heartbeats
                 (name, last_success_at, details_json)
                 VALUES (?, ?, ?)
                 ON CONFLICT(name) DO UPDATE SET
                   last_success_at = excluded.last_success_at,
                   details_json = excluded.details_json`,
              )
              .bind(
                heartbeatName,
                nextRotationTimestamp,
                JSON.stringify({
                  orderId: payment.order_id,
                  source: "rejected_payment_reconciliation",
                  error: pollError,
                }),
              )
              .run();
          }
        }),
      );
    }

    const creditedCandidates = await db
      .prepare(
        `WITH candidates(order_id, provider_payment_id) AS (
           SELECT p.id, p.provider_payment_id
           FROM payment_orders p
           JOIN balance_ledger credit
             ON credit.reference_id =
                'nowpayments:' || p.provider_payment_id || ':credit'
              AND credit.delta_usd_micros > 0
           LEFT JOIN balance_ledger reversal
             ON reversal.reference_id =
                'nowpayments:' || p.provider_payment_id || ':reversal'
           WHERE p.provider = 'nowpayments'
             AND p.provider_payment_id IS NOT NULL
             AND reversal.id IS NULL
           UNION
           SELECT r.order_id, r.provider_payment_id
           FROM payment_review_cases r
           JOIN balance_ledger credit
             ON credit.reference_id =
                'nowpayments-review:' || r.id || ':credit'
              AND credit.delta_usd_micros > 0
           LEFT JOIN balance_ledger reversal
             ON reversal.reference_id =
                'nowpayments-review:' || r.id || ':reversal'
           WHERE reversal.id IS NULL
         )
         SELECT c.order_id, c.provider_payment_id
         FROM candidates c
         LEFT JOIN operation_heartbeats h
           ON h.name = 'payment-status:' || c.provider_payment_id
         WHERE h.name IS NULL
            OR datetime(h.last_success_at) <
               datetime('now', '-6 hours')
         ORDER BY COALESCE(h.last_success_at, '1970-01-01') ASC,
                  c.provider_payment_id ASC
         LIMIT 12`,
      )
      .all<{ order_id: string; provider_payment_id: string }>();
    const creditedRows = creditedCandidates.results ?? [];
    paymentProviderAttempts += creditedRows.length;
    for (let offset = 0; offset < creditedRows.length; offset += 3) {
      await Promise.all(
        creditedRows.slice(offset, offset + 3).map(async (payment) => {
          let pollError: string | null = null;
          try {
            const verified = await getNowPaymentsPayment(
              paymentApiKey,
              payment.provider_payment_id,
            );
            await applyVerifiedNowPayment(db, verified, {
              paymentId: payment.provider_payment_id,
              orderId: payment.order_id,
              requestId,
            });
            creditedPaymentsPolled += 1;
          } catch (error) {
            paymentErrors += 1;
            pollError =
              error instanceof Error
                ? error.message.slice(0, 300)
                : "unknown error";
            console.error("Credited payment status polling failed", {
              requestId,
              orderId: payment.order_id,
              paymentId: payment.provider_payment_id,
              error: pollError,
            });
          } finally {
            const nextRotationTimestamp = new Date(
              Date.now() - (pollError ? 5 * 60 * 60_000 : 0),
            ).toISOString();
            await db
              .prepare(
                `INSERT INTO operation_heartbeats
                 (name, last_success_at, details_json)
                 VALUES (?, ?, ?)
                 ON CONFLICT(name) DO UPDATE SET
                   last_success_at = excluded.last_success_at,
                   details_json = excluded.details_json`,
              )
              .bind(
                `payment-status:${payment.provider_payment_id}`,
                nextRotationTimestamp,
                JSON.stringify({
                  orderId: payment.order_id,
                  error: pollError,
                }),
              )
              .run();
          }
        }),
      );
    }
  }

  const paymentProviderSuccesses =
    paymentEventsProcessed +
    paymentsPolled +
    creditedPaymentsPolled +
    rejectedPaymentsPolled;
  const providerObservationFailed =
    Boolean(paymentApiKey) &&
    paymentProviderAttempts > 0 &&
    paymentProviderSuccesses === 0;
  const reconciliationDetails = JSON.stringify({
    refunded,
    paymentEventsProcessed,
    paymentsPolled,
    creditedPaymentsPolled,
    rejectedPaymentsPolled,
    paymentErrors,
    paymentProviderAttempts,
    paymentProviderSuccesses,
    status: providerObservationFailed ? "provider_failed" : "healthy",
  });
  const maintenanceStatements = [
    db
      .prepare(
        `DELETE FROM payment_rate_limit_buckets
         WHERE datetime(updated_at) < datetime('now', '-2 days')`,
      ),
    db
      .prepare(
        `DELETE FROM upstream_rate_limit_buckets
         WHERE datetime(updated_at) < datetime('now', '-10 minutes')`,
      ),
    db
      .prepare(
        `DELETE FROM payment_events
         WHERE processed_at IS NOT NULL
           AND datetime(processed_at) < datetime('now', '-90 days')`,
      ),
    db
      .prepare(
        `DELETE FROM auth_rate_limit_buckets
         WHERE datetime(updated_at) < datetime('now', '-2 days')`,
      ),
    db
      .prepare(
        `DELETE FROM auth_challenges
         WHERE datetime(expires_at) < datetime('now', '-1 day')
            OR (consumed_at IS NOT NULL
                AND datetime(consumed_at) < datetime('now', '-1 day'))`,
      ),
    db
      .prepare(
        `DELETE FROM auth_sessions
         WHERE datetime(expires_at) <= datetime('now')`,
      ),
    db
      .prepare(
        `DELETE FROM operation_heartbeats
         WHERE (
             name LIKE 'payment-status:%'
             OR name LIKE 'payment-rejected-status:%'
           )
           AND datetime(last_success_at) < datetime('now', '-200 days')`,
      ),
    db
      .prepare(
        `INSERT INTO operation_heartbeats
         (name, last_success_at, details_json)
         VALUES ('reconciliation:last-run', CURRENT_TIMESTAMP, ?)
         ON CONFLICT(name) DO UPDATE SET
           last_success_at = CURRENT_TIMESTAMP,
           details_json = excluded.details_json`,
      )
      .bind(reconciliationDetails),
  ];
  if (!providerObservationFailed) {
    maintenanceStatements.push(
      db
        .prepare(
          `INSERT INTO operation_heartbeats
         (name, last_success_at, details_json)
         VALUES ('reconciliation', CURRENT_TIMESTAMP, ?)
         ON CONFLICT(name) DO UPDATE SET
           last_success_at = CURRENT_TIMESTAMP,
           details_json = excluded.details_json`,
        )
        .bind(reconciliationDetails),
    );
  }
  await db.batch(maintenanceStatements);

  return jsonResponse(
    {
      proxy: {
        inspected: stale.results?.length ?? 0,
        refunded,
      },
      payments: {
        eventsProcessed: paymentEventsProcessed,
        polled: paymentsPolled,
        creditedPolled: creditedPaymentsPolled,
        rejectedPolled: rejectedPaymentsPolled,
        errors: paymentErrors,
        providerAttempts: paymentProviderAttempts,
        providerSuccesses: paymentProviderSuccesses,
        providerHealthy: !providerObservationFailed,
        skipped: paymentApiKey ? null : "NOWPAYMENTS_API_KEY 未配置",
      },
      note: "回退两分钟前仍未完成且存在扣款流水的代理请求，并复核未处理事件、待确认充值、近期零入账拒绝案件与已入账退款状态。",
    },
    providerObservationFailed ? 502 : 200,
    requestId,
  );
}

async function createNowPaymentsPayment(
  apiKey: string,
  input: {
    amountUsd: number;
    payCurrency: string;
    orderId: string;
    appOrigin: string;
  },
): Promise<NowPaymentsPayment> {
  let response: Response;
  try {
    response = await fetch("https://api.nowpayments.io/v1/payment", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        price_amount: input.amountUsd,
        price_currency: "usd",
        pay_currency: input.payCurrency,
        order_id: input.orderId,
        order_description: `RelayBase API balance · ${input.orderId}`,
        ipn_callback_url: `${input.appOrigin}/api/payments/nowpayments/ipn`,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new PlatformError(
      502,
      "payment_provider_error",
      "支付服务商暂时不可用。",
    );
  }
  const payload = (await readResponseJson(
    response,
    MAX_PROVIDER_RESPONSE_BYTES,
    "invalid_provider_response",
  ).catch(() => null)) as
    | NowPaymentsPayment
    | { message?: string }
    | null;
  if (!response.ok) {
    const providerMessage =
      isPlainRecord(payload) &&
      "message" in payload &&
      typeof payload.message === "string" &&
      payload.message.length < 180
        ? `：${payload.message}`
        : "";
    throw new PlatformError(
      502,
      "payment_provider_error",
      `支付服务商创建订单失败${providerMessage}`,
    );
  }
  if (!isPlainRecord(payload)) {
    throw new PlatformError(
      502,
      "invalid_provider_response",
      "支付服务商返回了无法识别的订单。",
    );
  }
  const payment = payload as NowPaymentsPayment;
  const paymentId = String(payment.payment_id ?? "");
  const payAmount = normalizedPositiveDecimal(payment.pay_amount);
  const paymentStatus =
    typeof payment.payment_status === "string"
      ? payment.payment_status.trim().toLowerCase()
      : "waiting";
  const invoiceUrl = safeInvoiceUrl(
    typeof payment.invoice_url === "string" ? payment.invoice_url : null,
  );
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(paymentId) ||
    payment.order_id !== input.orderId ||
    parseUsdMicros(payment.price_amount) !== input.amountUsd * 1_000_000 ||
    typeof payment.price_currency !== "string" ||
    payment.price_currency.toLowerCase() !== "usd" ||
    typeof payment.pay_currency !== "string" ||
    payment.pay_currency.toLowerCase() !== input.payCurrency ||
    !NOWPAYMENTS_STATUSES.has(paymentStatus) ||
    typeof payment.pay_address !== "string" ||
    payment.pay_address.length < 8 ||
    payment.pay_address.length > 256 ||
    payAmount == null ||
    (payment.invoice_url != null && invoiceUrl == null)
  ) {
    throw new PlatformError(
      502,
      "invalid_provider_response",
      "支付服务商返回了无法识别的订单。",
    );
  }
  return {
    ...payment,
    payment_id: paymentId,
    pay_amount: payAmount,
    pay_currency: input.payCurrency,
    payment_status: paymentStatus,
    invoice_url: invoiceUrl ?? undefined,
  };
}

async function getNowPaymentsPayment(
  apiKey: string,
  paymentId: string,
): Promise<NowPaymentsPayment> {
  let response: Response;
  try {
    response = await fetch(
      `https://api.nowpayments.io/v1/payment/${encodeURIComponent(paymentId)}`,
      {
        headers: {
          "x-api-key": apiKey,
          accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(6_000),
      },
    );
  } catch {
    throw new PlatformError(
      502,
      "provider_verification_failed",
      "支付服务商订单复核暂时不可用。",
    );
  }
  if (!response.ok) {
    throw new PlatformError(
      502,
      "provider_verification_failed",
      `支付服务商订单复核失败（${response.status}）。`,
    );
  }
  const payload = await readResponseJson(
    response,
    MAX_PROVIDER_RESPONSE_BYTES,
    "provider_verification_failed",
  ).catch(() => null);
  if (!isPlainRecord(payload)) {
    throw new PlatformError(
      502,
      "provider_verification_failed",
      "支付服务商返回了无法识别的订单状态。",
    );
  }
  return payload as NowPaymentsPayment;
}

async function managedUpstreamProviderCredentialsSnapshot(
  db: D1Database,
): Promise<{
  credentials: ManagedUpstreamCredentialRecord[];
  activeCredentialId: string | null;
  managedEnabled: boolean;
  stateVersion: number;
}> {
  const state = await upstreamCredentialState(db);
  let rows: D1Result<ManagedUpstreamCredentialRecord>;
  try {
    rows = await db
      .prepare(
        `SELECT c.id, c.label, c.encrypted_secret, c.secret_hash,
                c.verified_scopes_json, c.verified_config_hash,
                c.expires_at,
                CASE
                  WHEN c.revoked_at IS NOT NULL THEN 'revoked'
                  WHEN s.active_credential_id = c.id THEN 'active'
                  ELSE 'standby'
                END AS status,
                c.verified_at, c.created_at, c.last_used_at, c.revoked_at
         FROM upstream_credentials c
         JOIN upstream_credential_state s
           ON s.provider = c.provider
         WHERE c.provider = 'primary'
         ORDER BY CASE
                    WHEN s.active_credential_id = c.id THEN 0
                    WHEN c.revoked_at IS NULL THEN 1
                    ELSE 2
                  END,
                  c.created_at DESC, c.id DESC
         LIMIT 100`,
      )
      .all<ManagedUpstreamCredentialRecord>();
  } catch {
    throw new PlatformError(
      503,
      "database_migrations_required",
      "UpstreamProvider 凭据库迁移尚未完成。",
    );
  }
  return {
    credentials: rows.results ?? [],
    activeCredentialId: state.activeCredentialId,
    managedEnabled: state.managedEnabled,
    stateVersion: state.version,
  };
}

async function upstreamCredentialState(
  db: D1Database,
): Promise<{
  activeCredentialId: string | null;
  managedEnabled: boolean;
  version: number;
}> {
  try {
    const row = await db
      .prepare(
        `SELECT active_credential_id, managed_enabled, version
         FROM upstream_credential_state
         WHERE provider = 'primary'`,
      )
      .first<{
        active_credential_id: string | null;
        managed_enabled: number;
        version: number;
      }>();
    const managedEnabled = Number(row?.managed_enabled);
    const version = Number(row?.version);
    if (
      !row ||
      (managedEnabled !== 0 && managedEnabled !== 1) ||
      !Number.isSafeInteger(version) ||
      version < 0 ||
      (managedEnabled === 0 && row.active_credential_id !== null)
    ) {
      throw new Error("missing credential state");
    }
    return {
      activeCredentialId: row.active_credential_id,
      managedEnabled: managedEnabled === 1,
      version,
    };
  } catch {
    throw new PlatformError(
      503,
      "database_migrations_required",
      "UpstreamProvider 凭据库迁移尚未完成。",
    );
  }
}

async function managedUpstreamProviderCredentialById(
  db: D1Database,
  id: string,
): Promise<ManagedUpstreamCredentialRecord | null> {
  try {
    return await db
      .prepare(
        `SELECT c.id, c.label, c.encrypted_secret, c.secret_hash,
                c.verified_scopes_json, c.verified_config_hash,
                c.expires_at,
                CASE
                  WHEN c.revoked_at IS NOT NULL THEN 'revoked'
                  WHEN s.active_credential_id = c.id THEN 'active'
                  ELSE 'standby'
                END AS status,
                c.verified_at, c.created_at, c.last_used_at, c.revoked_at
         FROM upstream_credentials c
         JOIN upstream_credential_state s
           ON s.provider = c.provider
         WHERE c.provider = 'primary' AND c.id = ?`,
      )
      .bind(id)
      .first<ManagedUpstreamCredentialRecord>();
  } catch {
    throw new PlatformError(
      503,
      "database_migrations_required",
      "UpstreamProvider 凭据库迁移尚未完成。",
    );
  }
}

function publicManagedUpstreamProviderCredential(
  credential: ManagedUpstreamCredentialRecord,
) {
  let scopeCount = 0;
  try {
    const scopes = normalizeUpstreamProviderCredentialScopes(
      credential.verified_scopes_json
        ? (JSON.parse(credential.verified_scopes_json) as unknown)
        : null,
    );
    scopeCount = scopes?.length ?? 0;
  } catch {
    scopeCount = 0;
  }
  return {
    id: credential.id,
    label: credential.label,
    fingerprint: credential.secret_hash.slice(0, 16),
    status: credential.status,
    scopeCount,
    expiresAt: credential.expires_at,
    verifiedAt: credential.verified_at,
    createdAt: credential.created_at,
    lastUsedAt: credential.last_used_at,
    revokedAt: credential.revoked_at,
  };
}

async function activateManagedUpstreamProviderCredential(
  db: D1Database,
  request: Request,
  id: string,
  expectedVersion: number,
  verification: UpstreamProviderCredentialVerification,
): Promise<void> {
  const existing = await managedUpstreamProviderCredentialById(db, id);
  if (!existing) {
    throw new PlatformError(
      404,
      "upstream_credential_not_found",
      "没有找到这个 UpstreamProvider 凭据。",
    );
  }
  if (existing.status === "revoked") {
    throw new PlatformError(
      409,
      "upstream_credential_revoked",
      "已撤销的 UpstreamProvider 凭据不能再次使用。",
    );
  }
  const nextVersion = expectedVersion + 1;
  const activatedAt = new Date().toISOString();
  const verifiedScopesJson = JSON.stringify(verification.scopes);
  const activationAudit = await prepareAdminAuditStatement(db, request, {
    action: "upstream_credential.activated",
    targetType: "upstream_credential",
    targetId: id,
    upstreamCredentialActivation: {
      id,
      stateVersion: nextVersion,
      updatedAt: activatedAt,
      verifiedAt: activatedAt,
      verifiedScopesJson,
      verifiedConfigHash: verification.configHash,
      expiresAt: verification.expiresAt,
      secretHash: existing.secret_hash,
    },
    details: {
      provider: PRIMARY_UPSTREAM_PROVIDER,
      label: existing.label,
      fingerprint: existing.secret_hash.slice(0, 16),
      previousStateVersion: expectedVersion,
    },
  });
  const activated = await db.batch([
    db
      .prepare(
        `UPDATE upstream_credentials
         SET verified_scopes_json = ?, verified_config_hash = ?,
             expires_at = ?, verified_at = ?
         WHERE id = ? AND provider = 'primary' AND revoked_at IS NULL
           AND secret_hash = ?
           AND EXISTS (
             SELECT 1 FROM upstream_credential_state
             WHERE provider = 'primary' AND version = ?
           )`,
      )
      .bind(
        verifiedScopesJson,
        verification.configHash,
        verification.expiresAt,
        activatedAt,
        id,
        existing.secret_hash,
        expectedVersion,
      ),
    db
      .prepare(
      `UPDATE upstream_credential_state
       SET managed_enabled = 1, active_credential_id = ?,
           version = version + 1, updated_at = ?
       WHERE provider = 'primary' AND version = ?
         AND EXISTS (
           SELECT 1 FROM upstream_credentials
           WHERE id = ? AND provider = 'primary' AND revoked_at IS NULL
             AND secret_hash = ? AND verified_scopes_json = ?
             AND verified_config_hash = ?
             AND expires_at IS ? AND verified_at = ?
         )`,
      )
      .bind(
        id,
        activatedAt,
        expectedVersion,
        id,
        existing.secret_hash,
        verifiedScopesJson,
        verification.configHash,
        verification.expiresAt,
        activatedAt,
      ),
    db
      .prepare(
        `DELETE FROM catalog_sync_state
         WHERE id = 1
           AND EXISTS (
             SELECT 1 FROM upstream_credential_state
             WHERE provider = 'primary' AND managed_enabled = 1
               AND active_credential_id = ? AND version = ?
               AND updated_at = ?
           )`,
      )
      .bind(id, nextVersion, activatedAt),
    activationAudit,
  ]);
  if (
    Number(activated[0]?.meta?.changes ?? 0) !== 1 ||
    Number(activated[1]?.meta?.changes ?? 0) !== 1 ||
    Number(activated[3]?.meta?.changes ?? 0) !== 1
  ) {
    throw new PlatformError(
      409,
      "upstream_credential_update_conflict",
      "UpstreamProvider 活动凭据已发生变化，请刷新后重试。",
    );
  }
}

function sanitizeUpstreamCredentialLabel(value: unknown): string {
  if (typeof value !== "string") {
    throw new PlatformError(
      400,
      "invalid_upstream_credential_label",
      "UpstreamProvider 凭据名称无效。",
    );
  }
  const label = value.replace(/\s+/g, " ").trim();
  if (
    label.length < 2 ||
    label.length > 80 ||
    /[\u0000-\u001F\u007F]/.test(label)
  ) {
    throw new PlatformError(
      400,
      "invalid_upstream_credential_label",
      "UpstreamProvider 凭据名称必须是 2–80 个可见字符。",
    );
  }
  return label;
}

function isValidUpstreamProviderApiKey(value: string): boolean {
  return /^[\x21-\x7E]{16,512}$/.test(value);
}

function hasValidUpstreamProviderCredentialsEncryptionKey(
  value?: string,
): value is string {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  try {
    return base64UrlToBytes(value).length === 32;
  } catch {
    return false;
  }
}

function requireUpstreamProviderCredentialsEncryptionKey(env: PlatformEnv): string {
  if (
    !hasValidUpstreamProviderCredentialsEncryptionKey(
      env.UPSTREAM_CREDENTIALS_ENCRYPTION_KEY,
    )
  ) {
    throw new PlatformError(
      503,
      "upstream_credential_encryption_unavailable",
      "UpstreamProvider 凭据加密主密钥尚未正确配置。",
    );
  }
  return env.UPSTREAM_CREDENTIALS_ENCRYPTION_KEY;
}

async function importUpstreamProviderCredentialsEncryptionKey(
  encodedKey: string,
): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    bytesToArrayBuffer(base64UrlToBytes(encodedKey)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function upstreamProviderCredentialAdditionalData(id: string): ArrayBuffer {
  return bytesToArrayBuffer(
    new TextEncoder().encode(
      `relaybase:upstream-credential:${id}:v1`,
    ),
  );
}

async function encryptUpstreamProviderApiKey(
  apiKey: string,
  encodedKey: string,
  id: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: upstreamProviderCredentialAdditionalData(id),
      tagLength: 128,
    },
    await importUpstreamProviderCredentialsEncryptionKey(encodedKey),
    new TextEncoder().encode(apiKey),
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(
    new Uint8Array(ciphertext),
  )}`;
}

async function decryptUpstreamProviderApiKey(
  encryptedSecret: string,
  encodedKey: string,
  id: string,
): Promise<string> {
  const parts = encryptedSecret.split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== "v1" ||
    !/^[A-Za-z0-9_-]{16}$/.test(parts[1] ?? "") ||
    !/^[A-Za-z0-9_-]{32,800}$/.test(parts[2] ?? "")
  ) {
    throw new PlatformError(
      503,
      "upstream_credential_decryption_failed",
      "UpstreamProvider 凭据密文格式无效，已停止上游调用。",
    );
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytesToArrayBuffer(base64UrlToBytes(parts[1] ?? "")),
        additionalData: upstreamProviderCredentialAdditionalData(id),
        tagLength: 128,
      },
      await importUpstreamProviderCredentialsEncryptionKey(encodedKey),
      bytesToArrayBuffer(base64UrlToBytes(parts[2] ?? "")),
    );
    const apiKey = new TextDecoder("utf-8", { fatal: true }).decode(
      plaintext,
    );
    if (!isValidUpstreamProviderApiKey(apiKey)) {
      throw new Error("invalid decrypted secret");
    }
    return apiKey;
  } catch {
    throw new PlatformError(
      503,
      "upstream_credential_decryption_failed",
      "UpstreamProvider 凭据无法解密，已停止上游调用。",
    );
  }
}

async function verifyUpstreamProviderApiKey(
  apiKey: string,
  env: PlatformEnv,
  sourceConfig: UpstreamSourceConfig,
): Promise<UpstreamProviderCredentialVerification> {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const candidate = await fetch(
        upstreamConfigUrl(
          sourceConfig,
          sourceConfig.credentialPath,
        ),
        {
          headers: {
            authorization: `Bearer ${apiKey}`,
            accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(
            clampInteger(
              env.UPSTREAM_TIMEOUT_MS,
              30_000,
              30_000,
              60_000,
            ),
          ),
        },
      );
      const transient =
        candidate.status === 408 ||
        candidate.status === 429 ||
        candidate.status >= 500;
      if (!transient || attempt === 2) {
        response = candidate;
        break;
      }
      await candidate.body?.cancel("retry transient verification");
    } catch {
      if (attempt === 2) break;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, 250 * 2 ** attempt),
    );
  }
  if (!response) {
    throw new PlatformError(
      502,
      "upstream_credential_verification_failed",
      "UpstreamProvider 暂时无法验证这个 API Key。",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new PlatformError(
      400,
      "upstream_credential_rejected",
      "UpstreamProvider 拒绝了这个 API Key。",
    );
  }
  if (!response.ok) {
    throw new PlatformError(
      502,
      "upstream_credential_verification_failed",
      `UpstreamProvider 凭据验证失败（${response.status}）。`,
    );
  }
  const payload = await readResponseJson(
    response,
    MAX_PROVIDER_RESPONSE_BYTES,
    "upstream_credential_verification_failed",
  );
  if (
    !isPlainRecord(payload) ||
    Number(payload.code) !== 200 ||
    !isPlainRecord(payload.api_key_data) ||
    !isPlainRecord(payload.user_data)
  ) {
    throw new PlatformError(
      502,
      "upstream_credential_verification_failed",
      "UpstreamProvider 凭据验证响应格式无效。",
    );
  }
  const apiKeyData = payload.api_key_data;
  const userData = payload.user_data;
  if (
    Number(apiKeyData.api_key_status) !== 1 ||
    userData.account_disabled !== false ||
    userData.is_active !== true
  ) {
    throw new PlatformError(
      400,
      "upstream_credential_inactive",
      "这个 UpstreamProvider API Key 或所属账户当前不可用。",
    );
  }
  let expiresAt: string | null = null;
  if (apiKeyData.expires_at !== null) {
    if (
      typeof apiKeyData.expires_at !== "string" ||
      !Number.isFinite(Date.parse(apiKeyData.expires_at)) ||
      Date.parse(apiKeyData.expires_at) <= Date.now()
    ) {
      throw new PlatformError(
        400,
        "upstream_credential_expired",
        "这个 UpstreamProvider API Key 已过期。",
      );
    }
    expiresAt = new Date(apiKeyData.expires_at).toISOString();
  }
  const scopes = normalizeUpstreamProviderCredentialScopes(
    apiKeyData.api_key_scopes,
  );
  if (
    !scopes ||
    !hasUpstreamProviderDataScope(scopes, sourceConfig)
  ) {
    throw new PlatformError(
      400,
      "upstream_credential_scope_insufficient",
      "这个 UpstreamProvider API Key 没有可用于数据接口的授权范围。",
    );
  }
  return { scopes, expiresAt, configHash: sourceConfig.hash };
}

function normalizeUpstreamProviderCredentialScopes(
  value: unknown,
): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
    return null;
  }
  const normalized: string[] = [];
  for (const scope of value) {
    if (typeof scope !== "string") return null;
    const compact = scope.trim().toLowerCase().replace(/\/+$/, "");
    if (
      !compact ||
      compact.length > 512 ||
      (compact !== "*" &&
        compact !== "all" &&
        !/^\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/.test(compact))
    ) {
      return null;
    }
    normalized.push(compact);
  }
  return [...new Set(normalized)].sort();
}

function hasUpstreamProviderDataScope(
  scopes: string[],
  sourceConfig?: UpstreamSourceConfig,
): boolean {
  const apiPathPrefix = sourceConfig?.apiPathPrefix ?? "/api";
  const versionRoot = `${apiPathPrefix}/v1`.toLowerCase();
  const excluded = (sourceConfig?.publicExcludedPrefixes ?? []).map(
    (prefix) =>
      `${apiPathPrefix}${prefix.replace(/\/$/, "")}`.toLowerCase(),
  );
  return scopes.some((normalized) => {
    if (
      normalized === "*" ||
      normalized === "all" ||
      normalized === versionRoot
    ) {
      return true;
    }
    if (!normalized.startsWith(`${versionRoot}/`)) return false;
    return !excluded.some(
      (prefix) =>
        normalized === prefix ||
        normalized.startsWith(`${prefix}/`),
    );
  });
}

function upstreamProviderCredentialAllowsPath(
  scopes: string[] | null,
  catalogPath: string,
  apiPathPrefix = "/api",
): boolean {
  if (scopes === null) return true;
  const upstreamPath =
    `${apiPathPrefix}${catalogPath}`.toLowerCase();
  const versionRoot =
    `${apiPathPrefix}/v1`.toLowerCase();
  return scopes.some((scope) => {
    if (scope === "*" || scope === "all" || scope === versionRoot) {
      return true;
    }
    return (
      upstreamPath === scope ||
      upstreamPath.startsWith(`${scope}/`)
    );
  });
}

function storedUpstreamProviderCredentialScopes(
  value: string | null,
  sourceConfig?: UpstreamSourceConfig,
): string[] {
  if (!value) {
    throw new PlatformError(
      503,
      "upstream_credential_state_invalid",
      "UpstreamProvider 活动凭据缺少已验证的授权范围。",
    );
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    const scopes = normalizeUpstreamProviderCredentialScopes(parsed);
    if (!scopes || !hasUpstreamProviderDataScope(scopes, sourceConfig)) {
      throw new Error();
    }
    return scopes;
  } catch {
    throw new PlatformError(
      503,
      "upstream_credential_state_invalid",
      "UpstreamProvider 活动凭据授权范围无效，已停止上游调用。",
    );
  }
}

async function resolveUpstreamProviderCredential(
  env: PlatformEnv,
  db: D1Database,
  configuredSource?: UpstreamSourceConfig,
): Promise<ResolvedUpstreamProviderCredential | null> {
  const sourceConfig =
    configuredSource ??
    (await loadUpstreamSourceConfig(db, env, false));
  if (!sourceConfig || !sourceConfig.enabled) return null;
  const state = await upstreamCredentialState(db);
  if (state.managedEnabled) {
    if (!state.activeCredentialId) return null;
    const managed = await managedUpstreamProviderCredentialById(
      db,
      state.activeCredentialId,
    );
    if (!managed || managed.status !== "active" || managed.revoked_at) {
      throw new PlatformError(
        503,
        "upstream_credential_state_invalid",
        "UpstreamProvider 活动凭据状态无效，已停止上游调用。",
      );
    }
    if (managed.verified_config_hash !== sourceConfig.hash) {
      throw new PlatformError(
        503,
        "upstream_credential_reverification_required",
        "数据源路由已变化，请重新验证活动凭据。",
      );
    }
    if (
      managed.expires_at !== null &&
      (!Number.isFinite(Date.parse(managed.expires_at)) ||
        Date.parse(managed.expires_at) <= Date.now())
    ) {
      throw new PlatformError(
        503,
        "upstream_credential_expired",
        "UpstreamProvider 活动凭据已过期，已停止上游调用。",
      );
    }
    const encryptionKey = requireUpstreamProviderCredentialsEncryptionKey(env);
    return {
      secret: await decryptUpstreamProviderApiKey(
        managed.encrypted_secret,
        encryptionKey,
        managed.id,
      ),
      fingerprint: managed.secret_hash.slice(0, 16),
      source: "managed",
      id: managed.id,
      scopes: storedUpstreamProviderCredentialScopes(
        managed.verified_scopes_json,
        sourceConfig,
      ),
      expiresAt: managed.expires_at,
      stateVersion: state.version,
      configHash: sourceConfig.hash,
    };
  }
  if (!hasConfiguredCredential(env.UPSTREAM_API_KEY)) return null;
  return {
    secret: env.UPSTREAM_API_KEY,
    fingerprint: (await sha256Hex(env.UPSTREAM_API_KEY)).slice(0, 16),
    source: "environment",
    id: null,
    scopes: null,
    expiresAt: null,
    stateVersion: state.version,
    configHash: sourceConfig.hash,
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid base64url");
  }
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function platformReadiness(env: PlatformEnv) {
  const databaseConfigured = Boolean(env.DB);
  const legalReviewConfirmed = env.LEGAL_REVIEW_CONFIRMED === "true";
  const resellerAuthorized = env.RESELLER_AUTHORIZED === "true";
  const commercialClearanceConfirmed =
    env.UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED === "true";
  const upstreamConfigured = hasConfiguredCredential(env.UPSTREAM_API_KEY);
  const configurationValid = hasValidRuntimeConfiguration(env);
  const masterAdminConfigured =
    hasConfiguredAdminSecret(env.ADMIN_MASTER_SECRET);
  const catalogAdminConfigured =
    masterAdminConfigured ||
    hasConfiguredAdminSecret(env.CATALOG_SYNC_SECRET);
  const reconciliationConfigured =
    hasConfiguredAdminSecret(env.RECONCILIATION_SECRET);
  const paymentAdminConfigured =
    masterAdminConfigured ||
    hasConfiguredAdminSecret(env.PAYMENT_ADMIN_SECRET);
  const adminConfigured =
    catalogAdminConfigured &&
    reconciliationConfigured &&
    paymentAdminConfigured;
  const paymentProviderConfigured =
    (env.PAYMENT_PROVIDER ?? "nowpayments") === "nowpayments" &&
    hasConfiguredCredential(env.NOWPAYMENTS_API_KEY) &&
    hasConfiguredCredential(env.NOWPAYMENTS_IPN_SECRET);
  const googleAuthenticationConfigured =
    hasConfiguredCredential(env.GOOGLE_CLIENT_ID) &&
    hasConfiguredCredential(env.GOOGLE_CLIENT_SECRET);
  const walletAuthenticationConfigured =
    env.WALLET_LOGIN_ENABLED === "true";
  const trustedSitesIdentityConfigured =
    env.TRUST_SITES_IDENTITY_HEADERS === "true";
  const authenticationConfigured =
    googleAuthenticationConfigured ||
    walletAuthenticationConfigured ||
    trustedSitesIdentityConfigured;
  const productionAuthenticationConfigured =
    googleAuthenticationConfigured && walletAuthenticationConfigured;
  const proxyEnabled =
    databaseConfigured &&
    legalReviewConfirmed &&
    resellerAuthorized &&
    commercialClearanceConfirmed &&
    upstreamConfigured &&
    configurationValid;
  const paymentsEnabled =
    proxyEnabled &&
    productionAuthenticationConfigured &&
    env.CRYPTO_PAYMENTS_ENABLED === "true" &&
    commercialClearanceConfirmed &&
    paymentProviderConfigured;
  const missing: string[] = [];
  if (!databaseConfigured) missing.push("database");
  if (!configurationValid) missing.push("configuration");
  if (!legalReviewConfirmed) missing.push("legal_review");
  if (!resellerAuthorized) missing.push("reseller_authorization");
  if (!upstreamConfigured) missing.push("upstream_credentials");
  if (!adminConfigured) missing.push("admin_credentials");
  if (env.CRYPTO_PAYMENTS_ENABLED !== "true") {
    missing.push("crypto_payments");
  }
  if (!commercialClearanceConfirmed) {
    missing.push("commercial_clearance");
  }
  if (!paymentProviderConfigured) missing.push("payment_provider");
  if (!authenticationConfigured) missing.push("authentication");
  if (!googleAuthenticationConfigured) {
    missing.push("google_authentication");
  }
  if (!walletAuthenticationConfigured) {
    missing.push("wallet_authentication");
  }
  const ready =
    proxyEnabled &&
    paymentsEnabled &&
    adminConfigured &&
    productionAuthenticationConfigured;
  const mode = ready
    ? "live"
    : proxyEnabled || paymentsEnabled
      ? "partial"
      : "sandbox";

  return {
    ready,
    mode,
    capabilities: {
      databaseConfigured,
      configurationValid,
      legalReviewConfirmed,
      resellerAuthorized,
      commercialClearanceConfirmed,
      upstreamConfigured,
      proxyEnabled,
      paymentsEnabled,
      adminConfigured,
      masterAdminConfigured,
      catalogAdminConfigured,
      reconciliationConfigured,
      paymentAdminConfigured,
      authenticationConfigured,
      productionAuthenticationConfigured,
      googleAuthenticationConfigured,
      walletAuthenticationConfigured,
      trustedSitesIdentityConfigured,
    },
    missing,
  };
}

function hasConfiguredCredential(value?: string): value is string {
  return Boolean(value && value.trim().length > 0 && value === value.trim());
}

function hasConfiguredAdminSecret(value?: string): value is string {
  return Boolean(
    value &&
      value.length >= 32 &&
      value.length <= 512 &&
      value === value.trim(),
  );
}

function hasValidRuntimeConfiguration(env: PlatformEnv): boolean {
  if (
    parseUpstreamAllowedOrigins(env.UPSTREAM_ALLOWED_ORIGINS).size === 0
  ) {
    return false;
  }
  if (
    env.UPSTREAM_CREDENTIALS_ENCRYPTION_KEY &&
    !hasValidUpstreamProviderCredentialsEncryptionKey(
      env.UPSTREAM_CREDENTIALS_ENCRYPTION_KEY,
    )
  ) {
    return false;
  }
  const rawAppUrl = env.PUBLIC_APP_URL;
  if (!rawAppUrl) return false;
  if (rawAppUrl !== rawAppUrl.trim()) return false;
  try {
    const url = new URL(rawAppUrl);
    const localhost =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return (
      (url.protocol === "https:" || localhost) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === "" || url.pathname === "/")
    );
  } catch {
    return false;
  }
}

async function operationalReadiness(env: PlatformEnv) {
  const base = platformReadiness(env);
  let catalogReady = false;
  let schemaReady = false;
  let taxonomyReady = false;
  let reconciliationRecent = false;
  let upstreamConfigured = base.capabilities.upstreamConfigured;
  if (env.DB) {
    try {
      const row = await env.DB
        .prepare(
          `SELECT
             EXISTS(
               SELECT 1
               FROM endpoint_catalog
               WHERE enabled = 1 AND read_only = 1
                 AND price_verified = 1
                 AND ${catalogTaxonomyValidWhere("endpoint_catalog")}
                 AND safety_classification = 'safe_data_read'
                 AND safety_policy_version = ${CATALOG_SAFETY_POLICY_VERSION}
                 AND sync_generation = (
                   SELECT last_success_generation
                   FROM catalog_sync_state
                   WHERE id = 1
                 )
               LIMIT 1
             ) AS enabled_count,
             EXISTS(
               SELECT 1
               FROM catalog_sync_state
               WHERE id = 1
                 AND ${CATALOG_COVERAGE_WHERE}
             ) AS coverage_verified,
             (SELECT request_count
              FROM upstream_rate_limit_buckets LIMIT 1)
               AS upstream_rate_limit_schema,
             (SELECT request_count
              FROM payment_rate_limit_buckets LIMIT 1)
               AS payment_rate_limit_schema,
             (SELECT next_attempt_at FROM payment_events LIMIT 1)
               AS payment_events_schema,
             (SELECT generation FROM catalog_sync_locks LIMIT 1)
               AS catalog_sync_locks_schema,
             (SELECT last_success_generation
              FROM catalog_sync_state LIMIT 1)
               AS catalog_sync_state_schema,
             (SELECT credential_source
              FROM catalog_sync_state LIMIT 1)
               AS catalog_credential_source,
             (SELECT credential_id
              FROM catalog_sync_state LIMIT 1)
               AS catalog_credential_id,
             (SELECT credential_fingerprint
              FROM catalog_sync_state LIMIT 1)
               AS catalog_credential_fingerprint,
             (SELECT credential_state_version
              FROM catalog_sync_state LIMIT 1)
               AS catalog_credential_state_version,
             (SELECT source_config_version
              FROM catalog_sync_state LIMIT 1)
               AS catalog_source_config_version,
             (SELECT source_config_hash
              FROM catalog_sync_state LIMIT 1)
               AS catalog_source_config_hash,
             (SELECT openapi_operation_count
              FROM catalog_sync_state LIMIT 1)
               AS catalog_coverage_schema,
             (SELECT generation FROM catalog_sync_staging LIMIT 1)
               AS catalog_sync_staging_schema,
             (SELECT safety_classification
              FROM catalog_sync_staging LIMIT 1)
               AS catalog_staging_safety_schema,
             (SELECT data_type || tags_json || surface ||
                     COALESCE(operation_id, '')
              FROM catalog_sync_staging LIMIT 1)
               AS catalog_staging_taxonomy_schema,
             (SELECT config_hash
              FROM upstream_source_config LIMIT 1)
               AS upstream_source_config_schema,
             (SELECT path || data_type || surface
              FROM catalog_unresolved_endpoints LIMIT 1)
               AS catalog_unresolved_schema,
             (SELECT path || data_type || surface
              FROM catalog_unresolved_staging LIMIT 1)
               AS catalog_unresolved_staging_schema,
             (SELECT idempotency_hash FROM payment_orders LIMIT 1)
               AS payment_idempotency_schema,
             (SELECT upstream_cost_usd_micros FROM api_calls LIMIT 1)
               AS upstream_cost_schema,
             (SELECT sync_generation FROM endpoint_catalog LIMIT 1)
               AS sync_generation_schema,
             (SELECT http_method FROM endpoint_catalog LIMIT 1)
               AS http_method_schema,
             (SELECT price_verified FROM endpoint_catalog LIMIT 1)
               AS price_verified_schema,
             (SELECT safety_classification FROM endpoint_catalog LIMIT 1)
               AS catalog_safety_schema,
             (SELECT revision FROM endpoint_catalog LIMIT 1)
               AS catalog_revision_schema,
             (SELECT data_type || tags_json || surface ||
                     COALESCE(operation_id, '')
              FROM endpoint_catalog LIMIT 1)
               AS catalog_taxonomy_schema,
             (SELECT target_digest FROM catalog_batch_plans LIMIT 1)
               AS catalog_batch_plans_schema,
             (SELECT expected_revision
              FROM catalog_batch_plan_items LIMIT 1)
               AS catalog_batch_items_schema,
             (SELECT data_type || tags_json || surface ||
                     COALESCE(operation_id, '')
              FROM catalog_batch_plan_items LIMIT 1)
               AS catalog_batch_items_taxonomy_schema,
             (SELECT provider FROM auth_identities LIMIT 1)
               AS auth_identities_schema,
             (SELECT provider FROM auth_sessions LIMIT 1)
               AS auth_sessions_schema,
             (SELECT provider FROM auth_challenges LIMIT 1)
               AS auth_challenges_schema,
             (SELECT request_count FROM auth_rate_limit_buckets LIMIT 1)
               AS auth_rate_limit_schema,
             (SELECT resolution_request_hash
              FROM payment_review_cases LIMIT 1)
               AS payment_review_request_schema,
             (SELECT resolution_credit_usd_micros
              FROM payment_review_cases LIMIT 1)
               AS payment_review_credit_schema,
             (SELECT id FROM admin_audit_logs LIMIT 1)
               AS admin_audit_schema,
             (SELECT secret_hash FROM upstream_credentials LIMIT 1)
               AS upstream_credentials_schema,
             (SELECT managed_enabled
              FROM upstream_credential_state LIMIT 1)
               AS upstream_credential_state_schema,
             EXISTS(
               SELECT 1
               FROM operation_heartbeats
               WHERE name = 'reconciliation'
                 AND datetime(last_success_at) >
                     datetime('now', '-5 minutes')
             ) AS reconciliation_recent`,
        )
        .first<{
          enabled_count: number;
          coverage_verified: number;
          reconciliation_recent: number;
          catalog_credential_source: string | null;
          catalog_credential_id: string | null;
          catalog_credential_fingerprint: string | null;
          catalog_credential_state_version: number | null;
          catalog_source_config_version: number | null;
          catalog_source_config_hash: string | null;
        }>();
      schemaReady = row != null;
      try {
        await assertStoredCatalogTaxonomyIntegrity(env.DB);
        taxonomyReady = true;
      } catch {
        taxonomyReady = false;
      }
      reconciliationRecent =
        Number(row?.reconciliation_recent ?? 0) === 1;
      try {
        const sourceConfig = await loadUpstreamSourceConfig(
          env.DB,
          env,
          false,
        );
        const resolved = sourceConfig
          ? await resolveUpstreamProviderCredential(
              env,
              env.DB,
              sourceConfig,
            )
          : null;
        upstreamConfigured = Boolean(resolved);
        catalogReady =
          taxonomyReady &&
          resolved != null &&
          Number(row?.enabled_count ?? 0) > 0 &&
          Number(row?.coverage_verified ?? 0) === 1 &&
          row?.catalog_credential_source === resolved.source &&
          row.catalog_credential_id === resolved.id &&
          row.catalog_credential_fingerprint === resolved.fingerprint &&
          Number(row.catalog_credential_state_version) ===
            resolved.stateVersion &&
          Number(row.catalog_source_config_version) ===
            sourceConfig?.version &&
          row.catalog_source_config_hash === sourceConfig?.hash;
      } catch {
        upstreamConfigured = false;
        catalogReady = false;
      }
    } catch {
      schemaReady = false;
      taxonomyReady = false;
      catalogReady = false;
      reconciliationRecent = false;
      upstreamConfigured = false;
    }
  }
  const proxyEnabled =
    base.capabilities.databaseConfigured &&
    base.capabilities.configurationValid &&
    base.capabilities.legalReviewConfirmed &&
    base.capabilities.resellerAuthorized &&
    base.capabilities.commercialClearanceConfirmed &&
    upstreamConfigured;
  const paymentsEnabled =
    proxyEnabled &&
    base.capabilities.productionAuthenticationConfigured &&
    env.CRYPTO_PAYMENTS_ENABLED === "true" &&
    base.capabilities.commercialClearanceConfirmed &&
    (env.PAYMENT_PROVIDER ?? "nowpayments") === "nowpayments" &&
    hasConfiguredCredential(env.NOWPAYMENTS_API_KEY) &&
    hasConfiguredCredential(env.NOWPAYMENTS_IPN_SECRET) &&
    base.capabilities.adminConfigured &&
    schemaReady &&
    catalogReady &&
    reconciliationRecent;
  const ready =
    proxyEnabled &&
    paymentsEnabled &&
    base.capabilities.adminConfigured &&
    base.capabilities.productionAuthenticationConfigured &&
    schemaReady &&
    catalogReady &&
    reconciliationRecent;
  const missing = base.missing.filter(
    (item) => item !== "upstream_credentials",
  );
  if (!upstreamConfigured) missing.push("upstream_credentials");
  if (!schemaReady) missing.push("database_migrations");
  if (schemaReady && !taxonomyReady) missing.push("catalog_taxonomy");
  if (!catalogReady) missing.push("enabled_catalog");
  if (!reconciliationRecent) missing.push("scheduled_reconciliation");
  const mode = ready
    ? "live"
    : proxyEnabled
      ? "partial"
      : "sandbox";

  return {
    ready,
    mode,
    capabilities: {
      ...base.capabilities,
      upstreamConfigured,
      proxyEnabled,
      schemaReady,
      taxonomyReady,
      catalogReady,
      reconciliationRecent,
      paymentsEnabled,
    },
    missing,
  };
}

function requireIdempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) {
    throw new PlatformError(
      400,
      "invalid_idempotency_key",
      "Idempotency-Key 必须是 8–128 个字母、数字、点、下划线、冒号或连字符。",
    );
  }
  return value;
}

async function paymentOrderByIdempotency(
  db: D1Database,
  userId: string,
  idempotencyHash: string,
): Promise<PaymentOrderRecord | null> {
  return db
    .prepare(
      `SELECT id, user_id, provider_payment_id, idempotency_hash,
              amount_usd_micros, pay_currency, pay_amount, pay_address,
              invoice_url, status, credited_usd_micros, created_at, updated_at
       FROM payment_orders
       WHERE user_id = ? AND idempotency_hash = ?`,
    )
    .bind(userId, idempotencyHash)
    .first<PaymentOrderRecord>();
}

async function paymentOrderById(
  db: D1Database,
  orderId: string,
  userId?: string,
): Promise<PaymentOrderRecord | null> {
  const statement = userId
    ? db
        .prepare(
          `SELECT id, user_id, provider_payment_id, idempotency_hash,
                  amount_usd_micros, pay_currency, pay_amount, pay_address,
                  invoice_url, status, credited_usd_micros, created_at, updated_at
           FROM payment_orders
           WHERE id = ? AND user_id = ? AND provider = 'nowpayments'`,
        )
        .bind(orderId, userId)
    : db
        .prepare(
          `SELECT id, user_id, provider_payment_id, idempotency_hash,
                  amount_usd_micros, pay_currency, pay_amount, pay_address,
                  invoice_url, status, credited_usd_micros, created_at, updated_at
           FROM payment_orders
           WHERE id = ? AND provider = 'nowpayments'`,
        )
        .bind(orderId);
  return statement.first<PaymentOrderRecord>();
}

function paymentOrderResponse(
  order: PaymentOrderRecord,
  status: number,
  requestId: string,
): Response {
  if (
    order.provider_payment_id == null &&
    (order.status === "creating" || order.status === "provider_error")
  ) {
    throw new PlatformError(
      409,
      "payment_creation_pending",
      "充值单创建结果尚未确认。请保留同一 Idempotency-Key，等待对账后重试。",
    );
  }
  return jsonResponse(
    {
      payment: {
        id: order.id,
        providerPaymentId: order.provider_payment_id,
        status: order.status,
        amountUsdMicros: order.amount_usd_micros,
        creditedUsdMicros: order.credited_usd_micros,
        payAddress: order.pay_address,
        payAmount: order.pay_amount,
        payCurrency: order.pay_currency,
        invoiceUrl: safeInvoiceUrl(order.invoice_url),
        createdAt: order.created_at,
        updatedAt: order.updated_at,
      },
    },
    status,
    requestId,
  );
}

async function consumePaymentCreateRateLimit(
  db: D1Database,
  userId: string,
  env: PlatformEnv,
): Promise<void> {
  const minuteBucket = new Date().toISOString().slice(0, 16);
  const limits = [
    {
      scope: `user:${userId}`,
      limit: clampInteger(env.PAYMENT_CREATE_LIMIT_PER_MINUTE, 3, 1, 20),
      message: "充值单创建过于频繁，请一分钟后重试。",
    },
    {
      scope: "provider:nowpayments",
      limit: clampInteger(env.PAYMENT_PROVIDER_LIMIT_PER_MINUTE, 60, 1, 180),
      message: "支付通道当前繁忙，请一分钟后重试。",
    },
  ];
  for (const item of limits) {
    const slot = await db
      .prepare(
        `INSERT INTO payment_rate_limit_buckets
         (scope, minute_bucket, request_count, updated_at)
         VALUES (?, ?, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(scope, minute_bucket) DO UPDATE SET
           request_count = payment_rate_limit_buckets.request_count + 1,
           updated_at = CURRENT_TIMESTAMP
         WHERE payment_rate_limit_buckets.request_count < ?
         RETURNING request_count`,
      )
      .bind(item.scope, minuteBucket, item.limit)
      .first<{ request_count: number }>();
    if (!slot) {
      throw new PlatformError(
        429,
        "payment_rate_limit_exceeded",
        item.message,
      );
    }
  }
}

function normalizedPositiveDecimal(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (text.length === 0 || text.length > 80) return null;
  const scaled = decimalToScaledInteger(text, 18);
  if (scaled == null || scaled <= BigInt(0)) return null;
  return text;
}

function safeInvoiceUrl(value: string | null): string | null {
  if (!value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      (url.hostname !== "nowpayments.io" &&
        !url.hostname.endsWith(".nowpayments.io"))
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function readResponseJson(
  response: Response,
  limit: number,
  errorCode: string,
): Promise<unknown> {
  const text = await readResponseText(response, limit, errorCode);
  return parseResponseJson(text, errorCode);
}

async function readResponseJsonSnapshot(
  response: Response,
  limit: number,
  errorCode: string,
): Promise<{ payload: unknown; snapshotHash: string }> {
  const text = await readResponseText(response, limit, errorCode);
  return {
    payload: parseResponseJson(text, errorCode),
    snapshotHash: await sha256Hex(text),
  };
}

function parseResponseJson(text: string, errorCode: string): unknown {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isPlainRecord(parsed) && !Array.isArray(parsed)) {
      throw new Error("response must be an object or array");
    }
    if (containsUnsafeJsonNumber(parsed)) {
      throw new Error("response contains unsafe numbers");
    }
    return parsed;
  } catch {
    throw new PlatformError(
      502,
      errorCode,
      "外部服务返回了无法识别的数据。",
    );
  }
}

async function readResponseText(
  response: Response,
  limit: number,
  errorCode: string,
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > limit) {
    response.body?.cancel("response too large").catch(() => undefined);
    throw new PlatformError(502, errorCode, "外部服务响应超过安全上限。");
  }
  if (!response.body) {
    throw new PlatformError(502, errorCode, "外部服务返回了空响应。");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("response too large");
        throw new PlatformError(
          502,
          errorCode,
          "外部服务响应超过安全上限。",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function logSourceFetchFailure(
  stage: "catalog" | "openapi",
  error: unknown,
  configuredOrigin: string,
  requestId: string,
): void {
  const name =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)
      ? error.name
      : "UnknownError";
  const rawMessage =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "No runtime error message";
  const message = rawMessage
    .split(configuredOrigin)
    .join("[configured-origin]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .slice(0, 240);
  console.error("RelayBase source fetch failed", {
    requestId,
    stage,
    name,
    message,
  });
}

async function providerNeutralUpstreamErrorMessage(
  response: Response,
): Promise<string> {
  try {
    await response.body?.cancel(
      "provider error body is not exposed to customers",
    );
  } catch {
    // The public response remains provider-neutral even if cancellation fails.
  }
  if (response.status === 404) {
    return "数据服务未找到请求的资源，本次未扣费。";
  }
  if (response.status === 429) {
    return "数据服务当前请求过多，请稍后重试；本次未扣费。";
  }
  if (response.status === 401 || response.status === 403) {
    return "数据服务暂时无法完成授权校验，本次未扣费。";
  }
  return "数据服务请求未成功，本次未扣费。";
}

function upstreamErrorResponse(
  status: number,
  message: string,
  requestId: string,
  headers: Headers,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.delete("etag");
  responseHeaders.delete("last-modified");
  responseHeaders.delete("content-type");
  return jsonResponse(
    {
      error: {
        code: "upstream_error",
        message,
        requestId,
        upstreamStatus: status,
      },
    },
    status,
    requestId,
    responseHeaders,
  );
}

async function requireAuthenticatedUser(
  request: Request,
  db: D1Database,
  env: PlatformEnv,
): Promise<AuthenticatedUser> {
  const sessionToken = cookieValue(request, SESSION_COOKIE);
  if (
    sessionToken &&
    /^[A-Za-z0-9_-]{32,160}$/.test(sessionToken)
  ) {
    const tokenHash = await sha256Hex(sessionToken);
    const session = await db
      .prepare(
        `SELECT u.id, u.email, u.display_name, u.status,
                s.provider, s.last_seen_at, ai.wallet_address
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN auth_identities ai
           ON ai.user_id = s.user_id AND ai.provider = s.provider
         WHERE s.token_hash = ?
           AND datetime(s.expires_at) > datetime('now')
         LIMIT 1`,
      )
      .bind(tokenHash)
      .first<{
        id: string;
        email: string;
        display_name: string | null;
        status: string;
        provider: string;
        last_seen_at: string;
        wallet_address: string | null;
      }>();
    if (session) {
      if (session.status !== "active") {
        throw new PlatformError(403, "account_suspended", "账户当前不可用。");
      }
      if (session.provider !== "google" && session.provider !== "wallet") {
        throw new PlatformError(
          401,
          "authentication_required",
          "登录会话无效，请重新登录。",
        );
      }
      if (
        Date.parse(session.last_seen_at) <
        Date.now() - 15 * 60_000
      ) {
        await db
          .prepare(
            `UPDATE auth_sessions
             SET last_seen_at = CURRENT_TIMESTAMP
             WHERE token_hash = ?
               AND datetime(last_seen_at) <
                   datetime('now', '-15 minutes')`,
          )
          .bind(tokenHash)
          .run();
      }
      return {
        id: session.id,
        email: session.email,
        displayName: session.display_name ?? session.email,
        provider: session.provider,
        walletAddress: session.wallet_address,
      };
    }
  }

  if (env.TRUST_SITES_IDENTITY_HEADERS !== "true") {
    throw new PlatformError(
      401,
      "authentication_required",
      "请先登录后再使用控制台。",
    );
  }
  const email = request.headers
    .get(USER_EMAIL_HEADER)
    ?.trim()
    .toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new PlatformError(
      401,
      "authentication_required",
      "请先登录后再使用控制台。",
    );
  }

  const encodedName = request.headers.get(USER_NAME_HEADER);
  const displayName =
    encodedName &&
    request.headers.get(USER_NAME_ENCODING_HEADER) === "percent-encoded-utf-8"
      ? safeDecodeURIComponent(encodedName) ?? email
      : email;
  const id = `usr_${(await sha256Hex(email)).slice(0, 24)}`;

  let stored = await db
    .prepare(
      `SELECT id, email, display_name
       FROM users
       WHERE email = ? AND status = 'active'`,
    )
    .bind(email)
    .first<{ id: string; email: string; display_name: string | null }>();
  if (!stored) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO users
         (id, email, display_name, status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(id, email, displayName)
      .run();
    stored = await db
      .prepare(
        `SELECT id, email, display_name
         FROM users
         WHERE email = ? AND status = 'active'`,
      )
      .bind(email)
      .first<{ id: string; email: string; display_name: string | null }>();
  } else if (stored.display_name !== displayName) {
    await db
      .prepare(
        `UPDATE users
         SET display_name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND display_name IS NOT ?`,
      )
      .bind(displayName, stored.id, displayName)
      .run();
    stored = { ...stored, display_name: displayName };
  }
  if (!stored) {
    throw new PlatformError(403, "account_suspended", "账户当前不可用。");
  }

  return {
    id: stored.id,
    email: stored.email,
    displayName: stored.display_name ?? stored.email,
    provider: "chatgpt",
    walletAddress: null,
  };
}

async function refundRequest(
  db: D1Database,
  userId: string,
  ledgerReferenceId: string,
  costUsdMicros: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id, description, created_at)
       VALUES (?, ?, 'api_refund', ?, ?, 'API request refund', ?)`,
    )
    .bind(
      `led_${randomBase64Url(16)}`,
      userId,
      costUsdMicros,
      `${ledgerReferenceId}:refund`,
      new Date().toISOString(),
    )
    .run();
}

async function markProxyRequest(
  db: D1Database,
  requestId: string,
  status: string,
  responseStatus: number | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE proxy_requests
       SET status = ?, response_status = ?,
           completed_at = CASE
             WHEN ? IN ('completed', 'refunded', 'reconciled', 'rate_limited', 'insufficient_balance')
             THEN CURRENT_TIMESTAMP
             ELSE completed_at
           END
       WHERE id = ?`,
    )
    .bind(status, responseStatus, status, requestId)
    .run();
}

async function logApiCall(
  db: D1Database,
  input: {
    requestId: string;
    key: ApiKeyRecord;
    method: string;
    path: string;
    platform: string;
    statusCode: number;
    costUsdMicros: number;
    upstreamCostUsdMicros: number;
    latencyMs: number;
    refunded: boolean;
  },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO api_calls
         (id, user_id, api_key_id, method, upstream_path, platform,
          status_code, cost_usd_micros, upstream_cost_usd_micros,
          latency_ms, refunded, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(
        input.requestId,
        input.key.user_id,
        input.key.id,
        input.method,
        input.path,
        input.platform,
        input.statusCode,
        input.costUsdMicros,
        input.upstreamCostUsdMicros,
        input.latencyMs,
        input.refunded ? 1 : 0,
      ),
    db
      .prepare(
        `UPDATE api_keys
         SET last_used_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(input.key.id),
    db
      .prepare(
        `UPDATE proxy_requests
         SET status = ?, response_status = ?, completed_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status != 'reconciled'`,
      )
      .bind(
        input.refunded ? "refunded" : "completed",
        input.statusCode,
        input.requestId,
      ),
  ]);
}

async function currentBalance(
  db: D1Database,
  userId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
       FROM balance_ledger
       WHERE user_id = ?`,
    )
    .bind(userId)
    .first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}

type CatalogSyncEntry = {
  path: string;
  platform: string;
  httpMethod: "GET" | "POST";
  dataType: CatalogDataType;
  tags: string[];
  surface: MarketplaceSurface;
  operationId: string | null;
  summary: string | null;
  description: string | null;
  parameterSchemaJson: string | null;
  upstreamPriceUsdMicros: number;
  priceVerified: boolean;
  looksReadOnly: boolean;
  safetyClassification: CatalogSafetyClassification;
  safetyReasons: string[];
  safetyPolicyVersion: number;
};

type CatalogPriceEntry = {
  path: string;
  httpMethod: "GET" | "POST" | null;
  upstreamPriceUsdMicros: number;
  rateLimitRaw: string | null;
  rateLimitRps: number | null;
  freeCredit: boolean | null;
  volumeDiscount: boolean | null;
  sourceType: string | null;
  sourceOwner: string | null;
};

type CatalogUnresolvedSyncEntry = CatalogPriceEntry & {
  platform: string;
  dataType: CatalogDataType;
  surface: MarketplaceSurface;
  summary: string;
};

function catalogBooleanFlag(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}

function catalogRateLimit(value: unknown): {
  raw: string | null;
  rps: number | null;
} {
  if (typeof value !== "string" && typeof value !== "number") {
    return { raw: null, rps: null };
  }
  const raw = String(value).replace(/\s+/g, "").trim().slice(0, 80);
  const match = raw.match(/^([1-9]\d{0,6})(?:\/(?:s|sec|second))?$/i);
  const rps = match ? Number(match[1]) : null;
  return {
    raw: raw || null,
    rps:
      rps != null && Number.isSafeInteger(rps) && rps <= 1_000_000
        ? rps
        : null,
  };
}

function extractCatalogPrices(
  payload: unknown,
  apiPathPrefix = "/api",
): {
  entries: CatalogPriceEntry[];
  rawRecordCount: number;
} {
  if (
    isPlainRecord(payload) &&
    Object.hasOwn(payload, "code") &&
    payload.code !== 200 &&
    payload.code !== "200"
  ) {
    throw new PlatformError(
      502,
      "catalog_price_response_failed",
      "UpstreamProvider 价格目录返回非成功业务状态，本次同步已停止。",
    );
  }
  const byPath = new Map<string, CatalogPriceEntry>();
  let rawRecordCount = 0;

  const parseRecord = (
    record: Record<string, unknown>,
    strictOfficialShape: boolean,
  ): void => {
    const rawPath = firstString(
      record,
      strictOfficialShape
        ? ["endpoint_uri"]
        : ["endpoint_uri", "path", "endpoint", "api_path", "url", "route"],
    );
    const price = firstCatalogPriceUsdMicros(
      record,
      strictOfficialShape
        ? ["endpoint_cost"]
        : [
            "endpoint_cost",
            "price",
            "cost",
            "price_per_request",
            "unit_price",
            "base_price",
          ],
    );
    if (
      strictOfficialShape &&
      (!rawPath ||
        !Object.hasOwn(record, "endpoint_uri") ||
        !Object.hasOwn(record, "endpoint_cost"))
    ) {
      throw new PlatformError(
        502,
        "catalog_price_schema_invalid",
        "UpstreamProvider 正式价格目录记录缺少 endpoint_uri 或 endpoint_cost。",
      );
    }
    if (rawPath && price.present && price.usdMicros == null) {
      throw new PlatformError(
        502,
        "catalog_price_value_invalid",
        "UpstreamProvider 价格目录包含无法精确表示的成本，本次同步已停止。",
      );
    }
    if (rawPath && price.usdMicros != null) {
      rawRecordCount += 1;
      try {
        const path = normalizeCatalogPath(rawPath, apiPathPrefix);
        const rawMethod = firstString(record, [
          "method",
          "http_method",
          "httpMethod",
        ])?.toUpperCase();
        if (
          rawMethod != null &&
          rawMethod !== "GET" &&
          rawMethod !== "POST"
        ) {
          throw new PlatformError(
            502,
            "catalog_price_method_invalid",
            "UpstreamProvider 价格目录包含不受支持的显式请求方法，本次同步已停止。",
          );
        }
        const httpMethod: CatalogPriceEntry["httpMethod"] =
          rawMethod === "GET" || rawMethod === "POST"
            ? rawMethod
            : null;
        const rateLimit = catalogRateLimit(record.rate_limit);
        const candidate = {
          path,
          httpMethod,
          upstreamPriceUsdMicros: price.usdMicros,
          rateLimitRaw: rateLimit.raw,
          rateLimitRps: rateLimit.rps,
          freeCredit: catalogBooleanFlag(record.allow_free_credit),
          volumeDiscount: catalogBooleanFlag(record.allow_discount),
          sourceType: compactCatalogText(record.endpoint_type, 120),
          sourceOwner: compactCatalogText(record.endpoint_owner, 160),
        };
        const existing = byPath.get(path);
        if (
          existing &&
          (existing.upstreamPriceUsdMicros !==
            candidate.upstreamPriceUsdMicros ||
            (existing.httpMethod != null &&
              candidate.httpMethod != null &&
              existing.httpMethod !== candidate.httpMethod))
        ) {
          throw new PlatformError(
            502,
            "catalog_price_conflict",
            "UpstreamProvider 价格目录包含相互冲突的重复端点，本次同步已停止。",
          );
        }
        byPath.set(
          path,
          existing
            ? {
                ...existing,
                httpMethod: existing.httpMethod ?? candidate.httpMethod,
                rateLimitRaw:
                  existing.rateLimitRaw === candidate.rateLimitRaw
                    ? existing.rateLimitRaw
                    : null,
                rateLimitRps:
                  existing.rateLimitRps === candidate.rateLimitRps
                    ? existing.rateLimitRps
                    : null,
                freeCredit:
                  existing.freeCredit === candidate.freeCredit
                    ? existing.freeCredit
                    : null,
                volumeDiscount:
                  existing.volumeDiscount === candidate.volumeDiscount
                    ? existing.volumeDiscount
                    : null,
                sourceType:
                  existing.sourceType === candidate.sourceType
                    ? existing.sourceType
                    : null,
                sourceOwner:
                  existing.sourceOwner === candidate.sourceOwner
                    ? existing.sourceOwner
                    : null,
              }
            : candidate,
        );
      } catch (error) {
        if (
          error instanceof PlatformError &&
          (error.code === "catalog_price_conflict" ||
            error.code === "catalog_price_method_invalid" ||
            error.code === "catalog_price_value_invalid" ||
            error.code === "catalog_price_schema_invalid")
        ) {
          throw error;
        }
        if (strictOfficialShape) {
          throw new PlatformError(
            502,
            "catalog_price_schema_invalid",
            "UpstreamProvider 正式价格目录包含无效端点路径，本次同步已停止。",
          );
        }
        // Ignore non-endpoint URLs and malformed catalog records.
      }
    }
  };

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isPlainRecord(value)) return;
    parseRecord(value, false);
    for (const nested of Object.values(value)) visit(nested);
  };

  const officialRecords =
    isPlainRecord(payload) &&
    Array.isArray(payload.data) &&
    payload.data.some(
      (item) =>
        isPlainRecord(item) &&
        (Object.hasOwn(item, "endpoint_uri") ||
          Object.hasOwn(item, "endpoint_cost")),
    )
      ? payload.data
      : null;
  if (officialRecords) {
    for (const item of officialRecords) {
      if (!isPlainRecord(item)) {
        throw new PlatformError(
          502,
          "catalog_price_schema_invalid",
          "UpstreamProvider 正式价格目录包含非对象记录，本次同步已停止。",
        );
      }
      parseRecord(item, true);
    }
  } else {
    visit(payload);
  }
  return {
    entries: [...byPath.values()],
    rawRecordCount,
  };
}

function extractOpenApiVersion(payload: unknown): string | null {
  if (
    !isPlainRecord(payload) ||
    !isPlainRecord(payload.info) ||
    typeof payload.info.version !== "string"
  ) {
    return null;
  }
  return compactCatalogText(payload.info.version, 80);
}

function redactedCatalogExample(fieldName?: string): string {
  const canonical = fieldName
    ? canonicalCatalogInputField(fieldName)
    : "";
  return canonical
    ? `YOUR_${canonical.toUpperCase().slice(0, 48)}`
    : "[REDACTED]";
}

function looksSensitiveCatalogExample(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value) ||
    /(?:Bearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{20,}|rb_live_[A-Za-z0-9_-]{16,})/i.test(
      value,
    ) ||
    /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(
      value,
    )
  );
}

function redactSensitiveCatalogText(value: string): string {
  const placeholder = (field: string) => redactedCatalogExample(field);
  return value
    .replace(
      /(["'])([A-Za-z][A-Za-z0-9_.\-/]{0,80})\1(\s*[:=]\s*)(["'])([^\r\n]*?)\4/g,
      (
        match: string,
        keyQuote: string,
        field: string,
        separator: string,
        valueQuote: string,
      ) =>
        catalogInputFieldRisk(field) != null
          ? `${keyQuote}${field}${keyQuote}${separator}${valueQuote}${placeholder(field)}${valueQuote}`
          : match,
    )
    .replace(
      /(^|[^A-Za-z0-9_])([A-Za-z][A-Za-z0-9_.\-/]{0,80})(\s*[:=]\s*)(["'])([^\r\n]*?)\4/gm,
      (
        match: string,
        prefix: string,
        field: string,
        separator: string,
        quote: string,
      ) =>
        catalogInputFieldRisk(field) != null
          ? `${prefix}${field}${separator}${quote}${placeholder(field)}${quote}`
          : match,
    )
    .replace(
      /(^|[^A-Za-z0-9_])(["']?)([A-Za-z][A-Za-z0-9_.\-/]{0,80})\2(\s*[:=]\s*)(?!["'])([^\r\n]+)/gm,
      (
        match: string,
        prefix: string,
        keyQuote: string,
        field: string,
        separator: string,
      ) =>
        catalogInputFieldRisk(field) != null
          ? `${prefix}${keyQuote}${field}${keyQuote}${separator}${placeholder(field)}`
          : match,
    )
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
      "[REDACTED_PRIVATE_KEY]",
    )
    .replace(
      /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/gi,
      "Bearer [REDACTED]",
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      "[REDACTED_JWT]",
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{20,}|rb_live_[A-Za-z0-9_-]{16,})\b/gi,
      "[REDACTED_TOKEN]",
    );
}

function stripUpstreamCatalogExamples(value: string): string {
  const output: string[] = [];
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  let skippedHeadingLevel: number | null = null;
  let insideFence = false;
  let insertedNotice = false;
  const insertNotice = (): void => {
    if (!insertedNotice) {
      output.push(
        "上游原始示例已移除；请使用 RelayBase 生成的安全调用示例。",
      );
      insertedNotice = true;
    }
  };

  for (const line of lines) {
    const heading = line.match(
      /^\s{0,4}(#{1,6})\s*(.*?)\s*#*\s*$/,
    );
    if (skippedHeadingLevel != null) {
      if (heading && heading[1].length <= skippedHeadingLevel) {
        skippedHeadingLevel = null;
      } else {
        continue;
      }
    }
    if (
      heading &&
      /(?:示例|例子|\bexamples?\b)/iu.test(heading[2])
    ) {
      insertNotice();
      skippedHeadingLevel = heading[1].length;
      continue;
    }
    if (/^\s*(?:```|~~~)/.test(line)) {
      if (!insideFence) insertNotice();
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;
    output.push(line);
  }
  return output.join("\n").trim();
}

function publicCatalogDescription(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  return compactCatalogText(
    redactSensitiveCatalogText(stripUpstreamCatalogExamples(value)),
    maxLength,
  );
}

function redactCatalogExampleAgainstSchema(
  value: unknown,
  schema: unknown,
  fieldName?: string,
  depth = 0,
): unknown {
  if (
    (fieldName && catalogInputFieldRisk(fieldName) != null) ||
    looksSensitiveCatalogExample(value)
  ) {
    return redactedCatalogExample(fieldName);
  }
  if (depth > 32) return "[REDACTED]";
  if (Array.isArray(value)) {
    const itemSchema =
      isPlainRecord(schema) && isPlainRecord(schema.items)
        ? schema.items
        : null;
    return value.map((item) =>
      redactCatalogExampleAgainstSchema(
        item,
        itemSchema,
        fieldName,
        depth + 1,
      ),
    );
  }
  if (typeof value === "string") return redactSensitiveCatalogText(value);
  if (!isPlainRecord(value)) return value;
  const properties =
    isPlainRecord(schema) && isPlainRecord(schema.properties)
      ? schema.properties
      : null;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      redactCatalogExampleAgainstSchema(
        child,
        properties?.[key],
        key,
        depth + 1,
      ),
    ]),
  );
}

function redactUnknownCatalogExample(
  value: unknown,
  fieldName?: string,
  depth = 0,
): unknown {
  if (
    (fieldName && catalogInputFieldRisk(fieldName) != null) ||
    looksSensitiveCatalogExample(value)
  ) {
    return redactedCatalogExample(fieldName);
  }
  if (depth > 32) return "[REDACTED]";
  if (Array.isArray(value)) {
    return value.map((item) =>
      redactUnknownCatalogExample(item, fieldName, depth + 1),
    );
  }
  if (typeof value === "string") return redactSensitiveCatalogText(value);
  if (!isPlainRecord(value)) return value;
  const exampleObject =
    Object.hasOwn(value, "value") &&
    Object.keys(value).every((key) =>
      ["summary", "description", "value", "externalValue"].includes(key),
    );
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (
        exampleObject &&
        (key === "summary" ||
          key === "description" ||
          key === "externalValue")
      ) {
        return [
          key,
          typeof child === "string"
            ? redactSensitiveCatalogText(child)
            : "[REDACTED_INVALID_EXAMPLE_METADATA]",
        ];
      }
      return [
        key,
        redactUnknownCatalogExample(
          child,
          exampleObject && key === "value" ? fieldName : key,
          depth + 1,
        ),
      ];
    }),
  );
}

function redactCatalogInputMetadata(
  value: unknown,
  fieldName?: string,
  depth = 0,
): unknown {
  if (depth > 64) return value;
  if (Array.isArray(value)) {
    return value.map((item) =>
      redactCatalogInputMetadata(item, fieldName, depth + 1),
    );
  }
  if (typeof value === "string") return redactSensitiveCatalogText(value);
  if (!isPlainRecord(value)) return value;
  const declaredName =
    typeof value.name === "string" &&
    catalogInputFieldRisk(value.name) != null
      ? value.name
      : fieldName;
  const schema = isPlainRecord(value.schema) ? value.schema : null;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === "description" && typeof child === "string") {
        return [
          key,
          publicCatalogDescription(child, 2_000),
        ];
      }
      if ((key === "example" || key === "default") && schema) {
        return [
          key,
          redactCatalogExampleAgainstSchema(
            child,
            schema,
            declaredName,
          ),
        ];
      }
      if (
        key === "example" ||
        key === "examples" ||
        key === "default"
      ) {
        return [
          key,
          redactUnknownCatalogExample(child, declaredName),
        ];
      }
      if (key === "properties" && isPlainRecord(child)) {
        return [
          key,
          Object.fromEntries(
            Object.entries(child).map(([propertyName, propertySchema]) => [
              propertyName,
              redactCatalogInputMetadata(
                propertySchema,
                propertyName,
                depth + 1,
              ),
            ]),
          ),
        ];
      }
      return [
        key,
        redactCatalogInputMetadata(child, declaredName, depth + 1),
      ];
    }),
  );
}

function resolveOpenApiInputReferences(
  document: Record<string, unknown>,
  value: unknown,
): unknown {
  let visitedNodes = 0;
  let expandedBytes = 0;
  let referenceCount = 0;
  const activeReferences = new Set<string>();
  const encoder = new TextEncoder();

  class ReferenceBudgetError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  }

  const addBytes = (value: string): void => {
    const bytes = encoder.encode(value).byteLength;
    if (bytes > MAX_OPENAPI_REFERENCE_STRING_BYTES) {
      throw new ReferenceBudgetError("string_limit");
    }
    expandedBytes += bytes;
    if (expandedBytes > MAX_OPENAPI_REFERENCE_BYTES) {
      throw new ReferenceBudgetError("byte_limit");
    }
  };

  const unresolvedReference = (
    reference: string,
    reason: string,
  ): Record<string, string> => ({
    $ref: reference.slice(0, 512),
    "x-relaybase-unresolved": reason,
  });

  const resolvePointer = (reference: string): unknown => {
    if (
      !reference.startsWith("#/components/") ||
      reference.length > 512
    ) {
      return undefined;
    }
    let current: unknown = document;
    for (const rawSegment of reference.slice(2).split("/")) {
      const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
      if (
        !segment ||
        segment.length > 200 ||
        segment === "__proto__" ||
        segment === "prototype" ||
        segment === "constructor" ||
        !isPlainRecord(current) ||
        !Object.hasOwn(current, segment)
      ) {
        return undefined;
      }
      current = current[segment];
    }
    return current;
  };

  const visit = (input: unknown, depth: number): unknown => {
    visitedNodes += 1;
    if (visitedNodes > MAX_OPENAPI_REFERENCE_NODES) {
      throw new ReferenceBudgetError("node_limit");
    }
    if (depth > MAX_OPENAPI_REFERENCE_DEPTH) {
      throw new ReferenceBudgetError("depth_limit");
    }
    if (Array.isArray(input)) {
      if (input.length > MAX_OPENAPI_REFERENCE_ITEMS) {
        throw new ReferenceBudgetError("array_limit");
      }
      return input.map((item) => visit(item, depth + 1));
    }
    if (typeof input === "string") {
      addBytes(input);
      return input;
    }
    if (!isPlainRecord(input)) {
      expandedBytes += 8;
      if (expandedBytes > MAX_OPENAPI_REFERENCE_BYTES) {
        throw new ReferenceBudgetError("byte_limit");
      }
      return input;
    }
    const entries = Object.entries(input);
    if (entries.length > MAX_OPENAPI_REFERENCE_ITEMS) {
      throw new ReferenceBudgetError("object_limit");
    }
    for (const [key] of entries) addBytes(key);

    const reference =
      typeof input.$ref === "string" ? input.$ref.trim() : null;
    if (reference) {
      referenceCount += 1;
      if (referenceCount > MAX_OPENAPI_REFERENCES) {
        throw new ReferenceBudgetError("reference_limit");
      }
      if (activeReferences.has(reference)) {
        return unresolvedReference(reference, "reference_cycle");
      }
      const target = resolvePointer(reference);
      if (target === undefined) {
        return unresolvedReference(reference, "reference_not_allowed");
      }
      activeReferences.add(reference);
      const resolvedTarget = visit(target, depth + 1);
      activeReferences.delete(reference);
      if (!isPlainRecord(resolvedTarget)) {
        return unresolvedReference(reference, "reference_not_object");
      }
      const siblings = Object.fromEntries(
        Object.entries(input)
          .filter(([key]) => key !== "$ref")
          .map(([key, child]) => [key, visit(child, depth + 1)]),
      );
      return { ...resolvedTarget, ...siblings };
    }

    return Object.fromEntries(
      entries.map(([key, child]) => [
        key,
        visit(child, depth + 1),
      ]),
    );
  };

  try {
    return visit(value, 0);
  } catch (error) {
    if (error instanceof ReferenceBudgetError) {
      return unresolvedReference(
        "#/components/relaybase/input-budget",
        error.reason,
      );
    }
    throw error;
  }
}

function normalizeCatalogOperationTags(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new PlatformError(
      502,
      "catalog_openapi_taxonomy_invalid",
      "UpstreamProvider OpenAPI 的 operation tags 无效，本次同步已停止。",
    );
  }
  const tags = value.map((item) => {
    if (
      typeof item !== "string" ||
      item.length < 1 ||
      item.length > 160 ||
      item.trim() !== item ||
      /[?&#=\u0000-\u001F\u007F]/.test(item) ||
      looksSensitiveCatalogExample(item) ||
      redactSensitiveCatalogText(item) !== item
    ) {
      throw new PlatformError(
        502,
        "catalog_openapi_taxonomy_invalid",
        "UpstreamProvider OpenAPI 的 operation tag 无效，本次同步已停止。",
      );
    }
    return item;
  });
  return [...new Set(tags)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function normalizeCatalogOperationId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new PlatformError(
      502,
      "catalog_openapi_taxonomy_invalid",
      "UpstreamProvider OpenAPI 的 operationId 无效，本次同步已停止。",
    );
  }
  const operationId = value.trim();
  if (
    operationId.length < 1 ||
    operationId.length > 500 ||
    /[\u0000-\u001F\u007F]/.test(operationId)
  ) {
    throw new PlatformError(
      502,
      "catalog_openapi_taxonomy_invalid",
      "UpstreamProvider OpenAPI 的 operationId 无效，本次同步已停止。",
    );
  }
  return redactSensitiveCatalogText(operationId);
}

function strictStoredCatalogTaxonomy(
  value: {
    data_type: unknown;
    tags_json: unknown;
    surface: unknown;
    operation_id: unknown;
  },
  status = 503,
  code = "catalog_taxonomy_invalid",
  message = "目录分类元数据无效，已停止发布与调用。",
): {
  dataType: CatalogDataType;
  tags: string[];
  surface: MarketplaceSurface;
  operationId: string | null;
} {
  try {
    if (
      typeof value.data_type !== "string" ||
      !PROVIDER_DATA_TYPES.includes(value.data_type)
    ) {
      throw new Error("invalid data type");
    }
    if (
      typeof value.surface !== "string" ||
      !PROVIDER_SURFACES.includes(value.surface)
    ) {
      throw new Error("invalid surface");
    }
    if (typeof value.tags_json !== "string") {
      throw new Error("invalid tags storage");
    }
    const parsedTags = JSON.parse(value.tags_json) as unknown;
    const tags = normalizeCatalogOperationTags(parsedTags);
    if (JSON.stringify(parsedTags) !== JSON.stringify(tags)) {
      throw new Error("tags are not canonical");
    }
    const operationId = normalizeCatalogOperationId(value.operation_id);
    if (operationId !== value.operation_id) {
      throw new Error("operation id is not canonical");
    }
    return {
      dataType: value.data_type as CatalogDataType,
      tags,
      surface: value.surface as MarketplaceSurface,
      operationId,
    };
  } catch {
    throw new PlatformError(status, code, message);
  }
}

async function assertStoredCatalogTaxonomyIntegrity(
  db: D1Database,
): Promise<void> {
  let afterPath = "";
  let inspected = 0;
  while (true) {
    let rows: Array<{
      path: string;
      data_type: unknown;
      tags_json: unknown;
      surface: unknown;
      operation_id: unknown;
    }>;
    try {
      const result = await db
        .prepare(
          `SELECT path, data_type, tags_json, surface, operation_id
           FROM endpoint_catalog
           WHERE path > ?
           ORDER BY path ASC
           LIMIT 500`,
        )
        .bind(afterPath)
        .all();
      rows = resultRows<{
        path: string;
        data_type: unknown;
        tags_json: unknown;
        surface: unknown;
        operation_id: unknown;
      }>(result);
    } catch {
      throw new PlatformError(
        503,
        "catalog_taxonomy_schema_unavailable",
        "目录分类迁移尚未完成，已停止发布与调用。",
      );
    }
    for (const row of rows) {
      if (typeof row.path !== "string" || row.path <= afterPath) {
        throw new PlatformError(
          503,
          "catalog_taxonomy_order_invalid",
          "目录分类记录顺序无效，已停止发布与调用。",
        );
      }
      strictStoredCatalogTaxonomy(row);
      afterPath = row.path;
      inspected += 1;
    }
    if (inspected > 100_000) {
      throw new PlatformError(
        503,
        "catalog_taxonomy_limit_exceeded",
        "历史目录记录超过安全审查上限，已停止发布与调用。",
      );
    }
    if (rows.length < 500) break;
  }
}

function extractOpenApiCatalog(
  payload: unknown,
  apiPathPrefix = "/api",
): Map<
  string,
  Omit<CatalogSyncEntry, "upstreamPriceUsdMicros" | "priceVerified">
> {
  if (!isPlainRecord(payload) || !isPlainRecord(payload.paths)) {
    throw new PlatformError(
      502,
      "catalog_schema_sync_failed",
      "UpstreamProvider OpenAPI 文档格式无效。",
    );
  }
  const byPath = new Map<
    string,
    Omit<CatalogSyncEntry, "upstreamPriceUsdMicros" | "priceVerified">
  >();
  const configuredV1Prefix = `${apiPathPrefix}/v1/`;
  for (const [rawPath, pathItem] of Object.entries(payload.paths)) {
    if (
      !rawPath.startsWith("/v1/") &&
      !rawPath.startsWith(configuredV1Prefix)
    ) {
      continue;
    }
    if (
      !isPlainRecord(pathItem) ||
      Object.hasOwn(pathItem, "$ref") ||
      (Object.hasOwn(pathItem, "parameters") &&
        !Array.isArray(pathItem.parameters))
    ) {
      throw new PlatformError(
        502,
        "catalog_openapi_operation_invalid",
        "UpstreamProvider OpenAPI 的 v1 path item 无效，本次同步已停止。",
      );
    }
    const operationMethods = [
      "get",
      "post",
      "put",
      "patch",
      "delete",
      "head",
      "options",
      "trace",
    ] as const;
    const presentMethods = operationMethods.filter((method) =>
      Object.hasOwn(pathItem, method),
    );
    if (
      presentMethods.some(
        (method) =>
          !isPlainRecord(pathItem[method]) ||
          Object.hasOwn(pathItem[method] as Record<string, unknown>, "$ref"),
      )
    ) {
      throw new PlatformError(
        502,
        "catalog_openapi_operation_invalid",
        "UpstreamProvider OpenAPI 的 v1 operation 无效，本次同步已停止。",
      );
    }
    const documentedMethods = presentMethods;
    if (
      documentedMethods.some(
        (method) => method !== "get" && method !== "post",
      )
    ) {
      throw new PlatformError(
        502,
        "catalog_openapi_method_unsupported",
        "UpstreamProvider OpenAPI 出现 GET/POST 之外的操作，本次同步已停止。",
      );
    }
    if (documentedMethods.length > 1) {
      throw new PlatformError(
        502,
        "catalog_openapi_method_collision",
        "UpstreamProvider OpenAPI 同一路径出现多个请求方法，当前目录模型无法安全区分。",
      );
    }
    let selected:
      | Omit<
          CatalogSyncEntry,
          "upstreamPriceUsdMicros" | "priceVerified"
        >
      | null = null;
    for (const method of ["get", "post"] as const) {
      const operation = pathItem[method];
      if (!isPlainRecord(operation)) continue;
      try {
        if (
          (Object.hasOwn(operation, "parameters") &&
            !Array.isArray(operation.parameters)) ||
          (Object.hasOwn(operation, "requestBody") &&
            !isPlainRecord(operation.requestBody))
        ) {
          throw new PlatformError(
            502,
            "catalog_openapi_operation_invalid",
            "UpstreamProvider OpenAPI 的 v1 operation 输入元数据无效，本次同步已停止。",
          );
        }
        const path = normalizeCatalogPath(rawPath, apiPathPrefix);
        const httpMethod = method.toUpperCase() as "GET" | "POST";
        const tags = normalizeCatalogOperationTags(operation.tags);
        const operationId = normalizeCatalogOperationId(
          operation.operationId,
        );
        const surface = providerSurfaceForPath(
          rawPath,
          tags,
        ) as MarketplaceSurface;
        const platform = path.split("/")[2] || "other";
        const dataType = providerDataTypeFor({
          platform,
          sourcePath: rawPath,
          tags,
          operationId,
        }) as CatalogDataType;
        if (
          !PROVIDER_SURFACES.includes(surface) ||
          !PROVIDER_DATA_TYPES.includes(dataType)
        ) {
          throw new PlatformError(
            502,
            "catalog_openapi_taxonomy_invalid",
            "UpstreamProvider OpenAPI 的数据分类无效，本次同步已停止。",
          );
        }
        const pathParameters = Array.isArray(pathItem.parameters)
          ? pathItem.parameters
          : [];
        const operationParameters = Array.isArray(operation.parameters)
          ? operation.parameters
          : [];
        const mergedParameters = redactCatalogInputMetadata(
          resolveOpenApiInputReferences(payload, [
            ...pathParameters,
            ...operationParameters,
          ]),
        );
        const requestBody = redactCatalogInputMetadata(
          resolveOpenApiInputReferences(
            payload,
            isPlainRecord(operation.requestBody)
              ? operation.requestBody
              : null,
          ),
        );
        const schemaPayload = {
          parameters: mergedParameters,
          requestBody,
        };
        const serializedSchema = JSON.stringify(schemaPayload);
        const safety =
          serializedSchema.length <= MAX_OPENAPI_INPUT_SCHEMA_BYTES
            ? classifyCatalogSafety(path, httpMethod, {
                ...operation,
                parameters: mergedParameters,
                requestBody,
              })
            : {
                classification: "ambiguous" as const,
                reasons: ["input_schema_storage_limit"],
              };
        const entry = {
          path,
          platform,
          httpMethod,
          dataType,
          tags,
          surface,
          operationId,
          summary:
            typeof operation.summary === "string"
              ? compactCatalogText(
                  redactSensitiveCatalogText(operation.summary),
                  240,
                )
              : null,
          description: publicCatalogDescription(
            operation.description,
            2_000,
          ),
          parameterSchemaJson:
            serializedSchema.length <= MAX_OPENAPI_INPUT_SCHEMA_BYTES
              ? serializedSchema
              : JSON.stringify({ truncated: true }),
          looksReadOnly: safety.classification === "safe_data_read",
          safetyClassification: safety.classification,
          safetyReasons: safety.reasons,
          safetyPolicyVersion: CATALOG_SAFETY_POLICY_VERSION,
        };
        if (selected == null || httpMethod === "GET") selected = entry;
      } catch (error) {
        if (error instanceof PlatformError && error.status === 502) {
          throw error;
        }
        throw new PlatformError(
          502,
          "catalog_openapi_taxonomy_invalid",
          "UpstreamProvider OpenAPI 的 v1 operation 元数据无效，本次同步已停止。",
        );
      }
    }
    if (selected) {
      if (byPath.has(selected.path)) {
        throw new PlatformError(
          502,
          "catalog_openapi_path_collision",
          "UpstreamProvider OpenAPI 出现归一化后重复的 v1 路径，本次同步已停止。",
        );
      }
      byPath.set(selected.path, selected);
    }
  }
  return byPath;
}

function mergeCatalogEntries(
  prices: CatalogPriceEntry[],
  openApi: ReturnType<typeof extractOpenApiCatalog>,
  credentialScopes: string[] | null,
  apiPathPrefix: string,
): CatalogSyncEntry[] {
  const pricesByPath = new Map(prices.map((price) => [price.path, price]));
  return [...openApi.values()].map((metadata) => {
    const price = pricesByPath.get(metadata.path);
    const methodMatches =
      price != null &&
      (price.httpMethod == null ||
        price.httpMethod === metadata.httpMethod) &&
      upstreamProviderCredentialAllowsPath(
        credentialScopes,
        metadata.path,
        apiPathPrefix,
      );
    return {
      ...metadata,
      upstreamPriceUsdMicros: methodMatches
        ? price.upstreamPriceUsdMicros
        : 0,
      priceVerified: methodMatches,
    };
  });
}

function unresolvedCatalogEntries(
  prices: CatalogPriceEntry[],
  openApi: ReturnType<typeof extractOpenApiCatalog>,
): CatalogUnresolvedSyncEntry[] {
  return prices.flatMap((price) => {
    const metadata = openApi.get(price.path);
    if (
      metadata &&
      (price.httpMethod == null ||
        price.httpMethod === metadata.httpMethod)
    ) {
      return [];
    }
    const platform = price.path.split("/")[2] || "other";
    const taxonomyHints = price.sourceType
      ? [price.sourceType]
      : [];
    const surface = providerSurfaceForPath(
      price.path,
      taxonomyHints,
    ) as MarketplaceSurface;
    const dataType = providerDataTypeFor({
      platform,
      sourcePath: price.path,
      tags: taxonomyHints,
      operationId: null,
    }) as CatalogDataType;
    if (
      !PROVIDER_SURFACES.includes(surface) ||
      !PROVIDER_DATA_TYPES.includes(dataType)
    ) {
      throw new PlatformError(
        502,
        "catalog_pending_taxonomy_invalid",
        "待补全文档目录的数据分类无效，本次同步已停止。",
      );
    }
    const pathLabel = price.path
      .split("/")
      .filter(Boolean)
      .slice(-3)
      .map((segment) => segment.replace(/[_-]+/g, " "))
      .join(" / ");
    return [
      {
        ...price,
        platform,
        dataType,
        surface,
        summary: `数据服务 · ${pathLabel}`.slice(0, 240),
      },
    ];
  });
}

function catalogCoverageBreakdown(
  prices: CatalogPriceEntry[],
  openApi: ReturnType<typeof extractOpenApiCatalog>,
  credentialScopes: string[] | null,
  apiPathPrefix: string,
): {
  openApiPriceMapped: number;
  priceOnly: number;
  openApiOnly: number;
  scopeExcluded: number;
} {
  const pricesByPath = new Map(prices.map((price) => [price.path, price]));
  let openApiPriceMapped = 0;
  let scopeExcluded = 0;
  for (const metadata of openApi.values()) {
    const price = pricesByPath.get(metadata.path);
    if (
      !price ||
      (price.httpMethod != null &&
        price.httpMethod !== metadata.httpMethod)
    ) {
      continue;
    }
    openApiPriceMapped += 1;
    if (
      !upstreamProviderCredentialAllowsPath(
        credentialScopes,
        metadata.path,
        apiPathPrefix,
      )
    ) {
      scopeExcluded += 1;
    }
  }
  return {
    openApiPriceMapped,
    priceOnly: prices.length - openApiPriceMapped,
    openApiOnly: openApi.size - openApiPriceMapped,
    scopeExcluded,
  };
}

function compactCatalogText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, maxLength) : null;
}

function safeStoredJson(value: string | null): unknown {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainRecord(parsed) || Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeStoredStringArray(
  value: string | null,
  maxItems = 32,
): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length > maxItems ||
      !parsed.every(
        (item) =>
          typeof item === "string" &&
          item.length > 0 &&
          item.length <= 160,
      )
    ) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

function normalizeCatalogPath(
  value: string,
  apiPathPrefix = "/api",
): string {
  try {
    let path = value.trim();
    if (/^https?:\/\//i.test(path)) throw new Error("absolute URL rejected");
    if (
      apiPathPrefix &&
      path.startsWith(`${apiPathPrefix}/v1/`)
    ) {
      path = path.slice(apiPathPrefix.length);
    }
    if (!path.startsWith("/v1/")) {
      throw new Error("Unsupported endpoint path");
    }
    validateCatalogPathSyntax(path);
    return path;
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw new PlatformError(400, "invalid_endpoint", "端点路径无效。");
  }
}

function looksLikeReadOnlyPath(path: string): boolean {
  return !catalogHardBlockedSignals(path).length;
}

function canonicalCatalogInputField(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function catalogInputFieldRisk(
  value: string,
): "prohibited" | "ambiguous" | null {
  const canonical = canonicalCatalogInputField(value);
  const compact = canonical.replaceAll("_", "");
  const allowedTokens = new Set([
    "pagination_token",
    "page_token",
    "cursor_token",
    "continuation_token",
    "next_token",
  ]);
  const allowedTokenCompacts = new Set(
    [...allowedTokens].map((field) => field.replaceAll("_", "")),
  );
  if (
    allowedTokens.has(canonical) ||
    allowedTokenCompacts.has(compact)
  ) {
    return null;
  }
  const sensitive = new Set([
    "cookie",
    "cookies",
    "session",
    "session_id",
    "access_token",
    "refresh_token",
    "auth_token",
    "auth",
    "authorization",
    "password",
    "passwd",
    "secret",
    "credential",
    "credentials",
    "csrf",
    "csrf_token",
    "api_key",
    "private_key",
    "proxy",
    "proxy_url",
    "proxy_username",
    "proxy_password",
    "ms_token",
    "device_id",
  ]);
  const sensitiveCompacts = new Set(
    [...sensitive].map((field) => field.replaceAll("_", "")),
  );
  if (sensitive.has(canonical) || sensitiveCompacts.has(compact)) {
    return "prohibited";
  }
  const segments = canonical.split("_").filter(Boolean);
  const prohibitedSegments = new Set([
    "cookie",
    "cookies",
    "session",
    "auth",
    "password",
    "passwd",
    "secret",
    "credential",
    "credentials",
    "csrf",
    "proxy",
    "authorization",
    "device",
  ]);
  if (
    segments.some((segment) => prohibitedSegments.has(segment)) ||
    /(?:^|_)(?:api|private)_key$/.test(canonical) ||
    /(?:^|_)(?:access|refresh|auth|ms|device)_token$/.test(canonical) ||
    /(?:^|_)device_id$/.test(canonical)
  ) {
    return "prohibited";
  }
  return segments.includes("token") ? "ambiguous" : null;
}

function catalogInputRisks(value: unknown): {
  prohibited: string[];
  ambiguous: string[];
} {
  const prohibited = new Set<string>();
  const ambiguous = new Set<string>();
  const visit = (input: unknown, depth: number): void => {
    if (depth > 32) {
      ambiguous.add("input_schema_too_deep");
      return;
    }
    if (Array.isArray(input)) {
      for (const item of input) visit(item, depth + 1);
      return;
    }
    if (!isPlainRecord(input)) return;
    for (const [key, child] of Object.entries(input)) {
      const keyRisk = catalogInputFieldRisk(key);
      if (keyRisk === "prohibited") {
        prohibited.add(
          `sensitive_input:${canonicalCatalogInputField(key)}`,
        );
      } else if (keyRisk === "ambiguous") {
        ambiguous.add("generic_token_input");
      }
      if (
        canonicalCatalogInputField(key) === "name" &&
        typeof child === "string"
      ) {
        const valueRisk = catalogInputFieldRisk(child);
        if (valueRisk === "prohibited") {
          prohibited.add(
            `sensitive_input:${canonicalCatalogInputField(child)}`,
          );
        } else if (valueRisk === "ambiguous") {
          ambiguous.add("generic_token_input");
        }
      }
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return {
    prohibited: [...prohibited].sort().slice(0, 8),
    ambiguous: [...ambiguous].sort().slice(0, 8),
  };
}

function catalogHardBlockedSignals(path: string): string[] {
  const normalized = path.toLowerCase();
  const operation = canonicalCatalogInputField(
    normalized.split("/").pop() ?? "",
  );
  const reasons: string[] = [];
  if (/^\/v1\/(?:internal|admin|control|demo|health)(?:\/|$)/.test(normalized)) {
    reasons.push("control_namespace");
  }
  reasons.push(...catalogOperationWriteSignals(operation));
  if (
    /^(?:check_?in|sign_?in)(?:_|$)/.test(operation) ||
    /(?:captcha|verify_code|temp_email|get_guest_cookie|set_cookie|register_device|generate_ms_token|signature|sign_url|encrypt_|decrypt_)/.test(
      operation,
    )
  ) {
    reasons.push("sensitive_utility");
  }
  return reasons;
}

function catalogOperationWriteSignals(operation: string): string[] {
  const normalized = canonicalCatalogInputField(operation);
  const writeAction =
    "(?:publish|create|delete|remove|send|reply|increase|follow|unfollow|" +
    "like|unlike|favorite|unfavorite|collect|uncollect|update|upload|" +
    "set|add|open|close|bind|unbind|modify|edit|submit|register|login|" +
    "logout|purchase|checkout|pay|withdraw|transfer|recharge|claim|" +
    "redeem|subscribe|unsubscribe|block|unblock|report|pin|unpin|comment|" +
    "repost|retweet|share|vote|react|message|join|leave|invite|approve|" +
    "cancel|bookmark|star)";
  const prefix = normalized.match(
    new RegExp(`^(${writeAction})(?:_|$)`),
  );
  const chained = normalized.match(
    new RegExp(`_(?:(?:and_)?then|and)_(${writeAction})(?:_|$)`),
  );
  return [
    ...(prefix ? [`write_action:${prefix[1]}`] : []),
    ...(chained ? [`chained_write_action:${chained[1]}`] : []),
  ];
}

function isHardProhibitedCatalogOperation(
  path: string,
  method: "GET" | "POST",
): boolean {
  if (method !== "GET" && method !== "POST") return true;
  return catalogHardBlockedSignals(path).length > 0;
}

function classifyCatalogSafety(
  path: string,
  method: "GET" | "POST",
  operation?: Record<string, unknown>,
): CatalogSafetyAssessment {
  const pathSignals = catalogHardBlockedSignals(path);
  if (pathSignals.length > 0) {
    return {
      classification: "prohibited",
      reasons: pathSignals.slice(0, 8),
    };
  }
  let inputMetadata = "";
  let summaryMetadata = "";
  let operationId = "";
  if (operation) {
    try {
      inputMetadata = JSON.stringify({
        parameters: operation.parameters ?? null,
        requestBody: operation.requestBody ?? null,
      }).toLowerCase();
      summaryMetadata =
        typeof operation.summary === "string"
          ? operation.summary.trim().toLowerCase()
          : "";
      operationId =
        typeof operation.operationId === "string"
          ? operation.operationId.trim()
          : "";
    } catch {
      return {
        classification: "ambiguous",
        reasons: ["operation_metadata_unreadable"],
      };
    }
  }
  const operationIdWriteSignals =
    catalogOperationWriteSignals(operationId);
  if (operationIdWriteSignals.length > 0) {
    return {
      classification: "prohibited",
      reasons: operationIdWriteSignals.slice(0, 8),
    };
  }
  if (
    /^(?:publish|create|delete|remove|send|reply|follow|unfollow|like|upload|login|withdraw|pay|发布|创建|删除|关注|点赞|上传|登录|提现|支付)(?:\b|[：:，,\s])/.test(
      summaryMetadata,
    )
  ) {
    return {
      classification: "prohibited",
      reasons: ["mutation_summary"],
    };
  }
  const summaryWriteSignals =
    catalogOperationWriteSignals(summaryMetadata);
  if (summaryWriteSignals.length > 0) {
    return {
      classification: "prohibited",
      reasons: ["mutation_summary", ...summaryWriteSignals].slice(0, 8),
    };
  }
  const inputRisks = catalogInputRisks({
    parameters: operation?.parameters ?? null,
    requestBody: operation?.requestBody ?? null,
  });
  if (inputRisks.prohibited.length > 0) {
    return {
      classification: "prohibited",
      reasons: inputRisks.prohibited,
    };
  }
  const ambiguousReasons: string[] = [];
  if (!operation) ambiguousReasons.push("openapi_metadata_missing");
  if (inputMetadata.includes('"$ref"')) {
    ambiguousReasons.push("unresolved_schema_reference");
  }
  ambiguousReasons.push(...inputRisks.ambiguous);
  const operationName = path.split("/").pop()?.toLowerCase() ?? "";
  const canonicalOperationId =
    canonicalCatalogInputField(operationId);
  const safeVerb =
    /^(?:batch_(?:fetch|get|search|query)|fetch|get|search|query|list|parse|resolve|calculate|check|analyze|analyse|extract)(?:_|$)/.test(
      operationName,
    ) ||
    /^(?:batch_(?:fetch|get|search|query)|fetch|get|search|query|list|parse|resolve|calculate|check|analyze|analyse|extract)(?:[_-]|$)/.test(
      canonicalOperationId,
    );
  if (!safeVerb) ambiguousReasons.push("operation_not_allowlisted");
  if (ambiguousReasons.length > 0) {
    return {
      classification: "ambiguous",
      reasons: [...new Set(ambiguousReasons)],
    };
  }
  return {
    classification: "safe_data_read",
    reasons: [`allowlisted_${method.toLowerCase()}_data_read`],
  };
}

function parseUpstreamAllowedOrigins(value?: string): Set<string> {
  const origins = new Set<string>();
  for (const raw of (value ?? "").split(",")) {
    const compact = raw.trim();
    if (!compact) continue;
    try {
      const url = new URL(compact);
      if (
        url.protocol !== "https:" ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.pathname !== "" && url.pathname !== "/") ||
        isPrivateOrLocalHostname(url.hostname)
      ) {
        continue;
      }
      origins.add(url.origin);
    } catch {
      continue;
    }
  }
  return origins;
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "0.0.0.0" ||
    normalized === "::1"
  ) {
    return true;
  }
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) return true;
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      octets[0] === 0 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
      octets[0] >= 224
    );
  }
  return (
    normalized.startsWith("[") ||
    normalized.includes(":") ||
    normalized === "metadata.google.internal"
  );
}

function normalizeUpstreamConfigPath(
  value: unknown,
  field: string,
  options: { allowEmpty?: boolean; publicPrefix?: boolean } = {},
): string {
  if (typeof value !== "string") {
    throw new PlatformError(
      400,
      "invalid_upstream_config",
      `数据源配置 ${field} 无效。`,
    );
  }
  const compact = value.trim().replace(/\/+$/, "");
  if (options.allowEmpty && compact === "") return "";
  if (
    compact.length < 2 ||
    compact.length > 600 ||
    !compact.startsWith("/") ||
    compact.startsWith("//") ||
    compact.includes("..") ||
    compact.includes("?") ||
    compact.includes("#") ||
    /[\u0000-\u001F\u007F]/.test(compact) ||
    (options.publicPrefix && !compact.startsWith("/v1/"))
  ) {
    throw new PlatformError(
      400,
      "invalid_upstream_config",
      `数据源配置 ${field} 无效。`,
    );
  }
  return compact;
}

function normalizeUpstreamSourceConfigInput(
  body: Record<string, unknown>,
  env: PlatformEnv,
): Omit<UpstreamSourceConfig, "version" | "hash" | "updatedAt"> {
  if (typeof body.enabled !== "boolean") {
    throw new PlatformError(
      400,
      "invalid_upstream_config",
      "必须明确设置数据源启用状态。",
    );
  }
  if (typeof body.sourceOrigin !== "string") {
    throw new PlatformError(
      400,
      "invalid_upstream_config",
      "数据源 Origin 无效。",
    );
  }
  let origin: string;
  try {
    const url = new URL(body.sourceOrigin.trim());
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "" && url.pathname !== "/") ||
      isPrivateOrLocalHostname(url.hostname)
    ) {
      throw new Error("unsafe origin");
    }
    origin = url.origin;
  } catch {
    throw new PlatformError(
      400,
      "invalid_upstream_config",
      "数据源 Origin 必须是允许列表中的公开 HTTPS Origin。",
    );
  }
  const allowedOrigins = parseUpstreamAllowedOrigins(
    env.UPSTREAM_ALLOWED_ORIGINS,
  );
  if (!allowedOrigins.has(origin)) {
    throw new PlatformError(
      400,
      "upstream_origin_not_allowed",
      "数据源 Origin 不在部署允许列表中。",
    );
  }
  const catalogAuthMode = body.catalogAuthMode;
  if (
    catalogAuthMode !== "none" &&
    catalogAuthMode !== "optional" &&
    catalogAuthMode !== "required"
  ) {
    throw new PlatformError(
      400,
      "invalid_upstream_config",
      "目录认证模式无效。",
    );
  }
  if (
    !Array.isArray(body.publicExcludedPrefixes) ||
    body.publicExcludedPrefixes.length > 100
  ) {
    throw new PlatformError(
      400,
      "invalid_upstream_config",
      "公开排除前缀无效。",
    );
  }
  const apiPathPrefix = normalizeUpstreamConfigPath(
    body.apiPathPrefix,
    "apiPathPrefix",
    { allowEmpty: true },
  );
  const openApiPath = normalizeUpstreamConfigPath(
    body.openApiPath,
    "openApiPath",
  );
  const catalogPath = normalizeUpstreamConfigPath(
    body.catalogPath,
    "catalogPath",
  );
  const credentialPath = normalizeUpstreamConfigPath(
    body.credentialPath,
    "credentialPath",
  );
  const controlPlanePrefix = (path: string): string | null => {
    const publicPath =
      apiPathPrefix && path.startsWith(`${apiPathPrefix}/v1/`)
        ? path.slice(apiPathPrefix.length)
        : path;
    const segments = publicPath.split("/").filter(Boolean);
    if (
      segments.length < 3 ||
      segments[0] !== "v1" ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(segments[1])
    ) {
      return null;
    }
    return `/v1/${segments[1]}/`;
  };
  const requiredExclusions = [
    controlPlanePrefix(catalogPath),
    controlPlanePrefix(credentialPath),
  ].filter((value): value is string => value !== null);
  const publicExcludedPrefixes = [
    ...new Set(
      [
        ...body.publicExcludedPrefixes.map((prefix) =>
          `${normalizeUpstreamConfigPath(
            prefix,
            "publicExcludedPrefixes",
            { publicPrefix: true },
          )}/`.replace(/\/+$/, "/"),
        ),
        ...requiredExclusions,
      ],
    ),
  ].sort();
  return {
    enabled: body.enabled,
    origin,
    apiPathPrefix,
    openApiPath,
    catalogPath,
    credentialPath,
    catalogAuthMode,
    publicExcludedPrefixes,
  };
}

function loadUpstreamSourceConfig(
  db: D1Database,
  env: PlatformEnv,
  required: true,
): Promise<UpstreamSourceConfig>;
function loadUpstreamSourceConfig(
  db: D1Database,
  env: PlatformEnv,
  required: false,
): Promise<UpstreamSourceConfig | null>;
async function loadUpstreamSourceConfig(
  db: D1Database,
  env: PlatformEnv,
  required: boolean,
): Promise<UpstreamSourceConfig | null> {
  let row: UpstreamSourceConfigRecord | null;
  try {
    row = await db
      .prepare(
        `SELECT id, enabled, version, config_hash, source_origin,
                api_path_prefix, openapi_path, catalog_path,
                credential_path, catalog_auth_mode,
                public_excluded_prefixes_json, updated_at
         FROM upstream_source_config
         WHERE id = 1`,
      )
      .first<UpstreamSourceConfigRecord>();
  } catch {
    if (!required) return null;
    throw new PlatformError(
      503,
      "database_migrations_required",
      "数据源配置迁移尚未完成。",
    );
  }
  if (!row) {
    if (!required) return null;
    throw new PlatformError(
      503,
      "upstream_config_required",
      "请先在管理后台保存数据源路由配置。",
    );
  }
  const input = normalizeUpstreamSourceConfigInput(
    {
      enabled: Number(row.enabled) === 1,
      sourceOrigin: row.source_origin,
      apiPathPrefix: row.api_path_prefix,
      openApiPath: row.openapi_path,
      catalogPath: row.catalog_path,
      credentialPath: row.credential_path,
      catalogAuthMode: row.catalog_auth_mode,
      publicExcludedPrefixes: safeStoredStringArray(
        row.public_excluded_prefixes_json,
        100,
      ),
    },
    env,
  );
  const version = Number(row.version);
  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !/^[0-9a-f]{64}$/.test(row.config_hash) ||
    !Number.isFinite(Date.parse(row.updated_at))
  ) {
    throw new PlatformError(
      503,
      "upstream_config_invalid",
      "数据源配置校验失败。",
    );
  }
  const expectedHash = await sha256Hex(
    JSON.stringify({
      enabled: input.enabled,
      sourceOrigin: input.origin,
      apiPathPrefix: input.apiPathPrefix,
      openApiPath: input.openApiPath,
      catalogPath: input.catalogPath,
      credentialPath: input.credentialPath,
      catalogAuthMode: input.catalogAuthMode,
      publicExcludedPrefixes: input.publicExcludedPrefixes,
    }),
  );
  if (expectedHash !== row.config_hash) {
    throw new PlatformError(
      503,
      "upstream_config_invalid",
      "数据源配置完整性校验失败。",
    );
  }
  if (required && !input.enabled) {
    throw new PlatformError(
      503,
      "upstream_config_disabled",
      "数据源配置当前未启用。",
    );
  }
  return {
    ...input,
    version,
    hash: row.config_hash,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function upstreamConfigUrl(
  config: UpstreamSourceConfig,
  path: string,
): string {
  const normalized = normalizeUpstreamConfigPath(path, "path");
  const url = new URL(normalized, `${config.origin}/`);
  if (url.origin !== config.origin) {
    throw new PlatformError(
      500,
      "upstream_config_invalid",
      "数据源路由越过了已配置 Origin。",
    );
  }
  return url.href;
}

function validateProxyPath(path: string): void {
  validateCatalogPathSyntax(path);
  if (!looksLikeReadOnlyPath(path)) {
    throw new PlatformError(
      403,
      "unsafe_endpoint",
      "账户、Cookie、发布、互动或其他非只读端点不在开放范围内。",
    );
  }
}

function validateCatalogProxyInputs(
  url: URL,
  body: unknown,
): void {
  const rejectUnsafeInput = (raw: string): void => {
    if (catalogInputFieldRisk(raw) == null) return;
    throw new PlatformError(
      403,
      "unsafe_proxy_input",
      "公开数据接口不接受 Cookie、会话、令牌、密钥、设备或代理凭据。",
    );
  };
  for (const name of url.searchParams.keys()) {
    rejectUnsafeInput(name);
  }
  const visit = (value: unknown, depth: number): void => {
    if (depth > 32) {
      throw new PlatformError(
        400,
        "invalid_json",
        "POST 请求体嵌套层级超过安全上限。",
      );
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!isPlainRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      rejectUnsafeInput(key);
      if (
        canonicalCatalogInputField(key) === "name" &&
        typeof child === "string"
      ) {
        rejectUnsafeInput(child);
      }
      visit(child, depth + 1);
    }
  };
  if (body !== null) visit(body, 0);
}

function validateCatalogPathSyntax(path: string): void {
  if (
    !/^\/v1\/[a-zA-Z0-9/_-]+$/.test(path) ||
    path.includes("..") ||
    path.includes("//") ||
    path.endsWith("/")
  ) {
    throw new PlatformError(400, "invalid_endpoint", "端点路径无效。");
  }
}

function sanitizeUpstreamHeaders(headers: Headers): Headers {
  const safe = new Headers();
  const allowed = ["content-type", "content-language", "etag", "last-modified"];
  for (const name of allowed) {
    const value = headers.get(name);
    if (value) safe.set(name, value);
  }
  return safe;
}

function requireDb(env: PlatformEnv): D1Database {
  if (!env.DB) {
    throw new PlatformError(
      503,
      "database_unavailable",
      "数据库尚未完成配置。",
    );
  }
  return env.DB;
}

function requireAdminSecret(
  request: Request,
  env: PlatformEnv,
  scope: "catalog" | "payments" | "reconciliation" | "platform",
): void {
  const supplied = bearerToken(request);
  const scoped =
    scope === "catalog"
      ? env.CATALOG_SYNC_SECRET
      : scope === "payments"
        ? env.PAYMENT_ADMIN_SECRET
        : scope === "reconciliation"
          ? env.RECONCILIATION_SECRET
          : undefined;
  const candidates = [env.ADMIN_MASTER_SECRET, scoped].filter(
    hasConfiguredAdminSecret,
  );
  if (
    !supplied ||
    candidates.length === 0 ||
    !candidates.some((configured) =>
      constantTimeEqual(supplied, configured),
    )
  ) {
    throw new PlatformError(401, "admin_unauthorized", "管理员凭证无效。");
  }
}

async function writeAdminAudit(
  db: D1Database,
  request: Request,
  input: {
    action: string;
    targetType: string;
    targetId: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await (await prepareAdminAuditStatement(db, request, input)).run();
}

async function prepareAdminAuditStatement(
  db: D1Database,
  request: Request,
  input: {
    action: string;
    targetType: string;
    targetId: string;
    details?: Record<string, unknown>;
    idempotencyKey?: string;
    paymentReviewResolution?: {
      caseId: string;
      action: string;
      requestHash: string;
    };
    userStatusUpdate?: {
      userId: string;
      status: "active" | "suspended";
    };
    catalogEndpointRevision?: {
      path: string;
      revision: number;
    };
    pendingCatalogPriceUpdate?: {
      path: string;
      customerPriceUsdMicros: number;
      updatedAt: string;
    };
    catalogSyncGeneration?: string;
    upstreamCredentialExists?: {
      id: string;
      secretHash: string;
    };
    upstreamConfigUpdate?: {
      version: number;
      configHash: string;
      updatedAt: string;
    };
    upstreamCredentialActivation?: {
      id: string;
      stateVersion: number;
      updatedAt: string;
      verifiedAt: string;
      verifiedScopesJson: string;
      verifiedConfigHash: string;
      expiresAt: string | null;
      secretHash: string;
    };
    upstreamCredentialRevocation?: {
      id: string;
      revokedAt: string;
    };
  },
): Promise<D1PreparedStatement> {
  const supplied = bearerToken(request);
  if (!supplied) {
    throw new PlatformError(401, "admin_unauthorized", "管理员凭证无效。");
  }
  const details = input.details ? JSON.stringify(input.details) : null;
  if (details != null && details.length > 8_192) {
    throw new PlatformError(
      500,
      "audit_record_too_large",
      "管理员操作审计信息超过安全上限。",
    );
  }
  const causalKey =
    input.idempotencyKey ??
    (input.catalogEndpointRevision
      ? `revision:${input.catalogEndpointRevision.path}:${input.catalogEndpointRevision.revision}`
      : input.pendingCatalogPriceUpdate
        ? `pending-price:${input.pendingCatalogPriceUpdate.path}:${input.pendingCatalogPriceUpdate.customerPriceUsdMicros}:${input.pendingCatalogPriceUpdate.updatedAt}`
      : input.catalogSyncGeneration
        ? `generation:${input.catalogSyncGeneration}`
        : input.upstreamCredentialExists
          ? `credential:${input.upstreamCredentialExists.id}:${input.upstreamCredentialExists.secretHash}`
          : input.upstreamConfigUpdate
            ? `source-config:${input.upstreamConfigUpdate.version}:${input.upstreamConfigUpdate.configHash}:${input.upstreamConfigUpdate.updatedAt}`
          : input.upstreamCredentialActivation
            ? `activation:${input.upstreamCredentialActivation.id}:${input.upstreamCredentialActivation.stateVersion}`
            : input.upstreamCredentialRevocation
              ? `revocation:${input.upstreamCredentialRevocation.id}:${input.upstreamCredentialRevocation.revokedAt}`
              : null);
  const auditId = causalKey
    ? `aud_${(
        await sha256Hex(
          `${input.action}:${input.targetType}:${input.targetId}:${causalKey}`,
        )
      ).slice(0, 32)}`
    : `aud_${randomBase64Url(18)}`;
  const values = [
    auditId,
    (await sha256Hex(supplied)).slice(0, 16),
    input.action.slice(0, 120),
    input.targetType.slice(0, 80),
    input.targetId.slice(0, 180),
    details,
  ];
  if (input.userStatusUpdate) {
    return db
      .prepare(
        `INSERT INTO admin_audit_logs
         (id, actor_fingerprint, action, target_type, target_id,
         details_json, created_at)
         SELECT ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
         WHERE changes() = 1
           AND EXISTS (
           SELECT 1 FROM users
           WHERE id = ? AND status = ?
         )`,
      )
      .bind(
        ...values,
        input.userStatusUpdate.userId,
        input.userStatusUpdate.status,
      );
  }
  if (input.paymentReviewResolution) {
    return db
      .prepare(
        `INSERT OR IGNORE INTO admin_audit_logs
         (id, actor_fingerprint, action, target_type, target_id,
          details_json, created_at)
         SELECT ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
         WHERE EXISTS (
           SELECT 1
           FROM payment_review_cases
           WHERE id = ? AND status = 'resolved'
             AND resolution_action = ?
             AND resolution_request_hash = ?
         )`,
      )
      .bind(
        ...values,
        input.paymentReviewResolution.caseId,
        input.paymentReviewResolution.action,
        input.paymentReviewResolution.requestHash,
      );
  }
  if (input.catalogEndpointRevision) {
    return db
      .prepare(
        `INSERT OR IGNORE INTO admin_audit_logs
         (id, actor_fingerprint, action, target_type, target_id,
          details_json, created_at)
         SELECT ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
         WHERE EXISTS (
           SELECT 1
           FROM endpoint_catalog
           WHERE path = ? AND revision = ?
         )`,
      )
      .bind(
        ...values,
        input.catalogEndpointRevision.path,
        input.catalogEndpointRevision.revision,
      );
  }
  if (input.pendingCatalogPriceUpdate) {
    return db
      .prepare(
        `INSERT OR IGNORE INTO admin_audit_logs
         (id, actor_fingerprint, action, target_type, target_id,
          details_json, created_at)
         SELECT ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
         WHERE changes() = 1
           AND EXISTS (
             SELECT 1 FROM catalog_unresolved_endpoints
             WHERE path = ? AND customer_price_usd_micros = ?
               AND updated_at = ?
           )`,
      )
      .bind(
        ...values,
        input.pendingCatalogPriceUpdate.path,
        input.pendingCatalogPriceUpdate.customerPriceUsdMicros,
        input.pendingCatalogPriceUpdate.updatedAt,
      );
  }
  if (input.catalogSyncGeneration) {
    return db
      .prepare(
        `INSERT OR IGNORE INTO admin_audit_logs
         (id, actor_fingerprint, action, target_type, target_id,
          details_json, created_at)
         SELECT ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
         WHERE EXISTS (
           SELECT 1 FROM catalog_sync_state
           WHERE id = 1 AND last_success_generation = ?
         )`,
      )
      .bind(...values, input.catalogSyncGeneration);
  }
  if (input.upstreamCredentialExists) {
    return db
      .prepare(
        `INSERT OR IGNORE INTO admin_audit_logs
         (id, actor_fingerprint, action, target_type, target_id,
          details_json, created_at)
         SELECT ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
         WHERE EXISTS (
           SELECT 1 FROM upstream_credentials
           WHERE id = ? AND provider = 'primary' AND secret_hash = ?
         )`,
      )
      .bind(
        ...values,
        input.upstreamCredentialExists.id,
        input.upstreamCredentialExists.secretHash,
      );
  }
  if (input.upstreamConfigUpdate) {
    return db
      .prepare(
        `INSERT OR IGNORE INTO admin_audit_logs
         (id, actor_fingerprint, action, target_type, target_id,
          details_json, created_at)
         SELECT ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
         WHERE EXISTS (
           SELECT 1 FROM upstream_source_config
           WHERE id = 1 AND version = ? AND config_hash = ?
             AND updated_at = ?
         )`,
      )
      .bind(
        ...values,
        input.upstreamConfigUpdate.version,
        input.upstreamConfigUpdate.configHash,
        input.upstreamConfigUpdate.updatedAt,
      );
  }
  if (input.upstreamCredentialActivation) {
    return db
      .prepare(
        `INSERT OR IGNORE INTO admin_audit_logs
         (id, actor_fingerprint, action, target_type, target_id,
          details_json, created_at)
         SELECT ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
         WHERE EXISTS (
           SELECT 1
           FROM upstream_credential_state s
           JOIN upstream_credentials c
             ON c.provider = s.provider
            AND c.id = s.active_credential_id
           WHERE s.provider = 'primary' AND s.managed_enabled = 1
             AND s.active_credential_id = ? AND s.version = ?
             AND s.updated_at = ?
             AND c.revoked_at IS NULL AND c.secret_hash = ?
             AND c.verified_scopes_json = ?
             AND c.verified_config_hash = ? AND c.expires_at IS ?
             AND c.verified_at = ?
         )`,
      )
      .bind(
        ...values,
        input.upstreamCredentialActivation.id,
        input.upstreamCredentialActivation.stateVersion,
        input.upstreamCredentialActivation.updatedAt,
        input.upstreamCredentialActivation.secretHash,
        input.upstreamCredentialActivation.verifiedScopesJson,
        input.upstreamCredentialActivation.verifiedConfigHash,
        input.upstreamCredentialActivation.expiresAt,
        input.upstreamCredentialActivation.verifiedAt,
      );
  }
  if (input.upstreamCredentialRevocation) {
    return db
      .prepare(
        `INSERT OR IGNORE INTO admin_audit_logs
         (id, actor_fingerprint, action, target_type, target_id,
          details_json, created_at)
         SELECT ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
         WHERE EXISTS (
           SELECT 1 FROM upstream_credentials
           WHERE id = ? AND provider = 'primary'
             AND revoked_at = ? AND encrypted_secret = 'revoked'
         )`,
      )
      .bind(
        ...values,
        input.upstreamCredentialRevocation.id,
        input.upstreamCredentialRevocation.revokedAt,
      );
  }
  return db
    .prepare(
      `INSERT OR IGNORE INTO admin_audit_logs
       (id, actor_fingerprint, action, target_type, target_id,
        details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(...values);
}

function assertSameOrigin(request: Request, env: PlatformEnv): void {
  const origin = request.headers.get("origin");
  const allowed = new Set([new URL(request.url).origin]);
  if (env.PUBLIC_APP_URL) {
    try {
      allowed.add(new URL(env.PUBLIC_APP_URL).origin);
    } catch {
      throw new PlatformError(
        500,
        "invalid_app_configuration",
        "公开站点地址配置无效。",
      );
    }
  }
  if (!origin || !allowed.has(origin)) {
    throw new PlatformError(
      403,
      "cross_site_request_blocked",
      "已阻止跨站请求。",
    );
  }
}

function canonicalAppOrigin(request: Request, env: PlatformEnv): string {
  const origin = env.PUBLIC_APP_URL
    ? new URL(env.PUBLIC_APP_URL).origin
    : new URL(request.url).origin;
  if (
    !/^https:\/\//.test(origin) &&
    !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)
  ) {
    throw new PlatformError(
      500,
      "invalid_app_configuration",
      "公开站点地址必须使用 HTTPS。",
    );
  }
  return origin;
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || null;
}

function sanitizeLabel(value: unknown): string {
  if (typeof value !== "string") return "默认密钥";
  const label = value.trim().replace(/\s+/g, " ");
  if (!label) return "默认密钥";
  if (label.length > 60) {
    throw new PlatformError(
      400,
      "invalid_key_label",
      "API Key 名称不能超过 60 个字符。",
    );
  }
  return label;
}

async function readJsonBody<T>(
  request: Request,
  limit: number,
): Promise<T> {
  const text = await readBodyText(request, limit);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isPlainRecord(parsed)) {
      throw new Error("JSON body must be an object");
    }
    return parsed as T;
  } catch {
    throw new PlatformError(
      400,
      "invalid_json",
      "请求体必须是有效的 JSON 对象。",
    );
  }
}

async function readBodyText(request: Request, limit: number): Promise<string> {
  const bytes = await readBodyBuffer(request, limit);
  return new TextDecoder().decode(bytes);
}

async function readBodyBuffer(
  request: Request,
  limit: number,
): Promise<ArrayBuffer> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw new PlatformError(413, "payload_too_large", "请求体过大。");
  }
  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("payload too large");
        throw new PlatformError(413, "payload_too_large", "请求体过大。");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw new PlatformError(400, "invalid_body", "请求体读取失败。");
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

function jsonResponse(
  data: unknown,
  status: number,
  requestId: string,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(JSON_HEADERS);
  if (extraHeaders) {
    const extra = new Headers(extraHeaders);
    extra.forEach((value, name) => headers.set(name, value));
  }
  headers.set("content-type", JSON_HEADERS["content-type"]);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-request-id", requestId);
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

function paymentWebhookAck(requestId: string): Response {
  return new Response("OK", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string,
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
        requestId,
      },
    },
    status,
    requestId,
  );
}

function resultRows<T>(result: D1Result<unknown>): T[] {
  return (result.results ?? []) as T[];
}

function firstResult<T>(result: D1Result<unknown>): T | null {
  return resultRows<T>(result)[0] ?? null;
}

function clampInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseUsdMicros(value: unknown): number | null {
  const scaled = decimalToScaledInteger(value, 6);
  if (
    scaled == null ||
    scaled < BigInt(0) ||
    scaled > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }
  return Number(scaled);
}

function compareDecimalAmounts(left: unknown, right: unknown): number {
  const leftScaled = decimalToScaledInteger(left, 18);
  const rightScaled = decimalToScaledInteger(right, 18);
  if (leftScaled == null || rightScaled == null) return -1;
  if (leftScaled === rightScaled) return 0;
  return leftScaled > rightScaled ? 1 : -1;
}

function proportionalPaymentCreditUsdMicros(
  orderUsdMicros: number,
  actualPaid: unknown,
  expectedPayAmount: unknown,
): number | null {
  if (!Number.isSafeInteger(orderUsdMicros) || orderUsdMicros <= 0) {
    return null;
  }
  const actualScaled = decimalToScaledInteger(actualPaid, 18);
  const expectedScaled = decimalToScaledInteger(expectedPayAmount, 18);
  if (
    actualScaled == null ||
    expectedScaled == null ||
    actualScaled <= BigInt(0) ||
    expectedScaled <= BigInt(0)
  ) {
    return null;
  }
  const proportional =
    (BigInt(orderUsdMicros) * actualScaled) / expectedScaled;
  const capped =
    proportional > BigInt(orderUsdMicros)
      ? BigInt(orderUsdMicros)
      : proportional;
  if (capped < BigInt(1) || capped > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(capped);
}

function isMaterialOverpayment(actual: unknown, expected: unknown): boolean {
  const actualScaled = decimalToScaledInteger(actual, 18);
  const expectedScaled = decimalToScaledInteger(expected, 18);
  if (actualScaled == null || expectedScaled == null) return false;
  const oneTokenMicroUnit = BigInt(10) ** BigInt(12);
  const oneBasisPoint = expectedScaled / BigInt(10_000);
  const tolerance =
    oneBasisPoint > oneTokenMicroUnit
      ? oneBasisPoint
      : oneTokenMicroUnit;
  return actualScaled > expectedScaled + tolerance;
}

function decimalToScaledInteger(
  value: unknown,
  precision: number,
): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > precision && /[1-9]/.test(fraction.slice(precision))) {
    return null;
  }
  const paddedFraction = fraction
    .slice(0, precision)
    .padEnd(precision, "0");
  try {
    return (
      BigInt(whole) * BigInt(10) ** BigInt(precision) +
      BigInt(paddedFraction || "0")
    );
  } catch {
    return null;
  }
}

function randomBase64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha512Hex(
  secret: string,
  value: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(signature));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    mismatch |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function sortObjectDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (!value || typeof value !== "object") return value;
  const sorted = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortObjectDeep(
      (value as Record<string, unknown>)[key],
    );
  }
  return sorted;
}

function containsUnsafeJsonNumber(value: unknown): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    visited += 1;
    if (visited > 250_000 || current.depth > 64) return true;
    if (typeof current.value === "number") {
      if (
        !Number.isFinite(current.value) ||
        (Number.isInteger(current.value) &&
          !Number.isSafeInteger(current.value))
      ) {
        return true;
      }
      continue;
    }
    const nested = Array.isArray(current.value)
      ? current.value
      : isPlainRecord(current.value)
        ? Object.values(current.value)
        : [];
    for (const item of nested) {
      stack.push({ value: item, depth: current.depth + 1 });
    }
  }
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function firstString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstCatalogPriceUsdMicros(
  record: Record<string, unknown>,
  keys: string[],
): { present: boolean; usdMicros: number | null } {
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) continue;
    const value = record[key];
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        return { present: true, usdMicros: null };
      }
      const scaled = value * 1_000_000;
      const rounded = Math.round(scaled);
      if (
        !Number.isSafeInteger(rounded) ||
        Math.abs(scaled - rounded) > 0.000001 ||
        (value > 0 && rounded === 0)
      ) {
        return { present: true, usdMicros: null };
      }
      return { present: true, usdMicros: Math.max(0, rounded) };
    }
    if (typeof value === "string") {
      const match =
        /^(0|[1-9]\d{0,2})(?:\.(\d{1,6}))?$/.exec(value);
      if (!match) return { present: true, usdMicros: null };
      const whole = Number(match[1]);
      const fraction = Number((match[2] ?? "").padEnd(6, "0"));
      const usdMicros = whole * 1_000_000 + fraction;
      return {
        present: true,
        usdMicros:
          Number.isSafeInteger(usdMicros) && usdMicros <= 100_000_000
            ? usdMicros
            : null,
      };
    }
    return { present: true, usdMicros: null };
  }
  return { present: false, usdMicros: null };
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
