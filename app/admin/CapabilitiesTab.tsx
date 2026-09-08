"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  AdminApiError,
  StatePanel,
  adminRequest,
  isNonEmptyString,
  isObject,
} from "./adminApi";
import type { RemoteState } from "./adminApi";

type CapabilityStatus = "draft" | "published" | "deprecated";

export type AdminCapability = {
  id: string;
  platform: string;
  category: string;
  endpointPath: string;
  httpMethod: "GET" | "POST";
  status: CapabilityStatus;
  inputAliases: Record<string, string>;
  responseItemsPath: string | null;
  summaryZh: string;
  summaryEn: string;
  revision: number;
  updatedAt: string;
};

const STATUS_LABEL: Record<CapabilityStatus, string> = {
  draft: "草稿",
  published: "已发布",
  deprecated: "已下架",
};

// 与后台其他视图一致：先校验服务端返回的形状，校验不过就不渲染，
// 避免运营基于半个对象做发布或下架决定。
function isAdminCapability(value: unknown): value is AdminCapability {
  return (
    isObject(value) &&
    isNonEmptyString(value.id, 96) &&
    isNonEmptyString(value.platform, 120) &&
    isNonEmptyString(value.category, 120) &&
    isNonEmptyString(value.endpointPath, 512) &&
    (value.httpMethod === "GET" || value.httpMethod === "POST") &&
    (value.status === "draft" ||
      value.status === "published" ||
      value.status === "deprecated") &&
    isObject(value.inputAliases) &&
    Object.values(value.inputAliases).every((target) =>
      isNonEmptyString(target, 120),
    ) &&
    (value.responseItemsPath === null ||
      isNonEmptyString(value.responseItemsPath, 200)) &&
    isNonEmptyString(value.summaryZh, 400) &&
    isNonEmptyString(value.summaryEn, 400) &&
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) >= 1 &&
    isNonEmptyString(value.updatedAt, 64)
  );
}

function isCapabilityList(
  value: unknown,
): value is { capabilities: AdminCapability[] } {
  return (
    isObject(value) &&
    Array.isArray(value.capabilities) &&
    value.capabilities.every(isAdminCapability)
  );
}

function isCapabilityMutation(
  value: unknown,
): value is { capability: AdminCapability } {
  return isObject(value) && isAdminCapability(value.capability);
}

