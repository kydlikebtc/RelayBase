"use client";

import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type AdminTab =
  | "overview"
  | "users"
  | "upstream"
  | "catalog"
  | "payments";
type UpstreamView = "current" | "add" | "contract";
type CatalogView =
  | "routes"
  | "add"
  | "pricing"
  | "x402"
  | "consistency";
type RemoteState<T> =
  | { status: "idle" | "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

type OverviewResponse = {
  summary: {
    totalUsers: number;
    activeUsers: number;
    calls30d: number;
    successRate: number;
    grossRevenueUsdMicros: number;
    upstreamCostUsdMicros: number;
    grossMarginUsdMicros: number;
    prepaidRevenueUsdMicros: number;
    prepaidUpstreamCostUsdMicros: number;
    topupCashInUsdMicros: number;
    x402RevenueUsdMicros: number;
    x402UpstreamCostUsdMicros: number;
    x402PendingBatches: number;
    outstandingBalanceUsdMicros: number;
    manualReviewPayments: number;
  };
  recentCalls: Array<{
    id: string;
    userEmail: string;
    path: string;
    platform: string;
    statusCode: number;
    customerCostUsdMicros: number;
    upstreamCostUsdMicros: number;
    refunded: boolean;
    createdAt: string;
  }>;
  readiness: {
    ready: boolean;
    mode: string;
    missing: string[];
  };
  upstream: {
    configured: boolean;
    keyFingerprint: string | null;
    source: "managed" | "environment" | "none";
    managedEnabled: boolean;
    managedCredentialCount: number;
    stateVersion: number;
    encryptionConfigured: boolean;
    sourceConfigured: boolean;
    sourceEnabled: boolean;
    sourceVersion: number | null;
  };
  generatedAt: string;
};

type AdminRole = "owner" | "operator" | "auditor";
type AdminIdentity = {
  userId: string;
  email: string;
  displayName: string;
  role: AdminRole;
};
type AdminSessionResponse = {
  admin: AdminIdentity;
  bootstrapped?: boolean;
};

type AdminMember = AdminIdentity & {
  status: "active" | "suspended";
  grantedBy: string;
  createdAt: string;
  updatedAt: string;
};

type AdminMembersResponse = {
  members: AdminMember[];
  count: number;
};

type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  status: "active" | "suspended";
  balanceUsdMicros: number;
  calls30d: number;
  spend30dUsdMicros: number;
  lastCallAt: string | null;
  providers: string[];
  walletAddress: string | null;
  activeKeyCount: number;
  activeSessionCount: number;
  createdAt: string;
};

type UsersResponse = {
  users: AdminUser[];
  count: number;
  total: number;
  offset: number;
  nextOffset: number | null;
};

type CatalogSafetyClassification =
  | "safe_data_read"
  | "ambiguous"
  | "prohibited";
const CATALOG_DATA_TYPES = [
  "account",
  "analytics_trends",
  "comments",
  "commerce_marketing",
  "content",
  "email",
  "live",
  "media_download",
  "profile_creator",
  "search_discovery",
  "social_graph",
  "system",
  "taxonomy",
  "utility",
  "other",
] as const;
type CatalogDataType = (typeof CATALOG_DATA_TYPES)[number];
const CATALOG_SURFACES = ["app", "web", "app_web", "other"] as const;
type CatalogSurface = (typeof CATALOG_SURFACES)[number];
type CatalogDataTypeFilter = "all" | CatalogDataType;
type CatalogSurfaceFilter = "all" | CatalogSurface;
type CatalogFilterStatus = "all" | "enabled" | "disabled" | "review";
type CatalogSafetyFilter = "all" | CatalogSafetyClassification;
type CatalogMarketplaceAvailability =
  | "available"
  | "pending"
  | "restricted";
type CatalogRuntimeAvailabilityFilter =
  | "all"
  | "available"
  | "unavailable";
type CatalogBatchAction = "publish" | "reprice" | "disable";
type CatalogBatchStatus =
  | "preparing"
  | "ready"
  | "blocked"
  | "applying"
  | "applied"
  | "stale"
  | "expired";
type CatalogBatchBlockerCode =
  | "stale_endpoint"
  | "price_unverified"
  | "unsafe_operation"
  | "price_out_of_range";

type EndpointCapability = {
  executionMode:
    | "direct"
    | "native_batch"
    | "paginated"
    | "async_job"
    | "fanout";
  nativeBatchSupported: boolean;
  nativeBatchMax: number | null;
  targetField: string | null;
  targetEncoding: "json_array" | "csv_query" | "csv_body" | null;
  pagination: {
    style: "cursor" | "page" | "offset" | "mixed";
    requestField: string | null;
    responseField: string | null;
    pageSizeField: string | null;
    pageSizeMax: number | null;
    autoFollow: false;
  } | null;
  typicalItemsPerResponse: number | null;
  responseItemsPath: string | null;
  evidence: {
    status: "verified" | "openapi_inferred" | "pending";
    url: string | null;
    note: string;
    verifiedAt: string | null;
  };
  revision: number;
};

type CatalogEndpoint = {
  path: string;
  platform: string;
  method: string;
  dataType: CatalogDataType;
  tags: string[];
  surface: CatalogSurface;
  operationId: string | null;
  summary: string | null;
  description: string | null;
  parameterSchema: JsonValue | null;
  upstreamPriceUsdMicros: number;
  customerPriceUsdMicros: number;
  rateLimitRps: number | null;
  capability: EndpointCapability;
  priceVerified: boolean;
  enabled: boolean;
  readOnly: boolean;
  safetyClassification: CatalogSafetyClassification;
  safetyReasons: string[];
  safetyPolicyVersion: number;
  revision: number;
  sourceUpdatedAt: string | null;
  presentInLatestSync: boolean;
  marketplaceAvailability: CatalogMarketplaceAvailability;
  availabilityReasons: string[];
  x402: {
    enabled: boolean;
    unitPriceUsdMicros: number | null;
    maxBatchSize: number | null;
    revision: number;
  };
  reviewedAt: string | null;
  updatedAt: string;
};

type CatalogConfirmResponse = {
  ok: true;
  count: number;
  paths: string[];
};

type CatalogResponse = {
  endpoints: CatalogEndpoint[];
  count: number;
  total: number;
  offset: number;
  nextOffset: number | null;
  sync: CatalogSyncInfo | null;
};

type PendingCatalogEndpoint = {
  id: string;
  path: string;
  platform: string;
  dataType: CatalogDataType;
  surface: CatalogSurface;
  method: null;
  summary: string;
  upstreamPriceUsdMicros: number;
  customerPriceUsdMicros: number;
  priceVerified: boolean;
  rateLimit: string | null;
  rateLimitRps: number | null;
  capability: EndpointCapability;
  documentationStatus: "pending";
  callable: false;
  updatedAt: string;
};

type PendingCatalogResponse = {
  endpoints: PendingCatalogEndpoint[];
  count: number;
  total: number;
  offset: number;
  nextOffset: number | null;
};

type CatalogSyncCoverage = {
  openApiVersion: string | null;
  openApiOperations: number;
  rawPriceRows: number;
  normalizedPrices: number;
  openApiPriceMapped: number;
  priceOnly: number;
  openApiOnly: number;
  scopeExcluded: number;
  matchedPrices: number;
  positivePrices: number;
  zeroPrices: number;
  awaitingPrice: number;
  openApiSnapshotHash: string;
  priceSnapshotHash: string;
};

type CatalogSyncInfo = {
  generation: string;
  credentialFingerprint: string | null;
  syncedAt: string;
  coverage: CatalogSyncCoverage | null;
};

type CatalogBatchSelection = {
  platform: string | null;
  dataType: CatalogDataType | null;
  tag: string | null;
  surface: CatalogSurface | null;
  query: string;
  status: CatalogFilterStatus;
  safety: CatalogSafetyFilter;
};

type CatalogBatchPreviewRequest = {
  action: CatalogBatchAction;
  expectedCatalogGeneration: string;
  selection: CatalogBatchSelection;
  pricing?: {
    markupBps: number;
    minimumCustomerPriceUsdMicros: number;
  };
};

type CatalogBatchItem = {
  path: string;
  platform: string;
  method: string;
  dataType: CatalogDataType;
  tags: string[];
  surface: CatalogSurface;
  operationId: string | null;
  summary: string | null;
  expectedRevision: number;
  before: {
    upstreamPriceUsdMicros: number;
    customerPriceUsdMicros: number;
    priceVerified: boolean;
    enabled: boolean;
    readOnly: boolean;
    syncGeneration: string | null;
    reviewedAt: string | null;
    updatedAt: string;
  };
  after: {
    customerPriceUsdMicros: number;
    enabled: boolean;
    readOnly: boolean;
  };
  willChange: boolean;
  blockerCode: CatalogBatchBlockerCode | null;
  itemDigest: string;
};

type CatalogBatchResponse = {
  replayed: boolean;
  batch: {
    id: string;
    status: CatalogBatchStatus;
    version: number;
    action: CatalogBatchAction;
    catalogGeneration: string;
    counts: {
      matched: number;
      selected: number;
      blocked: number;
      stale: number;
      unverified: number;
      unsafe: number;
      noChange: number;
      priceIncrease: number;
      priceDecrease: number;
      priceUnchanged: number;
    };
    totals: {
      upstream: number;
      beforeCustomer: number;
      afterCustomer: number;
    };
    targetDigest: string;
    beforeDigest: string;
    afterDigest: string;
    confirmationText: string;
    previewedAt: string | null;
    expiresAt: string;
    appliedAt: string | null;
    applyResult: JsonValue;
  };
  items: CatalogBatchItem[];
  offset: number;
  nextOffset: number | null;
};

type UpstreamCredential = {
  id: string;
  label: string;
  fingerprint: string;
  status: "active" | "standby" | "revoked";
  routingEnabled: boolean;
  capacityGroupId: string | null;
  capacityGroupLabel: string | null;
  configuredRpsPerEndpoint: number | null;
  effectiveRpsPerEndpoint: number | null;
  priority: number;
  weight: number;
  health: {
    state:
      | "healthy"
      | "degraded"
      | "auth_failed"
      | "balance_low"
      | "circuit_open";
    consecutiveFailures: number;
    ewmaLatencyMs: number | null;
    cooldownUntil: string | null;
    lastStatusCode: number | null;
    lastErrorCode: string | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
  };
  scopeCount: number;
  expiresAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type UpstreamCapacityGroup = {
  id: string;
  label: string;
  configuredRpsPerEndpoint: number;
  headroomPercent: number;
  effectiveRpsPerEndpoint: number;
  status: "active" | "draining" | "disabled";
  credentialCount: number;
  routingCredentialCount: number;
  health15m: {
    attempts: number;
    successes: number;
    authFailures: number;
    rateLimits: number;
    averageLatencyMs: number | null;
  };
  leasedRequests: number;
  createdAt: string;
  updatedAt: string;
};

type UpstreamCredentialsResponse = {
  credentials: UpstreamCredential[];
  capacityGroups: UpstreamCapacityGroup[];
  activeSource: "managed" | "environment" | "none";
  activeCredentialId: string | null;
  activeFingerprint: string | null;
  stateVersion: number;
  managedEnabled: boolean;
  encryptionConfigured: boolean;
  environmentFallbackConfigured: boolean;
};

type CatalogAuthMode = "none" | "optional" | "required";

type UpstreamSourceConfig = {
  enabled: boolean;
  version: number;
  sourceOrigin: string;
  apiPathPrefix: string;
  openApiPath: string;
  catalogPath: string;
  credentialPath: string;
  catalogAuthMode: CatalogAuthMode;
  publicExcludedPrefixes: string[];
  updatedAt: string;
};

type UpstreamConfigResponse = {
  configured: boolean;
  config: UpstreamSourceConfig | null;
  originAllowlistConfigured: boolean;
};

type UpstreamConfigMutationResponse = {
  config: UpstreamSourceConfig;
  catalogInvalidated: true;
  credentialsRequireVerification: true;
};

type UpstreamConfigDraft = {
  enabled: boolean;
  sourceOrigin: string;
  apiPathPrefix: string;
  openApiPath: string;
  catalogPath: string;
  credentialPath: string;
  catalogAuthMode: CatalogAuthMode;
  publicExcludedPrefixesText: string;
};

type AdminPayment = {
  id: string;
  userEmail: string;
  providerPaymentId: string | null;
  amountUsdMicros: number;
  payCurrency: string;
  payAmount: string | null;
  payAddress: string | null;
  invoiceUrl: string | null;
  status: string;
  creditedUsdMicros: number;
  createdAt: string;
  updatedAt: string;
};

type PaymentsResponse = {
  payments: AdminPayment[];
  count: number;
  total: number;
  offset: number;
  nextOffset: number | null;
};

type X402Runtime = {
  configured: boolean;
  enabled: boolean;
  mode: "live" | "disabled" | "unconfigured";
  missing: string[];
  facilitatorUrl: string;
  facilitatorProvider: "cdp" | "custom";
  payTo: string | null;
};

type X402RuntimeConfiguration = {
  source: "managed" | "environment";
  managedEnabled: boolean;
  enabled: boolean;
  payTo: string | null;
  facilitatorUrl: string;
  facilitatorProvider: "cdp" | "custom";
  revision: number;
  updatedAt: string | null;
  encryptionConfigured: boolean;
  issue: string | null;
  managedCredentials: {
    cdpApiKeyIdConfigured: boolean;
    cdpApiKeyIdFingerprint: string | null;
    cdpApiKeySecretConfigured: boolean;
    cdpApiKeySecretFingerprint: string | null;
    bearerTokenConfigured: boolean;
    bearerTokenFingerprint: string | null;
  };
  environmentCredentials: {
    cdpApiKeyIdConfigured: boolean;
    cdpApiKeySecretConfigured: boolean;
    bearerTokenConfigured: boolean;
  };
};

type AdminX402Batch = {
  id: string;
  endpoint: string;
  status: string;
  verifiedQuantity: number;
  amountUsdcAtomic: number;
  upstreamCostUsdMicros: number;
  grossMarginUsdMicros: number;
  paymentStatus: string;
  revenueStatus: string;
  payer: string | null;
  transaction: string | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
};

type AdminX402Response = {
  runtime: X402Runtime;
  configuration: X402RuntimeConfiguration;
  accounting: {
    period: "30d";
    recognizedRevenueUsdMicros: number;
    prepaid: {
      recognizedUsageRevenueUsdMicros: number;
      upstreamCostUsdMicros: number;
      fulfilledCalls: number;
      topupCashInUsdMicros: number;
      topupRecognition: "deferred_balance_liability";
      recognitionTrigger: "api_call_completed_without_refund";
    };
    x402: {
      recognizedRevenueUsdMicros: number;
      upstreamCostUsdMicros: number;
      settledBatches: number;
      pendingBatches: number;
      pendingAmountUsdMicros: number;
      balanceImpactUsdMicros: 0;
      recognitionTrigger:
        "facilitator_settlement_success_with_base_transaction_hash";
    };
  };
  batches: AdminX402Batch[];
};

type X402ConfigMutationResponse = {
  config: {
    path: string;
    enabled: boolean;
    unitPriceUsdMicros: number;
    maxBatchSize: number;
    revision: number;
  };
  runtime: X402Runtime;
};

type X402RuntimeConfigMutationResponse = {
  runtime: X402Runtime;
  configuration: X402RuntimeConfiguration;
};

type X402RuntimeConfigDraft = {
  managedEnabled: boolean;
  enabled: boolean;
  payTo: string;
  facilitatorProvider: "cdp" | "custom";
  facilitatorUrl: string;
  cdpApiKeyId: string;
  cdpApiKeySecret: string;
  bearerToken: string;
};

type PaymentRecoveryResponse = {
  payment: {
    id: string;
    providerPaymentId: string | null;
    status: string;
  };
};

type PaymentReview = {
  id: string;
  orderId: string;
  userId: string;
  email: string;
  providerPaymentId: string | null;
  parentPaymentId: string | null;
  reason: string;
  status: string;
  actuallyPaid: string | null;
  payCurrency: string | null;
  evidence: JsonValue;
  createdAt: string;
};

type PaymentReviewsResponse = {
  reviews: PaymentReview[];
  count: number;
  total: number;
  status: string;
  offset: number;
  nextOffset: number | null;
};

type ReviewAction = "credit" | "refund_confirmed" | "reject";

type ConfirmAction =
  | {
      kind: "user";
      user: AdminUser;
      nextStatus: "active" | "suspended";
    }
  | {
      kind: "endpoint";
      endpoint: CatalogEndpoint;
      nextEnabled: boolean;
    }
  | {
      kind: "credential";
      credential: UpstreamCredential;
      action: "activate" | "revoke";
      expectedVersion: number;
    }
  | { kind: "sync" };

type JsonObject = Record<string, unknown>;
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
type Validator<T> = (value: unknown) => value is T;

const NAMED_ADMIN_SESSION = "__named_admin_session__";
const CATALOG_SAFETY_POLICY_VERSION = 1;
const PENDING_CATALOG_PAGE_SIZE = 50;
const ROUTE_CATALOG_PAGE_SIZE = 50;
const validPaymentStatus = /^[a-z][a-z0-9_]{0,63}$/;
const validSha256Digest = /^[a-f0-9]{64}$/;
const EMPTY_UPSTREAM_CONFIG_DRAFT: UpstreamConfigDraft = {
  enabled: false,
  sourceOrigin: "",
  apiPathPrefix: "",
  openApiPath: "",
  catalogPath: "",
  credentialPath: "",
  catalogAuthMode: "required",
  publicExcludedPrefixesText: "",
};
const readinessMissingLabels: Record<string, string> = {
  database: "数据库绑定",
  configuration: "运行配置",
  legal_review: "适用地区法律审查",
  reseller_authorization: "上游转售 / 白标授权",
  upstream_credentials: "上游活动数据源",
  admin_credentials: "管理与调度密钥",
  crypto_payments: "稳定币生产支付开关",
  commercial_clearance: "上游稳定币付款书面澄清",
  payment_provider: "支付服务商生产配置",
  authentication: "客户登录方式",
  google_authentication: "Google 登录配置",
  wallet_authentication: "钱包登录配置",
  database_migrations: "数据库迁移",
  catalog_taxonomy: "实时目录分类完整性",
  enabled_catalog: "已审核并上架的接口目录",
  scheduled_reconciliation: "五分钟内成功的自动对账",
};

function readinessMissingLabel(value: string): string {
  return readinessMissingLabels[value] ?? value;
}

class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function isFiniteRate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isNonEmptyString(value: unknown, max = 2_000): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= max
  );
}

function isNullableString(value: unknown, max = 2_000): value is string | null {
  return value === null || isNonEmptyString(value, max);
}

function isDateString(value: unknown): value is string {
  return (
    isNonEmptyString(value, 64) && Number.isFinite(Date.parse(value))
  );
}

function isAdminSessionResponse(
  value: unknown,
): value is AdminSessionResponse {
  if (!isObject(value) || !isObject(value.admin)) return false;
  const admin = value.admin;
  return (
    isNonEmptyString(admin.userId, 160) &&
    isNonEmptyString(admin.email, 320) &&
    isNonEmptyString(admin.displayName, 320) &&
    (admin.role === "owner" ||
      admin.role === "operator" ||
      admin.role === "auditor") &&
    (value.bootstrapped === undefined ||
      typeof value.bootstrapped === "boolean")
  );
}

function isAdminMembersResponse(
  value: unknown,
): value is AdminMembersResponse {
  if (
    !isObject(value) ||
    !Array.isArray(value.members) ||
    !isSafeNonNegativeInteger(value.count) ||
    value.count !== value.members.length
  ) {
    return false;
  }
  return value.members.every(
    (member) =>
      isObject(member) &&
      isNonEmptyString(member.userId, 160) &&
      isNonEmptyString(member.email, 320) &&
      isNonEmptyString(member.displayName, 320) &&
      (member.role === "owner" ||
        member.role === "operator" ||
        member.role === "auditor") &&
      (member.status === "active" || member.status === "suspended") &&
      isNonEmptyString(member.grantedBy, 320) &&
      isDateString(member.createdAt) &&
      isDateString(member.updatedAt),
  );
}

function isAdminMemberMutationResponse(
  value: unknown,
): value is {
  ok: true;
  userId: string;
  role: AdminRole;
  status: "active" | "suspended";
} {
  return (
    isObject(value) &&
    value.ok === true &&
    isNonEmptyString(value.userId, 160) &&
    (value.role === "owner" ||
      value.role === "operator" ||
      value.role === "auditor") &&
    (value.status === "active" || value.status === "suspended")
  );
}

function isNullableDateString(value: unknown): value is string | null {
  return value === null || isDateString(value);
}

function isSafePath(value: unknown): value is string {
  return (
    isNonEmptyString(value, 600) &&
    value.startsWith("/v1/") &&
    !value.includes("..") &&
    !value.includes("//")
  );
}

function isUpstreamSourceOrigin(value: unknown): value is string {
  if (!isNonEmptyString(value, 2_000)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      !url.port &&
      !url.username &&
      !url.password &&
      (url.pathname === "" || url.pathname === "/") &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function isUpstreamConfigPath(
  value: unknown,
  options: { allowEmpty?: boolean; publicPrefix?: boolean } = {},
): value is string {
  if (options.allowEmpty && value === "") return true;
  return (
    isNonEmptyString(value, 600) &&
    value.length >= 2 &&
    value.startsWith(options.publicPrefix ? "/v1/" : "/") &&
    !value.startsWith("//") &&
    !value.includes("..") &&
    !value.includes("?") &&
    !value.includes("#") &&
    !/[\u0000-\u001F\u007F]/.test(value) &&
    (!options.publicPrefix || value.endsWith("/"))
  );
}

function isCatalogAuthMode(value: unknown): value is CatalogAuthMode {
  return (
    value === "none" || value === "optional" || value === "required"
  );
}

function isUpstreamSourceConfig(
  value: unknown,
): value is UpstreamSourceConfig {
  if (!isObject(value) || !Array.isArray(value.publicExcludedPrefixes)) {
    return false;
  }
  return (
    typeof value.enabled === "boolean" &&
    isSafeNonNegativeInteger(value.version) &&
    value.version <= 2_147_483_647 &&
    isUpstreamSourceOrigin(value.sourceOrigin) &&
    isUpstreamConfigPath(value.apiPathPrefix, { allowEmpty: true }) &&
    isUpstreamConfigPath(value.openApiPath) &&
    isUpstreamConfigPath(value.catalogPath) &&
    isUpstreamConfigPath(value.credentialPath) &&
    isCatalogAuthMode(value.catalogAuthMode) &&
    value.publicExcludedPrefixes.length <= 100 &&
    value.publicExcludedPrefixes.every((prefix) =>
      isUpstreamConfigPath(prefix, { publicPrefix: true }),
    ) &&
    new Set(value.publicExcludedPrefixes).size ===
      value.publicExcludedPrefixes.length &&
    isDateString(value.updatedAt)
  );
}

function isUpstreamConfigResponse(
  value: unknown,
): value is UpstreamConfigResponse {
  if (!isObject(value)) return false;
  return (
    typeof value.configured === "boolean" &&
    typeof value.originAllowlistConfigured === "boolean" &&
    (value.config === null || isUpstreamSourceConfig(value.config)) &&
    value.configured === (value.config !== null)
  );
}

function isUpstreamConfigMutationResponse(
  value: unknown,
): value is UpstreamConfigMutationResponse {
  return (
    isObject(value) &&
    isUpstreamSourceConfig(value.config) &&
    value.catalogInvalidated === true &&
    value.credentialsRequireVerification === true
  );
}

function upstreamConfigDraftFrom(
  config: UpstreamSourceConfig | null,
): UpstreamConfigDraft {
  if (!config) return { ...EMPTY_UPSTREAM_CONFIG_DRAFT };
  return {
    enabled: config.enabled,
    sourceOrigin: config.sourceOrigin,
    apiPathPrefix: config.apiPathPrefix,
    openApiPath: config.openApiPath,
    catalogPath: config.catalogPath,
    credentialPath: config.credentialPath,
    catalogAuthMode: config.catalogAuthMode,
    publicExcludedPrefixesText:
      config.publicExcludedPrefixes.join("\n"),
  };
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 12) return false;
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return (
      value.length <= 2_000 &&
      value.every((item) => isJsonValue(item, depth + 1))
    );
  }
  if (!isObject(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= 2_000 &&
    entries.every(
      ([key, item]) =>
        key.length <= 300 && isJsonValue(item, depth + 1),
    )
  );
}

function isOverviewResponse(value: unknown): value is OverviewResponse {
  if (!isObject(value) || !isObject(value.summary)) return false;
  if (
    !Array.isArray(value.recentCalls) ||
    !isObject(value.readiness) ||
    !isObject(value.upstream)
  ) {
    return false;
  }

  const summary = value.summary;
  const readiness = value.readiness;
  const upstream = value.upstream;
  return (
    isSafeNonNegativeInteger(summary.totalUsers) &&
    isSafeNonNegativeInteger(summary.activeUsers) &&
    summary.activeUsers <= summary.totalUsers &&
    isSafeNonNegativeInteger(summary.calls30d) &&
    isFiniteRate(summary.successRate) &&
    isSafeNonNegativeInteger(summary.grossRevenueUsdMicros) &&
    isSafeNonNegativeInteger(summary.upstreamCostUsdMicros) &&
    isSafeInteger(summary.grossMarginUsdMicros) &&
    isSafeNonNegativeInteger(summary.prepaidRevenueUsdMicros) &&
    isSafeNonNegativeInteger(summary.prepaidUpstreamCostUsdMicros) &&
    isSafeNonNegativeInteger(summary.topupCashInUsdMicros) &&
    isSafeNonNegativeInteger(summary.x402RevenueUsdMicros) &&
    isSafeNonNegativeInteger(summary.x402UpstreamCostUsdMicros) &&
    isSafeNonNegativeInteger(summary.x402PendingBatches) &&
    isSafeNonNegativeInteger(summary.outstandingBalanceUsdMicros) &&
    isSafeNonNegativeInteger(summary.manualReviewPayments) &&
    typeof readiness.ready === "boolean" &&
    isNonEmptyString(readiness.mode, 64) &&
    Array.isArray(readiness.missing) &&
    readiness.missing.every((item) => isNonEmptyString(item, 128)) &&
    typeof upstream.configured === "boolean" &&
    (upstream.keyFingerprint === null ||
      isNonEmptyString(upstream.keyFingerprint, 128)) &&
    (upstream.source === "managed" ||
      upstream.source === "environment" ||
      upstream.source === "none") &&
    typeof upstream.managedEnabled === "boolean" &&
    isSafeNonNegativeInteger(upstream.managedCredentialCount) &&
    upstream.managedCredentialCount <= 100 &&
    isSafeNonNegativeInteger(upstream.stateVersion) &&
    typeof upstream.encryptionConfigured === "boolean" &&
    typeof upstream.sourceConfigured === "boolean" &&
    typeof upstream.sourceEnabled === "boolean" &&
    (!upstream.sourceEnabled || upstream.sourceConfigured) &&
    (upstream.sourceVersion === null ||
      isSafeNonNegativeInteger(upstream.sourceVersion)) &&
    (upstream.sourceConfigured
      ? upstream.sourceVersion !== null
      : upstream.sourceVersion === null) &&
    isDateString(value.generatedAt) &&
    value.recentCalls.length <= 100 &&
    value.recentCalls.every((call) => {
      if (!isObject(call)) return false;
      return (
        isNonEmptyString(call.id, 160) &&
        isNonEmptyString(call.userEmail, 320) &&
        isSafePath(call.path) &&
        isNonEmptyString(call.platform, 80) &&
        isSafeNonNegativeInteger(call.statusCode) &&
        call.statusCode <= 599 &&
        isSafeNonNegativeInteger(call.customerCostUsdMicros) &&
        isSafeNonNegativeInteger(call.upstreamCostUsdMicros) &&
        typeof call.refunded === "boolean" &&
        isDateString(call.createdAt)
      );
    })
  );
}

function isAdminUser(value: unknown): value is AdminUser {
  if (!isObject(value)) return false;
  return (
    isNonEmptyString(value.id, 160) &&
    isNonEmptyString(value.email, 320) &&
    isNonEmptyString(value.displayName, 320) &&
    (value.status === "active" || value.status === "suspended") &&
    isSafeInteger(value.balanceUsdMicros) &&
    isSafeNonNegativeInteger(value.calls30d) &&
    isSafeNonNegativeInteger(value.spend30dUsdMicros) &&
    isNullableDateString(value.lastCallAt) &&
    Array.isArray(value.providers) &&
    value.providers.length >= 1 &&
    value.providers.length <= 8 &&
    value.providers.every(
      (provider) =>
        isNonEmptyString(provider, 32) &&
        /^(google|wallet|sites)$/.test(provider),
    ) &&
    isNullableString(value.walletAddress, 128) &&
    isSafeNonNegativeInteger(value.activeKeyCount) &&
    isSafeNonNegativeInteger(value.activeSessionCount) &&
    isDateString(value.createdAt)
  );
}

function isUsersResponse(value: unknown): value is UsersResponse {
  if (!isObject(value) || !Array.isArray(value.users)) return false;
  return (
    isSafeNonNegativeInteger(value.count) &&
    value.count === value.users.length &&
    isSafeNonNegativeInteger(value.total) &&
    isSafeNonNegativeInteger(value.offset) &&
    value.offset <= 100_000 &&
    value.total >= value.offset + value.count &&
    (value.nextOffset === null ||
      (isSafeNonNegativeInteger(value.nextOffset) &&
        value.nextOffset === value.offset + value.count &&
        value.nextOffset > value.offset &&
        value.nextOffset <= 100_000)) &&
    value.users.length <= 200 &&
    value.users.every(isAdminUser)
  );
}

function isCatalogSafetyClassification(
  value: unknown,
): value is CatalogSafetyClassification {
  return (
    value === "safe_data_read" ||
    value === "ambiguous" ||
    value === "prohibited"
  );
}

function isCatalogDataType(value: unknown): value is CatalogDataType {
  return (
    typeof value === "string" &&
    CATALOG_DATA_TYPES.includes(value as CatalogDataType)
  );
}

function isCatalogSurface(value: unknown): value is CatalogSurface {
  return (
    typeof value === "string" &&
    CATALOG_SURFACES.includes(value as CatalogSurface)
  );
}

function isCatalogTag(value: unknown): value is string {
  return (
    isNonEmptyString(value, 160) &&
    value.trim() === value &&
    !/[?&#=\u0000-\u001F\u007F]/.test(value)
  );
}

function isCatalogTags(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (tag, index) =>
        isCatalogTag(tag) &&
        (index === 0 ||
          (typeof value[index - 1] === "string" &&
            (value[index - 1] as string) < tag)),
    )
  );
}

function isCatalogOperationId(value: unknown): value is string | null {
  return (
    value === null ||
    (isNonEmptyString(value, 500) &&
      value.trim() === value &&
      !/[\u0000-\u001F\u007F]/.test(value))
  );
}

function isCatalogFilterStatus(
  value: unknown,
): value is CatalogFilterStatus {
  return (
    value === "all" ||
    value === "enabled" ||
    value === "disabled" ||
    value === "review"
  );
}

function isCatalogSafetyFilter(
  value: unknown,
): value is CatalogSafetyFilter {
  return value === "all" || isCatalogSafetyClassification(value);
}

function isCatalogBatchSelection(
  value: unknown,
): value is CatalogBatchSelection {
  if (!isObject(value)) return false;
  return (
    (value.platform === null ||
      (isNonEmptyString(value.platform, 80) &&
        value.platform.trim() === value.platform &&
        value.platform.toLowerCase() === value.platform)) &&
    (value.dataType === null || isCatalogDataType(value.dataType)) &&
    (value.tag === null ||
      (isCatalogTag(value.tag) &&
        normalizeCatalogTagKey(value.tag) === value.tag)) &&
    (value.surface === null || isCatalogSurface(value.surface)) &&
    typeof value.query === "string" &&
    value.query.length <= 120 &&
    !/[\u0000-\u001F\u007F]/.test(value.query) &&
    isCatalogFilterStatus(value.status) &&
    isCatalogSafetyFilter(value.safety)
  );
}

function isEndpointCapability(
  value: unknown,
): value is EndpointCapability {
  if (!isObject(value) || !isObject(value.evidence)) return false;
  const pagination = value.pagination;
  return (
    (value.executionMode === "direct" ||
      value.executionMode === "native_batch" ||
      value.executionMode === "paginated" ||
      value.executionMode === "async_job" ||
      value.executionMode === "fanout") &&
    typeof value.nativeBatchSupported === "boolean" &&
    (value.nativeBatchMax === null ||
      (isSafeNonNegativeInteger(value.nativeBatchMax) &&
        value.nativeBatchMax >= 1 &&
        value.nativeBatchMax <= 1_000)) &&
    isNullableString(value.targetField, 120) &&
    (value.targetEncoding === null ||
      value.targetEncoding === "json_array" ||
      value.targetEncoding === "csv_query" ||
      value.targetEncoding === "csv_body") &&
    (pagination === null ||
      (isObject(pagination) &&
        (pagination.style === "cursor" ||
          pagination.style === "page" ||
          pagination.style === "offset" ||
          pagination.style === "mixed") &&
        isNullableString(pagination.requestField, 120) &&
        isNullableString(pagination.responseField, 120) &&
        isNullableString(pagination.pageSizeField, 120) &&
        (pagination.pageSizeMax === null ||
          (isSafeNonNegativeInteger(pagination.pageSizeMax) &&
            pagination.pageSizeMax >= 1 &&
            pagination.pageSizeMax <= 100_000)) &&
        pagination.autoFollow === false)) &&
    (value.typicalItemsPerResponse === null ||
      (isSafeNonNegativeInteger(value.typicalItemsPerResponse) &&
        value.typicalItemsPerResponse >= 1 &&
        value.typicalItemsPerResponse <= 100_000)) &&
    isNullableString(value.responseItemsPath, 240) &&
    (value.evidence.status === "verified" ||
      value.evidence.status === "openapi_inferred" ||
      value.evidence.status === "pending") &&
    isNullableString(value.evidence.url, 1_000) &&
    isNonEmptyString(value.evidence.note, 2_000) &&
    isNullableString(value.evidence.verifiedAt, 40) &&
    isSafeNonNegativeInteger(value.revision) &&
    value.revision >= 1
  );
}

