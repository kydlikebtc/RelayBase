import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, type Locale } from "../locale";
import { getRequestOrigin } from "../request-origin";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return locale === "zh"
    ? {
        title: "API 文档",
        description:
          "RelayBase 数据市场的快速开始、市场查询、鉴权、请求、错误重试、计费与支付确认语义。",
      }
    : {
        title: "API documentation",
        description:
          "Quickstart, market discovery, authentication, requests, retries, billing and payment semantics for the RelayBase Data Market.",
      };
}

function codeExamples(origin: string) {
  return {
    curl: `curl --request GET \\
  '${origin}/v1/example/profile/read?profile_id=demo-123' \\
  --header 'Authorization: Bearer rb_live_YOUR_KEY' \\
  --header 'Idempotency-Key: profile-sync-20260724-001' \\
  --header 'X-RelayBase-Max-Cost-Usd-Micros: 2000' \\
  --header 'Accept: application/json'`,
    javascript: `const response = await fetch(
  "${origin}/v1/example/profile/read?profile_id=demo-123",
  {
    headers: {
      Authorization: "Bearer rb_live_YOUR_KEY",
      "Idempotency-Key": "profile-sync-20260724-001",
      "X-RelayBase-Max-Cost-Usd-Micros": "2000",
      Accept: "application/json",
    },
  },
);

if (!response.ok) {
  const { error } = await response.json();
  throw new Error(\`\${error.code}: \${error.message}\`);
}

const payload = await response.json();`,
    python: `import requests

response = requests.get(
    "${origin}/v1/example/profile/read",
    params={"profile_id": "demo-123"},
    headers={
        "Authorization": "Bearer rb_live_YOUR_KEY",
        "Idempotency-Key": "profile-sync-20260724-001",
        "X-RelayBase-Max-Cost-Usd-Micros": "2000",
        "Accept": "application/json",
    },
    timeout=30,
)
response.raise_for_status()
payload = response.json()`,
  };
}

