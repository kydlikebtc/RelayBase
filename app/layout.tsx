import type { Metadata } from "next";
import { headers } from "next/headers";
import { SiteFooter, SiteHeader } from "./components/SiteChrome";
import "./globals.css";
import "./styles/home.css";
import "./styles/console.css";
import "./styles/docs-pricing.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const directHost = requestHeaders.get("host")?.trim();
  const candidateHost = forwardedHost || directHost || "relaybase.invalid";
  const safeHost = /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(candidateHost)
    ? candidateHost
    : "relaybase.invalid";
  const forwardedProto = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol =
    forwardedProto === "http" || safeHost.startsWith("localhost")
      ? "http"
      : "https";
  const origin = `${protocol}://${safeHost}`;
  const socialImage = `${origin}/og.png`;

  return {
    metadataBase: new URL(origin),
    title: {
      default: "RelayBase API｜一条稳定的数据接口",
      template: "%s｜RelayBase API",
    },
    description:
      "统一调用分散的平台数据接口，使用稳定币充值，只为上游成功请求扣费。",
    applicationName: "RelayBase API",
    keywords: ["数据 API", "开发者 API", "稳定币支付", "TikTok API"],
    openGraph: {
      type: "website",
      locale: "zh_CN",
      siteName: "RelayBase API",
      title: "RelayBase API｜一条稳定的数据接口",
      description:
        "一个 Key 接入多平台数据，稳定币充值，只为上游成功请求扣费。",
      images: [
        {
          url: socialImage,
          width: 1200,
          height: 630,
          alt: "RelayBase API：把分散的数据接口，收进一条稳定 API",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "RelayBase API",
      description: "把分散的数据接口，收进一条稳定 API。",
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
