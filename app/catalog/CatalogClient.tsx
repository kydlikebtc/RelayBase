"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

const PAGE_SIZE = 20;
const MAX_FACET_OPTIONS = 500;
const MAX_JSON_NODES = 5_000;
const MAX_JSON_DEPTH = 20;
const MAX_MARKETPLACE_RESPONSE_BYTES = 2 * 1024 * 1024;
const MARKETPLACE_REQUEST_TIMEOUT_MS = 15_000;

type HttpMethod = "GET" | "POST";
type MarketplaceSurface = "app" | "web" | "app_web" | "other";
type Availability = "available" | "pending" | "restricted";
type ExampleLanguage = "curl" | "javascript" | "python";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonContainer = JsonValue[] | { [key: string]: JsonValue };

type MarketplaceSource = {
  provider: string;
  openApiVersion: string | null;
  snapshotHash: string | null;
  generatedAt: string | null;
  operationCount: number;
};

type MarketplaceStats = {
  total: number;
  available: number;
  pending: number;
  restricted: number;
  platforms: number;
  categories: number;
  dataTypes: number;
};

type FacetOption<T extends string = string> = {
  value: T;
  label: string;
  count: number;
};

type MarketplaceFacets = {
  platforms: FacetOption[];
  tags: FacetOption[];
  dataTypes: FacetOption[];
  methods: FacetOption<HttpMethod>[];
  surfaces: FacetOption<MarketplaceSurface>[];
  availability: FacetOption<Availability>[];
};

type MarketplaceEndpoint = {
  path: string;
  platform: string;
  dataType: string;
  method: HttpMethod;
  surface: MarketplaceSurface;
  availability: Availability;
  summary: string | null;
  priceUsdMicros: number | null;
  rateLimitRpm: number | null;
};

type MarketplaceResponse = {
  source: MarketplaceSource;
  stats: MarketplaceStats;
  facets: MarketplaceFacets;
  endpoints: MarketplaceEndpoint[];
  total: number;
  count: number;
  offset: number;
  nextOffset: number | null;
};

type MarketplaceDetailEndpoint = MarketplaceEndpoint & {
  description: string | null;
  tags: string[];
  operationId: string | null;
  parameters: JsonContainer | null;
  requestBody: JsonContainer | null;
  response: JsonContainer | null;
};

type MarketplaceDetailResponse = {
  source: MarketplaceSource;
  endpoint: MarketplaceDetailEndpoint;
  examples: Record<ExampleLanguage, string>;
};

type MarketplaceState =
  | { status: "loading" }
  | { status: "ready"; data: MarketplaceResponse }
  | { status: "error"; message: string };

type DetailState =
  | { status: "idle" }
  | { status: "loading"; endpoint: MarketplaceEndpoint }
  | {
      status: "ready";
      endpoint: MarketplaceEndpoint;
      data: MarketplaceDetailResponse;
    }
  | {
      status: "error";
      endpoint: MarketplaceEndpoint;
      message: string;
    };

type CopyFeedback = {
  id: string;
  status: "success" | "error";
};

type Filters = {
  platform: string;
  tag: string;
  dataType: string;
  method: "" | HttpMethod;
  surface: "" | MarketplaceSurface;
  availability: "" | Availability;
};

const initialFilters: Filters = {
  platform: "",
  tag: "",
  dataType: "",
  method: "",
  surface: "",
  availability: "",
};

const exampleLabels: Record<ExampleLanguage, string> = {
  curl: "cURL",
  javascript: "JavaScript",
  python: "Python",
};

const exampleLanguages: ExampleLanguage[] = [
  "curl",
  "javascript",
  "python",
];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function readBoundedJsonResponse(
  response: Response,
): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new Error("marketplace_content_type_invalid");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > MAX_MARKETPLACE_RESPONSE_BYTES
    ) {
      throw new Error("marketplace_response_too_large");
    }
  }
  if (!response.body) throw new Error("marketplace_body_missing");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > MAX_MARKETPLACE_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("marketplace_response_too_large");
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

function isSafeIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isSafeText(
  value: unknown,
  maximumLength: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximumLength &&
    (allowEmpty || value.trim().length > 0) &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
  );
}

function isNullableText(
  value: unknown,
  maximumLength: number,
): value is string | null {
  return value === null || isSafeText(value, maximumLength);
}

function isIsoDateOrNull(value: unknown): value is string | null {
  return (
    value === null ||
    (isSafeText(value, 80) && Number.isFinite(Date.parse(value)))
  );
}

function isHttpMethod(value: unknown): value is HttpMethod {
  return value === "GET" || value === "POST";
}

function isSurface(value: unknown): value is MarketplaceSurface {
  return (
    value === "app" ||
    value === "web" ||
    value === "app_web" ||
    value === "other"
  );
}

function isAvailability(value: unknown): value is Availability {
  return (
    value === "available" ||
    value === "pending" ||
    value === "restricted"
  );
}

