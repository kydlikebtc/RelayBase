import type { Metadata } from "next";
import Link from "next/link";
import { PlatformIcon } from "./components/PlatformIcon";
import { getLocale } from "./locale";
import { getRequestOrigin } from "./request-origin";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return locale === "zh"
    ? {
        title: "面向 AI 与应用的多平台数据市场",
        description:
          "RelayBase 将分散的公开数据能力标准化为可发现、可比较、可计价、可调用的数据产品。",
      }
    : {
        title: "The multi-platform data market for AI and applications",
        description:
          "RelayBase standardizes fragmented public data capabilities into discoverable, comparable, priced and callable data products.",
      };
}

const platforms = [
  {
    name: "TikTok",
    value: "tiktok",
    detail: { en: "Users · videos · search", zh: "用户 · 视频 · 搜索" },
    group: { en: "Short video", zh: "短视频" },
  },
  {
    name: "Douyin",
    value: "douyin",
    detail: { en: "Posts · comments · trends", zh: "作品 · 评论 · 热榜" },
    group: { en: "Short video", zh: "短视频" },
  },
  {
    name: "Xiaohongshu",
    value: "xiaohongshu",
    detail: { en: "Notes · creators · comments", zh: "笔记 · 作者 · 评论" },
    group: { en: "Content community", zh: "内容社区" },
  },
  {
    name: "Instagram",
    value: "instagram",
    detail: { en: "Profiles · posts · Reels", zh: "主页 · 帖子 · Reels" },
    group: { en: "Social media", zh: "社交媒体" },
  },
  {
    name: "YouTube",
    value: "youtube",
    detail: { en: "Channels · videos · captions", zh: "频道 · 视频 · 字幕" },
    group: { en: "Video content", zh: "视频内容" },
  },
  {
    name: "X / Twitter",
    value: "twitter",
    detail: { en: "Users · posts · trends", zh: "用户 · 推文 · 趋势" },
    group: { en: "Social media", zh: "社交媒体" },
  },
  {
    name: "Reddit",
    value: "reddit",
    detail: { en: "Communities · posts · comments", zh: "社区 · 帖子 · 评论" },
    group: { en: "Content community", zh: "内容社区" },
  },
  {
    name: "Bilibili",
    value: "bilibili",
    detail: { en: "Videos · creators · comments", zh: "视频 · 创作者 · 评论" },
    group: { en: "Video content", zh: "视频内容" },
  },
  {
    name: "Weibo",
    value: "weibo",
    detail: { en: "Users · posts · trends", zh: "用户 · 帖子 · 热点" },
    group: { en: "Social media", zh: "社交媒体" },
  },
  {
    name: "Kuaishou",
    value: "kuaishou",
    detail: { en: "Creators · videos · live", zh: "创作者 · 视频 · 直播" },
    group: { en: "Short video", zh: "短视频" },
  },
  {
    name: "WeChat",
    value: "wechat_mp",
    detail: { en: "Accounts · articles · search", zh: "公众号 · 文章 · 搜索" },
    group: { en: "Content ecosystem", zh: "内容生态" },
  },
  {
    name: "Threads",
    value: "threads",
    detail: { en: "Profiles · posts · replies", zh: "主页 · 帖子 · 回复" },
    group: { en: "Social media", zh: "社交媒体" },
  },
] as const;

