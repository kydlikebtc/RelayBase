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
  '${origin}/v1/tiktok/web/fetch_user_profile?uniqueId=mrbeast' \\
  --header 'Authorization: Bearer rb_live_YOUR_KEY' \\
  --header 'Idempotency-Key: profile-sync-20260724-001' \\
  --header 'X-RelayBase-Max-Cost-Usd-Micros: 2000' \\
  --header 'Accept: application/json'`;

  const javascript = `const response = await fetch(
  "${origin}/v1/tiktok/web/fetch_user_profile?uniqueId=mrbeast",
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
    "${origin}/v1/tiktok/web/fetch_user_profile",
    params={"uniqueId": "mrbeast"},
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
  ["400", "invalid_marketplace_endpoint", "详情 path 或 method 缺失或无效"],
  ["400", "invalid_max_cost", "最高成本请求头不是允许范围内的微美元整数"],
  ["401", "invalid_api_key", "API Key 缺失、无效或已撤销"],
  ["402", "insufficient_balance", "可用余额不足以发起本次调用"],
  ["409", "idempotency_conflict", "幂等键已被使用；不会重复调用或扣费"],
  ["409", "price_quote_exceeded", "实时客户价超过请求声明的最高成本"],
  ["404", "endpoint_not_enabled", "接口未开放，或上游通过统一错误体返回 404"],
  ["404", "marketplace_endpoint_not_found", "参考市场中没有匹配的 path 与 method"],
  ["429", "rate_limit_exceeded", "客户、账户或共享上游达到速率限制"],
  ["502", "upstream_unavailable", "上游网络不可用；请求已退款"],
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
              <code>/v1/tiktok/web/fetch_user_profile</code>
            </div>
            <ul className="docs-checklist">
              <li>
                <span>✓</span>
                请求与响应均使用 UTF-8；响应格式为 JSON。
              </li>
              <li>
                <span>✓</span>
                查询参数使用 URL 编码，布尔值使用 <code>true</code> /{" "}
                <code>false</code>。
              </li>
              <li>
                <span>✓</span>
                每个响应都应保留 HTTP 状态码；错误体遵循统一结构。
              </li>
              <li>
                <span>✓</span>
                仅开放通过只读、安全和价格审核的 <code>GET</code> /{" "}
                <code>POST</code> 数据查询端点；不代理写入、发布、互动或删除操作。
              </li>
            </ul>
          </section>

          <section id="catalog">
            <div className="docs-section-label">02 / CATALOG</div>
            <h2>区分能力发现与真实可调用。</h2>
            <p>
              <Link href="/catalog">API 市场页面</Link>
              使用 TikHub OpenAPI V5.3.2 静态参考快照，展示 1,025 个 operations：
              GET 839、POST 186，覆盖 27 个平台、53 个 TikHub 官方 tags 和 15 个
              RelayBase 归一化类型。参考市场用于搜索与能力发现，不代表当前部署已经
              取得调用权限或完成核价。来源可追溯到{" "}
              <a
                href="https://docs.tikhub.io/4579905m0"
                target="_blank"
                rel="noreferrer"
              >
                TikHub 官方文档入口
              </a>
              。
            </p>
            <CodePanel title="Marketplace discovery" language="HTTP">
              {`GET ${origin}/api/marketplace?q=user&platform=tiktok&tag=TikTok-Web-API&dataType=profile_creator&method=GET&surface=web&availability=available&limit=20&offset=0
GET ${origin}/api/marketplace/detail?path=%2Fv1%2Ftiktok%2Fweb%2Ffetch_user_profile&method=GET`}
            </CodePanel>
            <p>
              市场列表支持 <code>q</code>、<code>platform</code>、
              TikHub 官方分类 <code>tag</code>、RelayBase 归一化分类{" "}
              <code>dataType</code>、<code>method</code>、
              <code>surface</code>、<code>availability</code>、
              <code>limit</code> 和 <code>offset</code>。默认每页 20 条；
              响应包含 <code>source</code>、全局 <code>stats</code> 与{" "}
              <code>facets</code>、当前页 <code>endpoints</code>、筛选后{" "}
              <code>total</code>、<code>count</code>、<code>offset</code> 和{" "}
              <code>nextOffset</code>。
            </p>
            <CodePanel title="Marketplace detail response" language="JSON">
              {`{
  "source": {
    "provider": "TikHub",
    "openApiVersion": "V5.3.2",
    "snapshotHash": "f941ffbce28988ca158b2fb8febf2a206004eaba1d2d0e1a7eba9678f9461a01",
    "generatedAt": "2026-07-23",
    "operationCount": 1025
  },
  "endpoint": {
    "path": "/v1/tiktok/web/fetch_user_profile",
    "method": "GET",
    "availability": "pending",
    "tags": ["TikTok-Web-API"],
    "operationId": "fetch_user_profile_api_v1_tiktok_web_fetch_user_profile_get",
    "description": "Get user profile",
    "parameters": [
      {
        "name": "uniqueId",
        "in": "query",
        "required": false,
        "schema": { "type": "string" }
      }
    ],
    "requestBody": null,
    "response": {
      "statuses": [
        {
          "status": "200",
          "description": "Successful Response",
          "schemaRef": "#/components/schemas/ResponseModel"
        },
        {
          "status": "422",
          "description": "Validation Error",
          "schemaRef": "#/components/schemas/HTTPValidationError"
        }
      ]
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
              详情查询必须同时提供 URL 编码的精确 <code>path</code> 和{" "}
              <code>method=GET|POST</code>。它返回同代来源、官方 tags、
              <code>operationId</code>、描述、参数、请求体、响应状态与上游 Schema
              标识，以及按该端点方法生成的 cURL、JavaScript、Python 示例。
              <code>schemaRef</code> 只用于标识 TikHub OpenAPI 来源，不是在该响应内
              可独立解析的完整 components。
              <code>available</code> 才表示当前可代理；<code>pending</code> 是待审核
              或部署尚未就绪，<code>restricted</code> 永不开放。
            </p>
            <div className="docs-callout docs-callout-warning">
              <span>!</span>
              <div>
                <b>参考展示不等于可调用</b>
                <p>
                  只有真实 TikHub Key、完整同步与覆盖证明、安全审核、核价上架和近期
                  对账健康全部满足，并且实时 OpenAPI 的哈希与操作数和本页参考快照
                  完全一致、全部 (method, path) 身份集合无缺失或重复时，端点才会
                  成为 available。价格和速率在未开放时可以为 null。
                </p>
              </div>
            </div>
            <CodePanel title="Callable endpoint catalog" language="HTTP">
              {`GET ${origin}/api/catalog
GET ${origin}/api/catalog?platform=tiktok&limit=100`}
            </CodePanel>
            <p>
              <code>/api/catalog</code> 是端点级已开放清单。客户还必须确认响应中的{" "}
              <code>mode=live</code>，并满足最新 readiness、账户、余额和限流条件。
              <code>priceUsdMicros</code> 是每次上游 HTTP 200 成功请求的客户价格；
              未出现在该目录中的路径不能调用。
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
              下面都请求同一个 TikTok 用户资料能力。把示例域名替换为你的部署域名，并替换 API
              Key。
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
              公开端点成功时原样透传上游 JSON，不额外包裹 RelayBase
              字段。请求标识与计费信息通过响应头和控制台提供；任何平台或上游错误都使用下方统一错误体。
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
                <p>上游 JSON 已原样返回，本次调用按对应能力最终计费。</p>
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