function isMarketplaceSource(value: unknown): value is MarketplaceSource {
  if (!isPlainRecord(value)) return false;
  return (
    isSafeText(value.provider, 120) &&
    isNullableText(value.openApiVersion, 160) &&
    (value.snapshotHash === null ||
      (typeof value.snapshotHash === "string" &&
        /^[0-9a-f]{64}$/.test(value.snapshotHash))) &&
    isIsoDateOrNull(value.generatedAt) &&
    isSafeIntegerInRange(value.operationCount, 0, 1_000_000)
  );
}

function isMarketplaceStats(value: unknown): value is MarketplaceStats {
  if (!isPlainRecord(value)) return false;
  if (
    !isSafeIntegerInRange(value.total, 0, 1_000_000) ||
    !isSafeIntegerInRange(value.available, 0, value.total) ||
    !isSafeIntegerInRange(value.pending, 0, value.total) ||
    !isSafeIntegerInRange(value.restricted, 0, value.total) ||
    !isSafeIntegerInRange(value.platforms, 0, 10_000) ||
    !isSafeIntegerInRange(value.categories, 0, 10_000) ||
    !isSafeIntegerInRange(value.dataTypes, 0, 10_000)
  ) {
    return false;
  }
  return value.available + value.pending + value.restricted === value.total;
}

function isFacetOption<T extends string>(
  value: unknown,
  valueValidator: (candidate: unknown) => candidate is T,
): value is FacetOption<T> {
  if (!isPlainRecord(value)) return false;
  return (
    valueValidator(value.value) &&
    isSafeText(value.label, 160) &&
    isSafeIntegerInRange(value.count, 0, 1_000_000)
  );
}

function isOpenFacetValue(value: unknown): value is string {
  return (
    isSafeText(value, 160) &&
    value.trim() === value &&
    !/[?&#=]/.test(value)
  );
}

function hasUniqueFacetValues<T extends string>(
  options: FacetOption<T>[],
): boolean {
  return new Set(options.map((option) => option.value)).size === options.length;
}

function isMarketplaceFacets(value: unknown): value is MarketplaceFacets {
  if (!isPlainRecord(value)) return false;
  const platforms = value.platforms;
  const tags = value.tags;
  const dataTypes = value.dataTypes;
  const methods = value.methods;
  const surfaces = value.surfaces;
  const availability = value.availability;
  if (
    !Array.isArray(platforms) ||
    !Array.isArray(tags) ||
    !Array.isArray(dataTypes) ||
    !Array.isArray(methods) ||
    !Array.isArray(surfaces) ||
    !Array.isArray(availability) ||
    platforms.length > MAX_FACET_OPTIONS ||
    tags.length > MAX_FACET_OPTIONS ||
    dataTypes.length > MAX_FACET_OPTIONS ||
    methods.length > 2 ||
    surfaces.length > 4 ||
    availability.length > 3
  ) {
    return false;
  }
  if (
    !platforms.every((option) =>
      isFacetOption(option, isOpenFacetValue),
    ) ||
    !tags.every((option) =>
      isFacetOption(option, isOpenFacetValue),
    ) ||
    !dataTypes.every((option) =>
      isFacetOption(option, isOpenFacetValue),
    ) ||
    !methods.every((option) => isFacetOption(option, isHttpMethod)) ||
    !surfaces.every((option) => isFacetOption(option, isSurface)) ||
    !availability.every((option) =>
      isFacetOption(option, isAvailability),
    )
  ) {
    return false;
  }
  return (
    hasUniqueFacetValues(platforms) &&
    hasUniqueFacetValues(tags) &&
    hasUniqueFacetValues(dataTypes) &&
    hasUniqueFacetValues(methods) &&
    hasUniqueFacetValues(surfaces) &&
    hasUniqueFacetValues(availability)
  );
}

function isMarketplaceEndpoint(
  value: unknown,
): value is MarketplaceEndpoint {
  if (!isPlainRecord(value)) return false;
  return (
    isSafeText(value.path, 600) &&
    value.path.startsWith("/v1/") &&
    !/\s/.test(value.path) &&
    isSafeText(value.platform, 160) &&
    isSafeText(value.dataType, 160) &&
    isHttpMethod(value.method) &&
    isSurface(value.surface) &&
    isAvailability(value.availability) &&
    isNullableText(value.summary, 1_000) &&
    (value.priceUsdMicros === null ||
      isSafeIntegerInRange(value.priceUsdMicros, 0, 100_000_000)) &&
    (value.rateLimitRpm === null ||
      isSafeIntegerInRange(value.rateLimitRpm, 1, 1_000_000))
  );
}

function isMarketplaceResponse(
  value: unknown,
  expectedOffset: number,
): value is MarketplaceResponse {
  if (!isPlainRecord(value)) return false;
  if (
    !isMarketplaceSource(value.source) ||
    !isMarketplaceStats(value.stats) ||
    !isMarketplaceFacets(value.facets) ||
    !Array.isArray(value.endpoints) ||
    !value.endpoints.every(isMarketplaceEndpoint) ||
    !isSafeIntegerInRange(value.total, 0, 1_000_000) ||
    !isSafeIntegerInRange(value.count, 0, PAGE_SIZE) ||
    value.count !== value.endpoints.length ||
    !isSafeIntegerInRange(value.offset, 0, 1_000_000) ||
    value.offset !== expectedOffset ||
    value.stats.total < value.total ||
    value.source.operationCount < value.stats.total
  ) {
    return false;
  }

  const endpointKeys = value.endpoints.map(
    (endpoint) => `${endpoint.method}:${endpoint.path}`,
  );
  if (new Set(endpointKeys).size !== endpointKeys.length) return false;

  const expectedNext =
    value.offset + value.count < value.total
      ? value.offset + value.count
      : null;
  return value.nextOffset === expectedNext;
}

function isBoundedJsonContainer(value: unknown): value is JsonContainer {
  if (!Array.isArray(value) && !isPlainRecord(value)) return false;
  const stack: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) {
      return false;
    }

    if (
      current.value === null ||
      typeof current.value === "boolean"
    ) {
      continue;
    }
    if (typeof current.value === "string") {
      if (!isSafeText(current.value, 100_000, true)) return false;
      continue;
    }
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) return false;
      if (
        Number.isInteger(current.value) &&
        !Number.isSafeInteger(current.value)
      ) {
        return false;
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > 1_000) return false;
      for (const child of current.value) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }
    if (!isPlainRecord(current.value)) return false;
    const entries = Object.entries(current.value);
    if (entries.length > 1_000) return false;
    for (const [key, child] of entries) {
      if (!isSafeText(key, 300, true)) return false;
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return true;
}

