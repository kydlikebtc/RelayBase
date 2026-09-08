import type { Metadata } from "next";
import Link from "next/link";
import { HeroFlow } from "./components/HeroFlow";
import { PlatformIcon } from "./components/PlatformIcon";
import { getLocale } from "./locale";

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

const heroStats = [
  { value: "25+", label: "PLATFORMS", signal: false },
  { value: "1", label: "PROTOCOL / KEY", signal: false },
  { value: "0", label: "FAILED-CALL CHARGE", signal: true },
] as const;

// Mirrors the three zones the hero canvas animates: scattered supply drifts in,
// a review gate accepts or deflects it, accepted supply seats into the lattice.
const pipelineZones = [
  {
    code: "01",
    label: { en: "Scattered supply", zh: "分散供给" },
    tone: "idle",
  },
  { code: "02", label: { en: "Review gate", zh: "审核闸门" }, tone: "signal" },
  { code: "03", label: { en: "Ordered catalog", zh: "有序目录" }, tone: "ink" },
] as const;

const settlementReceipt = [
  {
    k: { en: "Wallet settlements", zh: "钱包结算" },
    v: { en: "1", zh: "1 次" },
    signal: false,
  },
  {
    k: { en: "Data targets", zh: "数据目标" },
    v: { en: "2,400", zh: "2,400" },
    signal: false,
  },
  {
    k: { en: "Upstream requests", zh: "上游请求" },
    v: { en: "120", zh: "120" },
    signal: false,
  },
  {
    k: { en: "Execution time", zh: "执行耗时" },
    v: { en: "38.2 s", zh: "38.2 s" },
    signal: false,
  },
  {
    k: { en: "Settled total", zh: "结算总额" },
    v: { en: "$4.80", zh: "$4.80" },
    signal: true,
  },
] as const;

const platforms = [
  {
    name: "TikTok",
    value: "tiktok",
    detail: { en: "Users · videos · search", zh: "用户 · 视频 · 搜索" },
    group: { en: "SHORT VIDEO", zh: "短视频" },
  },
  {
    name: "Douyin",
    value: "douyin",
    detail: { en: "Posts · comments · trends", zh: "作品 · 评论 · 热榜" },
    group: { en: "SHORT VIDEO", zh: "短视频" },
  },
  {
    name: "Xiaohongshu",
    value: "xiaohongshu",
    detail: { en: "Notes · creators · comments", zh: "笔记 · 作者 · 评论" },
    group: { en: "CONTENT COMMUNITY", zh: "内容社区" },
  },
  {
    name: "Instagram",
    value: "instagram",
    detail: { en: "Profiles · posts · Reels", zh: "主页 · 帖子 · Reels" },
    group: { en: "SOCIAL MEDIA", zh: "社交媒体" },
  },
  {
    name: "YouTube",
    value: "youtube",
    detail: { en: "Channels · videos · captions", zh: "频道 · 视频 · 字幕" },
    group: { en: "VIDEO CONTENT", zh: "视频内容" },
  },
  {
    name: "X / Twitter",
    value: "twitter",
    detail: { en: "Users · posts · trends", zh: "用户 · 推文 · 趋势" },
    group: { en: "SOCIAL MEDIA", zh: "社交媒体" },
  },
  {
    name: "Reddit",
    value: "reddit",
    detail: { en: "Communities · posts · comments", zh: "社区 · 帖子 · 评论" },
    group: { en: "CONTENT COMMUNITY", zh: "内容社区" },
  },
  {
    name: "Bilibili",
    value: "bilibili",
    detail: { en: "Videos · creators · comments", zh: "视频 · 创作者 · 评论" },
    group: { en: "VIDEO CONTENT", zh: "视频内容" },
  },
  {
    name: "Weibo",
    value: "weibo",
    detail: { en: "Users · posts · trends", zh: "用户 · 帖子 · 热点" },
    group: { en: "SOCIAL MEDIA", zh: "社交媒体" },
  },
  {
    name: "Kuaishou",
    value: "kuaishou",
    detail: { en: "Creators · videos · live", zh: "创作者 · 视频 · 直播" },
    group: { en: "SHORT VIDEO", zh: "短视频" },
  },
  {
    name: "WeChat",
    value: "wechat_mp",
    detail: { en: "Accounts · articles · search", zh: "公众号 · 文章 · 搜索" },
    group: { en: "CONTENT ECOSYSTEM", zh: "内容生态" },
  },
  {
    name: "Threads",
    value: "threads",
    detail: { en: "Profiles · posts · replies", zh: "主页 · 帖子 · 回复" },
    group: { en: "SOCIAL MEDIA", zh: "社交媒体" },
  },
] as const;