function isCatalogEndpoint(value: unknown): value is CatalogEndpoint {
  if (!isObject(value)) return false;
  const x402 = value.x402;
  return (
    isSafePath(value.path) &&
    isNonEmptyString(value.platform, 80) &&
    isNonEmptyString(value.method, 16) &&
    /^[A-Z]+$/.test(value.method) &&
    isCatalogDataType(value.dataType) &&
    isCatalogTags(value.tags) &&
    isCatalogSurface(value.surface) &&
    isCatalogOperationId(value.operationId) &&
    isNullableString(value.summary, 1_000) &&
    isNullableString(value.description, 10_000) &&
    (value.parameterSchema === null || isJsonValue(value.parameterSchema)) &&
    isSafeNonNegativeInteger(value.upstreamPriceUsdMicros) &&
    isSafeNonNegativeInteger(value.customerPriceUsdMicros) &&
    (value.rateLimitRps === null ||
      (isSafeNonNegativeInteger(value.rateLimitRps) &&
        value.rateLimitRps >= 1 &&
        value.rateLimitRps <= 1_000_000)) &&
    isEndpointCapability(value.capability) &&
    typeof value.priceVerified === "boolean" &&
    typeof value.enabled === "boolean" &&
    typeof value.readOnly === "boolean" &&
    isCatalogSafetyClassification(value.safetyClassification) &&
    Array.isArray(value.safetyReasons) &&
    value.safetyReasons.length <= 32 &&
    value.safetyReasons.every((reason) => isNonEmptyString(reason, 160)) &&
    isSafeNonNegativeInteger(value.safetyPolicyVersion) &&
    value.safetyPolicyVersion <= 2_147_483_647 &&
    isSafeNonNegativeInteger(value.revision) &&
    value.revision <= 2_147_483_647 &&
    isNullableDateString(value.sourceUpdatedAt) &&
    typeof value.presentInLatestSync === "boolean" &&
    (value.marketplaceAvailability === "available" ||
      value.marketplaceAvailability === "pending" ||
      value.marketplaceAvailability === "restricted") &&
    Array.isArray(value.availabilityReasons) &&
    value.availabilityReasons.length <= 16 &&
    value.availabilityReasons.every((reason) =>
      isNonEmptyString(reason, 80),
    ) &&
    isObject(x402) &&
    typeof x402.enabled === "boolean" &&
    (x402.unitPriceUsdMicros === null ||
      isSafeNonNegativeInteger(x402.unitPriceUsdMicros)) &&
    (x402.maxBatchSize === null ||
      (isSafeNonNegativeInteger(x402.maxBatchSize) &&
        x402.maxBatchSize >= 1 &&
        x402.maxBatchSize <= 1_000)) &&
    isSafeNonNegativeInteger(x402.revision) &&
    isNullableDateString(value.reviewedAt) &&
    isDateString(value.updatedAt)
  );
}

function isCatalogSyncCoverage(
  value: unknown,
): value is CatalogSyncCoverage {
  if (!isObject(value)) return false;
  return (
    isNullableString(value.openApiVersion, 80) &&
    isSafeNonNegativeInteger(value.openApiOperations) &&
    value.openApiOperations <= 5_000 &&
    isSafeNonNegativeInteger(value.rawPriceRows) &&
    value.rawPriceRows <= 100_000 &&
    isSafeNonNegativeInteger(value.normalizedPrices) &&
    value.normalizedPrices <= value.rawPriceRows &&
    isSafeNonNegativeInteger(value.openApiPriceMapped) &&
    value.openApiPriceMapped <= value.normalizedPrices &&
    value.openApiPriceMapped <= value.openApiOperations &&
    isSafeNonNegativeInteger(value.priceOnly) &&
    value.priceOnly ===
      value.normalizedPrices - value.openApiPriceMapped &&
    isSafeNonNegativeInteger(value.openApiOnly) &&
    value.openApiOnly ===
      value.openApiOperations - value.openApiPriceMapped &&
    isSafeNonNegativeInteger(value.scopeExcluded) &&
    value.scopeExcluded <= value.openApiPriceMapped &&
    isSafeNonNegativeInteger(value.matchedPrices) &&
    value.matchedPrices ===
      value.openApiPriceMapped - value.scopeExcluded &&
    isSafeNonNegativeInteger(value.positivePrices) &&
    isSafeNonNegativeInteger(value.zeroPrices) &&
    value.positivePrices + value.zeroPrices === value.matchedPrices &&
    isSafeNonNegativeInteger(value.awaitingPrice) &&
    value.matchedPrices + value.awaitingPrice === value.openApiOperations &&
    typeof value.openApiSnapshotHash === "string" &&
    /^[a-f0-9]{64}$/.test(value.openApiSnapshotHash) &&
    typeof value.priceSnapshotHash === "string" &&
    /^[a-f0-9]{64}$/.test(value.priceSnapshotHash)
  );
}

function isCatalogSyncInfo(value: unknown): value is CatalogSyncInfo {
  if (!isObject(value)) return false;
  return (
    isNonEmptyString(value.generation, 128) &&
    /^sync_[A-Za-z0-9_-]{16,80}$/.test(value.generation) &&
    (value.credentialFingerprint === null ||
      (typeof value.credentialFingerprint === "string" &&
        /^[a-f0-9]{16}$/.test(value.credentialFingerprint))) &&
    isDateString(value.syncedAt) &&
    (value.coverage === null || isCatalogSyncCoverage(value.coverage))
  );
}

function isCatalogResponse(value: unknown): value is CatalogResponse {
  if (!isObject(value) || !Array.isArray(value.endpoints)) return false;
  return (
    isSafeNonNegativeInteger(value.count) &&
    value.count === value.endpoints.length &&
    isSafeNonNegativeInteger(value.total) &&
    isSafeNonNegativeInteger(value.offset) &&
    value.offset <= 5_000 &&
    value.total >= value.offset + value.count &&
    (value.nextOffset === null ||
      (isSafeNonNegativeInteger(value.nextOffset) &&
        value.nextOffset === value.offset + value.count &&
        value.nextOffset > value.offset &&
        value.nextOffset <= 5_000)) &&
    (value.sync === null || isCatalogSyncInfo(value.sync)) &&
    value.endpoints.length <= 500 &&
    value.endpoints.every(isCatalogEndpoint)
  );
}

function isPendingCatalogEndpoint(
  value: unknown,
): value is PendingCatalogEndpoint {
  if (!isObject(value)) return false;
  return (
    isNonEmptyString(value.id, 200) &&
    isSafePath(value.path) &&
    isNonEmptyString(value.platform, 80) &&
    isCatalogDataType(value.dataType) &&
    isCatalogSurface(value.surface) &&
    value.method === null &&
    isNonEmptyString(value.summary, 1_000) &&
    isSafeNonNegativeInteger(value.upstreamPriceUsdMicros) &&
    value.upstreamPriceUsdMicros <= 100_000_000 &&
    isSafeNonNegativeInteger(value.customerPriceUsdMicros) &&
    value.customerPriceUsdMicros <= 100_000_000 &&
    value.customerPriceUsdMicros >= value.upstreamPriceUsdMicros &&
    typeof value.priceVerified === "boolean" &&
    isNullableString(value.rateLimit, 160) &&
    (value.rateLimitRps === null ||
      (typeof value.rateLimitRps === "number" &&
        Number.isFinite(value.rateLimitRps) &&
        value.rateLimitRps >= 0 &&
        value.rateLimitRps <= 1_000_000)) &&
    isEndpointCapability(value.capability) &&
    value.documentationStatus === "pending" &&
    value.callable === false &&
    isDateString(value.updatedAt)
  );
}

function isPendingCatalogResponse(
  value: unknown,
): value is PendingCatalogResponse {
  if (!isObject(value) || !Array.isArray(value.endpoints)) return false;
  return (
    isSafeNonNegativeInteger(value.count) &&
    value.count === value.endpoints.length &&
    isSafeNonNegativeInteger(value.total) &&
    isSafeNonNegativeInteger(value.offset) &&
    value.offset <= 100_000 &&
    value.total >= value.offset + value.count &&
    (value.nextOffset === null ||
      (isSafeNonNegativeInteger(value.nextOffset) &&
        value.nextOffset === value.offset + value.count &&
        value.nextOffset > value.offset &&
        value.nextOffset <= 100_000)) &&
    value.endpoints.length <= 500 &&
    value.endpoints.every(isPendingCatalogEndpoint)
  );
}

function isCatalogBatchAction(value: unknown): value is CatalogBatchAction {
  return value === "publish" || value === "reprice" || value === "disable";
}

function isCatalogBatchStatus(value: unknown): value is CatalogBatchStatus {
  return (
    value === "preparing" ||
    value === "ready" ||
    value === "blocked" ||
    value === "applying" ||
    value === "applied" ||
    value === "stale" ||
    value === "expired"
  );
}

function isCatalogBatchBlockerCode(
  value: unknown,
): value is CatalogBatchBlockerCode {
  return (
    value === "stale_endpoint" ||
    value === "price_unverified" ||
    value === "unsafe_operation" ||
    value === "price_out_of_range"
  );
}

function isCatalogBatchItem(value: unknown): value is CatalogBatchItem {
  if (
    !isObject(value) ||
    !isObject(value.before) ||
    !isObject(value.after)
  ) {
    return false;
  }
  const before = value.before;
  const after = value.after;
  const blockerIsValid =
    value.blockerCode === null ||
    isCatalogBatchBlockerCode(value.blockerCode);
  return (
    isSafePath(value.path) &&
    isNonEmptyString(value.platform, 80) &&
    isNonEmptyString(value.method, 16) &&
    /^[A-Z]+$/.test(value.method) &&
    isCatalogDataType(value.dataType) &&
    isCatalogTags(value.tags) &&
    isCatalogSurface(value.surface) &&
    isCatalogOperationId(value.operationId) &&
    isNullableString(value.summary, 1_000) &&
    isSafeNonNegativeInteger(value.expectedRevision) &&
    value.expectedRevision <= 2_147_483_647 &&
    isSafeNonNegativeInteger(before.upstreamPriceUsdMicros) &&
    isSafeNonNegativeInteger(before.customerPriceUsdMicros) &&
    typeof before.priceVerified === "boolean" &&
    typeof before.enabled === "boolean" &&
    typeof before.readOnly === "boolean" &&
    (before.syncGeneration === null ||
      (isNonEmptyString(before.syncGeneration, 128) &&
        /^sync_[A-Za-z0-9_-]{16,80}$/.test(before.syncGeneration))) &&
    isNullableDateString(before.reviewedAt) &&
    isDateString(before.updatedAt) &&
    isSafeNonNegativeInteger(after.customerPriceUsdMicros) &&
    typeof after.enabled === "boolean" &&
    typeof after.readOnly === "boolean" &&
    typeof value.willChange === "boolean" &&
    blockerIsValid &&
    (!value.willChange || value.blockerCode === null) &&
    (value.blockerCode === null || value.willChange === false) &&
    isNonEmptyString(value.itemDigest, 64) &&
    validSha256Digest.test(value.itemDigest)
  );
}

function isCatalogBatchResponse(
  value: unknown,
): value is CatalogBatchResponse {
  if (
    !isObject(value) ||
    !isObject(value.batch) ||
    !Array.isArray(value.items)
  ) {
    return false;
  }
  const batch = value.batch;
  if (!isObject(batch.counts) || !isObject(batch.totals)) return false;
  const counts = batch.counts;
  const totals = batch.totals;
  if (
    !isSafeNonNegativeInteger(counts.matched) ||
    !isSafeNonNegativeInteger(counts.selected) ||
    !isSafeNonNegativeInteger(counts.blocked) ||
    !isSafeNonNegativeInteger(counts.stale) ||
    !isSafeNonNegativeInteger(counts.unverified) ||
    !isSafeNonNegativeInteger(counts.unsafe) ||
    !isSafeNonNegativeInteger(counts.noChange) ||
    !isSafeNonNegativeInteger(counts.priceIncrease) ||
    !isSafeNonNegativeInteger(counts.priceDecrease) ||
    !isSafeNonNegativeInteger(counts.priceUnchanged) ||
    counts.selected + counts.blocked + counts.noChange !== counts.matched ||
    counts.stale + counts.unverified + counts.unsafe > counts.blocked ||
    counts.priceIncrease + counts.priceDecrease + counts.priceUnchanged !==
      counts.matched
  ) {
    return false;
  }
  if (
    !isSafeNonNegativeInteger(totals.upstream) ||
    !isSafeNonNegativeInteger(totals.beforeCustomer) ||
    !isSafeNonNegativeInteger(totals.afterCustomer)
  ) {
    return false;
  }
  if (
    !isCatalogBatchAction(batch.action) ||
    !isCatalogBatchStatus(batch.status) ||
    !isNonEmptyString(batch.catalogGeneration, 128) ||
    !/^sync_[A-Za-z0-9_-]{16,80}$/.test(batch.catalogGeneration)
  ) {
    return false;
  }
  const expectedConfirmation =
    `APPLY ${batch.action.toUpperCase()} ` +
    `${counts.selected}/${counts.matched} ` +
    `${typeof batch.targetDigest === "string" ? batch.targetDigest.slice(0, 12) : ""} ` +
    `${batch.catalogGeneration.slice(-12)}`;
  const previewStateIsValid =
    batch.status === "preparing"
      ? batch.previewedAt === null
      : isDateString(batch.previewedAt);
  const applyStateIsValid =
    batch.status === "applied"
      ? isDateString(batch.appliedAt) && batch.applyResult !== null
      : batch.appliedAt === null && batch.applyResult === null;
  const readyStateIsValid =
    batch.status !== "ready" ||
    (counts.matched > 0 && counts.selected > 0 && counts.blocked === 0);
  if (
    typeof value.replayed !== "boolean" ||
    !isNonEmptyString(batch.id, 84) ||
    !/^cbp_[A-Za-z0-9_-]{20,80}$/.test(batch.id) ||
    !isSafeNonNegativeInteger(batch.version) ||
    !isNonEmptyString(batch.targetDigest, 64) ||
    !validSha256Digest.test(batch.targetDigest) ||
    !isNonEmptyString(batch.beforeDigest, 64) ||
    !validSha256Digest.test(batch.beforeDigest) ||
    !isNonEmptyString(batch.afterDigest, 64) ||
    !validSha256Digest.test(batch.afterDigest) ||
    batch.confirmationText !== expectedConfirmation ||
    !previewStateIsValid ||
    !isDateString(batch.expiresAt) ||
    !applyStateIsValid ||
    !readyStateIsValid ||
    !isJsonValue(batch.applyResult) ||
    !isSafeNonNegativeInteger(value.offset) ||
    value.offset > counts.matched ||
    value.items.length > 100 ||
    !value.items.every(isCatalogBatchItem) ||
    new Set(value.items.map((item) => item.path)).size !== value.items.length
  ) {
    return false;
  }
  const expectedNextOffset =
    value.offset + value.items.length < counts.matched
      ? value.offset + value.items.length
      : null;
  return value.nextOffset === expectedNextOffset;
}

function isUpstreamCredential(value: unknown): value is UpstreamCredential {
  if (!isObject(value)) return false;
  const health = value.health;
  return (
    isNonEmptyString(value.id, 100) &&
    /^upc_[A-Za-z0-9_-]{16,80}$/.test(value.id) &&
    isNonEmptyString(value.label, 80) &&
    isNonEmptyString(value.fingerprint, 32) &&
    /^[a-f0-9]{16}$/.test(value.fingerprint) &&
    (value.status === "active" ||
      value.status === "standby" ||
      value.status === "revoked") &&
    typeof value.routingEnabled === "boolean" &&
    (value.capacityGroupId === null ||
      (isNonEmptyString(value.capacityGroupId, 100) &&
        /^upg_[A-Za-z0-9_-]{12,80}$/.test(value.capacityGroupId))) &&
    isNullableString(value.capacityGroupLabel, 80) &&
    (value.configuredRpsPerEndpoint === null ||
      (isSafeNonNegativeInteger(value.configuredRpsPerEndpoint) &&
        value.configuredRpsPerEndpoint >= 1 &&
        value.configuredRpsPerEndpoint <= 10_000)) &&
    (value.effectiveRpsPerEndpoint === null ||
      (isSafeNonNegativeInteger(value.effectiveRpsPerEndpoint) &&
        value.effectiveRpsPerEndpoint >= 1 &&
        value.effectiveRpsPerEndpoint <= 10_000)) &&
    isSafeNonNegativeInteger(value.priority) &&
    value.priority >= 1 &&
    value.priority <= 10_000 &&
    isSafeNonNegativeInteger(value.weight) &&
    value.weight >= 1 &&
    value.weight <= 10_000 &&
    isObject(health) &&
    (health.state === "healthy" ||
      health.state === "degraded" ||
      health.state === "auth_failed" ||
      health.state === "balance_low" ||
      health.state === "circuit_open") &&
    isSafeNonNegativeInteger(health.consecutiveFailures) &&
    (health.ewmaLatencyMs === null ||
      isSafeNonNegativeInteger(health.ewmaLatencyMs)) &&
    isNullableDateString(health.cooldownUntil) &&
    (health.lastStatusCode === null ||
      (isSafeNonNegativeInteger(health.lastStatusCode) &&
        health.lastStatusCode <= 599)) &&
    isNullableString(health.lastErrorCode, 100) &&
    isNullableDateString(health.lastSuccessAt) &&
    isNullableDateString(health.lastFailureAt) &&
    isSafeNonNegativeInteger(value.scopeCount) &&
    value.scopeCount <= 500 &&
    isNullableDateString(value.expiresAt) &&
    isNullableDateString(value.verifiedAt) &&
    isDateString(value.createdAt) &&
    isNullableDateString(value.lastUsedAt) &&
    isNullableDateString(value.revokedAt)
  );
}

function isUpstreamCapacityGroup(
  value: unknown,
): value is UpstreamCapacityGroup {
  return (
    isObject(value) &&
    isNonEmptyString(value.id, 100) &&
    /^upg_[A-Za-z0-9_-]{12,80}$/.test(value.id) &&
    isNonEmptyString(value.label, 80) &&
    isSafeNonNegativeInteger(value.configuredRpsPerEndpoint) &&
    value.configuredRpsPerEndpoint >= 1 &&
    value.configuredRpsPerEndpoint <= 10_000 &&
    typeof value.headroomPercent === "number" &&
    Number.isFinite(value.headroomPercent) &&
    value.headroomPercent >= 10 &&
    value.headroomPercent <= 100 &&
    isSafeNonNegativeInteger(value.effectiveRpsPerEndpoint) &&
    value.effectiveRpsPerEndpoint >= 1 &&
    value.effectiveRpsPerEndpoint <= value.configuredRpsPerEndpoint &&
    (value.status === "active" ||
      value.status === "draining" ||
      value.status === "disabled") &&
    isSafeNonNegativeInteger(value.credentialCount) &&
    isSafeNonNegativeInteger(value.routingCredentialCount) &&
    value.routingCredentialCount <= value.credentialCount &&
    isObject(value.health15m) &&
    isSafeNonNegativeInteger(value.health15m.attempts) &&
    isSafeNonNegativeInteger(value.health15m.successes) &&
    value.health15m.successes <= value.health15m.attempts &&
    isSafeNonNegativeInteger(value.health15m.authFailures) &&
    value.health15m.authFailures <= value.health15m.attempts &&
    isSafeNonNegativeInteger(value.health15m.rateLimits) &&
    value.health15m.rateLimits <= value.health15m.attempts &&
    (value.health15m.averageLatencyMs === null ||
      isSafeNonNegativeInteger(value.health15m.averageLatencyMs)) &&
    isSafeNonNegativeInteger(value.leasedRequests) &&
    isDateString(value.createdAt) &&
    isDateString(value.updatedAt)
  );
}

function isUpstreamCredentialsResponse(
  value: unknown,
): value is UpstreamCredentialsResponse {
  if (
    !isObject(value) ||
    !Array.isArray(value.credentials) ||
    !Array.isArray(value.capacityGroups)
  ) {
    return false;
  }
  const activeCredentials = value.credentials.filter(
    (credential) =>
      isObject(credential) && credential.status === "active",
  );
  const activeCredential =
    activeCredentials.length === 1 &&
    isUpstreamCredential(activeCredentials[0])
      ? activeCredentials[0]
      : null;
  const credentialStatesAreConsistent = value.credentials.every(
    (credential) =>
      isUpstreamCredential(credential) &&
      ((credential.status === "revoked") ===
        (credential.revokedAt !== null)) &&
      (credential.status !== "active" ||
        credential.verifiedAt !== null),
  );
  return (
    value.credentials.length <= 100 &&
    value.credentials.every(isUpstreamCredential) &&
    value.capacityGroups.length <= 100 &&
    value.capacityGroups.every(isUpstreamCapacityGroup) &&
    (value.activeSource === "managed" ||
      value.activeSource === "environment" ||
      value.activeSource === "none") &&
    (value.activeCredentialId === null ||
      (isNonEmptyString(value.activeCredentialId, 100) &&
        /^upc_[A-Za-z0-9_-]{16,80}$/.test(value.activeCredentialId))) &&
    (value.activeFingerprint === null ||
      (isNonEmptyString(value.activeFingerprint, 32) &&
        /^[a-f0-9]{16}$/.test(value.activeFingerprint))) &&
    isSafeNonNegativeInteger(value.stateVersion) &&
    typeof value.managedEnabled === "boolean" &&
    typeof value.encryptionConfigured === "boolean" &&
    typeof value.environmentFallbackConfigured === "boolean" &&
    credentialStatesAreConsistent &&
    activeCredentials.length <= 1 &&
    (value.activeSource !== "managed" ||
      (activeCredential !== null &&
        activeCredential.id === value.activeCredentialId &&
        activeCredential.fingerprint === value.activeFingerprint))
  );
}

function isUpstreamCredentialMutationResponse(
  value: unknown,
): value is {
  credential: UpstreamCredential;
  verified?: boolean;
  activationConflict?: boolean;
} {
  return (
    isObject(value) &&
    isUpstreamCredential(value.credential) &&
    (value.verified === undefined || typeof value.verified === "boolean") &&
    (value.activationConflict === undefined ||
      typeof value.activationConflict === "boolean")
  );
}

function isAdminPayment(value: unknown): value is AdminPayment {
  if (!isObject(value)) return false;
  return (
    isNonEmptyString(value.id, 160) &&
    isNonEmptyString(value.userEmail, 320) &&
    isNullableString(value.providerPaymentId, 160) &&
    isSafeNonNegativeInteger(value.amountUsdMicros) &&
    isNonEmptyString(value.payCurrency, 64) &&
    isNullableString(value.payAmount, 128) &&
    isNullableString(value.payAddress, 512) &&
    isNullableString(value.invoiceUrl, 2_000) &&
    isNonEmptyString(value.status, 64) &&
    validPaymentStatus.test(value.status) &&
    isSafeNonNegativeInteger(value.creditedUsdMicros) &&
    isDateString(value.createdAt) &&
    isDateString(value.updatedAt)
  );
}

function isPaymentsResponse(value: unknown): value is PaymentsResponse {
  if (!isObject(value) || !Array.isArray(value.payments)) return false;
  return (
    isSafeNonNegativeInteger(value.count) &&
    value.count === value.payments.length &&
    isSafeNonNegativeInteger(value.total) &&
    isSafeNonNegativeInteger(value.offset) &&
    value.total >= value.offset + value.count &&
    (value.nextOffset === null ||
      (isSafeNonNegativeInteger(value.nextOffset) &&
        value.nextOffset === value.offset + value.count &&
        value.nextOffset > value.offset &&
        value.nextOffset <= 100_000)) &&
    value.payments.length <= 200 &&
    value.payments.every(isAdminPayment)
  );
}

function isX402Runtime(value: unknown): value is X402Runtime {
  return (
    isObject(value) &&
    typeof value.configured === "boolean" &&
    typeof value.enabled === "boolean" &&
    (value.mode === "live" ||
      value.mode === "disabled" ||
      value.mode === "unconfigured") &&
    Array.isArray(value.missing) &&
    value.missing.length <= 16 &&
    value.missing.every((item) => isNonEmptyString(item, 100)) &&
    isNonEmptyString(value.facilitatorUrl, 2_000) &&
    (value.facilitatorProvider === "cdp" ||
      value.facilitatorProvider === "custom") &&
    isNullableString(value.payTo, 80)
  );
}

function isX402RuntimeConfiguration(
  value: unknown,
): value is X402RuntimeConfiguration {
  if (
    !isObject(value) ||
    (value.source !== "managed" && value.source !== "environment") ||
    typeof value.managedEnabled !== "boolean" ||
    typeof value.enabled !== "boolean" ||
    !isNullableString(value.payTo, 80) ||
    !isNonEmptyString(value.facilitatorUrl, 2_000) ||
    (value.facilitatorProvider !== "cdp" &&
      value.facilitatorProvider !== "custom") ||
    !isSafeNonNegativeInteger(value.revision) ||
    !isNullableString(value.updatedAt, 80) ||
    typeof value.encryptionConfigured !== "boolean" ||
    !isNullableString(value.issue, 100) ||
    !isObject(value.managedCredentials) ||
    !isObject(value.environmentCredentials)
  ) {
    return false;
  }
  const managed = value.managedCredentials;
  const environment = value.environmentCredentials;
  return (
    typeof managed.cdpApiKeyIdConfigured === "boolean" &&
    isNullableString(managed.cdpApiKeyIdFingerprint, 32) &&
    typeof managed.cdpApiKeySecretConfigured === "boolean" &&
    isNullableString(managed.cdpApiKeySecretFingerprint, 32) &&
    typeof managed.bearerTokenConfigured === "boolean" &&
    isNullableString(managed.bearerTokenFingerprint, 32) &&
    typeof environment.cdpApiKeyIdConfigured === "boolean" &&
    typeof environment.cdpApiKeySecretConfigured === "boolean" &&
    typeof environment.bearerTokenConfigured === "boolean"
  );
}

function isAdminX402Batch(value: unknown): value is AdminX402Batch {
  return (
    isObject(value) &&
    isNonEmptyString(value.id, 100) &&
    /^xb_[A-Za-z0-9_-]{20,80}$/.test(value.id) &&
    isSafePath(value.endpoint) &&
    isNonEmptyString(value.status, 40) &&
    isSafeNonNegativeInteger(value.verifiedQuantity) &&
    isSafeNonNegativeInteger(value.amountUsdcAtomic) &&
    isSafeNonNegativeInteger(value.upstreamCostUsdMicros) &&
    isSafeInteger(value.grossMarginUsdMicros) &&
    isNonEmptyString(value.paymentStatus, 40) &&
    isNonEmptyString(value.revenueStatus, 40) &&
    isNullableString(value.payer, 80) &&
    isNullableString(value.transaction, 100) &&
    isNullableString(value.failureCode, 100) &&
    isDateString(value.createdAt) &&
    isDateString(value.updatedAt)
  );
}

function isAdminX402Response(
  value: unknown,
): value is AdminX402Response {
  if (
    !isObject(value) ||
    !isX402Runtime(value.runtime) ||
    !isX402RuntimeConfiguration(value.configuration)
  ) {
    return false;
  }
  const accounting = value.accounting;
  if (
    !isObject(accounting) ||
    !isObject(accounting.prepaid) ||
    !isObject(accounting.x402) ||
    !Array.isArray(value.batches)
  ) {
    return false;
  }
  const prepaid = accounting.prepaid;
  const x402 = accounting.x402;
  return (
    accounting.period === "30d" &&
    isSafeNonNegativeInteger(accounting.recognizedRevenueUsdMicros) &&
    isSafeNonNegativeInteger(prepaid.recognizedUsageRevenueUsdMicros) &&
    isSafeNonNegativeInteger(prepaid.upstreamCostUsdMicros) &&
    isSafeNonNegativeInteger(prepaid.fulfilledCalls) &&
    isSafeNonNegativeInteger(prepaid.topupCashInUsdMicros) &&
    prepaid.topupRecognition === "deferred_balance_liability" &&
    prepaid.recognitionTrigger === "api_call_completed_without_refund" &&
    isSafeNonNegativeInteger(x402.recognizedRevenueUsdMicros) &&
    isSafeNonNegativeInteger(x402.upstreamCostUsdMicros) &&
    isSafeNonNegativeInteger(x402.settledBatches) &&
    isSafeNonNegativeInteger(x402.pendingBatches) &&
    isSafeNonNegativeInteger(x402.pendingAmountUsdMicros) &&
    x402.balanceImpactUsdMicros === 0 &&
    x402.recognitionTrigger ===
      "facilitator_settlement_success_with_base_transaction_hash" &&
    value.batches.length <= 200 &&
    value.batches.every(isAdminX402Batch)
  );
}

function isX402RuntimeConfigMutationResponse(
  value: unknown,
): value is X402RuntimeConfigMutationResponse {
  return (
    isObject(value) &&
    isX402Runtime(value.runtime) &&
    isX402RuntimeConfiguration(value.configuration)
  );
}

function isX402ConfigMutationResponse(
  value: unknown,
): value is X402ConfigMutationResponse {
  return (
    isObject(value) &&
    isObject(value.config) &&
    isSafePath(value.config.path) &&
    typeof value.config.enabled === "boolean" &&
    isSafeNonNegativeInteger(value.config.unitPriceUsdMicros) &&
    isSafeNonNegativeInteger(value.config.maxBatchSize) &&
    value.config.maxBatchSize >= 1 &&
    value.config.maxBatchSize <= 1_000 &&
    isSafeNonNegativeInteger(value.config.revision) &&
    isX402Runtime(value.runtime)
  );
}

function isPaymentRecoveryResponse(
  value: unknown,
): value is PaymentRecoveryResponse {
  if (!isObject(value) || !isObject(value.payment)) return false;
  return (
    isNonEmptyString(value.payment.id, 180) &&
    isNullableString(value.payment.providerPaymentId, 160) &&
    isNonEmptyString(value.payment.status, 64) &&
    validPaymentStatus.test(value.payment.status)
  );
}

function isPaymentReview(value: unknown): value is PaymentReview {
  if (!isObject(value)) return false;
  return (
    isNonEmptyString(value.id, 180) &&
    isNonEmptyString(value.orderId, 180) &&
    isNonEmptyString(value.userId, 180) &&
    isNonEmptyString(value.email, 320) &&
    isNullableString(value.providerPaymentId, 180) &&
    isNullableString(value.parentPaymentId, 180) &&
    isNonEmptyString(value.reason, 128) &&
    /^[a-z][a-z0-9_]{0,127}$/.test(value.reason) &&
    isNonEmptyString(value.status, 32) &&
    /^(?:open|resolved)$/.test(value.status) &&
    isNullableString(value.actuallyPaid, 128) &&
    isNullableString(value.payCurrency, 64) &&
    isJsonValue(value.evidence) &&
    isDateString(value.createdAt)
  );
}

function isPaymentReviewsResponse(
  value: unknown,
): value is PaymentReviewsResponse {
  if (!isObject(value) || !Array.isArray(value.reviews)) return false;
  return (
    isSafeNonNegativeInteger(value.count) &&
    value.count === value.reviews.length &&
    isSafeNonNegativeInteger(value.total) &&
    isSafeNonNegativeInteger(value.offset) &&
    value.total >= value.offset + value.count &&
    value.status === "open" &&
    (value.nextOffset === null ||
      (isSafeNonNegativeInteger(value.nextOffset) &&
        value.nextOffset === value.offset + value.count &&
        value.nextOffset > value.offset &&
        value.nextOffset <= 100_000)) &&
    value.reviews.length <= 200 &&
    value.reviews.every(isPaymentReview)
  );
}

function isReviewResolveResponse(
  value: unknown,
): value is {
  ok: true;
  caseId: string;
  status: "resolved";
  action: ReviewAction;
} {
  return (
    isObject(value) &&
    value.ok === true &&
    isNonEmptyString(value.caseId, 180) &&
    value.status === "resolved" &&
    (value.action === "credit" ||
      value.action === "refund_confirmed" ||
      value.action === "reject")
  );
}

function isCatalogUpdateResponse(
  value: unknown,
): value is {
  ok: true;
  path: string;
  enabled: boolean;
  readOnly: boolean;
  revision: number;
} {
  return (
    isObject(value) &&
    value.ok === true &&
    isSafePath(value.path) &&
    typeof value.enabled === "boolean" &&
    typeof value.readOnly === "boolean" &&
    isSafeNonNegativeInteger(value.revision) &&
    value.revision <= 2_147_483_647
  );
}

function isCatalogConfirmResponse(
  value: unknown,
): value is CatalogConfirmResponse {
  return (
    isObject(value) &&
    value.ok === true &&
    isSafeNonNegativeInteger(value.count) &&
    value.count >= 1 &&
    value.count <= 100 &&
    Array.isArray(value.paths) &&
    value.paths.length === value.count &&
    value.paths.every(isSafePath) &&
    new Set(value.paths).size === value.paths.length
  );
}

function isPendingCatalogPriceUpdateResponse(
  value: unknown,
): value is {
  ok: true;
  path: string;
  customerPriceUsdMicros: number;
  updatedAt: string;
  callable: false;
  documentationStatus: "pending";
} {
  return (
    isObject(value) &&
    value.ok === true &&
    isSafePath(value.path) &&
    isSafeNonNegativeInteger(value.customerPriceUsdMicros) &&
    value.customerPriceUsdMicros <= 100_000_000 &&
    isDateString(value.updatedAt) &&
    value.callable === false &&
    value.documentationStatus === "pending"
  );
}

function isCatalogSyncResponse(
  value: unknown,
): value is {
  synced: number;
  pendingDocumentation: number;
  openApiVersion: string | null;
  openApiOperations: number;
  rawPriceRows: number;
  normalizedPrices: number;
  openApiPriceMapped: number;
  priceOnly: number;
  openApiOnly: number;
  scopeExcluded: number;
  priced: number;
  positivePrice: number;
  zeroPrice: number;
  awaitingPrice: number;
  openApiSnapshotHash: string;
  priceSnapshotHash: string;
  disabledMissing: number;
  note: string;
} {
  return (
    isObject(value) &&
    isSafeNonNegativeInteger(value.synced) &&
    isSafeNonNegativeInteger(value.pendingDocumentation) &&
    value.pendingDocumentation <= 100_000 &&
    isNullableString(value.openApiVersion, 80) &&
    isSafeNonNegativeInteger(value.openApiOperations) &&
    value.openApiOperations === value.synced &&
    isSafeNonNegativeInteger(value.rawPriceRows) &&
    isSafeNonNegativeInteger(value.normalizedPrices) &&
    value.normalizedPrices <= value.rawPriceRows &&
    isSafeNonNegativeInteger(value.openApiPriceMapped) &&
    value.openApiPriceMapped <= value.normalizedPrices &&
    value.openApiPriceMapped <= value.openApiOperations &&
    isSafeNonNegativeInteger(value.priceOnly) &&
    value.priceOnly ===
      value.normalizedPrices - value.openApiPriceMapped &&
    isSafeNonNegativeInteger(value.openApiOnly) &&
    value.openApiOnly ===
      value.openApiOperations - value.openApiPriceMapped &&
    isSafeNonNegativeInteger(value.scopeExcluded) &&
    value.scopeExcluded <= value.openApiPriceMapped &&
    isSafeNonNegativeInteger(value.priced) &&
    value.priced ===
      value.openApiPriceMapped - value.scopeExcluded &&
    isSafeNonNegativeInteger(value.positivePrice) &&
    isSafeNonNegativeInteger(value.zeroPrice) &&
    value.positivePrice + value.zeroPrice === value.priced &&
    isSafeNonNegativeInteger(value.awaitingPrice) &&
    value.priced + value.awaitingPrice === value.synced &&
    typeof value.openApiSnapshotHash === "string" &&
    /^[a-f0-9]{64}$/.test(value.openApiSnapshotHash) &&
    typeof value.priceSnapshotHash === "string" &&
    /^[a-f0-9]{64}$/.test(value.priceSnapshotHash) &&
    isSafeNonNegativeInteger(value.disabledMissing) &&
    isNonEmptyString(value.note, 1_000)
  );
}

