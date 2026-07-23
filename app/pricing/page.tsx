import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "透明定价",
  description: "无订阅，使用稳定币充值美元余额，只为上游成功请求扣费。",
};

const topups = [
  {
    amount: "$10",
    label: "验证想法",
    note: "适合原型、脚本与小批量测试",
    featured: false,
  },
  {
    amount: "$25",
    label: "开始运行",
    note: "适合稳定的小型自动化任务",
    featured: false,
  },
  {
    amount: "$50",
    label: "持续调用",
    note: "适合上线后的日常数据工作流",
    featured: true,
  },
  {
    amount: "$100",
    label: "增加余量",
    note: "适合多个任务或团队共同使用",
    featured: false,
  },
] as const;

const examples = [
  ["TikTok 用户资料", "GET", "/tiktok/web/fetch_user_profile", "$0.002 起"],
  ["视频详情", "GET", "/tiktok/web/fetch_video_detail", "按能力计费"],
  ["搜索与列表", "GET", "/{platform}/web/search_*", "按能力计费"],
] as const;

export default function PricingPage() {
  return (
    <main className="pricing-page" id="main-content">
      <section className="pricing-hero">
        <p className="section-kicker">PRICING / PAY AS YOU GO</p>
        <h1>
          不买套餐。
          <br />
          只为真实请求付费。
        </h1>
        <p>
          使用 USDT 或 USDC 充值美元余额，按每次 API
          成功调用扣费。没有月费，没有强制订阅。
        </p>
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
            <h2 id="topup-title">选择充值金额</h2>
          </div>
          <p>到账后以美元余额显示，调用时按接口实际价格扣除。</p>
        </div>
        <div className="topup-grid">
          {topups.map((topup) => (
            <article
              className={`topup-card${topup.featured ? " topup-featured" : ""}`}
              key={topup.amount}
            >
              {topup.featured ? <span className="topup-badge">推荐</span> : null}
              <span className="topup-label">{topup.label}</span>
              <strong>{topup.amount}</strong>
              <p>{topup.note}</p>
              <ul>
                <li>USDT · TRC20</li>
                <li>USDT · ERC20</li>
                <li>USDC · Base</li>
              </ul>
              <Link
                className={`button ${topup.featured ? "button-lime" : "button-dark"}`}
                href="/console"
              >
                充值 {topup.amount}
                <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
        <p className="topup-fineprint">
          链上网络费由钱包或支付网络收取，不计入 RelayBase
          余额。请务必选择充值单指定的网络与币种。
        </p>
      </section>

      <section className="unit-pricing">
        <div className="unit-pricing-copy">
          <p className="section-kicker section-kicker-light">UNIT COST / 02</p>
          <h2>价格跟着能力走，不跟着日历走。</h2>
          <p>
            接口成本由平台、能力与上游执行结果决定。每次实际扣费都进入请求账本，可以按路径逐条核对。
            只有上游 HTTP 200 的成功请求最终扣费；非 200 自动退款。
          </p>
          <div className="price-stamp">
            <span>示例起价</span>
            <strong>$0.002</strong>
            <small>/ 成功请求</small>
          </div>
        </div>
        <div className="price-list">
          <div className="price-list-head">
            <span>能力</span>
            <span>路径</span>
            <span>价格</span>
          </div>
          {examples.map(([name, method, path, price]) => (
            <div className="price-list-row" key={path}>
              <div>
                <b>{name}</b>
                <span>{method}</span>
              </div>
              <code>{path}</code>
              <strong>{price}</strong>
            </div>
          ))}
          <p>
            以上为产品说明示例。正式调用前请以控制台和对应接口说明中的价格为准。
          </p>
        </div>
      </section>

      <section className="pricing-principles">
        <div className="principles-heading">
          <span>03</span>
          <h2>账单应该能回答问题。</h2>
        </div>
        <div className="principles-grid">
          <article>
            <span className="principle-symbol">→</span>
            <h3>钱花在哪里？</h3>
            <p>每条记录都有平台、路径、状态码、耗时和扣费金额。</p>
          </article>
          <article>
            <span className="principle-symbol">×</span>
            <h3>失败会不会扣？</h3>
            <p>不会。只有上游 HTTP 200 成功请求最终扣费，非 200 自动退款。</p>
          </article>
          <article>
            <span className="principle-symbol">↻</span>
            <h3>余额如何到账？</h3>
            <p>支付 Webhook 经过服务端确认并幂等入账，前端不能自行改余额。</p>
          </article>
        </div>
      </section>

      <section className="pricing-faq">
        <div>
          <p className="section-kicker">FAQ / 04</p>
          <h2>充值前，可能还想确认这些。</h2>
        </div>
        <div className="faq-list">
          <details>
            <summary>
              支持哪些币种和网络？
              <span aria-hidden="true">＋</span>
            </summary>
            <p>
              当前充值界面支持 USDT-TRC20、USDT-ERC20 和
              USDC-Base。每张充值单都会明确显示币种、网络、地址和应付数量。
            </p>
          </details>
          <details>
            <summary>
              是否需要绑定信用卡？
              <span aria-hidden="true">＋</span>
            </summary>
            <p>不需要。充值通过稳定币完成，服务本身没有信用卡订阅。</p>
          </details>
          <details>
            <summary>
              如何查看每次调用花费？
              <span aria-hidden="true">＋</span>
            </summary>
            <p>
              控制台“最近请求”会显示路径、状态、延迟与扣费。30
              天汇总也会同步显示调用量与总支出。
            </p>
          </details>
          <details>
            <summary>
              充值后多久更新余额？
              <span aria-hidden="true">＋</span>
            </summary>
            <p>
              取决于所选网络的链上确认速度。充值单确认后，服务端会自动更新余额；不要重复支付已完成的充值单。
            </p>
          </details>
        </div>
      </section>

      <section className="pricing-cta">
        <p>从 $10 开始，无需订阅。</p>
        <h2>把预算留给有效请求。</h2>
        <div>
          <Link className="button button-lime button-large" href="/console">
            进入控制台充值 ↗
          </Link>
          <Link className="button button-ghost-light button-large" href="/docs">
            查看 API 文档
          </Link>
        </div>
      </section>
    </main>
  );
}
