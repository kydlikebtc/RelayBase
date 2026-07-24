"use client";

import { useEffect, useState } from "react";
import type { Locale } from "../locale";

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

const loginCopy = {
  en: {
    callbackFallback: "Sign-in was not completed. Choose a method and try again.",
    callbackErrors: {
      access_denied: "You cancelled Google authorization. The account was not changed.",
      google_denied: "You cancelled Google authorization. The account was not changed.",
      google_not_configured: "Google sign-in is not configured on the server.",
      oauth_state_invalid: "The sign-in request expired or could not be verified. Start again.",
      oauth_callback_failed: "Google sign-in failed during callback. Try again shortly.",
      session_unavailable: "The sign-in session is temporarily unavailable.",
      identity_link_required: "This email belongs to another RelayBase account. Contact support to verify ownership.",
      identity_email_conflict: "The Google email belongs to another account. Contact support to verify ownership.",
      identity_link_conflict: "This identity is linked to an unavailable account. Contact support.",
      account_suspended: "This RelayBase account is suspended. Contact support.",
    },
    walletCancelled: "You cancelled wallet access or signing. The account was not changed.",
    walletPending: "The wallet already has a pending request. Complete it first.",
    walletFailed: "Wallet sign-in failed. Check the wallet and try again.",
    requestFailed: (status: number) => `Sign-in request failed (HTTP ${status}).`,
    invalidResponse: "The sign-in service returned unverifiable data. Try again shortly.",
    providersFailed: (status: number) => `Could not load sign-in methods (HTTP ${status}).`,
    providersInvalid: "The sign-in-method configuration is invalid.",
    providersUnavailable: "Sign-in methods are temporarily unavailable.",
    walletMissing: "No EVM wallet was detected. Install MetaMask, Rabby or another compatible wallet and refresh.",
    walletAccount: "Waiting for wallet account access…",
    walletAddressInvalid: "The wallet did not return a valid EVM address.",
    walletNetwork: "Confirming the wallet network…",
    walletNetworkInvalid: "The wallet returned an invalid network ID.",
    walletChallenge: "Creating a one-time sign-in message…",
    walletSign: "Sign the login message in your wallet…",
    walletSignatureInvalid: "The wallet returned an invalid signature.",
    walletVerify: "Verifying the signature and creating a session…",
    unsafeReturn: "The server returned an unsafe redirect. Navigation was stopped.",
    titleLine1: "Enter your",
    titleLine2: "data workspace.",
    intro: "Create an account with Google or an EVM wallet. Signing in creates only a site session; it does not read wallet assets or request an on-chain transaction.",
    sessionFact: "HttpOnly same-origin session",
    walletFact: "One-time sign-in message only",
    chooseMethod: "Choose a sign-in method",
    loadingMethods: "Loading available sign-in methods…",
    providersStatusError: "Sign-in service status is unavailable",
    retry: "Retry",
    loginIncomplete: "Sign-in was not completed",
    closeError: "Close error",
    google: "Continue with Google",
    notConfigured: "Not configured on the server",
    googleDetail: "Identify your email through Google OAuth",
    wallet: "Continue with an EVM wallet",
    walletDetail: "MetaMask, Rabby and compatible wallets",
    managedDivider: "Managed-environment access",
    chatgpt: "Continue with ChatGPT-managed identity",
    unavailableEnvironment: "Unavailable in this deployment",
    chatgptDetail: "Compatible with Codex / ChatGPT managed deployments",
    terms: "By continuing, you confirm that you are authorized to use the account and understand that crypto top-ups and API calls incur network and usage-based costs respectively.",
  },
  zh: {
    callbackFallback: "登录未完成，请重新选择一种登录方式。",
    callbackErrors: {
      access_denied: "你取消了 Google 授权，账户没有发生变化。",
      google_denied: "你取消了 Google 授权，账户没有发生变化。",
      google_not_configured: "Google 登录尚未完成服务端配置。",
      oauth_state_invalid: "登录请求已过期或无法验证，请重新开始。",
      oauth_callback_failed: "Google 登录回调失败，请稍后重试。",
      session_unavailable: "登录会话暂时不可用，请稍后重试。",
      identity_link_required: "这个邮箱已属于另一 RelayBase 账户。为保护余额和 API Key，请联系支持完成身份核验。",
      identity_email_conflict: "Google 返回的邮箱已属于另一账户，请联系支持完成身份核验。",
      identity_link_conflict: "这个登录身份已关联到不可用账户，请联系支持。",
      account_suspended: "该 RelayBase 账户已暂停，请联系支持确认账户状态。",
    },
    walletCancelled: "你取消了钱包授权或签名，账户没有发生变化。",
    walletPending: "钱包中已有一个待处理请求，请先在钱包里完成它。",
    walletFailed: "钱包登录失败，请检查钱包后重试。",
    requestFailed: (status: number) => `登录请求失败（HTTP ${status}）。`,
    invalidResponse: "登录服务返回了无法验证的数据，请稍后重试。",
    providersFailed: (status: number) => `无法读取登录方式（HTTP ${status}）。`,
    providersInvalid: "登录方式配置格式异常。",
    providersUnavailable: "登录方式暂时不可用。",
    walletMissing: "没有检测到 EVM 钱包。请安装 MetaMask、Rabby 等兼容钱包后刷新页面。",
    walletAccount: "等待钱包授权账户…",
    walletAddressInvalid: "钱包没有返回可用的 EVM 地址。",
    walletNetwork: "正在确认钱包网络…",
    walletNetworkInvalid: "钱包返回了无效的网络编号。",
    walletChallenge: "正在生成一次性登录消息…",
    walletSign: "请在钱包中签署登录消息…",
    walletSignatureInvalid: "钱包返回了无效的签名。",
    walletVerify: "正在验证签名并创建会话…",
    unsafeReturn: "服务端返回了不安全的跳转地址，已停止跳转。",
    titleLine1: "进入你的",
    titleLine2: "数据工作台。",
    intro: "使用 Google 或 EVM 钱包创建账户。登录只建立站内会话，不会读取钱包资产，也不会请求链上交易。",
    sessionFact: "HttpOnly 同源会话",
    walletFact: "仅签署一次性登录消息",
    chooseMethod: "选择登录方式",
    loadingMethods: "正在读取可用登录方式…",
    providersStatusError: "登录服务状态暂时无法读取",
    retry: "重试",
    loginIncomplete: "登录未完成",
    closeError: "关闭错误",
    google: "使用 Google 登录",
    notConfigured: "服务端尚未配置",
    googleDetail: "通过 Google OAuth 识别邮箱",
    wallet: "使用 EVM 钱包登录",
    walletDetail: "MetaMask、Rabby 与兼容钱包",
    managedDivider: "托管环境兼容入口",
    chatgpt: "使用 ChatGPT 托管身份",
    unavailableEnvironment: "当前部署环境不可用",
    chatgptDetail: "用于 Codex / ChatGPT 托管部署兼容",
    terms: "继续即表示你确认自己有权使用相应账户，并理解加密货币充值与 API 调用将分别产生链上和按量费用。",
  },
} as const;

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

