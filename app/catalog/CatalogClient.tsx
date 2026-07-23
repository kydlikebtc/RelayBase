"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type CatalogEndpoint = {
  path: string;
  platform: string;
  method: "GET" | "POST";
  summary: string | null;
  priceUsdMicros: number;
  updatedAt: string;
};

type CatalogResponse = {
  mode: string;
  endpoints: CatalogEndpoint[];
  count: number;
  total: number;
  offset: number;
  nextOffset: number | null;
};

type CatalogState =
  | { status: "loading" }
  | { status: "ready"; catalog: CatalogResponse }
  | { status: "error"; message: string };

type CopyFeedback = {
  path: string;
  status: "success" | "error";
};

function isCatalogResponse(value: unknown): value is CatalogResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CatalogResponse>;
  return (
    typeof candidate.mode === "string" &&
    typeof candidate.count === "number" &&
    Number.isInteger(candidate.count) &&
    candidate.count >= 0 &&
    typeof candidate.total === "number" &&
    Number.isInteger(candidate.total) &&
    candidate.total >= candidate.count &&
    typeof candidate.offset === "number" &&
    Number.isInteger(candidate.offset) &&
    candidate.offset >= 0 &&
    (candidate.nextOffset === null ||
      (typeof candidate.nextOffset === "number" &&
        Number.isInteger(candidate.nextOffset) &&
        candidate.nextOffset > candidate.offset &&
        candidate.nextOffset <= 5_000)) &&
    Array.isArray(candidate.endpoints) &&
    candidate.endpoints.length === candidate.count &&
    candidate.endpoints.every(
      (endpoint) =>
        endpoint &&
        typeof endpoint === "object" &&
        typeof endpoint.path === "string" &&
        endpoint.path.startsWith("/v1/") &&
        typeof endpoint.platform === "string" &&
        endpoint.platform.length > 0 &&
        (endpoint.method === "GET" || endpoint.method === "POST") &&
        (endpoint.summary === null ||
          typeof endpoint.summary === "string") &&
        typeof endpoint.priceUsdMicros === "number" &&
        Number.isInteger(endpoint.priceUsdMicros) &&
        endpoint.priceUsdMicros >= 0 &&
        typeof endpoint.updatedAt === "string",
    )
  );
}

function formatPrice(micros: number) {
  const value = (micros / 1_000_000)
    .toFixed(6)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  return `$${value}`;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "更新时间未知";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function modeLabel(mode: string) {
  if (mode.toLowerCase() === "live") {
    return "LIVE CATALOG";
  }

  if (mode.toLowerCase().includes("sandbox")) {
    return "SAFE SANDBOX";
  }

  return mode.trim().toUpperCase() || "UNKNOWN MODE";
}

async function writeToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("copy_failed");
    }
  } finally {
    textarea.remove();
  }
}

function LoadingState() {
  return (
    <div className="catalog-loading" role="status" aria-live="polite">
      <span className="catalog-spinner" aria-hidden="true" />
      <div>
        <strong>正在读取接口目录</strong>
        <p>同步当前开放路径与单次调用价格…</p>
      </div>
    </div>
  );
}

function EmptyState({ mode }: { mode: string }) {
  const sandbox = mode.toLowerCase().includes("sandbox");

  return (
    <div className="catalog-empty">
      <span className="catalog-empty-mark" aria-hidden="true">
        00
      </span>
      <p className="section-kicker">
        {sandbox ? "SAFE SANDBOX / NO ENDPOINTS" : "CATALOG / NO ENDPOINTS"}
      </p>
      <h2>
        {sandbox ? "安全沙盒尚未开放任何接口。" : "当前没有可调用的接口。"}
      </h2>
      <p>
        {sandbox
          ? "目录会在接口完成只读、安全与价格复核后自动出现。现在不会产生真实上游调用或扣费。"
          : "目录可能正在维护或等待新能力通过审核，请稍后再来查看。"}
      </p>
      <div className="catalog-empty-actions">
        <Link className="button button-dark" href="/docs">
          先阅读接入文档
          <span aria-hidden="true">↗</span>
        </Link>
        <Link className="button button-ghost" href="/pricing">
          查看计费规则
        </Link>
      </div>
    </div>
  );
}

