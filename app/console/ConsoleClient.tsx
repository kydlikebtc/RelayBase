"use client";

import type { FormEvent, MouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatGPTUser } from "../chatgpt-auth";
import type { Locale } from "../locale";
import { platformDisplayName } from "../platform-names";

type ApiKeyRecord = {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type PaymentRecord = {
  id: string;
  amountUsdMicros: number;
  payCurrency: string;
  payAmount: string | null;
  payAddress: string | null;
  invoiceUrl: string | null;
  status: string;
  creditedUsdMicros: number;
  reversedUsdMicros: number;
  reviewReason: string | null;
  reviewStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

type CallRecord = {
  id: string;
  method: string;
  path: string;
  platform: string;
  statusCode: number;
  costUsdMicros: number;
  refunded: boolean;
  latencyMs: number;
  createdAt: string;
};

type DashboardData = {
  user: {
    email: string;
    displayName: string;
  };
  balanceUsdMicros: number;
  capabilities: {
    databaseConfigured: boolean;
    configurationValid: boolean;
    legalReviewConfirmed: boolean;
    resellerAuthorized: boolean;
    commercialClearanceConfirmed: boolean;
    proxyEnabled: boolean;
    paymentsEnabled: boolean;
    adminConfigured: boolean;
    authenticationConfigured: boolean;
    productionAuthenticationConfigured: boolean;
    googleAuthenticationConfigured: boolean;
    walletAuthenticationConfigured: boolean;
    trustedSitesIdentityConfigured: boolean;
    schemaReady: boolean;
    taxonomyReady: boolean;
    catalogReady: boolean;
  };
  stats: {
    calls30d: number;
    spend30dUsdMicros: number;
    successRate: number;
  };
  keys: ApiKeyRecord[];
  payments: PaymentRecord[];
  calls: CallRecord[];
};

type CreatedKey = {
  id: string;
  label: string;
  prefix: string;
  secret: string;
  createdAt: string;
};

type PaymentInvoice = {
  id: string;
  status: string;
  payAddress: string | null;
  payAmount: number | string | null;
  payCurrency: string;
  invoiceUrl: string | null;
};

type ApiErrorShape = {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
};

type JsonRecord = Record<string, unknown>;

type SessionUser = {
  displayName: string;
  email: string | null;
  walletAddress: string | null;
  provider: string;
};

type AuthMeResponse = {
  user: SessionUser;
};

const amountOptions = [10, 25, 50, 100] as const;
const currencyOptions = [
  { value: "usdttrc20", label: "USDT · TRC20" },
  { value: "usdterc20", label: "USDT · ERC20" },
  { value: "usdcbase", label: "USDC · Base" },
] as const;

const consoleCopy = {
  en: {
    requestFailed: (status: number) => `Request failed (HTTP ${status})`,
    sessionExpired: "Your session has expired. Sign in again.",
    emptyResponse: "The service returned an empty response. Try again shortly.",
    invalidDashboard:
      "The console returned an invalid data shape. Refresh and contact support if it continues.",
    never: "Never",
    dashboardLoadFailed: "The console could not load account data.",
    sessionCheckFailed: (status: number) =>
      `Session check failed (HTTP ${status}).`,
    invalidSession: "The sign-in session returned unverifiable data.",
    sessionUnknown: "The current sign-in state could not be confirmed.",
    keyCreated:
      "API Key created. Copy it now; the full secret will not be shown again.",
    keyCreateFailed: "API Key creation failed.",
    revokeConfirm: (label: string) =>
      `Revoke “${label}”? Requests using this Key will fail immediately.`,
    keyRevoked: (label: string) => `“${label}” was revoked.`,
    keyRevokeFailed: "API Key revocation failed.",
    invoiceCreated:
      "Top-up order created. Pay the exact asset, network and amount shown.",
    invoiceCreateFailed: "Top-up order creation failed.",
    signoutFailed: (status: number) => `Sign out failed (HTTP ${status}).`,
    invalidSignout: "The sign-out service returned an invalid response.",
    signoutFallback: "Sign out failed.",
    copyFailed: "Copy failed. Select and copy the value manually.",
    checkingAccount: "Checking account",
    signedOutUser: "Signed-out user",
    console: "Console",
    syncAfterLogin: "Sign in to sync account data",
    signingOut: "Signing out",
    signOut: "Sign out",
    checking: "Checking",
    signIn: "Sign in",
    checkingSessionTitle: "Confirming your sign-in session.",
    checkingSessionBody:
      "The console will load the matching account as soon as the session check completes.",
    loginTitle: "Sign in to load balance, Keys and the request ledger.",
    loginBody:
      "Use Google, an EVM wallet or a ChatGPT-managed identity. Signing in does not top up your balance or expose source credentials to the browser.",
    chooseLogin: "Choose a sign-in method",
    retry: "Retry",
    closeNotice: "Close notification",
    accountOverview: "Account overview",
    availableBalance: "Available balance",
    calls30d: "30-day calls",
    spend30d: "30-day spend",
    successRate: "Success rate",
    newKeyLabel: "New Key name",
    keyPlaceholder: "For example: Production",
    creating: "Creating…",
    createKey: "＋ Create Key",
    showOnce: "Shown once",
    closeNewKey: "Close new Key notice",
    saveSecret:
      "Copy it now and store it in a server-side secret manager. The full value cannot be viewed again.",
    keyCopied: "API Key copied.",
    copy: "Copy",
    loadingKeys: "Loading Keys…",
    created: "Created",
    used: "Used",
    revoking: "Revoking…",
    revoke: "Revoke",
    noKeys: "No API Keys yet.",
    loginForKeys: "Sign in to manage API Keys.",
    topupTitle: "Balance top-up",
    topupAmount: "Top-up amount (USD)",
    assetNetwork: "Payment asset / network",
    creatingInvoice: "Creating top-up order…",
    topup: (amount: number) => `Top up $${amount}`,
    clearanceClosed:
      "Live top-ups are unavailable until the required payment-method clarification is recorded.",
    topupUnavailable:
      "Top-ups are not available yet and will open when proxy, merchant and compliance readiness are complete.",
    topupSafety:
      "Send funds only to the network and address shown on the order. Balance changes after on-chain confirmation.",
    invoiceTitle: "Top-up order created",
    closeInvoice: "Close top-up order",
    amountDue: "Amount due",
    receivingAddress: "Receiving address",
    addressPending: "Waiting for the payment service to generate an address",
    addressCopied: "Payment address copied.",
    copyAddress: "Copy address",
    currentStatus: "Current status",
    balanceAutoUpdate: "Balance updates automatically after confirmation",
    openInvoice: "Open full top-up order ↗",
    recentRequests: "Recent requests",
    apiDocs: "API docs ↗",
    time: "Time",
    request: "Request",
    platform: "Platform",
    status: "Status",
    latency: "Latency",
    cost: "Cost",
    refunded: "Refunded",
    noRequestsUser:
      "Create a Key and send your first request. Status, latency and cost will appear here.",
    noRequestsGuest: "Sign in to view real request records.",
    quickstart: "View quickstart →",
    consoleLogin: "Sign in to console →",
    recentTopups: "Recent top-ups",
    refreshing: "Refreshing…",
    refreshStatus: "Refresh status ↻",
    credited: "Credited",
    reversed: "Reversed",
    continuePayment: "Continue payment",
    noTopups: "No top-up records yet.",
    loginForTopups: "Sign in to view top-up status.",
  },
  zh: {
    requestFailed: (status: number) => `请求失败（HTTP ${status}）`,
    sessionExpired: "登录状态已失效，请重新登录。",
    emptyResponse: "服务返回了空响应，请稍后重试。",
    invalidDashboard: "控制台数据格式异常，请刷新重试；若问题持续存在，请联系支持。",
    never: "从未",
    dashboardLoadFailed: "控制台数据加载失败。",
    sessionCheckFailed: (status: number) => `会话检查失败（HTTP ${status}）。`,
    invalidSession: "登录会话返回了无法验证的数据。",
    sessionUnknown: "无法确认当前登录状态。",
    keyCreated: "API Key 已创建。请立即复制，密钥不会再次完整显示。",
    keyCreateFailed: "密钥创建失败。",
    revokeConfirm: (label: string) =>
      `确定撤销“${label}”吗？使用该密钥的请求将立即失败。`,
    keyRevoked: (label: string) => `“${label}”已撤销。`,
    keyRevokeFailed: "密钥撤销失败。",
    invoiceCreated: "充值单已创建，请严格按指定币种、网络和数量支付。",
    invoiceCreateFailed: "充值单创建失败。",
    signoutFailed: (status: number) => `退出失败（HTTP ${status}）。`,
    invalidSignout: "退出接口返回了无法验证的数据。",
    signoutFallback: "退出失败。",
    copyFailed: "复制失败，请手动选择并复制。",
    checkingAccount: "正在确认账户",
    signedOutUser: "未登录用户",
    console: "控制台",
    syncAfterLogin: "登录后同步账户数据",
    signingOut: "退出中",
    signOut: "退出",
    checking: "检查中",
    signIn: "登录",
    checkingSessionTitle: "正在确认你的登录会话。",
    checkingSessionBody: "会话检查完成后，控制台会自动加载对应账户的数据。",
    loginTitle: "登录后加载你的余额、密钥和请求账本。",
    loginBody:
      "支持 Google、EVM 钱包与 ChatGPT 托管身份。登录不会自动充值，也不会向浏览器暴露任何来源凭据。",
    chooseLogin: "选择登录方式",
    retry: "重试",
    closeNotice: "关闭提示",
    accountOverview: "账户概览",
    availableBalance: "可用余额",
    calls30d: "30 天调用",
    spend30d: "30 天支出",
    successRate: "成功率",
    newKeyLabel: "新密钥名称",
    keyPlaceholder: "例如：Production",
    creating: "创建中…",
    createKey: "＋ 创建 Key",
    showOnce: "只显示这一次",
    closeNewKey: "关闭新密钥提示",
    saveSecret: "立即复制并保存到服务端密钥管理工具。离开后无法再次查看完整值。",
    keyCopied: "API Key 已复制。",
    copy: "复制",
    loadingKeys: "正在加载密钥…",
    created: "创建",
    used: "使用",
    revoking: "撤销中…",
    revoke: "撤销",
    noKeys: "还没有 API Key。",
    loginForKeys: "登录后管理你的 API Key。",
    topupTitle: "余额充值",
    topupAmount: "充值金额（USD）",
    assetNetwork: "支付币种 / 网络",
    creatingInvoice: "正在创建充值单…",
    topup: (amount: number) => `充值 $${amount}`,
    clearanceClosed:
      "真实充值尚未开放：仍需归档稳定币仅作为 API 付款方式的书面澄清。",
    topupUnavailable:
      "当前充值功能尚未开放，将在数据代理、商户与合规条件全部就绪后启用。",
    topupSafety: "只向充值单指定的网络和地址转账。链上确认前，余额不会改变。",
    invoiceTitle: "充值单已创建",
    closeInvoice: "关闭充值单",
    amountDue: "应付数量",
    receivingAddress: "收款地址",
    addressPending: "等待支付服务生成地址",
    addressCopied: "支付地址已复制。",
    copyAddress: "复制地址",
    currentStatus: "当前状态",
    balanceAutoUpdate: "到账后自动更新余额",
    openInvoice: "打开完整充值单 ↗",
    recentRequests: "最近请求",
    apiDocs: "API 文档 ↗",
    time: "时间",
    request: "请求",
    platform: "平台",
    status: "状态",
    latency: "延迟",
    cost: "费用",
    refunded: "已退回",
    noRequestsUser: "创建 Key 并发出第一条请求后，状态、延迟与费用会出现在这里。",
    noRequestsGuest: "登录后查看真实的请求记录。",
    quickstart: "查看快速开始 →",
    consoleLogin: "登录控制台 →",
    recentTopups: "最近充值",
    refreshing: "刷新中…",
    refreshStatus: "刷新状态 ↻",
    credited: "已入账",
    reversed: "已冲销",
    continuePayment: "继续支付",
    noTopups: "暂无充值记录。",
    loginForTopups: "登录后查看充值状态。",
  },
} as const;

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function englishApiError(
  code: string | undefined,
  status: number,
): string {
  const messages: Record<string, string> = {
    authentication_required: "Sign in to continue.",
    invalid_api_key: "The API Key is invalid or has been revoked.",
    insufficient_balance: "The available balance is insufficient.",
    invalid_request: "The request is invalid.",
    invalid_payment: "The top-up request is invalid.",
    payments_not_enabled: "Top-ups are not currently available.",
    rate_limit_exceeded: "Too many requests. Try again shortly.",
    schema_not_ready: "Account storage is not ready. Try again shortly.",
    user_suspended: "This account is unavailable. Contact support.",
  };
  return (
    (code ? messages[code] : undefined) ??
    (status === 401
      ? consoleCopy.en.sessionExpired
      : consoleCopy.en.requestFailed(status))
  );
}

async function apiRequest<T>(
  url: string,
  locale: Locale,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & ApiErrorShape)
    | null;

  if (!response.ok) {
    const message =
      locale === "zh"
        ? (payload?.error?.message ??
          (response.status === 401
            ? consoleCopy.zh.sessionExpired
            : consoleCopy.zh.requestFailed(response.status)))
        : englishApiError(payload?.error?.code, response.status);
    throw new ApiRequestError(message, response.status);
  }

  if (!payload) {
    throw new Error(consoleCopy[locale].emptyResponse);
  }

  return payload;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isSessionUser(value: unknown): value is SessionUser {
  if (!isRecord(value)) return false;
  return (
    typeof value.displayName === "string" &&
    value.displayName.length > 0 &&
    value.displayName.length <= 320 &&
    (value.email === null ||
      (typeof value.email === "string" &&
        value.email.length > 0 &&
        value.email.length <= 320)) &&
    (value.walletAddress === null ||
      (typeof value.walletAddress === "string" &&
        /^0x[a-fA-F0-9]{40}$/.test(value.walletAddress))) &&
    typeof value.provider === "string" &&
    /^[a-z][a-z0-9_-]{0,31}$/.test(value.provider)
  );
}

function isAuthMeResponse(value: unknown): value is AuthMeResponse {
  return isRecord(value) && isSessionUser(value.user);
}

function isSignoutResponse(value: unknown): value is { ok: true } {
  return isRecord(value) && value.ok === true;
}

function isApiKeyRecord(value: unknown): value is ApiKeyRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.prefix === "string" &&
    typeof value.createdAt === "string" &&
    isNullableString(value.lastUsedAt) &&
    isNullableString(value.revokedAt)
  );
}

