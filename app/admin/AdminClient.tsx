"use client";

import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type AdminTab = "overview" | "users" | "catalog" | "payments";
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
    baseUrl: string | null;
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
  createdAt: string;
};

type UsersResponse = {
  users: AdminUser[];
  count: number;
  total: number;
  offset: number;
  nextOffset: number | null;
};

type CatalogEndpoint = {
  path: string;
  platform: string;
  method: string;
  summary: string | null;
  description: string | null;
  parameterSchema: JsonValue | null;
  upstreamPriceUsdMicros: number;
  customerPriceUsdMicros: number;
  priceVerified: boolean;
  enabled: boolean;
  readOnly: boolean;
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
const validPaymentStatus = /^[a-z][a-z0-9_]{0,63}$/;

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

function isSafeHttpUrl(value: unknown): value is string {
  if (!isNonEmptyString(value, 2_000)) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          (url.hostname === "localhost" || url.hostname === "127.0.0.1"))) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
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
    (upstream.baseUrl === null || isSafeHttpUrl(upstream.baseUrl)) &&
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

function isCatalogEndpoint(value: unknown): value is CatalogEndpoint {
  if (!isObject(value)) return false;
  return (
    isSafePath(value.path) &&
    isNonEmptyString(value.platform, 80) &&
    isNonEmptyString(value.method, 16) &&
    /^[A-Z]+$/.test(value.method) &&
    isNullableString(value.summary, 1_000) &&
    isNullableString(value.description, 10_000) &&
    (value.parameterSchema === null || isJsonValue(value.parameterSchema)) &&
    isSafeNonNegativeInteger(value.upstreamPriceUsdMicros) &&
    isSafeNonNegativeInteger(value.customerPriceUsdMicros) &&
    typeof value.priceVerified === "boolean" &&
    typeof value.enabled === "boolean" &&
    typeof value.readOnly === "boolean" &&
    isNullableDateString(value.sourceUpdatedAt) &&
    typeof value.presentInLatestSync === "boolean" &&
    isNullableDateString(value.reviewedAt) &&
    isDateString(value.updatedAt)
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
    value.endpoints.length <= 500 &&
    value.endpoints.every(isCatalogEndpoint)
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
} {
  return (
    isObject(value) &&
    value.ok === true &&
    isSafePath(value.path) &&
    typeof value.enabled === "boolean" &&
    typeof value.readOnly === "boolean"
  );
}

function isCatalogSyncResponse(
  value: unknown,
): value is { synced: number; disabledMissing: number; note: string } {
  return (
    isObject(value) &&
    isSafeNonNegativeInteger(value.synced) &&
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
  const [secretInput, setSecretInput] = useState("");
  const [adminSecret, setAdminSecret] = useState("");
  const [rememberForTab, setRememberForTab] = useState(false);
  const [checkingSecret, setCheckingSecret] = useState(false);
  const [authError, setAuthError] = useState("");
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [overview, setOverview] = useState<RemoteState<OverviewResponse>>({
    status: "idle",
  });
  const [users, setUsers] = useState<RemoteState<UsersResponse>>({
    status: "idle",
  });
  const [catalog, setCatalog] = useState<RemoteState<CatalogResponse>>({
    status: "idle",
  });
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
  const [catalogPlatform, setCatalogPlatform] = useState("all");
  const [catalogStatus, setCatalogStatus] = useState("all");
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [savingPath, setSavingPath] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("manual_review");
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
      while (true) {
        const page = await adminRequest(
          `/api/admin/catalog?limit=500&offset=${offset}`,
          secret,
          isCatalogResponse,
        );
        if (
          page.offset !== offset ||
          (total !== null && page.total !== total)
        ) {
          throw new AdminApiError(
            "接口目录在分页读取期间发生变化，请重新加载。",
            409,
          );
        }
        total ??= page.total;
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
        void loadCatalog(secret);
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
    [loadCatalog, loadPaymentReviews, loadPayments, loadUsers],
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

  const visibleEndpoints = useMemo(() => {
    if (catalog.status !== "ready") return [];
    const query = catalogQuery.trim().toLocaleLowerCase("zh-CN");
    return catalog.data.endpoints.filter((endpoint) => {
      const matchesQuery =
        !query ||
        endpoint.path.toLocaleLowerCase("zh-CN").includes(query) ||
        endpoint.platform.toLocaleLowerCase("zh-CN").includes(query);
      const matchesPlatform =
        catalogPlatform === "all" || endpoint.platform === catalogPlatform;
      const matchesStatus =
        catalogStatus === "all" ||
        (catalogStatus === "enabled" && endpoint.enabled) ||
        (catalogStatus === "disabled" && !endpoint.enabled) ||
        (catalogStatus === "review" &&
          (!endpoint.reviewedAt ||
            !endpoint.presentInLatestSync ||
            !endpoint.priceVerified));
      return matchesQuery && matchesPlatform && matchesStatus;
    });
  }, [catalog, catalogPlatform, catalogQuery, catalogStatus]);

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
    setOverview({ status: "idle" });
    setUsers({ status: "idle" });
    setCatalog({ status: "idle" });
    setPayments({ status: "idle" });
    setPaymentReviews({ status: "idle" });
    setReviewResolution(null);
  }

  function submitSecret(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void authenticate(secretInput, rememberForTab);
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

  function openReviewResolution(
    review: PaymentReview,
    action: ReviewAction,
  ) {
    setReviewResolution({ review, action });
    setReviewCreditAmount("");
    setReviewNote("");
    setNotice("");
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
            }),
          },
        );
        setNotice(
          confirmAction.nextEnabled
            ? `已上架 ${endpoint.path}。`
            : `已下架 ${endpoint.path}，新请求将无法调用。`,
        );
        await Promise.all([loadCatalog(), loadOverview()]);
      } else {
        const result = await adminRequest(
          "/api/admin/catalog/sync",
          adminSecret,
          isCatalogSyncResponse,
          { method: "POST" },
        );
        setNotice(
          `同步完成：识别 ${result.synced} 条，停用缺失端点 ${result.disabledMissing} 条。`,
        );
        await Promise.all([loadCatalog(), loadOverview()]);
      }
      setConfirmAction(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "管理操作失败。");
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
            查看实际用户与调用数据，维护 TikHub 路由、成本、客户价和支付复核队列。
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

  return (
    <main className="admin-page" id="main-content">
      <div className="admin-shell">
        <header className="admin-topbar">
          <div>
            <span className="admin-eyebrow">RELAYBASE / OPERATIONS</span>
            <h1>运营管理后台</h1>
          </div>
          <div className="admin-topbar-actions">
            <span
              className={`admin-readiness ${
                overviewData?.readiness.ready ? "is-ready" : ""
              }`}
            >
              <i aria-hidden="true" />
              {overviewData
                ? overviewData.readiness.ready
                  ? "生产能力就绪"
                  : `${overviewData.readiness.mode} / 未完全就绪`
                : "正在读取状态"}
            </span>
            <button className="button button-ghost button-small" onClick={signOut}>
              锁定后台
            </button>
          </div>
        </header>

        <nav className="admin-tabs" aria-label="管理模块">
          {(
            [
              ["overview", "运营总览"],
              ["users", "用户管理"],
              ["catalog", "路由与定价"],
              ["payments", "支付复核"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={activeTab === id ? "is-active" : ""}
              aria-current={activeTab === id ? "page" : undefined}
              onClick={() => setActiveTab(id)}
            >
              {label}
              {id === "payments" &&
              openReviewCount ? (
                <span>{openReviewCount}</span>
              ) : null}
            </button>
          ))}
        </nav>

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
                          当前模式：{overviewData.readiness.mode}。在缺失项补齐前，
                          客户调用或支付可能保持关闭。
                        </p>
                      </div>
                      <ul>
                        {overviewData.readiness.missing.length ? (
                          overviewData.readiness.missing.map((item) => (
                            <li key={item}>{item}</li>
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
                        <strong>TikHub 上游连接</strong>
                        <p>
                          {overviewData.upstream.baseUrl ?? "上游地址尚未配置"}
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
                        <dt>密钥指纹</dt>
                        <dd>
                          {overviewData.upstream.keyFingerprint ?? "不可用"}
                        </dd>
                      </div>
                      <div>
                        <dt>数据生成</dt>
                        <dd>{formatDate(overviewData.generatedAt)}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="admin-metrics">
                    <article>
                      <span>用户总数</span>
                      <strong>
                        {overviewData.summary.totalUsers.toLocaleString()}
                      </strong>
                      <small>
                        活跃 {overviewData.summary.activeUsers.toLocaleString()}
                      </small>
                    </article>
                    <article>
                      <span>近 30 日调用</span>
                      <strong>
                        {overviewData.summary.calls30d.toLocaleString()}
                      </strong>
                      <small>
                        成功率 {formatRate(overviewData.summary.successRate)}
                      </small>
                    </article>
                    <article>
                      <span>近 30 日收入</span>
                      <strong>
                        {formatUsd(
                          overviewData.summary.grossRevenueUsdMicros,
                        )}
                      </strong>
                      <small>
                        上游成本{" "}
                        {formatUsd(
                          overviewData.summary.upstreamCostUsdMicros,
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
                      <small>
                        用户余额负债{" "}
                        {formatUsd(
                          overviewData.summary.outstandingBalanceUsdMicros,
                        )}
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
                    <div className="admin-card-list">
                      {visibleUsers.map((user) => (
                        <article className="admin-user-card" key={user.id}>
                          <div className="admin-user-identity">
                            <span aria-hidden="true">
                              {(user.displayName || user.email)
                                .slice(0, 2)
                                .toUpperCase()}
                            </span>
                            <div>
                              <strong>{user.displayName}</strong>
                              <p>{user.email}</p>
                              <code>{user.id}</code>
                            </div>
                          </div>
                          <dl>
                            <div>
                              <dt>余额</dt>
                              <dd
                                className={
                                  user.balanceUsdMicros < 0
                                    ? "is-negative-balance"
                                    : undefined
                                }
                              >
                                {formatUsd(user.balanceUsdMicros)}
                                {user.balanceUsdMicros < 0 ? " · 欠款" : ""}
                              </dd>
                            </div>
                            <div>
                              <dt>30 日调用</dt>
                              <dd>{user.calls30d.toLocaleString()}</dd>
                            </div>
                            <div>
                              <dt>30 日消费</dt>
                              <dd>{formatUsd(user.spend30dUsdMicros)}</dd>
                            </div>
                            <div>
                              <dt>最后调用</dt>
                              <dd>{formatDate(user.lastCallAt)}</dd>
                            </div>
                          </dl>
                          <div className="admin-card-actions">
                            <span
                              className={`admin-account-status is-${user.status}`}
                            >
                              {user.status === "active" ? "正常" : "已暂停"}
                            </span>
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
                          </div>
                        </article>
                      ))}
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

        {activeTab === "catalog" ? (
          <section className="admin-section" aria-labelledby="catalog-admin-title">
            <div className="admin-section-head">
              <div>
                <p className="section-kicker">TIKHUB CATALOG CONTROL</p>
                <h2 id="catalog-admin-title">路由与定价</h2>
              </div>
              <div className="admin-section-actions">
                <button
                  className="button button-ghost button-small"
                  onClick={() => void loadCatalog()}
                >
                  刷新目录
                </button>
                <button
                  className="button button-dark button-small"
                  onClick={() => setConfirmAction({ kind: "sync" })}
                >
                  同步 TikHub
                </button>
              </div>
            </div>
            <StatePanel
              state={catalog}
              label="接口目录"
              onRetry={() => void loadCatalog()}
            >
              {catalog.status === "ready" ? (
                <>
                  <div className="admin-toolbar admin-toolbar-wide">
                    <label>
                      <span>搜索路由</span>
                      <input
                        type="search"
                        value={catalogQuery}
                        onChange={(event) =>
                          setCatalogQuery(event.target.value)
                        }
                        placeholder="平台或 /v1/ 路径"
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
                        onChange={(event) =>
                          setCatalogStatus(event.target.value)
                        }
                      >
                        <option value="all">全部</option>
                        <option value="enabled">已上架</option>
                        <option value="disabled">已下架</option>
                        <option value="review">待复核</option>
                      </select>
                    </label>
                    <p>
                      显示 <strong>{visibleEndpoints.length}</strong> /{" "}
                      {catalog.data.count} 条
                    </p>
                  </div>
                  {visibleEndpoints.length ? (
                    <div className="admin-catalog-list">
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
                          <article
                            className={`admin-endpoint-card ${
                              endpoint.enabled ? "is-enabled" : ""
                            }`}
                            key={endpoint.path}
                          >
                            <div className="admin-endpoint-head">
                              <div>
                                <span className="admin-platform">
                                  {endpoint.platform}
                                </span>
                                <span className="admin-method">
                                  {endpoint.method}
                                </span>
                                <code>{endpoint.path}</code>
                              </div>
                              <div className="admin-endpoint-flags">
                                <span
                                  className={
                                    endpoint.presentInLatestSync
                                      ? "is-current"
                                      : "is-stale"
                                  }
                                >
                                  {endpoint.presentInLatestSync
                                    ? "本次同步存在"
                                    : "上游已缺失"}
                                </span>
                                <span>
                                  {endpoint.readOnly
                                    ? "只读已复核"
                                    : "未确认只读"}
                                </span>
                                <span
                                  className={
                                    endpoint.priceVerified
                                      ? "is-current"
                                      : "is-stale"
                                  }
                                >
                                  {endpoint.priceVerified
                                    ? "成本已核验"
                                    : "等待成本"}
                                </span>
                              </div>
                            </div>
                            {endpoint.summary ||
                            endpoint.description ||
                            endpoint.parameterSchema !== null ? (
                              <details className="admin-endpoint-details">
                                <summary>
                                  <span>
                                    {endpoint.summary ?? "查看接口数据定义"}
                                  </span>
                                  <b>展开详情</b>
                                </summary>
                                {endpoint.description ? (
                                  <p>{endpoint.description}</p>
                                ) : null}
                                {endpoint.parameterSchema !== null ? (
                                  <div>
                                    <span>参数与数据类型</span>
                                    <pre>
                                      {JSON.stringify(
                                        endpoint.parameterSchema,
                                        null,
                                        2,
                                      )}
                                    </pre>
                                  </div>
                                ) : (
                                  <p>上游目录未提供结构化参数定义。</p>
                                )}
                              </details>
                            ) : null}
                            <div className="admin-price-editor">
                              <dl>
                                <div>
                                  <dt>上游成本 / 次</dt>
                                  <dd>
                                    {formatUsd(
                                      endpoint.upstreamPriceUsdMicros,
                                      6,
                                    )}
                                  </dd>
                                </div>
                                <div>
                                  <dt>当前毛利 / 次</dt>
                                  <dd>{formatUsd(margin, 6)}</dd>
                                </div>
                              </dl>
                              <label>
                                <span>客户价 / 次（USD）</span>
                                <div>
                                  <b>$</b>
                                  <input
                                    inputMode="decimal"
                                    value={draft}
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
                                      : "保存价格"}
                                  </button>
                                </div>
                                {invalidPrice ? (
                                  <small>
                                    最多 6 位小数，且不得低于上游成本。
                                  </small>
                                ) : null}
                              </label>
                            </div>
                            <footer>
                              <div>
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
                                  审核：{formatDate(endpoint.reviewedAt)}
                                </small>
                              </div>
                              <button
                                className={`button button-small ${
                                  endpoint.enabled
                                    ? "admin-button-danger-ghost"
                                    : "button-dark"
                                }`}
                                disabled={
                                  !endpoint.enabled &&
                                  (!endpoint.presentInLatestSync ||
                                    !endpoint.priceVerified ||
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
                                {endpoint.enabled ? "下架接口" : "审核并上架"}
                              </button>
                            </footer>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="admin-empty">
                      <strong>没有符合条件的接口</strong>
                      <p>
                        调整筛选条件，或从 TikHub 同步最新端点目录。
                      </p>
                    </div>
                  )}
                </>
              ) : null}
            </StatePanel>
          </section>
        ) : null}

        {activeTab === "payments" ? (
          <section className="admin-section" aria-labelledby="payments-title">
            <div className="admin-section-head">
              <div>
                <p className="section-kicker">PAYMENT REVIEW QUEUE</p>
                <h2 id="payments-title">支付复核</h2>
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
                    <div className="admin-payment-list">
                      {visiblePayments.map((payment) => (
                        <article
                          className={`admin-payment-card ${
                            payment.status === "manual_review"
                              ? "needs-review"
                              : ""
                          }`}
                          key={payment.id}
                        >
                          <header>
                            <div>
                              <span
                                className={`admin-payment-status is-${paymentStatusClass(
                                  payment.status,
                                )}`}
                              >
                                {paymentStatusLabel(payment.status)}
                              </span>
                              <strong>{payment.userEmail}</strong>
                            </div>
                            <time>{formatDate(payment.updatedAt)}</time>
                          </header>
                          <dl>
                            <div>
                              <dt>订单金额</dt>
                              <dd>{formatUsd(payment.amountUsdMicros)}</dd>
                            </div>
                            <div>
                              <dt>链上应付</dt>
                              <dd>
                                {payment.payAmount ?? "—"}{" "}
                                {payment.payCurrency.toUpperCase()}
                              </dd>
                            </div>
                            <div>
                              <dt>已入账</dt>
                              <dd>
                                {formatUsd(payment.creditedUsdMicros)}
                              </dd>
                            </div>
                          </dl>
                          <div className="admin-payment-refs">
                            <p>
                              <span>内部订单</span>
                              <code>{payment.id}</code>
                            </p>
                            <p>
                              <span>服务商编号</span>
                              <code>
                                {payment.providerPaymentId ?? "尚未绑定"}
                              </code>
                            </p>
                            {payment.payAddress ? (
                              <p>
                                <span>收款地址</span>
                                <code>{payment.payAddress}</code>
                              </p>
                            ) : null}
                          </div>
                          {payment.status === "manual_review" ? (
                            <footer>
                              该订单未自动入账。请先在支付服务商后台核验币种、金额、订单绑定与退款状态，再使用受控恢复流程处理。
                            </footer>
                          ) : null}
                        </article>
                      ))}
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

      {confirmAction ? (
        <ConfirmDialog
          busy={mutating}
          danger={
            (confirmAction.kind === "user" &&
              confirmAction.nextStatus === "suspended") ||
            (confirmAction.kind === "endpoint" &&
              !confirmAction.nextEnabled)
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
                : "从 TikHub 同步全部接口？"
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
                : "同步会读取 TikHub 当前目录。新接口默认下架，价格变化的已上架接口会自动下架等待复核，客户价不会被静默覆盖。"
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
