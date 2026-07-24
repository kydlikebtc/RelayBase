import type { Metadata } from "next";
import {
  chatGPTSignOutPath,
  getChatGPTUser,
} from "../chatgpt-auth";
import { ConsoleClient } from "./ConsoleClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "控制台",
  description: "管理 RelayBase 数据市场访问 Key、余额、稳定币充值与数据消费记录。",
};

export default async function ConsolePage() {
  const user = await getChatGPTUser();

  return (
    <main className="console-page" id="main-content">
      <ConsoleClient
        chatGPTUser={user}
        chatGPTSignOutPath={chatGPTSignOutPath("/")}
      />
    </main>
  );
}
