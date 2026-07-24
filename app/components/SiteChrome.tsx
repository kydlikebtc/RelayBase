"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import packageJson from "../../package.json";
import type { Locale } from "../locale";
import { PlatformStatus } from "./PlatformStatus";

const copy = {
  en: {
    navigation: [
      { href: "/", label: "Home" },
      { href: "/catalog", label: "Data market" },
      { href: "/pricing", label: "Pricing" },
      { href: "/docs", label: "Docs" },
    ],
    homeLabel: "RelayBase data market home",
    mainNavigation: "Main navigation",
    openConsole: "Open console",
    openMenu: "Open navigation menu",
    mobileNavigation: "Mobile navigation",
    mobileLabels: ["Home", "Market", "Pricing", "Docs", "Account"],
    switchLanguage: "切换到中文",
    switchLabel: "中文",
    footerMarket: "RelayBase Data Market",
    settlement: "Stablecoin settlement",
    console: "Console",
    disclaimer:
      "Independent data marketplace and service layer · Not an official upstream platform product",
  },
  zh: {
    navigation: [
      { href: "/", label: "首页" },
      { href: "/catalog", label: "数据市场" },
      { href: "/pricing", label: "定价" },
      { href: "/docs", label: "文档" },
    ],
    homeLabel: "RelayBase 数据市场首页",
    mainNavigation: "主导航",
    openConsole: "打开控制台",
    openMenu: "打开导航菜单",
    mobileNavigation: "移动端主导航",
    mobileLabels: ["首页", "市场", "定价", "文档", "账户"],
    switchLanguage: "Switch to English",
    switchLabel: "EN",
    footerMarket: "RelayBase 数据市场",
    settlement: "稳定币结算",
    console: "控制台",
    disclaimer: "独立数据市场与服务封装层 · 非上游平台官方产品",
  },
} as const;

function isCurrentPath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SiteHeader({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const content = copy[locale];
  const navigation = content.navigation;

  function switchLocale() {
    const nextLocale = locale === "en" ? "zh" : "en";
    document.cookie = `relaybase_locale=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    startTransition(() => router.refresh());
  }

  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <Link className="brand" href="/" aria-label={content.homeLabel}>
            <span className="brand-mark" aria-hidden="true">
              R/
            </span>
            <span className="brand-name">RelayBase</span>
            <span className="brand-suffix">MARKET</span>
          </Link>

          <nav className="desktop-nav" aria-label={content.mainNavigation}>
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
            <PlatformStatus className="system-status" locale={locale} />
            <button
              className="language-switch"
              type="button"
              onClick={switchLocale}
              disabled={isPending}
              aria-label={content.switchLanguage}
            >
              {content.switchLabel}
            </button>
            <Link className="button button-blue button-small" href="/console">
              {content.openConsole}
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          <details className="mobile-menu">
            <summary aria-label={content.openMenu}>
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
              <button
                className="language-switch"
                type="button"
                onClick={switchLocale}
                disabled={isPending}
              >
                {content.switchLabel}
              </button>
              <Link className="button button-blue" href="/console">
                {content.openConsole}
              </Link>
            </div>
          </details>
        </div>
      </header>
      <nav className="mobile-tabbar" aria-label={content.mobileNavigation}>
        <Link aria-current={pathname === "/" ? "page" : undefined} href="/">
          {content.mobileLabels[0]}
        </Link>
        <Link
          aria-current={pathname.startsWith("/catalog") ? "page" : undefined}
          href="/catalog"
        >
          {content.mobileLabels[1]}
        </Link>
        <Link
          aria-current={pathname.startsWith("/pricing") ? "page" : undefined}
          href="/pricing"
        >
          {content.mobileLabels[2]}
        </Link>
        <Link
          aria-current={pathname.startsWith("/docs") ? "page" : undefined}
          href="/docs"
        >
          {content.mobileLabels[3]}
        </Link>
        <Link
          aria-current={
            pathname.startsWith("/console") || pathname.startsWith("/login")
              ? "page"
              : undefined
          }
          href="/console"
        >
          {content.mobileLabels[4]}
        </Link>
      </nav>
    </>
  );
}

export function SiteFooter({ locale }: { locale: Locale }) {
  const content = copy[locale];
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <span>{content.footerMarket}</span>
        <span className="footer-separator">·</span>
        <PlatformStatus className="footer-status" locale={locale} />
        <span className="footer-separator">·</span>
        <span>{content.settlement}</span>
        <span className="footer-separator">·</span>
        <Link href="/catalog">{content.navigation[1].label}</Link>
        <span className="footer-separator">·</span>
        <Link href="/pricing">{content.navigation[2].label}</Link>
        <span className="footer-separator">·</span>
        <Link href="/docs">{content.navigation[3].label}</Link>
        <span className="footer-separator">·</span>
        <Link href="/console">{content.console}</Link>
        <span className="site-footer-meta">
          © 2026 · v{packageJson.version} · {content.disclaimer}
        </span>
      </div>
    </footer>
  );
}
