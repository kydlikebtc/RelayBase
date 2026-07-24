import type { Metadata } from "next";
import Link from "next/link";
import { getLocale } from "../locale";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return locale === "zh"
    ? {
        title: "透明定价",
        description: "无订阅，使用稳定币充值美元余额，只为上游成功请求扣费。",
      }
    : {
        title: "Transparent pricing",
        description:
          "No subscriptions. Top up a USD balance with stablecoins and pay only for successful upstream requests.",
      };
}

const content = {
  en: {
    heroTitle: (
      <>
        No plans.
        <br />
        Pay only for real requests.
      </>
    ),
    heroBody:
      "Top up a USD balance with USDT or USDC and pay per successful API call. No monthly fee and no forced subscription.",
    topupTitle: "Choose a top-up amount",
    topupIntro:
      "Funds appear as a USD balance and are deducted at the actual price of each endpoint.",
    recommended: "RECOMMENDED",
    topups: [
      ["$10", "Validate an idea", "For prototypes, scripts and small tests"],
      ["$25", "Start running", "For reliable small automations"],
      ["$50", "Keep shipping", "For production data workflows"],
      ["$100", "Add headroom", "For multiple jobs or shared team use"],
    ],
    topupButton: "Top up",
    topupFineprint:
      "Network fees are charged by your wallet or payment network and are not added to your RelayBase balance. Always use the asset and network shown on the top-up order.",
    unitTitle: "Price follows capability, not the calendar.",
    unitBody:
      "Cost depends on the platform, capability and upstream result. Every final charge enters the request ledger and can be reconciled by path. Only upstream HTTP 200 responses are charged; non-200 responses are refunded automatically.",
    exampleFrom: "Example from",
    successRequest: "/ successful request",
    tableHeaders: ["Capability", "Path", "Price"],
    examples: [
      ["Example profile query", "GET", "/example/profile/read", "From $0.002"],
      ["Example content detail", "GET", "/example/content/detail", "By capability"],
      ["Search and lists", "GET", "/{platform}/web/search_*", "By capability"],
    ],
    exampleNote:
      "These are product examples. Confirm the current price in the console and endpoint documentation before calling.",
    principlesTitle: "A bill should answer questions.",
    principles: [
      ["Where did the money go?", "Every record includes platform, path, status, latency and charge."],
      ["Are failed calls charged?", "No. Only upstream HTTP 200 responses are charged; non-200 responses are refunded."],
      ["How does balance arrive?", "A server-confirmed, idempotent payment webhook credits the balance. The browser cannot change it."],
    ],
    faqTitle: "What to confirm before topping up.",
    faqs: [
      ["Which assets and networks are supported?", "The current top-up interface supports USDT-TRC20, USDT-ERC20 and USDC-Base. Every order identifies the asset, network, address and amount."],
      ["Do I need a credit card?", "No. Top-ups use stablecoins and the service has no credit-card subscription."],
      ["Where can I see per-request spend?", "Recent requests in the console show path, status, latency and charge. The 30-day summary shows total calls and spend."],
      ["When does the balance update?", "Timing depends on network confirmation. The server updates your balance when the order is confirmed; do not pay a completed order twice."],
    ],
    ctaKicker: "Start with $10. No subscription.",
    ctaTitle: "Keep the budget for useful requests.",
    ctaPrimary: "Top up in console ↗",
    ctaSecondary: "Read API docs",
  },
  zh: {
    heroTitle: (
      <>
        不买套餐。
        <br />
        只为真实请求付费。
      </>
    ),
    heroBody:
      "使用 USDT 或 USDC 充值美元余额，按每次 API 成功调用扣费。没有月费，没有强制订阅。",
    topupTitle: "选择充值金额",
    topupIntro: "到账后以美元余额显示，调用时按接口实际价格扣除。",
    recommended: "推荐",
    topups: [
      ["$10", "验证想法", "适合原型、脚本与小批量测试"],
      ["$25", "开始运行", "适合稳定的小型自动化任务"],
      ["$50", "持续调用", "适合上线后的日常数据工作流"],
      ["$100", "增加余量", "适合多个任务或团队共同使用"],
    ],
    topupButton: "充值",
    topupFineprint:
      "链上网络费由钱包或支付网络收取，不计入 RelayBase 余额。请务必选择充值单指定的网络与币种。",
    unitTitle: "价格跟着能力走，不跟着日历走。",
    unitBody:
      "接口成本由平台、能力与上游执行结果决定。每次实际扣费都进入请求账本，可以按路径逐条核对。只有上游 HTTP 200 的成功请求最终扣费；非 200 自动退款。",
    exampleFrom: "示例起价",
    successRequest: "/ 成功请求",
    tableHeaders: ["能力", "路径", "价格"],
    examples: [
      ["示例资料查询", "GET", "/example/profile/read", "$0.002 起"],
      ["示例内容详情", "GET", "/example/content/detail", "按能力计费"],
      ["搜索与列表", "GET", "/{platform}/web/search_*", "按能力计费"],
    ],
    exampleNote:
      "以上为产品说明示例。正式调用前请以控制台和对应接口说明中的价格为准。",
    principlesTitle: "账单应该能回答问题。",
    principles: [
      ["钱花在哪里？", "每条记录都有平台、路径、状态码、耗时和扣费金额。"],
      ["失败会不会扣？", "不会。只有上游 HTTP 200 成功请求最终扣费，非 200 自动退款。"],
      ["余额如何到账？", "支付 Webhook 经过服务端确认并幂等入账，前端不能自行改余额。"],
    ],
    faqTitle: "充值前，可能还想确认这些。",
    faqs: [
      ["支持哪些币种和网络？", "当前充值界面支持 USDT-TRC20、USDT-ERC20 和 USDC-Base。每张充值单都会明确显示币种、网络、地址和应付数量。"],
      ["是否需要绑定信用卡？", "不需要。充值通过稳定币完成，服务本身没有信用卡订阅。"],
      ["如何查看每次调用花费？", "控制台“最近请求”会显示路径、状态、延迟与扣费。30 天汇总也会同步显示调用量与总支出。"],
      ["充值后多久更新余额？", "取决于所选网络的链上确认速度。充值单确认后，服务端会自动更新余额；不要重复支付已完成的充值单。"],
    ],
    ctaKicker: "从 $10 开始，无需订阅。",
    ctaTitle: "把预算留给有效请求。",
    ctaPrimary: "进入控制台充值 ↗",
    ctaSecondary: "查看 API 文档",
  },
} as const;