function callbackErrorMessage(code: string | null, locale: Locale) {
  if (!code) return "";
  const messages = loginCopy[locale].callbackErrors as Record<string, string>;
  return messages[code] ?? loginCopy[locale].callbackFallback;
}

function walletErrorMessage(error: unknown, locale: Locale) {
  const c = loginCopy[locale];
  if (isObject(error)) {
    if (error.code === 4001) {
      return c.walletCancelled;
    }
    if (error.code === -32002) {
      return c.walletPending;
    }
  }
  return error instanceof Error
    ? error.message
    : c.walletFailed;
}

async function postJson<T>(
  url: string,
  body: JsonObject,
  validator: (value: unknown) => value is T,
  locale: Locale,
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
    let message = loginCopy[locale].requestFailed(response.status);
    if (
      locale === "zh" &&
      isObject(payload) &&
      isObject(payload.error) &&
      isNonEmptyString(payload.error.message, 500)
    ) {
      message = payload.error.message;
    }
    throw new LoginError(message, response.status);
  }
  if (!validator(payload)) {
    throw new LoginError(loginCopy[locale].invalidResponse, 502);
  }
  return payload;
}

export function LoginClient({
  returnTo,
  chatGPTSignInPath,
  initialErrorCode,
  locale,
}: {
  returnTo: string;
  chatGPTSignInPath: string;
  initialErrorCode: string | null;
  locale: Locale;
}) {
  const c = loginCopy[locale];
  const [providers, setProviders] = useState<ProviderAvailability | null>(null);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState("");
  const [loginError, setLoginError] = useState(
    callbackErrorMessage(initialErrorCode, locale),
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
            c.providersFailed(response.status),
            response.status,
          );
        }
        if (!isProviderAvailability(payload)) {
          throw new LoginError(c.providersInvalid, 502);
        }
        setProviders(payload);
      } catch (error) {
        if (controller.signal.aborted) return;
        setProviders(null);
        setProvidersError(
          error instanceof Error
            ? error.message
            : c.providersUnavailable,
        );
      } finally {
        if (!controller.signal.aborted) setProvidersLoading(false);
      }
    }, 0);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [c, reloadVersion]);

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
        c.walletMissing,
      );
      return;
    }

    setWalletBusy(true);
    try {
      setWalletStage(c.walletAccount);
      const accounts = await ethereum.request({
        method: "eth_requestAccounts",
      });
      if (
        !Array.isArray(accounts) ||
        !accounts.length ||
        typeof accounts[0] !== "string" ||
        !/^0x[a-fA-F0-9]{40}$/.test(accounts[0])
      ) {
        throw new LoginError(c.walletAddressInvalid);
      }
      const address = accounts[0];

      setWalletStage(c.walletNetwork);
      const chainId = await ethereum.request({ method: "eth_chainId" });
      if (
        typeof chainId !== "string" ||
        !/^0x[0-9a-fA-F]+$/.test(chainId) ||
        chainId.length > 66
      ) {
        throw new LoginError(c.walletNetworkInvalid);
      }

      setWalletStage(c.walletChallenge);
      const challenge = await postJson(
        "/api/auth/wallet/challenge",
        { address, chainId, returnTo },
        isChallengeResponse,
        locale,
      );

      setWalletStage(c.walletSign);
      const signature = await ethereum.request({
        method: "personal_sign",
        params: [challenge.message, address],
      });
      if (
        typeof signature !== "string" ||
        !/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(signature)
      ) {
        throw new LoginError(c.walletSignatureInvalid);
      }

      setWalletStage(c.walletVerify);
      const verified = await postJson(
        "/api/auth/wallet/verify",
        {
          challengeId: challenge.challengeId,
          address,
          signature,
        },
        isVerifyResponse,
        locale,
      );
      const safeReturnTo = safeReturnPath(verified.returnTo);
      if (!safeReturnTo) {
        throw new LoginError(c.unsafeReturn);
      }
      window.location.assign(safeReturnTo);
    } catch (error) {
      setLoginError(walletErrorMessage(error, locale));
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
            {c.titleLine1}
            <br />
            <span>{c.titleLine2}</span>
          </h1>
          <p>{c.intro}</p>
          <dl>
            <div>
              <dt>SESSION</dt>
              <dd>{c.sessionFact}</dd>
            </div>
            <div>
              <dt>WALLET</dt>
              <dd>{c.walletFact}</dd>
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
              <h2>{c.chooseMethod}</h2>
            </div>
          </div>

          {providersLoading ? (
            <div className="login-provider-loading" role="status">
              <span aria-hidden="true" />
              {c.loadingMethods}
            </div>
          ) : null}

          {providersError ? (
            <div className="login-alert login-alert-error" role="alert">
              <span aria-hidden="true">!</span>
              <div>
                <strong>{c.providersStatusError}</strong>
                <p>{providersError}</p>
              </div>
              <button onClick={() => setReloadVersion((value) => value + 1)}>
                {c.retry}
              </button>
            </div>
          ) : null}

          {loginError ? (
            <div className="login-alert login-alert-error" role="alert">
              <span aria-hidden="true">!</span>
              <div>
                <strong>{c.loginIncomplete}</strong>
                <p>{loginError}</p>
              </div>
              <button
                onClick={() => setLoginError("")}
                aria-label={c.closeError}
              >
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
                <strong>{c.google}</strong>
                <small>
                  {ready && !providers?.google.enabled
                    ? c.notConfigured
                    : c.googleDetail}
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
                  {walletBusy ? walletStage : c.wallet}
                </strong>
                <small>
                  {ready && !providers?.wallet.enabled
                    ? c.notConfigured
                    : c.walletDetail}
                </small>
              </div>
              <b aria-hidden="true">{walletBusy ? "…" : "→"}</b>
            </button>
          </div>

          <div className="login-divider">
            <span>{c.managedDivider}</span>
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
              <strong>{c.chatgpt}</strong>
              <small>
                {ready && !providers?.chatgpt.enabled
                  ? c.unavailableEnvironment
                  : c.chatgptDetail}
              </small>
            </div>
            <b aria-hidden="true">→</b>
          </a>

          <p className="login-terms">{c.terms}</p>
        </div>
      </section>
    </main>
  );
}
