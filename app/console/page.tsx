import type { Metadata } from "next";
import { getLocale } from "../locale";
import { ConsoleWorkspacePage } from "./ConsoleWorkspacePage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return locale === "zh"
    ? {
        title: "控制台",
        description:
          "管理 RelayBase 数据市场访问 Key、余额、稳定币充值与数据消费记录。",
      }
    : {
        title: "Console",
        description:
          "Manage RelayBase access Keys, balance, stablecoin top-ups and data-consumption records.",
      };
}

export default async function ConsolePage() {
  return <ConsoleWorkspacePage workspace="dashboard" />;
}
