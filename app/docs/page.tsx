import type { Metadata } from "next";
import Link from "next/link";
import { getRequestOrigin } from "../request-origin";

export const metadata: Metadata = {
  title: "API 文档",
  description:
    "RelayBase API 鉴权、请求示例、错误码、计费与支付确认语义。",
};

function codeExamples(origin: string) {
  const curl = `curl --request GET \\
  '${origin}/v1/tiktok/web/fetch_user_profile?uniqueId=mrbeast' \\
  --header 'Authorization: Bearer rb_live_YOUR_KEY' \\
  --header 'Idempotency-Key: profile-sync-20260723-001' \\
  --header 'Accept: application/json'`;

  const javascript = `const response = await fetch(
  "${origin}/v1/tiktok/web/fetch_user_profile?uniqueId=mrbeast",
  {
    headers: {
      Authorization: "Bearer rb_live_YOUR_KEY",
      "Idempotency-Key": "profile-sync-20260723-001",
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
        "Idempotency-Key": "profile-sync-20260723-001",
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
  ["401", "invalid_api_key", "API Key 缺失、无效或已撤销"],
  ["402", "insufficient_balance", "可用余额不足以发起本次调用"],
  ["409", "idempotency_conflict", "幂等键已被使用；不会重复调用或扣费"],
  ["404", "endpoint_not_enabled", "接口未开放，或上游通过统一错误体返回 404"],
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
            <a href="#catalog">接口目录</a>
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
                MVP 仅开放 <code>GET</code> 只读端点，不代理写入、发布或删除操作。
              </li>
            </ul>
          </section>

          <section id="catalog">
            <div className="docs-section-label">02 / CATALOG</div>
            <h2>先读取当前开放目录</h2>
            <p>
              <Link href="/catalog">接口目录页面</Link>
              只展示已经完成只读、安全和价格审核的路径。程序也可以直接读取公开 JSON：
            </p>
            <CodePanel title="Public endpoint catalog" language="HTTP">
              {`GET ${origin}/api/catalog
GET ${origin}/api/catalog?platform=tiktok&limit=100`}
            </CodePanel>
            <p>
              返回的 <code>priceUsdMicros</code> 是每次上游 HTTP 200
              成功请求的客户价格。未出现在目录中的路径不能调用。
            </p>
          </section>

          <section id="auth">
            <div className="docs-section-label">03 / AUTH</div>
            <h2>Bearer Key 鉴权</h2>
            <p>
              在控制台生成以 <code>rb_live_</code> 开头的密钥，并放入每次请求的{" "}
              <code>Authorization</code> 请求头。每个业务任务还应发送唯一的{" "}
              <code>Idempotency-Key</code>。
            </p>
            <CodePanel title="Authorization header" language="HTTP">
              {`Authorization: Bearer rb_live_YOUR_KEY
Idempotency-Key: profile-sync-20260723-001`}
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
                  只对 429、502、503 和网络超时进行指数退避重试，并始终复用原来的幂等键。收到
                  409 时不要换键盲目重放，应先核对原请求。
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