const audiences = [
  {
    index: "01",
    code: "AGENT",
    title: { en: "AI agents and automation", zh: "AI Agent 与自动化" },
    body: {
      en: "Hand a whole batch of data targets to one wallet settlement. The quote freezes target count and execution shape, and nothing switches silently after payment.",
      zh: "把一整批数据目标交给一次钱包结算。报价冻结数量与执行方式，付款后不会静默切换。",
    },
    points: {
      en: [
        "Caller-held wallet; RelayBase never custodies private keys",
        "Verified native batch endpoints shard against their own limits",
        "Batch receipts keep the Base transaction hash and execution result",
      ],
      zh: [
        "调用方自持钱包，RelayBase 不托管私钥",
        "已验证原生批量接口按上限分片执行",
        "批次回执保存 Base 交易哈希与执行结果",
      ],
    },
    entry: "POST /v1/x402/batch",
  },
  {
    index: "02",
    code: "PRODUCT",
    title: { en: "Product and growth teams", zh: "产品与增长团队" },
    body: {
      en: "Skip integrating upstream platforms one by one. One Key fetches data, charged per call, refunded automatically on failure.",
      zh: "不用逐个对接上游平台。一个 Key 直接取数，按次计费，失败自动退款。",
    },
    points: {
      en: [
        "Prepaid balance with per-request idempotency and a max-price guard",
        "Credentials, rate limits, retries and refunds handled server-side",
        "Console lists status, latency, unit price and charge per request",
      ],
      zh: [
        "预充值余额，请求级幂等与最高报价保护",
        "凭据、限流、重试和退款由服务端处理",
        "控制台逐条查看状态码、延迟、单价与扣费",
      ],
    },
    entry: "GET /v1/{platform}/…",
  },
  {
    index: "03",
    code: "RESEARCH",
    title: { en: "Research and data analysis", zh: "研究与数据分析" },
    body: {
      en: "Compare coverage before committing. The catalog publishes each product's invocation model, pagination unit, target ceiling and typical response size.",
      zh: "先比覆盖面再动手。目录公开每个产品的调用方式、分页单位、目标上限与典型返回规模。",
    },
    points: {
      en: [
        "Compare supply across platforms and data categories side by side",
        "Pagination and cursor fields, and per-page ceilings, are public",
        "Uncountable supply is marked pending, never faked as zero",
      ],
      zh: [
        "按平台与数据分类横向比对供给",
        "分页与游标字段、单页上限公开可查",
        "无法可靠计数时标为待确认，不伪造为 0",
      ],
    },
    entry: "GET /api/marketplace",
  },
] as const;

