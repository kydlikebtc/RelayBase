import type { Metadata } from "next";
import Link from "next/link";
import { PlatformIcon } from "./components/PlatformIcon";
import { getRequestOrigin } from "./request-origin";

export const metadata: Metadata = {
  title: "面向 AI 与应用的多平台数据市场",
  description:
    "RelayBase 将分散的公开数据能力标准化为可发现、可比较、可计价、可调用的数据产品。",
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
    title: "发现可信数据供给",
    body: "从平台、数据类型、能力与可用状态出发，快速找到适合业务的数据产品；未同步、未审核的供给不会进入可用目录。",
    href: "/catalog",
    link: "进入数据市场",
  },
  {
    code: "STANDARDIZE",
    title: "将接口组织成数据产品",
    body: "平台来源、数据类型、调用方式、可用状态和价格被放进同一套商品结构，供给可以被搜索、比较和持续治理。",
    href: "/docs",
    link: "查看产品规范",
  },
  {
    code: "CONSUME",
    title: "用统一协议消费数据",
    body: "一个 Bearer Key 即可调用已开放的多平台数据产品，响应统一为 RelayBase JSON，让产品、Agent 与自动化流程复用同一接入方式。",
    href: "/console",
    link: "开始使用数据",
  },
  {
    code: "SETTLE",
    title: "按真实用量透明结算",
    body: "每次消费的状态、延迟、数据来源、价格和最终扣费逐条记录；只有成功请求形成费用，失败请求自动退款。",
    href: "/pricing",
    link: "了解市场结算",
  },
] as const;

const workflow = [
  {
    number: "01",
    title: "发现需要的数据产品",
    body: "从平台和数据类型进入市场，筛选当前真实存在且通过审核的数据供给。",
    accent: "blue",
  },
  {
    number: "02",
    title: "比较能力、状态与价格",
    body: "在产品详情中确认数据范围、请求参数、可用状态、限流策略和每次消费价格。",
    accent: "lime",
  },
  {
    number: "03",
    title: "通过统一协议投入生产",
    body: "创建 RelayBase Key，以同一套鉴权、路径和响应规范调用不同平台的数据产品。",
    accent: "dark",
  },
  {
    number: "04",
    title: "按真实消费完成结算",
    body: "每次请求的状态、耗时、价格与扣费进入账本；失败请求自动退款，不形成最终费用。",
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
            MULTI-PLATFORM DATA MARKETPLACE · RELAYBASE
          </div>
          <h1>
            面向 AI 与应用的
            <span>多平台数据市场</span>
          </h1>
          <p className="hero-lede">
            RelayBase 将分散在不同平台的公开数据能力，标准化为可搜索、可比较、
            可计价、可调用的数据产品。团队从发现供给到规模化使用，都在同一个
            市场完成。
          </p>
          <div className="hero-actions">
            <Link className="button button-blue button-large" href="/catalog">
              进入数据市场
              <span aria-hidden="true">→</span>
            </Link>
            <Link className="button button-ghost button-large" href="/console">
              开始使用数据
            </Link>
          </div>
          <div className="hero-proof" aria-label="产品特性">
            <span>
              <b>01</b> 多源数据供给
            </span>
            <span>
              <b>02</b> 标准化数据产品
            </span>
            <span>
              <b>03</b> 透明计价与审计
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
              <b>每一项可调用能力，都是可发现、可计价、可审计的数据产品。</b>
              <br />
              API 是交付方式，数据才是市场的核心。
            </p>
          </div>
        </div>
      </section>

      <section className="trust-strip" aria-label="数据市场特点">
        <span>CURATED DATA SUPPLY</span>
        <i />
        <span>STANDARDIZED PRODUCTS</span>
        <i />
        <span>UNIFIED CONSUMPTION</span>
        <i />
        <span>TRANSPARENT SETTLEMENT</span>
      </section>

      <section className="section section-grid" id="platforms">
        <div className="section-heading">
          <p className="section-kicker">SUPPLY / 01</p>
          <h2>
            一个市场，
            <br />
            连接分散的数据供给
          </h2>
        </div>
        <div className="section-intro">
          <p>
            RelayBase 按平台聚合短视频、社交媒体、视频内容与内容社区的数据能力，
            再将它们整理为结构一致的数据产品。市场中的能力、价格和状态均来自当前
            运行时供给目录。
          </p>
          <Link className="text-link" href="/catalog">
            查看数据供给版图 <span aria-hidden="true">↗</span>
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
            <p>在数据市场查看全部平台与当前可用产品</p>
            <Link href="/catalog">进入市场</Link>
          </article>
        </div>
      </section>

      <section className="section capability-section">
        <div className="capability-heading">
          <div>
            <p className="section-kicker">MARKET / 02</p>
            <h2>不止汇总接口，而是组织一整个数据市场。</h2>
          </div>
          <p>
            RelayBase 把分散的接口供给转化为可理解、可比较、可消费的数据产品，
            并用统一的接入和结算基础设施，让数据真正进入生产流程。
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
          <p className="section-kicker">TRANSACTION / 03</p>
          <h2>从发现数据到投入生产，四步完成。</h2>
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
          <p className="section-kicker">SETTLEMENT / 04</p>
          <h2>
            数据消费，
            <br />
            按真实请求结算
          </h2>
          <p className="heading-note">
            不预设套餐，不锁定月费。价格直接附着在数据产品上，余额只用于真实消费，
            每笔费用都能回到具体请求。只有成功请求最终扣费，失败请求自动退款。
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
          <p className="section-kicker">GOVERNANCE / 05</p>
          <h2>市场有边界，数据使用才有信任。</h2>
          <p>
            RelayBase 只将完成目录、安全与价格审核的数据能力放进可用市场。
            平台来源、只读边界、调用状态与结算证据都被明确记录。
          </p>
        </div>
        <div className="security-list">
          <div>
            <span>CURATE</span>
            <p>
              <b>数据供给经过审核</b>
              未完成目录同步、安全核验和价格复核的产品不会进入可用市场。
            </p>
          </div>
          <div>
            <span>BOUNDARY</span>
            <p>
              <b>只开放数据查询</b>
              不代理写入、发布、互动或删除操作，来源与控制字段不会向客户暴露。
            </p>
          </div>
          <div>
            <span>LEDGER</span>
            <p>
              <b>请求级审计记录</b>
              状态码、延迟、数据来源、单价与扣费金额逐条可查。
            </p>
          </div>
        </div>
      </section>

      <section className="final-cta">
        <div className="cta-grid" aria-hidden="true" />
        <p>ENTER THE DATA MARKET</p>
        <h2>
          下一项数据能力，
          <br />
          不必再从零寻找。
        </h2>
        <div>
          <Link className="button button-lime button-large" href="/catalog">
            进入数据市场 <span aria-hidden="true">↗</span>
          </Link>
          <Link className="button button-ghost-light button-large" href="/docs">
            查看接入文档
          </Link>
        </div>
      </section>
    </main>
  );
}