function isPaymentRecord(value: unknown): value is PaymentRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    isNonNegativeInteger(value.amountUsdMicros) &&
    typeof value.payCurrency === "string" &&
    isNullableString(value.payAmount) &&
    isNullableString(value.payAddress) &&
    isNullableString(value.invoiceUrl) &&
    typeof value.status === "string" &&
    isNonNegativeInteger(value.creditedUsdMicros) &&
    isNonNegativeInteger(value.reversedUsdMicros) &&
    isNullableString(value.reviewReason) &&
    isNullableString(value.reviewStatus) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isCallRecord(value: unknown): value is CallRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.method === "string" &&
    typeof value.path === "string" &&
    typeof value.platform === "string" &&
    isNonNegativeInteger(value.statusCode) &&
    isNonNegativeInteger(value.costUsdMicros) &&
    typeof value.refunded === "boolean" &&
    isNonNegativeInteger(value.latencyMs) &&
    typeof value.createdAt === "string"
  );
}

function isDashboardData(value: unknown): value is DashboardData {
  if (!isRecord(value)) return false;

  const { user, capabilities, stats, keys, payments, calls } = value;
  if (!isRecord(user) || !isRecord(capabilities) || !isRecord(stats)) {
    return false;
  }

  return (
    typeof user.email === "string" &&
    typeof user.displayName === "string" &&
    isFiniteNumber(value.balanceUsdMicros) &&
    typeof capabilities.databaseConfigured === "boolean" &&
    typeof capabilities.configurationValid === "boolean" &&
    typeof capabilities.legalReviewConfirmed === "boolean" &&
    typeof capabilities.resellerAuthorized === "boolean" &&
    typeof capabilities.commercialClearanceConfirmed === "boolean" &&
    typeof capabilities.proxyEnabled === "boolean" &&
    typeof capabilities.paymentsEnabled === "boolean" &&
    typeof capabilities.adminConfigured === "boolean" &&
    typeof capabilities.authenticationConfigured === "boolean" &&
    typeof capabilities.productionAuthenticationConfigured === "boolean" &&
    typeof capabilities.googleAuthenticationConfigured === "boolean" &&
    typeof capabilities.walletAuthenticationConfigured === "boolean" &&
    typeof capabilities.trustedSitesIdentityConfigured === "boolean" &&
    typeof capabilities.schemaReady === "boolean" &&
    typeof capabilities.taxonomyReady === "boolean" &&
    typeof capabilities.catalogReady === "boolean" &&
    isNonNegativeInteger(stats.calls30d) &&
    isNonNegativeInteger(stats.spend30dUsdMicros) &&
    isFiniteNumber(stats.successRate) &&
    stats.successRate >= 0 &&
    stats.successRate <= 1 &&
    Array.isArray(keys) &&
    keys.every(isApiKeyRecord) &&
    Array.isArray(payments) &&
    payments.every(isPaymentRecord) &&
    Array.isArray(calls) &&
    calls.every(isCallRecord)
  );
}

