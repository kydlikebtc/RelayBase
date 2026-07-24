"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import packageJson from "../../package.json";
import { PlatformStatus } from "./PlatformStatus";

const navigation = [
  { href: "/", label: "首页" },
  { href: "/catalog", label: "API 市场" },
  { href: "/pricing", label: "定价" },
  { href: "/docs", label: "文档" },
] as const;

function isCurrentPath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <>
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
              <Link
                aria-current={
                  isCurrentPath(pathname, item.href) ? "page" : undefined
                }
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="header-actions">
            <PlatformStatus className="system-status" />
            <Link className="button button-blue button-small" href="/console">
              打开控制台
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          <details className="mobile-menu">
            <summary aria-label="打开导航菜单">
              <span />
              <span />
            </summary>
            <div className="mobile-menu-panel">
              {navigation.map((item) => (
                <Link
                  aria-current={
                    isCurrentPath(pathname, item.href) ? "page" : undefined
                  }
                  href={item.href}
                  key={item.href}
                >
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
      <nav className="mobile-tabbar" aria-label="移动端主导航">
        <Link aria-current={pathname === "/" ? "page" : undefined} href="/">
          首页
        </Link>
        <Link
          aria-current={pathname.startsWith("/catalog") ? "page" : undefined}
          href="/catalog"
        >
          API
        </Link>
        <Link
          aria-current={pathname.startsWith("/pricing") ? "page" : undefined}
          href="/pricing"
        >
          定价
        </Link>
        <Link
          aria-current={pathname.startsWith("/docs") ? "page" : undefined}
          href="/docs"
        >
          文档
        </Link>
        <Link
          aria-current={
            pathname.startsWith("/console") || pathname.startsWith("/login")
              ? "page"
              : undefined
          }
          href="/console"
        >
          账户
        </Link>
      </nav>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <span>RelayBase API</span>
        <span className="footer-separator">·</span>
        <PlatformStatus className="footer-status" />
        <span className="footer-separator">·</span>
        <span>稳定币结算</span>
        <span className="footer-separator">·</span>
        <Link href="/catalog">API 市场</Link>
        <span className="footer-separator">·</span>
        <Link href="/pricing">定价</Link>
        <span className="footer-separator">·</span>
        <Link href="/docs">文档</Link>
        <span className="footer-separator">·</span>
        <Link href="/console">控制台</Link>
        <span className="site-footer-meta">
          © 2026 · v{packageJson.version} · 独立服务封装层 ·
          非上游平台官方产品
        </span>
      </div>
    </footer>
  );
}