const copy = {
  en: {
    mastheadTitle: "Build your first request.",
    mastheadBody:
      "RelayBase delivers data products over standard HTTP, Bearer authentication and JSON. Every callable product starts under /v1.",
    currentVersion: "Current version",
    navLabel: "Documentation",
    nav: [
      ["Start", [["#overview", "Conventions"], ["#quickstart", "5-minute quickstart"], ["#catalog", "Market & catalog"], ["#capabilities", "Batch & pagination"], ["#auth", "Authentication"], ["#x402", "x402 Agent batches"], ["#examples", "Request examples"]]],
      ["Operate", [["#response", "Response & request ID"], ["#errors", "Error model"], ["#retries", "Rate limits & retries"], ["#billing", "Billing semantics"], ["#webhooks", "Payment confirmation"], ["#production", "Production checklist"]]],
    ],
    helpTitle: "Need help?",
    helpBody: "Include the requestId so the request can be located quickly.",
    helpMeta: "Support channel to be configured",
    overviewTitle: "Core conventions",
    overviewIntro: "The API base path is /v1. Platform and capability paths stay readable, for example:",
    overviewChecks: [
      "Requests and responses use UTF-8; responses are JSON.",
      "Query parameters use URL encoding; booleans use true / false.",
      "Preserve the HTTP status code and parse the standard error envelope.",
      "Only reviewed read-only GET / POST data-query endpoints are exposed. RelayBase does not proxy writes, publishing, interaction or deletion.",
    ],
    quickstartTitle: "From account to verified data in five steps.",
    quickstartIntro:
      "A production request starts with a product, not a guessed endpoint. Use this path to avoid stale pricing and unsupported routes.",
    quickstartSteps: [
      ["Create a Key", "Open the console, create a server-side rb_live_ Key, and store it in your secret manager."],
      ["Choose a data product", "Find a platform and capability in the data market. Confirm it is callable, reviewed and priced."],
      ["Set a cost ceiling", "Copy the current micro-USD price into X-RelayBase-Max-Cost-Usd-Micros to prevent price-race surprises."],
      ["Send an idempotent request", "Give each billable business action a unique Idempotency-Key and call the exact /v1 path."],
      ["Verify delivery and cost", "Read X-Request-Id and cost headers, then reconcile the request in the console ledger."],
    ],
    quickstartCallout: "Server-side credentials only",
    quickstartCalloutBody:
      "Never place a RelayBase Key in browser code, a public repository or a distributed mobile bundle.",
    catalogTitle: "Discover products before calling them.",
    catalogBody:
      "The data market reads the complete runtime supply catalog synced and reviewed by operators. It includes fully documented products and price-only entries whose documentation is still pending. If no catalog has been synced, discovery returns an empty result instead of bundled third-party snapshots.",
    catalogPrivacy:
      "Source origins, routing credentials and upstream keys are runtime-only operational configuration. Public market responses, health responses, logs and build output do not expose them. RelayBase writes public descriptions and taxonomy; they are not upstream official documentation.",
    marketQueryTitle: "Marketplace discovery",
    marketFilters:
      "List queries support q, platform, category, dataType, method, surface, availability, limit and offset. The response includes catalog revision, global stats and facets, the current endpoints, total, count, offset and nextOffset.",
    detailRules:
      "Detail lookup requires an exact URL-encoded path. Include method=GET|POST for a fully defined product; omit an unknown method for a price-only entry. A complete product returns RelayBase taxonomy, reviewed input structure, price and request examples. A price-only entry stays pending, has no method or examples, and cannot be called.",
    callableTitle: "Callable catalog",
    callableBody:
      "/api/catalog is the endpoint-level list of approved products. A client must also confirm mode=live and satisfy current readiness, account, balance and rate-limit checks. Products missing from this catalog cannot be proxied.",
    availabilityTitle: "Availability is an operating contract",
    availabilityBody:
      "available means currently eligible for proxying. pending means review, documentation or deployment readiness is incomplete. restricted products are never callable. Catalog generation, safety review, pricing verification, commercial authorization and reconciliation health all participate in the decision.",
    authTitle: "Bearer Key authentication",
    authBody:
      "Create an rb_live_ Key in the console and send it in Authorization. Every billable business action also needs a unique Idempotency-Key. Send the current quote as X-RelayBase-Max-Cost-Usd-Micros to protect against a concurrent price change.",
    idempotencyTitle: "Idempotency key: 8–128 safe ASCII characters",
    idempotencyBody:
      "Use letters, digits, dots, underscores, colons and hyphens. Reusing a key returns 409 and does not repeat the upstream request or charge.",
    costTitle: "Maximum cost protection: a micro-USD integer",
    costBody:
      "If the live customer price exceeds the declared ceiling, RelayBase returns 409 price_quote_exceeded without calling upstream or charging. Refresh the catalog, confirm the price and retry with a new idempotency key.",
    examplesTitle: "One request, three languages",
    examplesBody:
      "These examples call the same synthetic profile capability. Replace the deployment origin and API Key.",
    responseTitle: "Response and requestId",
    responseBody:
      "Successful public endpoints return { success: true, data }. External control fields are not passed through. Request identity and charge information are delivered through response headers and the console; platform and source failures use the common error envelope.",
    facts: [
      ["200", "Request succeeded", "The data payload is in data and the call is charged at the product price."],
      ["4xx", "Request issue", "Check parameters, key, balance, price ceiling or request rate."],
      ["5xx", "Service issue", "Use bounded backoff and retain the requestId."],
    ],
    errorsTitle: "Standard error envelope",
    meaning: "Meaning",
    retriesTitle: "Rate limits and safe retries",
    retriesBody:
      "Standard /v1 requests pass two persistent limits: the API Key limit and the aggregate account limit. All Keys on one account share the account ceiling, so more Keys do not add throughput. The upstream router enforces every independent TikHub account as one aggregate capacity group, then applies any lower per-endpoint catalog limit. For 429, 502 and 503, use exponential backoff with jitter and a retry budget. Respect Retry-After when present. Reuse the original idempotency key only when transport failed and the server outcome is unknown; after a definitive response, use a new key only for an intentional new billable attempt.",
    retriesChecks: [
      "Read X-RateLimit-Scope: api-key and account identify customer policy; upstream means all safe source capacity for this path is temporarily occupied.",
      "Multiple Keys from one TikHub account are credential redundancy only: RelayBase may switch on 401/403, expiry or a key-local failure, but all Keys still share the same account RPS and balance. Account-level 429, 402 and provider-wide failure stop the whole capacity group.",
      "X-RateLimit-Limit is RPS, X-RateLimit-Remaining is the current burst allowance, and X-RateLimit-Reset is a Unix timestamp.",
      "A customer or upstream-capacity 429 does not create a final usage charge. If a balance reservation already happened, RelayBase refunds it before responding.",
      "Cap exponential backoff and add random jitter to avoid synchronized retries.",
      "Treat 409 as a recorded prior attempt. Reconcile it in the console before creating a new attempt.",
      "Do not retry 400, 401 or 402 until the request, credential or balance has changed.",
      "Log requestId, path, status, attempt count and final outcome—never log the API Key.",
    ],
    billingTitle: "Billing semantics",
    billingBody:
      "RelayBase keeps two separate accounting paths. Standard API Key calls use the prepaid balance in integer USD micro-units (1 USD = 1,000,000 micro-USD): an upstream HTTP 200 recognizes usage revenue, while a non-200 response, network failure or invalid body refunds the reservation. x402 uses a wallet-paid Base USDC settlement ledger and never changes the prepaid balance.",
    billingChecks: [
      "The customer price is the reviewed price stored with the product, not a browser-provided value.",
      "Idempotent reservation, settlement and refund prevent duplicate charging.",
      "X-RelayBase-Cost-Usd-Micros reports the finalized request cost.",
      "The console ledger is the operational source for request-level reconciliation.",
      "A top-up is cash-in and deferred balance liability; it becomes revenue only as prepaid API calls complete without refund.",
      "x402 revenue is recognized only after facilitator settlement succeeds and a Base transaction hash is persisted.",
    ],
    webhooksTitle: "Payment confirmation",
    webhooksBody:
      "Stablecoin payment confirmation is processed server-side. The webhook verifies provider signature, order identity, asset, network, amount and replay protection before crediting a balance. A browser redirect or screenshot never changes account funds.",
    webhookWarning: "Do not infer payment success from the client",
    webhookWarningBody:
      "Treat the order as funded only after the console balance and server-side order status update. Never pay a completed order again.",
    productionTitle: "Production checklist",
    productionIntro:
      "Before moving a workflow from a test script to production, verify every layer below.",
    productionChecks: [
      "The selected path appears in /api/catalog and the product is available with a verified price.",
      "The API Key is stored in a server-side secret manager and has a rotation owner.",
      "Every billable action has a deterministic, unique idempotency-key strategy.",
      "The client sets timeouts, honors Retry-After and has a bounded retry budget.",
      "Cost ceilings, balance alerts and request-ledger reconciliation are enabled.",
      "Logs capture requestId and outcome without credentials or sensitive source data.",
    ],
    productionCta: "Explore callable data products",
  },
  zh: {
    mastheadTitle: "把第一条请求跑起来。",
    mastheadBody:
      "RelayBase 数据市场使用标准 HTTP、Bearer Key 与 JSON 交付数据产品。所有可调用能力都从 /v1 开始。",
    currentVersion: "当前版本",
    navLabel: "文档目录",
    nav: [
      ["开始", [["#overview", "基本约定"], ["#quickstart", "5 分钟快速开始"], ["#catalog", "数据市场与目录"], ["#capabilities", "批量与分页"], ["#auth", "鉴权"], ["#x402", "x402 Agent 批次"], ["#examples", "请求示例"]]],
      ["运行", [["#response", "响应与请求 ID"], ["#errors", "错误模型"], ["#retries", "限流与重试"], ["#billing", "计费语义"], ["#webhooks", "支付确认"], ["#production", "上线检查"]]],
    ],
    helpTitle: "卡住了？",
    helpBody: "带上 requestId 联系支持，定位会更快。",
    helpMeta: "支持渠道待配置",
    overviewTitle: "基本约定",
    overviewIntro: "API 基础路径为 /v1。平台名和能力路径保持可读，例如：",
    overviewChecks: [
      "请求与响应均使用 UTF-8；响应格式为 JSON。",
      "查询参数使用 URL 编码，布尔值使用 true / false。",
      "保留 HTTP 状态码，并解析统一错误结构。",
      "仅开放通过审核的只读 GET / POST 数据查询端点；不代理写入、发布、互动或删除操作。",
    ],
    quickstartTitle: "五步完成从账户到可验证数据。",
    quickstartIntro:
      "生产请求应该从数据产品开始，而不是猜测接口路径。按这条路径接入，可以避免过期价格和未支持路由。",
    quickstartSteps: [
      ["创建访问 Key", "打开控制台创建服务端 rb_live_ Key，并保存到密钥管理器。"],
      ["选择数据产品", "在数据市场找到平台和能力，确认产品可调用、已审核且已核价。"],
      ["设置成本上限", "把当前微美元价格写入 X-RelayBase-Max-Cost-Usd-Micros，防止并发调价。"],
      ["发送幂等请求", "为每个计费业务动作生成唯一 Idempotency-Key，并调用精确 /v1 路径。"],
      ["验证交付与费用", "读取 X-Request-Id 与费用响应头，再到控制台账本核对。"],
    ],
    quickstartCallout: "Key 只能用于服务端",
    quickstartCalloutBody: "不要把 RelayBase Key 放入浏览器源码、公开仓库或分发的移动端包。",
    catalogTitle: "先发现产品，再发起调用。",
    catalogBody:
      "数据市场只读取运营方同步并审核的运行时完整供给目录，包含完整定义产品，以及文档仍待同步的 price-only 条目。尚未同步目录时返回空结果，不内置第三方快照。",
    catalogPrivacy:
      "来源 Origin、路由凭据与上游 Key 仅属于运行时运营配置。公共市场、健康接口、日志和构建产物均不会暴露。公开说明与分类由 RelayBase 编写，不代表来源平台官方文档。",
    marketQueryTitle: "市场查询",
    marketFilters:
      "列表支持 q、platform、category、dataType、method、surface、availability、limit 和 offset。响应包含目录代次、全局统计与筛选项、当前 endpoints、total、count、offset 和 nextOffset。",
    detailRules:
      "详情查询必须提供 URL 编码的精确 path。完整定义产品同时传 method=GET|POST；方法未知的 price-only 条目应省略 method。完整产品返回 RelayBase 分类、审核后的输入结构、价格和示例；price-only 条目保持 pending，没有方法与示例，不能调用。",
    callableTitle: "可调用目录",
    callableBody:
      "/api/catalog 是端点级已开放清单。客户还必须确认 mode=live，并满足最新 readiness、账户、余额和限流检查。未出现在该目录中的产品不能代理。",
    availabilityTitle: "可用状态是一份运行契约",
    availabilityBody:
      "available 表示当前具备代理资格；pending 表示审核、文档或部署条件尚未完成；restricted 永不开放。目录生成、安全审核、核价、商业授权与对账健康都会参与判断。",
    authTitle: "Bearer Key 鉴权",
    authBody:
      "在控制台生成 rb_live_ Key 并放入 Authorization。每个计费业务动作都需要唯一 Idempotency-Key。建议把当前报价作为 X-RelayBase-Max-Cost-Usd-Micros 发送，防止并发调价。",
    idempotencyTitle: "幂等键：8–128 个安全 ASCII 字符",
    idempotencyBody:
      "仅使用字母、数字、点、下划线、冒号和连字符。同一个键再次提交会返回 409，且不会重复请求上游或扣费。",
    costTitle: "最高成本保护：微美元整数",
    costBody:
      "实时客户价超过请求上限时返回 409 price_quote_exceeded，不调用上游或扣费。刷新目录确认新价格后，用新幂等键重试。",
    examplesTitle: "同一请求，三种写法",
    examplesBody: "下面都请求同一个合成资料能力。替换部署域名和 API Key 即可。",
    responseTitle: "响应与 requestId",
    responseBody:
      "公开端点成功时统一返回 { success: true, data }。外部控制字段不会透传；请求标识与计费信息通过响应头和控制台提供，平台或来源错误使用统一错误体。",
    facts: [
      ["200", "请求成功", "数据载荷位于 data 字段，本次调用按产品价格最终计费。"],
      ["4xx", "请求问题", "检查参数、密钥、余额、成本上限或请求频率。"],
      ["5xx", "服务异常", "使用有上限的退避重试，并保留 requestId。"],
    ],
    errorsTitle: "统一错误体",
    meaning: "说明",
    retriesTitle: "限流与安全重试",
    retriesBody:
      "标准 /v1 请求经过两层持久化限制：API Key 限制和账户聚合限制。同一账户的所有 Key 共享账户上限，增加 Key 不会增加吞吐。上游路由把每个独立 TikHub 账号作为一个全局容量组，再叠加目录中更低的单接口限制。对 429、502、503 使用带抖动的指数退避和重试预算；存在 Retry-After 时优先遵循。仅当网络失败且无法判断服务端结果时复用原幂等键；收到明确终态后，只有确实要新建计费尝试时才使用新键。",
    retriesChecks: [
      "读取 X-RateLimit-Scope：api-key 和 account 表示客户策略；upstream 表示安全上游账号或接口容量暂时用满。",
      "同一 TikHub 账号的多个 Key 只提供凭据容灾：401/403、过期或单 Key 异常可切换，但所有 Key 仍共享账号 RPS 与余额；账号级 429、402 和上游整体故障会暂停整个容量组。",
      "X-RateLimit-Limit 的单位是 RPS，X-RateLimit-Remaining 是当前突发余量，X-RateLimit-Reset 是 Unix 时间戳。",
      "客户限流或上游容量 429 不产生最终用量费用；若此前已预留余额，RelayBase 会先退款再响应。",
      "为指数退避设置上限并增加随机抖动，避免同步重试。",
      "把 409 视为已有请求记录；先在控制台核对，再决定是否新建尝试。",
      "在请求、凭据或余额改变前，不要重试 400、401、402。",
      "记录 requestId、路径、状态、尝试次数与结果；永远不要记录 API Key。",
    ],
    billingTitle: "计费语义",
    billingBody:
      "RelayBase 使用两条隔离账务路径。标准 API Key 调用从预充值余额按美元微单位计费（1 美元 = 1,000,000 微美元）：上游 HTTP 200 确认用量收入，非 200、网络失败或无效响应自动退回预留。x402 使用钱包支付的 Base USDC 结算账本，永不改变预充值余额。",
    billingChecks: [
      "客户价来自审核后的产品价格，不接受浏览器提供的金额。",
      "幂等的预留、结算和退款避免重复扣费。",
      "X-RelayBase-Cost-Usd-Micros 返回最终请求成本。",
      "控制台请求账本是逐笔对账的运营依据。",
      "充值属于现金流入与递延余额负债；只有预充值 API 调用完成且未退款时才确认收入。",
      "x402 只有在 facilitator 结算成功且 Base 交易哈希持久化后确认收入。",
    ],
    webhooksTitle: "支付确认",
    webhooksBody:
      "稳定币支付确认只在服务端处理。Webhook 在入账前验证提供方签名、订单、币种、网络、金额与防重放条件。浏览器跳转或截图不会改变余额。",
    webhookWarning: "不要从客户端推断支付成功",
    webhookWarningBody: "只有控制台余额与服务端订单状态更新后才视为到账；不要重复支付已完成订单。",
    productionTitle: "上线检查",
    productionIntro: "把工作流从测试脚本迁移到生产前，逐项确认以下条件。",
    productionChecks: [
      "所选路径出现在 /api/catalog，产品为 available 且价格已核验。",
      "API Key 保存在服务端密钥管理器，并有明确轮换负责人。",
      "每个计费动作都有确定、唯一的幂等键策略。",
      "客户端设置超时、遵循 Retry-After，并限制重试预算。",
      "成本上限、余额告警和请求账本对账均已启用。",
      "日志记录 requestId 与结果，但不记录凭据或敏感来源信息。",
    ],
    productionCta: "浏览可调用数据产品",
  },
} as const;

