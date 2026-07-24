import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "./components/SiteChrome";
import { getRequestOrigin } from "./request-origin";
import "./globals.css";
import "./styles/home.css";
import "./styles/console.css";
import "./styles/docs-pricing.css";

export async function generateMetadata(): Promise<Metadata> {
  const origin = await getRequestOrigin();
  const socialImage = `${origin}/og-v2.png`;

  return {
    metadataBase: new URL(origin),
    title: {
      default: "RelayBase API｜一个 API，接入多平台公开数据",
      template: "%s｜RelayBase API",
    },
    description:
      "多平台 API 市场、统一 Bearer Key、安全只读代理、请求级计费与可审计调用记录。",
    applicationName: "RelayBase API",
    keywords: ["数据 API", "开发者 API", "稳定币支付", "多平台数据 API"],
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
      shortcut: "/favicon.svg",
    },
    openGraph: {
      type: "website",
      locale: "zh_CN",
      siteName: "RelayBase API",
      title: "RelayBase API｜一个 API，接入多平台公开数据",
      description:
        "从发现服务到统一鉴权、只读调用和请求级计费，一套完成。",
      images: [
        {
          url: socialImage,
          width: 1200,
          height: 630,
          alt: "RelayBase API：一个 API，接入多平台公开数据",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "RelayBase API｜一个 API，接入多平台公开数据",
      description: "多平台 API 市场、统一鉴权、只读代理和请求级计费。",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
