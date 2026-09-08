"use client";

import type { ReactNode } from "react";

export type JsonObject = Record<string, unknown>;
export type Validator<T> = (value: unknown) => value is T;

export type RemoteState<T> =
  | { status: "idle" | "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

// 具名管理员用同源会话 cookie 鉴权，没有可发送的 bearer 密钥。
export const NAMED_ADMIN_SESSION = "__named_admin_session__";

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(
  value: unknown,
  max = 2_000,
): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= max
  );
}

export async function adminRequest<T>(
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

export function StatePanel({
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
