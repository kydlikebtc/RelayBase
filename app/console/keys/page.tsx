import type { Metadata } from "next";
import { getLocale } from "../../locale";
import { ConsoleWorkspacePage } from "../ConsoleWorkspacePage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return locale === "zh"
    ? {
        title: "API Key",
        description: "创建、检查和撤销 RelayBase 服务端 API 访问凭据。",
      }
    : {
        title: "API Keys",
        description:
          "Create, review and revoke RelayBase server-side API credentials.",
      };
}

export default function ConsoleKeysPage() {
  return <ConsoleWorkspacePage workspace="keys" />;
}