export default async function PricingPage() {
  const locale = await getLocale();
  const c = content[locale];

  return (
    <main className="pricing-page" id="main-content">
      <section className="pricing-hero">
        <p className="section-kicker">PRICING / PAY AS YOU GO</p>
        <h1>{c.heroTitle}</h1>
        <p>{c.heroBody}</p>
        <div className="pricing-flags">
          <span>NO SUBSCRIPTION</span>
          <span>REQUEST-LEVEL LEDGER</span>
          <span>STABLECOIN TOP-UP</span>
        </div>
      </section>

      <section className="topup-section" aria-labelledby="topup-title">
        <div className="topup-heading">
          <div>
            <span>01</span>
            <h2 id="topup-title">{c.topupTitle}</h2>
          </div>
          <p>{c.topupIntro}</p>
        </div>
        <div className="topup-grid">
          {c.topups.map(([amount, label, note], index) => (
            <article
              className={`topup-card${index === 2 ? " topup-featured" : ""}`}
              key={amount}
            >
              {index === 2 ? <span className="topup-badge">{c.recommended}</span> : null}
              <span className="topup-label">{label}</span>
              <strong>{amount}</strong>
              <p>{note}</p>
              <ul>
                <li>USDT · TRC20</li>
                <li>USDT · ERC20</li>
                <li>USDC · Base</li>
              </ul>
              <a
                className={`button ${index === 2 ? "button-lime" : "button-dark"}`}
                href="/console"
              >
                {c.topupButton} {amount}
                <span aria-hidden="true">→</span>
              </a>
            </article>
          ))}
        </div>
        <p className="topup-fineprint">{c.topupFineprint}</p>
      </section>

      <section className="unit-pricing">
        <div className="unit-pricing-copy">
          <p className="section-kicker section-kicker-light">UNIT COST / 02</p>
          <h2>{c.unitTitle}</h2>
          <p>{c.unitBody}</p>
          <div className="price-stamp">
            <span>{c.exampleFrom}</span>
            <strong>$0.002</strong>
            <small>{c.successRequest}</small>
          </div>
        </div>
        <div className="price-list">
          <div className="price-list-head">
            {c.tableHeaders.map((header) => <span key={header}>{header}</span>)}
          </div>
          {c.examples.map(([name, method, path, price]) => (
            <div className="price-list-row" key={path}>
              <div><b>{name}</b><span>{method}</span></div>
              <code>{path}</code>
              <strong>{price}</strong>
            </div>
          ))}
          <p>{c.exampleNote}</p>
        </div>
      </section>

      <section className="pricing-principles">
        <div className="principles-heading"><span>03</span><h2>{c.principlesTitle}</h2></div>
        <div className="principles-grid">
          {c.principles.map(([title, body], index) => (
            <article key={title}>
              <span className="principle-symbol">{["→", "×", "↻"][index]}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="pricing-faq">
        <div><p className="section-kicker">FAQ / 04</p><h2>{c.faqTitle}</h2></div>
        <div className="faq-list">
          {c.faqs.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}<span aria-hidden="true">＋</span></summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="pricing-cta">
        <p>{c.ctaKicker}</p>
        <h2>{c.ctaTitle}</h2>
        <div>
          <a className="button button-lime button-large" href="/console">{c.ctaPrimary}</a>
          <Link className="button button-ghost-light button-large" href="/docs">{c.ctaSecondary}</Link>
        </div>
      </section>
    </main>
  );
}
