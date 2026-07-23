"use client";

import { useEffect, useState } from "react";

type ProviderAvailability = {
  google: { enabled: boolean };
  wallet: { enabled: boolean };
  chatgpt: { enabled: boolean };
};

type ChallengeResponse = {
  challengeId: string;
  message: string;
  expiresAt: string;
};

type AuthUser = {
  displayName: string;
  email: string | null;
  walletAddress: string | null;
  provider: string;
};

type VerifyResponse = {
  ok: true;
  returnTo: string;
  user: AuthUser;
};

type JsonObject = Record<string, unknown>;

type EthereumProvider = {
  request(args: {
    method: string;
    params?: readonly unknown[] | JsonObject;
  }): Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

class LoginError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= max
  );
}

function isAuthUser(value: unknown): value is AuthUser {
  if (!isObject(value)) return false;
  return (
    isNonEmptyString(value.displayName, 320) &&
    (value.email === null || isNonEmptyString(value.email, 320)) &&
    (value.walletAddress === null ||
      (typeof value.walletAddress === "string" &&
        /^0x[a-fA-F0-9]{40}$/.test(value.walletAddress))) &&
    isNonEmptyString(value.provider, 32) &&
    /^[a-z][a-z0-9_-]{0,31}$/.test(value.provider)
  );
}

function isProviderAvailability(
  value: unknown,
): value is ProviderAvailability {
  if (!isObject(value)) return false;
  return (
    isObject(value.google) &&
    typeof value.google.enabled === "boolean" &&
    isObject(value.wallet) &&
    typeof value.wallet.enabled === "boolean" &&
    isObject(value.chatgpt) &&
    typeof value.chatgpt.enabled === "boolean"
  );
}

function isChallengeResponse(value: unknown): value is ChallengeResponse {
  if (!isObject(value)) return false;
  return (
    isNonEmptyString(value.challengeId, 180) &&
    isNonEmptyString(value.message, 8_000) &&
    isNonEmptyString(value.expiresAt, 64) &&
    Number.isFinite(Date.parse(value.expiresAt))
  );
}

function isVerifyResponse(value: unknown): value is VerifyResponse {
  if (!isObject(value)) return false;
  return (
    value.ok === true &&
    isNonEmptyString(value.returnTo, 2_000) &&
    isAuthUser(value.user)
  );
}

function safeReturnPath(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//")) return null;
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
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function callbackErrorMessage(code: string | null) {
  const messages: Record<string, string> = {
    access_denied: "你取消了 Google 授权，账户没有发生变化。",
    google_denied: "你取消了 Google 授权，账户没有发生变化。",
    google_not_configured: "Google 登录尚未完成服务端配置。",
    oauth_state_invalid: "登录请求已过期或无法验证，请重新开始。",
    oauth_callback_failed: "Google 登录回调失败，请稍后重试。",
    session_unavailable: "登录会话暂时不可用，请稍后重试。",
  };
  if (!code) return "";
  return messages[code] ?? "登录未完成，请重新选择一种登录方式。";
}

function walletErrorMessage(error: unknown) {
  if (isObject(error)) {
    if (error.code === 4001) {
      return "你取消了钱包授权或签名，账户没有发生变化。";
    }
    if (error.code === -32002) {
      return "钱包中已有一个待处理请求，请先在钱包里完成它。";
    }
  }
  return error instanceof Error
    ? error.message
    : "钱包登录失败，请检查钱包后重试。";
}

async function postJson<T>(
  url: string,
  body: JsonObject,
  validator: (value: unknown) => value is T,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    let message = `登录请求失败（HTTP ${response.status}）。`;
    if (
      isObject(payload) &&
      isObject(payload.error) &&
      isNonEmptyString(payload.error.message, 500)
    ) {
      message = payload.error.message;
    }
    throw new LoginError(message, response.status);
  }
  if (!validator(payload)) {
    throw new LoginError("登录服务返回了无法验证的数据，请稍后重试。", 502);
  }
  return payload;
}

