import type { Metadata } from "next";
import Link from "next/link";
import { PlatformIcon } from "./components/PlatformIcon";
import { getRequestOrigin } from "./request-origin";

export const metadata: Metadata = {
  title: "一个 API，接入多平台公开数据",
  description:
    "RelayBase 提供多平台 API 市场、统一 Bearer Key、安全只读代理、请求级计费与可审计调用记录。",
};

const platforms = [
  {
    name: "TikTok",
    value: "tiktok",
    detail: "用户 · 视频 · 搜索",
    group: "短视频",
  },
  {
    name: "Douyin",
    value: "douyin",
    detail: "作品 · 评论 · 热榜",
    group: "短视频",
  },
  {
    name: "Xiaohongshu",
    value: "xiaohongshu",
    detail: "笔记 · 作者 · 评论",
    group: "内容社区",
  },
  {
    name: "Instagram",
    value: "instagram",
    detail: "主页 · 帖子 · Reels",
    group: "社交媒体",
  },
  {
    name: "YouTube",
    value: "youtube",
    detail: "频道 · 视频 · 字幕",
    group: "视频内容",
  },
  {
    name: "X / Twitter",
    value: "twitter",
    detail: "用户 · 推文 · 趋势",
    group: "社交媒体",
  },
  {
    name: "Reddit",
    value: "reddit",
    detail: "社区 · 帖子 · 评论",
    group: "内容社区",
  },
  {
    name: "Bilibili",
    value: "bilibili",
    detail: "视频 · 创作者 · 评论",
    group: "视频内容",
  },
  {
    name: "Weibo",
    value: "weibo",
    detail: "用户 · 帖子 · 热点",
    group: "社交媒体",
  },
  {
    name: "Kuaishou",
    value: "kuaishou",
    detail: "创作者 · 视频 · 直播",
    group: "短视频",
  },
  {
    name: "WeChat",
    value: "wechat_mp",
    detail: "公众号 · 文章 · 搜索",
    group: "内容生态",
  },
  {
    name: "Threads",
    value: "threads",
    detail: "主页 · 帖子 · 回复",
    group: "社交媒体",
  },
] as const;

const coreCapabilities = [
  {
    code: "DISCOVER",
    title: "按平台发现可用 API",
    body: "市场直接读取当前部署的运行时目录，按平台、数据类型、方法与可用状态筛选；目录没有同步的能力不会被虚构展示。",
    href: "/catalog",
    link: "打开 API 市场",
  },
  {
    code: "AUTH",
    title: "一个 Bearer Key 统一鉴权",
    body: "同一把 RelayBase Key 调用已开放的多平台服务。密钥只在创建时完整显示，可在控制台独立撤销和轮换。",
    href: "/console",
    link: "管理 API Key",
  },
  {
    code: "PROXY",
    title: "只读代理与统一响应",
    body: "仅代理通过安全审核和价格审核的查询端点，统一返回 RelayBase JSON；写入、发布、互动和删除类操作不会开放。",
    href: "/docs",
    link: "查看调用规范",
  },
  {
    code: "LEDGER",
    title: "请求级计费与审计",
    body: "状态码、延迟、平台、价格和最终扣费逐条记录。只有上游 HTTP 200 请求最终扣费，非 200 自动退款。",
    href: "/pricing",
    link: "了解计费规则",
  },
] as const;