const coreCapabilities = [
  {
    code: "DISCOVER",
    title: { en: "Discover trusted data supply", zh: "发现可信数据供给" },
    body: {
      en: "Find the right data product by platform, data type, capability and availability. Unsynced or unreviewed supply never enters the callable catalog.",
      zh: "从平台、数据类型、能力与可用状态出发，快速找到适合业务的数据产品；未同步、未审核的供给不会进入可用目录。",
    },
    href: "/catalog",
    link: { en: "Explore the data market", zh: "进入数据市场" },
  },
  {
    code: "STANDARDIZE",
    title: { en: "Organize APIs as data products", zh: "将接口组织成数据产品" },
    body: {
      en: "Platform, data type, invocation model, availability and price share one product structure, making supply searchable, comparable and governable.",
      zh: "平台来源、数据类型、调用方式、可用状态和价格被放进同一套商品结构，供给可以被搜索、比较和持续治理。",
    },
    href: "/docs",
    link: { en: "Read the product standard", zh: "查看产品规范" },
  },
  {
    code: "CONSUME",
    title: { en: "Consume data through one protocol", zh: "用统一协议消费数据" },
    body: {
      en: "One Bearer Key reaches approved multi-platform products. RelayBase JSON gives products, agents and automations a reusable integration contract.",
      zh: "一个 Bearer Key 即可调用已开放的多平台数据产品，响应统一为 RelayBase JSON，让产品、Agent 与自动化流程复用同一接入方式。",
    },
    href: "/console",
    link: { en: "Start using data", zh: "开始使用数据" },
  },
  {
    code: "SETTLE",
    title: { en: "Settle transparently by usage", zh: "按真实用量透明结算" },
    body: {
      en: "Every request records status, latency, source, price and final charge. Only successful requests become billable; failed requests are refunded.",
      zh: "每次消费的状态、延迟、数据来源、价格和最终扣费逐条记录；只有成功请求形成费用，失败请求自动退款。",
    },
    href: "/pricing",
    link: { en: "Understand settlement", zh: "了解市场结算" },
  },
] as const;

const workflow = [
  {
    number: "01",
    title: { en: "Discover the data product you need", zh: "发现需要的数据产品" },
    body: {
      en: "Enter through platform and data type, then filter the supply that exists now and has passed review.",
      zh: "从平台和数据类型进入市场，筛选当前真实存在且通过审核的数据供给。",
    },
    accent: "blue",
  },
  {
    number: "02",
    title: { en: "Compare capability, status and price", zh: "比较能力、状态与价格" },
    body: {
      en: "Confirm data scope, parameters, availability, rate policy and per-request price in the product detail.",
      zh: "在产品详情中确认数据范围、请求参数、可用状态、限流策略和每次消费价格。",
    },
    accent: "lime",
  },
  {
    number: "03",
    title: { en: "Ship through one protocol", zh: "通过统一协议投入生产" },
    body: {
      en: "Create a RelayBase Key and use the same authentication, path and response conventions across platforms.",
      zh: "创建 RelayBase Key，以同一套鉴权、路径和响应规范调用不同平台的数据产品。",
    },
    accent: "dark",
  },
  {
    number: "04",
    title: { en: "Settle against real consumption", zh: "按真实消费完成结算" },
    body: {
      en: "Status, latency, price and charge enter the request ledger. Failed requests are refunded and never become final cost.",
      zh: "每次请求的状态、耗时、价格与扣费进入账本；失败请求自动退款，不形成最终费用。",
    },
    accent: "brown",
  },
] as const;

const billRows = [
  { item: { en: "TikTok profiles", zh: "TikTok 用户资料" }, requests: "1,000", unit: "$0.002", total: "$2.00" },
  { item: { en: "Video detail", zh: "视频详情" }, requests: "500", unit: "$0.004", total: "$2.00" },
  { item: { en: "Failed requests", zh: "失败请求" }, requests: "37", unit: "$0.000", total: "$0.00" },
] as const;