const errors = {
  en: [
    ["400", "invalid_idempotency_key", "Idempotency key is missing or invalid"],
    ["400", "invalid_marketplace_filter", "A market filter is invalid or repeated"],
    ["400", "invalid_pagination", "limit or offset is outside the allowed range"],
    ["400", "invalid_max_cost", "The cost ceiling is not an allowed micro-USD integer"],
    ["400", "api_key_not_used_for_x402", "The x402 route requires wallet payment, not an API Key"],
    ["401", "invalid_api_key", "The API Key is missing, invalid or revoked"],
    ["402", "insufficient_balance", "Available balance cannot fund the request"],
    ["402", "x402_payment_required", "The validated batch has a fixed wallet-payment quote"],
    ["404", "endpoint_not_enabled", "The endpoint is not currently callable"],
    ["409", "idempotency_conflict", "The key was already used; no duplicate call or charge"],
    ["409", "price_quote_exceeded", "The live price exceeds the declared ceiling"],
    ["429", "customer_rate_limit_exceeded", "The API Key or aggregate account RPS policy was reached"],
    ["429", "upstream_capacity_exhausted", "All safe upstream account or endpoint capacity is temporarily occupied"],
    ["502", "upstream_unavailable", "The source network failed; the request was refunded"],
    ["503", "x402_upstream_route_unavailable", "No healthy authorized route is available, so no wallet-payment quote is accepted"],
    ["503", "commercial_clearance_required", "Required commercial authorization is not active"],
    ["503", "upstream_not_authorized", "Upstream access is not available for this deployment"],
  ],
  zh: [
    ["400", "invalid_idempotency_key", "幂等键缺失或格式无效"],
    ["400", "invalid_marketplace_filter", "数据市场筛选值无效或重复"],
    ["400", "invalid_pagination", "limit 或 offset 超出允许范围"],
    ["400", "invalid_max_cost", "最高成本不是允许范围内的微美元整数"],
    ["400", "api_key_not_used_for_x402", "x402 入口使用钱包付款，不接受 API Key 作为付款凭据"],
    ["401", "invalid_api_key", "API Key 缺失、无效或已撤销"],
    ["402", "insufficient_balance", "可用余额不足以发起本次调用"],
    ["402", "x402_payment_required", "批次已完成校验并生成固定钱包付款报价"],
    ["404", "endpoint_not_enabled", "接口当前不可调用"],
    ["409", "idempotency_conflict", "幂等键已使用；不会重复调用或扣费"],
    ["409", "price_quote_exceeded", "实时客户价超过请求声明上限"],
    ["429", "customer_rate_limit_exceeded", "API Key 或账户聚合 RPS 达到上限"],
    ["429", "upstream_capacity_exhausted", "安全上游账号或接口容量暂时用满"],
    ["502", "upstream_unavailable", "来源网络不可用；请求已退款"],
    ["503", "x402_upstream_route_unavailable", "当前没有健康且已授权的上游路由，因此不会接受钱包付款报价"],
    ["503", "commercial_clearance_required", "所需商业授权尚未生效"],
    ["503", "upstream_not_authorized", "当前部署尚未启用来源访问"],
  ],
} as const;