function parseDashboardData(value: unknown, locale: Locale): DashboardData {
  if (!isDashboardData(value)) {
    throw new Error(consoleCopy[locale].invalidDashboard);
  }
  return value;
}

function formatUsd(micros: number | null | undefined, digits = 2) {
  if (micros === null || micros === undefined) return "—";
  return `$${(micros / 1_000_000).toFixed(digits)}`;
}

function formatRate(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  const percent = value <= 1 ? value * 100 : value;
  return `${percent.toFixed(1)}%`;
}

function formatDate(
  value: string | null | undefined,
  locale: Locale,
  includeTime = false,
) {
  if (!value) return consoleCopy[locale].never;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function paymentStatus(status: string, locale: Locale) {
  const labels: Record<Locale, Record<string, string>> = {
    en: {
      pending: "Pending",
      waiting: "Awaiting payment",
      confirming: "Confirming",
      confirmed: "Confirmed",
      sending: "Crediting",
      partially_paid: "Underpaid",
      finished: "Credited",
      completed: "Credited",
      paid: "Credited",
      failed: "Failed",
      expired: "Expired",
      refunded: "Refunded",
      manual_review: "Manual review",
      manual_resolved: "Review resolved",
      provider_error: "Payment channel error",
      creating: "Creating",
    },
    zh: {
      pending: "待确认",
      waiting: "等待付款",
      confirming: "确认中",
      confirmed: "已确认",
      sending: "入账处理中",
      partially_paid: "金额不足",
      finished: "已到账",
      completed: "已到账",
      paid: "已到账",
      failed: "失败",
      expired: "已过期",
      refunded: "已退款",
      manual_review: "人工复核",
      manual_resolved: "复核已结案",
      provider_error: "通道异常",
      creating: "创建中",
    },
  };
  return labels[locale][status.toLowerCase()] ?? status;
}

function paymentStatusClass(status: string) {
  const normalized = status.toLowerCase().replace(/[^a-z_]/g, "");
  return normalized || "unknown";
}

function paymentReviewReason(reason: string | null, locale: Locale) {
  if (!reason) return null;
  const labels: Record<Locale, Record<string, string>> = {
    en: {
      orphan_payment: "Unmatched payment",
      order_mismatch: "Order mismatch",
      amount_mismatch: "Amount mismatch",
      currency_mismatch: "Asset mismatch",
      partial_payment: "Partial payment",
      paid_after_expiration: "Paid after expiration",
      terminal_status_conflict: "Final-status conflict",
      refund_requires_review: "Refund review",
      provider_payload_mismatch: "Payment-provider data mismatch",
      repeated_deposit: "Possible repeated payment",
      terminal_with_funds: "Funds on a finalized order",
      underpaid_finished: "Confirmed amount is insufficient",
      provider_data_mismatch: "Payment-provider data mismatch",
      partially_paid: "Partial payment",
      overpaid_finished: "Confirmed amount exceeds order",
      funds_after_manual_rejection: "Funds detected after rejection",
    },
    zh: {
      orphan_payment: "未绑定订单",
      order_mismatch: "订单绑定不一致",
      amount_mismatch: "付款金额不一致",
      currency_mismatch: "付款币种不一致",
      partial_payment: "付款金额不足",
      paid_after_expiration: "过期后付款",
      terminal_status_conflict: "终态冲突",
      refund_requires_review: "退款待复核",
      provider_payload_mismatch: "服务商数据不一致",
      repeated_deposit: "疑似重复付款",
      terminal_with_funds: "终态订单仍有到账",
      underpaid_finished: "到账金额不足",
      provider_data_mismatch: "服务商数据不一致",
      partially_paid: "部分付款",
      overpaid_finished: "到账金额超出订单",
      funds_after_manual_rejection: "拒绝结案后检测到资金",
    },
  };
  return (
    labels[locale][reason] ??
    (locale === "zh" ? "支付信息待复核" : "Payment details require review")
  );
}

function currencyLabel(currency: string) {
  return (
    currencyOptions.find((item) => item.value === currency)?.label ?? currency
  );
}

export function ConsoleClient({
  chatGPTUser,
  chatGPTSignOutPath,
  locale,
}: {
  chatGPTUser: ChatGPTUser | null;
  chatGPTSignOutPath: string;
  locale: Locale;
}) {
  const c = consoleCopy[locale];
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(() =>
    chatGPTUser
      ? {
          displayName: chatGPTUser.displayName,
          email: chatGPTUser.email,
          walletAddress: null,
          provider: "chatgpt",
        }
      : null,
  );
  const [authChecking, setAuthChecking] = useState(!chatGPTUser);
  const [signingOut, setSigningOut] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(Boolean(chatGPTUser));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [keyLabel, setKeyLabel] = useState("Production");
  const [creatingKey, setCreatingKey] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [amountUsd, setAmountUsd] =
    useState<(typeof amountOptions)[number]>(25);
  const [payCurrency, setPayCurrency] =
    useState<(typeof currencyOptions)[number]["value"]>("usdttrc20");
  const [creatingPayment, setCreatingPayment] = useState(false);
  const [invoice, setInvoice] = useState<PaymentInvoice | null>(null);
  const paymentAttemptKey = useRef<string | null>(null);
  const latestInvoicePayment = invoice
    ? dashboard?.payments.find((payment) => payment.id === invoice.id)
    : null;
  const visibleInvoice = invoice
    ? {
        ...invoice,
        status: latestInvoicePayment?.status ?? invoice.status,
        payAmount: latestInvoicePayment?.payAmount ?? invoice.payAmount,
        payAddress: latestInvoicePayment?.payAddress ?? invoice.payAddress,
        invoiceUrl: latestInvoicePayment?.invoiceUrl ?? invoice.invoiceUrl,
      }
    : null;
  const visibleInvoiceId = visibleInvoice?.id ?? null;
  const visibleInvoiceStatus = visibleInvoice?.status ?? null;
  const user = sessionUser;
  const loginPath = "/login?return_to=%2Fconsole";

  const refreshDashboard = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const payload = await apiRequest<unknown>(
        "/api/dashboard",
        locale,
        { cache: "no-store" },
      );
      const data = parseDashboardData(payload, locale);
      setDashboard(data);
    } catch (requestError) {
      if (requestError instanceof ApiRequestError && requestError.status === 401) {
        setDashboard(null);
        if (user?.provider !== "chatgpt") {
          setSessionUser(null);
        }
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : c.dashboardLoadFailed,
      );
    } finally {
      setLoading(false);
    }
  }, [c.dashboardLoadFailed, locale, user]);

  useEffect(() => {
    if (chatGPTUser) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setAuthChecking(true);
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const payload: unknown = await response.json().catch(() => null);
        if (response.status === 401) {
          setSessionUser(null);
          return;
        }
        if (!response.ok) {
          throw new Error(c.sessionCheckFailed(response.status));
        }
        if (!isAuthMeResponse(payload)) {
          throw new Error(c.invalidSession);
        }
        setSessionUser(payload.user);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setSessionUser(null);
        setError(
          requestError instanceof Error
            ? requestError.message
            : c.sessionUnknown,
        );
      } finally {
        if (!controller.signal.aborted) setAuthChecking(false);
      }
    }, 0);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [c, chatGPTUser]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshDashboard();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshDashboard]);

  useEffect(() => {
    if (
      !user ||
      !visibleInvoiceId ||
      !visibleInvoiceStatus ||
      [
        "finished",
        "failed",
        "expired",
        "refunded",
        "manual_review",
        "manual_resolved",
      ].includes(
        visibleInvoiceStatus.toLowerCase(),
      )
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshDashboard();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [
    refreshDashboard,
    user,
    visibleInvoiceId,
    visibleInvoiceStatus,
  ]);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = keyLabel.trim();
    if (!label || !user) return;

    setCreatingKey(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiRequest<{ key: CreatedKey }>(
        "/api/keys",
        locale,
        {
          method: "POST",
          body: JSON.stringify({ label }),
        },
      );
      setCreatedKey(result.key);
      setKeyLabel("");
      setNotice(c.keyCreated);
      await refreshDashboard();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : c.keyCreateFailed,
      );
    } finally {
      setCreatingKey(false);
    }
  }

  async function revokeKey(key: ApiKeyRecord) {
    if (!user || key.revokedAt) return;
    const confirmed = window.confirm(
      c.revokeConfirm(key.label),
    );
    if (!confirmed) return;

    setRevokingId(key.id);
    setError(null);
    setNotice(null);
    try {
      await apiRequest<{ ok: true }>("/api/keys", locale, {
        method: "DELETE",
        body: JSON.stringify({ id: key.id }),
      });
      setNotice(c.keyRevoked(key.label));
      await refreshDashboard();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : c.keyRevokeFailed,
      );
    } finally {
      setRevokingId(null);
    }
  }

  async function createPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    setCreatingPayment(true);
    setError(null);
    setNotice(null);
    try {
      paymentAttemptKey.current ??=
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await apiRequest<{ payment: PaymentInvoice }>(
        "/api/payments",
        locale,
        {
          method: "POST",
          headers: {
            "Idempotency-Key": paymentAttemptKey.current,
          },
          body: JSON.stringify({ amountUsd, payCurrency }),
        },
      );
      paymentAttemptKey.current = null;
      setInvoice(result.payment);
      setNotice(c.invoiceCreated);
      await refreshDashboard();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : c.invoiceCreateFailed,
      );
    } finally {
      setCreatingPayment(false);
    }
  }

  async function signOut(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/auth/signout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(c.signoutFailed(response.status));
      }
      if (!isSignoutResponse(payload)) {
        throw new Error(c.invalidSignout);
      }
      window.location.assign(
        user?.provider === "chatgpt" ? chatGPTSignOutPath : "/",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : c.signoutFallback,
      );
      setSigningOut(false);
    }
  }

  async function copyText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(successMessage);
    } catch {
      setError(c.copyFailed);
    }
  }

  const displayName =
    dashboard?.user.displayName ??
    user?.displayName ??
    (authChecking ? c.checkingAccount : c.signedOutUser);
  const email =
    dashboard?.user.email ??
    user?.email ??
    (user?.walletAddress
      ? `${user.walletAddress.slice(0, 8)}…${user.walletAddress.slice(-6)}`
      : "");
  const activeKeys = dashboard?.keys.filter((key) => !key.revokedAt) ?? [];
  const recentCalls = dashboard?.calls.slice(0, 8) ?? [];
  const recentPayments = dashboard?.payments.slice(0, 6) ?? [];
  const paymentsEnabled = dashboard?.capabilities.paymentsEnabled ?? false;
  const commercialClearanceConfirmed =
    dashboard?.capabilities.commercialClearanceConfirmed ?? false;

  return (
    <div className="console-shell">
      <div className="console-topline">
        <div>
          <span className="console-breadcrumb">WORKSPACE / OVERVIEW</span>
          <h1>{c.console}</h1>
        </div>
        <div className="console-user">
          <span className="console-avatar" aria-hidden="true">
            {displayName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <b>{displayName}</b>
            <span>{email || c.syncAfterLogin}</span>
          </div>
          {user ? (
            <a
              href={user.provider === "chatgpt" ? chatGPTSignOutPath : "/"}
              onClick={(event) => void signOut(event)}
              aria-disabled={signingOut}
            >
              {signingOut ? c.signingOut : c.signOut}
            </a>
          ) : (
            <a href={loginPath}>
              {authChecking ? c.checking : c.signIn}
            </a>
          )}
        </div>
      </div>

      {authChecking ? (
        <section className="console-auth-banner" role="status">
          <div className="auth-banner-mark" aria-hidden="true">
            ···
          </div>
          <div>
            <span>CHECKING SESSION</span>
            <h2>{c.checkingSessionTitle}</h2>
            <p>{c.checkingSessionBody}</p>
          </div>
        </section>
      ) : null}

      {!user && !authChecking ? (
        <section className="console-auth-banner">
          <div className="auth-banner-mark" aria-hidden="true">
            ↗
          </div>
          <div>
            <span>IDENTITY REQUIRED</span>
            <h2>{c.loginTitle}</h2>
            <p>{c.loginBody}</p>
          </div>
          <a className="button button-lime" href={loginPath}>
            {c.chooseLogin}
            <span aria-hidden="true">→</span>
          </a>
        </section>
      ) : null}

      <div className="console-announcer" aria-live="polite" aria-atomic="true">
        {error ? (
          <div className="console-alert console-alert-error">
            <span>!</span>
            <p>{error}</p>
            <button type="button" onClick={() => void refreshDashboard()}>
              {c.retry}
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className="console-alert console-alert-success">
            <span>✓</span>
            <p>{notice}</p>
            <button
              type="button"
              aria-label={c.closeNotice}
              onClick={() => setNotice(null)}
            >
              ×
            </button>
          </div>
        ) : null}
      </div>

      <section className="stat-grid" aria-label={c.accountOverview}>
        <article className="stat-card stat-card-balance">
          <div>
            <span>{c.availableBalance}</span>
            <i className="stat-live">LIVE</i>
          </div>
          <strong className={loading ? "loading-value" : ""}>
            {user ? formatUsd(dashboard?.balanceUsdMicros) : "—"}
          </strong>
          <p>USD BALANCE</p>
        </article>
        <article className="stat-card">
          <div>
            <span>{c.calls30d}</span>
            <b aria-hidden="true">↗</b>
          </div>
          <strong className={loading ? "loading-value" : ""}>
            {user ? (dashboard?.stats.calls30d?.toLocaleString() ?? "—") : "—"}
          </strong>
          <p>API REQUESTS</p>
        </article>
        <article className="stat-card">
          <div>
            <span>{c.spend30d}</span>
            <b aria-hidden="true">↘</b>
          </div>
          <strong className={loading ? "loading-value" : ""}>
            {user ? formatUsd(dashboard?.stats.spend30dUsdMicros) : "—"}
          </strong>
          <p>USAGE SPEND</p>
        </article>
        <article className="stat-card">
          <div>
            <span>{c.successRate}</span>
            <b aria-hidden="true">◎</b>
          </div>
          <strong className={loading ? "loading-value" : ""}>
            {user ? formatRate(dashboard?.stats.successRate) : "—"}
          </strong>
          <p>LAST 30 DAYS</p>
        </article>
      </section>

      <div className="console-main-grid">
        <section className="console-panel keys-panel">
          <div className="panel-heading">
            <div>
              <span>ACCESS / 01</span>
              <h2>API Keys</h2>
            </div>
            <span className="panel-count">
              {user ? `${activeKeys.length} ACTIVE` : "— ACTIVE"}
            </span>
          </div>

          <form className="key-form" onSubmit={createKey}>
            <label htmlFor="key-label">{c.newKeyLabel}</label>
            <div>
              <input
                id="key-label"
                value={keyLabel}
                onChange={(event) => setKeyLabel(event.target.value)}
                placeholder={c.keyPlaceholder}
                maxLength={64}
                disabled={!user || creatingKey}
                required
              />
              <button
                className="button button-blue"
                type="submit"
                disabled={!user || creatingKey || !keyLabel.trim()}
              >
                {creatingKey ? c.creating : c.createKey}
              </button>
            </div>
          </form>

          {createdKey ? (
            <div className="created-key-card">
              <div>
                <span>{c.showOnce}</span>
                <button
                  type="button"
                  aria-label={c.closeNewKey}
                  onClick={() => setCreatedKey(null)}
                >
                  ×
                </button>
              </div>
              <p>{c.saveSecret}</p>
              <div className="secret-value">
                <code>{createdKey.secret}</code>
                <button
                  type="button"
                  onClick={() =>
                    void copyText(createdKey.secret, c.keyCopied)
                  }
                >
                  {c.copy}
                </button>
              </div>
            </div>
          ) : null}

          <div className="key-list">
            {loading ? (
              <div className="panel-loading">{c.loadingKeys}</div>
            ) : activeKeys.length > 0 ? (
              activeKeys.map((key) => (
                <article className="key-row" key={key.id}>
                  <span className="key-icon" aria-hidden="true">
                    K
                  </span>
                  <div className="key-main">
                    <div>
                      <b>{key.label}</b>
                      <span className="key-active">ACTIVE</span>
                    </div>
                    <code>{key.prefix}••••••••••••</code>
                  </div>
                  <div className="key-meta">
                    <span>
                      {c.created} {formatDate(key.createdAt, locale)}
                    </span>
                    <span>
                      {c.used} {formatDate(key.lastUsedAt, locale, true)}
                    </span>
                  </div>
                  <button
                    className="key-revoke"
                    type="button"
                    disabled={revokingId === key.id}
                    onClick={() => void revokeKey(key)}
                  >
                    {revokingId === key.id ? c.revoking : c.revoke}
                  </button>
                </article>
              ))
            ) : (
              <div className="panel-empty">
                <span>KEY_00</span>
                <p>{user ? c.noKeys : c.loginForKeys}</p>
              </div>
            )}
          </div>
        </section>

        <aside className="console-panel topup-panel">
          <div className="panel-heading">
            <div>
              <span>FUNDS / 02</span>
              <h2>{c.topupTitle}</h2>
            </div>
            <span className="pay-badge">STABLECOIN</span>
          </div>
          <form onSubmit={createPayment}>
            <fieldset
              disabled={
                !user || loading || creatingPayment || !paymentsEnabled
              }
            >
              <legend>{c.topupAmount}</legend>
              <div className="amount-options">
                {amountOptions.map((amount) => (
                  <label key={amount}>
                    <input
                      type="radio"
                      name="amount"
                      value={amount}
                      checked={amountUsd === amount}
                      onChange={() => {
                        paymentAttemptKey.current = null;
                        setAmountUsd(amount);
                      }}
                    />
                    <span>${amount}</span>
                  </label>
                ))}
              </div>
              <label className="currency-select">
                <span>{c.assetNetwork}</span>
                <select
                  value={payCurrency}
                  onChange={(event) =>
                    {
                      paymentAttemptKey.current = null;
                      setPayCurrency(
                        event.target.value as typeof payCurrency,
                      );
                    }
                  }
                >
                  {currencyOptions.map((currency) => (
                    <option value={currency.value} key={currency.value}>
                      {currency.label}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            <button
              className="button button-lime topup-submit"
              type="submit"
              disabled={
                !user || loading || creatingPayment || !paymentsEnabled
              }
            >
              {creatingPayment ? c.creatingInvoice : c.topup(amountUsd)}
              <span aria-hidden="true">↗</span>
            </button>
          </form>
          <p className="topup-warning">
            {user && !loading && !paymentsEnabled
              ? !commercialClearanceConfirmed
                ? c.clearanceClosed
                : c.topupUnavailable
              : c.topupSafety}
          </p>
        </aside>
      </div>

      {visibleInvoice ? (
        <section className="invoice-panel">
          <div className="invoice-title">
            <div>
              <span>PAYMENT INVOICE</span>
              <h2>{c.invoiceTitle}</h2>
            </div>
            <button
              type="button"
              aria-label={c.closeInvoice}
              onClick={() => setInvoice(null)}
            >
              ×
            </button>
          </div>
          <div className="invoice-grid">
            <div>
              <span>{c.amountDue}</span>
              <strong>{visibleInvoice.payAmount ?? "—"}</strong>
              <small>{currencyLabel(visibleInvoice.payCurrency)}</small>
            </div>
            <div className="invoice-address">
              <span>{c.receivingAddress}</span>
              <code>{visibleInvoice.payAddress ?? c.addressPending}</code>
              {visibleInvoice.payAddress ? (
                <button
                  type="button"
                  onClick={() =>
                    void copyText(
                      visibleInvoice.payAddress!,
                      c.addressCopied,
                    )
                  }
                >
                  {c.copyAddress}
                </button>
              ) : null}
            </div>
            <div>
              <span>{c.currentStatus}</span>
              <strong className="invoice-status">
                {paymentStatus(visibleInvoice.status, locale)}
              </strong>
              <small>{c.balanceAutoUpdate}</small>
            </div>
          </div>
          {visibleInvoice.invoiceUrl ? (
            <a
              className="button button-dark"
              href={visibleInvoice.invoiceUrl}
              target="_blank"
              rel="noreferrer"
            >
              {c.openInvoice}
            </a>
          ) : null}
        </section>
      ) : null}

      <section className="console-panel requests-panel">
        <div className="panel-heading">
          <div>
            <span>REQUESTS / 03</span>
            <h2>{c.recentRequests}</h2>
          </div>
          <a href="/docs">{c.apiDocs}</a>
        </div>
        <div className="requests-table-wrap">
          <table className="requests-table">
            <thead>
              <tr>
                <th>{c.time}</th>
                <th>{c.request}</th>
                <th>{c.platform}</th>
                <th>{c.status}</th>
                <th>{c.latency}</th>
                <th>{c.cost}</th>
              </tr>
            </thead>
            <tbody>
              {recentCalls.map((call) => (
                <tr key={call.id}>
                  <td>{formatDate(call.createdAt, locale, true)}</td>
                  <td>
                    <span className="request-path">
                      <i>{call.method}</i>
                      <code>{call.path}</code>
                    </span>
                  </td>
                  <td>
                    {platformDisplayName(
                      call.platform,
                      call.platform,
                      locale,
                    )}
                  </td>
                  <td>
                    <span
                      className={`request-status ${
                        call.statusCode >= 200 && call.statusCode < 300
                          ? "request-ok"
                          : "request-failed"
                      }`}
                    >
                      {call.statusCode}
                    </span>
                  </td>
                  <td>{call.latencyMs} ms</td>
                  <td>
                    {formatUsd(call.refunded ? 0 : call.costUsdMicros, 4)}
                    {call.refunded ? (
                      <small className="request-refunded">{c.refunded}</small>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && recentCalls.length === 0 ? (
            <div className="table-empty">
              <span>NO REQUESTS YET</span>
              <p>
                {user
                  ? c.noRequestsUser
                  : c.noRequestsGuest}
              </p>
              <a href={user ? "/docs" : loginPath}>
                {user ? c.quickstart : c.consoleLogin}
              </a>
            </div>
          ) : null}
        </div>
      </section>

      <section className="console-panel payment-history">
        <div className="panel-heading">
          <div>
            <span>LEDGER / 04</span>
            <h2>{c.recentTopups}</h2>
          </div>
          <button
            type="button"
            onClick={() => void refreshDashboard()}
            disabled={!user || loading}
          >
            {loading ? c.refreshing : c.refreshStatus}
          </button>
        </div>
        {recentPayments.length > 0 ? (
          <div className="payment-list">
            {recentPayments.map((payment) => (
              <article key={payment.id}>
                <span
                  className={`payment-dot payment-${paymentStatusClass(payment.status)}`}
                  aria-hidden="true"
                />
                <div>
                  <b>{formatUsd(payment.amountUsdMicros)}</b>
                  <span>
                    {c.credited} {formatUsd(payment.creditedUsdMicros)}
                    {payment.reversedUsdMicros > 0
                      ? ` · ${c.reversed} ${formatUsd(payment.reversedUsdMicros)}`
                      : ""}
                    {" · "}
                    {currencyLabel(payment.payCurrency)}
                    {paymentReviewReason(payment.reviewReason, locale)
                      ? ` · ${paymentReviewReason(payment.reviewReason, locale)}`
                      : ""}
                  </span>
                </div>
                <code>{payment.id}</code>
                <span>{formatDate(payment.createdAt, locale, true)}</span>
                <strong>{paymentStatus(payment.status, locale)}</strong>
                {payment.payAddress &&
                ![
                  "finished",
                  "failed",
                  "expired",
                  "refunded",
                  "manual_review",
                  "manual_resolved",
                  "provider_error",
                ].includes(payment.status.toLowerCase()) ? (
                  <button
                    type="button"
                    onClick={() =>
                      setInvoice({
                        id: payment.id,
                        status: payment.status,
                        payAddress: payment.payAddress,
                        payAmount: payment.payAmount,
                        payCurrency: payment.payCurrency,
                        invoiceUrl: payment.invoiceUrl,
                      })
                    }
                  >
                    {c.continuePayment}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="panel-empty panel-empty-inline">
            <span>PAY_00</span>
            <p>{user ? c.noTopups : c.loginForTopups}</p>
          </div>
        )}
      </section>
    </div>
  );
}
