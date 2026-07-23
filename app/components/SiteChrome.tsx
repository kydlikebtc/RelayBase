import Link from "next/link";
import packageJson from "../../package.json";
import { PlatformStatus } from "./PlatformStatus";

const navigation = [
  { href: "/#platforms", label: "平台覆盖" },
  { href: "/catalog", label: "API 市场" },
  { href: "/pricing", label: "定价" },
  { href: "/docs", label: "文档" },
] as const;

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="brand" href="/" aria-label="RelayBase API 首页">
          <span className="brand-mark" aria-hidden="true">
            R/
          </span>
          <span className="brand-name">RelayBase</span>
          <span className="brand-suffix">API</span>
        </Link>

        <nav className="desktop-nav" aria-label="主导航">
          {navigation.map((item) => (
            <Link href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <PlatformStatus className="system-status" />
          <Link className="button button-dark button-small" href="/console">
            打开控制台
            <span aria-hidden="true">↗</span>
          </Link>
        </div>

        <details className="mobile-menu">
          <summary aria-label="打开导航菜单">
            <span />
            <span />
          </summary>
          <div className="mobile-menu-panel">
            {navigation.map((item) => (
              <Link href={item.href} key={item.href}>
                {item.label}
              </Link>
            ))}
            <Link className="button button-blue" href="/console">
              打开控制台
            </Link>
          </div>
        </details>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-main">
        <div>
          <Link className="brand brand-footer" href="/">
            <span className="brand-mark" aria-hidden="true">
              R/
            </span>
            <span className="brand-name">RelayBase API</span>
          </Link>
          <p>
            给产品和自动化工作流的一条稳定数据出口。
            <br />
            一个 Key，统一调用，按量结算。
          </p>
        </div>
        <div className="footer-links">
          <div>
            <span>产品</span>
            <Link href="/#platforms">平台覆盖</Link>
            <Link href="/catalog">API 市场</Link>
            <Link href="/pricing">定价</Link>
            <Link href="/console">控制台</Link>
          </div>
          <div>
            <span>开发者</span>
            <Link href="/docs">快速开始</Link>
            <Link href="/docs#errors">错误码</Link>
            <Link href="/docs#billing">计费语义</Link>
            <Link href="/admin">运营后台</Link>
          </div>
          <div>
            <span>状态</span>
            <PlatformStatus className="footer-status" />
            <span>支持渠道待配置</span>
          </div>
        </div>
      </div>
      <div className="site-footer-bottom">
        <span>
          © 2026 RelayBase API · v{packageJson.version}
        </span>
        <span>独立服务封装层 · 非上游平台官方产品</span>
      </div>
    </footer>
  );
}
