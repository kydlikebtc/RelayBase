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
type CatalogView = "routes" | "add" | "pricing" | "consistency";
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
  priceVerified: boolean;
  enabled: boolean;
  readOnly: boolean;
  safetyClassification: CatalogSafetyClassification;
  safetyReasons: string[];
  safetyPolicyVersion: number;
  revision: number;
  sourceUpdatedAt: string | null;
  presentInLatestSync: boolean;
  reviewedAt: string | null;
  updatedAt: string;
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
  scopeCount: number;
  expiresAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type UpstreamCredentialsResponse = {
  credentials: UpstreamCredential[];
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

const SESSION_SECRET_KEY = "relaybase.admin.master-secret.v1";
const CATALOG_SAFETY_POLICY_VERSION = 1;
const PENDING_CATALOG_PAGE_SIZE = 50;
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

function isCatalogEndpoint(value: unknown): value is CatalogEndpoint {
  if (!isObject(value)) return false;
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
  return (
    isNonEmptyString(value.id, 100) &&
    /^upc_[A-Za-z0-9_-]{16,80}$/.test(value.id) &&
    isNonEmptyString(value.label, 80) &&
    isNonEmptyString(value.fingerprint, 32) &&
    /^[a-f0-9]{16}$/.test(value.fingerprint) &&
    (value.status === "active" ||
      value.status === "standby" ||
      value.status === "revoked") &&
    isSafeNonNegativeInteger(value.scopeCount) &&
    value.scopeCount <= 500 &&
    isNullableDateString(value.expiresAt) &&
    isNullableDateString(value.verifiedAt) &&
    isDateString(value.createdAt) &&
    isNullableDateString(value.lastUsedAt) &&
    isNullableDateString(value.revokedAt)
  );
}

function isUpstreamCredentialsResponse(
  value: unknown,
): value is UpstreamCredentialsResponse {
  if (!isObject(value) || !Array.isArray(value.credentials)) return false;
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
      Authorization: `Bearer ${secret}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    let message =
      response.status === 401
        ? "管理员密钥无效，或服务端尚未配置主密钥。"
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

export function AdminClient() {
  const restoredSecret = useRef(false);
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
  const [rememberForTab, setRememberForTab] = useState(false);
  const [checkingSecret, setCheckingSecret] = useState(false);
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
  const [activateUpstreamAfterSave, setActivateUpstreamAfterSave] =
    useState(true);
  const [savingUpstreamCredential, setSavingUpstreamCredential] =
    useState(false);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [savingPath, setSavingPath] = useState("");
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
    async (secret: string, persistForTab: boolean) => {
      if (secret.length < 32 || secret.length > 512) {
        setAuthError("管理员密钥长度不符合安全要求。");
        return;
      }
      setCheckingSecret(true);
      setAuthError("");
      setOverview({ status: "loading" });

      try {
        const data = await adminRequest(
          "/api/admin/overview",
          secret,
          isOverviewResponse,
        );
        if (persistForTab) {
          sessionStorage.setItem(SESSION_SECRET_KEY, secret);
        } else {
          sessionStorage.removeItem(SESSION_SECRET_KEY);
        }
        setAdminSecret(secret);
        setSecretInput("");
        setOverview({ status: "ready", data });
        setRememberForTab(persistForTab);
        void loadUsers(secret);
        void loadUpstreamConfig(secret);
        void loadUpstreamCredentials(secret);
        void loadCatalog(secret);
        void loadPendingCatalog(secret);
        void loadPayments(secret);
        void loadPaymentReviews(secret);
      } catch (error) {
        sessionStorage.removeItem(SESSION_SECRET_KEY);
        setOverview({ status: "idle" });
        setAuthError(
          error instanceof Error ? error.message : "管理员身份验证失败。",
        );
      } finally {
        setCheckingSecret(false);
      }
    },
    [
      loadCatalog,
      loadPendingCatalog,
      loadPaymentReviews,
      loadPayments,
      loadUpstreamConfig,
      loadUpstreamCredentials,
      loadUsers,
    ],
  );

  useEffect(() => {
    if (restoredSecret.current) return;
    restoredSecret.current = true;
    const savedSecret = sessionStorage.getItem(SESSION_SECRET_KEY);
    if (!savedSecret) return;
    const restoreTimer = window.setTimeout(() => {
      void authenticate(savedSecret, true);
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, [authenticate]);

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

  function signOut() {
    sessionStorage.removeItem(SESSION_SECRET_KEY);
    setAdminSecret("");
    setSecretInput("");
    setRememberForTab(false);
    setAuthError("");
    setNotice("");
    setUpstreamApiKey("");
    setPendingCatalogQuery("");
    setPendingCatalogPage(0);
    setPendingPriceDrafts({});
    setSavingPendingPath("");
    setUpstreamConfigDraft({ ...EMPTY_UPSTREAM_CONFIG_DRAFT });
    setSavingUpstreamConfig(false);
    setSavingUpstreamCredential(false);
    setConfirmAction(null);
    setCatalogBatch(null);
    setCatalogBatchRequest(null);
    setCatalogBatchConfirmation("");
    setCatalogBatchError("");
    setPreviewingCatalogBatch(false);
    setRefreshingCatalogBatch(false);
    setApplyingCatalogBatch(false);
    catalogBatchPreviewRetry.current = null;
    catalogBatchApplyRetry.current = null;
    setOverview({ status: "idle" });
    setUsers({ status: "idle" });
    setUpstreamConfig({ status: "idle" });
    setUpstreamCredentials({ status: "idle" });
    setCatalog({ status: "idle" });
    setPendingCatalog({ status: "idle" });
    setPayments({ status: "idle" });
    setPaymentReviews({ status: "idle" });
    setReviewResolution(null);
  }

  function submitSecret(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void authenticate(secretInput, rememberForTab);
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
            ? `已上架 ${endpoint.path}。`
            : `已下架 ${endpoint.path}，新请求将无法调用。`,
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
            查看实际用户与调用数据，维护上游路由、成本、客户价和支付复核队列。
          </p>
          <form onSubmit={submitSecret}>
            <label htmlFor="admin-secret">管理员主密钥</label>
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
              placeholder="输入 ADMIN_MASTER_SECRET"
            />
            <label className="admin-memory-option">
              <input
                type="checkbox"
                checked={rememberForTab}
                onChange={(event) => setRememberForTab(event.target.checked)}
              />
              <span>
                在本标签页会话中记住
                <small>关闭标签页后由浏览器清除</small>
              </span>
            </label>
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
              {checkingSecret ? "正在验证…" : "进入管理后台"}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <aside className="admin-security-note">
            <strong>密钥存储说明</strong>
            <p>
              默认仅保存在当前页面的 React
              内存，不写入 Cookie、localStorage 或数据库。勾选后只写入当前标签页的
              sessionStorage，并仅作为同源管理接口的 Bearer 凭证发送。
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
  const pendingCatalogCount =
    pendingCatalog.status === "ready" ? pendingCatalog.data.total : 0;
  const publishedRouteCount =
    catalogData?.endpoints.filter((endpoint) => endpoint.enabled).length ?? 0;
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
            <button className="button button-ghost button-small" onClick={signOut}>
              锁定后台
            </button>
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
                      <span>近 30 日收入</span>
                      <strong>
                        {formatUsd(
                          overviewData.summary.grossRevenueUsdMicros,
                        )}
                      </strong>
                      <small>客户实际扣费</small>
                    </article>
                    <article>
                      <span>近 30 日上游成本</span>
                      <strong>
                        {formatUsd(
                          overviewData.summary.upstreamCostUsdMicros,
                        )}
                      </strong>
                      <small>同步自实际调用快照</small>
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
                        待支付复核{" "}
                        {overviewData.summary.manualReviewPayments.toLocaleString()}{" "}
                        笔
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
                onClick={() => void loadUsers()}
              >
                刷新用户
              </button>
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
                          这里展示运行时实际选择的来源和全部托管凭据。活动凭据变更会触发目录重新验证，
                          不会静默沿用旧的发布结果。
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
                    </div>
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
                    <div className="admin-table-wrap admin-saas-table-wrap">
                      <table className="admin-table admin-saas-table">
                        <thead>
                          <tr>
                            <th>数据源凭据</th>
                            <th>状态</th>
                            <th>授权范围</th>
                            <th>最近验证</th>
                            <th>最近调用</th>
                            <th>到期时间</th>
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
                                  <span
                                    className={`admin-account-status is-${credential.status}`}
                                  >
                                    {credential.status === "active"
                                      ? "活动"
                                      : credential.status === "standby"
                                        ? "备用"
                                        : "已撤销"}
                                  </span>
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
                                <td>{formatDate(credential.verifiedAt)}</td>
                                <td>{formatDate(credential.lastUsedAt)}</td>
                                <td>
                                  {credential.expiresAt
                                    ? formatDate(credential.expiresAt)
                                    : "不设到期"}
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
                  市场展示与 /v1 实际可调用目录共同读取这里的已发布结果。
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
                <button
                  className="button button-dark button-small"
                  onClick={() => setConfirmAction({ kind: "sync" })}
                >
                  同步上游
                </button>
              </div>
            </div>
            <div className="admin-module-summary" aria-label="路由目录摘要">
              <article className="is-success">
                <span>已上架路由</span>
                <strong>{publishedRouteCount.toLocaleString()}</strong>
                <small>市场可见且 /v1 可调用</small>
              </article>
              <article>
                <span>待审核 / 已下架</span>
                <strong>{reviewRouteCount.toLocaleString()}</strong>
                <small>仅后台可见，不进入公开运行目录</small>
              </article>
              <article className={pendingCatalogCount ? "is-warning" : ""}>
                <span>文档待同步</span>
                <strong>{pendingCatalogCount.toLocaleString()}</strong>
                <small>缺少方法或契约，严格不可调用</small>
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
                  ["add", "添加 / 同步", "发现并补齐新的候选服务"],
                  ["pricing", "定价发布", "批量定价、审核与上下架"],
                  ["consistency", "一致性证明", "核对快照、覆盖率与代次"],
                ] as const
              ).map(([id, label, description]) => (
                <button
                  type="button"
                  key={id}
                  className={catalogView === id ? "is-active" : ""}
                  aria-current={catalogView === id ? "page" : undefined}
                  onClick={() => setCatalogView(id)}
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
                  <strong>一个发布状态，三处同时生效</strong>
                  <p>
                    “已上架”同时代表数据市场可见、公开目录存在且 /v1 可调用；
                    待同步、待复核和已下架记录只留在运营后台。
                  </p>
                </div>
              </div>
              <dl>
                <div>
                  <dt>市场展示</dt>
                  <dd>{publishedRouteCount.toLocaleString()} 条</dd>
                </div>
                <div>
                  <dt>/v1 运行目录</dt>
                  <dd>{publishedRouteCount.toLocaleString()} 条</dd>
                </div>
                <div>
                  <dt>阻断状态</dt>
                  <dd>{(reviewRouteCount + pendingCatalogCount).toLocaleString()} 条</dd>
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
                      调用契约补齐、定价与安全审核后才能上架。
                    </p>
                  </div>
                  <button
                    className="button button-dark button-small"
                    type="button"
                    onClick={() => setConfirmAction({ kind: "sync" })}
                  >
                    立即同步上游
                  </button>
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
                            : "按平台、数据类型、入口、状态和安全分类核对当前目录；此视图不修改价格或发布状态。"}
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
                            onChange={(event) =>
                              setCatalogQuery(event.target.value)
                            }
                            placeholder="平台、标签、operationId、摘要或 /v1/ 路径"
                          />
                        </label>
                        <label>
                          <span>平台</span>
                          <select
                            value={catalogPlatform}
                            onChange={(event) =>
                              setCatalogPlatform(event.target.value)
                            }
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
                          <span>上架状态</span>
                          <select
                            value={catalogStatus}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (isCatalogFilterStatus(value)) {
                                setCatalogStatus(value);
                              }
                            }}
                          >
                            <option value="all">全部状态</option>
                            <option value="enabled">已上架</option>
                            <option value="disabled">已下架</option>
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
                            {catalogDataType !== "all" ||
                            catalogTag !== null ||
                            catalogSurface !== "all"
                              ? " · 已启用"
                              : ""}
                          </summary>
                          <div>
                            <label>
                              <span>数据类型</span>
                              <select
                                value={catalogDataType}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  if (
                                    value === "all" ||
                                    isCatalogDataType(value)
                                  ) {
                                    setCatalogDataType(value);
                                  }
                                }}
                              >
                                <option value="all">全部数据类型</option>
                                {catalogDataTypes.map((dataType) => (
                                  <option value={dataType} key={dataType}>
                                    {catalogDataTypeLabel(dataType)} · {dataType}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span>标签</span>
                              <select
                                value={catalogTag ?? ""}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  if (value === "") {
                                    setCatalogTag(null);
                                  } else if (isCatalogTag(value)) {
                                    setCatalogTag(value);
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
                                  }
                                }}
                              >
                                <option value="all">全部入口</option>
                                {catalogSurfaces.map((surface) => (
                                  <option value={surface} key={surface}>
                                    {catalogSurfaceLabel(surface)} · {surface}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </details>
                        <p>
                          本地显示{" "}
                          <strong>{visibleEndpoints.length}</strong> /{" "}
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
                  {visibleEndpoints.length ? (
                    <div className="admin-table-wrap admin-route-list-wrap">
                      <table className="admin-table admin-route-list">
                        <thead>
                          <tr>
                            <th>路由</th>
                            <th>平台 / 分类</th>
                            <th>成本</th>
                            <th>客户价</th>
                            <th>毛利</th>
                            <th>校验</th>
                            <th>状态</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleEndpoints.map((endpoint) => {
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
                                    </div>
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
                                    {formatUsd(
                                      endpoint.upstreamPriceUsdMicros,
                                      6,
                                    )}
                                  </strong>
                                  <small>/ 次</small>
                                </td>
                                <td>
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
                                    <strong>
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
                                <td>
                                  <strong
                                    className={
                                      margin < 0
                                        ? "is-negative-balance"
                                        : undefined
                                    }
                                  >
                                    {formatUsd(margin, 6)}
                                  </strong>
                                </td>
                                <td>
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
                                </td>
                                <td>
                                  <span
                                    className={`admin-account-status ${
                                      endpoint.enabled
                                        ? "is-active"
                                        : "is-suspended"
                                    }`}
                                  >
                                    {endpoint.enabled ? "已上架" : "已下架"}
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
                                      {endpoint.enabled ? "下架" : "审核上架"}
                                    </button>
                                  ) : (
                                    <button
                                      className="button button-ghost button-small"
                                      type="button"
                                      onClick={() => setCatalogView("pricing")}
                                    >
                                      管理
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="admin-empty">
                      <strong>没有符合条件的接口</strong>
                      <p>
                        调整筛选条件，或从上游同步最新端点目录。
                      </p>
                    </div>
                  )}
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
                  void Promise.all([loadPaymentReviews(), loadPayments()])
                }
              >
                刷新支付
              </button>
            </div>
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
                  ? "审核并上架此接口？"
                  : "下架此接口？"
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
                  ? `将 ${confirmAction.endpoint.path} 标记为只读已复核并按当前客户价上架。`
                  : `${confirmAction.endpoint.path} 将立即停止接受新调用，历史账单不受影响。`
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
                  ? "确认上架"
                  : "确认下架"
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
