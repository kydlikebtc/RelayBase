import type { Metadata } from "next";
import { getLocale } from "../../locale";
import { ConsoleWorkspacePage } from "../ConsoleWorkspacePage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return locale === "zh"
    ? {
        title: "充值与账单",
        description: "充值 RelayBase 账户并查看付款状态和余额活动。",
      }
    : {
        title: "Top-up & billing",
        description:
          "Fund a RelayBase account and review payment status and balance activity.",
      };
}

export default function ConsoleBillingPage() {
  return <ConsoleWorkspacePage workspace="billing" />;
}