const paths = [
  {
    kicker: "PATH B · AGENT BATCH",
    badge: "AGENT NATIVE",
    accent: "signal",
    title: { en: "x402 wallet settlement", zh: "x402 钱包结算" },
    body: {
      en: "The caller's wallet produces a PAYMENT-SIGNATURE and one batch settles once. An API Key is neither needed nor accepted as proof of payment.",
      zh: "调用方钱包生成 PAYMENT-SIGNATURE，一个批次一次结算。不需要也不接受 API Key 作为付款凭据。",
    },
    rows: [
      {
        k: "CREDENTIAL",
        v: {
          en: "PAYMENT-SIGNATURE · caller-held wallet",
          zh: "PAYMENT-SIGNATURE · 调用方自持钱包",
        },
      },
      {
        k: "SETTLE",
        v: {
          en: "x402 v2 exact · native USDC on Base mainnet",
          zh: "x402 v2 exact · Base 主网原生 USDC",
        },
      },
      {
        k: "EXECUTE",
        v: {
          en: "Pay first, then execute; synchronous batch, one settlement",
          zh: "先支付后执行，同步批量，一批一次结算",
        },
      },
      {
        k: "QUOTE",
        v: {
          en: "Freezes count, execution shape and capability revision",
          zh: "冻结数量、执行方式与能力 revision",
        },
      },
      {
        k: "LEDGER",
        v: {
          en: "Separate settlement ledger with Base transaction and receipts",
          zh: "独立结算账本，保存 Base 交易与执行回执",
        },
      },
    ],
  },
  {
    kicker: "PATH A · STANDARD",
    badge: "LIVE",
    accent: "neutral",
    title: { en: "API Key + prepaid balance", zh: "API Key + 预充值余额" },
    body: {
      en: "Standard /v1 requests carry a Bearer Key and draw on the signed-in account's prepaid balance. Suited to sustained, predictable production traffic.",
      zh: "标准 /v1 请求携带 Bearer Key，从登录账户的预充值余额扣费。适合持续、可预测的生产流量。",
    },
    rows: [
      {
        k: "CREDENTIAL",
        v: {
          en: "Authorization: Bearer rb_live_…",
          zh: "Authorization: Bearer rb_live_…",
        },
      },
      {
        k: "BILLING",
        v: {
          en: "Charged on success, auto-refunded on failure; idempotency key required",
          zh: "成功扣费，失败自动退款；幂等键必填",
        },
      },
      {
        k: "RATE LIMIT",
        v: {
          en: "Key and account tiers, with standard 429 retry headers",
          zh: "API Key 与账户双层，标准 429 重试响应头",
        },
      },
      {
        k: "TOP-UP",
        v: {
          en: "$10 / $25 / $50 / $100 stablecoin prepaid orders",
          zh: "$10 / $25 / $50 / $100 稳定币预付订单",
        },
      },
      {
        k: "LEDGER",
        v: {
          en: "Account usage ledger; balance is snapshot plus delta",
          zh: "账户用量账本，余额由快照加增量核算",
        },
      },
    ],
  },
] as const;

const governance = [
  {
    code: "CURATE",
    title: { en: "Curated data supply", zh: "数据供给经过审核" },
    body: {
      en: "Products stay out of the callable market until catalog sync, safety review and manual price review are complete. Only fully defined entries list.",
      zh: "未完成目录同步、安全核验和人工核价的产品不会进入可调用市场。只有完整定义条目才能上架。",
    },
  },
  {
    code: "BOUNDARY",
    title: { en: "Read-only data access", zh: "只开放数据查询" },
    body: {
      en: "RelayBase does not proxy writes, publishing, interaction or deletion. Upstream addresses, credentials and control-plane routes stay private.",
      zh: "不代理写入、发布、互动或删除操作。上游来源地址、凭据与控制面路由不会向客户暴露。",
    },
  },
  {
    code: "LEDGER",
    title: { en: "Request-level audit trail", zh: "请求级审计记录" },
    body: {
      en: "Status, latency, logical target count, unit price and charge are queryable per request, and the request id comes back in a response header.",
      zh: "状态码、延迟、逻辑目标数、单价与扣费金额逐条可查，请求编号通过响应头返回。",
    },
  },
  {
    code: "FAIL CLOSED",
    title: { en: "No evidence, no service", zh: "缺证据就关闭" },
    body: {
      en: "If critical config, catalog evidence or the reconciliation heartbeat is missing, live proxying and stablecoin top-ups close automatically.",
      zh: "关键配置、目录证据或对账心跳任一缺失，真实代理与稳定币充值自动安全关闭。",
    },
  },
] as const;