function isMarketplaceDetailResponse(
  value: unknown,
  selected: MarketplaceEndpoint,
  expectedSource: MarketplaceSource,
): value is MarketplaceDetailResponse {
  if (!isPlainRecord(value) || !isPlainRecord(value.endpoint)) return false;
  const endpoint = value.endpoint;
  if (
    !isMarketplaceSource(value.source) ||
    !marketplaceSourcesMatch(value.source, expectedSource) ||
    !isMarketplaceEndpoint(endpoint) ||
    endpoint.path !== selected.path ||
    endpoint.method !== selected.method ||
    !isNullableText(value.endpoint.description, 20_000) ||
    !Array.isArray(value.endpoint.tags) ||
    value.endpoint.tags.length > 100 ||
    !value.endpoint.tags.every(isOpenFacetValue) ||
    new Set(value.endpoint.tags).size !== value.endpoint.tags.length ||
    !isNullableText(value.endpoint.operationId, 500) ||
    !(
      value.endpoint.parameters === null ||
      isBoundedJsonContainer(value.endpoint.parameters)
    ) ||
    !(
      value.endpoint.requestBody === null ||
      isBoundedJsonContainer(value.endpoint.requestBody)
    ) ||
    !(
      value.endpoint.response === null ||
      isBoundedJsonContainer(value.endpoint.response)
    )
  ) {
    return false;
  }
  if (!isPlainRecord(value.examples)) return false;
  const examples = value.examples;
  return exampleLanguages.every((language) =>
    isSafeText(examples[language], 100_000),
  );
}

function marketplaceSourcesMatch(
  left: MarketplaceSource,
  right: MarketplaceSource,
): boolean {
  return (
    left.provider === right.provider &&
    left.openApiVersion === right.openApiVersion &&
    left.snapshotHash === right.snapshotHash &&
    left.generatedAt === right.generatedAt &&
    left.operationCount === right.operationCount
  );
}

function formatPrice(micros: number | null): string {
  if (micros === null) return "待定价";
  const value = (micros / 1_000_000)
    .toFixed(6)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  return `$${value || "0"}`;
}

function formatSourceDate(value: string | null): string {
  if (!value) return "等待运行时同步";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新时间不可用";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(date);
}

function formatMarketplaceTotal(total: number | undefined): string {
  if (total === undefined) return "—";
  return total.toLocaleString("zh-CN");
}

function surfaceLabel(surface: MarketplaceSurface): string {
  const labels: Record<MarketplaceSurface, string> = {
    app: "APP",
    web: "WEB",
    app_web: "APP + WEB",
    other: "其他",
  };
  return labels[surface];
}

function availabilityLabel(availability: Availability): string {
  const labels: Record<Availability, string> = {
    available: "可调用",
    pending: "待开放",
    restricted: "受限",
  };
  return labels[availability];
}

function jsonPreview(value: JsonContainer): string {
  return JSON.stringify(value, null, 2);
}

function facetLabel<T extends string>(
  options: FacetOption<T>[],
  value: T | string,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

async function writeToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand("copy")) throw new Error("copy_failed");
  } finally {
    textarea.remove();
  }
}

function LoadingCards() {
  return (
    <div
      className="marketplace-loading"
      role="status"
      aria-live="polite"
      aria-label="正在加载 API 服务"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <span key={index} aria-hidden="true" />
      ))}
    </div>
  );
}