const workflow = [
  {
    number: "01",
    title: "在市场选择平台与接口",
    body: "先查看运行时完整目录，确认平台、数据类型、方法、可用状态与每次请求价格。",
    accent: "blue",
  },
  {
    number: "02",
    title: "创建并保存 API Key",
    body: "控制台生成 rb_live_ 密钥；完整值只展示一次，后续可按业务用途独立撤销。",
    accent: "lime",
  },
  {
    number: "03",
    title: "调用审核后的 /v1 路径",
    body: "使用 Bearer 鉴权和幂等键发起只读请求，成功结果统一进入 RelayBase JSON 包装。",
    accent: "dark",
  },
  {
    number: "04",
    title: "在账本核对结果与费用",
    body: "请求状态、耗时、价格和扣费可追踪；上游非 200 请求自动退款，不形成最终费用。",
    accent: "brown",
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
            MULTI-PLATFORM DATA API · RELAYBASE
          </div>
          <h1>
            一个 API，
            <span>接入多平台公开数据</span>
          </h1>
          <p className="hero-lede">
            RelayBase 是面向产品、研究与自动化工作流的数据访问层。
            它把已审核的只读接口放进统一市场，用一个 Bearer Key
            调用，并按成功请求记录费用和状态。
          </p>
          <div className="hero-actions">
            <Link className="button button-blue button-large" href="/catalog">
              浏览 API 市场
              <span aria-hidden="true">→</span>
            </Link>
            <Link className="button button-ghost button-large" href="/console">
              获取 API Key
            </Link>
          </div>
          <div className="hero-proof" aria-label="产品特性">
            <span>
              <b>01</b> 运行时 API 目录
            </span>
            <span>
              <b>02</b> 多平台统一鉴权
            </span>
            <span>
              <b>03</b> 请求级计费账本
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
              <b>一条调用链包含鉴权、路由、响应和计费。</b>
              <br />
              上游控制字段不会暴露给客户。
            </p>
          </div>
        </div>
      </section>

      <section className="trust-strip" aria-label="接入特点">
        <span>RUNTIME CATALOG</span>
        <i />
        <span>ONE BEARER KEY</span>
        <i />
        <span>READ-ONLY PROXY</span>
        <i />
        <span>REQUEST LEDGER</span>
      </section>

      <section className="section section-grid" id="platforms">
        <div className="section-heading">
          <p className="section-kicker">PLATFORM / 01</p>
          <h2>
            多个平台的数据，
            <br />
            用同一种方式接入
          </h2>
        </div>
        <div className="section-intro">
          <p>
            覆盖短视频、社交媒体、视频内容与内容社区。平台只是一级入口，
            具体服务、方法、价格和可用状态以当前运行时 API 市场为准。
          </p>
          <Link className="text-link" href="/catalog">
            按平台浏览当前服务 <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <div className="platform-grid">
          {platforms.map((platform) => (
            <article className="platform-card" key={platform.name}>
              <div className="platform-card-top">
                <PlatformIcon
                  platform={platform.value}
                  className="platform-logo"
                />
                <span className="platform-index">{platform.group}</span>
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
              <PlatformIcon platform="all" className="platform-logo" />
              <span className="platform-index">完整目录</span>
            </div>
            <h3>更多平台</h3>
            <p>在市场查看全部平台与当前运行时服务</p>
            <Link href="/catalog">打开市场</Link>
          </article>
        </div>
      </section>

      <section className="section capability-section">
        <div className="capability-heading">
          <div>
            <p className="section-kicker">PRODUCT / 02</p>
            <h2>不是接口清单，而是一条完整的数据调用链。</h2>
          </div>
          <p>
            从发现服务到生成密钥、调用代理、查看账本，RelayBase
            把多平台数据接入所需的关键能力放进同一套产品界面。
          </p>
        </div>
        <div className="capability-grid">
          {coreCapabilities.map((capability, index) => (
            <article className="capability-card" key={capability.code}>
              <header>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <code>{capability.code}</code>
              </header>
              <h3>{capability.title}</h3>
              <p>{capability.body}</p>
              <Link href={capability.href}>
                {capability.link}
                <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="section workflow-section">
        <div className="workflow-header">
          <p className="section-kicker">WORKFLOW / 03</p>
          <h2>从发现接口到核对费用，四步闭环。</h2>
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
          <p className="section-kicker">BILLING / 04</p>
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
          <p className="section-kicker">SECURITY / 05</p>
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
