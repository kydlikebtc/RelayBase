import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "./components/SiteChrome";
import { getRequestOrigin } from "./request-origin";
import "./globals.css";
import "./styles/home.css";
import "./styles/console.css";
import "./styles/docs-pricing.css";

export async function generateMetadata(): Promise<Metadata> {
  const origin = await getRequestOrigin();
  const socialImage = `${origin}/og-v3.png`;

  return {
    metadataBase: new URL(origin),
    title: {
      default: "RelayBase 数据市场｜发现并使用多平台数据产品",
      template: "%s｜RelayBase 数据市场",
    },
    description:
      "面向 AI、产品与研究团队的多平台数据市场。发现、比较并调用经过审核的数据产品。",
    applicationName: "RelayBase 数据市场",
    keywords: ["数据市场", "数据产品", "数据 API", "AI 数据", "多平台数据"],
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
      shortcut: "/favicon.svg",
    },
    openGraph: {
      type: "website",
      locale: "zh_CN",
      siteName: "RelayBase 数据市场",
      title: "RelayBase 数据市场｜发现并使用多平台数据产品",
      description:
        "把分散的平台数据能力，变成可发现、可比较、可计价、可调用的数据产品。",
      images: [
        {
          url: socialImage,
          width: 1200,
          height: 630,
          alt: "RelayBase：面向 AI 与应用的多平台数据市场",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "RelayBase 数据市场｜发现并使用多平台数据产品",
      description: "面向 AI、产品与研究团队的多平台数据市场。",
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