export default function CatalogClient() {
  const [state, setState] = useState<CatalogState>({ status: "loading" });
  const [platform, setPlatform] = useState("全部");
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCatalog() {
      setState({ status: "loading" });

      try {
        const endpoints: CatalogEndpoint[] = [];
        let nextOffset: number | null = 0;
        let mode = "sandbox";
        let total = 0;

        while (nextOffset !== null) {
          const requestedOffset = nextOffset;
          const response = await fetch(
            `/api/catalog?limit=200&offset=${requestedOffset}`,
            {
              cache: "no-store",
              headers: { Accept: "application/json" },
              signal: controller.signal,
            },
          );

          if (!response.ok) {
            throw new Error(`catalog_http_${response.status}`);
          }

          const payload: unknown = await response.json();
          if (
            !isCatalogResponse(payload) ||
            payload.offset !== requestedOffset ||
            (requestedOffset > 0 &&
              (payload.mode !== mode || payload.total !== total))
          ) {
            throw new Error("catalog_shape_invalid");
          }

          if (requestedOffset === 0) {
            mode = payload.mode;
            total = payload.total;
          }
          endpoints.push(...payload.endpoints);
          if (endpoints.length > 5_000 || endpoints.length > total) {
            throw new Error("catalog_page_overflow");
          }
          nextOffset = payload.nextOffset;
        }

        if (endpoints.length !== total) {
          throw new Error("catalog_page_incomplete");
        }

        setState({
          status: "ready",
          catalog: {
            mode,
            endpoints,
            count: endpoints.length,
            total,
            offset: 0,
            nextOffset: null,
          },
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        console.error("Unable to load the public catalog", error);
        setState({
          status: "error",
          message: "接口目录暂时无法读取。你的账户与余额不会受到影响。",
        });
      }
    }

    void loadCatalog();
    return () => controller.abort();
  }, [requestVersion]);

  useEffect(
    () => () => {
      if (copyTimer.current) {
        clearTimeout(copyTimer.current);
      }
    },
    [],
  );

  const catalog = state.status === "ready" ? state.catalog : null;
  const platforms = useMemo(() => {
    if (!catalog) {
      return [];
    }

    return Array.from(
      new Set(catalog.endpoints.map((endpoint) => endpoint.platform)),
    ).sort((left, right) => left.localeCompare(right, "zh-CN"));
  }, [catalog]);

  const visibleEndpoints = useMemo(() => {
    if (!catalog) {
      return [];
    }

    return catalog.endpoints
      .filter(
        (endpoint) => platform === "全部" || endpoint.platform === platform,
      )
      .sort(
        (left, right) =>
          left.platform.localeCompare(right.platform, "zh-CN") ||
          left.path.localeCompare(right.path),
      );
  }, [catalog, platform]);

  async function copyPath(path: string) {
    try {
      await writeToClipboard(path);
      setCopyFeedback({ path, status: "success" });

      if (copyTimer.current) {
        clearTimeout(copyTimer.current);
      }
      copyTimer.current = setTimeout(() => setCopyFeedback(null), 2200);
    } catch {
      setCopyFeedback({ path, status: "error" });

      if (copyTimer.current) {
        clearTimeout(copyTimer.current);
      }
      copyTimer.current = setTimeout(() => setCopyFeedback(null), 3000);
    }
  }

  return (
    <main className="catalog-page" id="main-content">
      <section className="catalog-hero" aria-labelledby="catalog-title">
        <div className="catalog-hero-copy">
          <p className="section-kicker">ENDPOINT CATALOG / API v1</p>
          <h1 id="catalog-title">
            找到一条
            <br />
            <span>可调用的数据路径。</span>
          </h1>
          <p>
            浏览经过只读与价格复核的公开能力。每条路径使用同一个 RelayBase
            Key，只有上游成功响应才完成扣费。
          </p>
          <div className="catalog-hero-actions">
            <Link className="button button-blue button-large" href="/console">
              获取 API Key
              <span aria-hidden="true">→</span>
            </Link>
            <Link className="button button-ghost button-large" href="/docs">
              阅读接入文档
            </Link>
          </div>
        </div>

        <aside className="catalog-status-card" aria-label="接口目录状态">
          <div className="catalog-status-head">
            <span>CATALOG STATUS</span>
            <i
              className={`catalog-mode-dot ${
                catalog?.mode.toLowerCase() === "live"
                  ? "catalog-mode-live"
                  : "catalog-mode-sandbox"
              }`}
              aria-hidden="true"
            />
          </div>
          <strong>
            {catalog ? modeLabel(catalog.mode) : "CHECKING CATALOG"}
          </strong>
          <dl>
            <div>
              <dt>开放路径</dt>
              <dd>{catalog?.count ?? "—"}</dd>
            </div>
            <div>
              <dt>请求方法</dt>
              <dd>GET</dd>
            </div>
            <div>
              <dt>计费单位</dt>
              <dd>SUCCESS</dd>
            </div>
          </dl>
          <p>目录只展示已审核、已启用的公开端点。</p>
        </aside>
      </section>

      <section className="catalog-browser" aria-labelledby="catalog-list-title">
        <header className="catalog-browser-head">
          <div>
            <span className="catalog-index">01</span>
            <div>
              <p className="section-kicker">BROWSE / FILTER BY PLATFORM</p>
              <h2 id="catalog-list-title">公开接口</h2>
            </div>
          </div>
          {catalog && catalog.endpoints.length > 0 ? (
            <p className="catalog-result-count" aria-live="polite">
              显示 <strong>{visibleEndpoints.length}</strong> / {catalog.count}
            </p>
          ) : null}
        </header>

        {state.status === "loading" ? <LoadingState /> : null}

        {state.status === "error" ? (
          <div className="catalog-error" role="alert">
            <span aria-hidden="true">!</span>
            <div>
              <strong>目录连接失败</strong>
              <p>{state.message}</p>
            </div>
            <button
              className="button button-dark"
              type="button"
              onClick={() => setRequestVersion((version) => version + 1)}
            >
              重新加载
            </button>
          </div>
        ) : null}

        {catalog && catalog.endpoints.length === 0 ? (
          <EmptyState mode={catalog.mode} />
        ) : null}

        {catalog && catalog.endpoints.length > 0 ? (
          <>
            <div
              className="catalog-filters"
              role="group"
              aria-label="按平台筛选接口"
            >
              {["全部", ...platforms].map((item) => (
                <button
                  className={platform === item ? "is-active" : undefined}
                  type="button"
                  aria-pressed={platform === item}
                  onClick={() => setPlatform(item)}
                  key={item}
                >
                  {item}
                  <span>
                    {item === "全部"
                      ? catalog.endpoints.length
                      : catalog.endpoints.filter(
                          (endpoint) => endpoint.platform === item,
                        ).length}
                  </span>
                </button>
              ))}
            </div>

            <div className="catalog-table-head" aria-hidden="true">
              <span>平台 / 方法</span>
              <span>接口路径</span>
              <span>成功请求价格</span>
              <span>操作</span>
            </div>

            {visibleEndpoints.length > 0 ? (
              <ul className="catalog-endpoint-list">
                {visibleEndpoints.map((endpoint) => (
                  <li key={`${endpoint.platform}:${endpoint.path}`}>
                    <article className="catalog-endpoint-card">
                      <div className="catalog-endpoint-identity">
                        <span className="catalog-platform">
                          {endpoint.platform}
                        </span>
                        <span className="catalog-method">{endpoint.method}</span>
                      </div>

                      <div className="catalog-path">
                        <code>{endpoint.path}</code>
                        {endpoint.summary ? (
                          <span>{endpoint.summary}</span>
                        ) : null}
                        <time dateTime={endpoint.updatedAt}>
                          更新于 {formatUpdatedAt(endpoint.updatedAt)}
                        </time>
                      </div>

                      <div className="catalog-price">
                        <strong>{formatPrice(endpoint.priceUsdMicros)}</strong>
                        <span>/ 成功请求</span>
                      </div>

                      <div className="catalog-endpoint-actions">
                        <button
                          type="button"
                          onClick={() => void copyPath(endpoint.path)}
                          aria-label={`复制接口路径 ${endpoint.path}`}
                        >
                          <span aria-hidden="true">⧉</span>
                          {copyFeedback?.path === endpoint.path
                            ? copyFeedback.status === "success"
                              ? "已复制"
                              : "复制失败"
                            : "复制路径"}
                        </button>
                        <Link href="/docs#overview">
                          调用文档
                          <span aria-hidden="true">↗</span>
                        </Link>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="catalog-no-results">
                <strong>这个筛选条件下没有接口。</strong>
                <button type="button" onClick={() => setPlatform("全部")}>
                  查看全部路径
                </button>
              </div>
            )}

            <p className="catalog-copy-status" aria-live="polite">
              {copyFeedback
                ? copyFeedback.status === "success"
                  ? `已复制 ${copyFeedback.path}`
                  : `未能复制 ${copyFeedback.path}，请手动选择路径`
                : ""}
            </p>
          </>
        ) : null}
      </section>

      <section className="catalog-note">
        <div>
          <span aria-hidden="true">→</span>
          <p>
            <strong>找不到需要的能力？</strong>
            新接口必须先完成只读、安全与价格复核，不会未经审核直接开放。
          </p>
        </div>
        <Link className="button button-lime" href="/docs">
          查看请求规范
          <span aria-hidden="true">↗</span>
        </Link>
      </section>
    </main>
  );
}