function isUserUpdateResponse(
  value: unknown,
): value is { ok: true; userId: string; status: "active" | "suspended" } {
  return (
    isObject(value) &&
    value.ok === true &&
    isNonEmptyString(value.userId, 160) &&
    (value.status === "active" || value.status === "suspended")
  );
}

async function adminRequest<T>(
  url: string,
  secret: string,
  validator: Validator<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(secret && secret !== NAMED_ADMIN_SESSION
        ? { Authorization: `Bearer ${secret}` }
        : {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    let message =
      response.status === 401
        ? "管理员会话已失效，请重新登录。"
        : response.status === 403
          ? "当前账户没有执行此操作所需的管理员角色。"
        : `管理接口请求失败（HTTP ${response.status}）。`;
    if (
      isObject(payload) &&
      isObject(payload.error) &&
      isNonEmptyString(payload.error.message, 500)
    ) {
      message = payload.error.message;
    }
    throw new AdminApiError(message, response.status);
  }

  if (!validator(payload)) {
    throw new AdminApiError(
      "服务返回的数据格式不符合管理后台契约，已停止展示以避免误操作。",
      502,
    );
  }
  return payload;
}

function formatUsd(micros: number, digits = 2) {
  return `$${(micros / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatRate(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDate(value: string | null, includeTime = true) {
  if (!value) return "从未";
  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function usdInputValue(micros: number) {
  return (micros / 1_000_000)
    .toFixed(6)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

function parseUsdInput(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d{1,3}(?:\.\d{1,6})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const micros =
    Number(whole) * 1_000_000 +
    Number(fraction.padEnd(6, "0"));
  return Number.isSafeInteger(micros) && micros >= 1 && micros <= 100_000_000
    ? micros
    : null;
}

function parsePendingUsdInput(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d{1,3}(?:\.\d{1,6})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const micros =
    Number(whole) * 1_000_000 +
    Number(fraction.padEnd(6, "0"));
  return Number.isSafeInteger(micros) &&
    micros >= 0 &&
    micros <= 100_000_000
    ? micros
    : null;
}

function parseMarkupPercentInput(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(basisPoints) &&
    basisPoints >= 0 &&
    basisPoints <= 50_000
    ? basisPoints
    : null;
}

function createAdminIdempotencyKey(scope: "preview" | "apply") {
  return `catalog-${scope}:${crypto.randomUUID()}`;
}

function catalogSafetyLabel(value: CatalogSafetyClassification) {
  const labels: Record<CatalogSafetyClassification, string> = {
    safe_data_read: "安全数据读取",
    ambiguous: "需人工判断",
    prohibited: "禁止公开",
  };
  return labels[value];
}

function catalogSafetyFilterLabel(value: CatalogSafetyFilter) {
  return value === "all" ? "全部安全分类" : catalogSafetyLabel(value);
}

function catalogEndpointConfirmable(endpoint: CatalogEndpoint) {
  return (
    !endpoint.enabled &&
    endpoint.presentInLatestSync &&
    endpoint.priceVerified &&
    endpoint.customerPriceUsdMicros >= endpoint.upstreamPriceUsdMicros &&
    (endpoint.method === "GET" || endpoint.method === "POST") &&
    endpoint.safetyClassification === "safe_data_read" &&
    endpoint.safetyPolicyVersion === CATALOG_SAFETY_POLICY_VERSION
  );
}

function catalogAvailabilityReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    not_in_public_catalog: "未进入公开数据市场目录",
    pending_confirmation: "等待运营确认添加到前台",
    read_only_not_confirmed: "只读契约尚未确认",
    price_unverified: "售价尚未核验",
    not_in_latest_sync: "最新上游目录中已缺失",
    safety_not_approved: "安全策略未通过",
    runtime_not_ready: "上游数据源或运行目录未就绪",
    upstream_route_unavailable: "当前没有健康且具备授权的上游路由",
    safety_restricted: "安全策略限制调用",
  };
  return labels[reason] ?? reason;
}

function catalogAvailabilitySummary(endpoint: CatalogEndpoint) {
  if (endpoint.marketplaceAvailability === "available") {
    return "后端运行条件、目录代次与安全校验均已通过";
  }
  return endpoint.availabilityReasons.length
    ? endpoint.availabilityReasons
        .map(catalogAvailabilityReasonLabel)
        .join("；")
    : "当前运行条件未全部满足";
}

function normalizeCatalogTagKey(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function catalogDataTypeLabel(value: CatalogDataType) {
  const labels: Record<CatalogDataType, string> = {
    account: "账户",
    analytics_trends: "分析与趋势",
    comments: "评论",
    commerce_marketing: "商业与营销",
    content: "内容",
    email: "邮箱",
    live: "直播",
    media_download: "媒体下载",
    profile_creator: "账号与创作者",
    search_discovery: "搜索与发现",
    social_graph: "社交关系",
    system: "系统",
    taxonomy: "标签与分类",
    utility: "工具",
    other: "其他",
  };
  return labels[value];
}

function catalogSurfaceLabel(value: CatalogSurface) {
  const labels: Record<CatalogSurface, string> = {
    app: "App",
    web: "Web",
    app_web: "App + Web",
    other: "其他入口",
  };
  return labels[value];
}

function catalogStatusFilterLabel(value: CatalogFilterStatus) {
  const labels: Record<CatalogFilterStatus, string> = {
    all: "全部状态",
    enabled: "已上架",
    disabled: "已下架",
    review: "待复核",
  };
  return labels[value];
}

function catalogBatchActionLabel(value: CatalogBatchAction) {
  const labels: Record<CatalogBatchAction, string> = {
    publish: "批量审核并上架",
    reprice: "批量重算客户价",
    disable: "批量下架",
  };
  return labels[value];
}

function catalogBatchStatusLabel(value: CatalogBatchStatus) {
  const labels: Record<CatalogBatchStatus, string> = {
    preparing: "正在准备",
    ready: "可应用",
    blocked: "已阻断",
    applying: "正在应用",
    applied: "已应用",
    stale: "已失效",
    expired: "已过期",
  };
  return labels[value];
}

function catalogBatchBlockerLabel(value: CatalogBatchBlockerCode) {
  const labels: Record<CatalogBatchBlockerCode, string> = {
    stale_endpoint: "目录代次不一致",
    price_unverified: "成本未核验",
    unsafe_operation: "安全分类不允许",
    price_out_of_range: "目标价格超出范围",
  };
  return labels[value];
}

function parseCreditUsdInput(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d{1,6}(?:\.\d{1,6})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const micros =
    Number(whole) * 1_000_000 +
    Number(fraction.padEnd(6, "0"));
  return Number.isSafeInteger(micros) &&
    micros >= 1 &&
    micros <= 100_000_000_000
    ? micros
    : null;
}

function paymentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "待创建",
    creating: "创建中",
    waiting: "等待付款",
    confirming: "链上确认中",
    confirmed: "已确认",
    sending: "入账处理中",
    partially_paid: "金额不足",
    finished: "已入账",
    failed: "失败",
    expired: "已过期",
    refunded: "已退款",
    manual_review: "人工复核",
    provider_error: "通道异常",
  };
  return labels[status] ?? status;
}

function paymentStatusClass(status: string) {
  return status.replace(/[^a-z0-9_]/g, "") || "unknown";
}

function authProviderLabel(provider: string) {
  const labels: Record<string, string> = {
    google: "Google",
    wallet: "钱包",
    sites: "Sites",
  };
  return labels[provider] ?? provider;
}

function reviewReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    orphan_payment: "未绑定订单的付款",
    order_mismatch: "订单绑定不一致",
    amount_mismatch: "付款金额不一致",
    currency_mismatch: "付款币种不一致",
    partial_payment: "付款金额不足",
    paid_after_expiration: "订单过期后付款",
    terminal_status_conflict: "终态冲突",
    refund_requires_review: "退款需要复核",
    provider_payload_mismatch: "服务商数据不一致",
    repeated_deposit: "疑似重复付款",
    terminal_with_funds: "终态订单仍有到账",
    underpaid_finished: "到账金额低于应付金额",
    provider_data_mismatch: "服务商数据不一致",
    partially_paid: "部分付款",
  };
  return labels[reason] ?? reason;
}

function StatePanel({
  state,
  label,
  onRetry,
  children,
}: {
  state: RemoteState<unknown>;
  label: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (state.status === "idle" || state.status === "loading") {
    return (
      <div className="admin-state admin-state-loading" role="status">
        <span className="admin-spinner" aria-hidden="true" />
        <div>
          <strong>正在读取{label}</strong>
          <p>只展示服务端返回并通过格式校验的数据。</p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="admin-state admin-state-error" role="alert">
        <span aria-hidden="true">!</span>
        <div>
          <strong>{label}加载失败</strong>
          <p>{state.message}</p>
        </div>
        <button className="button button-ghost button-small" onClick={onRetry}>
          重新加载
        </button>
      </div>
    );
  }

  return children;
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  danger,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="admin-dialog-backdrop" role="presentation">
      <section
        className="admin-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="admin-confirm-title"
        aria-describedby="admin-confirm-description"
      >
        <p className="section-kicker">CONFIRM OPERATION</p>
        <h2 id="admin-confirm-title">{title}</h2>
        <p id="admin-confirm-description">{description}</p>
        <div className="admin-dialog-actions">
          <button
            className="button button-ghost"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className={`button ${danger ? "admin-button-danger" : "button-blue"}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "正在执行…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function CatalogBatchReceipt({
  response,
  request,
  matchesCurrentRequest,
  confirmation,
  refreshing,
  applying,
  onConfirmationChange,
  onRefresh,
  onApply,
}: {
  response: CatalogBatchResponse;
  request: CatalogBatchPreviewRequest | null;
  matchesCurrentRequest: boolean;
  confirmation: string;
  refreshing: boolean;
  applying: boolean;
  onConfirmationChange: (value: string) => void;
  onRefresh: () => void;
  onApply: () => void;
}) {
  const batch = response.batch;
  const confirmationMatches = confirmation === batch.confirmationText;
  const [expired, setExpired] = useState(false);
  const priceDelta =
    batch.totals.afterCustomer - batch.totals.beforeCustomer;

  useEffect(() => {
    let timer = 0;
    const checkExpiry = () => {
      const remaining = Date.parse(batch.expiresAt) - Date.now();
      if (remaining <= 0) {
        setExpired(true);
        return;
      }
      timer = window.setTimeout(checkExpiry, Math.min(remaining, 60_000));
    };
    timer = window.setTimeout(checkExpiry, 0);
    return () => window.clearTimeout(timer);
  }, [batch.expiresAt]);

  return (
    <div className="admin-catalog-batch-receipt">
      <div className="admin-catalog-batch-receipt-head">
        <div>
          <div className="admin-catalog-batch-status-line">
            <span
              className={`admin-catalog-batch-status is-${batch.status}`}
            >
              {catalogBatchStatusLabel(batch.status)}
            </span>
            {response.replayed ? <span>幂等回放</span> : null}
          </div>
          <h4>{catalogBatchActionLabel(batch.action)}</h4>
          <code>{batch.id}</code>
        </div>
        <div className="admin-catalog-batch-receipt-actions">
          <span>v{batch.version}</span>
          <button
            className="button button-ghost button-small"
            type="button"
            disabled={refreshing || applying}
            onClick={onRefresh}
          >
            {refreshing ? "刷新中…" : "刷新回执"}
          </button>
        </div>
      </div>

      <div className="admin-catalog-batch-snapshot">
        <span>
          目录代次 <code>{batch.catalogGeneration}</code>
        </span>
        <span>
          预览 {formatDate(batch.previewedAt)} / 过期{" "}
          {formatDate(batch.expiresAt)}
        </span>
        {batch.appliedAt ? (
          <span>应用 {formatDate(batch.appliedAt)}</span>
        ) : null}
        {request ? (
          <span>
            选择器：{request.selection.platform ?? "全部平台"} ·{" "}
            {request.selection.dataType
              ? catalogDataTypeLabel(request.selection.dataType)
              : "全部数据类型"}{" "}
            · {request.selection.tag ? `标签 ${request.selection.tag}` : "全部标签"}{" "}
            ·{" "}
            {request.selection.surface
              ? catalogSurfaceLabel(request.selection.surface)
              : "全部入口"}{" "}
            ·{" "}
            {catalogStatusFilterLabel(request.selection.status)} ·{" "}
            {catalogSafetyFilterLabel(request.selection.safety)}
            {request.selection.query
              ? ` · “${request.selection.query}”`
              : ""}
          </span>
        ) : null}
      </div>

      {!matchesCurrentRequest && batch.status === "ready" ? (
        <div className="admin-catalog-batch-alert is-warning" role="alert">
          当前筛选、定价规则或目录代次已不同于此预览。旧快照仍保留供审计，但必须重新生成后才能应用。
        </div>
      ) : null}
      {batch.status === "blocked" ? (
        <div className="admin-catalog-batch-alert is-blocked" role="alert">
          这是整批原子操作：任一阻断项都会阻止全部修改，不会跳过问题项后应用其余端点。
        </div>
      ) : null}
      {expired && batch.status === "ready" ? (
        <div className="admin-catalog-batch-alert is-warning" role="alert">
          此预览已到期，不能继续应用；请按当前目录重新生成。
        </div>
      ) : null}

      <div className="admin-catalog-batch-counts">
        <article>
          <span>服务端匹配</span>
          <strong>{batch.counts.matched.toLocaleString()}</strong>
          <small>冻结进预览的端点</small>
        </article>
        <article>
          <span>计划修改</span>
          <strong>{batch.counts.selected.toLocaleString()}</strong>
          <small>无变化 {batch.counts.noChange.toLocaleString()}</small>
        </article>
        <article className={batch.counts.blocked ? "is-danger" : ""}>
          <span>阻断</span>
          <strong>{batch.counts.blocked.toLocaleString()}</strong>
          <small>
            代次 {batch.counts.stale} / 成本 {batch.counts.unverified} / 安全{" "}
            {batch.counts.unsafe}
          </small>
        </article>
        <article>
          <span>价格方向</span>
          <strong>
            +{batch.counts.priceIncrease} / -{batch.counts.priceDecrease}
          </strong>
          <small>不变 {batch.counts.priceUnchanged.toLocaleString()}</small>
        </article>
      </div>

      <div className="admin-catalog-batch-totals">
        <div>
          <span>上游成本合计</span>
          <strong>{formatUsd(batch.totals.upstream, 6)}</strong>
        </div>
        <div>
          <span>变更前客户价合计</span>
          <strong>{formatUsd(batch.totals.beforeCustomer, 6)}</strong>
        </div>
        <div>
          <span>变更后客户价合计</span>
          <strong>{formatUsd(batch.totals.afterCustomer, 6)}</strong>
          <small>
            差额 {priceDelta >= 0 ? "+" : "-"}
            {formatUsd(Math.abs(priceDelta), 6)}
          </small>
        </div>
      </div>

      <details className="admin-catalog-batch-digests">
        <summary>
          <span>校验摘要 / DIGESTS</span>
          <b>展开完整值</b>
        </summary>
        <dl>
          <div>
            <dt>目标集合</dt>
            <dd>
              <code>{batch.targetDigest}</code>
            </dd>
          </div>
          <div>
            <dt>变更前</dt>
            <dd>
              <code>{batch.beforeDigest}</code>
            </dd>
          </div>
          <div>
            <dt>变更后</dt>
            <dd>
              <code>{batch.afterDigest}</code>
            </dd>
          </div>
        </dl>
      </details>

      {batch.status === "ready" ? (
        <div className="admin-catalog-batch-confirmation">
          <div>
            <span>完整确认文本</span>
            <code>{batch.confirmationText}</code>
            <small>逐字手输上方完整内容；大小写、空格和摘要都必须一致。</small>
          </div>
          <label>
            <span>输入确认</span>
            <input
              autoComplete="off"
              spellCheck={false}
              maxLength={240}
              value={confirmation}
              aria-invalid={confirmation.length > 0 && !confirmationMatches}
              onChange={(event) => onConfirmationChange(event.target.value)}
            />
          </label>
          <button
            className={`button ${
              batch.action === "disable"
                ? "admin-button-danger"
                : "button-blue"
            }`}
            type="button"
            disabled={
              applying ||
              refreshing ||
              expired ||
              !matchesCurrentRequest ||
              !confirmationMatches
            }
            onClick={onApply}
          >
            {applying ? "正在原子应用…" : "应用整批变更"}
          </button>
        </div>
      ) : null}

      {batch.applyResult !== null ? (
        <details className="admin-catalog-batch-apply-result" open>
          <summary>应用回执</summary>
          <pre>{JSON.stringify(batch.applyResult, null, 2)}</pre>
        </details>
      ) : null}

      <div className="admin-catalog-batch-items-head">
        <div>
          <h5>端点明细</h5>
          <p>仅展示当前响应中的前 {response.items.length} 项，摘要计数以服务端为准。</p>
        </div>
        {response.nextOffset !== null ? (
          <span>还有 {batch.counts.matched - response.nextOffset} 项未展示</span>
        ) : null}
      </div>
      {response.items.length ? (
        <div className="admin-table-wrap admin-catalog-batch-table-wrap">
          <table className="admin-table admin-catalog-batch-table">
            <thead>
              <tr>
                <th>端点</th>
                <th>变更前</th>
                <th>变更后</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {response.items.map((item) => (
                <tr key={item.path}>
                  <td>
                    <div className="admin-route-primary">
                      <span className="admin-method">{item.method}</span>
                      <code title={item.path}>{item.path}</code>
                    </div>
                    <small>
                      {item.platform} · {catalogDataTypeLabel(item.dataType)} ·{" "}
                      {catalogSurfaceLabel(item.surface)}
                    </small>
                    <details className="admin-pending-row-details">
                      <summary>技术信息</summary>
                      {item.summary ? <span>{item.summary}</span> : null}
                      <span>
                        operationId {item.operationId ?? "未提供"}
                      </span>
                      <span>
                        revision {item.expectedRevision} ·{" "}
                        {item.itemDigest.slice(0, 12)}
                      </span>
                      {item.tags.length ? (
                        <span>标签 {item.tags.join(" · ")}</span>
                      ) : null}
                    </details>
                  </td>
                  <td>
                    <strong>
                      {formatUsd(item.before.customerPriceUsdMicros, 6)}
                    </strong>
                    <small>
                      {item.before.enabled ? "已上架" : "已下架"} ·{" "}
                      {item.before.readOnly ? "只读" : "未确认只读"}
                    </small>
                    <small>
                      成本 {formatUsd(item.before.upstreamPriceUsdMicros, 6)}
                    </small>
                  </td>
                  <td>
                    <strong>
                      {formatUsd(item.after.customerPriceUsdMicros, 6)}
                    </strong>
                    <small>
                      {item.after.enabled ? "将上架" : "将下架"} ·{" "}
                      {item.after.readOnly ? "只读" : "未确认只读"}
                    </small>
                  </td>
                  <td>
                    <span
                      className={`admin-catalog-batch-item-result ${
                        item.blockerCode
                          ? "is-blocked"
                          : item.willChange
                            ? "is-change"
                            : "is-no-change"
                      }`}
                    >
                      {item.blockerCode
                        ? catalogBatchBlockerLabel(item.blockerCode)
                        : item.willChange
                          ? "将修改"
                          : "无变化"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-empty">
          <strong>此预览没有端点明细</strong>
          <p>刷新回执，或调整服务端选择器后重新生成预览。</p>
        </div>
      )}
    </div>
  );
}

function PaymentReviewDialog({
  review,
  action,
  creditAmount,
  note,
  busy,
  onCreditAmountChange,
  onNoteChange,
  onCancel,
  onConfirm,
}: {
  review: PaymentReview;
  action: ReviewAction;
  creditAmount: string;
  note: string;
  busy: boolean;
  onCreditAmountChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const actionCopy = {
    credit: {
      title: "确认向用户余额入账？",
      description:
        "仅在付款已由支付服务商和链上证据双重确认后使用。该操作会增加用户余额，并留下管理员审计记录。",
      label: "确认入账",
      danger: false,
    },
    refund_confirmed: {
      title: "确认该付款已经退款？",
      description:
        "只有在支付服务商或链上退款记录可验证时结案。此操作不会增加用户余额。",
      label: "确认已退款",
      danger: false,
    },
    reject: {
      title: "拒绝该支付复核案件？",
      description:
        "拒绝后案件会结案且不会增加余额。请在备注中留下可审计的拒绝依据。",
      label: "确认拒绝",
      danger: true,
    },
  }[action];
  const creditMicros =
    action === "credit" ? parseCreditUsdInput(creditAmount) : 1;
  const canSubmit =
    note.trim().length >= 4 &&
    note.trim().length <= 500 &&
    creditMicros !== null;

  return (
    <div className="admin-dialog-backdrop" role="presentation">
      <section
        className="admin-dialog admin-review-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="payment-review-dialog-title"
        aria-describedby="payment-review-dialog-description"
      >
        <p className="section-kicker">PAYMENT REVIEW / RESOLVE</p>
        <h2 id="payment-review-dialog-title">{actionCopy.title}</h2>
        <p id="payment-review-dialog-description">{actionCopy.description}</p>
        <dl>
          <div>
            <dt>案件</dt>
            <dd>{review.id}</dd>
          </div>
          <div>
            <dt>订单</dt>
            <dd>{review.orderId}</dd>
          </div>
          <div>
            <dt>用户</dt>
            <dd>{review.email}</dd>
          </div>
        </dl>
        {action === "credit" ? (
          <label>
            <span>确认入账金额（USD）</span>
            <div className="admin-review-credit-input">
              <b>$</b>
              <input
                inputMode="decimal"
                autoComplete="off"
                value={creditAmount}
                aria-invalid={
                  creditAmount.length > 0 &&
                  parseCreditUsdInput(creditAmount) === null
                }
                placeholder="例如 25.00"
                onChange={(event) =>
                  onCreditAmountChange(event.target.value)
                }
              />
            </div>
            <small>
              必须根据已核验的付款证据填写，不会自动使用订单原金额。
            </small>
          </label>
        ) : null}
        <label>
          <span>处理备注</span>
          <textarea
            value={note}
            maxLength={500}
            placeholder="记录核验来源、交易状态与处理依据（至少 4 个字符）"
            onChange={(event) => onNoteChange(event.target.value)}
          />
          <small>{note.length} / 500</small>
        </label>
        <div className="admin-dialog-actions">
          <button
            className="button button-ghost"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className={`button ${
              actionCopy.danger ? "admin-button-danger" : "button-blue"
            }`}
            disabled={busy || !canSubmit}
            onClick={onConfirm}
          >
            {busy ? "正在处理…" : actionCopy.label}
          </button>
        </div>
      </section>
    </div>
  );
}

function RouteCatalogPagination({
  page,
  pageCount,
  total,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (total <= ROUTE_CATALOG_PAGE_SIZE) return null;
  return (
    <div className="admin-pending-catalog-pagination">
      <button
        className="button button-ghost button-small"
        type="button"
        disabled={page === 0}
        onClick={() => onPageChange(Math.max(0, page - 1))}
      >
        上一页
      </button>
      <span>
        第 {page + 1} / {pageCount} 页 · 共 {total.toLocaleString()} 条 ·
        每页最多 {ROUTE_CATALOG_PAGE_SIZE} 条
      </span>
      <button
        className="button button-ghost button-small"
        type="button"
        disabled={page >= pageCount - 1}
        onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
      >
        下一页
      </button>
    </div>
  );
}

export function AdminClient() {
  const restoredAdminSession = useRef(false);
  const catalogBatchPreviewRetry = useRef<{
    requestSignature: string;
    idempotencyKey: string;
  } | null>(null);
  const catalogBatchApplyRetry = useRef<{
    batchId: string;
    requestSignature: string;
    idempotencyKey: string;
  } | null>(null);
  const [secretInput, setSecretInput] = useState("");
  const [adminSecret, setAdminSecret] = useState("");
  const [adminIdentity, setAdminIdentity] =
    useState<AdminIdentity | null>(null);
  const [checkingSecret, setCheckingSecret] = useState(true);
  const [authError, setAuthError] = useState("");
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [upstreamView, setUpstreamView] =
    useState<UpstreamView>("current");
  const [catalogView, setCatalogView] = useState<CatalogView>("routes");
  const [overview, setOverview] = useState<RemoteState<OverviewResponse>>({
    status: "idle",
  });
  const [users, setUsers] = useState<RemoteState<UsersResponse>>({
    status: "idle",
  });
  const [adminMembers, setAdminMembers] = useState<
    RemoteState<AdminMembersResponse>
  >({ status: "idle" });
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminRole, setNewAdminRole] =
    useState<AdminRole>("auditor");
  const [savingAdminMember, setSavingAdminMember] = useState(false);
  const [catalog, setCatalog] = useState<RemoteState<CatalogResponse>>({
    status: "idle",
  });
  const [pendingCatalog, setPendingCatalog] = useState<
    RemoteState<PendingCatalogResponse>
  >({ status: "idle" });
  const [upstreamCredentials, setUpstreamCredentials] = useState<
    RemoteState<UpstreamCredentialsResponse>
  >({ status: "idle" });
  const [upstreamConfig, setUpstreamConfig] = useState<
    RemoteState<UpstreamConfigResponse>
  >({ status: "idle" });
  const [payments, setPayments] = useState<RemoteState<PaymentsResponse>>({
    status: "idle",
  });
  const [x402Admin, setX402Admin] = useState<
    RemoteState<AdminX402Response>
  >({ status: "idle" });
  const [x402RuntimeDraft, setX402RuntimeDraft] =
    useState<X402RuntimeConfigDraft>({
      managedEnabled: false,
      enabled: false,
      payTo: "",
      facilitatorProvider: "cdp",
      facilitatorUrl:
        "https://api.cdp.coinbase.com/platform/v2/x402",
      cdpApiKeyId: "",
      cdpApiKeySecret: "",
      bearerToken: "",
    });
  const [savingX402Runtime, setSavingX402Runtime] = useState(false);
  const [paymentReviews, setPaymentReviews] = useState<
    RemoteState<PaymentReviewsResponse>
  >({ status: "idle" });
  const [notice, setNotice] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(
    null,
  );
  const [mutating, setMutating] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [userStatus, setUserStatus] = useState("all");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogPage, setCatalogPage] = useState(0);
  const [pendingCatalogQuery, setPendingCatalogQuery] = useState("");
  const [pendingCatalogPage, setPendingCatalogPage] = useState(0);
  const [catalogPlatform, setCatalogPlatform] = useState("all");
  const [catalogDataType, setCatalogDataType] =
    useState<CatalogDataTypeFilter>("all");
  const [catalogTag, setCatalogTag] = useState<string | null>(null);
  const [catalogSurface, setCatalogSurface] =
    useState<CatalogSurfaceFilter>("all");
  const [catalogStatus, setCatalogStatus] =
    useState<CatalogFilterStatus>("all");
  const [catalogSafety, setCatalogSafety] =
    useState<CatalogSafetyFilter>("all");
  const [catalogRuntimeAvailability, setCatalogRuntimeAvailability] =
    useState<CatalogRuntimeAvailabilityFilter>("all");
  const [selectedPendingPaths, setSelectedPendingPaths] = useState<
    Set<string>
  >(new Set());
  const [routeBatchConfirmOpen, setRouteBatchConfirmOpen] =
    useState(false);
  const [confirmingRouteBatch, setConfirmingRouteBatch] =
    useState(false);
  const [catalogBatchAction, setCatalogBatchAction] =
    useState<CatalogBatchAction>("publish");
  const [catalogBatchMarkupPercent, setCatalogBatchMarkupPercent] =
    useState("30");
  const [catalogBatchMinimumPrice, setCatalogBatchMinimumPrice] =
    useState("0.001");
  const [catalogBatch, setCatalogBatch] =
    useState<CatalogBatchResponse | null>(null);
  const [catalogBatchRequest, setCatalogBatchRequest] =
    useState<CatalogBatchPreviewRequest | null>(null);
  const [catalogBatchConfirmation, setCatalogBatchConfirmation] = useState("");
  const [catalogBatchError, setCatalogBatchError] = useState("");
  const [previewingCatalogBatch, setPreviewingCatalogBatch] = useState(false);
  const [refreshingCatalogBatch, setRefreshingCatalogBatch] = useState(false);
  const [applyingCatalogBatch, setApplyingCatalogBatch] = useState(false);
  const [upstreamConfigDraft, setUpstreamConfigDraft] =
    useState<UpstreamConfigDraft>(() => ({
      ...EMPTY_UPSTREAM_CONFIG_DRAFT,
    }));
  const [savingUpstreamConfig, setSavingUpstreamConfig] = useState(false);
  const [upstreamLabel, setUpstreamLabel] = useState("主数据源");
  const [upstreamApiKey, setUpstreamApiKey] = useState("");
  const [upstreamCapacityGroupId, setUpstreamCapacityGroupId] =
    useState("new");
  const [upstreamCapacityGroupLabel, setUpstreamCapacityGroupLabel] =
    useState("TikHub 主账号");
  const [upstreamConfiguredRps, setUpstreamConfiguredRps] =
    useState("10");
  const [upstreamHeadroomPercent, setUpstreamHeadroomPercent] =
    useState("80");
  const [upstreamPriority, setUpstreamPriority] = useState("100");
  const [upstreamWeight, setUpstreamWeight] = useState("100");
  const [activateUpstreamAfterSave, setActivateUpstreamAfterSave] =
    useState(true);
  const [savingUpstreamCredential, setSavingUpstreamCredential] =
    useState(false);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [savingPath, setSavingPath] = useState("");
  const [x402Drafts, setX402Drafts] = useState<
    Record<string, { price: string; maxBatchSize: string }>
  >({});
  const [savingX402Path, setSavingX402Path] = useState("");
  const [pendingPriceDrafts, setPendingPriceDrafts] = useState<
    Record<string, string>
  >({});
  const [savingPendingPath, setSavingPendingPath] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("manual_review");
  const [recoveryOrderId, setRecoveryOrderId] = useState("");
  const [recoveryPaymentId, setRecoveryPaymentId] = useState("");
  const [recoveringPayment, setRecoveringPayment] = useState(false);
  const [reviewResolution, setReviewResolution] = useState<{
    review: PaymentReview;
    action: ReviewAction;
  } | null>(null);
  const [reviewCreditAmount, setReviewCreditAmount] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [resolvingReview, setResolvingReview] = useState(false);

  const loadOverview = useCallback(async (secret = adminSecret) => {
    if (!secret) return;
    setOverview({ status: "loading" });
    try {
      const data = await adminRequest(
        "/api/admin/overview",
        secret,
        isOverviewResponse,
      );
      setOverview({ status: "ready", data });
    } catch (error) {
      setOverview({
        status: "error",
        message:
          error instanceof Error ? error.message : "无法读取运营概览。",
      });
    }
  }, [adminSecret]);

  const loadUsers = useCallback(async (secret = adminSecret) => {
    if (!secret) return;
    setUsers({ status: "loading" });
    try {
      const allUsers: AdminUser[] = [];
      let offset = 0;
      let total: number | null = null;
      while (true) {
        const page = await adminRequest(
          `/api/admin/users?limit=200&offset=${offset}`,
          secret,
          isUsersResponse,
        );
        if (
          page.offset !== offset ||
          (total !== null && page.total !== total)
        ) {
          throw new AdminApiError(
            "用户列表在分页读取期间发生变化，请重新加载。",
            409,
          );
        }
        total ??= page.total;
        allUsers.push(...page.users);
        if (allUsers.length > total || allUsers.length > 100_000) {
          throw new AdminApiError("用户列表超过安全展示上限。", 502);
        }
        if (page.nextOffset === null) break;
        offset = page.nextOffset;
      }
      if (allUsers.length !== total) {
        throw new AdminApiError(
          "用户列表分页不完整，已停止展示以避免遗漏。",
          502,
        );
      }
      setUsers({
        status: "ready",
        data: {
          users: allUsers,
          count: allUsers.length,
          total,
          offset: 0,
          nextOffset: null,
        },
      });
    } catch (error) {
      setUsers({
        status: "error",
        message: error instanceof Error ? error.message : "无法读取用户列表。",
      });
    }
  }, [adminSecret]);

  const loadAdminMembers = useCallback(
    async (secret = adminSecret) => {
      if (!secret) return;
      setAdminMembers({ status: "loading" });
      try {
        const data = await adminRequest(
          "/api/admin/members",
          secret,
          isAdminMembersResponse,
        );
        setAdminMembers({ status: "ready", data });
      } catch (error) {
        setAdminMembers({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "无法读取管理员成员。",
        });
      }
    },
    [adminSecret],
  );

  const loadCatalog = useCallback(async (secret = adminSecret) => {
    if (!secret) return;
    setCatalog({ status: "loading" });
    try {
      const endpoints: CatalogEndpoint[] = [];
      let offset = 0;
      let total: number | null = null;
      let sync: CatalogSyncInfo | null | undefined;
      while (true) {
        const page = await adminRequest(
          `/api/admin/catalog?limit=500&offset=${offset}`,
          secret,
          isCatalogResponse,
        );
        if (
          page.offset !== offset ||
          (total !== null && page.total !== total) ||
          (sync !== undefined &&
            JSON.stringify(page.sync) !== JSON.stringify(sync))
        ) {
          throw new AdminApiError(
            "接口目录在分页读取期间发生变化，请重新加载。",
            409,
          );
        }
        total ??= page.total;
        sync ??= page.sync;
        endpoints.push(...page.endpoints);
        if (endpoints.length > total || endpoints.length > 5_000) {
          throw new AdminApiError("接口目录超过安全展示上限。", 502);
        }
        if (page.nextOffset === null) break;
        offset = page.nextOffset;
      }
      if (endpoints.length !== total) {
        throw new AdminApiError(
          "接口目录分页不完整，已停止展示以避免漏管路由。",
          502,
        );
      }
      const data: CatalogResponse = {
        endpoints,
        count: endpoints.length,
        total,
        offset: 0,
        nextOffset: null,
        sync: sync ?? null,
      };
      setCatalog({ status: "ready", data });
      setPriceDrafts(
        Object.fromEntries(
          data.endpoints.map((endpoint) => [
            endpoint.path,
            usdInputValue(endpoint.customerPriceUsdMicros),
          ]),
        ),
      );
      setX402Drafts(
        Object.fromEntries(
          data.endpoints.map((endpoint) => [
            endpoint.path,
            {
              price: usdInputValue(
                endpoint.x402.unitPriceUsdMicros ??
                  endpoint.customerPriceUsdMicros,
              ),
              maxBatchSize: String(endpoint.x402.maxBatchSize ?? 25),
            },
          ]),
        ),
      );
    } catch (error) {
      setCatalog({
        status: "error",
        message:
          error instanceof Error ? error.message : "无法读取接口目录。",
      });
    }
  }, [adminSecret]);

  const loadPendingCatalog = useCallback(
    async (secret = adminSecret) => {
      if (!secret) return;
      setPendingCatalog({ status: "loading" });
      try {
        const endpoints: PendingCatalogEndpoint[] = [];
        let offset = 0;
        let total: number | null = null;
        while (true) {
          const page = await adminRequest(
            `/api/admin/catalog/pending?limit=500&offset=${offset}`,
            secret,
            isPendingCatalogResponse,
          );
          if (
            page.offset !== offset ||
            (total !== null && page.total !== total)
          ) {
            throw new AdminApiError(
              "文档待同步服务在分页读取期间发生变化，请重新加载。",
              409,
            );
          }
          total ??= page.total;
          if (total > 100_000) {
            throw new AdminApiError(
              "文档待同步服务超过安全加载上限。",
              502,
            );
          }
          endpoints.push(...page.endpoints);
          if (endpoints.length > total || endpoints.length > 100_000) {
            throw new AdminApiError(
              "文档待同步服务分页结果不完整。",
              502,
            );
          }
          if (page.nextOffset === null) break;
          offset = page.nextOffset;
        }
        if (
          endpoints.length !== total ||
          new Set(endpoints.map((endpoint) => endpoint.path)).size !==
            endpoints.length
        ) {
          throw new AdminApiError(
            "文档待同步服务分页存在遗漏或重复，已停止展示。",
            502,
          );
        }
        const data: PendingCatalogResponse = {
          endpoints,
          count: endpoints.length,
          total,
          offset: 0,
          nextOffset: null,
        };
        setPendingCatalog({ status: "ready", data });
        setPendingPriceDrafts(
          Object.fromEntries(
            endpoints.map((endpoint) => [
              endpoint.path,
              usdInputValue(endpoint.customerPriceUsdMicros),
            ]),
          ),
        );
        setPendingCatalogPage(0);
      } catch (error) {
        setPendingCatalog({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "无法读取文档待同步服务。",
        });
      }
    },
    [adminSecret],
  );

  const loadUpstreamConfig = useCallback(
    async (secret = adminSecret) => {
      if (!secret) return;
      setUpstreamConfig({ status: "loading" });
      try {
        const data = await adminRequest(
          "/api/admin/upstream-config",
          secret,
          isUpstreamConfigResponse,
        );
        setUpstreamConfig({ status: "ready", data });
        setUpstreamConfigDraft(upstreamConfigDraftFrom(data.config));
      } catch (error) {
        setUpstreamConfig({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "无法读取数据源配置。",
        });
      }
    },
    [adminSecret],
  );

  const loadUpstreamCredentials = useCallback(
    async (secret = adminSecret) => {
      if (!secret) return;
      setUpstreamCredentials({ status: "loading" });
      try {
        const data = await adminRequest(
          "/api/admin/upstream-credentials",
          secret,
          isUpstreamCredentialsResponse,
        );
        setUpstreamCredentials({ status: "ready", data });
      } catch (error) {
        setUpstreamCredentials({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "无法读取上游凭据。",
        });
      }
    },
    [adminSecret],
  );

  const loadPayments = useCallback(async (secret = adminSecret) => {
    if (!secret) return;
    setPayments({ status: "loading" });
    try {
      const payments: AdminPayment[] = [];
      let offset = 0;
      let total = 0;
      while (true) {
        const page = await adminRequest(
          `/api/admin/payments?limit=200&offset=${offset}`,
          secret,
          isPaymentsResponse,
        );
        payments.push(...page.payments);
        total = page.total;
        if (page.nextOffset === null) break;
        offset = page.nextOffset;
      }
      setPayments({
        status: "ready",
        data: {
          payments,
          count: payments.length,
          total,
          offset: 0,
          nextOffset: null,
        },
      });
    } catch (error) {
      setPayments({
        status: "error",
        message:
          error instanceof Error ? error.message : "无法读取支付列表。",
      });
    }
  }, [adminSecret]);

  const loadX402Admin = useCallback(async (secret = adminSecret) => {
    if (!secret) return;
    setX402Admin({ status: "loading" });
    try {
      const data = await adminRequest(
        "/api/admin/x402?limit=200",
        secret,
        isAdminX402Response,
      );
      setX402Admin({ status: "ready", data });
      setX402RuntimeDraft({
        managedEnabled: data.configuration.managedEnabled,
        enabled: data.configuration.enabled,
        payTo: data.configuration.payTo ?? "",
        facilitatorProvider:
          data.configuration.facilitatorProvider,
        facilitatorUrl: data.configuration.facilitatorUrl,
        cdpApiKeyId: "",
        cdpApiKeySecret: "",
        bearerToken: "",
      });
    } catch (error) {
      setX402Admin({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "无法读取 x402 结算账本。",
      });
    }
  }, [adminSecret]);

  const loadPaymentReviews = useCallback(async (secret = adminSecret) => {
    if (!secret) return;
    setPaymentReviews({ status: "loading" });
    try {
      const reviews: PaymentReview[] = [];
      let offset = 0;
      let total = 0;
      while (true) {
        const page = await adminRequest(
          `/api/admin/payment-reviews?status=open&limit=200&offset=${offset}`,
          secret,
          isPaymentReviewsResponse,
        );
        reviews.push(...page.reviews);
        total = page.total;
        if (page.nextOffset === null) break;
        offset = page.nextOffset;
      }
      setPaymentReviews({
        status: "ready",
        data: {
          reviews,
          count: reviews.length,
          total,
          status: "open",
          offset: 0,
          nextOffset: null,
        },
      });
    } catch (error) {
      setPaymentReviews({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "无法读取支付复核案件。",
      });
    }
  }, [adminSecret]);

  const authenticate = useCallback(
    async (secret: string) => {
      if (secret.length < 32 || secret.length > 512) {
        setAuthError("紧急引导凭证长度不符合安全要求。");
        return;
      }
      setCheckingSecret(true);
      setAuthError("");
      setOverview({ status: "loading" });

      try {
        const session = await adminRequest(
          "/api/admin/session",
          secret,
          isAdminSessionResponse,
          { method: "POST", body: "{}" },
        );
        const data = await adminRequest(
          "/api/admin/overview",
          NAMED_ADMIN_SESSION,
          isOverviewResponse,
        );
        setAdminIdentity(session.admin);
        setAdminSecret(NAMED_ADMIN_SESSION);
        setSecretInput("");
        setOverview({ status: "ready", data });
        void loadUsers(NAMED_ADMIN_SESSION);
        void loadAdminMembers(NAMED_ADMIN_SESSION);
        void loadUpstreamConfig(NAMED_ADMIN_SESSION);
        void loadUpstreamCredentials(NAMED_ADMIN_SESSION);
        void loadCatalog(NAMED_ADMIN_SESSION);
        void loadPendingCatalog(NAMED_ADMIN_SESSION);
        void loadPayments(NAMED_ADMIN_SESSION);
        void loadPaymentReviews(NAMED_ADMIN_SESSION);
        void loadX402Admin(NAMED_ADMIN_SESSION);
      } catch (error) {
        setAdminIdentity(null);
        setOverview({ status: "idle" });
        setAuthError(
          error instanceof Error ? error.message : "管理员引导失败。",
        );
      } finally {
        setCheckingSecret(false);
      }
    },
    [
      loadCatalog,
      loadAdminMembers,
      loadPendingCatalog,
      loadPaymentReviews,
      loadPayments,
      loadX402Admin,
      loadUpstreamConfig,
      loadUpstreamCredentials,
      loadUsers,
    ],
  );

  useEffect(() => {
    if (restoredAdminSession.current) return;
    restoredAdminSession.current = true;
    let cancelled = false;
    void adminRequest(
      "/api/admin/session",
      NAMED_ADMIN_SESSION,
      isAdminSessionResponse,
    )
      .then(async (session) => {
        if (cancelled) return;
        const data = await adminRequest(
          "/api/admin/overview",
          NAMED_ADMIN_SESSION,
          isOverviewResponse,
        );
        if (cancelled) return;
        setAdminIdentity(session.admin);
        setAdminSecret(NAMED_ADMIN_SESSION);
        setOverview({ status: "ready", data });
        void loadUsers(NAMED_ADMIN_SESSION);
        void loadAdminMembers(NAMED_ADMIN_SESSION);
        void loadUpstreamConfig(NAMED_ADMIN_SESSION);
        void loadUpstreamCredentials(NAMED_ADMIN_SESSION);
        void loadCatalog(NAMED_ADMIN_SESSION);
        void loadPendingCatalog(NAMED_ADMIN_SESSION);
        void loadPayments(NAMED_ADMIN_SESSION);
        void loadPaymentReviews(NAMED_ADMIN_SESSION);
        void loadX402Admin(NAMED_ADMIN_SESSION);
      })
      .catch((error: unknown) => {
        if (
          !cancelled &&
          error instanceof AdminApiError &&
          error.status !== 401 &&
          error.status !== 403
        ) {
          setAuthError(error.message);
        }
      })
      .finally(() => {
        if (!cancelled) setCheckingSecret(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    loadCatalog,
    loadAdminMembers,
    loadPendingCatalog,
    loadPaymentReviews,
    loadPayments,
    loadUpstreamConfig,
    loadUpstreamCredentials,
    loadUsers,
    loadX402Admin,
  ]);

  const visibleUsers = useMemo(() => {
    if (users.status !== "ready") return [];
    const query = userQuery.trim().toLocaleLowerCase("zh-CN");
    return users.data.users.filter((user) => {
      const matchesQuery =
        !query ||
        user.email.toLocaleLowerCase("zh-CN").includes(query) ||
        user.displayName.toLocaleLowerCase("zh-CN").includes(query) ||
        user.id.toLocaleLowerCase("zh-CN").includes(query);
      return (
        matchesQuery &&
        (userStatus === "all" || user.status === userStatus)
      );
    });
  }, [userQuery, userStatus, users]);

  const catalogPlatforms = useMemo(() => {
    if (catalog.status !== "ready") return [];
    return Array.from(
      new Set(catalog.data.endpoints.map((endpoint) => endpoint.platform)),
    ).sort((left, right) => left.localeCompare(right, "zh-CN"));
  }, [catalog]);

  const catalogDataTypes = useMemo(() => {
    if (catalog.status !== "ready") return [];
    const available = new Set(
      catalog.data.endpoints.map((endpoint) => endpoint.dataType),
    );
    return CATALOG_DATA_TYPES.filter((dataType) => available.has(dataType));
  }, [catalog]);

  const catalogTags = useMemo(() => {
    if (catalog.status !== "ready") return [];
    const tagsByKey = new Map<string, string>();
    for (const endpoint of catalog.data.endpoints) {
      for (const tag of endpoint.tags) {
        const key = normalizeCatalogTagKey(tag);
        const current = tagsByKey.get(key);
        if (!current || tag.localeCompare(current, "zh-CN") < 0) {
          tagsByKey.set(key, tag);
        }
      }
    }
    return Array.from(tagsByKey.values()).sort((left, right) =>
      left.localeCompare(right, "zh-CN"),
    );
  }, [catalog]);

  const catalogSurfaces = useMemo(() => {
    if (catalog.status !== "ready") return [];
    const available = new Set(
      catalog.data.endpoints.map((endpoint) => endpoint.surface),
    );
    return CATALOG_SURFACES.filter((surface) => available.has(surface));
  }, [catalog]);

  const currentCatalogBatchRequest = useMemo<CatalogBatchPreviewRequest | null>(
    () => {
      if (catalog.status !== "ready" || !catalog.data.sync) return null;
      const markupBps = parseMarkupPercentInput(catalogBatchMarkupPercent);
      const minimumCustomerPriceUsdMicros = parseUsdInput(
        catalogBatchMinimumPrice,
      );
      const normalizedTag =
        catalogTag === null ? null : normalizeCatalogTagKey(catalogTag);
      if (
        (normalizedTag !== null && !isCatalogTag(normalizedTag)) ||
        catalogBatchAction !== "disable" &&
        (markupBps === null || minimumCustomerPriceUsdMicros === null)
      ) {
        return null;
      }
      const selection: CatalogBatchSelection = {
        platform:
          catalogPlatform === "all"
            ? null
            : catalogPlatform.trim().toLowerCase(),
        dataType: catalogDataType === "all" ? null : catalogDataType,
        tag: normalizedTag,
        surface: catalogSurface === "all" ? null : catalogSurface,
        query: catalogQuery
          .replace(/\s+/g, " ")
          .trim()
          .toLocaleLowerCase("zh-CN"),
        status: catalogStatus,
        safety: catalogSafety,
      };
      if (!isCatalogBatchSelection(selection)) return null;
      const request: CatalogBatchPreviewRequest = {
        action: catalogBatchAction,
        expectedCatalogGeneration: catalog.data.sync.generation,
        selection,
      };
      if (
        catalogBatchAction !== "disable" &&
        markupBps !== null &&
        minimumCustomerPriceUsdMicros !== null
      ) {
        request.pricing = {
          markupBps,
          minimumCustomerPriceUsdMicros,
        };
      }
      return request;
    },
    [
      catalog,
      catalogBatchAction,
      catalogBatchMarkupPercent,
      catalogBatchMinimumPrice,
      catalogDataType,
      catalogPlatform,
      catalogQuery,
      catalogSafety,
      catalogStatus,
      catalogSurface,
      catalogTag,
    ],
  );

  const catalogBatchRequestMatchesCurrent =
    catalogBatchRequest !== null &&
    currentCatalogBatchRequest !== null &&
    JSON.stringify(catalogBatchRequest) ===
      JSON.stringify(currentCatalogBatchRequest);

  const visibleEndpoints = useMemo(() => {
    if (catalog.status !== "ready") return [];
    const query = catalogQuery.trim().toLocaleLowerCase("zh-CN");
    const selectedTagKey =
      catalogTag === null ? null : normalizeCatalogTagKey(catalogTag);
    return catalog.data.endpoints.filter((endpoint) => {
      const matchesQuery =
        !query ||
        endpoint.path.toLocaleLowerCase("zh-CN").includes(query) ||
        endpoint.platform.toLocaleLowerCase("zh-CN").includes(query) ||
        endpoint.dataType.toLocaleLowerCase("zh-CN").includes(query) ||
        endpoint.surface.toLocaleLowerCase("zh-CN").includes(query) ||
        endpoint.operationId?.toLocaleLowerCase("zh-CN").includes(query) ||
        endpoint.tags.some((tag) =>
          tag.toLocaleLowerCase("zh-CN").includes(query),
        ) ||
        endpoint.summary?.toLocaleLowerCase("zh-CN").includes(query);
      const matchesPlatform =
        catalogPlatform === "all" || endpoint.platform === catalogPlatform;
      const matchesDataType =
        catalogDataType === "all" || endpoint.dataType === catalogDataType;
      const matchesTag =
        selectedTagKey === null ||
        endpoint.tags.some(
          (tag) => normalizeCatalogTagKey(tag) === selectedTagKey,
        );
      const matchesSurface =
        catalogSurface === "all" || endpoint.surface === catalogSurface;
      const matchesStatus =
        catalogStatus === "all" ||
        (catalogStatus === "enabled" && endpoint.enabled) ||
        (catalogStatus === "disabled" && !endpoint.enabled) ||
        (catalogStatus === "review" &&
          (!endpoint.reviewedAt ||
            !endpoint.presentInLatestSync ||
            !endpoint.priceVerified ||
            endpoint.safetyClassification !== "safe_data_read" ||
            endpoint.safetyPolicyVersion !== CATALOG_SAFETY_POLICY_VERSION));
      const matchesSafety =
        catalogSafety === "all" ||
        endpoint.safetyClassification === catalogSafety;
      return (
        matchesQuery &&
        matchesPlatform &&
        matchesDataType &&
        matchesTag &&
        matchesSurface &&
        matchesStatus &&
        matchesSafety
      );
    });
  }, [
    catalog,
    catalogDataType,
    catalogPlatform,
    catalogQuery,
    catalogSafety,
    catalogStatus,
    catalogSurface,
    catalogTag,
  ]);

  const visibleRouteEndpoints = useMemo(() => {
    if (catalog.status !== "ready") return [];
    const query = catalogQuery.trim().toLocaleLowerCase("zh-CN");
    return catalog.data.endpoints.filter((endpoint) => {
      if (!endpoint.enabled && !catalogEndpointConfirmable(endpoint)) {
        return false;
      }
      const matchesQuery =
        !query ||
        endpoint.path.toLocaleLowerCase("zh-CN").includes(query) ||
        endpoint.platform.toLocaleLowerCase("zh-CN").includes(query) ||
        endpoint.dataType.toLocaleLowerCase("zh-CN").includes(query) ||
        endpoint.surface.toLocaleLowerCase("zh-CN").includes(query) ||
        endpoint.operationId?.toLocaleLowerCase("zh-CN").includes(query) ||
        endpoint.tags.some((tag) =>
          tag.toLocaleLowerCase("zh-CN").includes(query),
        ) ||
        endpoint.summary?.toLocaleLowerCase("zh-CN").includes(query);
      const matchesPlatform =
        catalogPlatform === "all" || endpoint.platform === catalogPlatform;
      const matchesDataType =
        catalogDataType === "all" || endpoint.dataType === catalogDataType;
      const matchesAvailability =
        catalogRuntimeAvailability === "all" ||
        (catalogRuntimeAvailability === "available" &&
          endpoint.marketplaceAvailability === "available") ||
        (catalogRuntimeAvailability === "unavailable" &&
          endpoint.marketplaceAvailability !== "available");
      return (
        matchesQuery &&
        matchesPlatform &&
        matchesDataType &&
        matchesAvailability
      );
    });
  }, [
    catalog,
    catalogDataType,
    catalogPlatform,
    catalogQuery,
    catalogRuntimeAvailability,
  ]);

  const displayedEndpoints =
    catalogView === "routes" ? visibleRouteEndpoints : visibleEndpoints;
  const displayedEndpointPageCount = Math.max(
    1,
    Math.ceil(displayedEndpoints.length / ROUTE_CATALOG_PAGE_SIZE),
  );
  const safeCatalogPage = Math.min(
    catalogPage,
    displayedEndpointPageCount - 1,
  );
  const pagedDisplayedEndpoints = useMemo(() => {
    const start = safeCatalogPage * ROUTE_CATALOG_PAGE_SIZE;
    return displayedEndpoints.slice(
      start,
      start + ROUTE_CATALOG_PAGE_SIZE,
    );
  }, [displayedEndpoints, safeCatalogPage]);
  const publishedEndpointTotal =
    catalog.status === "ready"
      ? catalog.data.endpoints.filter((endpoint) => endpoint.enabled).length
      : 0;
  const availableEndpointTotal =
    catalog.status === "ready"
      ? catalog.data.endpoints.filter(
          (endpoint) => endpoint.marketplaceAvailability === "available",
        ).length
      : 0;
  const visibleConfirmableEndpoints = useMemo(
    () =>
      visibleRouteEndpoints.filter((endpoint) =>
        catalogEndpointConfirmable(endpoint),
      ),
    [visibleRouteEndpoints],
  );
  const selectedConfirmableEndpoints = useMemo(() => {
    if (catalog.status !== "ready") return [];
    return catalog.data.endpoints.filter(
      (endpoint) =>
        selectedPendingPaths.has(endpoint.path) &&
        catalogEndpointConfirmable(endpoint),
    );
  }, [catalog, selectedPendingPaths]);
  const allVisiblePendingSelected =
    visibleConfirmableEndpoints.length > 0 &&
    visibleConfirmableEndpoints.every((endpoint) =>
      selectedPendingPaths.has(endpoint.path),
    );

  const filteredPendingEndpoints = useMemo(() => {
    if (pendingCatalog.status !== "ready") return [];
    const query = pendingCatalogQuery
      .trim()
      .toLocaleLowerCase("zh-CN");
    if (!query) return pendingCatalog.data.endpoints;
    return pendingCatalog.data.endpoints.filter(
      (endpoint) =>
        endpoint.path.toLocaleLowerCase("zh-CN").includes(query) ||
        endpoint.platform.toLocaleLowerCase("zh-CN").includes(query) ||
        endpoint.dataType.toLocaleLowerCase("zh-CN").includes(query) ||
        endpoint.surface.toLocaleLowerCase("zh-CN").includes(query) ||
        endpoint.summary.toLocaleLowerCase("zh-CN").includes(query),
    );
  }, [pendingCatalog, pendingCatalogQuery]);

  const pendingCatalogPageCount = Math.max(
    1,
    Math.ceil(
      filteredPendingEndpoints.length / PENDING_CATALOG_PAGE_SIZE,
    ),
  );
  const safePendingCatalogPage = Math.min(
    pendingCatalogPage,
    pendingCatalogPageCount - 1,
  );
  const visiblePendingEndpoints = useMemo(() => {
    const start = safePendingCatalogPage * PENDING_CATALOG_PAGE_SIZE;
    return filteredPendingEndpoints.slice(
      start,
      start + PENDING_CATALOG_PAGE_SIZE,
    );
  }, [filteredPendingEndpoints, safePendingCatalogPage]);

  const visiblePayments = useMemo(() => {
    if (payments.status !== "ready") return [];
    return payments.data.payments.filter(
      (payment) =>
        paymentFilter === "all" || payment.status === paymentFilter,
    );
  }, [paymentFilter, payments]);

  const paymentStatuses = useMemo(() => {
    if (payments.status !== "ready") return [];
    return Array.from(
      new Set(payments.data.payments.map((payment) => payment.status)),
    ).sort();
  }, [payments]);

  async function createAdminMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = newAdminEmail.trim().toLocaleLowerCase("en-US");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setNotice("请输入已经登录过 RelayBase 的有效用户邮箱。");
      return;
    }
    if (
      !window.confirm(
        `确认授予 ${email} ${newAdminRole.toUpperCase()} 权限？该操作会写入审计日志。`,
      )
    ) {
      return;
    }
    setSavingAdminMember(true);
    setNotice("");
    try {
      await adminRequest(
        "/api/admin/members",
        adminSecret,
        isAdminMemberMutationResponse,
        {
          method: "POST",
          body: JSON.stringify({ email, role: newAdminRole }),
        },
      );
      setNewAdminEmail("");
      setNewAdminRole("auditor");
      await loadAdminMembers();
      setNotice(`已授予 ${email} 管理员权限。`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "管理员授权失败。",
      );
    } finally {
      setSavingAdminMember(false);
    }
  }

  async function updateAdminMember(
    member: AdminMember,
    input: {
      role: AdminRole;
      status: "active" | "suspended";
    },
  ) {
    const change =
      input.status !== member.status
        ? input.status === "active"
          ? "恢复"
          : "停用"
        : `调整为 ${input.role.toUpperCase()}`;
    if (
      !window.confirm(
        `确认${change}管理员 ${member.email}？该操作会立即生效并写入审计日志。`,
      )
    ) {
      return;
    }
    setSavingAdminMember(true);
    setNotice("");
    try {
      await adminRequest(
        "/api/admin/members",
        adminSecret,
        isAdminMemberMutationResponse,
        {
          method: "PATCH",
          body: JSON.stringify({
            userId: member.userId,
            role: input.role,
            status: input.status,
          }),
        },
      );
      await loadAdminMembers();
      setNotice(`管理员 ${member.email} 已更新。`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "管理员更新失败。",
      );
    } finally {
      setSavingAdminMember(false);
    }
  }

  function submitSecret(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void authenticate(secretInput);
  }

  async function submitUpstreamConfig(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (upstreamConfig.status !== "ready") {
      setNotice("请先刷新数据源配置。");
      return;
    }
    if (!upstreamConfig.data.originAllowlistConfigured) {
      setNotice("部署环境尚未配置数据源 Origin 允许列表，暂时不能保存。");
      return;
    }

    const sourceOrigin = upstreamConfigDraft.sourceOrigin
      .trim()
      .replace(/\/+$/, "");
    const normalizePath = (value: string) =>
      value.trim().replace(/\/+$/, "");
    const apiPathPrefix = normalizePath(
      upstreamConfigDraft.apiPathPrefix,
    );
    const openApiPath = normalizePath(upstreamConfigDraft.openApiPath);
    const catalogPath = normalizePath(upstreamConfigDraft.catalogPath);
    const credentialPath = normalizePath(
      upstreamConfigDraft.credentialPath,
    );
    const publicExcludedPrefixes = [
      ...new Set(
        upstreamConfigDraft.publicExcludedPrefixesText
          .split(/\r?\n/)
          .map((prefix) => prefix.trim())
          .filter(Boolean)
          .map(
            (prefix) =>
              `${prefix.replace(/\/+$/, "")}/`,
          ),
      ),
    ].sort();

    if (!isUpstreamSourceOrigin(sourceOrigin)) {
      setNotice("数据源 Origin 必须是无路径、无端口的公开 HTTPS Origin。");
      return;
    }
    if (
      !isUpstreamConfigPath(apiPathPrefix, { allowEmpty: true }) ||
      !isUpstreamConfigPath(openApiPath) ||
      !isUpstreamConfigPath(catalogPath) ||
      !isUpstreamConfigPath(credentialPath)
    ) {
      setNotice(
        "数据源路径必须以 / 开头，不能包含查询参数、片段、双斜杠或 ..。",
      );
      return;
    }
    if (
      publicExcludedPrefixes.length > 100 ||
      !publicExcludedPrefixes.every((prefix) =>
        isUpstreamConfigPath(prefix, { publicPrefix: true }),
      )
    ) {
      setNotice(
        "公开排除前缀最多 100 条，每行一条，且必须以 /v1/ 开头。",
      );
      return;
    }

    setSavingUpstreamConfig(true);
    setNotice("");
    try {
      const result = await adminRequest(
        "/api/admin/upstream-config",
        adminSecret,
        isUpstreamConfigMutationResponse,
        {
          method: "PUT",
          body: JSON.stringify({
            enabled: upstreamConfigDraft.enabled,
            sourceOrigin,
            apiPathPrefix,
            openApiPath,
            catalogPath,
            credentialPath,
            catalogAuthMode: upstreamConfigDraft.catalogAuthMode,
            publicExcludedPrefixes,
            expectedVersion:
              upstreamConfig.data.config?.version ?? 0,
          }),
        },
      );
      setUpstreamConfig({
        status: "ready",
        data: {
          configured: true,
          config: result.config,
          originAllowlistConfigured:
            upstreamConfig.data.originAllowlistConfigured,
        },
      });
      setUpstreamConfigDraft(upstreamConfigDraftFrom(result.config));
      setNotice(
        `数据源配置已保存为 v${result.config.version}。原目录与凭据验证状态已失效，请重新验证活动凭据并同步目录后再上架服务。`,
      );
      await Promise.all([
        loadUpstreamCredentials(),
        loadCatalog(),
        loadPendingCatalog(),
        loadOverview(),
      ]);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "数据源配置保存失败。",
      );
      if (error instanceof AdminApiError && error.status === 409) {
        await loadUpstreamConfig();
      }
    } finally {
      setSavingUpstreamConfig(false);
    }
  }

  async function submitUpstreamCredential(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (upstreamCredentials.status !== "ready") {
      setNotice("请先刷新上游凭据状态。");
      return;
    }
    const label = upstreamLabel.replace(/\s+/g, " ").trim();
    if (label.length < 2 || label.length > 80) {
      setNotice("上游凭据名称必须是 2–80 个字符。");
      return;
    }
    if (
      !/^[\x21-\x7E]{16,512}$/.test(upstreamApiKey)
    ) {
      setNotice("请输入 16–512 个 ASCII 可见字符组成的上游 API Key。");
      return;
    }
    if (!upstreamCredentials.data.encryptionConfigured) {
      setNotice(
        "服务端尚未配置 UPSTREAM_CREDENTIALS_ENCRYPTION_KEY，不能保存上游密钥。",
      );
      return;
    }
    const priority = Number(upstreamPriority);
    const weight = Number(upstreamWeight);
    if (
      !Number.isSafeInteger(priority) ||
      priority < 1 ||
      priority > 10_000 ||
      !Number.isSafeInteger(weight) ||
      weight < 1 ||
      weight > 10_000
    ) {
      setNotice("优先级和权重必须是 1–10,000 的整数。");
      return;
    }
    const creatingCapacityGroup = upstreamCapacityGroupId === "new";
    const capacityGroupLabel = upstreamCapacityGroupLabel
      .replace(/\s+/g, " ")
      .trim();
    const configuredRpsPerEndpoint = Number(upstreamConfiguredRps);
    const headroomPercent = Number(upstreamHeadroomPercent);
    if (
      creatingCapacityGroup &&
      (capacityGroupLabel.length < 2 ||
        capacityGroupLabel.length > 80 ||
        !Number.isSafeInteger(configuredRpsPerEndpoint) ||
        configuredRpsPerEndpoint < 1 ||
        configuredRpsPerEndpoint > 10_000 ||
        !Number.isSafeInteger(headroomPercent) ||
        headroomPercent < 10 ||
        headroomPercent > 100)
    ) {
      setNotice(
        "新容量组名称需为 2–80 字符，接口 RPS 为 1–10,000，安全使用比例为 10%–100%。",
      );
      return;
    }

    setSavingUpstreamCredential(true);
    setNotice("");
    try {
      const apiKey = upstreamApiKey;
      const result = await adminRequest(
        "/api/admin/upstream-credentials",
        adminSecret,
        isUpstreamCredentialMutationResponse,
        {
          method: "POST",
          body: JSON.stringify({
            label,
            apiKey,
            activate: activateUpstreamAfterSave,
            expectedVersion: upstreamCredentials.data.stateVersion,
            capacityGroupId: creatingCapacityGroup
              ? undefined
              : upstreamCapacityGroupId,
            capacityGroupLabel: creatingCapacityGroup
              ? capacityGroupLabel
              : undefined,
            configuredRpsPerEndpoint: creatingCapacityGroup
              ? configuredRpsPerEndpoint
              : undefined,
            headroomPercent: creatingCapacityGroup
              ? headroomPercent
              : undefined,
            priority,
            weight,
          }),
        },
      );
      setUpstreamApiKey("");
      setNotice(
        result.activationConflict
          ? `已加密保存 ${result.credential.label} 为备用；活动数据源在提交期间发生变化，请从列表重新确认切换。`
          : result.credential.status === "active"
          ? `已验证并启用 ${result.credential.label}；下一步请到“路由与定价”同步上游目录。`
          : `已加密保存 ${result.credential.label}，当前为备用状态。`,
      );
      await Promise.all([
        loadUpstreamCredentials(),
        loadOverview(),
      ]);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "上游凭据保存失败。",
      );
      await loadUpstreamCredentials();
    } finally {
      setSavingUpstreamCredential(false);
    }
  }

  async function previewCatalogBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (previewingCatalogBatch || applyingCatalogBatch) return;
    if (
      catalog.status !== "ready" ||
      !catalog.data.sync ||
      !catalog.data.sync.coverage
    ) {
      setCatalogBatchError(
        "当前目录没有完整覆盖证明，请先成功同步上游后再生成批量预览。",
      );
      return;
    }
    if (
      catalogQuery.length > 120 ||
      /[\u0000-\u001F\u007F]/.test(catalogQuery)
    ) {
      setCatalogBatchError("目录搜索条件必须不超过 120 个可见字符。");
      return;
    }
    if (!currentCatalogBatchRequest) {
      setCatalogBatchError(
        "加价百分比必须为 0%–500%，最多 2 位小数；最低客户价必须为 $0.000001–$100。",
      );
      return;
    }

    const requestSignature = JSON.stringify(currentCatalogBatchRequest);
    if (
      !catalogBatchPreviewRetry.current ||
      catalogBatchPreviewRetry.current.requestSignature !== requestSignature
    ) {
      catalogBatchPreviewRetry.current = {
        requestSignature,
        idempotencyKey: createAdminIdempotencyKey("preview"),
      };
    }
    const idempotencyKey =
      catalogBatchPreviewRetry.current.idempotencyKey;
    setPreviewingCatalogBatch(true);
    setCatalogBatchError("");
    setNotice("");
    try {
      const result = await adminRequest(
        "/api/admin/catalog/batches/preview",
        adminSecret,
        isCatalogBatchResponse,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: requestSignature,
        },
      );
      if (catalogBatch?.batch.id !== result.batch.id) {
        catalogBatchApplyRetry.current = null;
      }
      setCatalogBatch(result);
      setCatalogBatchRequest(currentCatalogBatchRequest);
      setCatalogBatchConfirmation("");
      catalogBatchPreviewRetry.current = null;
      setNotice(
        result.batch.status === "ready"
          ? `批量预览已冻结：匹配 ${result.batch.counts.matched} 项，计划修改 ${result.batch.counts.selected} 项。请核对后手输完整确认文本。`
          : `批量预览已生成但整批不可应用：${result.batch.counts.blocked} 项阻断，${result.batch.counts.noChange} 项无需变化。`,
      );
    } catch (error) {
      setCatalogBatchError(
        error instanceof Error ? error.message : "批量目录预览生成失败。",
      );
    } finally {
      setPreviewingCatalogBatch(false);
    }
  }

  async function refreshCatalogBatch() {
    if (!catalogBatch || refreshingCatalogBatch || applyingCatalogBatch) return;
    setRefreshingCatalogBatch(true);
    setCatalogBatchError("");
    try {
      const result = await adminRequest(
        `/api/admin/catalog/batches/${encodeURIComponent(
          catalogBatch.batch.id,
        )}?limit=100&offset=0`,
        adminSecret,
        isCatalogBatchResponse,
      );
      setCatalogBatch(result);
      if (result.batch.status === "applied") {
        await Promise.all([loadCatalog(), loadOverview()]);
      }
    } catch (error) {
      setCatalogBatchError(
        error instanceof Error ? error.message : "批量目录回执刷新失败。",
      );
    } finally {
      setRefreshingCatalogBatch(false);
    }
  }

  async function applyCatalogBatch() {
    if (!catalogBatch || applyingCatalogBatch || previewingCatalogBatch) return;
    const batch = catalogBatch.batch;
    if (!catalogBatchRequestMatchesCurrent) {
      setCatalogBatchError(
        "筛选条件、定价规则或目录代次已变化；请按当前条件重新生成预览。",
      );
      return;
    }
    if (batch.status !== "ready" || batch.counts.blocked !== 0) {
      setCatalogBatchError("当前批量预览不是可应用状态。");
      return;
    }
    if (Date.parse(batch.expiresAt) <= Date.now()) {
      setCatalogBatchError("当前批量预览已过期，请重新生成。");
      return;
    }
    if (catalogBatchConfirmation !== batch.confirmationText) {
      setCatalogBatchError("请逐字手输完整确认文本后再应用。");
      return;
    }

    const payload = {
      expectedVersion: batch.version,
      previewDigest: batch.targetDigest,
      confirmation: catalogBatchConfirmation,
    };
    const requestSignature = JSON.stringify(payload);
    if (
      !catalogBatchApplyRetry.current ||
      catalogBatchApplyRetry.current.batchId !== batch.id ||
      catalogBatchApplyRetry.current.requestSignature !== requestSignature
    ) {
      catalogBatchApplyRetry.current = {
        batchId: batch.id,
        requestSignature,
        idempotencyKey: createAdminIdempotencyKey("apply"),
      };
    }
    const idempotencyKey = catalogBatchApplyRetry.current.idempotencyKey;
    setApplyingCatalogBatch(true);
    setCatalogBatchError("");
    setNotice("");
    try {
      const result = await adminRequest(
        `/api/admin/catalog/batches/${encodeURIComponent(batch.id)}/apply`,
        adminSecret,
        isCatalogBatchResponse,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: requestSignature,
        },
      );
      setCatalogBatch(result);
      if (result.batch.status === "applied") {
        setNotice(
          `${result.replayed ? "已确认重复请求回执" : "批量操作完成"}：${catalogBatchActionLabel(
            result.batch.action,
          )} ${result.batch.counts.selected} 项。`,
        );
        await Promise.all([loadCatalog(), loadOverview()]);
      } else {
        setNotice("批量操作请求已接收，请刷新回执确认最终状态。");
      }
    } catch (error) {
      setCatalogBatchError(
        error instanceof Error
          ? `${error.message} 相同请求重试会继续使用原幂等键。`
          : "批量目录应用失败；相同请求重试会继续使用原幂等键。",
      );
    } finally {
      setApplyingCatalogBatch(false);
    }
  }

  async function saveEndpointPrice(endpoint: CatalogEndpoint) {
    const price = parseUsdInput(priceDrafts[endpoint.path] ?? "");
    if (price === null) {
      setNotice("价格必须是 $0.000001–$100，最多 6 位小数。");
      return;
    }
    if (price < endpoint.upstreamPriceUsdMicros) {
      setNotice("客户价不能低于当前上游成本。");
      return;
    }
    setSavingPath(endpoint.path);
    setNotice("");
    try {
      await adminRequest(
        "/api/admin/catalog",
        adminSecret,
        isCatalogUpdateResponse,
        {
          method: "PATCH",
          body: JSON.stringify({
            path: endpoint.path,
            enabled: endpoint.enabled,
            readOnly: endpoint.readOnly,
            customerPriceUsdMicros: price,
            expectedRevision: endpoint.revision,
          }),
        },
      );
      setNotice(`已保存 ${endpoint.path} 的客户价。`);
      await loadCatalog();
      await loadOverview();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "价格保存失败。");
    } finally {
      setSavingPath("");
    }
  }

  async function saveX402Config(
    endpoint: CatalogEndpoint,
    enabled: boolean,
  ) {
    const draft = x402Drafts[endpoint.path];
    const unitPriceUsdMicros = parseUsdInput(draft?.price ?? "");
    const maxBatchSize = Number(draft?.maxBatchSize ?? "");
    if (
      unitPriceUsdMicros === null ||
      unitPriceUsdMicros < endpoint.upstreamPriceUsdMicros
    ) {
      setNotice("x402 单目标价格必须有效且不得低于当前上游成本。");
      return;
    }
    if (
      !Number.isSafeInteger(maxBatchSize) ||
      maxBatchSize < 1 ||
      maxBatchSize > 1_000
    ) {
      setNotice("x402 每批上限必须是 1–1000 的整数。");
      return;
    }
    setSavingX402Path(endpoint.path);
    setNotice("");
    try {
      const result = await adminRequest(
        "/api/admin/x402/config",
        adminSecret,
        isX402ConfigMutationResponse,
        {
          method: "PATCH",
          body: JSON.stringify({
            path: endpoint.path,
            enabled,
            unitPriceUsdMicros,
            maxBatchSize,
            expectedRevision: endpoint.x402.revision,
          }),
        },
      );
      setNotice(
        `${result.config.path} 的 x402 批量入口已${
          result.config.enabled ? "启用" : "停用"
        }；前台实际在线状态仍由路由与结算运行条件共同决定。`,
      );
      await Promise.all([loadCatalog(), loadX402Admin(), loadOverview()]);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "x402 配置保存失败。",
      );
    } finally {
      setSavingX402Path("");
    }
  }

  async function saveX402RuntimeConfig() {
    if (x402Admin.status !== "ready") return;
    const config = x402Admin.data.configuration;
    const payTo = x402RuntimeDraft.payTo.trim();
    if (
      x402RuntimeDraft.managedEnabled &&
      !/^0x[0-9a-fA-F]{40}$/.test(payTo)
    ) {
      setNotice("请输入有效的 Base 收款 EVM 0x 地址。");
      return;
    }
    try {
      const facilitator = new URL(
        x402RuntimeDraft.facilitatorUrl.trim(),
      );
      if (
        facilitator.protocol !== "https:" ||
        facilitator.username ||
        facilitator.password ||
        facilitator.search ||
        facilitator.hash
      ) {
        throw new Error();
      }
    } catch {
      setNotice("facilitator 地址必须是安全的 HTTPS 地址。");
      return;
    }
    if (
      x402RuntimeDraft.managedEnabled &&
      x402RuntimeDraft.facilitatorProvider === "cdp" &&
      ((!config.managedCredentials.cdpApiKeyIdConfigured &&
        !x402RuntimeDraft.cdpApiKeyId) ||
        (!config.managedCredentials.cdpApiKeySecretConfigured &&
          !x402RuntimeDraft.cdpApiKeySecret))
    ) {
      setNotice("启用后台托管 CDP 前，请填写 API Key ID 与 Ed25519 Secret。");
      return;
    }
    if (
      x402RuntimeDraft.managedEnabled &&
      x402RuntimeDraft.facilitatorProvider === "custom" &&
      !config.managedCredentials.bearerTokenConfigured &&
      !x402RuntimeDraft.bearerToken
    ) {
      setNotice("启用自定义 facilitator 前，请填写 Bearer Token。");
      return;
    }
    setSavingX402Runtime(true);
    setNotice("");
    try {
      const result = await adminRequest(
        "/api/admin/x402/runtime-config",
        adminSecret,
        isX402RuntimeConfigMutationResponse,
        {
          method: "PUT",
          body: JSON.stringify({
            managedEnabled: x402RuntimeDraft.managedEnabled,
            enabled: x402RuntimeDraft.enabled,
            payTo,
            facilitatorUrl: x402RuntimeDraft.facilitatorUrl.trim(),
            cdpApiKeyId:
              x402RuntimeDraft.cdpApiKeyId || undefined,
            cdpApiKeySecret:
              x402RuntimeDraft.cdpApiKeySecret || undefined,
            bearerToken:
              x402RuntimeDraft.bearerToken || undefined,
            expectedRevision: config.revision,
          }),
        },
      );
      setNotice(
        result.runtime.mode === "live"
          ? "x402 收款地址与 facilitator 凭据已加密保存，运行时当前在线。"
          : "x402 运行配置已加密保存；当前仍未就绪，请按状态提示补齐条件。",
      );
      await Promise.all([loadX402Admin(), loadCatalog(), loadOverview()]);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "x402 运行配置保存失败。",
      );
    } finally {
      setSavingX402Runtime(false);
    }
  }

  async function confirmSelectedRoutes() {
    if (!selectedConfirmableEndpoints.length) {
      setNotice("请先选择至少一个待确认接口。");
      setRouteBatchConfirmOpen(false);
      return;
    }
    setConfirmingRouteBatch(true);
    setNotice("");
    try {
      const result = await adminRequest(
        "/api/admin/catalog/confirm",
        adminSecret,
        isCatalogConfirmResponse,
        {
          method: "POST",
          body: JSON.stringify({
            items: selectedConfirmableEndpoints.map((endpoint) => ({
              path: endpoint.path,
              expectedRevision: endpoint.revision,
            })),
          }),
        },
      );
      setNotice(`已确认 ${result.count} 个接口添加到前台。`);
      setSelectedPendingPaths(new Set());
      setRouteBatchConfirmOpen(false);
      await Promise.all([loadCatalog(), loadOverview()]);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "批量确认失败，整批未应用。",
      );
    } finally {
      setConfirmingRouteBatch(false);
    }
  }

  async function savePendingEndpointPrice(
    endpoint: PendingCatalogEndpoint,
  ) {
    const price = parsePendingUsdInput(
      pendingPriceDrafts[endpoint.path] ?? "",
    );
    if (price === null) {
      setNotice("客户价必须是 $0–$100，最多 6 位小数。");
      return;
    }
    if (price < endpoint.upstreamPriceUsdMicros) {
      setNotice("客户价不能低于当前上游成本。");
      return;
    }
    setSavingPendingPath(endpoint.path);
    setNotice("");
    try {
      const result = await adminRequest(
        "/api/admin/catalog/pending",
        adminSecret,
        isPendingCatalogPriceUpdateResponse,
        {
          method: "PATCH",
          body: JSON.stringify({
            path: endpoint.path,
            customerPriceUsdMicros: price,
            expectedUpdatedAt: endpoint.updatedAt,
          }),
        },
      );
      setPendingCatalog((current) => {
        if (current.status !== "ready") return current;
        return {
          status: "ready",
          data: {
            ...current.data,
            endpoints: current.data.endpoints.map((item) =>
              item.path === result.path
                ? {
                    ...item,
                    customerPriceUsdMicros:
                      result.customerPriceUsdMicros,
                    updatedAt: result.updatedAt,
                  }
                : item,
            ),
          },
        };
      });
      setPendingPriceDrafts((current) => ({
        ...current,
        [result.path]: usdInputValue(result.customerPriceUsdMicros),
      }));
      setNotice(
        `已保存 ${result.path} 的客户价；该服务仍不可调用或上架，需等待文档与方法补齐。`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "文档待同步服务价格保存失败。",
      );
      if (
        error instanceof AdminApiError &&
        (error.status === 404 || error.status === 409)
      ) {
        await loadPendingCatalog();
      }
    } finally {
      setSavingPendingPath("");
    }
  }

  function openReviewResolution(
    review: PaymentReview,
    action: ReviewAction,
  ) {
    setReviewResolution({ review, action });
    setReviewCreditAmount("");
    setReviewNote("");
    setNotice("");
  }

  async function recoverPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (recoveringPayment) return;
    const orderId = recoveryOrderId.trim();
    const paymentId = recoveryPaymentId.trim();
    if (
      !/^pay_[A-Za-z0-9_-]+$/.test(orderId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(paymentId)
    ) {
      setNotice("请输入有效的 RelayBase 订单编号和支付服务商编号。");
      return;
    }
    setRecoveringPayment(true);
    setNotice("");
    try {
      const result = await adminRequest(
        "/api/admin/payments/recover",
        adminSecret,
        isPaymentRecoveryResponse,
        {
          method: "POST",
          body: JSON.stringify({ orderId, paymentId }),
        },
      );
      setNotice(
        `已核验并恢复 ${result.payment.id}，当前状态：${paymentStatusLabel(
          result.payment.status,
        )}。`,
      );
      setRecoveryOrderId("");
      setRecoveryPaymentId("");
      await Promise.all([
        loadPayments(),
        loadPaymentReviews(),
        loadOverview(),
      ]);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "支付订单恢复失败。",
      );
    } finally {
      setRecoveringPayment(false);
    }
  }

  async function resolvePaymentReview() {
    if (!reviewResolution || resolvingReview) return;
    const note = reviewNote.trim();
    if (note.length < 4 || note.length > 500) {
      setNotice("支付复核备注必须为 4–500 个字符。");
      return;
    }
    const creditUsdMicros =
      reviewResolution.action === "credit"
        ? parseCreditUsdInput(reviewCreditAmount)
        : null;
    if (reviewResolution.action === "credit" && creditUsdMicros === null) {
      setNotice("请输入有效的入账美元金额，最多 6 位小数。");
      return;
    }

    setResolvingReview(true);
    setNotice("");
    try {
      const result = await adminRequest(
        "/api/admin/payment-reviews/resolve",
        adminSecret,
        isReviewResolveResponse,
        {
          method: "POST",
          body: JSON.stringify({
            caseId: reviewResolution.review.id,
            action: reviewResolution.action,
            ...(creditUsdMicros !== null ? { creditUsdMicros } : {}),
            note,
          }),
        },
      );
      const resultLabels: Record<ReviewAction, string> = {
        credit: "已核验并入账",
        refund_confirmed: "已确认退款并结案",
        reject: "已拒绝并结案",
      };
      setNotice(
        `${resultLabels[result.action]}：${reviewResolution.review.orderId}。`,
      );
      setReviewResolution(null);
      setReviewCreditAmount("");
      setReviewNote("");
      await Promise.all([
        loadPaymentReviews(),
        loadPayments(),
        loadOverview(),
      ]);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "支付复核处理失败。",
      );
    } finally {
      setResolvingReview(false);
    }
  }

  async function runConfirmedAction() {
    if (!confirmAction) return;
    setMutating(true);
    setNotice("");
    try {
      if (confirmAction.kind === "user") {
        await adminRequest(
          "/api/admin/users",
          adminSecret,
          isUserUpdateResponse,
          {
            method: "PATCH",
            body: JSON.stringify({
              userId: confirmAction.user.id,
              status: confirmAction.nextStatus,
              expectedStatus: confirmAction.user.status,
            }),
          },
        );
        setNotice(
          confirmAction.nextStatus === "suspended"
            ? `已暂停 ${confirmAction.user.email} 的调用权限。`
              : `已恢复 ${confirmAction.user.email} 的账户；用户需要创建新的 API Key。`,
        );
        await Promise.all([loadUsers(), loadOverview()]);
      } else if (confirmAction.kind === "endpoint") {
        const endpoint = confirmAction.endpoint;
        const price =
          parseUsdInput(priceDrafts[endpoint.path] ?? "") ??
          endpoint.customerPriceUsdMicros;
        await adminRequest(
          "/api/admin/catalog",
          adminSecret,
          isCatalogUpdateResponse,
          {
            method: "PATCH",
            body: JSON.stringify({
              path: endpoint.path,
              enabled: confirmAction.nextEnabled,
              readOnly: confirmAction.nextEnabled ? true : endpoint.readOnly,
              customerPriceUsdMicros: price,
              expectedRevision: endpoint.revision,
            }),
          },
        );
        setNotice(
          confirmAction.nextEnabled
            ? `已将 ${endpoint.path} 添加到前台；实际可用性以当前后端状态为准。`
            : `已从前台移除 ${endpoint.path}，新请求将无法调用。`,
        );
        await Promise.all([loadCatalog(), loadOverview()]);
      } else if (confirmAction.kind === "credential") {
        if (upstreamCredentials.status !== "ready") {
          throw new AdminApiError(
            "上游凭据状态尚未加载，请刷新后重试。",
            409,
          );
        }
        const result = await adminRequest(
          "/api/admin/upstream-credentials",
          adminSecret,
          isUpstreamCredentialMutationResponse,
          {
            method: "PATCH",
            body: JSON.stringify({
              id: confirmAction.credential.id,
              action: confirmAction.action,
              expectedVersion: confirmAction.expectedVersion,
            }),
          },
        );
        setNotice(
          confirmAction.action === "activate"
            ? `已验证并切换到 ${result.credential.label}；下一步请到“路由与定价”重新同步上游目录。`
            : `已撤销 ${result.credential.label}；密文不会再被运行时使用。`,
        );
        await Promise.all([
          loadUpstreamCredentials(),
          loadOverview(),
        ]);
      } else {
        const result = await adminRequest(
          "/api/admin/catalog/sync",
          adminSecret,
          isCatalogSyncResponse,
          { method: "POST" },
        );
        setNotice(
          `同步完成：OpenAPI ${result.openApiOperations} 条，价格原始 ${result.rawPriceRows} / 去重 ${result.normalizedPrices} 条；映射 ${result.openApiPriceMapped}、仅价格目录 ${result.priceOnly}、仅 OpenAPI ${result.openApiOnly}、Key scope 排除 ${result.scopeExcluded}；最终核验 ${result.priced} 条（正价 ${result.positivePrice}、零价 ${result.zeroPrice}），文档待同步 ${result.pendingDocumentation} 条，停用缺失端点 ${result.disabledMissing} 条。`,
        );
        await Promise.all([
          loadCatalog(),
          loadPendingCatalog(),
          loadOverview(),
        ]);
      }
      setConfirmAction(null);
    } catch (error) {
      if (
        confirmAction.kind === "credential" &&
        error instanceof AdminApiError &&
        error.status === 409
      ) {
        setConfirmAction(null);
        await loadUpstreamCredentials();
        setNotice("上游活动凭据状态已变化，请重新确认本次操作。");
      } else {
        setNotice(error instanceof Error ? error.message : "管理操作失败。");
      }
    } finally {
      setMutating(false);
    }
  }

  if (!adminSecret) {
    return (
      <main className="admin-login-page" id="main-content">
        <section className="admin-login-card" aria-labelledby="admin-login-title">
          <div className="admin-login-mark" aria-hidden="true">
            R/
          </div>
          <p className="section-kicker">RELAYBASE / OPERATIONS</p>
          <h1 id="admin-login-title">运营管理后台</h1>
          <p className="admin-login-intro">
            运营后台使用当前登录账户的具名管理员角色。首次启用时，
            Owner 需要用紧急引导凭证完成一次绑定。
          </p>
          <form onSubmit={submitSecret}>
            <label htmlFor="admin-secret">首次引导 / 紧急恢复凭证</label>
            <input
              id="admin-secret"
              type="password"
              autoComplete="off"
              spellCheck={false}
              minLength={32}
              maxLength={512}
              required
              value={secretInput}
              onChange={(event) => setSecretInput(event.target.value)}
              placeholder="仅首次绑定 Owner 时输入"
            />
            {authError ? (
              <p className="admin-form-error" role="alert">
                {authError}
              </p>
            ) : null}
            <button
              className="button button-blue admin-login-submit"
              type="submit"
              disabled={checkingSecret}
            >
              {checkingSecret ? "正在绑定…" : "绑定当前账户为 Owner"}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <aside className="admin-security-note">
            <strong>具名权限说明</strong>
            <p>
              引导凭证只提交一次且不会写入浏览器存储。绑定成功后，所有请求使用
              当前登录账户的服务端会话、角色权限和审计身份；日常操作不再携带共享主密钥。
            </p>
          </aside>
        </section>
      </main>
    );
  }

  const overviewData =
    overview.status === "ready" ? overview.data : null;
  const openReviewCount =
    paymentReviews.status === "ready"
      ? paymentReviews.data.total
      : overviewData?.summary.manualReviewPayments;
  const catalogData = catalog.status === "ready" ? catalog.data : null;
  const publishedRouteCount =
    catalogData?.endpoints.filter((endpoint) => endpoint.enabled).length ?? 0;
  const availableRouteCount =
    catalogData?.endpoints.filter(
      (endpoint) => endpoint.marketplaceAvailability === "available",
    ).length ?? 0;
  const unavailablePublishedRouteCount =
    catalogData?.endpoints.filter(
      (endpoint) =>
        endpoint.enabled &&
        endpoint.marketplaceAvailability !== "available",
    ).length ?? 0;
  const confirmableRouteCount =
    catalogData?.endpoints.filter(catalogEndpointConfirmable).length ?? 0;
  const reviewRouteCount =
    catalogData?.endpoints.filter(
      (endpoint) =>
        !endpoint.enabled ||
        !endpoint.reviewedAt ||
        !endpoint.presentInLatestSync ||
        !endpoint.priceVerified ||
        endpoint.safetyClassification !== "safe_data_read" ||
        endpoint.safetyPolicyVersion !== CATALOG_SAFETY_POLICY_VERSION,
    ).length ?? 0;
  const savedCredentialCount =
    upstreamCredentials.status === "ready"
      ? upstreamCredentials.data.credentials.length
      : overviewData?.upstream.managedCredentialCount ?? 0;
  const activeUserRate =
    overviewData && overviewData.summary.totalUsers > 0
      ? overviewData.summary.activeUsers / overviewData.summary.totalUsers
      : 0;
  const grossMarginRate =
    overviewData && overviewData.summary.grossRevenueUsdMicros > 0
      ? overviewData.summary.grossMarginUsdMicros /
        overviewData.summary.grossRevenueUsdMicros
      : 0;
  const failedCalls30d = overviewData
    ? Math.max(
        0,
        Math.round(
          overviewData.summary.calls30d *
            (1 - overviewData.summary.successRate),
        ),
      )
    : 0;
  const adminModules: Array<{
    id: AdminTab;
    index: string;
    label: string;
    description: string;
    badge?: number;
  }> = [
    {
      id: "overview",
      index: "01",
      label: "运营总览",
      description: "运行、收入与风险",
    },
    {
      id: "users",
      index: "02",
      label: "用户管理",
      description: "账户、余额与权限",
    },
    {
      id: "upstream",
      index: "03",
      label: "上游数据源",
      description: "连接、凭据与验证",
      badge: savedCredentialCount,
    },
    {
      id: "catalog",
      index: "04",
      label: "路由与定价",
      description: "同步、审核与发布",
      badge: publishedRouteCount,
    },
    {
      id: "payments",
      index: "05",
      label: "支付复核",
      description: "订单、异常与结案",
      badge: openReviewCount,
    },
  ];

  return (
    <main className="admin-page" id="main-content">
      <div className="admin-shell">
        <header className="admin-topbar">
          <div className="admin-topbar-brand">
            <span className="admin-topbar-mark" aria-hidden="true">
              R/
            </span>
            <div>
              <h1>运营管理后台</h1>
              <span>RelayBase Data Market Operations</span>
            </div>
          </div>
          <div className="admin-topbar-actions">
            {adminIdentity ? (
              <span
                className="admin-last-refresh"
                title={adminIdentity.email}
              >
                {adminIdentity.displayName} · {adminIdentity.role.toUpperCase()}
              </span>
            ) : null}
            {overviewData ? (
              <span className="admin-last-refresh">
                数据更新 {formatDate(overviewData.generatedAt)}
              </span>
            ) : null}
            <span
              className={`admin-readiness ${
                overviewData?.readiness.ready ? "is-ready" : ""
              }`}
            >
              <i aria-hidden="true" />
              {overviewData
                ? overviewData.readiness.ready
                  ? "生产能力就绪"
                  : "生产配置未完全就绪"
                : "正在读取状态"}
            </span>
            <a className="button button-ghost button-small" href="/console">
              返回用户控制台
            </a>
          </div>
        </header>

        <div className="admin-workspace">
          <aside className="admin-sidebar">
            <p className="admin-sidebar-label">工作区</p>
            <nav className="admin-tabs" aria-label="管理模块">
              {adminModules.map((module) => (
                <button
                  key={module.id}
                  className={activeTab === module.id ? "is-active" : ""}
                  aria-current={activeTab === module.id ? "page" : undefined}
                  onClick={() => setActiveTab(module.id)}
                >
                  <span className="admin-tab-index">{module.index}</span>
                  <span className="admin-tab-copy">
                    <strong>{module.label}</strong>
                    <small>{module.description}</small>
                  </span>
                  {module.badge ? (
                    <span className="admin-tab-badge">
                      {module.badge.toLocaleString()}
                    </span>
                  ) : null}
                </button>
              ))}
            </nav>
            <div className="admin-sidebar-status">
              <div>
                <span>公开路由</span>
                <strong>{publishedRouteCount.toLocaleString()}</strong>
              </div>
              <div>
                <span>待审核路由</span>
                <strong>{reviewRouteCount.toLocaleString()}</strong>
              </div>
              <div>
                <span>支付复核</span>
                <strong>{(openReviewCount ?? 0).toLocaleString()}</strong>
              </div>
            </div>
          </aside>

          <div className="admin-content">
            {notice ? (
              <div className="admin-notice" role="status">
                <span aria-hidden="true">i</span>
                <p>{notice}</p>
                <button onClick={() => setNotice("")} aria-label="关闭提示">
                  ×
                </button>
              </div>
            ) : null}

        {activeTab === "overview" ? (
          <section className="admin-section" aria-labelledby="overview-title">
            <div className="admin-section-head">
              <div>
                <p className="section-kicker">LIVE OPERATIONS</p>
                <h2 id="overview-title">运营总览</h2>
                <p>汇总账户、调用、收入、成本、毛利和运行就绪状态。</p>
              </div>
              <button
                className="button button-ghost button-small"
                onClick={() => void loadOverview()}
              >
                刷新数据
              </button>
            </div>
            <StatePanel
              state={overview}
              label="运营总览"
              onRetry={() => void loadOverview()}
            >
              {overviewData ? (
                <>
                  {!overviewData.readiness.ready ? (
                    <div className="admin-readiness-alert">
                      <div>
                        <strong>生产能力尚未完全就绪</strong>
                        <p>
                          在缺失项补齐前，客户调用或支付能力会按安全策略保持关闭。
                        </p>
                      </div>
                      <ul>
                        {overviewData.readiness.missing.length ? (
                          overviewData.readiness.missing.map((item) => (
                            <li key={item}>
                              {readinessMissingLabel(item)}
                            </li>
                          ))
                        ) : (
                          <li>服务端未提供具体缺失项</li>
                        )}
                      </ul>
                    </div>
                  ) : null}
                  <div className="admin-upstream-strip">
                    <div>
                      <span
                        className={
                          overviewData.upstream.configured
                            ? "is-configured"
                            : ""
                        }
                        aria-hidden="true"
                      />
                      <div>
                        <strong>上游连接</strong>
                        <p>
                          {overviewData.upstream.sourceConfigured
                            ? `运行时数据源 v${overviewData.upstream.sourceVersion ?? 0} · ${
                                overviewData.upstream.sourceEnabled
                                  ? "已启用"
                                  : "已停用"
                              }`
                            : "运行时数据源尚未配置"}
                        </p>
                      </div>
                    </div>
                    <dl>
                      <div>
                        <dt>配置状态</dt>
                        <dd>
                          {overviewData.upstream.configured
                            ? "已配置"
                            : "未配置"}
                        </dd>
                      </div>
                      <div>
                        <dt>活动来源</dt>
                        <dd>
                          {overviewData.upstream.source === "managed"
                            ? "后台托管"
                            : overviewData.upstream.source === "environment"
                              ? "环境变量"
                              : "无活动密钥"}
                        </dd>
                      </div>
                      <div>
                        <dt>密钥指纹</dt>
                        <dd>
                          {overviewData.upstream.keyFingerprint ?? "不可用"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="admin-metrics">
                    <article>
                      <span>用户总数</span>
                      <strong>
                        {overviewData.summary.totalUsers.toLocaleString()}
                      </strong>
                      <small>全部已创建账户</small>
                    </article>
                    <article>
                      <span>活跃用户</span>
                      <strong>
                        {overviewData.summary.activeUsers.toLocaleString()}
                      </strong>
                      <small>活跃率 {formatRate(activeUserRate)}</small>
                    </article>
                    <article>
                      <span>近 30 日调用</span>
                      <strong>
                        {overviewData.summary.calls30d.toLocaleString()}
                      </strong>
                      <small>失败约 {failedCalls30d.toLocaleString()} 次</small>
                    </article>
                    <article>
                      <span>调用成功率</span>
                      <strong>
                        {formatRate(overviewData.summary.successRate)}
                      </strong>
                      <small>近 30 日全部请求</small>
                    </article>
                    <article>
                      <span>近 30 日确认收入</span>
                      <strong>
                        {formatUsd(
                          overviewData.summary.grossRevenueUsdMicros,
                        )}
                      </strong>
                      <small>
                        余额用量{" "}
                        {formatUsd(
                          overviewData.summary.prepaidRevenueUsdMicros,
                        )}{" "}
                        · x402{" "}
                        {formatUsd(
                          overviewData.summary.x402RevenueUsdMicros,
                        )}
                      </small>
                    </article>
                    <article>
                      <span>近 30 日上游成本</span>
                      <strong>
                        {formatUsd(
                          overviewData.summary.upstreamCostUsdMicros,
                        )}
                      </strong>
                      <small>
                        余额用量{" "}
                        {formatUsd(
                          overviewData.summary
                            .prepaidUpstreamCostUsdMicros,
                        )}{" "}
                        · x402{" "}
                        {formatUsd(
                          overviewData.summary.x402UpstreamCostUsdMicros,
                        )}
                      </small>
                    </article>
                    <article
                      className={
                        overviewData.summary.grossMarginUsdMicros < 0
                          ? "is-negative"
                          : ""
                      }
                    >
                      <span>近 30 日毛利</span>
                      <strong>
                        {formatUsd(overviewData.summary.grossMarginUsdMicros)}
                      </strong>
                      <small>毛利率 {formatRate(grossMarginRate)}</small>
                    </article>
                    <article
                      className={
                        overviewData.summary.outstandingBalanceUsdMicros < 0
                          ? "is-negative"
                          : ""
                      }
                    >
                      <span>用户余额负债</span>
                      <strong>
                        {formatUsd(
                          overviewData.summary.outstandingBalanceUsdMicros,
                        )}
                      </strong>
                      <small>
                        30 天充值现金流入{" "}
                        {formatUsd(
                          overviewData.summary.topupCashInUsdMicros,
                        )}{" "}
                        · 待复核{" "}
                        {overviewData.summary.manualReviewPayments.toLocaleString()}{" "}
                        笔 · x402 待处理{" "}
                        {overviewData.summary.x402PendingBatches.toLocaleString()}{" "}
                        批
                      </small>
                    </article>
                  </div>

                  <div className="admin-panel">
                    <div className="admin-panel-head">
                      <div>
                        <span className="admin-index">01</span>
                        <div>
                          <h3>最近调用</h3>
                          <p>展示真实请求、客户扣费与上游成本快照。</p>
                        </div>
                      </div>
                    </div>
                    {overviewData.recentCalls.length ? (
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead>
                            <tr>
                              <th>用户 / 时间</th>
                              <th>路由</th>
                              <th>状态</th>
                              <th>客户价</th>
                              <th>上游成本</th>
                            </tr>
                          </thead>
                          <tbody>
                            {overviewData.recentCalls.map((call) => (
                              <tr key={call.id}>
                                <td>
                                  <strong>{call.userEmail}</strong>
                                  <small>{formatDate(call.createdAt)}</small>
                                </td>
                                <td>
                                  <span className="admin-platform">
                                    {call.platform}
                                  </span>
                                  <code>{call.path}</code>
                                </td>
                                <td>
                                  <span
                                    className={`admin-http-status ${
                                      call.statusCode >= 200 &&
                                      call.statusCode < 300
                                        ? "is-success"
                                        : "is-error"
                                    }`}
                                  >
                                    HTTP {call.statusCode}
                                  </span>
                                  {call.refunded ? (
                                    <small>已退款</small>
                                  ) : null}
                                </td>
                                <td>
                                  {call.refunded
                                    ? "$0.00"
                                    : formatUsd(
                                        call.customerCostUsdMicros,
                                        6,
                                      )}
                                </td>
                                <td>
                                  {formatUsd(
                                    call.upstreamCostUsdMicros,
                                    6,
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="admin-empty">
                        <strong>暂无调用记录</strong>
                        <p>真实用户完成调用后，请求会出现在这里。</p>
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </StatePanel>
          </section>
        ) : null}

        {activeTab === "users" ? (
          <section className="admin-section" aria-labelledby="users-title">
            <div className="admin-section-head">
              <div>
                <p className="section-kicker">CUSTOMER OPERATIONS</p>
                <h2 id="users-title">用户管理</h2>
                <p>查询用户身份、余额、调用消费、Key、会话和账户权限。</p>
              </div>
              <button
                className="button button-ghost button-small"
                onClick={() =>
                  void Promise.all([loadUsers(), loadAdminMembers()])
                }
              >
                刷新身份
              </button>
            </div>
            <div className="admin-panel admin-members-panel">
              <div className="admin-panel-head">
                <div>
                  <span className="admin-index">00</span>
                  <div>
                    <h3>运营后台成员</h3>
                    <p>
                      使用具名账户和最小权限角色；紧急主密钥只用于首次引导或灾难恢复。
                    </p>
                  </div>
                </div>
                {adminIdentity ? (
                  <span className="admin-account-status is-active">
                    当前角色：{adminIdentity.role.toUpperCase()}
                  </span>
                ) : null}
              </div>
              {adminIdentity?.role === "owner" ? (
                <form
                  className="admin-member-create"
                  onSubmit={createAdminMember}
                >
                  <label>
                    <span>已登录用户邮箱</span>
                    <input
                      type="email"
                      required
                      value={newAdminEmail}
                      placeholder="operator@example.com"
                      onChange={(event) =>
                        setNewAdminEmail(event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>角色</span>
                    <select
                      value={newAdminRole}
                      onChange={(event) =>
                        setNewAdminRole(event.target.value as AdminRole)
                      }
                    >
                      <option value="auditor">Auditor · 只读审计</option>
                      <option value="operator">
                        Operator · 目录运营
                      </option>
                      <option value="owner">Owner · 全部权限</option>
                    </select>
                  </label>
                  <button
                    className="button button-blue button-small"
                    type="submit"
                    disabled={savingAdminMember}
                  >
                    {savingAdminMember ? "正在授权…" : "授予权限"}
                  </button>
                </form>
              ) : (
                <p className="admin-member-boundary">
                  只有 Owner 可以授予、变更或停用管理员；当前角色仅展示权限边界内的数据和操作。
                </p>
              )}
              <StatePanel
                state={adminMembers}
                label="管理员成员"
                onRetry={() => void loadAdminMembers()}
              >
                {adminMembers.status === "ready" ? (
                  adminMembers.data.members.length ? (
                    <div className="admin-table-wrap admin-saas-table-wrap">
                      <table className="admin-table admin-saas-table">
                        <thead>
                          <tr>
                            <th>成员</th>
                            <th>角色</th>
                            <th>状态</th>
                            <th>最近变更</th>
                            <th>权限操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminMembers.data.members.map((member) => (
                            <tr key={member.userId}>
                              <td>
                                <strong>{member.displayName}</strong>
                                <small>{member.email}</small>
                              </td>
                              <td>
                                {adminIdentity?.role === "owner" ? (
                                  <select
                                    aria-label={`调整 ${member.email} 的角色`}
                                    value={member.role}
                                    disabled={savingAdminMember}
                                    onChange={(event) =>
                                      void updateAdminMember(member, {
                                        role: event.target
                                          .value as AdminRole,
                                        status: member.status,
                                      })
                                    }
                                  >
                                    <option value="owner">Owner</option>
                                    <option value="operator">
                                      Operator
                                    </option>
                                    <option value="auditor">
                                      Auditor
                                    </option>
                                  </select>
                                ) : (
                                  <strong>{member.role.toUpperCase()}</strong>
                                )}
                              </td>
                              <td>
                                <span
                                  className={`admin-account-status is-${member.status}`}
                                >
                                  {member.status === "active"
                                    ? "有效"
                                    : "已停用"}
                                </span>
                              </td>
                              <td>
                                <span>{formatDate(member.updatedAt)}</span>
                                <small title={member.grantedBy}>
                                  授权来源 {member.grantedBy}
                                </small>
                              </td>
                              <td>
                                {adminIdentity?.role === "owner" ? (
                                  <button
                                    className={`button button-small ${
                                      member.status === "active"
                                        ? "admin-button-danger-ghost"
                                        : "button-blue"
                                    }`}
                                    type="button"
                                    disabled={savingAdminMember}
                                    onClick={() =>
                                      void updateAdminMember(member, {
                                        role: member.role,
                                        status:
                                          member.status === "active"
                                            ? "suspended"
                                            : "active",
                                      })
                                    }
                                  >
                                    {member.status === "active"
                                      ? "停用"
                                      : "恢复"}
                                  </button>
                                ) : (
                                  <small>只读</small>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="admin-empty">
                      <strong>尚未建立具名管理员</strong>
                      <p>请使用紧急主密钥完成首位 Owner 引导。</p>
                    </div>
                  )
                ) : null}
              </StatePanel>
            </div>
            <StatePanel
              state={users}
              label="用户列表"
              onRetry={() => void loadUsers()}
            >
              {users.status === "ready" ? (
                <>
                  <div className="admin-toolbar">
                    <label>
                      <span>搜索用户</span>
                      <input
                        type="search"
                        value={userQuery}
                        onChange={(event) => setUserQuery(event.target.value)}
                        placeholder="邮箱、昵称或用户 ID"
                      />
                    </label>
                    <label>
                      <span>账户状态</span>
                      <select
                        value={userStatus}
                        onChange={(event) => setUserStatus(event.target.value)}
                      >
                        <option value="all">全部状态</option>
                        <option value="active">正常</option>
                        <option value="suspended">已暂停</option>
                      </select>
                    </label>
                    <p>
                      显示 <strong>{visibleUsers.length}</strong> /{" "}
                      {users.data.count} 位用户
                    </p>
                  </div>
                  {visibleUsers.length ? (
                    <div className="admin-table-wrap admin-saas-table-wrap">
                      <table className="admin-table admin-saas-table">
                        <thead>
                          <tr>
                            <th>用户</th>
                            <th>状态 / 登录</th>
                            <th>余额</th>
                            <th>30 日调用</th>
                            <th>30 日消费</th>
                            <th>Key / 会话</th>
                            <th>最后调用</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleUsers.map((user) => (
                            <tr key={user.id}>
                              <td>
                                <strong>{user.displayName || "未设置昵称"}</strong>
                                <small>{user.email}</small>
                                <code title={user.id}>{user.id}</code>
                              </td>
                              <td>
                                <span
                                  className={`admin-account-status is-${user.status}`}
                                >
                                  {user.status === "active"
                                    ? "正常"
                                    : "已暂停"}
                                </span>
                                <small>
                                  {user.providers.length
                                    ? user.providers
                                        .map(authProviderLabel)
                                        .join(" / ")
                                    : "无登录方式"}
                                </small>
                              </td>
                              <td>
                                <strong
                                  className={
                                    user.balanceUsdMicros < 0
                                      ? "is-negative-balance"
                                      : undefined
                                  }
                                >
                                  {formatUsd(user.balanceUsdMicros)}
                                </strong>
                                {user.balanceUsdMicros < 0 ? (
                                  <small>欠款账户</small>
                                ) : null}
                              </td>
                              <td>
                                <strong>{user.calls30d.toLocaleString()}</strong>
                              </td>
                              <td>
                                <strong>
                                  {formatUsd(user.spend30dUsdMicros)}
                                </strong>
                              </td>
                              <td>
                                <strong>
                                  {user.activeKeyCount} /{" "}
                                  {user.activeSessionCount}
                                </strong>
                              </td>
                              <td>
                                <span>{formatDate(user.lastCallAt)}</span>
                                <small>
                                  注册 {formatDate(user.createdAt)}
                                </small>
                              </td>
                              <td>
                                <button
                                  className={`button button-small ${
                                    user.status === "active"
                                      ? "admin-button-danger-ghost"
                                      : "button-blue"
                                  }`}
                                  onClick={() =>
                                    setConfirmAction({
                                      kind: "user",
                                      user,
                                      nextStatus:
                                        user.status === "active"
                                          ? "suspended"
                                          : "active",
                                    })
                                  }
                                >
                                  {user.status === "active"
                                    ? "暂停调用"
                                    : "恢复账户"}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="admin-empty">
                      <strong>没有符合条件的用户</strong>
                      <p>调整搜索词或账户状态筛选后重试。</p>
                    </div>
                  )}
                </>
              ) : null}
            </StatePanel>
          </section>
        ) : null}

        {activeTab === "upstream" ? (
          <section
            className="admin-section"
            aria-labelledby="upstream-title"
          >
            <div className="admin-section-head">
              <div>
                <p className="section-kicker">UPSTREAM / DATA SOURCE</p>
                <h2 id="upstream-title">上游数据源</h2>
                <p>
                  维护数据市场的真实供给连接。配置、凭据、在线验证和目录同步按顺序推进，
                  任一步未就绪都不会暴露给客户调用。
                </p>
              </div>
              <button
                className="button button-ghost button-small"
                onClick={() => {
                  void Promise.all([
                    loadUpstreamConfig(),
                    loadUpstreamCredentials(),
                  ]);
                }}
              >
                刷新状态
              </button>
            </div>
            <div className="admin-module-summary" aria-label="上游数据源摘要">
              <article>
                <span>连接配置</span>
                <strong>
                  {upstreamConfig.status === "ready" &&
                  upstreamConfig.data.configured
                    ? upstreamConfig.data.config?.enabled
                      ? "运行中"
                      : "已停用"
                    : "待配置"}
                </strong>
                <small>
                  {upstreamConfig.status === "ready" &&
                  upstreamConfig.data.config
                    ? `配置版本 v${upstreamConfig.data.config.version}`
                    : "尚无可用路由契约"}
                </small>
              </article>
              <article>
                <span>当前活动来源</span>
                <strong>
                  {upstreamCredentials.status === "ready"
                    ? upstreamCredentials.data.activeSource === "managed"
                      ? "托管凭据"
                      : upstreamCredentials.data.activeSource === "environment"
                        ? "环境变量"
                        : "未配置"
                    : "读取中"}
                </strong>
                <small>
                  {upstreamCredentials.status === "ready"
                    ? upstreamCredentials.data.activeFingerprint ?? "无活动指纹"
                    : "等待凭据状态"}
                </small>
              </article>
              <article>
                <span>已保存凭据</span>
                <strong>{savedCredentialCount.toLocaleString()}</strong>
                <small>活动、备用与已撤销凭据总数</small>
              </article>
              <article>
                <span>下一步</span>
                <strong>
                  {upstreamConfig.status === "ready" &&
                  !upstreamConfig.data.configured
                    ? "建立连接"
                    : upstreamCredentials.status === "ready" &&
                        !upstreamCredentials.data.activeCredentialId
                      ? "添加并验证"
                      : "同步路由"}
                </strong>
                <small>完成后进入“路由与定价”审核发布</small>
              </article>
            </div>
            <nav className="admin-subtabs" aria-label="上游数据源视图">
              {(
                [
                  ["current", "当前数据源", "查看运行状态与凭据清单"],
                  ["add", "添加数据源", "保存并验证新的上游凭据"],
                  ["contract", "连接规范", "维护 Origin 与目录路径"],
                ] as const
              ).map(([id, label, description]) => (
                <button
                  type="button"
                  key={id}
                  className={upstreamView === id ? "is-active" : ""}
                  aria-current={upstreamView === id ? "page" : undefined}
                  onClick={() => setUpstreamView(id)}
                >
                  <strong>{label}</strong>
                  <small>{description}</small>
                </button>
              ))}
            </nav>
            {upstreamView === "contract" ? (
              <StatePanel
                state={upstreamConfig}
                label="数据源配置"
                onRetry={() => void loadUpstreamConfig()}
              >
              {upstreamConfig.status === "ready" ? (
                <form
                  className="admin-upstream-config-card"
                  onSubmit={submitUpstreamConfig}
                >
                  <div className="admin-upstream-config-head">
                    <div>
                      <p className="section-kicker">
                        SOURCE ROUTING CONTRACT
                      </p>
                      <h3>数据源路由配置</h3>
                      <p>
                        统一维护数据源 Origin、调用前缀、目录路径和认证约束。
                        页面不会预置或公开任何实际服务品牌。
                      </p>
                    </div>
                    <div className="admin-upstream-config-status">
                      <span
                        className={
                          upstreamConfig.data.config?.enabled
                            ? "is-enabled"
                            : ""
                        }
                      >
                        {upstreamConfig.data.configured
                          ? upstreamConfig.data.config?.enabled
                            ? "运行中"
                            : "已停用"
                          : "尚未保存"}
                      </span>
                      <strong>
                        {upstreamConfig.data.config
                          ? `v${upstreamConfig.data.config.version}`
                          : "v0"}
                      </strong>
                      <small>
                        {upstreamConfig.data.config
                          ? `更新于 ${formatDate(
                              upstreamConfig.data.config.updatedAt,
                            )}`
                          : "首次保存将创建版本 1"}
                      </small>
                    </div>
                  </div>

                  {!upstreamConfig.data.originAllowlistConfigured ? (
                    <div className="admin-readiness-alert">
                      <div>
                        <strong>部署环境尚未设置 Origin 允许列表</strong>
                        <p>
                          先配置 UPSTREAM_ALLOWED_ORIGINS。只有允许列表中的
                          公开 HTTPS Origin 才能保存，避免将代理指向内部网络。
                        </p>
                      </div>
                    </div>
                  ) : null}

                  <label className="admin-upstream-config-toggle">
                    <input
                      type="checkbox"
                      checked={upstreamConfigDraft.enabled}
                      onChange={(event) =>
                        setUpstreamConfigDraft((draft) => ({
                          ...draft,
                          enabled: event.target.checked,
                        }))
                      }
                    />
                    <span>
                      <strong>启用这组数据源路由</strong>
                      <small>
                        停用后保留配置，但不会代理客户请求或同步目录。
                      </small>
                    </span>
                  </label>

                  <div className="admin-upstream-config-grid">
                    <label className="is-wide">
                      <span>数据源 Origin</span>
                      <input
                        type="url"
                        required
                        spellCheck={false}
                        autoComplete="off"
                        maxLength={2_000}
                        value={upstreamConfigDraft.sourceOrigin}
                        placeholder="https://api.example.com"
                        onChange={(event) =>
                          setUpstreamConfigDraft((draft) => ({
                            ...draft,
                            sourceOrigin: event.target.value,
                          }))
                        }
                      />
                      <small>
                        仅填写 Origin，不要包含路径、端口、查询参数或凭据。
                      </small>
                    </label>
                    <label>
                      <span>API 路径前缀</span>
                      <input
                        spellCheck={false}
                        maxLength={600}
                        value={upstreamConfigDraft.apiPathPrefix}
                        placeholder="/api/v1（可留空）"
                        onChange={(event) =>
                          setUpstreamConfigDraft((draft) => ({
                            ...draft,
                            apiPathPrefix: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>OpenAPI 文档路径</span>
                      <input
                        required
                        spellCheck={false}
                        maxLength={600}
                        value={upstreamConfigDraft.openApiPath}
                        placeholder="/openapi.json"
                        onChange={(event) =>
                          setUpstreamConfigDraft((draft) => ({
                            ...draft,
                            openApiPath: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>价格目录路径</span>
                      <input
                        required
                        spellCheck={false}
                        maxLength={600}
                        value={upstreamConfigDraft.catalogPath}
                        placeholder="/catalog"
                        onChange={(event) =>
                          setUpstreamConfigDraft((draft) => ({
                            ...draft,
                            catalogPath: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>凭据验证路径</span>
                      <input
                        required
                        spellCheck={false}
                        maxLength={600}
                        value={upstreamConfigDraft.credentialPath}
                        placeholder="/credential/verify"
                        onChange={(event) =>
                          setUpstreamConfigDraft((draft) => ({
                            ...draft,
                            credentialPath: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>目录认证模式</span>
                      <select
                        value={upstreamConfigDraft.catalogAuthMode}
                        onChange={(event) =>
                          setUpstreamConfigDraft((draft) => ({
                            ...draft,
                            catalogAuthMode: event.target
                              .value as CatalogAuthMode,
                          }))
                        }
                      >
                        <option value="required">必须使用活动凭据</option>
                        <option value="optional">有凭据时使用</option>
                        <option value="none">无需凭据</option>
                      </select>
                    </label>
                    <label className="is-wide">
                      <span>公开目录排除前缀</span>
                      <textarea
                        rows={4}
                        maxLength={60_100}
                        spellCheck={false}
                        value={
                          upstreamConfigDraft.publicExcludedPrefixesText
                        }
                        placeholder={"/v1/internal/\n/v1/control/"}
                        onChange={(event) =>
                          setUpstreamConfigDraft((draft) => ({
                            ...draft,
                            publicExcludedPrefixesText:
                              event.target.value,
                          }))
                        }
                      />
                      <small>
                        每行一个 /v1/ 前缀，最多 100 条；命中的路由不会进入公开目录。
                      </small>
                    </label>
                  </div>

                  <div className="admin-upstream-config-impact">
                    <strong>保存影响</strong>
                    <p>
                      保存会使当前目录同步证明和凭据验证结果失效，并下架现有服务。
                      保存后必须重新验证活动凭据、同步目录并完成定价审核。
                    </p>
                  </div>
                  <div className="admin-upstream-config-actions">
                    <button
                      className="button button-ghost"
                      type="button"
                      disabled={savingUpstreamConfig}
                      onClick={() =>
                        setUpstreamConfigDraft(
                          upstreamConfigDraftFrom(
                            upstreamConfig.data.config,
                          ),
                        )
                      }
                    >
                      恢复已保存值
                    </button>
                    <button
                      className="button button-blue"
                      type="submit"
                      disabled={
                        savingUpstreamConfig ||
                        !upstreamConfig.data.originAllowlistConfigured
                      }
                    >
                      {savingUpstreamConfig
                        ? "正在保存配置…"
                        : `保存为 v${
                            (upstreamConfig.data.config?.version ?? 0) +
                            1
                          }`}
                    </button>
                  </div>
                </form>
              ) : null}
              </StatePanel>
            ) : null}
            {upstreamView !== "contract" ? (
              <StatePanel
                state={upstreamCredentials}
                label="上游凭据"
                onRetry={() => void loadUpstreamCredentials()}
              >
              {upstreamCredentials.status === "ready" ? (
                <>
                  {!upstreamCredentials.data.encryptionConfigured ? (
                    <div className="admin-readiness-alert">
                      <div>
                        <strong>凭据加密主密钥缺失或格式无效</strong>
                        <p>
                          先在 Sites 环境中设置 32 字节、无 padding、
                          43 字符 base64url 格式的
                          UPSTREAM_CREDENTIALS_ENCRYPTION_KEY，再保存
                          上游 API Key。
                        </p>
                      </div>
                    </div>
                  ) : null}
                  {upstreamCredentials.data.managedEnabled &&
                  !upstreamCredentials.data.activeCredentialId ? (
                    <div className="admin-readiness-alert">
                      <div>
                        <strong>托管模式没有活动数据源</strong>
                        <p>
                          上游代理和目录同步会安全关闭。请选择一个备用 Key
                          并完成在线验证后启用。
                        </p>
                      </div>
                    </div>
                  ) : null}
                  {upstreamCredentials.data.managedEnabled &&
                  upstreamCredentials.data.environmentFallbackConfigured ? (
                    <div className="admin-readiness-alert">
                      <div>
                        <strong>旧环境变量 Key 已被安全忽略</strong>
                        <p>
                          托管模式启用后不会回退 UPSTREAM_API_KEY；
                          请在此处切换活动凭据，避免意外使用旧 Key。
                        </p>
                      </div>
                    </div>
                  ) : null}
                  {upstreamView === "current" ? (
                    <div className="admin-view-intro">
                      <div>
                        <p className="section-kicker">CURRENT SOURCES</p>
                        <h3>当前数据源清单</h3>
                        <p>
                          “活动”凭据负责目录同步证明；所有已验证且开启路由的健康 Key
                          都可承接真实请求。相同 TikHub 账号共享容量组，只有独立账号容量才可叠加。
                        </p>
                      </div>
                      <button
                        className="button button-blue button-small"
                        type="button"
                        onClick={() => setUpstreamView("add")}
                      >
                        添加数据源
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="admin-view-intro">
                        <div>
                          <p className="section-kicker">ADD DATA SOURCE</p>
                          <h3>添加并验证数据源</h3>
                          <p>
                            新凭据必须通过在线验证后才能成为活动来源；目录同步和路由发布仍需在下一步单独完成。
                          </p>
                        </div>
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          onClick={() => setUpstreamView("current")}
                        >
                          返回当前清单
                        </button>
                      </div>
                      <ol className="admin-flow-steps">
                        <li className="is-current">
                          <span>01</span>
                          <div>
                            <strong>确认连接规范</strong>
                            <small>Origin、API 前缀与目录路径已保存</small>
                          </div>
                        </li>
                        <li className="is-current">
                          <span>02</span>
                          <div>
                            <strong>添加并验证凭据</strong>
                            <small>加密保存，校验授权范围与可用性</small>
                          </div>
                        </li>
                        <li>
                          <span>03</span>
                          <div>
                            <strong>同步并发布路由</strong>
                            <small>进入路由与定价，完成成本和安全审核</small>
                          </div>
                        </li>
                      </ol>
                      {upstreamConfig.status === "ready" &&
                      !upstreamConfig.data.configured ? (
                        <div className="admin-source-truth is-warning">
                          <div>
                            <strong>请先建立上游连接规范</strong>
                            <p>
                              尚未保存 Origin 与目录路径；凭据可以加密保存，但无法形成可验证的数据供给。
                            </p>
                          </div>
                          <button
                            className="button button-dark button-small"
                            type="button"
                            onClick={() => setUpstreamView("contract")}
                          >
                            配置连接规范
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                  {upstreamView === "current" ? (
                    <>
                    <div className="admin-upstream-source-grid">
                    <article>
                      <span>当前来源</span>
                      <strong>
                        {upstreamCredentials.data.activeSource === "managed"
                          ? "后台托管 Key"
                          : upstreamCredentials.data.activeSource ===
                              "environment"
                            ? "环境变量回退"
                            : "未配置"}
                      </strong>
                      <small>
                        指纹{" "}
                        {upstreamCredentials.data.activeFingerprint ??
                          "不可用"}
                      </small>
                    </article>
                    <article>
                      <span>托管状态版本</span>
                      <strong>
                        v{upstreamCredentials.data.stateVersion}
                      </strong>
                      <small>
                        切换使用 CAS 防止并发管理员相互覆盖
                      </small>
                    </article>
                    <article>
                      <span>已保存凭据</span>
                      <strong>
                        {upstreamCredentials.data.credentials.length}
                      </strong>
                      <small>
                        明文不会从服务端返回
                      </small>
                    </article>
                    <article>
                      <span>独立容量组</span>
                      <strong>
                        {upstreamCredentials.data.capacityGroups.filter(
                          (group) => group.status === "active",
                        ).length}
                      </strong>
                      <small>
                        有效容量{" "}
                        {upstreamCredentials.data.capacityGroups
                          .filter((group) => group.status === "active")
                          .reduce(
                            (total, group) =>
                              total +
                              (group.routingCredentialCount > 0
                                ? group.effectiveRpsPerEndpoint
                                : 0),
                            0,
                          )}{" "}
                        账号有效 RPS
                      </small>
                    </article>
                    </div>
                    {upstreamCredentials.data.capacityGroups.length ? (
                      <div className="admin-table-wrap admin-saas-table-wrap">
                        <table className="admin-table admin-saas-table">
                          <thead>
                            <tr>
                              <th>账号容量组</th>
                              <th>稳定容量</th>
                              <th>凭据冗余</th>
                              <th>最近 15 分钟</th>
                              <th>异常信号</th>
                              <th>x402 准入占用</th>
                            </tr>
                          </thead>
                          <tbody>
                            {upstreamCredentials.data.capacityGroups.map(
                              (group) => (
                                <tr key={group.id}>
                                  <td>
                                    <strong>{group.label}</strong>
                                    <small>{group.status}</small>
                                  </td>
                                  <td>
                                    <strong>
                                      {group.effectiveRpsPerEndpoint} RPS
                                    </strong>
                                    <small>
                                      套餐 {group.configuredRpsPerEndpoint} ·
                                      使用 {group.headroomPercent}%
                                    </small>
                                  </td>
                                  <td>
                                    <strong>
                                      {group.routingCredentialCount}/
                                      {group.credentialCount} 可路由
                                    </strong>
                                    <small>共享同一账号 RPS 与余额</small>
                                  </td>
                                  <td>
                                    <strong>
                                      {group.health15m.successes}/
                                      {group.health15m.attempts} 成功
                                    </strong>
                                    <small>
                                      平均{" "}
                                      {group.health15m.averageLatencyMs ??
                                        "—"}{" "}
                                      ms
                                    </small>
                                  </td>
                                  <td>
                                    <strong>
                                      {group.health15m.authFailures} 鉴权 ·{" "}
                                      {group.health15m.rateLimits} 限流
                                    </strong>
                                    <small>
                                      鉴权归 Key；429 归账号组
                                    </small>
                                  </td>
                                  <td>
                                    <strong>
                                      {group.leasedRequests} Hu
                                    </strong>
                                    <small>活跃批次计划上游请求</small>
                                  </td>
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    </>
                  ) : null}

                  {upstreamView === "add" ? (
                    <form
                    className="admin-upstream-form"
                    onSubmit={submitUpstreamCredential}
                  >
                    <div>
                      <p className="section-kicker">ADD CREDENTIAL</p>
                      <h3>新增上游 API Key</h3>
                      <p>
                        Key 经同源 HTTPS 提交后立即使用 AES-256-GCM
                        加密；D1 保存密文、完整哈希、已验证 scope
                        与到期时间，日志和后台列表只显示截断指纹。
                      </p>
                    </div>
                    <label>
                      <span>凭据名称</span>
                      <input
                        value={upstreamLabel}
                        minLength={2}
                        maxLength={80}
                        required
                        onChange={(event) =>
                          setUpstreamLabel(event.target.value)
                        }
                        placeholder="例如：主数据源"
                      />
                    </label>
                    <label>
                      <span>上游 API Key</span>
                      <input
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        minLength={16}
                        maxLength={512}
                        required
                        value={upstreamApiKey}
                        onChange={(event) =>
                          setUpstreamApiKey(event.target.value)
                        }
                        placeholder="只在本次提交中使用"
                      />
                    </label>
                    <label>
                      <span>容量组 / TikHub 账号</span>
                      <select
                        value={upstreamCapacityGroupId}
                        onChange={(event) =>
                          setUpstreamCapacityGroupId(event.target.value)
                        }
                      >
                        <option value="new">新建独立容量组</option>
                        {upstreamCredentials.data.capacityGroups
                          .filter((group) => group.status !== "disabled")
                          .map((group) => (
                            <option key={group.id} value={group.id}>
                              {group.label} ·{" "}
                              {group.effectiveRpsPerEndpoint} 账号有效 RPS
                            </option>
                          ))}
                      </select>
                      <small>
                        同一 TikHub 账号下的多个 Key 必须放在同一容量组，不能叠加 RPS。
                      </small>
                    </label>
                    {upstreamCapacityGroupId === "new" ? (
                      <>
                        <label>
                          <span>容量组名称</span>
                          <input
                            value={upstreamCapacityGroupLabel}
                            minLength={2}
                            maxLength={80}
                            required
                            onChange={(event) =>
                              setUpstreamCapacityGroupLabel(
                                event.target.value,
                              )
                            }
                            placeholder="例如：TikHub 主账号"
                          />
                        </label>
                        <label>
                          <span>账号套餐总上限（RPS）</span>
                          <input
                            type="number"
                            min={1}
                            max={10_000}
                            step={1}
                            required
                            value={upstreamConfiguredRps}
                            onChange={(event) =>
                              setUpstreamConfiguredRps(event.target.value)
                            }
                          />
                          <small>
                            TikHub 当前默认套餐通常为账号 10 RPS；按实际购买套餐填写。
                          </small>
                        </label>
                        <label>
                          <span>安全使用比例（%）</span>
                          <input
                            type="number"
                            min={10}
                            max={100}
                            step={1}
                            required
                            value={upstreamHeadroomPercent}
                            onChange={(event) =>
                              setUpstreamHeadroomPercent(event.target.value)
                            }
                          />
                          <small>默认只使用 80%，预留上游抖动和人工请求余量。</small>
                        </label>
                      </>
                    ) : null}
                    <label>
                      <span>路由优先级</span>
                      <input
                        type="number"
                        min={1}
                        max={10_000}
                        step={1}
                        required
                        value={upstreamPriority}
                        onChange={(event) =>
                          setUpstreamPriority(event.target.value)
                        }
                      />
                      <small>数值越小越优先；同级再按权重和健康状态选择。</small>
                    </label>
                    <label>
                      <span>同级权重</span>
                      <input
                        type="number"
                        min={1}
                        max={10_000}
                        step={1}
                        required
                        value={upstreamWeight}
                        onChange={(event) =>
                          setUpstreamWeight(event.target.value)
                        }
                      />
                    </label>
                    <label className="admin-memory-option">
                      <input
                        type="checkbox"
                        checked={activateUpstreamAfterSave}
                        onChange={(event) =>
                          setActivateUpstreamAfterSave(event.target.checked)
                        }
                      />
                      <span>
                        保存后向上游验证并设为活动数据源
                        <small>
                          关闭时仅加密保存为备用，不会用于任何客户请求
                        </small>
                      </span>
                    </label>
                    <button
                      className="button button-blue"
                      type="submit"
                      disabled={
                        savingUpstreamCredential ||
                        !upstreamCredentials.data.encryptionConfigured
                      }
                    >
                      {savingUpstreamCredential
                        ? "正在安全保存…"
                        : activateUpstreamAfterSave
                          ? "验证、保存并启用"
                          : "加密保存为备用"}
                    </button>
                    </form>
                  ) : null}

                  {upstreamView === "current" &&
                  upstreamCredentials.data.credentials.length ? (
                    <>
                    <div className="admin-source-truth">
                      <div>
                        <span className="admin-source-truth-mark" aria-hidden="true">HA</span>
                        <div>
                          <strong>多 Key 是凭据容灾，不是账号扩容</strong>
                          <p>
                            同账号 Key 在 401/403、过期或单凭据异常时自动切换；
                            账号级 429、402 余额不足及 TikHub 整体故障会暂停整个容量组。
                            后台分别记录 Key 健康与容量组/端点健康，组内 Key 始终共享同一 RPS 和余额。
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="admin-table-wrap admin-saas-table-wrap">
                      <table className="admin-table admin-saas-table">
                        <thead>
                          <tr>
                            <th>数据源凭据</th>
                            <th>容量 / 路由</th>
                            <th>运行健康</th>
                            <th>授权</th>
                            <th>最近活动</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {upstreamCredentials.data.credentials.map(
                            (credential) => (
                              <tr key={credential.id}>
                                <td>
                                  <strong>{credential.label}</strong>
                                  <code>{credential.fingerprint}</code>
                                  <small>
                                    创建于 {formatDate(credential.createdAt)}
                                  </small>
                                </td>
                                <td>
                                  <strong>
                                    {credential.capacityGroupLabel ??
                                      "未分配容量组"}
                                  </strong>
                                  <small>
                                    {credential.effectiveRpsPerEndpoint ??
                                      "—"}{" "}
                                    账号有效 RPS
                                  </small>
                                  <small>
                                    P{credential.priority} · W
                                    {credential.weight} ·{" "}
                                    {credential.routingEnabled
                                      ? "参与路由"
                                      : "不参与路由"}
                                  </small>
                                </td>
                                <td>
                                  <span
                                    className={`admin-account-status is-${
                                      credential.routingEnabled &&
                                      credential.health.state === "healthy"
                                        ? "active"
                                        : credential.status === "revoked"
                                          ? "revoked"
                                          : "standby"
                                    }`}
                                  >
                                    {credential.status === "revoked"
                                      ? "已撤销"
                                      : !credential.routingEnabled
                                        ? "未启用"
                                        : credential.health.state ===
                                            "healthy"
                                          ? "健康"
                                          : credential.health.state ===
                                              "auth_failed"
                                            ? "鉴权失败"
                                            : credential.health.state ===
                                                "balance_low"
                                              ? "余额不足"
                                              : credential.health.state ===
                                                  "circuit_open"
                                                ? "熔断"
                                                : "降级"}
                                  </span>
                                  <small>
                                    {credential.status === "active"
                                      ? "目录权威 · "
                                      : ""}
                                    {credential.health.ewmaLatencyMs == null
                                      ? "暂无延迟样本"
                                      : `${credential.health.ewmaLatencyMs} ms`}
                                  </small>
                                  <small>
                                    {credential.health.lastStatusCode == null
                                      ? "尚无状态码"
                                      : `HTTP ${credential.health.lastStatusCode}`}
                                  </small>
                                </td>
                                <td>
                                  <strong>
                                    {credential.scopeCount.toLocaleString()}
                                  </strong>
                                  <small>
                                    {credential.scopeCount
                                      ? "已验证 scope"
                                      : "尚未验证"}
                                  </small>
                                </td>
                                <td>
                                  <strong>
                                    {formatDate(credential.lastUsedAt)}
                                  </strong>
                                  <small>
                                    验证 {formatDate(credential.verifiedAt)}
                                  </small>
                                  <small>
                                    到期{" "}
                                    {credential.expiresAt
                                      ? formatDate(credential.expiresAt)
                                      : "不设到期"}
                                  </small>
                                </td>
                                <td>
                                  <div className="admin-inline-actions">
                                    {credential.status === "standby" ? (
                                      <button
                                        className="button button-blue button-small"
                                        disabled={
                                          !upstreamCredentials.data
                                            .encryptionConfigured
                                        }
                                        onClick={() =>
                                          setConfirmAction({
                                            kind: "credential",
                                            credential,
                                            action: "activate",
                                            expectedVersion:
                                              upstreamCredentials.data
                                                .stateVersion,
                                          })
                                        }
                                      >
                                        验证并切换
                                      </button>
                                    ) : null}
                                    {credential.status !== "revoked" ? (
                                      <button
                                        className="button admin-button-danger-ghost button-small"
                                        onClick={() =>
                                          setConfirmAction({
                                            kind: "credential",
                                            credential,
                                            action: "revoke",
                                            expectedVersion:
                                              upstreamCredentials.data
                                                .stateVersion,
                                          })
                                        }
                                      >
                                        撤销
                                      </button>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                    </>
                  ) : upstreamView === "current" ? (
                    <div className="admin-empty">
                      <strong>尚未保存上游凭据</strong>
                      <p>
                        配置加密主密钥后，进入“添加数据源”保存第一个上游 API Key。
                      </p>
                    </div>
                  ) : null}
                </>
              ) : null}
              </StatePanel>
            ) : null}
          </section>
        ) : null}

        {activeTab === "catalog" ? (
          <section className="admin-section" aria-labelledby="catalog-admin-title">
            <div className="admin-section-head">
              <div>
                <p className="section-kicker">UPSTREAM CATALOG CONTROL</p>
                <h2 id="catalog-admin-title">路由与定价</h2>
                <p>
                  从上游同步候选服务，补齐调用契约，再审核成本、客户价和发布状态。
                  前台展示读取发布状态，/v1 调用再叠加运行就绪与上游可用性校验。
                </p>
              </div>
              <div className="admin-section-actions">
                <button
                  className="button button-ghost button-small"
                  onClick={() => {
                    void Promise.all([
                      loadCatalog(),
                      loadPendingCatalog(),
                    ]);
                  }}
                >
                  刷新目录
                </button>
              </div>
            </div>
            <div className="admin-module-summary" aria-label="路由目录摘要">
              <article className="is-success">
                <span>当前可用</span>
                <strong>{availableRouteCount.toLocaleString()}</strong>
                <small>已通过完整运行可用性校验</small>
              </article>
              <article
                className={unavailablePublishedRouteCount ? "is-warning" : ""}
              >
                <span>已添加但不可用</span>
                <strong>
                  {unavailablePublishedRouteCount.toLocaleString()}
                </strong>
                <small>前台可见，但当前无法实际调用</small>
              </article>
              <article className={confirmableRouteCount ? "is-warning" : ""}>
                <span>待确认添加</span>
                <strong>{confirmableRouteCount.toLocaleString()}</strong>
                <small>已满足基础审核条件，等待运营确认</small>
              </article>
              <article>
                <span>当前目录代次</span>
                <strong>
                  {catalogData?.sync
                    ? catalogData.sync.generation.slice(0, 12)
                    : "未生成"}
                </strong>
                <small>
                  {catalogData?.sync
                    ? `同步于 ${formatDate(catalogData.sync.syncedAt)}`
                    : "需要先同步上游"}
                </small>
              </article>
            </div>
            <nav className="admin-subtabs" aria-label="路由与定价视图">
              {(
                [
                  ["routes", "当前路由", "查看运行目录与发布状态"],
                  ["pricing", "定价发布", "批量定价、审核与上下架"],
                  ["x402", "x402 批量", "配置 Agent 钱包批量入口"],
                  ["consistency", "一致性证明", "核对快照、覆盖率与代次"],
                ] as const
              ).map(([id, label, description]) => (
                <button
                  type="button"
                  key={id}
                  className={catalogView === id ? "is-active" : ""}
                  aria-current={catalogView === id ? "page" : undefined}
                  onClick={() => {
                    setCatalogView(id);
                    setCatalogPage(0);
                  }}
                >
                  <strong>{label}</strong>
                  <small>{description}</small>
                </button>
              ))}
            </nav>
            <div className="admin-source-truth">
              <div>
                <span className="admin-source-truth-mark" aria-hidden="true">
                  ✓
                </span>
                <div>
                  <strong>发布状态与运行可用性分开核对</strong>
                  <p>
                    “已添加到前台”只代表数据产品进入市场目录；“当前可用”
                    由后端依据路由启用、最新同步、价格、安全策略和上游运行状态实时计算。
                  </p>
                </div>
              </div>
              <dl>
                <div>
                  <dt>已添加到前台</dt>
                  <dd>{publishedRouteCount.toLocaleString()} 条</dd>
                </div>
                <div>
                  <dt>当前可调用</dt>
                  <dd>{availableRouteCount.toLocaleString()} 条</dd>
                </div>
                <div>
                  <dt>不可用 / 待确认</dt>
                  <dd>
                    {(unavailablePublishedRouteCount +
                      confirmableRouteCount).toLocaleString()}{" "}
                    条
                  </dd>
                </div>
              </dl>
            </div>
            {catalogView === "add" ? (
              <>
                <div className="admin-view-intro">
                  <div>
                    <p className="section-kicker">ADD ROUTE FLOW</p>
                    <h3>添加新的数据服务</h3>
                    <p>
                      路由不允许直接手工写入运行目录。每条新服务都必须经过上游同步、
                      调用契约补齐、定价与安全审核后才能进入待确认清单。
                    </p>
                  </div>
                  <div className="admin-section-actions">
                    <button
                      className="button button-ghost button-small"
                      type="button"
                      onClick={() => setCatalogView("routes")}
                    >
                      返回当前路由
                    </button>
                    <button
                      className="button button-dark button-small"
                      type="button"
                      onClick={() => setConfirmAction({ kind: "sync" })}
                    >
                      立即同步上游
                    </button>
                  </div>
                </div>
                <ol className="admin-flow-steps">
                  <li className="is-current">
                    <span>01</span>
                    <div>
                      <strong>同步上游目录</strong>
                      <small>读取 OpenAPI、价格目录和凭据授权范围</small>
                    </div>
                  </li>
                  <li>
                    <span>02</span>
                    <div>
                      <strong>补齐调用契约</strong>
                      <small>HTTP 方法、参数结构与数据分类必须完整</small>
                    </div>
                  </li>
                  <li>
                    <span>03</span>
                    <div>
                      <strong>审核价格并发布</strong>
                      <small>成本、安全策略和客户价通过后才进入市场</small>
                    </div>
                  </li>
                </ol>
              </>
            ) : null}
            {catalogView === "add" ? (
              <section
                className="admin-pending-catalog"
                aria-labelledby="pending-catalog-title"
              >
              <div className="admin-pending-catalog-head">
                <div>
                  <p className="section-kicker">
                    DOCUMENTATION HOLDING AREA
                  </p>
                  <h3 id="pending-catalog-title">
                    文档待同步服务
                  </h3>
                  <p>
                    这里收录价格目录已发现、但尚未匹配到完整文档与 HTTP
                    方法的服务。它们与可调用目录严格隔离。
                  </p>
                </div>
                {pendingCatalog.status === "ready" ? (
                  <strong>
                    {pendingCatalog.data.total.toLocaleString()} PENDING
                  </strong>
                ) : null}
              </div>
              <StatePanel
                state={pendingCatalog}
                label="文档待同步服务"
                onRetry={() => void loadPendingCatalog()}
              >
                {pendingCatalog.status === "ready" ? (
                  <>
                    <div
                      className="admin-pending-catalog-warning"
                      role="note"
                    >
                      <strong>不可调用 · 不可上架</strong>
                      <p>
                        只有补齐接口文档、HTTP 方法和必要参数，并在下次同步中进入正式目录后，
                        才能继续安全审核。此处仅允许预设客户价。
                      </p>
                    </div>
                    <div className="admin-pending-catalog-toolbar">
                      <label>
                        <span>搜索待同步服务</span>
                        <input
                          type="search"
                          maxLength={160}
                          value={pendingCatalogQuery}
                          placeholder="路径、平台、数据类型、入口或摘要"
                          onChange={(event) => {
                            setPendingCatalogQuery(event.target.value);
                            setPendingCatalogPage(0);
                          }}
                        />
                      </label>
                      <p>
                        已完整加载{" "}
                        <strong>
                          {pendingCatalog.data.count.toLocaleString()}
                        </strong>{" "}
                        条；当前筛选{" "}
                        <strong>
                          {filteredPendingEndpoints.length.toLocaleString()}
                        </strong>{" "}
                        条
                      </p>
                    </div>

                    {visiblePendingEndpoints.length ? (
                      <div className="admin-pending-catalog-table-wrap">
                        <table className="admin-pending-catalog-table">
                          <thead>
                            <tr>
                              <th>待同步服务</th>
                              <th>平台 / 分类</th>
                              <th>能力状态</th>
                              <th>成本</th>
                              <th>客户价</th>
                              <th>状态</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visiblePendingEndpoints.map((endpoint) => {
                              const draft =
                                pendingPriceDrafts[endpoint.path] ?? "";
                              const parsedDraft =
                                parsePendingUsdInput(draft);
                              const priceChanged =
                                parsedDraft !== null &&
                                parsedDraft !==
                                  endpoint.customerPriceUsdMicros;
                              const invalidPrice =
                                parsedDraft === null ||
                                parsedDraft <
                                  endpoint.upstreamPriceUsdMicros;
                              return (
                                <tr key={endpoint.path}>
                                  <td>
                                    <code title={endpoint.path}>
                                      {endpoint.path}
                                    </code>
                                    <small>{endpoint.summary}</small>
                                    <details className="admin-pending-row-details">
                                      <summary>技术信息</summary>
                                      <span>
                                        调用入口：
                                        {catalogSurfaceLabel(endpoint.surface)}
                                      </span>
                                      <span>
                                        速率：
                                        {endpoint.rateLimitRps === null
                                          ? "未提供"
                                          : `${endpoint.rateLimitRps.toLocaleString(
                                              "en-US",
                                              {
                                                maximumFractionDigits: 3,
                                              },
                                            )} RPS`}
                                      </span>
                                      <span>
                                        {endpoint.rateLimit ??
                                          "无原始速率说明"}
                                      </span>
                                    </details>
                                  </td>
                                  <td>
                                    <strong>{endpoint.platform}</strong>
                                    <small>
                                      {catalogDataTypeLabel(
                                        endpoint.dataType,
                                      )}{" · "}
                                      {catalogSurfaceLabel(endpoint.surface)}
                                    </small>
                                  </td>
                                  <td>
                                    <strong>
                                      {endpoint.capability.executionMode}
                                    </strong>
                                    <small>
                                      {endpoint.capability.evidence.status}
                                    </small>
                                    <small>方法与承载量待官方确认</small>
                                  </td>
                                  <td>
                                    <strong>
                                      {formatUsd(
                                        endpoint.upstreamPriceUsdMicros,
                                        6,
                                      )}
                                    </strong>
                                    <small>
                                      {endpoint.priceVerified
                                        ? "成本已核验"
                                        : "成本待核验"}
                                    </small>
                                  </td>
                                  <td>
                                    <div className="admin-pending-price-control">
                                      <span aria-hidden="true">$</span>
                                      <input
                                        aria-label={`${endpoint.path} 客户价（USD / 次）`}
                                        aria-invalid={invalidPrice}
                                        inputMode="decimal"
                                        maxLength={11}
                                        value={draft}
                                        onChange={(event) =>
                                          setPendingPriceDrafts(
                                            (current) => ({
                                              ...current,
                                              [endpoint.path]:
                                                event.target.value,
                                            }),
                                          )
                                        }
                                      />
                                      <button
                                        className="button button-blue button-small"
                                        type="button"
                                        disabled={
                                          savingPendingPath ===
                                            endpoint.path ||
                                          invalidPrice ||
                                          !priceChanged
                                        }
                                        onClick={() =>
                                          void savePendingEndpointPrice(
                                            endpoint,
                                          )
                                        }
                                      >
                                        {savingPendingPath === endpoint.path
                                          ? "保存中"
                                          : "保存"}
                                      </button>
                                    </div>
                                    {invalidPrice ? (
                                      <small className="is-error">
                                        不得低于成本，最多 6 位小数
                                      </small>
                                    ) : null}
                                  </td>
                                  <td>
                                    <span className="admin-pending-status">
                                      不可调用
                                    </span>
                                    <small>文档与方法待补齐</small>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="admin-empty">
                        <strong>
                          {pendingCatalog.data.count
                            ? "没有符合搜索条件的待同步服务"
                            : "当前没有文档待同步服务"}
                        </strong>
                        <p>
                          {pendingCatalog.data.count
                            ? "调整搜索词后重试。"
                            : "下次目录同步发现缺少文档或方法的服务时，会安全隔离到这里。"}
                        </p>
                      </div>
                    )}

                    {filteredPendingEndpoints.length ? (
                      <div className="admin-pending-catalog-pagination">
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          disabled={safePendingCatalogPage === 0}
                          onClick={() =>
                            setPendingCatalogPage((page) =>
                              Math.max(0, page - 1),
                            )
                          }
                        >
                          上一页
                        </button>
                        <span>
                          第 {safePendingCatalogPage + 1} /{" "}
                          {pendingCatalogPageCount} 页 · 每页最多{" "}
                          {PENDING_CATALOG_PAGE_SIZE} 条
                        </span>
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          disabled={
                            safePendingCatalogPage >=
                            pendingCatalogPageCount - 1
                          }
                          onClick={() =>
                            setPendingCatalogPage((page) =>
                              Math.min(
                                pendingCatalogPageCount - 1,
                                page + 1,
                              ),
                            )
                          }
                        >
                          下一页
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </StatePanel>
              </section>
            ) : null}
            {catalogView !== "add" ? (
              <StatePanel
                state={catalog}
                label="接口目录"
                onRetry={() => void loadCatalog()}
              >
              {catalog.status === "ready" ? (
                <>
                  {catalogView === "x402" ? (
                    <section className="admin-catalog-batch">
                      <div className="admin-catalog-batch-head">
                        <div>
                          <p className="section-kicker">
                            AGENT WALLET / BATCH SETTLEMENT
                          </p>
                          <h3>x402 批量入口配置</h3>
                          <p>
                            这里只配置每个已发布数据产品的 x402
                            单目标价格和每批上限。API Key 仍只用于标准
                            /v1 余额调用；x402 由调用方钱包付款，两类账本不会混用。
                          </p>
                        </div>
                        <span>
                          {x402Admin.status === "ready"
                            ? x402Admin.data.runtime.mode === "live"
                              ? "结算运行时已就绪"
                              : `运行时：${x402Admin.data.runtime.mode}`
                            : "正在读取结算运行时"}
                        </span>
                      </div>
                      {x402Admin.status === "ready" ? (
                        <section className="admin-x402-runtime-config">
                          <div className="admin-x402-runtime-config-head">
                            <div>
                              <p className="section-kicker">
                                SETTLEMENT RUNTIME / SECRET STORAGE
                              </p>
                              <h4>收款与 facilitator 配置</h4>
                              <p>
                                收款地址公开参与报价；facilitator
                                凭据使用服务端主密钥加密后存入 D1，页面与接口永不回显原文。
                              </p>
                            </div>
                            <div className="admin-x402-runtime-badges">
                              <span>
                                {x402Admin.data.configuration.source ===
                                "managed"
                                  ? "后台托管"
                                  : "环境变量"}
                              </span>
                              <span>
                                revision{" "}
                                {x402Admin.data.configuration.revision}
                              </span>
                            </div>
                          </div>
                          <div className="admin-x402-runtime-switches">
                            <label>
                              <input
                                type="checkbox"
                                checked={
                                  x402RuntimeDraft.managedEnabled
                                }
                                onChange={(event) =>
                                  setX402RuntimeDraft((current) => ({
                                    ...current,
                                    managedEnabled: event.target.checked,
                                    enabled: event.target.checked
                                      ? current.enabled
                                      : false,
                                  }))
                                }
                              />
                              <span>
                                <strong>由运营后台托管</strong>
                                <small>
                                  关闭后回退到部署环境变量，不会删除已加密凭据。
                                </small>
                              </span>
                            </label>
                            <label>
                              <input
                                type="checkbox"
                                checked={x402RuntimeDraft.enabled}
                                disabled={
                                  !x402RuntimeDraft.managedEnabled
                                }
                                onChange={(event) =>
                                  setX402RuntimeDraft((current) => ({
                                    ...current,
                                    enabled: event.target.checked,
                                  }))
                                }
                              />
                              <span>
                                <strong>允许创建新 x402 批次</strong>
                                <small>
                                  仅在地址、凭据、目录和路由全部就绪后真正在线。
                                </small>
                              </span>
                            </label>
                          </div>
                          <div className="admin-x402-runtime-fields">
                            <label className="is-wide">
                              <span>Base USDC 收款地址</span>
                              <input
                                type="text"
                                spellCheck={false}
                                autoComplete="off"
                                maxLength={42}
                                disabled={
                                  !x402RuntimeDraft.managedEnabled
                                }
                                value={x402RuntimeDraft.payTo}
                                onChange={(event) =>
                                  setX402RuntimeDraft((current) => ({
                                    ...current,
                                    payTo: event.target.value,
                                  }))
                                }
                                placeholder="0x…"
                              />
                            </label>
                            <label>
                              <span>facilitator 类型</span>
                              <select
                                disabled={
                                  !x402RuntimeDraft.managedEnabled
                                }
                                value={
                                  x402RuntimeDraft.facilitatorProvider
                                }
                                onChange={(event) => {
                                  const provider =
                                    event.target.value === "custom"
                                      ? "custom"
                                      : "cdp";
                                  setX402RuntimeDraft((current) => ({
                                    ...current,
                                    facilitatorProvider: provider,
                                    facilitatorUrl:
                                      provider === "cdp"
                                        ? "https://api.cdp.coinbase.com/platform/v2/x402"
                                        : current.facilitatorProvider ===
                                            "custom"
                                          ? current.facilitatorUrl
                                          : "",
                                  }));
                                }}
                              >
                                <option value="cdp">Coinbase CDP</option>
                                <option value="custom">
                                  自定义 facilitator
                                </option>
                              </select>
                            </label>
                            <label>
                              <span>facilitator HTTPS 地址</span>
                              <input
                                type="url"
                                spellCheck={false}
                                maxLength={2_000}
                                disabled={
                                  !x402RuntimeDraft.managedEnabled ||
                                  x402RuntimeDraft.facilitatorProvider ===
                                    "cdp"
                                }
                                value={x402RuntimeDraft.facilitatorUrl}
                                onChange={(event) =>
                                  setX402RuntimeDraft((current) => ({
                                    ...current,
                                    facilitatorUrl: event.target.value,
                                  }))
                                }
                                placeholder="https://…/x402"
                              />
                            </label>
                            {x402RuntimeDraft.facilitatorProvider ===
                            "cdp" ? (
                              <>
                                <label>
                                  <span>CDP API Key ID</span>
                                  <input
                                    type="password"
                                    autoComplete="new-password"
                                    maxLength={512}
                                    disabled={
                                      !x402RuntimeDraft.managedEnabled
                                    }
                                    value={
                                      x402RuntimeDraft.cdpApiKeyId
                                    }
                                    onChange={(event) =>
                                      setX402RuntimeDraft((current) => ({
                                        ...current,
                                        cdpApiKeyId:
                                          event.target.value,
                                      }))
                                    }
                                    placeholder={
                                      x402Admin.data.configuration
                                        .managedCredentials
                                        .cdpApiKeyIdConfigured
                                        ? "已配置；留空保留"
                                        : "请输入 CDP API Key ID"
                                    }
                                  />
                                  <small>
                                    {x402Admin.data.configuration
                                      .managedCredentials
                                      .cdpApiKeyIdFingerprint
                                      ? `指纹 ${x402Admin.data.configuration.managedCredentials.cdpApiKeyIdFingerprint}`
                                      : "不会回显原文"}
                                  </small>
                                </label>
                                <label>
                                  <span>CDP Ed25519 Secret</span>
                                  <input
                                    type="password"
                                    autoComplete="new-password"
                                    maxLength={256}
                                    disabled={
                                      !x402RuntimeDraft.managedEnabled
                                    }
                                    value={
                                      x402RuntimeDraft.cdpApiKeySecret
                                    }
                                    onChange={(event) =>
                                      setX402RuntimeDraft((current) => ({
                                        ...current,
                                        cdpApiKeySecret:
                                          event.target.value,
                                      }))
                                    }
                                    placeholder={
                                      x402Admin.data.configuration
                                        .managedCredentials
                                        .cdpApiKeySecretConfigured
                                        ? "已配置；留空保留"
                                        : "64-byte Ed25519 Base64"
                                    }
                                  />
                                  <small>
                                    仅用于 RelayBase 向 CDP
                                    鉴权，不是调用方钱包私钥。
                                  </small>
                                </label>
                              </>
                            ) : (
                              <label className="is-wide">
                                <span>facilitator Bearer Token</span>
                                <input
                                  type="password"
                                  autoComplete="new-password"
                                  maxLength={4_096}
                                  disabled={
                                    !x402RuntimeDraft.managedEnabled
                                  }
                                  value={x402RuntimeDraft.bearerToken}
                                  onChange={(event) =>
                                    setX402RuntimeDraft((current) => ({
                                      ...current,
                                      bearerToken: event.target.value,
                                    }))
                                  }
                                  placeholder={
                                    x402Admin.data.configuration
                                      .managedCredentials
                                      .bearerTokenConfigured
                                      ? "已配置；留空保留"
                                      : "请输入服务端 Bearer Token"
                                  }
                                />
                              </label>
                            )}
                          </div>
                          <div className="admin-x402-runtime-actions">
                            <p>
                              {x402Admin.data.configuration
                                .encryptionConfigured
                                ? "✓ 服务端凭据加密主密钥已配置"
                                : "! 缺少服务端凭据加密主密钥，无法启用后台托管"}
                              {x402Admin.data.configuration.issue
                                ? ` · 当前异常：${x402Admin.data.configuration.issue}`
                                : ""}
                            </p>
                            <button
                              className="button button-dark"
                              type="button"
                              disabled={savingX402Runtime}
                              onClick={() =>
                                void saveX402RuntimeConfig()
                              }
                            >
                              {savingX402Runtime
                                ? "加密保存中…"
                                : "保存运行配置"}
                            </button>
                          </div>
                        </section>
                      ) : null}
                      <div className="admin-toolbar admin-catalog-batch-selector">
                        <label>
                          <span>搜索路由</span>
                          <input
                            type="search"
                            maxLength={120}
                            value={catalogQuery}
                            onChange={(event) => {
                              setCatalogQuery(event.target.value);
                              setCatalogPage(0);
                            }}
                            placeholder="平台、摘要或 /v1/ 路径"
                          />
                        </label>
                        <label>
                          <span>平台</span>
                          <select
                            value={catalogPlatform}
                            onChange={(event) => {
                              setCatalogPlatform(event.target.value);
                              setCatalogPage(0);
                            }}
                          >
                            <option value="all">全部平台</option>
                            {catalogPlatforms.map((platform) => (
                              <option value={platform} key={platform}>
                                {platform}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>分类</span>
                          <select
                            value={catalogDataType}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (
                                value === "all" ||
                                isCatalogDataType(value)
                              ) {
                                setCatalogDataType(value);
                                setCatalogPage(0);
                              }
                            }}
                          >
                            <option value="all">全部分类</option>
                            {catalogDataTypes.map((dataType) => (
                              <option value={dataType} key={dataType}>
                                {catalogDataTypeLabel(dataType)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="admin-source-truth">
                        <div>
                          <span
                            className="admin-source-truth-mark"
                            aria-hidden="true"
                          >
                            ≠
                          </span>
                          <div>
                            <strong>发布、配置与实际在线是三层状态</strong>
                            <p>
                              前台 x402 在线需要同时满足：路由当前可用、端点
                              x402 已启用，以及收款地址与 facilitator
                              运行配置完整。只启用开关不会伪造在线状态。
                            </p>
                          </div>
                        </div>
                      </div>
                      {displayedEndpoints.length ? (
                        <>
                        <div className="admin-table-wrap admin-route-list-wrap">
                          <table className="admin-table admin-route-list is-pricing-view">
                            <thead>
                              <tr>
                                <th>路由</th>
                                <th>平台 / 分类</th>
                                <th>标准路由</th>
                                <th>执行能力</th>
                                <th className="admin-money-head">
                                  x402 单目标价
                                </th>
                                <th>每批上限</th>
                                <th>实际状态</th>
                                <th>操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pagedDisplayedEndpoints.map((endpoint) => {
                                const draft = x402Drafts[endpoint.path] ?? {
                                  price: usdInputValue(
                                    endpoint.customerPriceUsdMicros,
                                  ),
                                  maxBatchSize: "25",
                                };
                                const price = parseUsdInput(draft.price);
                                const maxBatchSize = Number(
                                  draft.maxBatchSize,
                                );
                                const eligible =
                                  endpoint.enabled &&
                                  endpoint.marketplaceAvailability ===
                                    "available";
                                const runtimeLive =
                                  x402Admin.status === "ready" &&
                                  x402Admin.data.runtime.mode === "live";
                                const online =
                                  eligible &&
                                  endpoint.x402.enabled &&
                                  runtimeLive;
                                const invalid =
                                  price === null ||
                                  price < endpoint.upstreamPriceUsdMicros ||
                                  !Number.isSafeInteger(maxBatchSize) ||
                                  maxBatchSize < 1 ||
                                  maxBatchSize > 1_000;
                                return (
                                  <tr key={endpoint.path}>
                                    <td className="admin-route-cell">
                                      <div className="admin-route-primary">
                                        <span className="admin-method">
                                          {endpoint.method}
                                        </span>
                                        <code title={endpoint.path}>
                                          {endpoint.path}
                                        </code>
                                      </div>
                                      <small>
                                        {endpoint.summary ?? "无摘要"}
                                      </small>
                                    </td>
                                    <td>
                                      <strong>{endpoint.platform}</strong>
                                      <small>
                                        {catalogDataTypeLabel(
                                          endpoint.dataType,
                                        )}
                                      </small>
                                    </td>
                                    <td>
                                      <span
                                        className={`admin-route-runtime-status ${
                                          eligible
                                            ? "is-available"
                                            : "is-unavailable"
                                        }`}
                                      >
                                        {eligible ? "当前可用" : "当前不可用"}
                                      </span>
                                    </td>
                                    <td>
                                      <strong>
                                        {endpoint.capability.executionMode}
                                      </strong>
                                      <small>
                                        {endpoint.capability.nativeBatchSupported
                                          ? `原生分片 ≤ ${endpoint.capability.nativeBatchMax ?? "—"}`
                                          : "x402 逐目标 fanout"}
                                      </small>
                                      <small>
                                        {endpoint.capability.evidence.status}
                                      </small>
                                    </td>
                                    <td className="admin-money-cell">
                                      <div className="admin-route-price-control">
                                        <span aria-hidden="true">$</span>
                                        <input
                                          inputMode="decimal"
                                          aria-label={`${endpoint.path} x402 单目标价`}
                                          value={draft.price}
                                          onChange={(event) =>
                                            setX402Drafts((current) => ({
                                              ...current,
                                              [endpoint.path]: {
                                                ...draft,
                                                price: event.target.value,
                                              },
                                            }))
                                          }
                                        />
                                      </div>
                                      <small>
                                        成本{" "}
                                        {formatUsd(
                                          endpoint.upstreamPriceUsdMicros,
                                          6,
                                        )}
                                      </small>
                                    </td>
                                    <td>
                                      <input
                                        className="admin-compact-number-input"
                                        type="number"
                                        min="1"
                                        max="1000"
                                        step="1"
                                        aria-label={`${endpoint.path} x402 每批上限`}
                                        value={draft.maxBatchSize}
                                        onChange={(event) =>
                                          setX402Drafts((current) => ({
                                            ...current,
                                            [endpoint.path]: {
                                              ...draft,
                                              maxBatchSize:
                                                event.target.value,
                                            },
                                          }))
                                        }
                                      />
                                    </td>
                                    <td>
                                      <span
                                        className={`admin-route-runtime-status ${
                                          online
                                            ? "is-available"
                                            : "is-unavailable"
                                        }`}
                                      >
                                        {online
                                          ? "x402 当前在线"
                                          : endpoint.x402.enabled
                                            ? "x402 当前不可用"
                                            : "x402 未启用"}
                                      </span>
                                      <small>
                                        {!eligible
                                          ? "先恢复标准路由可用性"
                                          : !runtimeLive
                                            ? "结算运行时未就绪"
                                            : "Base USDC · exact"}
                                      </small>
                                    </td>
                                    <td>
                                      <button
                                        className={`button button-small ${
                                          endpoint.x402.enabled
                                            ? "admin-button-danger-ghost"
                                            : "button-dark"
                                        }`}
                                        type="button"
                                        disabled={
                                          savingX402Path === endpoint.path ||
                                          invalid ||
                                          (!endpoint.x402.enabled &&
                                            !eligible)
                                        }
                                        onClick={() =>
                                          void saveX402Config(
                                            endpoint,
                                            !endpoint.x402.enabled,
                                          )
                                        }
                                      >
                                        {savingX402Path === endpoint.path
                                          ? "保存中"
                                          : endpoint.x402.enabled
                                            ? "停用"
                                            : "保存并启用"}
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <RouteCatalogPagination
                          page={safeCatalogPage}
                          pageCount={displayedEndpointPageCount}
                          total={displayedEndpoints.length}
                          onPageChange={setCatalogPage}
                        />
                        </>
                      ) : (
                        <div className="admin-empty">
                          <strong>没有符合条件的路由</strong>
                          <p>调整平台、分类或搜索词后重试。</p>
                        </div>
                      )}
                    </section>
                  ) : null}
                  {catalogView === "consistency" ? (
                    <div className="admin-catalog-proof">
                    <div>
                      <p className="section-kicker">
                        SYNC COVERAGE / EVIDENCE
                      </p>
                      <h3>目录覆盖证明</h3>
                      <span>
                        {catalog.data.sync
                          ? `同步于 ${formatDate(catalog.data.sync.syncedAt)}`
                          : "尚无成功同步记录"}
                      </span>
                    </div>
                    {catalog.data.sync?.coverage ? (
                      <>
                        <dl>
                          <div>
                            <dt>OpenAPI 操作</dt>
                            <dd>
                              {catalog.data.sync.coverage.openApiOperations.toLocaleString()}
                            </dd>
                            <small>
                              {catalog.data.sync.coverage.openApiVersion ??
                                "版本未标注"}{" "}
                              / 仅 OpenAPI{" "}
                              {catalog.data.sync.coverage.openApiOnly.toLocaleString()}
                            </small>
                          </div>
                          <div>
                            <dt>价格记录</dt>
                            <dd>
                              {catalog.data.sync.coverage.rawPriceRows.toLocaleString()}
                            </dd>
                            <small>
                              去重{" "}
                              {catalog.data.sync.coverage.normalizedPrices.toLocaleString()}{" "}
                              / 仅价格目录{" "}
                              {catalog.data.sync.coverage.priceOnly.toLocaleString()}
                            </small>
                          </div>
                          <div>
                            <dt>路径与方法映射</dt>
                            <dd>
                              {catalog.data.sync.coverage.openApiPriceMapped.toLocaleString()}
                            </dd>
                            <small>
                              Key scope 排除{" "}
                              {catalog.data.sync.coverage.scopeExcluded.toLocaleString()}
                            </small>
                          </div>
                          <div>
                            <dt>最终核验</dt>
                            <dd>
                              {catalog.data.sync.coverage.matchedPrices.toLocaleString()}
                            </dd>
                            <small>
                              正价{" "}
                              {catalog.data.sync.coverage.positivePrices.toLocaleString()}{" "}
                              / 零价{" "}
                              {catalog.data.sync.coverage.zeroPrices.toLocaleString()}{" "}
                              / 未核验{" "}
                              {catalog.data.sync.coverage.awaitingPrice.toLocaleString()}
                            </small>
                          </div>
                        </dl>
                        <div className="admin-catalog-proof-hashes">
                          <span>
                            OPENAPI{" "}
                            <code
                              title={
                                catalog.data.sync.coverage
                                  .openApiSnapshotHash ?? undefined
                              }
                            >
                              {catalog.data.sync.coverage.openApiSnapshotHash
                                ? catalog.data.sync.coverage.openApiSnapshotHash.slice(
                                    0,
                                    12,
                                  )
                                : "未记录"}
                            </code>
                          </span>
                          <span>
                            PRICE{" "}
                            <code
                              title={
                                catalog.data.sync.coverage
                                  .priceSnapshotHash ?? undefined
                              }
                            >
                              {catalog.data.sync.coverage.priceSnapshotHash
                                ? catalog.data.sync.coverage.priceSnapshotHash.slice(
                                    0,
                                    12,
                                  )
                                : "未记录"}
                            </code>
                          </span>
                          <span>
                            KEY{" "}
                            <code>
                              {catalog.data.sync.credentialFingerprint ??
                                "environment"}
                            </code>
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="admin-catalog-proof-missing">
                        <strong>当前记录缺少覆盖证明</strong>
                        <p>
                          请重新同步上游；在新快照成功发布前，系统不会伪造覆盖数量。
                        </p>
                      </div>
                    )}
                    </div>
                  ) : null}
                  {catalogView === "routes" ||
                  catalogView === "pricing" ? (
                    <section
                    className="admin-catalog-batch"
                    aria-labelledby="catalog-batch-title"
                  >
                    <div className="admin-catalog-batch-head">
                      <div>
                        <p className="section-kicker">
                          {catalogView === "pricing"
                            ? "PRICING / PUBLISH CONTROL"
                            : "CURRENT RUNTIME CATALOG"}
                        </p>
                        <h3 id="catalog-batch-title">
                          {catalogView === "pricing"
                            ? "定价与批量发布"
                            : "当前路由清单"}
                        </h3>
                        <p>
                          {catalogView === "pricing"
                            ? "当前筛选同时控制下方列表与服务端批量预览；最终匹配数、阻断项和金额只以冻结回执为准。"
                            : "先按平台与分类定位接口，再核对独立的前台发布状态和后端实际可用性；待确认项可直接单条或批量添加。"}
                        </p>
                      </div>
                      <span>
                        {catalog.data.sync
                          ? `代次 ${catalog.data.sync.generation}`
                          : "目录代次不可用"}
                      </span>
                    </div>

                    <form
                      onSubmit={
                        catalogView === "pricing"
                          ? previewCatalogBatch
                          : (event) => event.preventDefault()
                      }
                    >
                      <div className="admin-toolbar admin-catalog-batch-selector">
                        <label>
                          <span>搜索路由</span>
                          <input
                            type="search"
                            maxLength={120}
                            value={catalogQuery}
                            onChange={(event) => {
                              setCatalogQuery(event.target.value);
                              setCatalogPage(0);
                            }}
                            placeholder="平台、标签、operationId、摘要或 /v1/ 路径"
                          />
                        </label>
                        <label>
                          <span>平台</span>
                          <select
                            value={catalogPlatform}
                            onChange={(event) => {
                              setCatalogPlatform(event.target.value);
                              setCatalogPage(0);
                            }}
                          >
                            <option value="all">全部平台</option>
                            {catalogPlatforms.map((platform) => (
                              <option value={platform} key={platform}>
                                {platform}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>分类</span>
                          <select
                            value={catalogDataType}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (
                                value === "all" ||
                                isCatalogDataType(value)
                              ) {
                                setCatalogDataType(value);
                                setCatalogPage(0);
                              }
                            }}
                          >
                            <option value="all">全部分类</option>
                            {catalogDataTypes.map((dataType) => (
                              <option value={dataType} key={dataType}>
                                {catalogDataTypeLabel(dataType)}
                              </option>
                            ))}
                          </select>
                        </label>
                        {catalogView === "routes" ? (
                          <label>
                            <span>当前可用性</span>
                            <select
                              value={catalogRuntimeAvailability}
                              onChange={(event) => {
                                const value = event.target.value;
                                if (
                                  value === "all" ||
                                  value === "available" ||
                                  value === "unavailable"
                                ) {
                                  setCatalogRuntimeAvailability(value);
                                  setCatalogPage(0);
                                }
                              }}
                            >
                              <option value="all">全部可用性</option>
                              <option value="available">当前可用</option>
                              <option value="unavailable">当前不可用</option>
                            </select>
                          </label>
                        ) : (
                          <>
                            <label>
                              <span>发布状态</span>
                              <select
                                value={catalogStatus}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  if (isCatalogFilterStatus(value)) {
                                    setCatalogStatus(value);
                                    setCatalogPage(0);
                                  }
                                }}
                              >
                                <option value="all">全部状态</option>
                                <option value="enabled">已添加到前台</option>
                                <option value="disabled">未添加到前台</option>
                                <option value="review">待复核</option>
                              </select>
                            </label>
                            <label>
                              <span>安全分类</span>
                              <select
                                value={catalogSafety}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  if (isCatalogSafetyFilter(value)) {
                                    setCatalogSafety(value);
                                    setCatalogPage(0);
                                  }
                                }}
                              >
                                <option value="all">全部安全分类</option>
                                <option value="safe_data_read">
                                  安全数据读取
                                </option>
                                <option value="ambiguous">需人工判断</option>
                                <option value="prohibited">禁止公开</option>
                              </select>
                            </label>
                            <details className="admin-catalog-advanced-filters">
                              <summary>
                                更多筛选
                                {catalogTag !== null ||
                                catalogSurface !== "all"
                                  ? " · 已启用"
                                  : ""}
                              </summary>
                              <div>
                                <label>
                                  <span>标签</span>
                                  <select
                                    value={catalogTag ?? ""}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      if (value === "") {
                                        setCatalogTag(null);
                                        setCatalogPage(0);
                                      } else if (isCatalogTag(value)) {
                                        setCatalogTag(value);
                                        setCatalogPage(0);
                                      }
                                    }}
                                  >
                                    <option value="">全部标签</option>
                                    {catalogTags.map((tag) => (
                                      <option
                                        value={tag}
                                        key={normalizeCatalogTagKey(tag)}
                                      >
                                        {tag}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  <span>调用入口</span>
                                  <select
                                    value={catalogSurface}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      if (
                                        value === "all" ||
                                        isCatalogSurface(value)
                                      ) {
                                        setCatalogSurface(value);
                                        setCatalogPage(0);
                                      }
                                    }}
                                  >
                                    <option value="all">全部入口</option>
                                    {catalogSurfaces.map((surface) => (
                                      <option value={surface} key={surface}>
                                        {catalogSurfaceLabel(surface)} ·{" "}
                                        {surface}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                            </details>
                          </>
                        )}
                        <p>
                          本地显示{" "}
                          <strong>{displayedEndpoints.length}</strong> /{" "}
                          {catalog.data.count} 条
                        </p>
                      </div>

                      {catalogView === "pricing" ? (
                        <div className="admin-catalog-batch-controls">
                        <label>
                          <span>批量动作</span>
                          <select
                            value={catalogBatchAction}
                            disabled={
                              previewingCatalogBatch ||
                              applyingCatalogBatch
                            }
                            onChange={(event) => {
                              const value = event.target.value;
                              if (isCatalogBatchAction(value)) {
                                setCatalogBatchAction(value);
                              }
                            }}
                          >
                            <option value="publish">审核并上架</option>
                            <option value="reprice">只重算客户价</option>
                            <option value="disable">下架匹配端点</option>
                          </select>
                        </label>
                        <label>
                          <span>成本加价（%）</span>
                          <input
                            inputMode="decimal"
                            maxLength={6}
                            disabled={
                              catalogBatchAction === "disable" ||
                              previewingCatalogBatch ||
                              applyingCatalogBatch
                            }
                            value={catalogBatchMarkupPercent}
                            aria-invalid={
                              catalogBatchAction !== "disable" &&
                              parseMarkupPercentInput(
                                catalogBatchMarkupPercent,
                              ) === null
                            }
                            onChange={(event) =>
                              setCatalogBatchMarkupPercent(
                                event.target.value,
                              )
                            }
                          />
                          <small>0–500%，最多 2 位小数</small>
                        </label>
                        <label>
                          <span>最低客户价（USD / 次）</span>
                          <input
                            inputMode="decimal"
                            maxLength={10}
                            disabled={
                              catalogBatchAction === "disable" ||
                              previewingCatalogBatch ||
                              applyingCatalogBatch
                            }
                            value={catalogBatchMinimumPrice}
                            aria-invalid={
                              catalogBatchAction !== "disable" &&
                              parseUsdInput(
                                catalogBatchMinimumPrice,
                              ) === null
                            }
                            onChange={(event) =>
                              setCatalogBatchMinimumPrice(
                                event.target.value,
                              )
                            }
                          />
                          <small>$0.000001–$100，最多 6 位小数</small>
                        </label>
                        <div className="admin-catalog-batch-preview-copy">
                          <span>预览规则</span>
                          <strong>
                            {catalogBatchActionLabel(catalogBatchAction)}
                          </strong>
                          <small>
                            预览不会修改端点；应用阶段会再次校验目录代次、
                            revision、安全分类和完整摘要。
                          </small>
                        </div>
                        <button
                          className="button button-dark"
                          type="submit"
                          disabled={
                            previewingCatalogBatch ||
                            applyingCatalogBatch ||
                            !catalog.data.sync?.coverage ||
                            currentCatalogBatchRequest === null
                          }
                        >
                          {previewingCatalogBatch
                            ? "正在冻结预览…"
                            : "生成整批预览"}
                        </button>
                        </div>
                      ) : null}
                    </form>

                    {catalogView === "pricing" && catalogBatchError ? (
                      <div
                        className="admin-catalog-batch-alert is-blocked"
                        role="alert"
                      >
                        {catalogBatchError}
                      </div>
                    ) : null}

                    {catalogView === "pricing" && catalogBatch ? (
                      <CatalogBatchReceipt
                        key={`${catalogBatch.batch.id}:${catalogBatch.batch.expiresAt}`}
                        response={catalogBatch}
                        request={catalogBatchRequest}
                        matchesCurrentRequest={
                          catalogBatchRequestMatchesCurrent
                        }
                        confirmation={catalogBatchConfirmation}
                        refreshing={refreshingCatalogBatch}
                        applying={applyingCatalogBatch}
                        onConfirmationChange={
                          setCatalogBatchConfirmation
                        }
                        onRefresh={() => void refreshCatalogBatch()}
                        onApply={() => void applyCatalogBatch()}
                      />
                    ) : catalogView === "pricing" ? (
                      <div className="admin-catalog-batch-empty">
                        <strong>尚未生成批量预览</strong>
                        <p>
                          选择平台、数据类型、标签、入口、状态与安全分类，
                          再冻结一份有时效的服务端快照。预览最多返回前 100 条明细。
                        </p>
                      </div>
                    ) : null}
                    </section>
                  ) : null}
                  {catalogView === "routes" ||
                  catalogView === "pricing" ? (
                    <>
                  {catalogView === "routes" ? (
                    <div className="admin-route-batch-bar">
                      <div>
                        <strong>
                          已添加 {publishedEndpointTotal.toLocaleString()} ·
                          当前可用 {availableEndpointTotal.toLocaleString()} ·
                          待确认 {visibleConfirmableEndpoints.length.toLocaleString()}
                        </strong>
                        <small>
                          已选择 {selectedConfirmableEndpoints.length} 个待确认接口
                        </small>
                      </div>
                      <button
                        className="button button-dark button-small"
                        type="button"
                        disabled={!selectedConfirmableEndpoints.length}
                        onClick={() => setRouteBatchConfirmOpen(true)}
                      >
                        确认添加所选
                        {selectedConfirmableEndpoints.length
                          ? ` ${selectedConfirmableEndpoints.length} 项`
                          : ""}
                      </button>
                    </div>
                  ) : null}
                  {displayedEndpoints.length ? (
                    <>
                    <div className="admin-table-wrap admin-route-list-wrap">
                      <table
                        className={`admin-table admin-route-list ${
                          catalogView === "routes"
                            ? "is-runtime-view"
                            : "is-pricing-view"
                        }`}
                      >
                        <thead>
                          <tr>
                            {catalogView === "routes" ? (
                              <th className="admin-route-select-column">
                                <input
                                  type="checkbox"
                                  aria-label="选择当前筛选中的全部待确认接口"
                                  checked={allVisiblePendingSelected}
                                  disabled={!visibleConfirmableEndpoints.length}
                                  onChange={(event) => {
                                    const paths = visibleConfirmableEndpoints.map(
                                      (endpoint) => endpoint.path,
                                    );
                                    setSelectedPendingPaths((current) => {
                                      const next = new Set(current);
                                      for (const path of paths) {
                                        if (event.target.checked) {
                                          next.add(path);
                                        } else {
                                          next.delete(path);
                                        }
                                      }
                                      return next;
                                    });
                                  }}
                                />
                              </th>
                            ) : null}
                            <th>路由</th>
                            <th>平台 / 分类</th>
                            <th>请求能力</th>
                            <th className="admin-money-head">成本</th>
                            <th className="admin-money-head">客户价</th>
                            <th className="admin-money-head">毛利</th>
                            <th>
                              {catalogView === "routes"
                                ? "当前可用性"
                                : "校验"}
                            </th>
                            <th>
                              {catalogView === "routes"
                                ? "前台状态"
                                : "发布状态"}
                            </th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedDisplayedEndpoints.map((endpoint) => {
                            const draft = priceDrafts[endpoint.path] ?? "";
                            const parsedDraft = parseUsdInput(draft);
                            const priceChanged =
                              parsedDraft !== null &&
                              parsedDraft !== endpoint.customerPriceUsdMicros;
                            const invalidPrice =
                              parsedDraft === null ||
                              parsedDraft < endpoint.upstreamPriceUsdMicros;
                            const margin =
                              endpoint.customerPriceUsdMicros -
                              endpoint.upstreamPriceUsdMicros;
                            const confirmable =
                              catalogEndpointConfirmable(endpoint);
                            return (
                              <tr
                                key={endpoint.path}
                                className={
                                  selectedPendingPaths.has(endpoint.path)
                                    ? "is-selected"
                                    : undefined
                                }
                              >
                                {catalogView === "routes" ? (
                                  <td className="admin-route-select-column">
                                    {confirmable ? (
                                      <input
                                        type="checkbox"
                                        aria-label={`选择待确认接口 ${endpoint.path}`}
                                        checked={selectedPendingPaths.has(
                                          endpoint.path,
                                        )}
                                        onChange={(event) => {
                                          setSelectedPendingPaths((current) => {
                                            const next = new Set(current);
                                            if (event.target.checked) {
                                              next.add(endpoint.path);
                                            } else {
                                              next.delete(endpoint.path);
                                            }
                                            return next;
                                          });
                                        }}
                                      />
                                    ) : (
                                      <span
                                        className="admin-route-select-placeholder"
                                        aria-hidden="true"
                                      >
                                        ·
                                      </span>
                                    )}
                                  </td>
                                ) : null}
                                <td className="admin-route-cell">
                                  <div className="admin-route-primary">
                                    <span className="admin-method">
                                      {endpoint.method}
                                    </span>
                                    <code title={endpoint.path}>
                                      {endpoint.path}
                                    </code>
                                  </div>
                                  {endpoint.summary ? (
                                    <small title={endpoint.summary}>
                                      {endpoint.summary}
                                    </small>
                                  ) : null}
                                  <details className="admin-route-row-details">
                                    <summary>接口详情</summary>
                                    <div className="admin-route-detail-grid">
                                      <p>
                                        <span>operationId</span>
                                        <code>
                                          {endpoint.operationId ?? "未提供"}
                                        </code>
                                      </p>
                                      <p>
                                        <span>标签</span>
                                        <strong>
                                          {endpoint.tags.length
                                            ? endpoint.tags.join(" · ")
                                            : "无"}
                                        </strong>
                                      </p>
                                      <p>
                                        <span>安全策略</span>
                                        <strong>
                                          {catalogSafetyLabel(
                                            endpoint.safetyClassification,
                                          )}{" "}
                                          · v{endpoint.safetyPolicyVersion}
                                        </strong>
                                      </p>
                                      <p>
                                        <span>Revision</span>
                                        <strong>{endpoint.revision}</strong>
                                      </p>
                                      <p>
                                        <span>来源接口上限</span>
                                        <strong>
                                          {endpoint.rateLimitRps == null
                                            ? "未声明"
                                            : `${endpoint.rateLimitRps.toLocaleString()} RPS`}
                                        </strong>
                                      </p>
                                      <p>
                                        <span>能力证据</span>
                                        <strong>
                                          {endpoint.capability.evidence.status}
                                          {" · "}v{endpoint.capability.revision}
                                        </strong>
                                      </p>
                                    </div>
                                    <p className="admin-route-description">
                                      {endpoint.capability.evidence.note}
                                    </p>
                                    {endpoint.description ? (
                                      <p className="admin-route-description">
                                        {endpoint.description}
                                      </p>
                                    ) : null}
                                    {endpoint.safetyReasons.length ? (
                                      <p className="admin-route-description">
                                        安全依据：
                                        {endpoint.safetyReasons.join("；")}
                                      </p>
                                    ) : null}
                                    {endpoint.parameterSchema !== null ? (
                                      <pre>
                                        {JSON.stringify(
                                          endpoint.parameterSchema,
                                          null,
                                          2,
                                        )}
                                      </pre>
                                    ) : null}
                                  </details>
                                </td>
                                <td>
                                  <strong>{endpoint.platform}</strong>
                                  <small>
                                    {catalogDataTypeLabel(endpoint.dataType)} ·{" "}
                                    {catalogSurfaceLabel(endpoint.surface)}
                                  </small>
                                </td>
                                <td>
                                  <strong>
                                    {endpoint.capability.executionMode}
                                  </strong>
                                  <small>
                                    {endpoint.capability.nativeBatchSupported
                                      ? `原生批量 ≤ ${endpoint.capability.nativeBatchMax ?? "—"} · ${endpoint.capability.targetField ?? "目标"}`
                                      : endpoint.capability.pagination
                                        ? `${endpoint.capability.pagination.style} · ${endpoint.capability.pagination.requestField ?? "分页字段待确认"}`
                                        : "当前 1:1 上游请求"}
                                  </small>
                                  <small>
                                    {endpoint.capability.pagination?.pageSizeMax
                                      ? `单页上限 ${endpoint.capability.pagination.pageSizeMax}`
                                      : "返回规模待确认"}
                                  </small>
                                </td>
                                <td className="admin-money-cell">
                                  <strong className="admin-money-value">
                                    {formatUsd(
                                      endpoint.upstreamPriceUsdMicros,
                                      6,
                                    )}
                                  </strong>
                                  <small>/ 次</small>
                                </td>
                                <td className="admin-money-cell">
                                  {catalogView === "pricing" ? (
                                    <div className="admin-route-price-control">
                                      <span aria-hidden="true">$</span>
                                      <input
                                        inputMode="decimal"
                                        value={draft}
                                        aria-label={`${endpoint.path} 客户价（USD / 次）`}
                                        aria-invalid={invalidPrice}
                                        onChange={(event) =>
                                          setPriceDrafts((current) => ({
                                            ...current,
                                            [endpoint.path]: event.target.value,
                                          }))
                                        }
                                      />
                                      <button
                                        className="button button-blue button-small"
                                        type="button"
                                        disabled={
                                          savingPath === endpoint.path ||
                                          invalidPrice ||
                                          !priceChanged
                                        }
                                        onClick={() =>
                                          void saveEndpointPrice(endpoint)
                                        }
                                      >
                                        {savingPath === endpoint.path
                                          ? "保存中"
                                          : "保存"}
                                      </button>
                                    </div>
                                  ) : (
                                    <strong className="admin-money-value">
                                      {formatUsd(
                                        endpoint.customerPriceUsdMicros,
                                        6,
                                      )}
                                    </strong>
                                  )}
                                  {invalidPrice ? (
                                    <small className="is-error">不得低于成本</small>
                                  ) : null}
                                </td>
                                <td className="admin-money-cell">
                                  <strong
                                    className={`admin-money-value ${
                                      margin < 0
                                        ? "is-negative-balance"
                                        : ""
                                    }`}
                                  >
                                    {formatUsd(margin, 6)}
                                  </strong>
                                </td>
                                <td>
                                  {catalogView === "routes" ? (
                                    <div className="admin-route-runtime">
                                      <span
                                        className={`admin-route-runtime-status ${
                                          endpoint.marketplaceAvailability ===
                                          "available"
                                            ? "is-available"
                                            : "is-unavailable"
                                        }`}
                                      >
                                        {endpoint.marketplaceAvailability ===
                                        "available"
                                          ? "当前可用"
                                          : "当前不可用"}
                                      </span>
                                      <small
                                        title={catalogAvailabilitySummary(
                                          endpoint,
                                        )}
                                      >
                                        {catalogAvailabilitySummary(endpoint)}
                                      </small>
                                    </div>
                                  ) : (
                                    <div className="admin-route-checks">
                                      <span
                                        className={`admin-safety-badge is-${endpoint.safetyClassification}`}
                                      >
                                        {catalogSafetyLabel(
                                          endpoint.safetyClassification,
                                        )}
                                      </span>
                                      <small
                                        className={
                                          endpoint.presentInLatestSync &&
                                          endpoint.priceVerified &&
                                          endpoint.readOnly
                                            ? "is-ok"
                                            : "is-warning"
                                        }
                                      >
                                        {endpoint.presentInLatestSync
                                          ? endpoint.priceVerified
                                            ? endpoint.readOnly
                                              ? "同步 / 成本 / 只读已确认"
                                              : "只读待确认"
                                            : "成本待核验"
                                          : "上游已缺失"}
                                      </small>
                                    </div>
                                  )}
                                </td>
                                <td>
                                  <span
                                    className={`admin-route-publish-status ${
                                      endpoint.enabled
                                        ? "is-added"
                                        : "is-pending"
                                    }`}
                                  >
                                    {endpoint.enabled
                                      ? "已添加到前台"
                                      : catalogView === "routes"
                                        ? "待确认"
                                        : "未添加到前台"}
                                  </span>
                                  <small>
                                    {endpoint.reviewedAt
                                      ? formatDate(endpoint.reviewedAt)
                                      : "未审核"}
                                  </small>
                                </td>
                                <td>
                                  {catalogView === "pricing" ? (
                                    <button
                                      className={`button button-small ${
                                        endpoint.enabled
                                          ? "admin-button-danger-ghost"
                                          : "button-dark"
                                      }`}
                                      type="button"
                                      disabled={
                                        !endpoint.enabled &&
                                        (!endpoint.presentInLatestSync ||
                                          !endpoint.priceVerified ||
                                          endpoint.safetyClassification !==
                                            "safe_data_read" ||
                                          endpoint.safetyPolicyVersion !==
                                            CATALOG_SAFETY_POLICY_VERSION ||
                                          invalidPrice)
                                      }
                                      onClick={() =>
                                        setConfirmAction({
                                          kind: "endpoint",
                                          endpoint,
                                          nextEnabled: !endpoint.enabled,
                                        })
                                      }
                                    >
                                      {endpoint.enabled
                                        ? "移除"
                                        : "添加到前台"}
                                    </button>
                                  ) : (
                                    <button
                                      className={`button button-small ${
                                        confirmable
                                          ? "button-dark"
                                          : "button-ghost"
                                      }`}
                                      type="button"
                                      onClick={() => {
                                        if (confirmable) {
                                          setConfirmAction({
                                            kind: "endpoint",
                                            endpoint,
                                            nextEnabled: true,
                                          });
                                        } else {
                                          setCatalogView("pricing");
                                          setCatalogPage(0);
                                        }
                                      }}
                                    >
                                      {confirmable ? "确认添加" : "管理"}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <RouteCatalogPagination
                      page={safeCatalogPage}
                      pageCount={displayedEndpointPageCount}
                      total={displayedEndpoints.length}
                      onPageChange={setCatalogPage}
                    />
                    </>
                  ) : (
                    <div className="admin-empty">
                      <strong>没有符合条件的接口</strong>
                      <p>
                        调整筛选条件，或从上游同步最新端点目录。
                      </p>
                    </div>
                  )}
                  {catalogView === "routes" ? (
                    <details className="admin-route-secondary-actions">
                      <summary>低频操作 · 新增或同步路由</summary>
                      <div>
                        <p>
                          新接口需要先同步上游目录并补齐调用契约，再进入待确认清单。
                        </p>
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          onClick={() => {
                            setCatalogView("add");
                            setCatalogPage(0);
                          }}
                        >
                          打开新增 / 同步流程
                        </button>
                      </div>
                    </details>
                  ) : null}
                </>
              ) : null}
                </>
              ) : null}
              </StatePanel>
            ) : null}
          </section>
        ) : null}

            {activeTab === "payments" ? (
          <section className="admin-section" aria-labelledby="payments-title">
            <div className="admin-section-head">
              <div>
                <p className="section-kicker">PAYMENT REVIEW QUEUE</p>
                <h2 id="payments-title">支付复核</h2>
                <p>处理异常付款、人工复核、订单恢复和完整支付记录。</p>
              </div>
              <button
                className="button button-ghost button-small"
                onClick={() =>
                  void Promise.all([
                    loadPaymentReviews(),
                    loadPayments(),
                    loadX402Admin(),
                  ])
                }
              >
                刷新支付
              </button>
            </div>
            <StatePanel
              state={x402Admin}
              label="统一收入与 x402 结算账本"
              onRetry={() => void loadX402Admin()}
            >
              {x402Admin.status === "ready" ? (
                <div className="admin-x402-ledger">
                  <div className="admin-payment-records-head">
                    <span className="admin-index">00</span>
                    <div>
                      <h3>两类账本与统一经营口径</h3>
                      <p>
                        充值现金流入不等于收入；预充值用量完成且未退款才确认收入。
                        x402 只有 facilitator 结算成功并保存 Base
                        交易哈希后确认收入，且永不计入用户余额。
                      </p>
                    </div>
                  </div>
                  <div className="admin-stat-grid admin-stat-grid-compact">
                    <article>
                      <span>30 天确认收入</span>
                      <strong>
                        {formatUsd(
                          x402Admin.data.accounting
                            .recognizedRevenueUsdMicros,
                        )}
                      </strong>
                      <small>预充值用量 + x402 已结算</small>
                    </article>
                    <article>
                      <span>预充值用量收入</span>
                      <strong>
                        {formatUsd(
                          x402Admin.data.accounting.prepaid
                            .recognizedUsageRevenueUsdMicros,
                        )}
                      </strong>
                      <small>
                        充值现金流入{" "}
                        {formatUsd(
                          x402Admin.data.accounting.prepaid
                            .topupCashInUsdMicros,
                        )}{" "}
                        · 递延余额负债
                      </small>
                    </article>
                    <article>
                      <span>x402 链上结算收入</span>
                      <strong>
                        {formatUsd(
                          x402Admin.data.accounting.x402
                            .recognizedRevenueUsdMicros,
                        )}
                      </strong>
                      <small>
                        {x402Admin.data.accounting.x402.settledBatches}{" "}
                        个已结算批次 · 余额影响 $0
                      </small>
                    </article>
                    <article>
                      <span>x402 待处理</span>
                      <strong>
                        {x402Admin.data.accounting.x402.pendingBatches}
                      </strong>
                      <small>
                        金额{" "}
                        {formatUsd(
                          x402Admin.data.accounting.x402
                            .pendingAmountUsdMicros,
                        )}
                      </small>
                    </article>
                  </div>
                  <div className="admin-source-truth">
                    <div>
                      <span
                        className="admin-source-truth-mark"
                        aria-hidden="true"
                      >
                        {x402Admin.data.runtime.mode === "live" ? "✓" : "!"}
                      </span>
                      <div>
                        <strong>
                          x402 运行时：{x402Admin.data.runtime.mode}
                        </strong>
                        <p>
                          {x402Admin.data.runtime.mode === "live"
                            ? `${x402Admin.data.runtime.facilitatorProvider.toUpperCase()} facilitator 与收款地址已配置。`
                            : `缺少：${
                                x402Admin.data.runtime.missing.join("、") ||
                                "已关闭运行开关"
                              }。未就绪时系统不会发出付款报价。`}
                        </p>
                      </div>
                    </div>
                  </div>
                  {x402Admin.data.batches.length ? (
                    <div className="admin-table-wrap admin-saas-table-wrap">
                      <table className="admin-table admin-saas-table">
                        <thead>
                          <tr>
                            <th>批次 / 数据产品</th>
                            <th>付款与收入</th>
                            <th className="admin-money-head">结算金额</th>
                            <th className="admin-money-head">上游成本</th>
                            <th className="admin-money-head">毛利</th>
                            <th>Base 回执</th>
                            <th>更新时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {x402Admin.data.batches.map((batch) => (
                            <tr key={batch.id}>
                              <td>
                                <code>{batch.id}</code>
                                <small title={batch.endpoint}>
                                  {batch.endpoint} ·{" "}
                                  {batch.verifiedQuantity} targets
                                </small>
                              </td>
                              <td>
                                <span
                                  className={`admin-payment-status is-${
                                    batch.paymentStatus === "settled"
                                      ? "success"
                                      : "warning"
                                  }`}
                                >
                                  {batch.paymentStatus}
                                </span>
                                <small>
                                  执行 {batch.status} · 收入{" "}
                                  {batch.revenueStatus}
                                </small>
                              </td>
                              <td className="admin-money-cell">
                                <strong className="admin-money-value">
                                  {formatUsd(batch.amountUsdcAtomic, 6)}
                                </strong>
                                <small>USDC</small>
                              </td>
                              <td className="admin-money-cell">
                                <strong className="admin-money-value">
                                  {formatUsd(
                                    batch.upstreamCostUsdMicros,
                                    6,
                                  )}
                                </strong>
                              </td>
                              <td className="admin-money-cell">
                                <strong className="admin-money-value">
                                  {formatUsd(batch.grossMarginUsdMicros, 6)}
                                </strong>
                              </td>
                              <td>
                                <code title={batch.transaction ?? ""}>
                                  {batch.transaction
                                    ? `${batch.transaction.slice(0, 12)}…`
                                    : "未结算"}
                                </code>
                                <small>
                                  {batch.payer
                                    ? `${batch.payer.slice(0, 10)}…`
                                    : batch.failureCode ?? "等待钱包付款"}
                                </small>
                              </td>
                              <td>{formatDate(batch.updatedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="admin-empty">
                      <strong>还没有 x402 批次</strong>
                      <p>
                        Agent 获取报价后，批次会按报价、验证、结算和执行状态进入这里。
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </StatePanel>
            <div className="admin-review-queue">
              <div className="admin-review-queue-head">
                <div>
                  <span className="admin-index">01</span>
                  <div>
                    <h3>待处理复核案件</h3>
                    <p>
                      每个结案操作都会校验案件状态，并写入管理员审计记录。
                    </p>
                  </div>
                </div>
                {paymentReviews.status === "ready" ? (
                  <strong>
                    {paymentReviews.data.total.toLocaleString()} OPEN
                  </strong>
                ) : null}
              </div>
              <StatePanel
                state={paymentReviews}
                label="支付复核案件"
                onRetry={() => void loadPaymentReviews()}
              >
                {paymentReviews.status === "ready" ? (
                  paymentReviews.data.reviews.length ? (
                    <>
                      {paymentReviews.data.total >
                      paymentReviews.data.reviews.length ? (
                        <p className="admin-review-limit-note">
                          当前展示最早的{" "}
                          {paymentReviews.data.reviews.length.toLocaleString()}{" "}
                          条，共{" "}
                          {paymentReviews.data.total.toLocaleString()} 条待处理。
                        </p>
                      ) : null}
                      <div className="admin-review-case-list">
                        {paymentReviews.data.reviews.map((review) => (
                          <article
                            className="admin-review-case"
                            key={review.id}
                          >
                            <header>
                              <div>
                                <span className="admin-review-reason">
                                  {reviewReasonLabel(review.reason)}
                                </span>
                                <strong>{review.email}</strong>
                              </div>
                              <time>{formatDate(review.createdAt)}</time>
                            </header>
                            <dl>
                              <div>
                                <dt>实际付款</dt>
                                <dd>
                                  {review.actuallyPaid ?? "未知"}{" "}
                                  {review.payCurrency?.toUpperCase() ?? ""}
                                </dd>
                              </div>
                              <div>
                                <dt>案件状态</dt>
                                <dd>{review.status.toUpperCase()}</dd>
                              </div>
                              <div>
                                <dt>异常代码</dt>
                                <dd>{review.reason}</dd>
                              </div>
                            </dl>
                            <div className="admin-review-identifiers">
                              <p>
                                <span>案件 ID</span>
                                <code>{review.id}</code>
                              </p>
                              <p>
                                <span>订单 ID</span>
                                <code>{review.orderId}</code>
                              </p>
                              <p>
                                <span>用户 ID</span>
                                <code>{review.userId}</code>
                              </p>
                              <p>
                                <span>支付商 ID</span>
                                <code>
                                  {review.providerPaymentId ?? "未提供"}
                                </code>
                              </p>
                              {review.parentPaymentId ? (
                                <p>
                                  <span>父支付 ID</span>
                                  <code>{review.parentPaymentId}</code>
                                </p>
                              ) : null}
                            </div>
                            <details className="admin-review-evidence">
                              <summary>
                                查看服务商证据
                                <span aria-hidden="true">＋</span>
                              </summary>
                              <pre>
                                {JSON.stringify(review.evidence, null, 2)}
                              </pre>
                            </details>
                            <footer>
                              <button
                                className="button button-blue button-small"
                                onClick={() =>
                                  openReviewResolution(review, "credit")
                                }
                              >
                                核验并入账
                              </button>
                              <button
                                className="button button-ghost button-small"
                                onClick={() =>
                                  openReviewResolution(
                                    review,
                                    "refund_confirmed",
                                  )
                                }
                              >
                                确认已退款
                              </button>
                              <button
                                className="button admin-button-danger-ghost button-small"
                                onClick={() =>
                                  openReviewResolution(review, "reject")
                                }
                              >
                                拒绝案件
                              </button>
                            </footer>
                          </article>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="admin-empty">
                      <strong>当前没有待处理的支付复核案件</strong>
                      <p>
                        支付事件尚未产生需要人工判断的异常，或案件已全部结案。
                      </p>
                    </div>
                  )
                ) : null}
              </StatePanel>
            </div>

            <div className="admin-payment-records-head">
              <span className="admin-index">02</span>
              <div>
                <h3>原始支付单</h3>
                <p>用于对照充值单金额、链上地址、服务商编号与当前状态。</p>
              </div>
            </div>
            <form
              className="admin-toolbar admin-toolbar-wide admin-payment-recovery"
              onSubmit={recoverPayment}
            >
              <label>
                <span>RelayBase 订单编号</span>
                <input
                  value={recoveryOrderId}
                  onChange={(event) =>
                    setRecoveryOrderId(event.target.value)
                  }
                  placeholder="pay_..."
                  maxLength={180}
                  autoComplete="off"
                />
              </label>
              <label>
                <span>支付服务商编号</span>
                <input
                  value={recoveryPaymentId}
                  onChange={(event) =>
                    setRecoveryPaymentId(event.target.value)
                  }
                  placeholder="NOWPayments payment_id"
                  maxLength={128}
                  autoComplete="off"
                />
              </label>
              <p>
                仅用于服务商已创建、但本地尚未绑定的订单；服务端会重新查询并核验全部金额与币种。
              </p>
              <button
                className="button button-blue button-small"
                type="submit"
                disabled={
                  recoveringPayment ||
                  !recoveryOrderId.trim() ||
                  !recoveryPaymentId.trim()
                }
              >
                {recoveringPayment ? "核验中…" : "核验并恢复"}
              </button>
            </form>
            <StatePanel
              state={payments}
              label="原始支付单"
              onRetry={() => void loadPayments()}
            >
              {payments.status === "ready" ? (
                <>
                  <div className="admin-toolbar">
                    <label>
                      <span>支付状态</span>
                      <select
                        value={paymentFilter}
                        onChange={(event) =>
                          setPaymentFilter(event.target.value)
                        }
                      >
                        <option value="manual_review">需要人工复核</option>
                        <option value="all">全部状态</option>
                        {paymentStatuses
                          .filter((status) => status !== "manual_review")
                          .map((status) => (
                            <option value={status} key={status}>
                              {paymentStatusLabel(status)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <p>
                      显示 <strong>{visiblePayments.length}</strong> /{" "}
                      {payments.data.count} 笔
                    </p>
                  </div>
                  {visiblePayments.length ? (
                    <div className="admin-table-wrap admin-saas-table-wrap">
                      <table className="admin-table admin-saas-table">
                        <thead>
                          <tr>
                            <th>状态</th>
                            <th>用户</th>
                            <th>订单 / 服务商</th>
                            <th>订单金额</th>
                            <th>链上应付</th>
                            <th>已入账</th>
                            <th>更新时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visiblePayments.map((payment) => (
                            <tr key={payment.id}>
                              <td>
                                <span
                                  className={`admin-payment-status is-${paymentStatusClass(
                                    payment.status,
                                  )}`}
                                >
                                  {paymentStatusLabel(payment.status)}
                                </span>
                                {payment.status === "manual_review" ? (
                                  <small>需要人工处理</small>
                                ) : null}
                              </td>
                              <td>
                                <strong>{payment.userEmail}</strong>
                              </td>
                              <td>
                                <code title={payment.id}>{payment.id}</code>
                                <small>
                                  {payment.providerPaymentId ?? "尚未绑定服务商编号"}
                                </small>
                                {payment.payAddress ? (
                                  <small title={payment.payAddress}>
                                    地址 {payment.payAddress}
                                  </small>
                                ) : null}
                              </td>
                              <td>
                                <strong>
                                  {formatUsd(payment.amountUsdMicros)}
                                </strong>
                              </td>
                              <td>
                                <strong>
                                  {payment.payAmount ?? "—"}{" "}
                                  {payment.payCurrency.toUpperCase()}
                                </strong>
                              </td>
                              <td>
                                <strong>
                                  {formatUsd(payment.creditedUsdMicros)}
                                </strong>
                              </td>
                              <td>{formatDate(payment.updatedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="admin-empty">
                      <strong>
                        {paymentFilter === "manual_review"
                          ? "当前没有待人工复核的支付"
                          : "没有符合条件的支付记录"}
                      </strong>
                      <p>
                        {paymentFilter === "manual_review"
                          ? "支付通道没有需要人工介入的异常订单。"
                          : "切换状态筛选以查看其他支付记录。"}
                      </p>
                    </div>
                  )}
                </>
              ) : null}
            </StatePanel>
          </section>
            ) : null}
          </div>
        </div>
      </div>

      {routeBatchConfirmOpen ? (
        <ConfirmDialog
          busy={confirmingRouteBatch}
          title="批量确认添加到前台？"
          description={`将 ${selectedConfirmableEndpoints.length} 个已通过最新同步、成本和安全基础校验的接口添加到前台目录。完成后，后端仍会独立计算实际运行可用性。`}
          confirmLabel={`确认添加 ${selectedConfirmableEndpoints.length} 项`}
          onCancel={() => {
            if (!confirmingRouteBatch) setRouteBatchConfirmOpen(false);
          }}
          onConfirm={() => void confirmSelectedRoutes()}
        />
      ) : null}
      {confirmAction ? (
        <ConfirmDialog
          busy={mutating}
          danger={
            (confirmAction.kind === "user" &&
              confirmAction.nextStatus === "suspended") ||
            (confirmAction.kind === "endpoint" &&
              !confirmAction.nextEnabled) ||
            (confirmAction.kind === "credential" &&
              confirmAction.action === "revoke")
          }
          title={
            confirmAction.kind === "user"
              ? confirmAction.nextStatus === "suspended"
                ? "暂停该用户的 API 调用？"
                : "恢复该用户的 API 调用？"
              : confirmAction.kind === "endpoint"
                ? confirmAction.nextEnabled
                  ? "确认添加此接口到前台？"
                  : "从前台移除此接口？"
                : confirmAction.kind === "credential"
                  ? confirmAction.action === "activate"
                    ? "验证并切换上游数据源？"
                    : "撤销这个上游 API Key？"
                  : "从上游同步全部接口？"
          }
          description={
            confirmAction.kind === "user"
              ? confirmAction.nextStatus === "suspended"
                ? `${confirmAction.user.email} 的现有 API Key 将无法继续调用；账户余额和历史记录会保留。`
                : `${confirmAction.user.email} 的账户会恢复正常；暂停时撤销的 API Key 不会恢复，用户需要创建新 Key。`
              : confirmAction.kind === "endpoint"
                ? confirmAction.nextEnabled
                  ? `将 ${confirmAction.endpoint.path} 标记为只读已复核并添加到前台目录；实际可用性仍由后端运行条件独立计算。`
                  : `${confirmAction.endpoint.path} 将从前台目录移除并停止接受新调用，历史账单不受影响。`
                : confirmAction.kind === "credential"
                  ? confirmAction.action === "activate"
                    ? `服务端会先向上游验证 ${confirmAction.credential.label}，成功后用版本比较切换唯一活动凭据。`
                    : confirmAction.credential.status === "active"
                      ? `撤销 ${confirmAction.credential.label} 后托管模式会保持开启，但数据调用和目录同步将安全关闭，直到启用另一个 Key。`
                      : `${confirmAction.credential.label} 将永久标记为已撤销，不能再次启用。`
                  : "同步会读取上游当前目录。新接口默认下架，价格变化的已上架接口会自动下架等待复核，客户价不会被静默覆盖。"
          }
          confirmLabel={
            confirmAction.kind === "user"
              ? confirmAction.nextStatus === "suspended"
                ? "确认暂停"
                : "确认恢复"
              : confirmAction.kind === "endpoint"
                ? confirmAction.nextEnabled
                  ? "确认添加"
                  : "确认移除"
                : confirmAction.kind === "credential"
                  ? confirmAction.action === "activate"
                    ? "验证并切换"
                    : "确认撤销"
                  : "开始同步"
          }
          onCancel={() => {
            if (!mutating) setConfirmAction(null);
          }}
          onConfirm={() => void runConfirmedAction()}
        />
      ) : null}
      {reviewResolution ? (
        <PaymentReviewDialog
          review={reviewResolution.review}
          action={reviewResolution.action}
          creditAmount={reviewCreditAmount}
          note={reviewNote}
          busy={resolvingReview}
          onCreditAmountChange={setReviewCreditAmount}
          onNoteChange={setReviewNote}
          onCancel={() => {
            if (!resolvingReview) {
              setReviewResolution(null);
              setReviewCreditAmount("");
              setReviewNote("");
            }
          }}
          onConfirm={() => void resolvePaymentReview()}
        />
      ) : null}
    </main>
  );
}