export function CapabilitiesTab({ secret }: { secret: string }) {
  const [list, setList] = useState<RemoteState<AdminCapability[]>>({
    status: "idle",
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftPath, setDraftPath] = useState("");
  const [draftMethod, setDraftMethod] = useState<"GET" | "POST">("GET");

  const fetchCapabilities = useCallback(async () => {
    return await adminRequest(
      "/api/admin/capabilities",
      secret,
      isCapabilityList,
    );
  }, [secret]);

  const readFailure = (cause: unknown): RemoteState<AdminCapability[]> => ({
    status: "error",
    message:
      cause instanceof AdminApiError ? cause.message : "能力列表读取失败。",
  });

  // 重新加载。由重试按钮与写操作之后调用，因此可以先置 loading。
  const load = useCallback(async () => {
    if (!secret) return;
    setList({ status: "loading" });
    try {
      const payload = await fetchCapabilities();
      setList({ status: "ready", data: payload.capabilities });
    } catch (cause) {
      setList(readFailure(cause));
    }
  }, [secret, fetchCapabilities]);

  // 首次加载不在 effect 里同步置 loading：初始态本就是 idle，StatePanel 已经
  // 渲染读取中。cancelled 保证切走再切回时，迟到的旧响应不会覆盖新结果。
  useEffect(() => {
    if (!secret) return;
    let cancelled = false;
    void (async () => {
      try {
        const payload = await fetchCapabilities();
        if (!cancelled) {
          setList({ status: "ready", data: payload.capabilities });
        }
      } catch (cause) {
        if (!cancelled) setList(readFailure(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [secret, fetchCapabilities]);

  // 状态变更走 expectedRevision CAS。409 表示这一行已被别人改过：重新加载并让
  // 运营基于新状态再决定，绝不静默重试——重试会把别人的修改覆盖掉。
  const changeStatus = async (
    capability: AdminCapability,
    status: CapabilityStatus,
  ) => {
    setBusyId(capability.id);
    setError(null);
    setNotice(null);
    try {
      const payload = await adminRequest(
        `/api/admin/capabilities/${encodeURIComponent(capability.id)}`,
        secret,
        isCapabilityMutation,
        {
          method: "PATCH",
          body: JSON.stringify({
            expectedRevision: capability.revision,
            status,
          }),
        },
      );
      setList((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              data: current.data.map((row) =>
                row.id === payload.capability.id ? payload.capability : row,
              ),
            }
          : current,
      );
      setNotice(
        `${payload.capability.id} 已改为「${STATUS_LABEL[payload.capability.status]}」（revision ${payload.capability.revision}）。`,
      );
    } catch (cause) {
      if (cause instanceof AdminApiError && cause.status === 409) {
        setError(
          `${capability.id} 已被其他修改更新，本次操作未生效。已重新加载，请确认当前状态后再操作。`,
        );
        await load();
      } else {
        setError(
          cause instanceof AdminApiError ? cause.message : "能力更新失败。",
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const deriveDraft = async (event: FormEvent) => {
    event.preventDefault();
    if (!draftPath.trim()) return;
    setBusyId("__draft__");
    setError(null);
    setNotice(null);
    try {
      const payload = await adminRequest(
        "/api/admin/capabilities/draft-from-endpoint",
        secret,
        isCapabilityMutation,
        {
          method: "POST",
          body: JSON.stringify({
            path: draftPath.trim(),
            method: draftMethod,
          }),
        },
      );
      setDraftPath("");
      setNotice(
        `已创建草稿 ${payload.capability.id}。草稿对调用方不可见，确认输入别名后再发布。`,
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof AdminApiError ? cause.message : "草稿创建失败。",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="admin-section">
      <div className="admin-view-intro">
        <div>
          <p className="section-kicker">CAPABILITY LAYER</p>
          <h3>能力</h3>
          <p>
            能力是 Agent 调用的公开名字，由{" "}
            <code>/v1/c/{"{capabilityId}"}</code> 解析。一个端点可以挂多个能力
            作为别名或版本；用量始终按端点记账，所以同一端点的多个能力不会把
            消费拆散。
          </p>
          <p>
            草稿与不存在对调用方是同一件事（404），已下架返回 410。
            目录同步下架端点时，只有已发布的能力会被一并置为下架，草稿不受影响。
          </p>
        </div>
      </div>

      <form className="admin-upstream-form" onSubmit={deriveDraft}>
        <div>
          <label htmlFor="capability-draft-path">从端点创建草稿</label>
          <input
            id="capability-draft-path"
            type="text"
            value={draftPath}
            placeholder="/v1/tiktok/web/fetch_user_profile"
            maxLength={512}
            onChange={(event) => setDraftPath(event.target.value)}
          />
          <small>
            能力 id 由平台、数据类型与路径末段推导。推导不出合法 id 时接口会拒绝
            并说明原因，不会自造名字。
          </small>
        </div>
        <div>
          <label htmlFor="capability-draft-method">方法</label>
          <select
            id="capability-draft-method"
            value={draftMethod}
            onChange={(event) =>
              setDraftMethod(event.target.value === "POST" ? "POST" : "GET")
            }
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </div>
        <div className="admin-card-actions">
          <button
            type="submit"
            className="button button-primary button-small"
            disabled={busyId !== null || !draftPath.trim()}
          >
            {busyId === "__draft__" ? "创建中…" : "创建草稿"}
          </button>
        </div>
      </form>

      {error ? (
        <p className="admin-form-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="admin-notice">{notice}</p> : null}

      <StatePanel state={list} label="能力列表" onRetry={() => void load()}>
        {list.status === "ready" ? (
          list.data.length === 0 ? (
            <p className="admin-empty">
              还没有能力。先从一个已发布的端点创建草稿。
            </p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">能力 id</th>
                    <th scope="col">端点</th>
                    <th scope="col">状态</th>
                    <th scope="col">输入别名</th>
                    <th scope="col">Rev</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((capability) => {
                    const aliases = Object.entries(capability.inputAliases);
                    const busy = busyId === capability.id;
                    return (
                      <tr key={capability.id}>
                        <td>
                          <strong>{capability.id}</strong>
                          <small className="admin-route-description">
                            {capability.summaryZh}
                          </small>
                        </td>
                        <td>
                          <span className="admin-method">
                            {capability.httpMethod}
                          </span>{" "}
                          <code>{capability.endpointPath}</code>
                          <small className="admin-platform">
                            {capability.platform} · {capability.category}
                          </small>
                        </td>
                        <td>
                          <span className="admin-pending-status">
                            {STATUS_LABEL[capability.status]}
                          </span>
                        </td>
                        <td>
                          {aliases.length === 0 ? (
                            <small>直通，无重命名</small>
                          ) : (
                            <ul className="admin-endpoint-taxonomy">
                              {aliases.map(([field, target]) => (
                                <li key={field}>
                                  <code>{field}</code> → <code>{target}</code>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td>{capability.revision}</td>
                        <td>
                          <div className="admin-inline-actions">
                            {capability.status !== "published" ? (
                              <button
                                type="button"
                                className="button button-primary button-small"
                                disabled={busyId !== null}
                                onClick={() =>
                                  void changeStatus(capability, "published")
                                }
                              >
                                {busy ? "处理中…" : "发布"}
                              </button>
                            ) : null}
                            {capability.status === "published" ? (
                              <button
                                type="button"
                                className="button button-ghost button-small"
                                disabled={busyId !== null}
                                onClick={() =>
                                  void changeStatus(capability, "draft")
                                }
                              >
                                {busy ? "处理中…" : "转回草稿"}
                              </button>
                            ) : null}
                            {capability.status !== "deprecated" ? (
                              <button
                                type="button"
                                className="admin-button-danger-ghost button-small"
                                disabled={busyId !== null}
                                onClick={() =>
                                  void changeStatus(capability, "deprecated")
                                }
                              >
                                下架
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </StatePanel>
    </section>
  );
}