export default async function Home() {
  const origin = await getRequestOrigin();
  const locale = await getLocale();
  const isZh = locale === "zh";

  return (
    <main id="main-content">
      <section className="hero section-grid">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-pulse" aria-hidden="true" />
            MULTI-PLATFORM DATA MARKETPLACE · RELAYBASE
          </div>
          <h1>
            {isZh ? "面向 AI 与应用的" : "The multi-platform"}
            <span>{isZh ? "多平台数据市场" : "data market for AI"}</span>
          </h1>
          <p className="hero-lede">
            {isZh
              ? "RelayBase 将分散在不同平台的公开数据能力，标准化为可搜索、可比较、可计价、可调用的数据产品。团队从发现供给到规模化使用，都在同一个市场完成。"
              : "RelayBase turns fragmented public data capabilities into searchable, comparable, priced and callable data products. Teams discover supply and put it into production in one market."}
          </p>
          <div className="hero-actions">
            <Link className="button button-blue button-large" href="/catalog">
              {isZh ? "进入数据市场" : "Explore the data market"}
              <span aria-hidden="true">→</span>
            </Link>
            <Link className="button button-ghost button-large" href="/console">
              {isZh ? "开始使用数据" : "Start using data"}
            </Link>
          </div>
          <div className="hero-proof" aria-label={isZh ? "产品特性" : "Product characteristics"}>
            <span>
              <b>01</b> {isZh ? "多源数据供给" : "Multi-source supply"}
            </span>
            <span>
              <b>02</b> {isZh ? "标准化数据产品" : "Standardized products"}
            </span>
            <span>
              <b>03</b> {isZh ? "透明计价与审计" : "Transparent pricing"}
            </span>
          </div>
        </div>

        <div className="hero-console" aria-label={isZh ? "API 请求示例" : "API request example"}>
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
              <b>
                {isZh
                  ? "每一项可调用能力，都是可发现、可计价、可审计的数据产品。"
                  : "Every callable capability is a discoverable, priced and auditable data product."}
              </b>
              <br />
              {isZh
                ? "API 是交付方式，数据才是市场的核心。"
                : "APIs are the delivery layer. Data is the market."}
            </p>
          </div>
        </div>
      </section>

      <section className="trust-strip" aria-label={isZh ? "数据市场特点" : "Data market characteristics"}>
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
            {isZh ? "一个市场，" : "One market,"}
            <br />
            {isZh ? "连接分散的数据供给" : "connected data supply"}
          </h2>
        </div>
        <div className="section-intro">
          <p>
            {isZh
              ? "RelayBase 按平台聚合短视频、社交媒体、视频内容与内容社区的数据能力，再将它们整理为结构一致的数据产品。市场中的能力、价格和状态均来自当前运行时供给目录。"
              : "RelayBase aggregates short-video, social, video and community data capabilities by platform, then organizes them into consistently structured products. Capability, price and status come from the current runtime catalog."}
          </p>
          <Link className="text-link" href="/catalog">
            {isZh ? "查看数据供给版图" : "Browse the supply map"} <span aria-hidden="true">↗</span>
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
                <span className="platform-index">{platform.group[locale]}</span>
              </div>
              <h3>{platform.name}</h3>
              <p>{platform.detail[locale]}</p>
              <span className="platform-arrow" aria-hidden="true">
                ↗
              </span>
            </article>
          ))}
          <article className="platform-card platform-card-more">
            <div className="platform-card-top">
              <PlatformIcon platform="all" className="platform-logo" />
              <span className="platform-index">{isZh ? "完整目录" : "Full catalog"}</span>
            </div>
            <h3>{isZh ? "更多平台" : "More platforms"}</h3>
            <p>{isZh ? "在数据市场查看全部平台与当前可用产品" : "See every platform and currently available product"}</p>
            <Link href="/catalog">{isZh ? "进入市场" : "Enter market"}</Link>
          </article>
        </div>
      </section>

      <section className="section capability-section">
        <div className="capability-heading">
          <div>
            <p className="section-kicker">MARKET / 02</p>
            <h2>{isZh ? "不止汇总接口，而是组织一整个数据市场。" : "More than an API directory: an organized data market."}</h2>
          </div>
          <p>
            {isZh
              ? "RelayBase 把分散的接口供给转化为可理解、可比较、可消费的数据产品，并用统一的接入和结算基础设施，让数据真正进入生产流程。"
              : "RelayBase turns fragmented API supply into understandable, comparable and consumable data products, backed by common integration and settlement infrastructure."}
          </p>
        </div>
        <div className="capability-grid">
          {coreCapabilities.map((capability, index) => (
            <article className="capability-card" key={capability.code}>
              <header>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <code>{capability.code}</code>
              </header>
              <h3>{capability.title[locale]}</h3>
              <p>{capability.body[locale]}</p>
              <Link href={capability.href}>
                {capability.link[locale]}
                <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="section workflow-section">
        <div className="workflow-header">
          <p className="section-kicker">TRANSACTION / 03</p>
          <h2>{isZh ? "从发现数据到投入生产，四步完成。" : "From discovery to production in four steps."}</h2>
        </div>
        <div className="workflow-grid">
          {workflow.map((step) => (
            <article
              className={`workflow-card workflow-${step.accent}`}
              key={step.number}
            >
              <span>{step.number}</span>
              <div>
                <h3>{step.title[locale]}</h3>
                <p>{step.body[locale]}</p>
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
            {isZh ? "数据消费，" : "Data consumption,"}
            <br />
            {isZh ? "按真实请求结算" : "settled per real request"}
          </h2>
          <p className="heading-note">
            {isZh
              ? "不预设套餐，不锁定月费。价格直接附着在数据产品上，余额只用于真实消费，每笔费用都能回到具体请求。只有成功请求最终扣费，失败请求自动退款。"
              : "No preset plans or monthly lock-in. Price belongs to each data product, every charge maps to a request, and failed requests are automatically refunded."}
          </p>
          <Link className="button button-dark" href="/pricing">
            {isZh ? "查看充值与计费" : "View top-up and billing"}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="receipt-card">
          <div className="receipt-header">
            <div>
              <span>{isZh ? "用量样例" : "Usage example"}</span>
              <b>30 DAYS</b>
            </div>
            <span>USD</span>
          </div>
          <div className="receipt-table" role="table" aria-label={isZh ? "计费样例" : "Billing example"}>
            <div className="receipt-row receipt-row-head" role="row">
              <span role="columnheader">{isZh ? "调用项" : "Product"}</span>
              <span role="columnheader">{isZh ? "次数" : "Calls"}</span>
              <span role="columnheader">{isZh ? "单价" : "Unit"}</span>
              <span role="columnheader">{isZh ? "小计" : "Subtotal"}</span>
            </div>
            {billRows.map((row) => (
              <div className="receipt-row" role="row" key={row.item.en}>
                <span role="cell">{row.item[locale]}</span>
                <span role="cell">{row.requests}</span>
                <span role="cell">{row.unit}</span>
                <span role="cell">{row.total}</span>
              </div>
            ))}
          </div>
          <div className="receipt-total">
            <span>{isZh ? "样例总额" : "Example total"}</span>
            <strong>$4.00</strong>
          </div>
          <p>{isZh ? "* 价格仅作说明，实际单价以调用路径和控制台记录为准。" : "* Illustrative only. The request path and console ledger are authoritative."}</p>
        </div>
      </section>

      <section className="section security-section">
        <div className="security-copy">
          <p className="section-kicker">GOVERNANCE / 05</p>
          <h2>{isZh ? "市场有边界，数据使用才有信任。" : "Clear market boundaries create trusted data use."}</h2>
          <p>
            {isZh
              ? "RelayBase 只将完成目录、安全与价格审核的数据能力放进可用市场。平台来源、只读边界、调用状态与结算证据都被明确记录。"
              : "RelayBase lists data capabilities only after catalog, safety and price review. Platform source, read-only boundary, call status and settlement evidence remain explicit."}
          </p>
        </div>
        <div className="security-list">
          <div>
            <span>CURATE</span>
            <p>
              <b>{isZh ? "数据供给经过审核" : "Curated data supply"}</b>
              {isZh ? "未完成目录同步、安全核验和价格复核的产品不会进入可用市场。" : "Products stay out of the callable market until catalog sync, safety review and price verification are complete."}
            </p>
          </div>
          <div>
            <span>BOUNDARY</span>
            <p>
              <b>{isZh ? "只开放数据查询" : "Read-only data access"}</b>
              {isZh ? "不代理写入、发布、互动或删除操作，来源与控制字段不会向客户暴露。" : "RelayBase does not proxy writes, publishing, interaction or deletion, and source control fields stay private."}
            </p>
          </div>
          <div>
            <span>LEDGER</span>
            <p>
              <b>{isZh ? "请求级审计记录" : "Request-level audit trail"}</b>
              {isZh ? "状态码、延迟、数据来源、单价与扣费金额逐条可查。" : "Status, latency, source, unit price and charge are recorded for every request."}
            </p>
          </div>
        </div>
      </section>

      <section className="final-cta">
        <div className="cta-grid" aria-hidden="true" />
        <p>ENTER THE DATA MARKET</p>
          <h2>
          {isZh ? "下一项数据能力，" : "Your next data capability"}
          <br />
          {isZh ? "不必再从零寻找。" : "starts in the market."}
        </h2>
        <div>
          <Link className="button button-lime button-large" href="/catalog">
            {isZh ? "进入数据市场" : "Explore the data market"} <span aria-hidden="true">↗</span>
          </Link>
          <Link className="button button-ghost-light button-large" href="/docs">
            {isZh ? "查看接入文档" : "Read integration docs"}
          </Link>
        </div>
      </section>
    </main>
  );
}
