import type { Metadata } from "next";
import Link from "next/link";
import { getRequestOrigin } from "../request-origin";

export const metadata: Metadata = {
  title: "API 文档",
  description:
    "RelayBase API 市场、鉴权、请求示例、错误码、计费与支付确认语义。",
};

function codeExamples(origin: string) {
  const curl = `curl --request GET \\
  '${origin}/v1/example/profile/read?profile_id=demo-123' \\
  --header 'Authorization: Bearer rb_live_YOUR_KEY' \\
  --header 'Idempotency-Key: profile-sync-20260724-001' \\
  --header 'X-RelayBase-Max-Cost-Usd-Micros: 2000' \\
  --header 'Accept: application/json'`;

  const javascript = `const response = await fetch(
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

const payload = await response.json();`;

  const python = `import requests

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
payload = response.json()`;

  return { curl, javascript, python };
}

const errorExample = `{
  "error": {
    "code": "insufficient_balance",
    "message": "账户余额不足，请充值后重试",
    "requestId": "req_01K2..."
  }
}`;

const errors = [
  ["400", "invalid_idempotency_key", "幂等键缺失或格式无效"],
  ["400", "invalid_marketplace_filter", "API 市场筛选值无效或重复"],
  ["400", "invalid_pagination", "分页 limit 或 offset 超出允许范围"],
  ["400", "invalid_marketplace_endpoint", "详情 path 缺失，或可选 method 无效"],
  ["400", "invalid_max_cost", "最高成本请求头不是允许范围内的微美元整数"],
  ["401", "invalid_api_key", "API Key 缺失、无效或已撤销"],
  ["402", "insufficient_balance", "可用余额不足以发起本次调用"],
  ["409", "idempotency_conflict", "幂等键已被使用；不会重复调用或扣费"],
  ["409", "price_quote_exceeded", "实时客户价超过请求声明的最高成本"],
  ["404", "endpoint_not_enabled", "接口未开放，或上游通过统一错误体返回 404"],
  [
    "404",
    "marketplace_endpoint_not_found",
    "参考市场中没有匹配的 path 或可选 method",
  ],
  ["429", "rate_limit_exceeded", "客户、账户或共享上游达到速率限制"],
  ["502", "upstream_unavailable", "上游网络不可用；请求已退款"],
  [
    "503",
    "commercial_clearance_required",
    "上游商业授权或付款模式书面确认尚未归档；代理与充值关闭",
  ],
  ["503", "upstream_not_authorized", "当前部署仍处于安全沙盒"],
] as const;

