import type { Metadata } from "next";
import { getLocale } from "../../locale";
import { ConsoleWorkspacePage } from "../ConsoleWorkspacePage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return locale === "zh"
    ? {
        title: "x402 批次",
        description:
          "查询 RelayBase x402 钱包批次、Base USDC 结算回执与执行状态。",
      }
    : {
        title: "x402 batches",
        description:
          "Look up RelayBase x402 wallet batches, Base USDC settlement receipts and execution status.",
      };
}

export default function ConsoleX402Page() {
  return <ConsoleWorkspacePage workspace="x402" />;
}
