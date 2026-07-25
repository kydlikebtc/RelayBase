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
      ["Start", [["#overview", "Conventions"], ["#quickstart", "5-minute quickstart"], ["#catalog", "Market & catalog"], ["#auth", "Authentication"], ["#x402", "x402 Agent batches"], ["#examples", "Request examples"]]],
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
      "For 429, 502 and 503, use exponential backoff with jitter and a retry budget. Respect Retry-After when present. Reuse the original idempotency key only when transport failed and the server outcome is unknown; if a definitive response was received and you intentionally start a new billable attempt, use a new key.",
    retriesChecks: [
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
      ["开始", [["#overview", "基本约定"], ["#quickstart", "5 分钟快速开始"], ["#catalog", "数据市场与目录"], ["#auth", "鉴权"], ["#x402", "x402 Agent 批次"], ["#examples", "请求示例"]]],
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
      "对 429、502、503 使用带抖动的指数退避和重试预算；存在 Retry-After 时优先遵循。仅当网络失败且无法判断服务端结果时复用原幂等键；已收到明确终态且要发起新的计费尝试时，使用新键。",
    retriesChecks: [
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
    ["429", "rate_limit_exceeded", "A customer, account or shared upstream limit was reached"],
    ["502", "upstream_unavailable", "The source network failed; the request was refunded"],
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
    ["429", "rate_limit_exceeded", "客户、账户或共享来源达到速率限制"],
    ["502", "upstream_unavailable", "来源网络不可用；请求已退款"],
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
                    ? "钱包签署报价后，用相同请求体和 Idempotency-Key 重试；服务端一次验证、一次结算，再执行整批并返回付款回执。"
                    : "After the wallet signs the quote, retry the same body and Idempotency-Key. The server verifies and settles once, then executes the whole batch and returns a receipt."}
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
                      "x402 结算不充值余额，也不会写入余额账本；在控制台用 xb_ 编号查询链上结算和执行状态。",
                      "付款已结算后执行仍可能失败；首版不提供退款、争议或部分成功计费。",
                    ]
                  : [
                      "v1 is fixed to exact, Base mainnet native USDC, synchronous batches and pay-before-execute.",
                      "A batch targets one data product and cannot exceed maxBatchSize from its market detail.",
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
X-RelayBase-Balance-Usd-Micros: 24998000`}
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
