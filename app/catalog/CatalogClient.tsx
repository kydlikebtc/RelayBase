"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { PlatformIcon } from "../components/PlatformIcon";
import type { Locale } from "../locale";
import { platformDisplayName } from "../platform-names";

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

type MarketplaceCatalog = {
  revision: string;
  updatedAt: string | null;
  complete: boolean;
  serviceCount: number;
};

type MarketplacePricing = {
  amountUsdMicros: number | null;
  currency: "USD";
  unit: "request";
  verified: boolean;
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
  categories: FacetOption[];
  dataTypes: FacetOption[];
  methods: FacetOption<HttpMethod>[];
  surfaces: FacetOption<MarketplaceSurface>[];
  availability: FacetOption<Availability>[];
};

type MarketplaceEndpoint = {
  id: string;
  path: string;
  platform: string;
  dataType: string;
  method: HttpMethod | null;
  surface: MarketplaceSurface;
  availability: Availability;
  summary: string | null;
  pricing: MarketplacePricing;
  rateLimitRps: number | null;
  documentationStatus: "complete" | "pending";
};

type MarketplaceResponse = {
  catalog: MarketplaceCatalog;
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
  categories: string[];
  input: {
    parameters: JsonContainer | null;
    requestBody: JsonContainer | null;
  };
  response: {
    contentType: "application/json";
    mode: "relaybase_envelope";
    schema: null;
    description: string;
  };
};

type MarketplaceDetailResponse = {
  catalog: MarketplaceCatalog;
  endpoint: MarketplaceDetailEndpoint;
  examples: Record<ExampleLanguage, string>;
};

type MarketplaceState =
  | { status: "loading" }
  | { status: "refreshing"; data: MarketplaceResponse }
  | { status: "ready"; data: MarketplaceResponse }
  | { status: "error"; message: string; data?: MarketplaceResponse };

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
  category: string;
  dataType: string;
  method: "" | HttpMethod;
  surface: "" | MarketplaceSurface;
  availability: "" | Availability;
};

