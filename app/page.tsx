import type { Metadata } from "next";
import Link from "next/link";
import { getRequestOrigin } from "./request-origin";

export const metadata: Metadata = {
  title: "稳定的数据 API",
  description:
    "一个 Bearer Key 统一调用 TikTok 等平台数据，稳定币充值，只为上游成功请求扣费。",
};

const platforms = [
  { name: "TikTok", code: "TK", detail: "用户 · 视频 · 搜索" },
  { name: "Douyin", code: "DY", detail: "作品 · 评论 · 热榜" },
  { name: "Instagram", code: "IG", detail: "主页 · 帖子 · Reels" },
  { name: "YouTube", code: "YT", detail: "频道 · 视频 · 字幕" },
  { name: "X / Twitter", code: "X", detail: "用户 · 推文 · 趋势" },
  { name: "Reddit", code: "RD", detail: "社区 · 帖子 · 评论" },
] as const;

const workflow = [
  {
    number: "01",
    title: "生成一个 Key",
    body: "登录控制台后创建 API Key。密钥只展示一次，前缀可随时识别和撤销。",
    accent: "blue",
  },
  {
    number: "02",
    title: "请求统一入口",
    body: "公开端点统一返回 RelayBase JSON 包装；只需要保持 Bearer 鉴权并切换 /v1 后的平台与能力路径。",
    accent: "lime",
  },
  {
    number: "03",
    title: "按成功调用结算",
    body: "只有上游 HTTP 200 请求最终扣费；非 200 自动退款。成本、延迟和状态都有记录。",
    accent: "dark",
  },
] as const;

const billRows = [
  { item: "TikTok 用户资料", requests: "1,000", unit: "$0.002", total: "$2.00" },
  { item: "视频详情", requests: "500", unit: "$0.004", total: "$2.00" },
  { item: "失败请求", requests: "37", unit: "$0.000", total: "$0.00" },
] as const;