function SchemaDocument({
  value,
  emptyLabel,
}: {
  value: JsonContainer | null;
  emptyLabel: string;
}) {
  if (value === null || (Array.isArray(value) && value.length === 0)) {
    return <p className="marketplace-schema-empty">{emptyLabel}</p>;
  }

  if (Array.isArray(value)) {
    return (
      <div className="marketplace-parameter-list">
        {value.map((item, index) => {
          const record = isPlainRecord(item) ? item : null;
          const name =
            record && typeof record.name === "string"
              ? record.name
              : `参数 ${index + 1}`;
          const location =
            record && typeof record.in === "string" ? record.in : null;
          const required =
            record && typeof record.required === "boolean"
              ? record.required
              : null;
          return (
            <article key={`${name}:${index}`}>
              <header>
                <code>{name}</code>
                <span>
                  {location ? location.toUpperCase() : "SCHEMA"}
                  {required === true ? " · 必填" : ""}
                </span>
              </header>
              <pre tabIndex={0}>{JSON.stringify(item, null, 2)}</pre>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <pre className="marketplace-schema-code" tabIndex={0}>
      {jsonPreview(value)}
    </pre>
  );
}

function DetailPanel({
  state,
  activeExample,
  onExampleChange,
  onClose,
  onRetry,
  onCopy,
  copyFeedback,
  headingRef,
}: {
  state: Exclude<DetailState, { status: "idle" }>;
  activeExample: ExampleLanguage;
  onExampleChange: (language: ExampleLanguage) => void;
  onClose: () => void;
  onRetry: () => void;
  onCopy: (id: string, value: string) => void;
  copyFeedback: CopyFeedback | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const endpoint =
    state.status === "ready" ? state.data.endpoint : state.endpoint;
  const title =
    endpoint.summary?.trim() ||
    endpoint.path.split("/").filter(Boolean).at(-1) ||
    "API 服务详情";

  return (
    <aside
      className="marketplace-detail"
      id="marketplace-detail-panel"
      aria-labelledby="marketplace-detail-title"
      aria-busy={state.status === "loading"}
    >
      <header className="marketplace-detail-head">
        <div>
          <span className="marketplace-detail-eyebrow">
            {endpoint.platform} / {endpoint.dataType}
          </span>
          <h2
            id="marketplace-detail-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {title}
          </h2>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭 API 详情">
          ×
        </button>
      </header>

      {state.status === "loading" ? (
        <div className="marketplace-detail-loading" role="status">
          <span aria-hidden="true" />
          <p>正在读取参数、响应状态与调用示例…</p>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="marketplace-detail-error" role="alert">
          <strong>详情暂时不可用</strong>
          <p>{state.message}</p>
          <button type="button" onClick={onRetry}>
            重新加载
          </button>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <div className="marketplace-detail-content">
          <div className="marketplace-detail-meta">
            <span
              className={`marketplace-method is-${endpoint.method.toLowerCase()}`}
            >
              {endpoint.method}
            </span>
            <span
              className={`marketplace-availability is-${endpoint.availability}`}
            >
              {availabilityLabel(endpoint.availability)}
            </span>
            <span>{surfaceLabel(endpoint.surface)}</span>
          </div>

          <div className="marketplace-detail-path">
            <code>{endpoint.path}</code>
            <button
              type="button"
              onClick={() => onCopy("detail-path", endpoint.path)}
              aria-label={`复制接口路径 ${endpoint.path}`}
            >
              {copyFeedback?.id === "detail-path"
                ? copyFeedback.status === "success"
                  ? "已复制"
                  : "复制失败"
                : "复制"}
            </button>
          </div>

          <dl className="marketplace-detail-taxonomy">
            <div>
              <dt>RelayBase 归一化类型</dt>
              <dd>{endpoint.dataType}</dd>
            </div>
            <div>
              <dt>RelayBase 能力 ID</dt>
              <dd>
                <code>
                  {state.data.endpoint.operationId || "未声明"}
                </code>
              </dd>
            </div>
            <div>
              <dt>能力分类</dt>
              <dd>
                {state.data.endpoint.tags.length > 0 ? (
                  <span className="marketplace-detail-tags">
                    {state.data.endpoint.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </span>
                ) : (
                  "未声明"
                )}
              </dd>
            </div>
          </dl>

          <div className="marketplace-detail-price">
            <div>
              <span>成功请求参考价</span>
              <strong>{formatPrice(endpoint.priceUsdMicros)}</strong>
            </div>
            <div>
              <span>建议速率</span>
              <strong>
                {endpoint.rateLimitRpm
                  ? `${endpoint.rateLimitRpm.toLocaleString()} RPM`
                  : "按账户策略"}
              </strong>
            </div>
          </div>

          <section aria-labelledby="marketplace-description-title">
            <h3 id="marketplace-description-title">服务说明</h3>
            <p className="marketplace-description">
              {state.data.endpoint.description ||
                endpoint.summary ||
                "该服务暂未提供补充说明，请以参数结构和响应示例为准。"}
            </p>
          </section>

          <section aria-labelledby="marketplace-parameters-title">
            <h3 id="marketplace-parameters-title">请求参数</h3>
            <SchemaDocument
              value={state.data.endpoint.parameters}
              emptyLabel="此接口没有额外的 URL 参数。"
            />
          </section>

          <section aria-labelledby="marketplace-body-title">
            <h3 id="marketplace-body-title">请求体</h3>
            <SchemaDocument
              value={state.data.endpoint.requestBody}
              emptyLabel={
                endpoint.method === "GET"
                  ? "GET 服务不需要请求体。"
                  : "此服务没有声明请求体结构。"
              }
            />
          </section>

          <section aria-labelledby="marketplace-response-title">
            <h3 id="marketplace-response-title">
              响应状态与上游 Schema 标识
            </h3>
            <SchemaDocument
              value={state.data.endpoint.response}
              emptyLabel="当前 RelayBase 契约未公开响应 Schema。"
            />
          </section>

          <section
            className="marketplace-examples"
            aria-labelledby="marketplace-examples-title"
          >
            <div className="marketplace-examples-head">
              <h3 id="marketplace-examples-title">调用示例</h3>
              <button
                type="button"
                onClick={() =>
                  onCopy(
                    `example-${activeExample}`,
                    state.data.examples[activeExample],
                  )
                }
              >
                {copyFeedback?.id === `example-${activeExample}`
                  ? copyFeedback.status === "success"
                    ? "已复制"
                    : "复制失败"
                  : "复制代码"}
              </button>
            </div>
            <div
              className="marketplace-example-tabs"
              role="group"
              aria-label="选择示例语言"
            >
              {exampleLanguages.map((language) => (
                <button
                  type="button"
                  className={activeExample === language ? "is-active" : ""}
                  aria-pressed={activeExample === language}
                  onClick={() => onExampleChange(language)}
                  key={language}
                >
                  {exampleLabels[language]}
                </button>
              ))}
            </div>
            <pre tabIndex={0}>
              <code>{state.data.examples[activeExample]}</code>
            </pre>
          </section>

          <Link className="marketplace-detail-cta" href="/console">
            获取 RelayBase API Key
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : null}
    </aside>
  );
}

export default function CatalogClient() {
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [offset, setOffset] = useState(0);
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<MarketplaceState>({
    status: "loading",
  });
  const [detailState, setDetailState] = useState<DetailState>({
    status: "idle",
  });
  const [detailVersion, setDetailVersion] = useState(0);
  const [activeExample, setActiveExample] =
    useState<ExampleLanguage>("curl");
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const copyTimer = useRef<number | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const detailReturnFocusRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextQuery = searchInput.trim();
      setQuery((current) => {
        if (current === nextQuery) return current;
        setOffset(0);
        setDetailState({ status: "idle" });
        return nextQuery;
      });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, MARKETPLACE_REQUEST_TIMEOUT_MS);
    const parameters = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (query) parameters.set("q", query);
    if (filters.platform) parameters.set("platform", filters.platform);
    if (filters.tag) parameters.set("tag", filters.tag);
    if (filters.dataType) parameters.set("dataType", filters.dataType);
    if (filters.method) parameters.set("method", filters.method);
    if (filters.surface) parameters.set("surface", filters.surface);
    if (filters.availability) {
      parameters.set("availability", filters.availability);
    }

    async function loadMarketplace() {
      setState({ status: "loading" });
      try {
        const response = await fetch(`/api/marketplace?${parameters}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`marketplace_http_${response.status}`);
        }
        const payload = await readBoundedJsonResponse(response);
        if (!isMarketplaceResponse(payload, offset)) {
          throw new Error("marketplace_shape_invalid");
        }
        const lastOffset =
          payload.total === 0
            ? 0
            : Math.floor((payload.total - 1) / PAGE_SIZE) * PAGE_SIZE;
        if (offset > lastOffset) {
          setOffset(lastOffset);
          return;
        }
        setState({ status: "ready", data: payload });
      } catch (error) {
        if (controller.signal.aborted && !timedOut) return;
        console.error("Unable to load the API marketplace", error);
        setState({
          status: "error",
          message:
            timedOut
              ? "API 市场读取超时，请稍后重试。你的账户、API Key 与余额不会受到影响。"
              : "API 市场暂时无法读取。你的账户、API Key 与余额不会受到影响。",
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void loadMarketplace();
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [filters, offset, query, requestVersion]);

  const selectedEndpoint =
    detailState.status === "idle" ? null : detailState.endpoint;
  const selectedSource =
    state.status === "ready" ? state.data.source : null;

  useEffect(() => {
    if (selectedEndpoint === null || selectedSource === null) return;
    const endpoint: MarketplaceEndpoint = selectedEndpoint;
    const expectedSource: MarketplaceSource = selectedSource;
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, MARKETPLACE_REQUEST_TIMEOUT_MS);
    const parameters = new URLSearchParams({
      path: endpoint.path,
      method: endpoint.method,
    });

    async function loadDetail() {
      setDetailState({ status: "loading", endpoint });
      try {
        const response = await fetch(
          `/api/marketplace/detail?${parameters}`,
          {
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new Error(`marketplace_detail_http_${response.status}`);
        }
        const payload = await readBoundedJsonResponse(response);
        if (
          !isMarketplaceDetailResponse(
            payload,
            endpoint,
            expectedSource,
          )
        ) {
          throw new Error("marketplace_detail_shape_invalid");
        }
        setDetailState({
          status: "ready",
          endpoint,
          data: payload,
        });
        window.requestAnimationFrame(() => {
          detailHeadingRef.current?.focus({ preventScroll: true });
          document
            .getElementById("marketplace-detail-panel")
            ?.scrollIntoView({
              behavior: window.matchMedia(
                "(prefers-reduced-motion: reduce)",
              ).matches
                ? "auto"
                : "smooth",
              block: "start",
            });
        });
      } catch (error) {
        if (controller.signal.aborted && !timedOut) return;
        console.error("Unable to load marketplace endpoint detail", error);
        setDetailState({
          status: "error",
          endpoint,
          message: timedOut
            ? "接口详情读取超时，请稍后重试。"
            : "无法验证该服务的详情数据，请稍后重试。",
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void loadDetail();
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [detailVersion, selectedEndpoint, selectedSource]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const marketplace = state.status === "ready" ? state.data : null;
  const facets = marketplace?.facets ?? null;
  const filtersActive =
    query.length > 0 ||
    Object.values(filters).some((value) => value.length > 0);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = marketplace
    ? Math.max(1, Math.ceil(marketplace.total / PAGE_SIZE))
    : 1;

  const sourceSummary = useMemo(() => {
    if (!marketplace) return null;
    return {
      provider: marketplace.source.provider,
      version: marketplace.source.openApiVersion ?? "版本待确认",
      snapshot: marketplace.source.snapshotHash
        ? marketplace.source.snapshotHash.slice(0, 10)
        : "未生成",
      generatedAt: formatSourceDate(marketplace.source.generatedAt),
    };
  }, [marketplace]);

  function updateFilter<Key extends keyof Filters>(
    key: Key,
    value: Filters[Key],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
    setOffset(0);
    setDetailState({ status: "idle" });
  }

  function clearFilters() {
    setSearchInput("");
    setQuery("");
    setFilters(initialFilters);
    setOffset(0);
    setDetailState({ status: "idle" });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = searchInput.trim();
    setQuery(nextQuery);
    setOffset(0);
    setDetailState({ status: "idle" });
  }

  function openDetail(
    endpoint: MarketplaceEndpoint,
    trigger: HTMLButtonElement,
  ) {
    detailReturnFocusRef.current = trigger;
    setActiveExample("curl");
    setDetailState({ status: "loading", endpoint });
    setDetailVersion((version) => version + 1);
  }

  function closeDetail() {
    setDetailState({ status: "idle" });
    window.requestAnimationFrame(() => {
      if (detailReturnFocusRef.current?.isConnected) {
        detailReturnFocusRef.current.focus({ preventScroll: true });
      }
    });
  }

  async function copyValue(id: string, value: string) {
    try {
      await writeToClipboard(value);
      setCopyFeedback({ id, status: "success" });
    } catch {
      setCopyFeedback({ id, status: "error" });
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(
      () => setCopyFeedback(null),
      2_600,
    );
  }

  return (
    <main className="marketplace-page" id="main-content">
      <section
        className="marketplace-masthead"
        aria-labelledby="marketplace-title"
      >
        <div className="marketplace-masthead-copy">
          <p className="section-kicker">RELAYBASE / API MARKETPLACE</p>
          <h1 id="marketplace-title">
            完整发现
            <span>审核开放的数据 API。</span>
          </h1>
          <p>
            搜索当前部署已同步的 RelayBase 服务，按平台、能力分类、归一化类型和
            调用表面精确筛选。只有完成安全审核与核价的服务才会进入代理并按成功
            请求计费。
          </p>
          <div className="marketplace-masthead-actions">
            <Link className="button button-blue button-large" href="/console">
              获取 API Key
              <span aria-hidden="true">→</span>
            </Link>
            <Link className="button button-ghost button-large" href="/docs">
              阅读调用文档
            </Link>
          </div>
        </div>

        <aside className="marketplace-source-card" aria-label="API 市场目录状态">
          <span>RUNTIME CATALOG</span>
          <strong>RelayBase Curated Catalog</strong>
          <dl>
            <div>
              <dt>来源</dt>
              <dd>管理后台运行时同步</dd>
            </div>
            <div>
              <dt>公开范围</dt>
              <dd>审核后的 RelayBase 契约</dd>
            </div>
            <div>
              <dt>最近更新</dt>
              <dd>{sourceSummary?.generatedAt ?? "读取中"}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="marketplace-stat-strip" aria-label="API 市场统计">
        <article>
          <span>API 服务</span>
          <strong>{formatMarketplaceTotal(marketplace?.stats.total)}</strong>
          <small>当前运行时目录</small>
        </article>
        <article>
          <span>数据平台</span>
          <strong>{marketplace?.stats.platforms ?? "—"}</strong>
          <small>统一接入</small>
        </article>
        <article>
          <span>能力分类</span>
          <strong>{marketplace?.stats.categories ?? "—"}</strong>
          <small>完整同步标签</small>
        </article>
        <article>
          <span>当前可用</span>
          <strong>{marketplace?.stats.available ?? "—"}</strong>
          <small>已核价服务</small>
        </article>
      </section>

      <section
        className="marketplace-browser"
        aria-labelledby="marketplace-results-title"
      >
        <div className="marketplace-filter-shell">
          <form
            className="marketplace-search"
            role="search"
            onSubmit={submitSearch}
          >
            <label htmlFor="marketplace-query">搜索 API 服务</label>
            <div>
              <span aria-hidden="true">⌕</span>
              <input
                id="marketplace-query"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="搜索平台、能力分类、服务名称或 /v1/ 路径"
                maxLength={160}
                autoComplete="off"
              />
              <button type="submit">搜索</button>
            </div>
          </form>

          <div className="marketplace-filters">
            <label>
              <span>平台</span>
              <select
                value={filters.platform}
                onChange={(event) =>
                  updateFilter("platform", event.target.value)
                }
              >
                <option value="">全部平台</option>
                {facets?.platforms.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label} · {option.count}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>能力分类</span>
              <select
                value={filters.tag}
                onChange={(event) =>
                  updateFilter("tag", event.target.value)
                }
              >
                <option value="">全部能力分类</option>
                {facets?.tags.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label} · {option.count}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>RelayBase 归一化类型</span>
              <select
                value={filters.dataType}
                onChange={(event) =>
                  updateFilter("dataType", event.target.value)
                }
              >
                <option value="">全部归一化类型</option>
                {facets?.dataTypes.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label} · {option.count}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>方法</span>
              <select
                value={filters.method}
                onChange={(event) =>
                  updateFilter(
                    "method",
                    event.target.value as Filters["method"],
                  )
                }
              >
                <option value="">GET + POST</option>
                {facets?.methods.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label} · {option.count}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>调用表面</span>
              <select
                value={filters.surface}
                onChange={(event) =>
                  updateFilter(
                    "surface",
                    event.target.value as Filters["surface"],
                  )
                }
              >
                <option value="">APP + WEB</option>
                {facets?.surfaces.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label} · {option.count}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>可用状态</span>
              <select
                value={filters.availability}
                onChange={(event) =>
                  updateFilter(
                    "availability",
                    event.target.value as Filters["availability"],
                  )
                }
              >
                <option value="">全部状态</option>
                {facets?.availability.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label} · {option.count}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="marketplace-clear"
              type="button"
              onClick={clearFilters}
              disabled={!filtersActive}
            >
              清除筛选
            </button>
          </div>
        </div>

        <header className="marketplace-results-head">
          <div>
            <span className="catalog-index">01</span>
            <div>
              <p className="section-kicker">DISCOVER / SERVER-SIDE RESULTS</p>
              <h2 id="marketplace-results-title">API 服务</h2>
            </div>
          </div>
          <p aria-live="polite">
            {marketplace ? (
              <>
                找到 <strong>{marketplace.total.toLocaleString()}</strong>{" "}
                项 · 第 {currentPage} / {totalPages} 页
              </>
            ) : (
              "正在统计结果"
            )}
          </p>
        </header>

        {state.status === "error" ? (
          <div className="marketplace-error" role="alert">
            <span aria-hidden="true">!</span>
            <div>
              <strong>API 市场连接失败</strong>
              <p>{state.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setRequestVersion((version) => version + 1)}
            >
              重新加载
            </button>
          </div>
        ) : null}

        <div
          className={`marketplace-results-layout ${
            selectedEndpoint ? "has-detail" : ""
          }`}
        >
          <div
            className="marketplace-results-column"
            aria-busy={state.status === "loading"}
          >
            {state.status === "loading" ? <LoadingCards /> : null}

            {marketplace && marketplace.endpoints.length > 0 ? (
              <ul className="marketplace-grid">
                {marketplace.endpoints.map((endpoint) => {
                  const selected =
                    selectedEndpoint?.path === endpoint.path &&
                    selectedEndpoint.method === endpoint.method;
                  return (
                    <li key={`${endpoint.method}:${endpoint.path}`}>
                      <article
                        className={`marketplace-card ${
                          selected ? "is-selected" : ""
                        }`}
                      >
                        <header>
                          <div>
                            <span
                              className={`marketplace-method is-${endpoint.method.toLowerCase()}`}
                            >
                              {endpoint.method}
                            </span>
                            <span
                              className={`marketplace-availability is-${endpoint.availability}`}
                            >
                              {availabilityLabel(endpoint.availability)}
                            </span>
                          </div>
                          <span className="marketplace-surface">
                            {surfaceLabel(endpoint.surface)}
                          </span>
                        </header>
                        <div className="marketplace-card-title">
                          <span>
                            {facets
                              ? facetLabel(
                                  facets.platforms,
                                  endpoint.platform,
                                )
                              : endpoint.platform}
                          </span>
                          <h3>
                            {endpoint.summary?.trim() ||
                              endpoint.path
                                .split("/")
                                .filter(Boolean)
                                .at(-1)}
                          </h3>
                          <code>{endpoint.path}</code>
                        </div>
                        <p>
                          {endpoint.summary ||
                            `${endpoint.platform} ${
                              facets
                                ? facetLabel(
                                    facets.dataTypes,
                                    endpoint.dataType,
                                  )
                                : endpoint.dataType
                            } 数据服务`}
                        </p>
                        <dl>
                          <div>
                            <dt>成功请求参考价</dt>
                            <dd>{formatPrice(endpoint.priceUsdMicros)}</dd>
                          </div>
                          <div>
                            <dt>速率</dt>
                            <dd>
                              {endpoint.rateLimitRpm
                                ? `${endpoint.rateLimitRpm.toLocaleString()} RPM`
                                : "按策略"}
                            </dd>
                          </div>
                          <div>
                            <dt>RelayBase 类型</dt>
                            <dd>
                              {facets
                                ? facetLabel(
                                    facets.dataTypes,
                                    endpoint.dataType,
                                  )
                                : endpoint.dataType}
                            </dd>
                          </div>
                        </dl>
                        <button
                          className="marketplace-card-open"
                          type="button"
                          onClick={(event) =>
                            openDetail(endpoint, event.currentTarget)
                          }
                          aria-expanded={selected}
                          aria-controls="marketplace-detail-panel"
                        >
                          查看接口详情
                          <span aria-hidden="true">→</span>
                        </button>
                      </article>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {marketplace && marketplace.endpoints.length === 0 ? (
              <div className="marketplace-empty">
                <span aria-hidden="true">00</span>
                <div>
                  <p className="section-kicker">
                    {filtersActive
                      ? "FILTER / NO MATCH"
                      : "MARKETPLACE / EMPTY"}
                  </p>
                  <h3>
                    {filtersActive
                      ? "没有找到符合条件的 API。"
                      : "API 市场正在准备服务目录。"}
                  </h3>
                  <p>
                    {filtersActive
                      ? "尝试减少筛选条件，或换一个平台、能力分类、归一化类型和关键词。"
                      : "完成运行时目录同步和安全核验后，服务会在这里出现。"}
                  </p>
                  {filtersActive ? (
                    <button type="button" onClick={clearFilters}>
                      查看全部 API
                    </button>
                  ) : (
                    <Link href="/docs">先阅读调用文档</Link>
                  )}
                </div>
              </div>
            ) : null}

            {marketplace && marketplace.total > 0 ? (
              <nav
                className="marketplace-pagination"
                aria-label="API 服务分页"
              >
                <button
                  type="button"
                  onClick={() => {
                    setOffset(Math.max(0, offset - PAGE_SIZE));
                    setDetailState({ status: "idle" });
                  }}
                  disabled={offset === 0}
                >
                  <span aria-hidden="true">←</span>
                  上一页
                </button>
                <span>
                  第 <strong>{currentPage}</strong> 页，共 {totalPages} 页
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (marketplace.nextOffset === null) return;
                    setOffset(marketplace.nextOffset);
                    setDetailState({ status: "idle" });
                  }}
                  disabled={marketplace.nextOffset === null}
                >
                  下一页
                  <span aria-hidden="true">→</span>
                </button>
              </nav>
            ) : null}
          </div>

          {detailState.status !== "idle" ? (
            <DetailPanel
              state={detailState}
              activeExample={activeExample}
              onExampleChange={setActiveExample}
              onClose={closeDetail}
              onRetry={() => setDetailVersion((version) => version + 1)}
              onCopy={(id, value) => void copyValue(id, value)}
              copyFeedback={copyFeedback}
              headingRef={detailHeadingRef}
            />
          ) : null}
        </div>

        <p className="marketplace-copy-status" aria-live="polite">
          {copyFeedback
            ? copyFeedback.status === "success"
              ? "内容已复制到剪贴板。"
              : "复制失败，请手动选择内容。"
            : ""}
        </p>
      </section>

      <section className="marketplace-footer-note">
        <div>
          <span aria-hidden="true">R/</span>
          <div>
            <strong>一个 Key，调用已审核开放的数据服务。</strong>
            <p>
              只有状态为“可调用”的服务会进入真实代理；待开放与受限服务仅用于能力发现。
            </p>
          </div>
        </div>
        <Link className="button button-lime" href="/pricing">
          查看透明定价
          <span aria-hidden="true">↗</span>
        </Link>
      </section>
    </main>
  );
}
