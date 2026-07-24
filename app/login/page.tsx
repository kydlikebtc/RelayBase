import type { Metadata } from "next";
import { chatGPTSignInPath } from "../chatgpt-auth";
import { getLocale } from "../locale";
import { LoginClient } from "./LoginClient";
import "../styles/login.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: locale === "zh" ? "登录" : "Sign in",
    description:
      locale === "zh"
        ? "使用 Google、EVM 钱包或托管身份登录 RelayBase。"
        : "Sign in to RelayBase with Google, an EVM wallet or a managed identity.",
    robots: {
      index: false,
      follow: false,
    },
  };
}

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = await searchParams;
  const rawReturnTo =
    typeof query.return_to === "string" ? query.return_to : "/console";
  const returnTo = safeReturnPath(rawReturnTo);
  const initialErrorCode =
    typeof query.error === "string" ? query.error.slice(0, 100) : null;
  const locale = await getLocale();

  return (
    <LoginClient
      key={locale}
      returnTo={returnTo}
      chatGPTSignInPath={chatGPTSignInPath(returnTo)}
      initialErrorCode={initialErrorCode}
      locale={locale}
    />
  );
}

function safeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/console";
  try {
    const url = new URL(value, "https://relaybase.local");
    if (
      url.origin !== "https://relaybase.local" ||
      url.pathname === "/login" ||
      url.pathname === "/signin-with-chatgpt" ||
      url.pathname === "/signout-with-chatgpt" ||
      url.pathname === "/callback" ||
      url.pathname.startsWith("/api/auth/")
    ) {
      return "/console";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/console";
  }
}
