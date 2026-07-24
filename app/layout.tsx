import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "./components/SiteChrome";
import { getLocale } from "./locale";
import { getRequestOrigin } from "./request-origin";
import "./globals.css";
import "./styles/home.css";
import "./styles/console.css";
import "./styles/docs-pricing.css";

export async function generateMetadata(): Promise<Metadata> {
  const origin = await getRequestOrigin();
  const locale = await getLocale();
  const isZh = locale === "zh";
  const socialImage = `${origin}/og-v3.png`;

  return {
    metadataBase: new URL(origin),
    title: {
      default: isZh
        ? "RelayBase 数据市场｜发现并使用多平台数据产品"
        : "RelayBase Data Market | Multi-platform data products",
      template: isZh ? "%s｜RelayBase 数据市场" : "%s | RelayBase Data Market",
    },
    description: isZh
      ? "面向 AI、产品与研究团队的多平台数据市场。发现、比较并调用经过审核的数据产品。"
      : "A multi-platform data marketplace for AI, product and research teams. Discover, compare and call curated data products.",
    applicationName: isZh ? "RelayBase 数据市场" : "RelayBase Data Market",
    keywords: isZh
      ? ["数据市场", "数据产品", "数据 API", "AI 数据", "多平台数据"]
      : ["data marketplace", "data products", "data API", "AI data", "multi-platform data"],
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
      shortcut: "/favicon.svg",
    },
    openGraph: {
      type: "website",
      locale: isZh ? "zh_CN" : "en_US",
      siteName: isZh ? "RelayBase 数据市场" : "RelayBase Data Market",
      title: isZh
        ? "RelayBase 数据市场｜发现并使用多平台数据产品"
        : "RelayBase Data Market | Multi-platform data products",
      description: isZh
        ? "把分散的平台数据能力，变成可发现、可比较、可计价、可调用的数据产品。"
        : "Turn fragmented platform data into discoverable, comparable, priced and callable data products.",
      images: [
        {
          url: socialImage,
          width: 1200,
          height: 630,
          alt: isZh
            ? "RelayBase：面向 AI 与应用的多平台数据市场"
            : "RelayBase: the multi-platform data marketplace for AI and applications",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: isZh
        ? "RelayBase 数据市场｜发现并使用多平台数据产品"
        : "RelayBase Data Market | Multi-platform data products",
      description: isZh
        ? "面向 AI、产品与研究团队的多平台数据市场。"
        : "A multi-platform data marketplace for AI, product and research teams.",
      images: [socialImage],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const isZh = locale === "zh";

  return (
    <html lang={isZh ? "zh-CN" : "en"}>
      <body>
        <a className="skip-link" href="#main-content">
          {isZh ? "跳到主要内容" : "Skip to main content"}
        </a>
        <SiteHeader locale={locale} />
        {children}
        <SiteFooter locale={locale} />
      </body>
    </html>
  );
}
