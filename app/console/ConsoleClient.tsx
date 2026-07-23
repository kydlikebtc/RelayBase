"use client";

import type { FormEvent, MouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatGPTUser } from "../chatgpt-auth";

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
    proxyEnabled: boolean;
    paymentsEnabled: boolean;
    adminConfigured: boolean;
    schemaReady: boolean;
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

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
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
      payload?.error?.message ??
      (response.status === 401
        ? "登录状态已失效，请重新登录。"
        : `请求失败（HTTP ${response.status}）`);
    throw new ApiRequestError(message, response.status);
  }

  if (!payload) {
    throw new Error("服务返回了空响应，请稍后重试。");
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
    typeof capabilities.proxyEnabled === "boolean" &&
    typeof capabilities.paymentsEnabled === "boolean" &&
    typeof capabilities.adminConfigured === "boolean" &&
    typeof capabilities.schemaReady === "boolean" &&
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

function parseDashboardData(value: unknown): DashboardData {
  if (!isDashboardData(value)) {
    throw new Error(
      "控制台数据格式异常，请刷新重试；若问题持续存在，请联系支持。",
    );
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

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return "从未";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function paymentStatus(status: string) {
  const labels: Record<string, string> = {
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
  };
  return labels[status.toLowerCase()] ?? status;
}

function paymentStatusClass(status: string) {
  const normalized = status.toLowerCase().replace(/[^a-z_]/g, "");
  return normalized || "unknown";
}

function currencyLabel(currency: string) {
  return (
    currencyOptions.find((item) => item.value === currency)?.label ?? currency
  );
}

export function ConsoleClient({
  chatGPTUser,
  chatGPTSignOutPath,
}: {
  chatGPTUser: ChatGPTUser | null;
  chatGPTSignOutPath: string;
}) {
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
      const payload = await apiRequest<unknown>("/api/dashboard", {
        cache: "no-store",
      });
      const data = parseDashboardData(payload);
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
          : "控制台数据加载失败。",
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

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
          throw new Error(`会话检查失败（HTTP ${response.status}）。`);
        }
        if (!isAuthMeResponse(payload)) {
          throw new Error("登录会话返回了无法验证的数据。");
        }
        setSessionUser(payload.user);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setSessionUser(null);
        setError(
          requestError instanceof Error
            ? requestError.message
            : "无法确认当前登录状态。",
        );
      } finally {
        if (!controller.signal.aborted) setAuthChecking(false);
      }
    }, 0);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [chatGPTUser]);

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
      const result = await apiRequest<{ key: CreatedKey }>("/api/keys", {
        method: "POST",
        body: JSON.stringify({ label }),
      });
      setCreatedKey(result.key);
      setKeyLabel("");
      setNotice("API Key 已创建。请立即复制，密钥不会再次完整显示。");
      await refreshDashboard();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "密钥创建失败。",
      );
    } finally {
      setCreatingKey(false);
    }
  }

  async function revokeKey(key: ApiKeyRecord) {
    if (!user || key.revokedAt) return;
    const confirmed = window.confirm(
      `确定撤销“${key.label}”吗？使用该密钥的请求将立即失败。`,
    );
    if (!confirmed) return;

    setRevokingId(key.id);
    setError(null);
    setNotice(null);
    try {
      await apiRequest<{ ok: true }>("/api/keys", {
        method: "DELETE",
        body: JSON.stringify({ id: key.id }),
      });
      setNotice(`“${key.label}”已撤销。`);
      await refreshDashboard();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "密钥撤销失败。",
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
      setNotice("充值单已创建，请严格按指定币种、网络和数量支付。");
      await refreshDashboard();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "充值单创建失败。",
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
        throw new Error(`退出失败（HTTP ${response.status}）。`);
      }
      if (!isSignoutResponse(payload)) {
        throw new Error("退出接口返回了无法验证的数据。");
      }
      window.location.assign(
        user?.provider === "chatgpt" ? chatGPTSignOutPath : "/",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "退出失败。",
      );
      setSigningOut(false);
    }
  }

  async function copyText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(successMessage);
    } catch {
      setError("复制失败，请手动选择并复制。");
    }
  }

  const displayName =
    dashboard?.user.displayName ??
    user?.displayName ??
    (authChecking ? "正在确认账户" : "未登录用户");
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

  return (
    <div className="console-shell">
      <div className="console-topline">
        <div>
          <span className="console-breadcrumb">WORKSPACE / OVERVIEW</span>
          <h1>控制台</h1>
        </div>
        <div className="console-user">
          <span className="console-avatar" aria-hidden="true">
            {displayName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <b>{displayName}</b>
            <span>{email || "登录后同步账户数据"}</span>
          </div>
          {user ? (
            <a
              href={user.provider === "chatgpt" ? chatGPTSignOutPath : "/"}
              onClick={(event) => void signOut(event)}
              aria-disabled={signingOut}
            >
              {signingOut ? "退出中" : "退出"}
            </a>
          ) : (
            <a href={loginPath}>{authChecking ? "检查中" : "登录"}</a>
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
            <h2>正在确认你的登录会话。</h2>
            <p>会话检查完成后，控制台会自动加载对应账户的数据。</p>
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
            <h2>登录后加载你的余额、密钥和请求账本。</h2>
            <p>
              支持 Google、EVM 钱包与 ChatGPT
              托管身份。登录不会自动充值，也不会向浏览器暴露任何上游凭据。
            </p>
          </div>
          <a className="button button-lime" href={loginPath}>
            选择登录方式
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
              重试
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className="console-alert console-alert-success">
            <span>✓</span>
            <p>{notice}</p>
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => setNotice(null)}
            >
              ×
            </button>
          </div>
        ) : null}
      </div>

      <section className="stat-grid" aria-label="账户概览">
        <article className="stat-card stat-card-balance">
          <div>
            <span>可用余额</span>
            <i className="stat-live">LIVE</i>
          </div>
          <strong className={loading ? "loading-value" : ""}>
            {user ? formatUsd(dashboard?.balanceUsdMicros) : "—"}
          </strong>
          <p>USD BALANCE</p>
        </article>
        <article className="stat-card">
          <div>
            <span>30 天调用</span>
            <b aria-hidden="true">↗</b>
          </div>
          <strong className={loading ? "loading-value" : ""}>
            {user ? (dashboard?.stats.calls30d?.toLocaleString() ?? "—") : "—"}
          </strong>
          <p>API REQUESTS</p>
        </article>
        <article className="stat-card">
          <div>
            <span>30 天支出</span>
            <b aria-hidden="true">↘</b>
          </div>
          <strong className={loading ? "loading-value" : ""}>
            {user ? formatUsd(dashboard?.stats.spend30dUsdMicros) : "—"}
          </strong>
          <p>USAGE SPEND</p>
        </article>
        <article className="stat-card">
          <div>
            <span>成功率</span>
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
            <label htmlFor="key-label">新密钥名称</label>
            <div>
              <input
                id="key-label"
                value={keyLabel}
                onChange={(event) => setKeyLabel(event.target.value)}
                placeholder="例如：Production"
                maxLength={64}
                disabled={!user || creatingKey}
                required
              />
              <button
                className="button button-blue"
                type="submit"
                disabled={!user || creatingKey || !keyLabel.trim()}
              >
                {creatingKey ? "创建中…" : "＋ 创建 Key"}
              </button>
            </div>
          </form>

          {createdKey ? (
            <div className="created-key-card">
              <div>
                <span>只显示这一次</span>
                <button
                  type="button"
                  aria-label="关闭新密钥提示"
                  onClick={() => setCreatedKey(null)}
                >
                  ×
                </button>
              </div>
              <p>
                立即复制并保存到服务端密钥管理工具。离开后无法再次查看完整值。
              </p>
              <div className="secret-value">
                <code>{createdKey.secret}</code>
                <button
                  type="button"
                  onClick={() =>
                    void copyText(createdKey.secret, "API Key 已复制。")
                  }
                >
                  复制
                </button>
              </div>
            </div>
          ) : null}

          <div className="key-list">
            {loading ? (
              <div className="panel-loading">正在加载密钥…</div>
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
                    <span>创建 {formatDate(key.createdAt)}</span>
                    <span>使用 {formatDate(key.lastUsedAt, true)}</span>
                  </div>
                  <button
                    className="key-revoke"
                    type="button"
                    disabled={revokingId === key.id}
                    onClick={() => void revokeKey(key)}
                  >
                    {revokingId === key.id ? "撤销中…" : "撤销"}
                  </button>
                </article>
              ))
            ) : (
              <div className="panel-empty">
                <span>KEY_00</span>
                <p>{user ? "还没有 API Key。" : "登录后管理你的 API Key。"}</p>
              </div>
            )}
          </div>
        </section>

        <aside className="console-panel topup-panel">
          <div className="panel-heading">
            <div>
              <span>FUNDS / 02</span>
              <h2>余额充值</h2>
            </div>
            <span className="pay-badge">STABLECOIN</span>
          </div>
          <form onSubmit={createPayment}>
            <fieldset
              disabled={
                !user || loading || creatingPayment || !paymentsEnabled
              }
            >
              <legend>充值金额（USD）</legend>
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
                <span>支付币种 / 网络</span>
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
              {creatingPayment ? "正在创建充值单…" : `充值 $${amountUsd}`}
              <span aria-hidden="true">↗</span>
            </button>
          </form>
          <p className="topup-warning">
            {user && !loading && !paymentsEnabled
              ? "当前为安全沙盒，真实充值将在数据代理、商户与合规条件全部就绪后开放。"
              : "只向充值单指定的网络和地址转账。链上确认前，余额不会改变。"}
          </p>
        </aside>
      </div>

      {visibleInvoice ? (
        <section className="invoice-panel">
          <div className="invoice-title">
            <div>
              <span>PAYMENT INVOICE</span>
              <h2>充值单已创建</h2>
            </div>
            <button
              type="button"
              aria-label="关闭充值单"
              onClick={() => setInvoice(null)}
            >
              ×
            </button>
          </div>
          <div className="invoice-grid">
            <div>
              <span>应付数量</span>
              <strong>{visibleInvoice.payAmount ?? "—"}</strong>
              <small>{currencyLabel(visibleInvoice.payCurrency)}</small>
            </div>
            <div className="invoice-address">
              <span>收款地址</span>
              <code>{visibleInvoice.payAddress ?? "等待支付服务生成地址"}</code>
              {visibleInvoice.payAddress ? (
                <button
                  type="button"
                  onClick={() =>
                    void copyText(
                      visibleInvoice.payAddress!,
                      "支付地址已复制。",
                    )
                  }
                >
                  复制地址
                </button>
              ) : null}
            </div>
            <div>
              <span>当前状态</span>
              <strong className="invoice-status">
                {paymentStatus(visibleInvoice.status)}
              </strong>
              <small>到账后自动更新余额</small>
            </div>
          </div>
          {visibleInvoice.invoiceUrl ? (
            <a
              className="button button-dark"
              href={visibleInvoice.invoiceUrl}
              target="_blank"
              rel="noreferrer"
            >
              打开完整充值单 ↗
            </a>
          ) : null}
        </section>
      ) : null}

      <section className="console-panel requests-panel">
        <div className="panel-heading">
          <div>
            <span>REQUESTS / 03</span>
            <h2>最近请求</h2>
          </div>
          <a href="/docs">API 文档 ↗</a>
        </div>
        <div className="requests-table-wrap">
          <table className="requests-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>请求</th>
                <th>平台</th>
                <th>状态</th>
                <th>延迟</th>
                <th>费用</th>
              </tr>
            </thead>
            <tbody>
              {recentCalls.map((call) => (
                <tr key={call.id}>
                  <td>{formatDate(call.createdAt, true)}</td>
                  <td>
                    <span className="request-path">
                      <i>{call.method}</i>
                      <code>{call.path}</code>
                    </span>
                  </td>
                  <td>{call.platform}</td>
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
                      <small className="request-refunded">已退回</small>
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
                  ? "创建 Key 并发出第一条请求后，状态、延迟与费用会出现在这里。"
                  : "登录后查看真实的请求记录。"}
              </p>
              <a href={user ? "/docs" : loginPath}>
                {user ? "查看快速开始 →" : "登录控制台 →"}
              </a>
            </div>
          ) : null}
        </div>
      </section>

      <section className="console-panel payment-history">
        <div className="panel-heading">
          <div>
            <span>LEDGER / 04</span>
            <h2>最近充值</h2>
          </div>
          <button
            type="button"
            onClick={() => void refreshDashboard()}
            disabled={!user || loading}
          >
            {loading ? "刷新中…" : "刷新状态 ↻"}
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
                  <span>{currencyLabel(payment.payCurrency)}</span>
                </div>
                <code>{payment.id}</code>
                <span>{formatDate(payment.createdAt, true)}</span>
                <strong>{paymentStatus(payment.status)}</strong>
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
                    继续支付
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="panel-empty panel-empty-inline">
            <span>PAY_00</span>
            <p>{user ? "暂无充值记录。" : "登录后查看充值状态。"}</p>
          </div>
        )}
      </section>
    </div>
  );
}