function CodePanel({
  title,
  language,
  children,
}: {
  title: string;
  language: string;
  children: string;
}) {
  return (
    <div className="docs-code-panel">
      <div>
        <span>{title}</span>
        <span>{language}</span>
      </div>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

export default async function DocsPage() {
  const origin = await getRequestOrigin();
  const examples = codeExamples(origin);

  return (
    <main className="docs-page" id="main-content">
      <header className="docs-masthead">
        <div>
          <p className="section-kicker">DOCS / API v1</p>
          <h1>把第一条请求跑起来。</h1>
          <p>
            RelayBase 使用标准 HTTP、Bearer Key 与 JSON。所有公开数据能力都从
            <code>/v1</code> 开始。
          </p>
        </div>
        <div className="docs-version">
          <span>当前版本</span>
          <strong>v1</strong>
          <i>STABLE</i>
        </div>
      </header>

      <div className="docs-layout">
        <aside className="docs-sidebar">
          <nav aria-label="文档目录">
            <span>开始</span>
            <a href="#overview">基本约定</a>
            <a href="#catalog">API 市场与开放目录</a>
            <a href="#auth">鉴权</a>
            <a href="#examples">请求示例</a>
            <span>行为</span>
            <a href="#response">响应与请求 ID</a>
            <a href="#errors">错误码</a>
            <a href="#billing">计费语义</a>
            <a href="#webhooks">充值确认</a>
          </nav>
          <div className="docs-help">
            <b>卡住了？</b>
            <p>带上 requestId 联系支持，定位会更快。</p>
            <span>支持渠道待配置</span>
          </div>
        </aside>

        <article className="docs-content">
          <section id="overview">
            <div className="docs-section-label">01 / OVERVIEW</div>
            <h2>基本约定</h2>
            <p>
              API 基础路径为 <code>/v1</code>。平台名和能力路径保持可读，例如：
            </p>
            <div className="endpoint-box">
              <span>GET</span>
              <code>/v1/example/profile/read</code>
            </div>
            <ul className="docs-checklist">
              <li>
                <span className="docs-checkmark">✓</span>
                <span className="docs-checklist-copy">
                  请求与响应均使用 UTF-8；响应格式为 JSON。
                </span>
              </li>
              <li>
                <span className="docs-checkmark">✓</span>
                <span className="docs-checklist-copy">
                  查询参数使用 URL 编码，布尔值使用 <code>true</code> /{" "}
                  <code>false</code>。
                </span>
              </li>
              <li>
                <span className="docs-checkmark">✓</span>
                <span className="docs-checklist-copy">
                  每个响应都应保留 HTTP 状态码；错误体遵循统一结构。
                </span>
              </li>
              <li>
                <span className="docs-checkmark">✓</span>
                <span className="docs-checklist-copy">
                  仅开放通过只读、安全和价格审核的 <code>GET</code> /{" "}
                  <code>POST</code>{" "}
                  数据查询端点；不代理写入、发布、互动或删除操作。
                </span>
              </li>
            </ul>
          </section>

          <section id="catalog">
            <div className="docs-section-label">02 / CATALOG</div>
            <h2>区分能力发现与真实可调用。</h2>
            <p>
              <Link href="/catalog">API 市场页面</Link>
              只读取当前部署在管理后台完成同步的运行时完整市场目录。目录同时包含
              已匹配接口文档的完整定义条目，以及只存在于价格目录的 price-only
              文档待同步条目；尚未同步时返回空结果。仓库不内置第三方 OpenAPI
              快照、原始说明、来源哈希或官方标签清单。
            </p>
            <p>
              底层数据源的 HTTPS Origin、路由与 API Key 只由运营方在管理后台运行时
              配置，API Key 单独加密保存。公共市场、健康接口、日志和构建产物都不
              返回实际来源；公开文案和分类由 RelayBase 生成，不代表数据源的官方
              文档。
            </p>
            <div className="docs-callout docs-callout-warning">
              <span>!</span>
              <div>
                <b>升级后必须重新录入托管凭据</b>
                <p>
                  中性化迁移会永久撤销旧托管密钥并不可逆覆盖原密文，同时清空活动
                  凭据。运营方必须重新保存运行时数据源、录入并验证新凭据，再完成
                  全量同步和人工审核；旧密钥不能恢复或重新启用。
                </p>
              </div>
            </div>
            <CodePanel title="Marketplace discovery" language="HTTP">
              {`GET ${origin}/api/marketplace?q=profile&platform=example&category=profile_creator&dataType=profile_creator&method=GET&surface=web&availability=available&limit=20&offset=0
GET ${origin}/api/marketplace/detail?path=%2Fv1%2Fexample%2Fprofile%2Fread&method=GET`}
            </CodePanel>
            <p>
              市场列表支持 <code>q</code>、<code>platform</code>、
              RelayBase 能力分类 <code>category</code>、归一化分类{" "}
              <code>dataType</code>、
              <code>method</code>、
              <code>surface</code>、<code>availability</code>、
              <code>limit</code> 和 <code>offset</code>。默认每页 20 条；
              响应包含中性的 <code>catalog</code> 状态、全局{" "}
              <code>stats</code> 与{" "}
              <code>facets</code>、当前页 <code>endpoints</code>、筛选后{" "}
              <code>total</code>、<code>count</code>、<code>offset</code> 和{" "}
              <code>nextOffset</code>。
            </p>
            <CodePanel title="Marketplace detail response" language="JSON">
              {`{
  "catalog": {
    "revision": "sync_runtime_revision",
    "updatedAt": "2026-07-24T09:30:00.000Z",
    "complete": true,
    "serviceCount": 1
  },
  "endpoint": {
    "id": "svc_12s7du3_read",
    "path": "/v1/example/profile/read",
    "method": "GET",
    "availability": "available",
    "dataType": "profile_creator",
    "categories": ["profile_creator", "web"],
    "surface": "web",
    "summary": "Read",
    "pricing": {
      "amountUsdMicros": 1300,
      "currency": "USD",
      "unit": "request",
      "verified": true
    },
    "rateLimitRps": 10,
    "documentationStatus": "complete",
    "description": "通过 RelayBase 查询 example 的 profile_creator 数据。",
    "input": {
      "parameters": [{ "name": "profile_id", "in": "query", "required": true }],
      "requestBody": null
    },
    "response": {
      "contentType": "application/json",
      "mode": "relaybase_envelope",
      "schema": null,
      "description": "成功时返回 RelayBase 的 { success: true, data } JSON 包装；外部服务控制字段不会透传。"
    }
  },
  "examples": {
    "curl": "curl ...",
    "javascript": "const response = await fetch(...);",
    "python": "response = requests.get(...)"
  }
}`}
            </CodePanel>
            <p>
              详情查询必须提供 URL 编码的精确 <code>path</code>。查询完整定义服务
              时必须同时提供 <code>method=GET|POST</code>；查询 price-only
              文档待同步服务时省略未知方法。完整定义服务返回 RelayBase 分类、
              自写说明、结构化价格、安全过滤后的输入结构和三种调用示例。
              price-only 服务固定返回 <code>method=null</code>、
              <code>documentationStatus=pending</code>、空输入结构和空示例。
              响应不会返回数据源名称、来源地址、原始描述、原始 operationId、
              响应 Schema 或快照哈希。
              实际调用成功后统一返回
              <code>{"{ success: true, data }"}</code>，不透传外部服务的顶层
              文档、支持入口、消息或请求 ID。
              <code>available</code> 才表示当前可代理；<code>pending</code> 是待审核
              或部署尚未就绪，<code>restricted</code> 永不开放。
            </p>
            <div className="docs-callout docs-callout-warning">
              <span>×</span>
              <div>
                <b>price-only 服务不能调用或上架</b>
                <p>
                  管理员可以预设客户价，但不能手工补造 HTTP 方法。只有后续运行时
                  文档提供匹配的方法和输入定义，并经新一轮同步转为完整定义服务后，
                  才能进入安全审核和上架流程。
                </p>
              </div>
            </div>
            <div className="docs-callout docs-callout-warning">
              <span>!</span>
              <div>
                <b>参考展示不等于可调用</b>
                <p>
                  只有真实上游凭据、完整同步与覆盖证明、安全审核、核价上架、商业
                  授权和近期对账健康全部满足时，端点才会成为 available。任何目录
                  代次、计数或哈希不一致都会安全降级为 pending。
                </p>
              </div>
            </div>
            <CodePanel title="Callable endpoint catalog" language="HTTP">
              {`GET ${origin}/api/catalog
GET ${origin}/api/catalog?platform=example&dataType=profile_creator&tag=profile_creator&surface=web&limit=100`}
            </CodePanel>
            <p>
              <code>/api/catalog</code> 是端点级已开放清单。客户还必须确认响应中的{" "}
              <code>mode=live</code>，并满足最新 readiness、账户、余额和限流条件。
              列表支持精确的 <code>platform</code>、<code>dataType</code>、
              <code>tag</code> 与 <code>surface</code> 筛选；每条端点只返回
              RelayBase 服务编号、路径、方法、分类、入口、自写摘要和结构化{" "}
              <code>pricing</code>，不会返回原始 operationId。
              <code>pricing.amountUsdMicros</code> 是每次上游 HTTP 200 成功请求的
              客户价格；
              未出现在该目录中的路径不能调用。真实代理与充值还要求服务端已归档
              上游商业授权与付款模式书面确认；缺失时两者都会安全关闭。
              <code>capabilities.taxonomyReady</code> 还必须为 true；畸形 v1
              operation、归一化路径冲突或疑似密钥/Token 的分类标签都会让整次同步
              失败并保留上一成功目录。
            </p>
          </section>

          <section id="auth">
            <div className="docs-section-label">03 / AUTH</div>
            <h2>Bearer Key 鉴权</h2>
            <p>
              在控制台生成以 <code>rb_live_</code> 开头的密钥，并放入每次请求的{" "}
              <code>Authorization</code> 请求头。每个业务任务还应发送唯一的{" "}
              <code>Idempotency-Key</code>。建议同时发送当前报价作为{" "}
              <code>X-RelayBase-Max-Cost-Usd-Micros</code>，防止调价竞态。
            </p>
            <CodePanel title="Authorization header" language="HTTP">
              {`Authorization: Bearer rb_live_YOUR_KEY
Idempotency-Key: profile-sync-20260724-001
X-RelayBase-Max-Cost-Usd-Micros: 2000`}
            </CodePanel>
            <div className="docs-callout docs-callout-warning">
              <span>!</span>
              <div>
                <b>API Key 是服务端凭据</b>
                <p>
                  不要放入浏览器源码、公开仓库或移动端包。密钥只在创建时完整显示；泄露后立即撤销并轮换。
                </p>
              </div>
            </div>
            <div className="docs-callout">
              <span>＝</span>
              <div>
                <b>幂等键：8–128 个安全 ASCII 字符</b>
                <p>
                  仅使用字母、数字、点、下划线、冒号和连字符。同一个键再次提交会返回
                  409，且不会重复请求上游或扣费；每次付费请求都必须提供。
                </p>
              </div>
            </div>
            <div className="docs-callout">
              <span>≤</span>
              <div>
                <b>最高成本保护：微美元整数</b>
                <p>
                  当实时客户价超过该请求声明的上限时，返回{" "}
                  <code>409 price_quote_exceeded</code>，不会调用上游或扣费。
                  刷新目录并确认新价格后，用新的幂等键发起新尝试。
                </p>
              </div>
            </div>
          </section>

          <section id="examples">
            <div className="docs-section-label">04 / EXAMPLES</div>
            <h2>同一请求，三种写法</h2>
            <p>
              下面都请求同一个合成的用户资料能力。把示例域名替换为你的部署域名，
              并替换 API Key。
            </p>
            <div className="docs-code-stack">
              <CodePanel title="cURL" language="SHELL">
                {examples.curl}
              </CodePanel>
              <CodePanel title="JavaScript" language="JS">
                {examples.javascript}
              </CodePanel>
              <CodePanel title="Python" language="PY">
                {examples.python}
              </CodePanel>
            </div>
          </section>

          <section id="response">
            <div className="docs-section-label">05 / RESPONSE</div>
            <h2>响应与 requestId</h2>
            <p>
              公开端点成功时统一返回
              <code>{"{ success: true, data }"}</code>。外部服务的顶层控制字段
              不会透传；请求标识与计费信息通过响应头和控制台提供，任何平台或数据源
              错误都使用下方统一错误体。
            </p>
            <CodePanel title="RelayBase response headers" language="HTTP">
              {`X-Request-Id: req_01K2...
X-RelayBase-Cost-Usd-Micros: 2000
X-RelayBase-Balance-Usd-Micros: 24998000`}
            </CodePanel>
            <div className="docs-facts">
              <div>
                <span>200</span>
                <b>请求成功</b>
                <p>数据载荷已放入 RelayBase 的 data 字段，本次调用按对应能力最终计费。</p>
              </div>
              <div>
                <span>4xx</span>
                <b>请求问题</b>
                <p>检查参数、密钥、余额或请求频率。</p>
              </div>
              <div>
                <span>5xx</span>
                <b>服务异常</b>
                <p>使用退避重试，并保留 requestId。</p>
              </div>
            </div>
          </section>

          <section id="errors">
            <div className="docs-section-label">06 / ERRORS</div>
            <h2>统一错误体</h2>
            <CodePanel title="Error response" language="JSON">
              {errorExample}
            </CodePanel>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>HTTP</th>
                    <th>code</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map(([status, code, meaning]) => (
                    <tr key={code}>
                      <td>{status}</td>
                      <td>
                        <code>{code}</code>
                      </td>
                      <td>{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="docs-callout">
              <span>↻</span>
              <div>
                <b>重试建议</b>
                <p>
                  对 429、502、503 使用指数退避。已经收到明确的终态错误且要重新发起
                  一次新调用时使用新幂等键；只有在网络中断、无法判断服务端是否收到
                  请求时，才先复用原键安全确认。收到 409
                  表示原键已有请求记录，不会重复调用或扣费，应先在控制台核对原请求，
                  再决定是否用新键发起新的计费尝试。
                </p>
              </div>
            </div>
          </section>

          <section id="billing">
            <div className="docs-section-label">07 / BILLING</div>
            <h2>计费语义</h2>
            <p>
              余额使用美元微单位记录，<code>1 USD = 1,000,000 micros</code>
              ，避免浮点误差。控制台将其格式化为美元金额。
            </p>
            <div className="billing-rules">
              <div>
                <span>01</span>
                <p>
                  <b>先校验余额</b>
                  余额不足时返回 402，不会向上游发起调用。
                </p>
              </div>
              <div>
                <span>02</span>
                <p>
                  <b>逐请求记账</b>
                  调用记录包含路径、状态码、耗时与最终扣费。
                </p>
              </div>
              <div>
                <span>03</span>
                <p>
                  <b>只为上游成功请求扣费</b>
                  只有上游 HTTP 200 的请求最终扣费；非 200 自动退款。
                </p>
              </div>
            </div>
          </section>

          <section id="webhooks">
            <div className="docs-section-label">08 / PAYMENT CONFIRMATION</div>
            <h2>充值确认不依赖浏览器</h2>
            <p>
              创建充值单后，控制台会显示地址、币种、应付数量与 invoice
              链接。支付供应商 Webhook 只在 RelayBase
              服务端内部处理；客户无需配置回调地址，也不能由前端自行把订单标为已支付。
            </p>
            <div className="docs-callout docs-callout-lime">
              <span>✓</span>
              <div>
                <b>以控制台状态和余额为准</b>
                <p>
                  链上确认完成后，充值会幂等入账。重复支付通知不会重复增加余额。
                  最近充值会分别显示订单金额、实际入账、退款冲销和复核状态；支付商
                  回调缺失时，服务端定时对账还会复查待确认及近期失败/过期订单。
                </p>
              </div>
            </div>
          </section>

          <section className="docs-next">
            <p>准备好发出第一条请求？</p>
            <h2>生成 Key，带着文档一起开工。</h2>
            <div>
              <Link className="button button-blue" href="/console">
                打开控制台 →
              </Link>
              <Link className="button button-ghost" href="/pricing">
                查看定价
              </Link>
            </div>
          </section>
        </article>
      </div>
    </main>
  );
}
