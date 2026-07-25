import {
  chatGPTSignOutPath,
  getChatGPTUser,
} from "../chatgpt-auth";
import { getLocale } from "../locale";
import {
  ConsoleClient,
  type ConsoleWorkspace,
} from "./ConsoleClient";

export async function ConsoleWorkspacePage({
  workspace,
}: {
  workspace: ConsoleWorkspace;
}) {
  const user = await getChatGPTUser();
  const locale = await getLocale();

  return (
    <main className="console-page" id="main-content">
      <ConsoleClient
        key={`${locale}-${workspace}`}
        chatGPTUser={user}
        chatGPTSignOutPath={chatGPTSignOutPath("/")}
        locale={locale}
        workspace={workspace}
      />
    </main>
  );
}