export default async function Home() {
  const locale = await getLocale();
  const isZh = locale === "zh";

  return (
    <main className="home" id="main-content">
      <HeroFlow />

      <section className="hero">
        <div className="hero-copy">
          <p className="page-kicker">
            <span>MULTI-PLATFORM DATA MARKET</span>
            <i aria-hidden="true" />
            <span>V0.4.0</span>
          </p>
          <h1>
            {isZh ? (
              <>
                一个 Key，
                <br />
                打通 <mark>25 个平台</mark>
                <br />
                的公开数据
              </>
            ) : (
              <>
                One Key,
                <br />
                <mark>25 platforms</mark>
                <br />
                of public data
              </>
            )}
          </h1>
          <p className="hero-lede">
            {isZh
              ? "RelayBase 把分散在各平台的公开数据能力，整理成可搜索、可比较、可计价、可调用的数据产品。你不用逐个对接上游、维护凭据、处理限流和退款。"
              : "RelayBase organizes public data capabilities scattered across platforms into searchable, comparable, priced and callable data products. No integrating upstreams one by one, no credential upkeep, no rate-limit or refund handling."}
          </p>
          <p className="hero-sub">
            {isZh
              ? "Agent 批量任务可以由调用方钱包通过 x402 在 Base 上用 USDC 一批结算一次；标准生产流量继续走 API Key 与预充值余额。"
              : "Agent batches can settle once in Base USDC through x402 from a caller-held wallet. Standard production traffic keeps using an API Key and prepaid balance."}
          </p>
          <div className="hero-actions">
            <Link className="button button-blue button-large" href="/catalog">
              {isZh ? "进入数据市场" : "Explore the data market"}
              <span aria-hidden="true">→</span>
            </Link>
            <a className="button button-large" href="/login">
              {isZh ? "开始使用数据" : "Start using data"}
            </a>
          </div>
          <dl className="hero-stats">
            {heroStats.map((stat) => (
              <div key={stat.label}>
                <dd className={stat.signal ? "is-signal" : undefined}>
                  {stat.value}
                </dd>
                <dt>{stat.label}</dt>
              </div>
            ))}
          </dl>
        </div>

        <ul aria-hidden="true" className="hero-pipeline">
          <li className="hero-pipeline-title">SUPPLY PIPELINE</li>
          {pipelineZones.map((zone) => (
            <li className={`is-${zone.tone}`} key={zone.code}>
              <span className="hero-pipeline-label">{zone.label[locale]}</span>
              <span className="hero-pipeline-code">{zone.code}</span>
              <i />
              <span className="hero-pipeline-dot" />
            </li>
          ))}
        </ul>

        <aside
          aria-label={
            isZh ? "x402 批次结算回执" : "x402 batch settlement receipt"
          }
          className="hero-panel ticks"
        >
          <header>
            <span className="hero-panel-kicker">SETTLEMENT CORE</span>
            <span className="hero-panel-status">
              <span className="status-dot" aria-hidden="true" />
              SETTLED
            </span>
          </header>
          <div className="hero-panel-body">
            <div className="hero-panel-id">
              <span className="hero-panel-glyph" aria-hidden="true">
                ◇
              </span>
              <div>
                <b>{isZh ? "x402 批次回执" : "x402 batch receipt"}</b>
                <code>RB_BATCH_01JQ8F2K7M4XZ</code>
              </div>
            </div>
            <dl className="hero-panel-rows">
              {settlementReceipt.map((row) => (
                <div key={row.k.en}>
                  <dt>{row.k[locale]}</dt>
                  <dd className={row.signal ? "is-signal" : undefined}>
                    {row.v[locale]}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="hero-panel-note">
              {isZh
                ? "一次钱包结算跑完一整批。报价冻结数量与执行方式，付款后不会静默切换；Base 交易哈希与执行结果都写进回执。"
                : "One wallet settlement covers the whole batch. The quote freezes count and execution shape, nothing switches silently after payment, and the Base transaction hash and execution result are both written into the receipt."}
            </p>
          </div>
          <footer>
            <Link href="/pricing">
              {isZh ? "了解结算方式" : "How settlement works"}
              <span aria-hidden="true">→</span>
            </Link>
          </footer>
        </aside>
      </section>

      <section className="section supply-section" id="supply">
        <div className="section-head">
          <div>
            <p className="section-kicker">SUPPLY / 01</p>
            <h2>
              {isZh ? (
                <>
                  一个市场，
                  <br />
                  连接分散的数据供给
                </>
              ) : (
                <>
                  One market,
                  <br />
                  connecting scattered supply
                </>
              )}
            </h2>
          </div>
          <div>
            <p>
              {isZh
                ? "首页那条流水就是这件事：左边是各平台未经整理的原始供给，中间是审核闸门，右边是排成阵列的可调用目录。未完成核验的供给会在闸门处被打回，不会进入右侧阵列。"
                : "The flow behind the hero is exactly this: raw, unsorted platform supply on the left, a review gate in the middle, and the callable catalog seated in a lattice on the right. Supply that fails verification is deflected at the gate and never reaches the lattice."}
            </p>
            <Link className="text-link" href="/catalog">
              {isZh ? "查看完整数据市场" : "See the full data market"}
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>
        <ul className="supply-legend">
          <li className="is-idle">{isZh ? "未整理供给" : "Unsorted supply"}</li>
          <li className="is-signal">
            {isZh ? "通过审核 · 入目录" : "Reviewed · catalogued"}
          </li>
          <li className="is-pending">
            {isZh ? "闸门打回" : "Deflected at gate"}
          </li>
          <li className="is-ink">
            {isZh ? "已上架 · 可调用" : "Listed · callable"}
          </li>
        </ul>
        <div className="platform-grid">
          {platforms.map((platform) => (
            <article className="platform-card" key={platform.name}>
              <div className="platform-card-top">
                <PlatformIcon
                  className="platform-logo"
                  platform={platform.value}
                />
              </div>
              <div>
                <h3>{platform.name}</h3>
                <p>{platform.detail[locale]}</p>
                <div className="platform-card-foot">
                  <span className="platform-group">
                    {platform.group[locale]}
                  </span>
                  <span aria-hidden="true">↗</span>
                </div>
              </div>
            </article>
          ))}
          <Link className="platform-card platform-card-more" href="/catalog">
            <div className="platform-card-top">
              <PlatformIcon className="platform-logo" platform="all" />
            </div>
            <div>
              <h3>{isZh ? "更多平台" : "More platforms"}</h3>
              <p>
                {isZh
                  ? "在数据市场查看全部平台与当前可用产品"
                  : "See every platform and currently available product"}
              </p>
              <div className="platform-card-foot">
                <span className="platform-group">
                  {isZh ? "完整目录" : "FULL CATALOG"}
                </span>
                <span aria-hidden="true">↗</span>
              </div>
            </div>
          </Link>
        </div>
      </section>

      <section className="section access-section">
        <div className="section-head is-stacked">
          <p className="section-kicker">ACCESS / 02</p>
          <h2>
            {isZh
              ? "三种团队，三条已经铺好的路"
              : "Three kinds of team, three paths already paved"}
          </h2>
          <p>
            {isZh
              ? "同一个目录、同一套价格，入口按你的工作方式不同。选好入口就能开始，不需要先读完全部文档。"
              : "One catalog and one price list; the entry point follows how you work. Pick an entry and start — reading every page of the docs first is optional."}
          </p>
        </div>
        <div className="access-grid">
          {audiences.map((audience) => (
            <article className="access-card" key={audience.code}>
              <header>
                <span className="access-index">{audience.index}</span>
                <span className="access-code">{audience.code}</span>
              </header>
              <h3>{audience.title[locale]}</h3>
              <p>{audience.body[locale]}</p>
              <ul>
                {audience.points[locale].map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <div className="access-entry">
                <span>ENTRY</span>
                <code>{audience.entry}</code>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section settle-section" id="settle">
        <div className="section-head is-stacked">
          <p className="section-kicker">SETTLEMENT / 03</p>
          <h2>
            {isZh
              ? "两条明确的付费路径，不会互相顶替"
              : "Two explicit payment paths that never displace each other"}
          </h2>
          <p>
            {isZh
              ? "标准 /v1 请求走 API Key 与预充值余额；Agent 批量任务走调用方自持钱包，在 Base 上用 USDC 一批结算一次。两者账本独立，不会隐式切换。"
              : "Standard /v1 requests use an API Key and prepaid balance. Agent batches use a caller-held wallet and settle once in Base USDC. The two keep separate ledgers and never switch implicitly."}
          </p>
        </div>
        <div className="path-grid">
          {paths.map((path) => (
            <article
              className={`path-card is-${path.accent}`}
              key={path.kicker}
            >
              <header>
                <span className="path-kicker">{path.kicker}</span>
                <span className="path-badge">{path.badge}</span>
              </header>
              <div className="path-body">
                <h3>{path.title[locale]}</h3>
                <p>{path.body[locale]}</p>
                <dl>
                  {path.rows.map((row) => (
                    <div key={row.k}>
                      <dt>{row.k}</dt>
                      <dd>{row.v[locale]}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </article>
          ))}
        </div>
        <p className="path-note">
          <span className="path-note-tag">USD MICROS</span>
          <span>
            {isZh
              ? "客户价按 USD micros 记账，1 USD = 1,000,000。只有完整、合法的上游 200 JSON 响应才扣费；网络失败、非成功状态、超限或畸形响应自动退款。"
              : "Customer prices are booked in USD micros, where 1 USD = 1,000,000. Only a complete, valid upstream 200 JSON response is charged; network failures, non-success statuses, over-limit and malformed responses are refunded automatically."}
          </span>
        </p>
      </section>

      <section className="section governance-section">
        <div>
          <p className="section-kicker">GOVERNANCE / 04</p>
          <h2>
            {isZh ? (
              <>
                市场有边界，
                <br />
                数据使用才有信任
              </>
            ) : (
              <>
                A market with boundaries
                <br />
                is a market you can trust
              </>
            )}
          </h2>
          <p>
            {isZh
              ? "只有完成目录、安全与价格审核的数据能力会进入可用市场。平台来源、只读边界、调用状态和结算证据都被明确记录。"
              : "Only capabilities that clear catalog, safety and price review enter the callable market. Platform source, the read-only boundary, call status and settlement evidence are all recorded explicitly."}
          </p>
        </div>
        <dl className="governance-list">
          {governance.map((item) => (
            <div key={item.code}>
              <dt>{item.code}</dt>
              <dd>
                <b>{item.title[locale]}</b>
                <p>{item.body[locale]}</p>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="final-cta">
        <p className="final-cta-kicker">ENTER THE DATA MARKET</p>
        <h2>
          {isZh ? (
            <>
              下一项数据能力，
              <br />
              不必再从零寻找。
            </>
          ) : (
            <>
              Your next data capability
              <br />
              does not start from zero.
            </>
          )}
        </h2>
        <div>
          <Link className="button button-lime button-large" href="/catalog">
            {isZh ? "进入数据市场" : "Explore the data market"}
            <span aria-hidden="true">↗</span>
          </Link>
          <Link className="button button-large" href="/docs">
            {isZh ? "查看接入文档" : "Read integration docs"}
          </Link>
        </div>
      </section>
    </main>
  );
}