export default async function Home() {
  const origin = await getRequestOrigin();

  return (
    <main id="main-content">
      <section className="hero section-grid">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-pulse" aria-hidden="true" />
            统一数据出口 · 稳定币结算
          </div>
          <h1>
            把分散的接口，
            <span>收进一条稳定 API</span>
          </h1>
          <p className="hero-lede">
            面向产品、研究和自动化工作流的数据调用层。一个 Bearer
            Key，统一鉴权、统一计费、统一错误体。
          </p>
          <div className="hero-actions">
            <Link className="button button-blue button-large" href="/console">
              开始接入
              <span aria-hidden="true">→</span>
            </Link>
            <Link className="button button-ghost button-large" href="/docs">
              阅读 API 文档
            </Link>
          </div>
          <div className="hero-proof" aria-label="产品特性">
            <span>
              <b>01</b> 无订阅
            </span>
            <span>
              <b>02</b> 成功请求扣费
            </span>
            <span>
              <b>03</b> USDT / USDC
            </span>
          </div>
        </div>

        <div className="hero-console" aria-label="API 请求示例">
          <div className="code-window">
            <div className="code-window-bar">
              <div className="window-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <span>request.sh</span>
              <span className="code-live">
                <i aria-hidden="true" />
                API v1
              </span>
            </div>
            <div className="code-tabs" aria-hidden="true">
              <span className="active">cURL</span>
              <span>JavaScript</span>
              <span>Python</span>
            </div>
            <pre className="hero-code">
              <code>
                <span className="code-muted">01</span>{" "}
                <span className="code-blue">curl</span> --request GET \{"\n"}
                <span className="code-muted">02</span> &nbsp;
                <span className="code-lime">
                  &apos;{origin}/v1/example/
                  {"\n"}
                </span>
                <span className="code-muted">03</span> &nbsp;
                <span className="code-lime">
                  profile/read?profile_id=demo-123&apos;
                </span>{" "}
                \{"\n"}
                <span className="code-muted">04</span> &nbsp;--header{" "}
                <span className="code-lime">
                  &apos;Authorization: Bearer rb_live_••••&apos;
                </span>
                {" "}
                \{"\n"}
                <span className="code-muted">05</span> &nbsp;--header{" "}
                <span className="code-lime">
                  &apos;Idempotency-Key: profile-sync-001&apos;
                </span>
              </code>
            </pre>
            <div className="response-label">
              <span>RELAYBASE JSON · 200</span>
              <span>482 ms</span>
            </div>
            <pre className="response-code">
              <code>
                {"{"}
                {"\n"} &nbsp;<span className="code-blue">&quot;success&quot;</span>:{" "}
                <span className="code-lime">true</span>,
                {"\n"} &nbsp;<span className="code-blue">&quot;data&quot;</span>:{" "}
                {"{"}
                {"\n"} &nbsp;&nbsp;
                <span className="code-blue">&quot;userInfo&quot;</span>:{" "}
                {"{"} <span className="code-blue">&quot;uniqueId&quot;</span>:{" "}
                <span className="code-lime">&quot;mrbeast&quot;</span>, … {"}"}
                {"\n"} &nbsp;{"}"}
                {"\n"}
                {"}"}
              </code>
            </pre>
          </div>
          <div className="console-note">
            <span className="note-arrow" aria-hidden="true">
              ↳
            </span>
            <p>
              <b>公开端点统一返回 RelayBase JSON。</b>
              <br />
              外部服务控制字段不会暴露给客户。
            </p>
          </div>
        </div>
      </section>

      <section className="trust-strip" aria-label="接入特点">
        <span>JSON FIRST</span>
        <i />
        <span>BEARER AUTH</span>
        <i />
        <span>USDC / USDT</span>
        <i />
        <span>REQUEST-LEVEL BILLING</span>
      </section>

      <section className="section section-grid" id="platforms">
        <div className="section-heading">
          <p className="section-kicker">PLATFORM / 01</p>
          <h2>
            需要的数据很多，
            <br />
            接入方式只有一种
          </h2>
        </div>
        <div className="section-intro">
          <p>
            下列是上游可编排的数据范围；只有完成只读、安全和价格审核后才会进入
            RelayBase 公开目录，以目录实时状态为准。
          </p>
          <Link className="text-link" href="/catalog">
            浏览当前接口 <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <div className="platform-grid">
          {platforms.map((platform, index) => (
            <article className="platform-card" key={platform.name}>
              <div className="platform-card-top">
                <span className="platform-code">{platform.code}</span>
                <span className="platform-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h3>{platform.name}</h3>
              <p>{platform.detail}</p>
              <span className="platform-arrow" aria-hidden="true">
                ↗
              </span>
            </article>
          ))}
          <article className="platform-card platform-card-more">
            <div className="platform-card-top">
              <span className="platform-code">++</span>
              <span className="platform-index">NEXT</span>
            </div>
            <h3>持续扩展</h3>
            <p>更多公开数据能力正在整理接入</p>
            <Link href="/catalog">查看全部路径</Link>
          </article>
        </div>
      </section>

      <section className="section workflow-section">
        <div className="workflow-header">
          <p className="section-kicker section-kicker-light">WORKFLOW / 02</p>
          <h2>从充值到第一条数据，三步。</h2>
        </div>
        <div className="workflow-grid">
          {workflow.map((step) => (
            <article
              className={`workflow-card workflow-${step.accent}`}
              key={step.number}
            >
              <span>{step.number}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="workflow-endpoint">
          <span className="endpoint-method">GET</span>
          <code>/v1/example/profile/read</code>
          <span className="endpoint-latency">200 · 482 ms</span>
        </div>
      </section>

      <section className="section billing-section section-grid">
        <div className="section-heading">
          <p className="section-kicker">BILLING / 03</p>
          <h2>
            每一分钱，
            <br />
            都能对上请求
          </h2>
          <p className="heading-note">
            不预设套餐，不锁定月费。余额用于真实请求，并在控制台保留逐条消费记录。
            只有上游 HTTP 200 的成功请求最终扣费，非 200 自动退款。
          </p>
          <Link className="button button-dark" href="/pricing">
            查看充值与计费
            <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="receipt-card">
          <div className="receipt-header">
            <div>
              <span>用量样例</span>
              <b>30 DAYS</b>
            </div>
            <span>USD</span>
          </div>
          <div className="receipt-table" role="table" aria-label="计费样例">
            <div className="receipt-row receipt-row-head" role="row">
              <span role="columnheader">调用项</span>
              <span role="columnheader">次数</span>
              <span role="columnheader">单价</span>
              <span role="columnheader">小计</span>
            </div>
            {billRows.map((row) => (
              <div className="receipt-row" role="row" key={row.item}>
                <span role="cell">{row.item}</span>
                <span role="cell">{row.requests}</span>
                <span role="cell">{row.unit}</span>
                <span role="cell">{row.total}</span>
              </div>
            ))}
          </div>
          <div className="receipt-total">
            <span>样例总额</span>
            <strong>$4.00</strong>
          </div>
          <p>* 价格仅作说明，实际单价以调用路径和控制台记录为准。</p>
        </div>
      </section>

      <section className="section security-section">
        <div className="security-copy">
          <p className="section-kicker section-kicker-light">SECURITY / 04</p>
          <h2>密钥归你，账目可查，边界说清。</h2>
          <p>
            RelayBase 是独立的数据接口封装层，不代表任何上游平台。
            我们把鉴权、调用与支付状态留在服务端，减少密钥暴露面。
          </p>
        </div>
        <div className="security-list">
          <div>
            <span>KEY</span>
            <p>
              <b>密钥仅创建时明文展示</b>
              之后只保留可识别前缀，可独立撤销和轮换。
            </p>
          </div>
          <div>
            <span>PAY</span>
            <p>
              <b>支付回调服务端验证</b>
              充值状态以链上确认与控制台账本为准。
            </p>
          </div>
          <div>
            <span>LOG</span>
            <p>
              <b>请求级审计记录</b>
              状态码、延迟、平台与扣费金额逐条可查。
            </p>
          </div>
        </div>
      </section>

      <section className="final-cta">
        <div className="cta-grid" aria-hidden="true" />
        <p>SHIP THE FIRST REQUEST</p>
        <h2>
          第一条稳定数据，
          <br />
          不该等到下个迭代。
        </h2>
        <div>
          <Link className="button button-lime button-large" href="/console">
            进入控制台 <span aria-hidden="true">↗</span>
          </Link>
          <Link className="button button-ghost-light button-large" href="/docs">
            先看文档
          </Link>
        </div>
      </section>
    </main>
  );
}