function CodePanel({ title, language, children }: { title: string; language: string; children: string }) {
  return (
    <div className="docs-code-panel">
      <div><span>{title}</span><span>{language}</span></div>
      <pre><code>{children}</code></pre>
    </div>
  );
}

function Checklist({ items }: { items: readonly string[] }) {
  return (
    <ul className="docs-checklist">
      {items.map((item) => (
        <li key={item}>
          <span className="docs-checkmark">✓</span>
          <span className="docs-checklist-copy">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Callout({ symbol, title, body, warning = false }: { symbol: string; title: string; body: string; warning?: boolean }) {
  return (
    <div className={`docs-callout${warning ? " docs-callout-warning" : ""}`}>
      <span>{symbol}</span>
      <div><b>{title}</b><p>{body}</p></div>
    </div>
  );
}

export default async function DocsPage() {
  const origin = await getRequestOrigin();
  const locale: Locale = await getLocale();
  const c = copy[locale];
  const examples = codeExamples(origin);

  return (
    <main className="docs-page" id="main-content">
      <header className="docs-masthead">
        <div>
          <p className="section-kicker">DOCS / API v1</p>
          <h1>{c.mastheadTitle}</h1>
          <p>{c.mastheadBody}</p>
        </div>
        <div className="docs-version"><span>{c.currentVersion}</span><strong>v1</strong><i>STABLE</i></div>
      </header>

      <div className="docs-layout">
        <aside className="docs-sidebar">
          <nav aria-label={c.navLabel}>
            {c.nav.map(([group, links]) => (
              <div key={group}>
                <span>{group}</span>
                {links.map(([href, label]) => <a href={href} key={href}>{label}</a>)}
              </div>
            ))}
          </nav>
          <div className="docs-help"><b>{c.helpTitle}</b><p>{c.helpBody}</p><span>{c.helpMeta}</span></div>
        </aside>

        <article className="docs-content">
          <section id="overview">
            <div className="docs-section-label">01 / OVERVIEW</div>
            <h2>{c.overviewTitle}</h2>
            <p>{c.overviewIntro}</p>
            <div className="endpoint-box"><span>GET</span><code>/v1/example/profile/read</code></div>
            <Checklist items={c.overviewChecks} />
          </section>

          <section id="quickstart">
            <div className="docs-section-label">02 / QUICKSTART</div>
            <h2>{c.quickstartTitle}</h2>
            <p>{c.quickstartIntro}</p>
            <div className="docs-facts">
              {c.quickstartSteps.slice(0, 3).map(([title, body], index) => (
                <div key={title}><span>0{index + 1}</span><b>{title}</b><p>{body}</p></div>
              ))}
            </div>
            <Checklist items={c.quickstartSteps.slice(3).map(([title, body]) => `${title} — ${body}`)} />
            <Callout symbol="!" title={c.quickstartCallout} body={c.quickstartCalloutBody} warning />
            <CodePanel title="First request" language="SHELL">{examples.curl}</CodePanel>
          </section>

          <section id="catalog">
            <div className="docs-section-label">03 / MARKET</div>
            <h2>{c.catalogTitle}</h2>
            <p>{c.catalogBody}</p>
            <p>{c.catalogPrivacy}</p>
            <CodePanel title={c.marketQueryTitle} language="HTTP">
              {`GET ${origin}/api/marketplace?q=profile&platform=example&category=profile_creator&dataType=profile_creator&method=GET&surface=web&availability=available&limit=20&offset=0
GET ${origin}/api/marketplace/detail?path=%2Fv1%2Fexample%2Fprofile%2Fread&method=GET`}
            </CodePanel>
            <p>{c.marketFilters}</p>
            <p>{c.detailRules}</p>
            <CodePanel title={c.callableTitle} language="HTTP">
              {`GET ${origin}/api/catalog
GET ${origin}/api/catalog?platform=example&dataType=profile_creator&tag=profile_creator&surface=web&limit=100`}
            </CodePanel>
            <p>{c.callableBody}</p>
            <Callout symbol="!" title={c.availabilityTitle} body={c.availabilityBody} warning />
          </section>

          <section id="capabilities">
            <div className="docs-section-label">04 / CAPABILITY CONTRACT</div>
            <h2>
              {locale === "zh"
                ? "请求数、目标数和返回条目是三个不同单位。"
                : "Requests, targets and returned items are different units."}
            </h2>
            <p>
              {locale === "zh"
                ? "每个数据产品详情都公开 executionMode、原生批量上限、目标字段与编码、分页字段、单页上限、典型返回规模以及证据状态。verified 来自端点级 TikHub 文档；openapi_inferred 仅表示当前输入 schema 可证明分页字段；pending 表示仍需官方文档或受控实测，RelayBase 不会据路径名猜测批量能力。"
                : "Every product detail exposes executionMode, native batch maximum, target field and encoding, pagination fields, page-size ceiling, typical response size and evidence status. verified is backed by endpoint-specific TikHub documentation; openapi_inferred only proves pagination input fields in the current schema; pending requires official evidence or controlled testing. RelayBase never guesses batching from a path name."}
            </p>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>{locale === "zh" ? "模式" : "Mode"}</th>
                    <th>{locale === "zh" ? "上游单位" : "Upstream unit"}</th>
                    <th>{locale === "zh" ? "RelayBase 行为" : "RelayBase behavior"}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>native_batch</code></td>
                    <td>{locale === "zh" ? "一个原生批量 HTTP 请求" : "One native batch HTTP request"}</td>
                    <td>{locale === "zh" ? "按 nativeBatchMax 分片；只对 verified 且语义等价的端点启用" : "Chunked by nativeBatchMax; enabled only for verified, semantically equivalent endpoints"}</td>
                  </tr>
                  <tr>
                    <td><code>paginated</code></td>
                    <td>{locale === "zh" ? "一个 page / cursor" : "One page / cursor"}</td>
                    <td>{locale === "zh" ? "每页是一次客户请求和一次上游请求；不会隐式追下一页" : "Each page is one customer request and one upstream request; pages are never auto-followed"}</td>
                  </tr>
                  <tr>
                    <td><code>direct</code></td>
                    <td>{locale === "zh" ? "一个客户 HTTP 请求" : "One customer HTTP request"}</td>
                    <td>{locale === "zh" ? "当前 1:1 转发；批量、异步和返回规模未获证据时保持待确认" : "Currently forwarded 1:1; batch, async and response-size claims remain pending without evidence"}</td>
                  </tr>
                  <tr>
                    <td><code>fanout</code></td>
                    <td>{locale === "zh" ? "每个逻辑目标一次请求" : "One request per logical target"}</td>
                    <td>{locale === "zh" ? "仅用于 x402 且没有已验证原生批量能力的产品，并在报价中公开 plannedUpstreamRequests" : "Used by x402 only when no verified native batch exists; plannedUpstreamRequests is disclosed in the quote"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Checklist
              items={
                locale === "zh"
                  ? [
                      "客户 HTTP 请求 Hc、TikHub HTTP attempt Hu、逻辑目标数 T、返回条目 D 和分页单位 P 分别记录。",
                      "原生批量报价按完整校验后的目标数计价，同时把 plannedUpstreamRequests = ceil(T / nativeBatchMax) 固定在批次记录。",
                      "除目标 ID 外的参数必须完全一致；APP / WEB、版本、字段覆盖或授权范围不同的请求不会合并。",
                      "返回结构无法可靠计数时 returnedItemCount 显示待确认，而不是伪造 0。",
                    ]
                  : [
                      "Customer HTTP requests Hc, TikHub HTTP attempts Hu, logical targets T, returned items D and page units P are recorded independently.",
                      "A native-batch quote prices the fully validated target count and freezes plannedUpstreamRequests = ceil(T / nativeBatchMax).",
                      "All non-target parameters must match exactly; APP / WEB surfaces, versions, field coverage and authorization semantics are never merged.",
                      "When a response shape cannot be counted reliably, returnedItemCount stays unverified instead of being fabricated as zero.",
                    ]
              }
            />
          </section>

          <section id="auth">
            <div className="docs-section-label">04 / AUTH</div>
            <h2>{c.authTitle}</h2>
            <p>{c.authBody}</p>
            <CodePanel title="Authorization headers" language="HTTP">
              {`Authorization: Bearer rb_live_YOUR_KEY
Idempotency-Key: profile-sync-20260724-001
X-RelayBase-Max-Cost-Usd-Micros: 2000`}
            </CodePanel>
            <Callout symbol="＝" title={c.idempotencyTitle} body={c.idempotencyBody} />
            <Callout symbol="≤" title={c.costTitle} body={c.costBody} />
          </section>

          <section id="x402">
            <div className="docs-section-label">05 / X402 AGENT BATCH</div>
            <h2>
              {locale === "zh"
                ? "Agent 自带钱包，一批请求只结算一次。"
                : "Bring an Agent wallet and settle once per batch."}
            </h2>
            <p>
              {locale === "zh"
                ? "x402 是独立的批量支付入口，不是 API Key 的另一种扣费模式。标准 /v1 请求携带 rb_live_ Key，并始终从登录账户的预充值余额扣费；POST /v1/x402/batch 由调用方钱包提供 PAYMENT-SIGNATURE，以 Base 原生 USDC 支付，不需要也不接受 API Key 作为付款凭据。RelayBase 不生成或托管调用方私钥。"
                : "x402 is a separate batch-payment entry, not another billing mode for an API Key. Standard /v1 requests carry an rb_live_ Key and always charge the signed-in account’s prepaid balance. POST /v1/x402/batch is paid by the caller wallet through PAYMENT-SIGNATURE in native Base USDC; it does not need or accept an API Key as a payment credential. RelayBase never creates or custodies caller private keys."}
            </p>
            <div className="docs-facts">
              <div>
                <span>01</span>
                <b>{locale === "zh" ? "选择入口" : "Choose the entry"}</b>
                <p>
                  {locale === "zh"
                    ? "逐次服务端调用选择标准 /v1 + API Key；同一数据产品的同步批量任务选择 /v1/x402/batch + 钱包。"
                    : "Use standard /v1 + API Key for individual server calls; use /v1/x402/batch + wallet for a synchronous batch of one data product."}
                </p>
              </div>
              <div>
                <span>02</span>
                <b>{locale === "zh" ? "获取固定报价" : "Receive a fixed quote"}</b>
                <p>
                  {locale === "zh"
                    ? "服务端先完整校验并计数，按 verifiedQuantity × unitPrice 返回一次 HTTP 402 与 PAYMENT-REQUIRED。"
                    : "The server validates and counts the full batch, then returns one HTTP 402 and PAYMENT-REQUIRED for verifiedQuantity × unitPrice."}
                </p>
              </div>
              <div>
                <span>03</span>
                <b>{locale === "zh" ? "支付后整批执行" : "Pay, then execute all"}</b>
                <p>
                  {locale === "zh"
                    ? "钱包签署报价后，用相同请求体和 Idempotency-Key 重试；服务端一次验证、一次结算，再按已冻结的 native_batch 分片或 fanout 计划执行并返回付款回执。"
                    : "After the wallet signs the quote, retry the same body and Idempotency-Key. The server verifies and settles once, then executes the frozen native_batch chunk or fanout plan and returns a receipt."}
                </p>
              </div>
            </div>
            <CodePanel title="1 · Request one batch quote" language="SHELL">
              {`curl --request POST '${origin}/v1/x402/batch' \\
  --header 'Content-Type: application/json' \\
  --header 'Idempotency-Key: agent-batch-20260725-001' \\
  --data '{
    "endpoint": "/v1/example/profile/read",
    "requests": [
      { "profile_id": "demo-001" },
      { "profile_id": "demo-002" }
    ]
  }'

# HTTP 402
# PAYMENT-REQUIRED: <base64-encoded x402 v2 JSON>
# X-RelayBase-X402-Batch-Id: xb_...`}
            </CodePanel>
            <CodePanel title="2 · Retry with wallet payment" language="HTTP">
              {`POST ${origin}/v1/x402/batch
Content-Type: application/json
Idempotency-Key: agent-batch-20260725-001
PAYMENT-SIGNATURE: <base64-encoded x402 v2 wallet payload>

<the exact same JSON body>

# Success includes PAYMENT-RESPONSE and the batch receipt.
# Do not send Authorization: Bearer rb_live_... to this route.`}
            </CodePanel>
            <Checklist
              items={
                locale === "zh"
                  ? [
                      "首版固定使用 exact、Base 主网原生 USDC、同步批量、先支付后执行。",
                      "一个批次只能包含同一数据产品，数量不得超过市场详情中的 maxBatchSize。",
                      "requests 表示逻辑输入，不表示上游 HTTP 请求。已验证原生批量端点按 nativeBatchMax 分片；其他端点明确使用 fanout。",
                      "原生批量中除 ID/目标字段外的参数必须完全一致；不同 APP/WEB 入口、版本或语义不会被合并。",
                      "x402 结算不充值余额，也不会写入余额账本；在控制台用 xb_ 编号查询链上结算和执行状态。",
                      "付款已结算后执行仍可能失败；首版不提供退款、争议或部分成功计费。",
                    ]
                  : [
                      "v1 is fixed to exact, Base mainnet native USDC, synchronous batches and pay-before-execute.",
                      "A batch targets one data product and cannot exceed maxBatchSize from its market detail.",
                      "requests are logical inputs, not upstream HTTP requests. Verified native endpoints are chunked by nativeBatchMax; all other products explicitly use fanout.",
                      "All non-target fields in a native batch must match exactly; different APP/WEB surfaces, versions or semantics are never merged.",
                      "x402 settlement does not top up or write to the balance ledger; use the xb_ ID in the console to inspect settlement and execution.",
                      "Execution can still fail after settlement; v1 has no refunds, disputes or partial-success pricing.",
                    ]
              }
            />
            <Callout
              symbol="≠"
              title={
                locale === "zh"
                  ? "不要把 API Key“绑定钱包”"
                  : "Do not “attach a wallet” to an API Key"
              }
              body={
                locale === "zh"
                  ? "两种入口的付款身份、账本与回执是分开的；系统不会根据余额或钱包状态自动切换。"
                  : "The payment identity, ledger and receipt are separate for the two entries; the service never switches automatically based on balance or wallet state."
              }
              warning
            />
          </section>

          <section id="examples">
            <div className="docs-section-label">06 / EXAMPLES</div>
            <h2>{c.examplesTitle}</h2>
            <p>{c.examplesBody}</p>
            <div className="docs-code-stack">
              <CodePanel title="cURL" language="SHELL">{examples.curl}</CodePanel>
              <CodePanel title="JavaScript" language="JS">{examples.javascript}</CodePanel>
              <CodePanel title="Python" language="PY">{examples.python}</CodePanel>
            </div>
          </section>

          <section id="response">
            <div className="docs-section-label">07 / RESPONSE</div>
            <h2>{c.responseTitle}</h2>
            <p>{c.responseBody}</p>
            <CodePanel title="RelayBase response headers" language="HTTP">
              {`X-Request-Id: req_01K2...
X-RelayBase-Cost-Usd-Micros: 2000
X-RelayBase-Balance-Usd-Micros: 24998000
X-RateLimit-Limit: 3
X-RateLimit-Remaining: 5
X-RateLimit-Reset: 1785062401
X-RateLimit-Scope: account`}
            </CodePanel>
            <div className="docs-facts">
              {c.facts.map(([status, title, body]) => (
                <div key={status}><span>{status}</span><b>{title}</b><p>{body}</p></div>
              ))}
            </div>
          </section>

          <section id="errors">
            <div className="docs-section-label">08 / ERRORS</div>
            <h2>{c.errorsTitle}</h2>
            <CodePanel title="Error response" language="JSON">
              {`{
  "error": {
    "code": "insufficient_balance",
    "message": "${locale === "zh" ? "账户余额不足，请充值后重试" : "Insufficient balance. Top up and retry."}",
    "requestId": "req_01K2..."
  }
}`}
            </CodePanel>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead><tr><th>HTTP</th><th>code</th><th>{c.meaning}</th></tr></thead>
                <tbody>
                  {errors[locale].map(([status, code, meaning]) => (
                    <tr key={code}><td>{status}</td><td><code>{code}</code></td><td>{meaning}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="retries">
            <div className="docs-section-label">09 / RETRIES</div>
            <h2>{c.retriesTitle}</h2>
            <p>{c.retriesBody}</p>
            <Checklist items={c.retriesChecks} />
            <CodePanel title="Bounded retry policy" language="PSEUDOCODE">
              {`attempts = 4
base_delay_ms = 500
retry_on = [429, 502, 503]
delay = min(8000, base_delay_ms * 2^attempt) + random_jitter
honor Retry-After when present`}
            </CodePanel>
          </section>

          <section id="billing">
            <div className="docs-section-label">10 / BILLING</div>
            <h2>{c.billingTitle}</h2>
            <p>{c.billingBody}</p>
            <Checklist items={c.billingChecks} />
            <CodePanel title="Cost units" language="TEXT">
              {`1 USD = 1,000,000 USD micros
$0.002/request = 2,000 USD micros
Header: X-RelayBase-Max-Cost-Usd-Micros: 2000`}
            </CodePanel>
          </section>

          <section id="webhooks">
            <div className="docs-section-label">11 / PAYMENT</div>
            <h2>{c.webhooksTitle}</h2>
            <p>{c.webhooksBody}</p>
            <Callout symbol="!" title={c.webhookWarning} body={c.webhookWarningBody} warning />
          </section>

          <section id="production">
            <div className="docs-section-label">12 / PRODUCTION</div>
            <h2>{c.productionTitle}</h2>
            <p>{c.productionIntro}</p>
            <Checklist items={c.productionChecks} />
            <Link className="button button-blue" href="/catalog">{c.productionCta}<span aria-hidden="true"> →</span></Link>
          </section>
        </article>
      </div>
    </main>
  );
}