export function LoginClient({
  returnTo,
  chatGPTSignInPath,
  initialErrorCode,
}: {
  returnTo: string;
  chatGPTSignInPath: string;
  initialErrorCode: string | null;
}) {
  const [providers, setProviders] = useState<ProviderAvailability | null>(null);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState("");
  const [loginError, setLoginError] = useState(
    callbackErrorMessage(initialErrorCode),
  );
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletStage, setWalletStage] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setProvidersLoading(true);
      setProvidersError("");
      try {
        const response = await fetch("/api/auth/providers", {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new LoginError(
            `无法读取登录方式（HTTP ${response.status}）。`,
            response.status,
          );
        }
        if (!isProviderAvailability(payload)) {
          throw new LoginError("登录方式配置格式异常。", 502);
        }
        setProviders(payload);
      } catch (error) {
        if (controller.signal.aborted) return;
        setProviders(null);
        setProvidersError(
          error instanceof Error
            ? error.message
            : "登录方式暂时不可用。",
        );
      } finally {
        if (!controller.signal.aborted) setProvidersLoading(false);
      }
    }, 0);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [reloadVersion]);

  function startGoogleLogin() {
    if (!providers?.google.enabled) return;
    setLoginError("");
    window.location.assign(
      `/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`,
    );
  }

  async function startWalletLogin() {
    if (!providers?.wallet.enabled || walletBusy) return;
    setLoginError("");

    const ethereum = window.ethereum;
    if (!ethereum) {
      setLoginError(
        "没有检测到 EVM 钱包。请安装 MetaMask、Rabby 等兼容钱包后刷新页面。",
      );
      return;
    }

    setWalletBusy(true);
    try {
      setWalletStage("等待钱包授权账户…");
      const accounts = await ethereum.request({
        method: "eth_requestAccounts",
      });
      if (
        !Array.isArray(accounts) ||
        !accounts.length ||
        typeof accounts[0] !== "string" ||
        !/^0x[a-fA-F0-9]{40}$/.test(accounts[0])
      ) {
        throw new LoginError("钱包没有返回可用的 EVM 地址。");
      }
      const address = accounts[0];

      setWalletStage("正在确认钱包网络…");
      const chainId = await ethereum.request({ method: "eth_chainId" });
      if (
        typeof chainId !== "string" ||
        !/^0x[0-9a-fA-F]+$/.test(chainId) ||
        chainId.length > 66
      ) {
        throw new LoginError("钱包返回了无效的网络编号。");
      }

      setWalletStage("正在生成一次性登录消息…");
      const challenge = await postJson(
        "/api/auth/wallet/challenge",
        { address, chainId, returnTo },
        isChallengeResponse,
      );

      setWalletStage("请在钱包中签署登录消息…");
      const signature = await ethereum.request({
        method: "personal_sign",
        params: [challenge.message, address],
      });
      if (
        typeof signature !== "string" ||
        !/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(signature)
      ) {
        throw new LoginError("钱包返回了无效的签名。");
      }

      setWalletStage("正在验证签名并创建会话…");
      const verified = await postJson(
        "/api/auth/wallet/verify",
        {
          challengeId: challenge.challengeId,
          address,
          signature,
        },
        isVerifyResponse,
      );
      const safeReturnTo = safeReturnPath(verified.returnTo);
      if (!safeReturnTo) {
        throw new LoginError("服务端返回了不安全的跳转地址，已停止跳转。");
      }
      window.location.assign(safeReturnTo);
    } catch (error) {
      setLoginError(walletErrorMessage(error));
      setWalletBusy(false);
      setWalletStage("");
    }
  }

  const ready = !providersLoading && providers !== null;

  return (
    <main className="login-page" id="main-content">
      <section className="login-shell" aria-labelledby="login-title">
        <div className="login-intro">
          <div className="login-brand-mark" aria-hidden="true">
            R/
          </div>
          <p className="section-kicker">RELAYBASE / ACCESS</p>
          <h1 id="login-title">
            进入你的
            <br />
            <span>数据工作台。</span>
          </h1>
          <p>
            使用 Google 或 EVM
            钱包创建账户。登录只建立站内会话，不会读取钱包资产，也不会请求链上交易。
          </p>
          <dl>
            <div>
              <dt>SESSION</dt>
              <dd>HttpOnly 同源会话</dd>
            </div>
            <div>
              <dt>WALLET</dt>
              <dd>仅签署一次性登录消息</dd>
            </div>
            <div>
              <dt>RETURN</dt>
              <dd>{returnTo}</dd>
            </div>
          </dl>
        </div>

        <div className="login-card">
          <div className="login-card-head">
            <span>01</span>
            <div>
              <p>IDENTITY PROVIDERS</p>
              <h2>选择登录方式</h2>
            </div>
          </div>

          {providersLoading ? (
            <div className="login-provider-loading" role="status">
              <span aria-hidden="true" />
              正在读取可用登录方式…
            </div>
          ) : null}

          {providersError ? (
            <div className="login-alert login-alert-error" role="alert">
              <span aria-hidden="true">!</span>
              <div>
                <strong>登录服务状态暂时无法读取</strong>
                <p>{providersError}</p>
              </div>
              <button onClick={() => setReloadVersion((value) => value + 1)}>
                重试
              </button>
            </div>
          ) : null}

          {loginError ? (
            <div className="login-alert login-alert-error" role="alert">
              <span aria-hidden="true">!</span>
              <div>
                <strong>登录未完成</strong>
                <p>{loginError}</p>
              </div>
              <button onClick={() => setLoginError("")} aria-label="关闭错误">
                ×
              </button>
            </div>
          ) : null}

          <div className="login-options">
            <button
              className="login-provider-button login-provider-google"
              type="button"
              disabled={!ready || !providers?.google.enabled}
              onClick={startGoogleLogin}
            >
              <span aria-hidden="true">G</span>
              <div>
                <strong>使用 Google 登录</strong>
                <small>
                  {ready && !providers?.google.enabled
                    ? "服务端尚未配置"
                    : "通过 Google OAuth 识别邮箱"}
                </small>
              </div>
              <b aria-hidden="true">→</b>
            </button>

            <button
              className="login-provider-button login-provider-wallet"
              type="button"
              disabled={!ready || !providers?.wallet.enabled || walletBusy}
              onClick={() => void startWalletLogin()}
            >
              <span aria-hidden="true">0x</span>
              <div>
                <strong>
                  {walletBusy ? walletStage : "使用 EVM 钱包登录"}
                </strong>
                <small>
                  {ready && !providers?.wallet.enabled
                    ? "服务端尚未配置"
                    : "MetaMask、Rabby 与兼容钱包"}
                </small>
              </div>
              <b aria-hidden="true">{walletBusy ? "…" : "→"}</b>
            </button>
          </div>

          <div className="login-divider">
            <span>托管环境兼容入口</span>
          </div>

          <a
            className={`login-provider-button login-provider-chatgpt ${
              !ready || !providers?.chatgpt.enabled ? "is-disabled" : ""
            }`}
            href={
              ready && providers?.chatgpt.enabled
                ? chatGPTSignInPath
                : undefined
            }
            aria-disabled={!ready || !providers?.chatgpt.enabled}
            tabIndex={!ready || !providers?.chatgpt.enabled ? -1 : undefined}
            onClick={(event) => {
              if (!ready || !providers?.chatgpt.enabled) {
                event.preventDefault();
              }
            }}
          >
            <span aria-hidden="true">C</span>
            <div>
              <strong>使用 ChatGPT 托管身份</strong>
              <small>
                {ready && !providers?.chatgpt.enabled
                  ? "当前部署环境不可用"
                  : "用于 Codex / ChatGPT 托管部署兼容"}
              </small>
            </div>
            <b aria-hidden="true">→</b>
          </a>

          <p className="login-terms">
            继续即表示你确认自己有权使用相应账户，并理解加密货币充值与
            API 调用将分别产生链上和按量费用。
          </p>
        </div>
      </section>
    </main>
  );
}
