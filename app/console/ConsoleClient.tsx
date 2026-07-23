"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
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
  status: string;
  createdAt: string;
};

type CallRecord = {
  id: string;
  method: string;
  path: string;
  platform: string;
  statusCode: number;
  costUsdMicros: number;
  latencyMs: number;
  createdAt: string;
};

type DashboardData = {
  user: {
    email: string;
    displayName: string;
  };
  balanceUsdMicros: number;
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
  payAmount: number | string;
  payCurrency: "usdttrc20" | "usdterc20" | "usdcbase";
  invoiceUrl: string | null;
};

type ApiErrorShape = {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
};

const amountOptions = [10, 25, 50, 100] as const;
const currencyOptions = [
  { value: "usdttrc20", label: "USDT · TRC20" },
  { value: "usdterc20", label: "USDT · ERC20" },
  { value: "usdcbase", label: "USDC · Base" },
] as const;

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
    throw new Error(message);
  }

  if (!payload) {
    throw new Error("服务返回了空响应，请稍后重试。");
  }

  return payload;
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
    confirming: "确认中",
    finished: "已到账",
    completed: "已到账",
    paid: "已到账",
    failed: "失败",
    expired: "已过期",
  };
  return labels[status.toLowerCase()] ?? status;
}

function currencyLabel(currency: string) {
  return (
    currencyOptions.find((item) => item.value === currency)?.label ?? currency
  );
}

export function ConsoleClient({
  user,
  signInPath,
  signOutPath,
}: {
  user: ChatGPTUser | null;
  signInPath: string;
  signOutPath: string;
}) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(Boolean(user));
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

  const refreshDashboard = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<DashboardData>("/api/dashboard", {
        cache: "no-store",
      });
      setDashboard(data);
    } catch (requestError) {
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
    const timer = window.setTimeout(() => {
      void refreshDashboard();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshDashboard]);

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
      const result = await apiRequest<{ payment: PaymentInvoice }>(
        "/api/payments",
        {
          method: "POST",
          body: JSON.stringify({ amountUsd, payCurrency }),
        },
      );
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

  async function copyText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(successMessage);
    } catch {
      setError("复制失败，请手动选择并复制。");
    }
  }

  const displayName =
    dashboard?.user.displayName ?? user?.displayName ?? "未登录用户";
  const email = dashboard?.user.email ?? user?.email ?? "";
  const activeKeys = dashboard?.keys.filter((key) => !key.revokedAt) ?? [];
  const recentCalls = dashboard?.calls.slice(0, 8) ?? [];
  const recentPayments = dashboard?.payments.slice(0, 4) ?? [];

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
            <a href={signOutPath}>退出</a>
          ) : (
            <a href={signInPath}>登录</a>
          )}
        </div>
      </div>

      {!user ? (
        <section className="console-auth-banner">
          <div className="auth-banner-mark" aria-hidden="true">
            ↗
          </div>
          <div>
            <span>IDENTITY REQUIRED</span>
            <h2>登录后加载你的余额、密钥和请求账本。</h2>
            <p>
              使用 ChatGPT 登录识别账户。登录不会自动充值，也不会向浏览器暴露任何上游凭据。
            </p>
          </div>
          <a className="button button-lime" href={signInPath}>
            使用 ChatGPT 登录
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
            <fieldset disabled={!user || creatingPayment}>
              <legend>充值金额（USD）</legend>
              <div className="amount-options">
                {amountOptions.map((amount) => (
                  <label key={amount}>
                    <input
                      type="radio"
                      name="amount"
                      value={amount}
                      checked={amountUsd === amount}
                      onChange={() => setAmountUsd(amount)}
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
                    setPayCurrency(
                      event.target.value as typeof payCurrency,
                    )
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
              disabled={!user || creatingPayment}
            >
              {creatingPayment ? "正在创建充值单…" : `充值 $${amountUsd}`}
              <span aria-hidden="true">↗</span>
            </button>
          </form>
          <p className="topup-warning">
            只向充值单指定的网络和地址转账。链上确认前，余额不会改变。
          </p>
        </aside>
      </div>

      {invoice ? (
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
              <strong>{invoice.payAmount}</strong>
              <small>{currencyLabel(invoice.payCurrency)}</small>
            </div>
            <div className="invoice-address">
              <span>收款地址</span>
              <code>{invoice.payAddress ?? "等待支付服务生成地址"}</code>
              {invoice.payAddress ? (
                <button
                  type="button"
                  onClick={() =>
                    void copyText(invoice.payAddress!, "支付地址已复制。")
                  }
                >
                  复制地址
                </button>
              ) : null}
            </div>
            <div>
              <span>当前状态</span>
              <strong className="invoice-status">
                {paymentStatus(invoice.status)}
              </strong>
              <small>到账后自动更新余额</small>
            </div>
          </div>
          {invoice.invoiceUrl ? (
            <a
              className="button button-dark"
              href={invoice.invoiceUrl}
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
                  <td>{formatUsd(call.costUsdMicros, 4)}</td>
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
              <a href={user ? "/docs" : signInPath}>
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
                  className={`payment-dot payment-${payment.status.toLowerCase()}`}
                  aria-hidden="true"
                />
                <div>
                  <b>{formatUsd(payment.amountUsdMicros)}</b>
                  <span>{currencyLabel(payment.payCurrency)}</span>
                </div>
                <code>{payment.id}</code>
                <span>{formatDate(payment.createdAt, true)}</span>
                <strong>{paymentStatus(payment.status)}</strong>
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