const initialFilters: Filters = {
  platform: "",
  category: "",
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

const catalogCopy = {
  en: {
    pendingPrice: "Price pending",
    surfaceOther: "Other",
    availability: {
      available: "Callable",
      pending: "Pending",
      restricted: "Restricted",
    },
    loadingProducts: "Loading data products",
    parameter: "Parameter",
    required: "Required",
    detailFallback: "Data product detail",
    closeDetail: "Close API detail",
    loadingDetail: "Loading parameters, response behavior and examples…",
    detailUnavailable: "Product detail is temporarily unavailable",
    reload: "Reload",
    methodPending: "Method pending",
    specComplete: "Specification complete",
    specPending: "Specification pending",
    copyPath: "Copy endpoint path",
    copied: "Copied",
    copyFailed: "Copy failed",
    copy: "Copy",
    normalizedType: "RelayBase normalized type",
    productId: "Product ID",
    capabilityCategories: "Capability categories",
    notDeclared: "Not declared",
    perRequestPrice: "Price per request",
    verifiedPrice: "Verified",
    priceVerificationPending: "Price verification pending",
    rateLimit: "Rate limit",
    accountPolicy: "Account policy",
    description: "Product description",
    descriptionFallback:
      "No additional description is available. Use the parameter structure and response behavior as the contract.",
    parameters: "Request parameters",
    parameterSpecPending: "Parameter specification is pending.",
    noUrlParameters: "This endpoint has no additional URL parameters.",
    requestBody: "Request body",
    bodySpecPending: "Request-body specification is pending.",
    noRequestBody: "This data product does not declare a request body.",
    responseFormat: "Response format",
    contentType: "Content type",
    responseMode: "Response mode",
    responseEnvelope: "RelayBase JSON envelope",
    responseFallback:
      "Successful requests return the RelayBase { success: true, data } JSON envelope.",
    examples: "Request examples",
    copyCode: "Copy code",
    selectExampleLanguage: "Select example language",
    examplesPending: "Examples are generated after the request method is confirmed.",
    createKey: "Create access Key",
    timeoutMarket:
      "The data market request timed out. Your account, access Key and balance are unaffected.",
    unavailableMarket:
      "The data market is temporarily unavailable. Your account, access Key and balance are unaffected.",
    timeoutDetail: "Product detail timed out. Try again shortly.",
    invalidDetail: "The product detail could not be verified. Try again shortly.",
    productFallback: "data product",
    rateByPolicy: "Policy-based limit",
    perRequest: " / request",
    pricingPending: " · pricing pending",
    viewDetail: "View product detail",
    mastheadTitle: "Multi-platform data market",
    mastheadBody:
      "Discover, compare and call curated data products by platform. Choose a source first, then inspect data types, price and callable capabilities.",
    marketOverview: "Market overview",
    dataProducts: "Data products",
    sourcePlatforms: "Source platforms",
    currentResults: "Current results",
    browseTitle: "Browse data products by platform",
    browseIntro:
      "Platforms are the primary entry to supply. Choose one, then narrow the catalog by data type.",
    items: "items",
    item: "item",
    page: "page",
    calculating: "Calculating results",
    searchLabel: "Search data products",
    searchPlaceholder: "Search platform, data type, product name or /v1/ path",
    search: "Search",
    moreFilters: "More filters",
    category: "Data category",
    allCategories: "All categories",
    method: "Method",
    surface: "Surface",
    availabilityLabel: "Availability",
    allStatuses: "All statuses",
    clearFilters: "Clear filters",
    marketConnectionFailed: "Data market connection failed",
    platformDirectory: "Data platform directory",
    choosePlatform: "Choose a platform",
    platformCount: "data platforms",
    browseByPlatform: "Browse APIs by platform",
    allPlatforms: "All platforms",
    fullMarket: "Complete data market",
    dataProduct: "Data products",
    selectedPlatform: "SELECTED PLATFORM",
    allPlatformTitle: "All platforms",
    activePlatformBody: (label: string) =>
      `Browse all ${label} data products, capabilities and prices.`,
    allPlatformBody:
      "Start with a platform, then narrow the supply by product capability.",
    productCount: "products",
    productCountSingle: "product",
    updating: "Updating products",
    dataType: "Data type",
    filterByType: "Filter by data type",
    allCapabilities: "All capabilities",
    noMatchTitle: "No data products match this platform and filter.",
    emptyTitle: "The data market is preparing its supply catalog.",
    noMatchBody: "Try another platform or remove one or more filters.",
    emptyBody:
      "Products will appear after catalog sync, safety review and price verification.",
    viewAll: "View all data products",
    readDocs: "Read the integration docs",
    pagination: "Data product pagination",
    previous: "Previous",
    of: "of",
    next: "Next",
    copySuccess: "Copied to clipboard.",
    copyError: "Copy failed. Select the content manually.",
    footerTitle: "One access Key for approved, callable data products.",
    footerBody:
      "Only callable products enter the live proxy. Pending and restricted products remain visible for supply discovery.",
    transparentPricing: "View transparent pricing",
  },
  zh: {
    pendingPrice: "待定价",
    surfaceOther: "其他",
    availability: { available: "可调用", pending: "待开放", restricted: "受限" },
    loadingProducts: "正在加载数据产品",
    parameter: "参数",
    required: "必填",
    detailFallback: "数据产品详情",
    closeDetail: "关闭 API 详情",
    loadingDetail: "正在读取参数、响应状态与调用示例…",
    detailUnavailable: "详情暂时不可用",
    reload: "重新加载",
    methodPending: "待确认",
    specComplete: "规范完整",
    specPending: "规范待补齐",
    copyPath: "复制接口路径",
    copied: "已复制",
    copyFailed: "复制失败",
    copy: "复制",
    normalizedType: "RelayBase 归一化类型",
    productId: "产品 ID",
    capabilityCategories: "能力分类",
    notDeclared: "未声明",
    perRequestPrice: "每次请求价格",
    verifiedPrice: "已核价",
    priceVerificationPending: "价格待核验",
    rateLimit: "速率上限",
    accountPolicy: "按账户策略",
    description: "产品说明",
    descriptionFallback: "该数据产品暂未提供补充说明，请以参数结构和响应示例为准。",
    parameters: "请求参数",
    parameterSpecPending: "参数规范待补齐。",
    noUrlParameters: "此接口没有额外的 URL 参数。",
    requestBody: "请求体",
    bodySpecPending: "请求体规范待补齐。",
    noRequestBody: "此数据产品没有声明请求体结构。",
    responseFormat: "响应格式",
    contentType: "内容类型",
    responseMode: "响应模式",
    responseEnvelope: "RelayBase JSON 包装",
    responseFallback: "成功时返回 RelayBase 的 { success: true, data } JSON 包装。",
    examples: "调用示例",
    copyCode: "复制代码",
    selectExampleLanguage: "选择示例语言",
    examplesPending: "请求方法确认后生成调用示例。",
    createKey: "创建访问 Key",
    timeoutMarket: "数据市场读取超时，请稍后重试。你的账户、访问 Key 与余额不会受到影响。",
    unavailableMarket: "数据市场暂时无法读取。你的账户、访问 Key 与余额不会受到影响。",
    timeoutDetail: "产品详情读取超时，请稍后重试。",
    invalidDetail: "无法验证该数据产品的详情，请稍后重试。",
    productFallback: "数据产品",
    rateByPolicy: "按策略限流",
    perRequest: " / 次",
    pricingPending: " · 待核价",
    viewDetail: "查看产品详情",
    mastheadTitle: "多平台数据市场",
    mastheadBody: "按平台发现、比较并调用经过审核的数据产品。先选择数据来源，再进入平台查看类型、价格与可用能力。",
    marketOverview: "市场概览",
    dataProducts: "数据产品",
    sourcePlatforms: "来源平台",
    currentResults: "当前结果",
    browseTitle: "按平台浏览数据产品",
    browseIntro: "平台是数据供给的一级入口；进入平台后，再按数据类型继续筛选。",
    items: "项",
    item: "项",
    page: "第",
    calculating: "正在统计结果",
    searchLabel: "搜索数据产品",
    searchPlaceholder: "搜索平台、数据分类、产品名称或 /v1/ 路径",
    search: "搜索",
    moreFilters: "更多筛选",
    category: "数据分类",
    allCategories: "全部数据分类",
    method: "方法",
    surface: "调用表面",
    availabilityLabel: "可用状态",
    allStatuses: "全部状态",
    clearFilters: "清除筛选",
    marketConnectionFailed: "数据市场连接失败",
    platformDirectory: "数据平台目录",
    choosePlatform: "选择平台",
    platformCount: "个数据平台",
    browseByPlatform: "按平台浏览 API",
    allPlatforms: "全部平台",
    fullMarket: "完整数据市场",
    dataProduct: "数据产品",
    selectedPlatform: "已选平台",
    allPlatformTitle: "全部平台",
    activePlatformBody: (label: string) => `浏览 ${label} 的全部数据产品、调用能力与价格。`,
    allPlatformBody: "从平台开始发现数据供给，并在平台内继续筛选产品能力。",
    productCount: "项产品",
    productCountSingle: "项产品",
    updating: "正在更新产品",
    dataType: "数据类型",
    filterByType: "按数据类型筛选",
    allCapabilities: "全部能力",
    noMatchTitle: "这个平台下暂时没有符合条件的数据产品。",
    emptyTitle: "数据市场正在准备供给目录。",
    noMatchBody: "试试切换平台、减少数据类型或其他筛选条件。",
    emptyBody: "完成目录同步、安全核验和价格复核后，数据产品会在这里出现。",
    viewAll: "查看全部数据产品",
    readDocs: "先阅读调用文档",
    pagination: "数据产品分页",
    previous: "上一页",
    of: "共",
    next: "下一页",
    copySuccess: "内容已复制到剪贴板。",
    copyError: "复制失败，请手动选择内容。",
    footerTitle: "一个访问 Key，消费已审核开放的数据产品。",
    footerBody: "只有状态为“可调用”的数据产品会进入真实代理；待开放与受限产品仅用于供给发现。",
    transparentPricing: "查看透明定价",
  },
} as const;

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

function isMarketplaceCatalog(value: unknown): value is MarketplaceCatalog {
  if (!isPlainRecord(value)) return false;
  return (
    isSafeText(value.revision, 160) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.revision) &&
    isIsoDateOrNull(value.updatedAt) &&
    typeof value.complete === "boolean" &&
    isSafeIntegerInRange(value.serviceCount, 0, 1_000_000)
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
  const categories = value.categories;
  const dataTypes = value.dataTypes;
  const methods = value.methods;
  const surfaces = value.surfaces;
  const availability = value.availability;
  if (
    !Array.isArray(platforms) ||
    !Array.isArray(categories) ||
    !Array.isArray(dataTypes) ||
    !Array.isArray(methods) ||
    !Array.isArray(surfaces) ||
    !Array.isArray(availability) ||
    platforms.length > MAX_FACET_OPTIONS ||
    categories.length > MAX_FACET_OPTIONS ||
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
    !categories.every((option) =>
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
    hasUniqueFacetValues(categories) &&
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
  const pricing = value.pricing;
  return (
    isSafeText(value.id, 160) &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value.id) &&
    isSafeText(value.path, 600) &&
    value.path.startsWith("/v1/") &&
    !/\s/.test(value.path) &&
    isSafeText(value.platform, 160) &&
    isSafeText(value.dataType, 160) &&
    (value.method === null || isHttpMethod(value.method)) &&
    isSurface(value.surface) &&
    isAvailability(value.availability) &&
    isNullableText(value.summary, 1_000) &&
    isPlainRecord(pricing) &&
    (pricing.amountUsdMicros === null ||
      isSafeIntegerInRange(pricing.amountUsdMicros, 0, 100_000_000)) &&
    pricing.currency === "USD" &&
    pricing.unit === "request" &&
    typeof pricing.verified === "boolean" &&
    (!pricing.verified || pricing.amountUsdMicros !== null) &&
    (value.rateLimitRps === null ||
      isSafeIntegerInRange(value.rateLimitRps, 1, 1_000_000)) &&
    (value.documentationStatus === "complete" ||
      value.documentationStatus === "pending")
  );
}

function isMarketplaceResponse(
  value: unknown,
  expectedOffset: number,
): value is MarketplaceResponse {
  if (!isPlainRecord(value)) return false;
  if (
    !isMarketplaceCatalog(value.catalog) ||
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
    value.catalog.serviceCount < value.stats.total
  ) {
    return false;
  }

  const endpointKeys = value.endpoints.map((endpoint) => endpoint.id);
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
  expectedCatalog: MarketplaceCatalog,
): value is MarketplaceDetailResponse {
  if (!isPlainRecord(value) || !isPlainRecord(value.endpoint)) return false;
  const endpoint = value.endpoint;
  if (
    !isMarketplaceCatalog(value.catalog) ||
    !marketplaceCatalogsMatch(value.catalog, expectedCatalog) ||
    !isMarketplaceEndpoint(endpoint) ||
    endpoint.id !== selected.id ||
    !isNullableText(value.endpoint.description, 20_000) ||
    !Array.isArray(value.endpoint.categories) ||
    value.endpoint.categories.length > 100 ||
    !value.endpoint.categories.every(isOpenFacetValue) ||
    new Set(value.endpoint.categories).size !==
      value.endpoint.categories.length ||
    !isPlainRecord(value.endpoint.input) ||
    !(
      value.endpoint.input.parameters === null ||
      isBoundedJsonContainer(value.endpoint.input.parameters)
    ) ||
    !(
      value.endpoint.input.requestBody === null ||
      isBoundedJsonContainer(value.endpoint.input.requestBody)
    ) ||
    !isPlainRecord(value.endpoint.response) ||
    value.endpoint.response.contentType !== "application/json" ||
    value.endpoint.response.mode !== "relaybase_envelope" ||
    value.endpoint.response.schema !== null ||
    !isSafeText(value.endpoint.response.description, 2_000)
  ) {
    return false;
  }
  if (!isPlainRecord(value.examples)) return false;
  const examples = value.examples;
  return exampleLanguages.every((language) =>
    isSafeText(examples[language], 100_000, true),
  );
}

function marketplaceCatalogsMatch(
  left: MarketplaceCatalog,
  right: MarketplaceCatalog,
): boolean {
  return (
    left.revision === right.revision &&
    left.updatedAt === right.updatedAt &&
    left.complete === right.complete &&
    left.serviceCount === right.serviceCount
  );
}

function formatPrice(micros: number | null, locale: Locale): string {
  if (micros === null) return catalogCopy[locale].pendingPrice;
  const value = (micros / 1_000_000)
    .toFixed(6)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  return `$${value || "0"}`;
}

function formatMarketplaceTotal(
  total: number | undefined,
  locale: Locale,
): string {
  if (total === undefined) return "—";
  return total.toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
}

function surfaceLabel(
  surface: MarketplaceSurface,
  locale: Locale,
): string {
  const labels: Record<MarketplaceSurface, string> = {
    app: "APP",
    web: "WEB",
    app_web: "APP + WEB",
    other: catalogCopy[locale].surfaceOther,
  };
  return labels[surface];
}

function availabilityLabel(
  availability: Availability,
  locale: Locale,
): string {
  return catalogCopy[locale].availability[availability];
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

function humanizeFacet(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function localizedFacetLabel<T extends string>(
  options: FacetOption<T>[],
  value: T | string,
  locale: Locale,
): string {
  const label = facetLabel(options, value);
  const languageParts = label
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (languageParts.length > 1) {
    return locale === "zh"
      ? (languageParts.find((part) => /[\u3400-\u9FFF]/.test(part)) ??
        languageParts[0])
      : (languageParts.find(
          (part) => !/[\u3400-\u9FFF]/.test(part),
        ) ?? humanizeFacet(String(value)));
  }
  if (locale === "zh" || !/[\u3400-\u9FFF]/.test(label)) return label;
  return humanizeFacet(String(value));
}

function localizedSourceText(
  value: string | null,
  locale: Locale,
  fallback: string,
): string {
  if (!value?.trim()) return fallback;
  if (locale === "en" && /[\u3400-\u9FFF]/.test(value)) return fallback;
  return value;
}

function endpointDisplayName(path: string): string {
  const segment = path.split("/").filter(Boolean).at(-1) ?? "API Service";
  return segment
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
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

function LoadingCards({ locale }: { locale: Locale }) {
  return (
    <div
      className="marketplace-loading"
      role="status"
      aria-live="polite"
      aria-label={catalogCopy[locale].loadingProducts}
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
  locale,
}: {
  value: JsonContainer | null;
  emptyLabel: string;
  locale: Locale;
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
              : `${catalogCopy[locale].parameter} ${index + 1}`;
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
                  {required === true
                    ? ` · ${catalogCopy[locale].required}`
                    : ""}
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
  locale,
  activeExample,
  onExampleChange,
  onClose,
  onRetry,
  onCopy,
  copyFeedback,
  headingRef,
}: {
  state: Exclude<DetailState, { status: "idle" }>;
  locale: Locale;
  activeExample: ExampleLanguage;
  onExampleChange: (language: ExampleLanguage) => void;
  onClose: () => void;
  onRetry: () => void;
  onCopy: (id: string, value: string) => void;
  copyFeedback: CopyFeedback | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const c = catalogCopy[locale];
  const endpoint =
    state.status === "ready" ? state.data.endpoint : state.endpoint;
  const title = localizedSourceText(
    endpoint.summary,
    locale,
    endpointDisplayName(endpoint.path) || c.detailFallback,
  );

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
        <button type="button" onClick={onClose} aria-label={c.closeDetail}>
          ×
        </button>
      </header>

      {state.status === "loading" ? (
        <div className="marketplace-detail-loading" role="status">
          <span aria-hidden="true" />
          <p>{c.loadingDetail}</p>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="marketplace-detail-error" role="alert">
          <strong>{c.detailUnavailable}</strong>
          <p>{state.message}</p>
          <button type="button" onClick={onRetry}>
            {c.reload}
          </button>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <div className="marketplace-detail-content">
          <div className="marketplace-detail-meta">
            <span
              className={`marketplace-method ${
                endpoint.method
                  ? `is-${endpoint.method.toLowerCase()}`
                  : "is-pending"
              }`}
            >
              {endpoint.method ?? c.methodPending}
            </span>
            <span
              className={`marketplace-availability is-${endpoint.availability}`}
            >
              {availabilityLabel(endpoint.availability, locale)}
            </span>
            <span>{surfaceLabel(endpoint.surface, locale)}</span>
            <span>
              {endpoint.documentationStatus === "complete"
                ? c.specComplete
                : c.specPending}
            </span>
          </div>

          <div className="marketplace-detail-path">
            <code>{endpoint.path}</code>
            <button
              type="button"
              onClick={() => onCopy("detail-path", endpoint.path)}
              aria-label={`${c.copyPath} ${endpoint.path}`}
            >
              {copyFeedback?.id === "detail-path"
                ? copyFeedback.status === "success"
                  ? c.copied
                  : c.copyFailed
                : c.copy}
            </button>
          </div>

          <dl className="marketplace-detail-taxonomy">
            <div>
              <dt>{c.normalizedType}</dt>
              <dd>{endpoint.dataType}</dd>
            </div>
            <div>
              <dt>{c.productId}</dt>
              <dd>
                <code>{endpoint.id}</code>
              </dd>
            </div>
            <div>
              <dt>{c.capabilityCategories}</dt>
              <dd>
                {state.data.endpoint.categories.length > 0 ? (
                  <span className="marketplace-detail-tags">
                    {state.data.endpoint.categories.map((category) => (
                      <span key={category}>{category}</span>
                    ))}
                  </span>
                ) : (
                  c.notDeclared
                )}
              </dd>
            </div>
          </dl>

          <div className="marketplace-detail-price">
            <div>
              <span>{c.perRequestPrice}</span>
              <strong>
                {formatPrice(endpoint.pricing.amountUsdMicros, locale)}
              </strong>
              <small>
                {endpoint.pricing.verified
                  ? c.verifiedPrice
                  : c.priceVerificationPending}
              </small>
            </div>
            <div>
              <span>{c.rateLimit}</span>
              <strong>
                {endpoint.rateLimitRps
                  ? `${endpoint.rateLimitRps.toLocaleString()} RPS`
                  : c.accountPolicy}
              </strong>
            </div>
          </div>

          <section aria-labelledby="marketplace-description-title">
            <h3 id="marketplace-description-title">{c.description}</h3>
            <p className="marketplace-description">
              {localizedSourceText(
                state.data.endpoint.description || endpoint.summary,
                locale,
                c.descriptionFallback,
              )}
            </p>
          </section>

          <section aria-labelledby="marketplace-parameters-title">
            <h3 id="marketplace-parameters-title">{c.parameters}</h3>
            <SchemaDocument
              value={state.data.endpoint.input.parameters}
              locale={locale}
              emptyLabel={
                endpoint.documentationStatus === "pending"
                  ? c.parameterSpecPending
                  : c.noUrlParameters
              }
            />
          </section>

          {endpoint.method !== "GET" ? (
            <section aria-labelledby="marketplace-body-title">
              <h3 id="marketplace-body-title">{c.requestBody}</h3>
              <SchemaDocument
                value={state.data.endpoint.input.requestBody}
                locale={locale}
                emptyLabel={
                  endpoint.documentationStatus === "pending"
                    ? c.bodySpecPending
                    : c.noRequestBody
                }
              />
            </section>
          ) : null}

          <section
            className="marketplace-response-section"
            aria-labelledby="marketplace-response-title"
          >
            <h3 id="marketplace-response-title">{c.responseFormat}</h3>
            <div className="marketplace-response-card">
              <dl>
                <div>
                  <dt>{c.contentType}</dt>
                  <dd>
                    <code>{state.data.endpoint.response.contentType}</code>
                  </dd>
                </div>
                <div>
                  <dt>{c.responseMode}</dt>
                  <dd>{c.responseEnvelope}</dd>
                </div>
              </dl>
              <p>
                {localizedSourceText(
                  state.data.endpoint.response.description,
                  locale,
                  c.responseFallback,
                )}
              </p>
            </div>
          </section>

          <section
            className="marketplace-examples"
            aria-labelledby="marketplace-examples-title"
          >
            {exampleLanguages.some(
              (language) => state.data.examples[language].trim().length > 0,
            ) ? (
              <>
                <div className="marketplace-examples-head">
                  <h3 id="marketplace-examples-title">{c.examples}</h3>
                  <button
                    type="button"
                    onClick={() =>
                      onCopy(
                        `example-${activeExample}`,
                        state.data.examples[activeExample],
                      )
                    }
                    disabled={
                      state.data.examples[activeExample].trim().length === 0
                    }
                  >
                    {copyFeedback?.id === `example-${activeExample}`
                      ? copyFeedback.status === "success"
                        ? c.copied
                        : c.copyFailed
                      : c.copyCode}
                  </button>
                </div>
                <div
                  className="marketplace-example-tabs"
                  role="group"
                  aria-label={c.selectExampleLanguage}
                >
                  {exampleLanguages.map((language) => (
                    <button
                      type="button"
                      className={activeExample === language ? "is-active" : ""}
                      aria-pressed={activeExample === language}
                      onClick={() => onExampleChange(language)}
                      disabled={
                        state.data.examples[language].trim().length === 0
                      }
                      key={language}
                    >
                      {exampleLabels[language]}
                    </button>
                  ))}
                </div>
                <pre tabIndex={0}>
                  <code>{state.data.examples[activeExample]}</code>
                </pre>
              </>
            ) : (
              <>
                <h3 id="marketplace-examples-title">{c.examples}</h3>
                <p className="marketplace-schema-empty">
                  {c.examplesPending}
                </p>
              </>
            )}
          </section>

          <a className="marketplace-detail-cta" href="/console">
            {c.createKey}
            <span aria-hidden="true">→</span>
          </a>
        </div>
      ) : null}
    </aside>
  );
}

export default function CatalogClient({ locale }: { locale: Locale }) {
  const c = catalogCopy[locale];
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
    if (filters.category) parameters.set("category", filters.category);
    if (filters.dataType) parameters.set("dataType", filters.dataType);
    if (filters.method) parameters.set("method", filters.method);
    if (filters.surface) parameters.set("surface", filters.surface);
    if (filters.availability) {
      parameters.set("availability", filters.availability);
    }

    async function loadMarketplace() {
      setState((current) =>
        current.status === "ready" || current.status === "refreshing"
          ? { status: "refreshing", data: current.data }
          : current.status === "error" && current.data
            ? { status: "refreshing", data: current.data }
            : { status: "loading" },
      );
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
        if (
          !timedOut &&
          (controller.signal.aborted ||
            (error instanceof DOMException && error.name === "AbortError"))
        ) {
          return;
        }
        console.error("Unable to load the API marketplace", error);
        setState((current) => ({
          status: "error",
          message: timedOut ? c.timeoutMarket : c.unavailableMarket,
          data:
            current.status === "ready" ||
            current.status === "refreshing" ||
            (current.status === "error" && current.data)
              ? current.data
              : undefined,
        }));
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void loadMarketplace();
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [c.timeoutMarket, c.unavailableMarket, filters, offset, query, requestVersion]);

  const selectedEndpoint =
    detailState.status === "idle" ? null : detailState.endpoint;
  const selectedCatalog =
    state.status === "ready" || state.status === "refreshing"
      ? state.data.catalog
      : state.status === "error" && state.data
        ? state.data.catalog
        : null;

  useEffect(() => {
    if (selectedEndpoint === null || selectedCatalog === null) return;
    const endpoint: MarketplaceEndpoint = selectedEndpoint;
    const expectedCatalog: MarketplaceCatalog = selectedCatalog;
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, MARKETPLACE_REQUEST_TIMEOUT_MS);
    const parameters = new URLSearchParams({ path: endpoint.path });
    if (endpoint.method) parameters.set("method", endpoint.method);

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
            expectedCatalog,
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
        if (
          !timedOut &&
          (controller.signal.aborted ||
            (error instanceof DOMException && error.name === "AbortError"))
        ) {
          return;
        }
        console.error("Unable to load marketplace endpoint detail", error);
        setDetailState({
          status: "error",
          endpoint,
          message: timedOut ? c.timeoutDetail : c.invalidDetail,
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
  }, [c.invalidDetail, c.timeoutDetail, detailVersion, selectedCatalog, selectedEndpoint]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const marketplace =
    state.status === "ready" || state.status === "refreshing"
      ? state.data
      : state.status === "error" && state.data
        ? state.data
        : null;
  const isRefreshing = state.status === "refreshing";
  const facets = marketplace?.facets ?? null;
  const filtersActive =
    query.length > 0 ||
    Object.values(filters).some((value) => value.length > 0);
  const advancedFilterCount = [
    filters.category,
    filters.dataType,
    filters.method,
    filters.surface,
    filters.availability,
  ].filter((value) => value.length > 0).length;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = marketplace
    ? Math.max(1, Math.ceil(marketplace.total / PAGE_SIZE))
    : 1;
  const activePlatform =
    facets?.platforms.find(
      (option) => option.value === filters.platform,
    ) ?? null;
  const platformCatalogTotal =
    facets?.platforms.reduce((sum, option) => sum + option.count, 0) ?? 0;

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

  function renderEndpointCard(endpoint: MarketplaceEndpoint) {
    const selected = selectedEndpoint?.id === endpoint.id;
    const platformLabel = facets
      ? platformDisplayName(
          endpoint.platform,
          facetLabel(facets.platforms, endpoint.platform),
          locale,
        )
      : platformDisplayName(endpoint.platform, null, locale);
    const dataTypeLabel = facets
      ? localizedFacetLabel(facets.dataTypes, endpoint.dataType, locale)
      : locale === "en"
        ? humanizeFacet(endpoint.dataType)
        : endpoint.dataType;
    return (
      <article
        className={`marketplace-card ${selected ? "is-selected" : ""}`}
      >
        <header className="marketplace-card-brand">
          <div className="marketplace-card-platform">
            <PlatformIcon
              platform={endpoint.platform}
              className="marketplace-card-platform-icon"
            />
            <div>
              <strong>{platformLabel}</strong>
              <small>{dataTypeLabel}</small>
            </div>
          </div>
          <div className="marketplace-card-badges">
            <span
              className={`marketplace-method ${
                endpoint.method
                  ? `is-${endpoint.method.toLowerCase()}`
                  : "is-pending"
              }`}
            >
              {endpoint.method ?? c.methodPending}
            </span>
            <span
              className={`marketplace-availability is-${endpoint.availability}`}
            >
              {availabilityLabel(endpoint.availability, locale)}
            </span>
            {endpoint.documentationStatus === "pending" ? (
              <span className="marketplace-availability is-pending">
                {c.specPending}
              </span>
            ) : null}
          </div>
        </header>
        <div className="marketplace-card-body">
          <h3>{endpointDisplayName(endpoint.path)}</h3>
          <p>
            {localizedSourceText(
              endpoint.summary,
              locale,
              `${platformLabel} ${dataTypeLabel} ${c.productFallback}`,
            )}
          </p>
          <code title={endpoint.path}>{endpoint.path}</code>
        </div>
        <div className="marketplace-card-meta">
          <span>
            <i
              className={`is-${endpoint.availability}`}
              aria-hidden="true"
            />
            {surfaceLabel(endpoint.surface, locale)} ·{" "}
            {endpoint.rateLimitRps
              ? `${endpoint.rateLimitRps.toLocaleString()} RPS`
              : c.rateByPolicy}
          </span>
          <strong>
            {formatPrice(endpoint.pricing.amountUsdMicros, locale)}
            <small>
              {endpoint.pricing.verified ? c.perRequest : c.pricingPending}
            </small>
          </strong>
        </div>
        <button
          className="marketplace-card-open"
          type="button"
          onClick={(event) => openDetail(endpoint, event.currentTarget)}
          aria-expanded={selected}
          aria-controls="marketplace-detail-panel"
        >
          {c.viewDetail}
          <span aria-hidden="true">→</span>
        </button>
      </article>
    );
  }

  return (
    <main className="marketplace-page" id="main-content">
      <section
        className="marketplace-masthead"
        aria-labelledby="marketplace-title"
      >
        <div className="marketplace-masthead-copy">
          <p className="section-kicker">RELAYBASE / DATA MARKETPLACE</p>
          <h1 id="marketplace-title">{c.mastheadTitle}</h1>
          <p>{c.mastheadBody}</p>
          <dl className="marketplace-market-facts" aria-label={c.marketOverview}>
            <div>
              <dt>{c.dataProducts}</dt>
              <dd>
                {formatMarketplaceTotal(
                  marketplace?.catalog.serviceCount,
                  locale,
                )}
              </dd>
            </div>
            <div>
              <dt>{c.sourcePlatforms}</dt>
              <dd>{marketplace?.stats.platforms ?? "—"}</dd>
            </div>
            <div>
              <dt>{c.currentResults}</dt>
              <dd>{marketplace?.total.toLocaleString() ?? "—"}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section
        className="marketplace-browser"
        aria-labelledby="marketplace-results-title"
      >
        <header className="marketplace-results-head">
          <div>
            <div>
              <p className="section-kicker">DISCOVER / PLATFORMS</p>
              <h2 id="marketplace-results-title">{c.browseTitle}</h2>
              <p className="marketplace-results-intro">{c.browseIntro}</p>
            </div>
          </div>
          <p aria-live="polite">
            {marketplace ? (
              <>
                <strong>{marketplace.total.toLocaleString()}</strong>{" "}
                {marketplace.total === 1 ? c.item : c.items} ·{" "}
                {locale === "zh" ? "第 " : ""}
                {currentPage} / {totalPages} {locale === "zh" ? "页" : ""}
              </>
            ) : (
              c.calculating
            )}
          </p>
        </header>

        <div className="marketplace-filter-shell">
          <form
            className="marketplace-search"
            role="search"
            onSubmit={submitSearch}
          >
            <label htmlFor="marketplace-query">{c.searchLabel}</label>
            <div>
              <span aria-hidden="true">⌕</span>
              <input
                id="marketplace-query"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={c.searchPlaceholder}
                maxLength={160}
                autoComplete="off"
              />
              <button type="submit">{c.search}</button>
            </div>
          </form>

          <details className="marketplace-filter-disclosure">
            <summary>
              <span>
                {c.moreFilters}
                {advancedFilterCount > 0 ? (
                  <b>{advancedFilterCount}</b>
                ) : null}
              </span>
              <i aria-hidden="true">＋</i>
            </summary>
            <div className="marketplace-filters">
              <label>
                <span>{c.category}</span>
                <select
                  value={filters.category}
                  onChange={(event) =>
                    updateFilter("category", event.target.value)
                  }
                >
                  <option value="">{c.allCategories}</option>
                  {facets?.categories.map((option) => (
                    <option value={option.value} key={option.value}>
                      {localizedFacetLabel(
                        facets.categories,
                        option.value,
                        locale,
                      )} · {option.count}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{c.method}</span>
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
                <span>{c.surface}</span>
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
                      {surfaceLabel(option.value, locale)} · {option.count}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{c.availabilityLabel}</span>
                <select
                  value={filters.availability}
                  onChange={(event) =>
                    updateFilter(
                      "availability",
                      event.target.value as Filters["availability"],
                    )
                  }
                >
                  <option value="">{c.allStatuses}</option>
                  {facets?.availability.map((option) => (
                    <option value={option.value} key={option.value}>
                      {availabilityLabel(option.value, locale)} · {option.count}
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
                {c.clearFilters}
              </button>
            </div>
          </details>
        </div>

        {state.status === "error" ? (
          <div className="marketplace-error" role="alert">
            <span aria-hidden="true">!</span>
            <div>
              <strong>{c.marketConnectionFailed}</strong>
              <p>{state.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setRequestVersion((version) => version + 1)}
            >
              {c.reload}
            </button>
          </div>
        ) : null}

        <div className="marketplace-platform-browser">
          <aside
            className="marketplace-platform-directory"
            aria-label={c.platformDirectory}
          >
            <header>
              <span>PLATFORMS</span>
              <strong>{c.choosePlatform}</strong>
              <small>{facets?.platforms.length ?? "—"} {c.platformCount}</small>
            </header>
            <nav aria-label={c.browseByPlatform}>
              <button
                className={filters.platform === "" ? "is-active" : ""}
                type="button"
                onClick={() => updateFilter("platform", "")}
                aria-pressed={filters.platform === ""}
              >
                <PlatformIcon
                  platform="all"
                  className="marketplace-platform-code"
                />
                <span>
                  <strong>{c.allPlatforms}</strong>
                  <small>{c.fullMarket}</small>
                </span>
                <b>{platformCatalogTotal.toLocaleString()}</b>
              </button>
              {facets?.platforms.map((option) => (
                <button
                  className={
                    filters.platform === option.value ? "is-active" : ""
                  }
                  type="button"
                  onClick={() => updateFilter("platform", option.value)}
                  aria-pressed={filters.platform === option.value}
                  key={option.value}
                >
                  <PlatformIcon
                    platform={option.value}
                    className="marketplace-platform-code"
                  />
                  <span>
                    <strong>
                      {platformDisplayName(
                        option.value,
                        option.label,
                        locale,
                      )}
                    </strong>
                    <small>{c.dataProduct}</small>
                  </span>
                  <b>{option.count.toLocaleString()}</b>
                </button>
              ))}
            </nav>
          </aside>

          <div className="marketplace-platform-content">
            {isRefreshing ? (
              <div
                className="marketplace-refresh-indicator"
                role="status"
                aria-live="polite"
              >
                <span aria-hidden="true" />
                <em>{c.updating}</em>
              </div>
            ) : null}
            <header className="marketplace-platform-summary">
              <PlatformIcon
                platform={activePlatform?.value ?? "all"}
                className="marketplace-platform-hero-code"
              />
              <div>
                <small>{c.selectedPlatform}</small>
                <h3>
                  {activePlatform
                    ? platformDisplayName(
                        activePlatform.value,
                        activePlatform.label,
                        locale,
                      )
                    : c.allPlatformTitle}
                </h3>
                <p>
                  {activePlatform
                    ? c.activePlatformBody(
                        platformDisplayName(
                          activePlatform.value,
                          activePlatform.label,
                          locale,
                        ),
                      )
                    : c.allPlatformBody}
                </p>
              </div>
              <strong>
                {marketplace
                  ? `${marketplace.total.toLocaleString()} ${
                      marketplace.total === 1
                        ? c.productCountSingle
                        : c.productCount
                    }`
                  : c.calculating}
              </strong>
            </header>

            {facets && facets.dataTypes.length > 0 ? (
              <div className="marketplace-type-chips">
                <span>{c.dataType}</span>
                <div role="group" aria-label={c.filterByType}>
                  <button
                    className={
                      filters.dataType === "" ? "is-active" : ""
                    }
                    type="button"
                    onClick={() => updateFilter("dataType", "")}
                    aria-pressed={filters.dataType === ""}
                  >
                    {c.allCapabilities}
                  </button>
                  {facets.dataTypes.map((option) => (
                    <button
                      className={
                        filters.dataType === option.value
                          ? "is-active"
                          : ""
                      }
                      type="button"
                      onClick={() =>
                        updateFilter(
                          "dataType",
                          filters.dataType === option.value
                            ? ""
                            : option.value,
                        )
                      }
                      aria-pressed={filters.dataType === option.value}
                      key={option.value}
                    >
                      {localizedFacetLabel(
                        facets.dataTypes,
                        option.value,
                        locale,
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div
              className={`marketplace-results-layout ${
                selectedEndpoint ? "has-detail" : ""
              }`}
            >
              <div
                className="marketplace-results-column"
                aria-busy={
                  state.status === "loading" || state.status === "refreshing"
                }
              >
                {state.status === "loading" ? (
                  <LoadingCards locale={locale} />
                ) : null}

                {marketplace && marketplace.endpoints.length > 0 ? (
                  <ul className="marketplace-grid">
                    {marketplace.endpoints.map((endpoint) => (
                      <li key={endpoint.id}>
                        {renderEndpointCard(endpoint)}
                      </li>
                    ))}
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
                          ? c.noMatchTitle
                          : c.emptyTitle}
                      </h3>
                      <p>
                        {filtersActive
                          ? c.noMatchBody
                          : c.emptyBody}
                      </p>
                      {filtersActive ? (
                        <button type="button" onClick={clearFilters}>
                          {c.viewAll}
                        </button>
                      ) : (
                        <Link href="/docs">{c.readDocs}</Link>
                      )}
                    </div>
                  </div>
                ) : null}

                {marketplace && marketplace.total > 0 ? (
                  <nav
                    className="marketplace-pagination"
                    aria-label={c.pagination}
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
                      {c.previous}
                    </button>
                    <span>
                      {locale === "zh" ? "第" : ""}{" "}
                      <strong>{currentPage}</strong>{" "}
                      {locale === "zh" ? `页，${c.of}` : c.of} {totalPages}{" "}
                      {locale === "zh" ? "页" : ""}
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
                      {c.next}
                      <span aria-hidden="true">→</span>
                    </button>
                  </nav>
                ) : null}
              </div>

              {detailState.status !== "idle" ? (
                <DetailPanel
                  state={detailState}
                  locale={locale}
                  activeExample={activeExample}
                  onExampleChange={setActiveExample}
                  onClose={closeDetail}
                  onRetry={() =>
                    setDetailVersion((version) => version + 1)
                  }
                  onCopy={(id, value) => void copyValue(id, value)}
                  copyFeedback={copyFeedback}
                  headingRef={detailHeadingRef}
                />
              ) : null}
            </div>
          </div>
        </div>

        <p className="marketplace-copy-status" aria-live="polite">
          {copyFeedback
            ? copyFeedback.status === "success"
              ? c.copySuccess
              : c.copyError
            : ""}
        </p>
      </section>

      <section className="marketplace-footer-note">
        <div>
          <span aria-hidden="true">R/</span>
          <div>
            <strong>{c.footerTitle}</strong>
            <p>{c.footerBody}</p>
          </div>
        </div>
        <Link className="button button-lime" href="/pricing">
          {c.transparentPricing}
          <span aria-hidden="true">↗</span>
        </Link>
      </section>
    </main>
  );
}
