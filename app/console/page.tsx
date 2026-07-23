import type { Metadata } from "next";
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "../chatgpt-auth";
import { ConsoleClient } from "./ConsoleClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "控制台",
  description: "管理 RelayBase API 密钥、余额、稳定币充值与请求记录。",
};

export default async function ConsolePage() {
  const user = await getChatGPTUser();

  return (
    <main className="console-page" id="main-content">
      <ConsoleClient
        user={user}
        signInPath={chatGPTSignInPath("/console")}
        signOutPath={chatGPTSignOutPath("/")}
      />
    </main>
  );
}
