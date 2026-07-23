import { recoverMessageAddress } from "viem";
import packageJson from "../package.json";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const SESSION_COOKIE = "rb_session";
const OAUTH_STATE_COOKIE = "rb_oauth_state";
const MAX_DASHBOARD_BODY_BYTES = 16 * 1024;
const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
const MAX_UPSTREAM_ERROR_BODY_BYTES = 32 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
const MAX_CATALOG_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_OPENAPI_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_PROXY_BODY_BYTES = 256 * 1024;
const PAYMENT_AMOUNTS = new Set([10, 25, 50, 100]);
const PAYMENT_CURRENCIES = new Set([
  "usdttrc20",
  "usdterc20",
  "usdtbsc",
  "usdcbase",
  "usdcpolygon",
  "usdcsol",
]);
const NOWPAYMENTS_STATUSES = new Set([
  "waiting",
  "confirming",
  "confirmed",
  "sending",
  "partially_paid",
  "finished",
  "failed",
  "refunded",
  "expired",
]);
const NOWPAYMENTS_REVIEW_CREDITABLE_STATUSES = new Set([
  "finished",
]);

export interface PlatformEnv {
  DB?: D1Database;
  TIKHUB_API_KEY?: string;
  TIKHUB_CREDENTIALS_ENCRYPTION_KEY?: string;
  TIKHUB_BASE_URL?: string;
  RESELLER_AUTHORIZED?: string;
  PAYMENT_PROVIDER?: string;
  NOWPAYMENTS_API_KEY?: string;
  NOWPAYMENTS_IPN_SECRET?: string;
  CRYPTO_PAYMENTS_ENABLED?: string;
  LEGAL_REVIEW_CONFIRMED?: string;
  PUBLIC_APP_URL?: string;
  DEFAULT_REQUEST_COST_USD_MICROS?: string;
  API_RATE_LIMIT_RPM?: string;
  UPSTREAM_TIMEOUT_MS?: string;
  UPSTREAM_MAX_RESPONSE_BYTES?: string;
  CATALOG_SYNC_SECRET?: string;
  RECONCILIATION_SECRET?: string;
  PAYMENT_ADMIN_SECRET?: string;
  ADMIN_MASTER_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  WALLET_LOGIN_ENABLED?: string;
  AUTH_SESSION_TTL_DAYS?: string;
  TRUST_SITES_IDENTITY_HEADERS?: string;
  PRICE_MARKUP_BPS?: string;
  UPSTREAM_RATE_LIMIT_RPS?: string;
  ACCOUNT_CONCURRENCY_LIMIT?: string;
  PAYMENT_CREATE_LIMIT_PER_MINUTE?: string;
  PAYMENT_PROVIDER_LIMIT_PER_MINUTE?: string;
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  provider: "google" | "wallet" | "chatgpt";
  walletAddress: string | null;
};

type ApiKeyRecord = {
  id: string;
  user_id: string;
  rate_limit_rpm: number;
};

type CatalogRecord = {
  path: string;
  platform: string;
  http_method: string;
  upstream_price_usd_micros: number;
  customer_price_usd_micros: number;
  price_verified: number;
  enabled: number;
  read_only: number;
  sync_generation: string | null;
};

type PaymentOrderRecord = {
  id: string;
  user_id: string;
  provider_payment_id: string | null;
  idempotency_hash: string | null;
  amount_usd_micros: number;
  pay_currency: string;
  pay_amount: string | null;
  pay_address: string | null;
  invoice_url: string | null;
  status: string;
  credited_usd_micros: number;
  created_at: string;
  updated_at: string;
};

type ManagedUpstreamCredentialRecord = {
  id: string;
  label: string;
  encrypted_secret: string;
  secret_hash: string;
  verified_scopes_json: string | null;
  expires_at: string | null;
  status: "active" | "standby" | "revoked";
  verified_at: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type ResolvedTikHubCredential = {
  secret: string;
  fingerprint: string;
  source: "managed" | "environment";
  id: string | null;
  scopes: string[] | null;
  expiresAt: string | null;
  stateVersion: number;
};

type TikHubCredentialVerification = {
  scopes: string[];
  expiresAt: string | null;
};

type NowPaymentsPayment = {
  payment_id?: string | number;
  payment_status?: string;
  pay_address?: string;
  price_amount?: number | string;
  price_currency?: string;
  pay_amount?: number | string;
  actually_paid?: number | string;
  pay_currency?: string;
  order_id?: string;
  parent_payment_id?: string | number;
  invoice_url?: string;
  updated_at?: string;
};

class PlatformError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function handlePlatformRequest(
  request: Request,
  env: PlatformEnv,
  ctx: WorkerExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  const requestId = crypto.randomUUID();

  try {
    if (url.pathname === "/api/health" && request.method === "GET") {
      const readiness = await operationalReadiness(env);
      return jsonResponse(
        {
          ok: true,
          service: "relaybase-api",
          version: packageJson.version,
          ready: readiness.ready,
          mode: readiness.mode,
          capabilities: readiness.capabilities,
          missing: readiness.missing,
          timestamp: new Date().toISOString(),
        },
        200,
        requestId,
      );
    }

    if (url.pathname === "/api/readiness" && request.method === "GET") {
      const readiness = await operationalReadiness(env);
      return jsonResponse(
        {
          ok: readiness.ready,
          service: "relaybase-api",
          version: packageJson.version,
          mode: readiness.mode,
          capabilities: readiness.capabilities,
          missing: readiness.missing,
          timestamp: new Date().toISOString(),
        },
        readiness.ready ? 200 : 503,
        requestId,
      );
    }

    if (url.pathname === "/api/catalog" && request.method === "GET") {
      return await handlePublicCatalog(request, env, requestId);
    }

    if (
      url.pathname === "/api/auth/providers" &&
      request.method === "GET"
    ) {
      return handleAuthProviders(env, requestId);
    }

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      return await handleAuthMe(request, env, requestId);
    }

    if (
      url.pathname === "/api/auth/google/start" &&
      request.method === "GET"
    ) {
      return await handleGoogleAuthStart(request, env);
    }

    if (
      url.pathname === "/api/auth/google/callback" &&
      request.method === "GET"
    ) {
      return await handleGoogleAuthCallback(request, env);
    }

    if (
      url.pathname === "/api/auth/wallet/challenge" &&
      request.method === "POST"
    ) {
      return await handleWalletChallenge(request, env, requestId);
    }

    if (
      url.pathname === "/api/auth/wallet/verify" &&
      request.method === "POST"
    ) {
      return await handleWalletVerify(request, env, requestId);
    }

    if (
      url.pathname === "/api/auth/signout" &&
      request.method === "POST"
    ) {
      return await handleAuthSignOut(request, env, requestId);
    }

    if (
      url.pathname === "/api/payments/nowpayments/ipn" &&
      request.method === "POST"
    ) {
      return await handleNowPaymentsWebhook(request, env, ctx, requestId);
    }

    if (url.pathname === "/api/dashboard" && request.method === "GET") {
      return await handleDashboard(request, env, requestId);
    }

    if (url.pathname === "/api/keys" && request.method === "POST") {
      return await handleCreateApiKey(request, env, requestId);
    }

    if (url.pathname === "/api/keys" && request.method === "DELETE") {
      return await handleRevokeApiKey(request, env, requestId);
    }

    if (url.pathname === "/api/payments" && request.method === "POST") {
      return await handleCreatePayment(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/upstream-credentials" &&
      request.method === "GET"
    ) {
      return await handleUpstreamCredentialsList(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/upstream-credentials" &&
      request.method === "POST"
    ) {
      return await handleUpstreamCredentialCreate(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/upstream-credentials" &&
      request.method === "PATCH"
    ) {
      return await handleUpstreamCredentialUpdate(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/catalog/sync" &&
      request.method === "POST"
    ) {
      return await handleCatalogSync(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/catalog" &&
      request.method === "GET"
    ) {
      return await handleCatalogList(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/catalog" &&
      request.method === "PATCH"
    ) {
      return await handleCatalogUpdate(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/overview" &&
      request.method === "GET"
    ) {
      return await handleAdminOverview(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/users" &&
      request.method === "GET"
    ) {
      return await handleAdminUsers(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/users" &&
      request.method === "PATCH"
    ) {
      return await handleAdminUserUpdate(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/payments" &&
      request.method === "GET"
    ) {
      return await handleAdminPayments(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/payments/recover" &&
      request.method === "POST"
    ) {
      return await handleRecoverPayment(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/payment-reviews" &&
      request.method === "GET"
    ) {
      return await handlePaymentReviewList(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/payment-reviews/resolve" &&
      request.method === "POST"
    ) {
      return await handlePaymentReviewResolve(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/audit" &&
      request.method === "GET"
    ) {
      return await handleAdminAuditList(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/reconcile" &&
      request.method === "POST"
    ) {
      return await handleReconciliation(request, env, requestId);
    }

    if (url.pathname.startsWith("/v1/")) {
      return await handleProxyRequest(request, env, ctx, requestId);
    }

    return null;
  } catch (error) {
    if (error instanceof PlatformError) {
      return errorResponse(
        error.status,
        error.code,
        error.message,
        requestId,
      );
    }

    console.error("RelayBase request failed", {
      requestId,
      path: url.pathname,
      error: error instanceof Error ? error.message : "unknown error",
    });
    return errorResponse(
      500,
      "internal_error",
      "服务暂时不可用，请稍后重试。",
      requestId,
    );
  }
}

function handleAuthProviders(
  env: PlatformEnv,
  requestId: string,
): Response {
  return jsonResponse(
    {
      google: {
        enabled:
          hasConfiguredCredential(env.GOOGLE_CLIENT_ID) &&
          hasConfiguredCredential(env.GOOGLE_CLIENT_SECRET),
      },
      wallet: { enabled: env.WALLET_LOGIN_ENABLED === "true" },
      chatgpt: {
        enabled: env.TRUST_SITES_IDENTITY_HEADERS === "true",
      },
    },
    200,
    requestId,
  );
}

async function handleAuthMe(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  const user = await requireAuthenticatedUser(request, requireDb(env), env);
  return jsonResponse({ user: publicAuthUser(user) }, 200, requestId);
}

async function handleGoogleAuthStart(
  request: Request,
  env: PlatformEnv,
): Promise<Response> {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (
    !hasConfiguredCredential(clientId) ||
    !hasConfiguredCredential(clientSecret)
  ) {
    return oauthFailureRedirect(
      request,
      env,
      "google_not_configured",
      "/console",
    );
  }

  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("return_to"));
  const origin = canonicalAppOrigin(request, env);
  const db = requireDb(env);
  await consumeAuthChallengeRateLimit(db, request, "google", null);
  const challengeId = `auth_${randomBase64Url(24)}`;
  const verifier = randomBase64Url(48);
  const nonce = randomAlphaNumeric(24);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const codeChallenge = await sha256Base64Url(verifier);

  await db
    .prepare(
      `INSERT INTO auth_challenges
       (id, provider, verifier, subject_hint, return_to, created_at, expires_at)
       VALUES (?, 'google', ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    )
    .bind(challengeId, verifier, nonce, returnTo, expiresAt)
    .run();

  const authorizationUrl = new URL(
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set(
    "redirect_uri",
    `${origin}/api/auth/google/callback`,
  );
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", challengeId);
  authorizationUrl.searchParams.set("nonce", nonce);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("prompt", "select_account");

  return new Response(null, {
    status: 302,
    headers: {
      location: authorizationUrl.toString(),
      "cache-control": "no-store",
      "set-cookie": authCookie(
        OAUTH_STATE_COOKIE,
        challengeId,
        10 * 60,
        origin,
        "/api/auth/google",
      ),
    },
  });
}

async function handleGoogleAuthCallback(
  request: Request,
  env: PlatformEnv,
): Promise<Response> {
  let returnTo = "/console";
  try {
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    if (
      !hasConfiguredCredential(clientId) ||
      !hasConfiguredCredential(clientSecret)
    ) {
      throw new PlatformError(
        503,
        "google_not_configured",
        "Google 登录尚未配置。",
      );
    }

    const url = new URL(request.url);
    const state = url.searchParams.get("state") ?? "";
    const stateCookie = cookieValue(request, OAUTH_STATE_COOKIE) ?? "";
    if (
      url.searchParams.getAll("state").length !== 1 ||
      !/^auth_[A-Za-z0-9_-]{20,80}$/.test(state) ||
      !constantTimeEqual(state, stateCookie)
    ) {
      throw new PlatformError(
        401,
        "oauth_state_invalid",
        "Google 登录请求已过期。",
      );
    }

    const db = requireDb(env);
    const challenge = await db
      .prepare(
        `SELECT verifier, subject_hint, return_to
         FROM auth_challenges
         WHERE id = ? AND provider = 'google'
           AND consumed_at IS NULL
           AND datetime(expires_at) > datetime('now')`,
      )
      .bind(state)
      .first<{
        verifier: string | null;
        subject_hint: string | null;
        return_to: string;
      }>();
    if (!challenge?.verifier || !challenge.subject_hint) {
      throw new PlatformError(
        401,
        "oauth_state_invalid",
        "Google 登录请求已过期。",
      );
    }
    returnTo = safeReturnTo(challenge.return_to);

    const consumed = await db
      .prepare(
        `UPDATE auth_challenges
         SET consumed_at = CURRENT_TIMESTAMP
         WHERE id = ? AND provider = 'google'
           AND consumed_at IS NULL
           AND datetime(expires_at) > datetime('now')`,
      )
      .bind(state)
      .run();
    if (Number(consumed.meta?.changes ?? 0) !== 1) {
      throw new PlatformError(
        401,
        "oauth_state_invalid",
        "Google 登录请求已使用或已过期。",
      );
    }

    if (url.searchParams.has("error")) {
      throw new PlatformError(
        401,
        "google_denied",
        "Google 授权未完成。",
      );
    }
    const code = url.searchParams.get("code") ?? "";
    if (
      url.searchParams.getAll("code").length !== 1 ||
      code.length < 8 ||
      code.length > 4_096
    ) {
      throw new PlatformError(
        401,
        "oauth_callback_failed",
        "Google 登录回调缺少有效授权码。",
      );
    }

    const origin = canonicalAppOrigin(request, env);
    let tokenResponse: Response;
    try {
      tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: `${origin}/api/auth/google/callback`,
          grant_type: "authorization_code",
          code_verifier: challenge.verifier,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new PlatformError(
        502,
        "oauth_callback_failed",
        "Google 登录服务暂时不可用。",
      );
    }
    const tokenPayload = await readResponseJson(
      tokenResponse,
      64 * 1024,
      "oauth_callback_failed",
    );
    if (!tokenResponse.ok || !isPlainRecord(tokenPayload)) {
      throw new PlatformError(
        401,
        "oauth_callback_failed",
        "Google 授权码验证失败。",
      );
    }
    const idToken = firstString(tokenPayload, ["id_token"]);
    if (
      !idToken ||
      idToken.length > 16_384 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(idToken)
    ) {
      throw new PlatformError(
        401,
        "oauth_callback_failed",
        "Google 身份令牌无效。",
      );
    }

    const tokenInfoUrl = new URL(
      "https://oauth2.googleapis.com/tokeninfo",
    );
    tokenInfoUrl.searchParams.set("id_token", idToken);
    let tokenInfoResponse: Response;
    try {
      tokenInfoResponse = await fetch(tokenInfoUrl, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new PlatformError(
        502,
        "oauth_callback_failed",
        "Google 身份验证服务暂时不可用。",
      );
    }
    const tokenInfo = await readResponseJson(
      tokenInfoResponse,
      64 * 1024,
      "oauth_callback_failed",
    );
    if (!tokenInfoResponse.ok || !isPlainRecord(tokenInfo)) {
      throw new PlatformError(
        401,
        "oauth_callback_failed",
        "Google 身份令牌验证失败。",
      );
    }

    const issuer = firstString(tokenInfo, ["iss"]);
    const audience = firstString(tokenInfo, ["aud"]);
    const subject = firstString(tokenInfo, ["sub"]);
    const email = firstString(tokenInfo, ["email"])?.toLowerCase() ?? "";
    const verified =
      tokenInfo.email_verified === true ||
      tokenInfo.email_verified === "true";
    const expiration = Number(tokenInfo.exp);
    const returnedNonce = firstString(tokenInfo, ["nonce"]);
    if (
      (issuer !== "accounts.google.com" &&
        issuer !== "https://accounts.google.com") ||
      audience !== clientId ||
      !subject ||
      !/^[A-Za-z0-9_-]{6,255}$/.test(subject) ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
      !verified ||
      !Number.isFinite(expiration) ||
      expiration * 1_000 <= Date.now() ||
      returnedNonce !== challenge.subject_hint
    ) {
      throw new PlatformError(
        401,
        "oauth_callback_failed",
        "Google 身份声明无法验证。",
      );
    }

    const displayName =
      compactIdentityName(tokenInfo.name) ?? email.split("@")[0] ?? email;
    const user = await upsertAuthIdentity(db, {
      provider: "google",
      subject,
      email,
      displayName,
      walletAddress: null,
    });
    const session = await createAuthSession(db, user, env, origin);
    return new Response(null, {
      status: 302,
      headers: {
        location: new URL(returnTo, origin).toString(),
        "cache-control": "no-store",
        "set-cookie": session.cookie,
      },
    });
  } catch (error) {
    const code =
      error instanceof PlatformError
        ? error.code
        : "oauth_callback_failed";
    console.error("Google authentication failed", {
      code,
      error: error instanceof Error ? error.message : "unknown error",
    });
    return oauthFailureRedirect(request, env, code, returnTo);
  }
}

async function handleWalletChallenge(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  if (env.WALLET_LOGIN_ENABLED !== "true") {
    throw new PlatformError(
      503,
      "wallet_login_disabled",
      "钱包登录尚未启用。",
    );
  }
  const body = await readJsonBody<{
    address?: unknown;
    chainId?: unknown;
    returnTo?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const address =
    typeof body.address === "string" ? body.address.trim() : "";
  const chainIdRaw =
    typeof body.chainId === "string" ? body.chainId.trim() : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new PlatformError(400, "invalid_wallet_address", "钱包地址无效。");
  }
  if (!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(chainIdRaw)) {
    throw new PlatformError(400, "invalid_chain_id", "钱包网络编号无效。");
  }
  const chainId = BigInt(chainIdRaw);
  if (chainId < BigInt(1) || chainId > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PlatformError(400, "invalid_chain_id", "钱包网络编号无效。");
  }

  const origin = canonicalAppOrigin(request, env);
  const host = new URL(origin).host;
  const db = requireDb(env);
  await consumeAuthChallengeRateLimit(
    db,
    request,
    "wallet",
    address.toLowerCase(),
  );
  const challengeId = `auth_${randomBase64Url(24)}`;
  const nonce = randomAlphaNumeric(24);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 10 * 60_000);
  const message = `${host} wants you to sign in with your Ethereum account:
${address}

Sign in to RelayBase. This request does not send a transaction.

URI: ${origin}
Version: 1
Chain ID: ${chainId.toString()}
Nonce: ${nonce}
Issued At: ${issuedAt.toISOString()}
Expiration Time: ${expiresAt.toISOString()}
Request ID: ${challengeId}`;
  const returnTo = safeReturnTo(
    typeof body.returnTo === "string" ? body.returnTo : null,
  );

  await db
    .prepare(
      `INSERT INTO auth_challenges
       (id, provider, subject_hint, message, return_to, created_at, expires_at)
       VALUES (?, 'wallet', ?, ?, ?, ?, ?)`,
    )
    .bind(
      challengeId,
      address.toLowerCase(),
      message,
      returnTo,
      issuedAt.toISOString(),
      expiresAt.toISOString(),
    )
    .run();

  return jsonResponse(
    {
      challengeId,
      message,
      expiresAt: expiresAt.toISOString(),
    },
    200,
    requestId,
  );
}

async function handleWalletVerify(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  if (env.WALLET_LOGIN_ENABLED !== "true") {
    throw new PlatformError(
      503,
      "wallet_login_disabled",
      "钱包登录尚未启用。",
    );
  }
  const body = await readJsonBody<{
    challengeId?: unknown;
    address?: unknown;
    signature?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const challengeId =
    typeof body.challengeId === "string" ? body.challengeId.trim() : "";
  const address =
    typeof body.address === "string" ? body.address.trim() : "";
  const signature =
    typeof body.signature === "string" ? body.signature.trim() : "";
  if (!/^auth_[A-Za-z0-9_-]{20,80}$/.test(challengeId)) {
    throw new PlatformError(
      400,
      "invalid_wallet_challenge",
      "钱包登录请求无效。",
    );
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new PlatformError(400, "invalid_wallet_address", "钱包地址无效。");
  }
  if (!/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(signature)) {
    throw new PlatformError(
      400,
      "invalid_wallet_signature",
      "钱包签名格式无效。",
    );
  }

  const db = requireDb(env);
  await consumeWalletVerificationRateLimit(
    db,
    request,
    challengeId,
  );
  const challenge = await db
    .prepare(
      `SELECT subject_hint, message, return_to
       FROM auth_challenges
       WHERE id = ? AND provider = 'wallet'
         AND consumed_at IS NULL
         AND datetime(expires_at) > datetime('now')`,
    )
    .bind(challengeId)
    .first<{
      subject_hint: string | null;
      message: string | null;
      return_to: string;
    }>();
  if (
    !challenge?.message ||
    !challenge.subject_hint ||
    challenge.subject_hint !== address.toLowerCase()
  ) {
    throw new PlatformError(
      401,
      "wallet_challenge_expired",
      "钱包登录请求已过期或地址不匹配。",
    );
  }

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({
      message: challenge.message,
      signature: signature as `0x${string}`,
    });
  } catch {
    throw new PlatformError(
      401,
      "wallet_signature_invalid",
      "钱包签名无法验证。",
    );
  }
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw new PlatformError(
      401,
      "wallet_signature_invalid",
      "钱包签名与所选地址不匹配。",
    );
  }

  const consumed = await db
    .prepare(
      `UPDATE auth_challenges
       SET consumed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND provider = 'wallet'
         AND consumed_at IS NULL
         AND datetime(expires_at) > datetime('now')`,
    )
    .bind(challengeId)
    .run();
  if (Number(consumed.meta?.changes ?? 0) !== 1) {
    throw new PlatformError(
      409,
      "wallet_challenge_used",
      "钱包登录请求已使用，请重新发起。",
    );
  }

  const normalizedAddress = address.toLowerCase();
  const user = await upsertAuthIdentity(db, {
    provider: "wallet",
    subject: normalizedAddress,
    email: null,
    displayName: `${address.slice(0, 6)}…${address.slice(-4)}`,
    walletAddress: normalizedAddress,
  });
  const origin = canonicalAppOrigin(request, env);
  const session = await createAuthSession(db, user, env, origin);
  return jsonResponse(
    {
      ok: true,
      returnTo: safeReturnTo(challenge.return_to),
      user: publicAuthUser(user),
    },
    200,
    requestId,
    { "set-cookie": session.cookie },
  );
}

async function handleAuthSignOut(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  const token = cookieValue(request, SESSION_COOKIE);
  if (token && /^[A-Za-z0-9_-]{32,160}$/.test(token)) {
    await requireDb(env)
      .prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`)
      .bind(await sha256Hex(token))
      .run();
  }
  const origin = canonicalAppOrigin(request, env);
  return jsonResponse(
    { ok: true },
    200,
    requestId,
    {
      "set-cookie": authCookie(
        SESSION_COOKIE,
        "",
        0,
        origin,
        "/",
      ),
    },
  );
}

function oauthFailureRedirect(
  request: Request,
  env: PlatformEnv,
  code: string,
  returnTo: string,
): Response {
  let origin: string;
  try {
    origin = canonicalAppOrigin(request, env);
  } catch {
    origin = new URL(request.url).origin;
  }
  const login = new URL("/login", origin);
  login.searchParams.set("error", /^[a-z0-9_]{1,64}$/.test(code) ? code : "oauth_callback_failed");
  login.searchParams.set("return_to", safeReturnTo(returnTo));
  return new Response(null, {
    status: 302,
    headers: {
      location: login.toString(),
      "cache-control": "no-store",
      "set-cookie": authCookie(
        OAUTH_STATE_COOKIE,
        "",
        0,
        origin,
        "/api/auth/google",
      ),
    },
  });
}

function publicAuthUser(user: AuthenticatedUser) {
  return {
    displayName: user.displayName,
    email: user.provider === "wallet" ? null : user.email,
    walletAddress: user.walletAddress,
    provider: user.provider,
  };
}

async function upsertAuthIdentity(
  db: D1Database,
  input: {
    provider: "google" | "wallet";
    subject: string;
    email: string | null;
    displayName: string;
    walletAddress: string | null;
  },
): Promise<AuthenticatedUser> {
  const existing = await db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.status,
              ai.wallet_address
       FROM auth_identities ai
       JOIN users u ON u.id = ai.user_id
       WHERE ai.provider = ? AND ai.subject = ?`,
    )
    .bind(input.provider, input.subject)
    .first<{
      id: string;
      email: string;
      display_name: string | null;
      status: string;
      wallet_address: string | null;
    }>();
  if (existing) {
    if (existing.status !== "active") {
      throw new PlatformError(403, "account_suspended", "账户当前不可用。");
    }
    if (input.email && input.email !== existing.email) {
      const emailUpdate = await db
        .prepare(
          `UPDATE users
           SET email = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
             AND NOT EXISTS (
               SELECT 1 FROM users
               WHERE email = ? AND id != ?
             )`,
        )
        .bind(input.email, existing.id, input.email, existing.id)
        .run();
      if (Number(emailUpdate.meta?.changes ?? 0) !== 1) {
        throw new PlatformError(
          409,
          "identity_email_conflict",
          "该 Google 邮箱已属于另一账户，请联系支持完成受控账户恢复。",
        );
      }
    }
    await db.batch([
      db
        .prepare(
          `UPDATE auth_identities
           SET email = ?, wallet_address = ?, updated_at = CURRENT_TIMESTAMP
           WHERE provider = ? AND subject = ?`,
        )
        .bind(
          input.email,
          input.walletAddress,
          input.provider,
          input.subject,
        ),
      db
        .prepare(
          `UPDATE users
           SET display_name = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'active'`,
        )
        .bind(input.displayName, existing.id),
    ]);
    return {
      id: existing.id,
      email: input.email ?? existing.email,
      displayName: input.displayName,
      provider: input.provider,
      walletAddress: input.walletAddress,
    };
  }

  const syntheticEmail =
    input.email ??
    `${input.subject.replace(/^0x/, "")}@wallet.relaybase.invalid`;
  const candidateUserId = `usr_${(
    await sha256Hex(`${input.provider}:${input.subject}`)
  ).slice(0, 24)}`;
  const insertedUser = await db
    .prepare(
      `INSERT OR IGNORE INTO users
       (id, email, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(candidateUserId, syntheticEmail, input.displayName)
    .run();
  if (Number(insertedUser.meta?.changes ?? 0) !== 1) {
    const racedIdentity = await db
      .prepare(
        `SELECT u.id, u.email, u.display_name, u.status,
                ai.wallet_address
         FROM auth_identities ai
         JOIN users u ON u.id = ai.user_id
         WHERE ai.provider = ? AND ai.subject = ?`,
      )
      .bind(input.provider, input.subject)
      .first<{
        id: string;
        email: string;
        display_name: string | null;
        status: string;
        wallet_address: string | null;
      }>();
    if (racedIdentity?.status === "active") {
      return {
        id: racedIdentity.id,
        email: racedIdentity.email,
        displayName:
          racedIdentity.display_name ?? input.displayName,
        provider: input.provider,
        walletAddress: racedIdentity.wallet_address,
      };
    }
    throw new PlatformError(
      409,
      "identity_link_required",
      "该邮箱已有 RelayBase 账户；为保护余额与 API Key，请通过受控账户恢复完成关联。",
    );
  }
  const user = await db
    .prepare(
      `SELECT id, email, display_name, status
       FROM users
       WHERE email = ?`,
    )
    .bind(syntheticEmail)
    .first<{
      id: string;
      email: string;
      display_name: string | null;
      status: string;
    }>();
  if (!user || user.status !== "active") {
    throw new PlatformError(403, "account_suspended", "账户当前不可用。");
  }

  const identityId = `aid_${(
    await sha256Hex(`${input.provider}:${input.subject}`)
  ).slice(0, 28)}`;
  await db
    .prepare(
      `INSERT OR IGNORE INTO auth_identities
       (id, user_id, provider, subject, email, wallet_address,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(
      identityId,
      user.id,
      input.provider,
      input.subject,
      input.email,
      input.walletAddress,
    )
    .run();
  const linked = await db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.status,
              ai.wallet_address
       FROM auth_identities ai
       JOIN users u ON u.id = ai.user_id
       WHERE ai.provider = ? AND ai.subject = ?`,
    )
    .bind(input.provider, input.subject)
    .first<{
      id: string;
      email: string;
      display_name: string | null;
      status: string;
      wallet_address: string | null;
    }>();
  if (!linked || linked.status !== "active") {
    throw new PlatformError(
      409,
      "identity_link_conflict",
      "该身份已关联到其他不可用账户。",
    );
  }
  return {
    id: linked.id,
    email: linked.email,
    displayName: linked.display_name ?? input.displayName,
    provider: input.provider,
    walletAddress: linked.wallet_address,
  };
}

async function createAuthSession(
  db: D1Database,
  user: AuthenticatedUser,
  env: PlatformEnv,
  origin: string,
): Promise<{ cookie: string }> {
  const token = randomBase64Url(48);
  const tokenHash = await sha256Hex(token);
  const ttlDays = clampInteger(env.AUTH_SESSION_TTL_DAYS, 30, 1, 90);
  const expiresAt = new Date(
    Date.now() + ttlDays * 24 * 60 * 60_000,
  ).toISOString();
  await db.batch([
    db
      .prepare(
        `DELETE FROM auth_sessions
         WHERE user_id = ? AND datetime(expires_at) <= datetime('now')`,
      )
      .bind(user.id),
    db
      .prepare(
        `DELETE FROM auth_sessions
         WHERE user_id = ?
           AND token_hash IN (
             SELECT token_hash
             FROM auth_sessions
             WHERE user_id = ?
               AND datetime(expires_at) > datetime('now')
             ORDER BY created_at DESC
             LIMIT -1 OFFSET 9
           )`,
      )
      .bind(user.id, user.id),
    db
      .prepare(
        `INSERT INTO auth_sessions
         (token_hash, user_id, provider, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`,
      )
      .bind(tokenHash, user.id, user.provider, expiresAt),
  ]);
  return {
    cookie: authCookie(
      SESSION_COOKIE,
      token,
      ttlDays * 24 * 60 * 60,
      origin,
      "/",
    ),
  };
}

async function consumeAuthChallengeRateLimit(
  db: D1Database,
  request: Request,
  provider: "google" | "wallet",
  subject: string | null,
): Promise<void> {
  const forwardedIp = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  const ipMaterial =
    forwardedIp &&
    forwardedIp.length <= 64 &&
    !/[\u0000-\u001F\u007F]/.test(forwardedIp)
      ? forwardedIp
      : "unknown";
  const ipFingerprint = (await sha256Hex(ipMaterial)).slice(0, 24);
  const scopes: Array<[string, number]> = [
    [`auth:${provider}:global`, provider === "google" ? 120 : 180],
    [
      `auth:${provider}:ip:${ipFingerprint}`,
      ipMaterial === "unknown" ? 30 : provider === "google" ? 10 : 20,
    ],
  ];
  if (subject) {
    scopes.push([
      `auth:${provider}:subject:${(await sha256Hex(subject)).slice(0, 24)}`,
      5,
    ]);
  }
  await consumeAtomicAuthRateLimits(db, scopes);

  const capacity = subject
    ? await db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM auth_challenges
           WHERE provider = ? AND subject_hint = ?
             AND consumed_at IS NULL
             AND datetime(expires_at) > datetime('now')`,
        )
        .bind(provider, subject)
        .first<{ count: number }>()
    : await db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM auth_challenges
           WHERE provider = ?
             AND consumed_at IS NULL
             AND datetime(expires_at) > datetime('now')`,
        )
        .bind(provider)
        .first<{ count: number }>();
  const maxOutstanding = subject ? 3 : 2_000;
  if (Number(capacity?.count ?? 0) >= maxOutstanding) {
    throw new PlatformError(
      429,
      "auth_challenge_limit",
      "当前已有未完成的登录请求，请先完成或稍后重试。",
    );
  }
}

async function consumeWalletVerificationRateLimit(
  db: D1Database,
  request: Request,
  challengeId: string,
): Promise<void> {
  const forwardedIp = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  const ipMaterial =
    forwardedIp &&
    forwardedIp.length <= 64 &&
    !/[\u0000-\u001F\u007F]/.test(forwardedIp)
      ? forwardedIp
      : "unknown";
  await consumeAtomicAuthRateLimits(db, [
    ["auth:wallet-verify:global", 300],
    [
      `auth:wallet-verify:ip:${(await sha256Hex(ipMaterial)).slice(0, 24)}`,
      ipMaterial === "unknown" ? 40 : 30,
    ],
    [
      `auth:wallet-verify:challenge:${(
        await sha256Hex(challengeId)
      ).slice(0, 24)}`,
      8,
    ],
  ]);
}

async function consumeAtomicAuthRateLimits(
  db: D1Database,
  scopes: Array<[string, number]>,
): Promise<void> {
  const minuteBucket = new Date().toISOString().slice(0, 16);
  const valueSlots = scopes.map(() => "(?, ?)").join(", ");
  const parameters = scopes.flatMap(([scope, limit]) => [scope, limit]);
  const admitted = await db
    .prepare(
      `WITH requested(scope, max_count) AS (
         VALUES ${valueSlots}
       ),
       admission(minute_bucket) AS (
         SELECT ?
         WHERE NOT EXISTS (
           SELECT 1
           FROM requested r
           LEFT JOIN auth_rate_limit_buckets b
             ON b.scope = r.scope AND b.minute_bucket = ?
           WHERE COALESCE(b.request_count, 0) >= r.max_count
         )
       )
       INSERT INTO auth_rate_limit_buckets
       (scope, minute_bucket, request_count, updated_at)
       SELECT r.scope, a.minute_bucket, 1, CURRENT_TIMESTAMP
       FROM requested r
       CROSS JOIN admission a
       WHERE 1 = 1
       ON CONFLICT(scope, minute_bucket) DO UPDATE SET
         request_count = auth_rate_limit_buckets.request_count + 1,
         updated_at = CURRENT_TIMESTAMP
       RETURNING scope`,
    )
    .bind(...parameters, minuteBucket, minuteBucket)
    .all<{ scope: string }>();
  if ((admitted.results?.length ?? 0) !== scopes.length) {
    throw new PlatformError(
      429,
      "auth_rate_limit_exceeded",
      "登录请求过于频繁，请稍后重试。",
    );
  }
}

function authCookie(
  name: string,
  value: string,
  maxAge: number,
  origin: string,
  path: string,
): string {
  const parts = [
    `${name}=${value}`,
    `Path=${path}`,
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (new URL(origin).protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const values: string[] = [];
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    values.push(part.slice(separator + 1).trim());
  }
  return values.length === 1 ? values[0] || null : null;
}

function safeReturnTo(value: string | null | undefined): string {
  const fallback = "/console";
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  try {
    const parsed = new URL(value, "https://relaybase.local");
    if (
      parsed.origin !== "https://relaybase.local" ||
      parsed.pathname === "/login" ||
      parsed.pathname.startsWith("/api/auth/")
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`.slice(0, 2_000);
  } catch {
    return fallback;
  }
}

function compactIdentityName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 160) : null;
}

function randomAlphaNumeric(length: number): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let result = "";
  for (const byte of bytes) result += alphabet[byte % alphabet.length];
  return result;
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    ),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function handleDashboard(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  const db = requireDb(env);
  const user = await requireAuthenticatedUser(request, db, env);
  const readiness = await operationalReadiness(env);

  const [
    balanceResult,
    statsResult,
    keysResult,
    paymentsResult,
    callsResult,
  ] = await db.batch([
    db
      .prepare(
        `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
         FROM balance_ledger
         WHERE user_id = ?`,
      )
      .bind(user.id),
    db
      .prepare(
        `SELECT
           COUNT(*) AS calls_30d,
           COALESCE(SUM(CASE WHEN refunded = 0 THEN cost_usd_micros ELSE 0 END), 0) AS spend_30d,
           COALESCE(SUM(CASE WHEN status_code = 200 THEN 1 ELSE 0 END), 0) AS successful_30d
         FROM api_calls
         WHERE user_id = ?
           AND datetime(created_at) >= datetime('now', '-30 days')`,
      )
      .bind(user.id),
    db
      .prepare(
        `SELECT id, label, key_prefix, created_at, last_used_at, revoked_at
         FROM api_keys
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 20`,
      )
      .bind(user.id),
    db
      .prepare(
        `SELECT id, amount_usd_micros, pay_currency, pay_amount,
                pay_address, invoice_url, status, created_at, updated_at
         FROM payment_orders
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 10`,
      )
      .bind(user.id),
    db
      .prepare(
        `SELECT id, method, upstream_path, platform, status_code,
                cost_usd_micros, latency_ms, refunded, created_at
         FROM api_calls
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 20`,
      )
      .bind(user.id),
  ]);

  const balanceRow = firstResult<{ balance: number }>(balanceResult);
  const statsRow = firstResult<{
    calls_30d: number;
    spend_30d: number;
    successful_30d: number;
  }>(statsResult);
  const calls30d = Number(statsRow?.calls_30d ?? 0);
  const successful30d = Number(statsRow?.successful_30d ?? 0);

  return jsonResponse(
    {
      user: {
        email: user.email,
        displayName: user.displayName,
      },
      balanceUsdMicros: Number(balanceRow?.balance ?? 0),
      capabilities: readiness.capabilities,
      stats: {
        calls30d,
        spend30dUsdMicros: Number(statsRow?.spend_30d ?? 0),
        successRate:
          calls30d === 0
            ? 1
            : Math.round((successful30d / calls30d) * 10000) / 10000,
      },
      keys: resultRows<{
        id: string;
        label: string;
        key_prefix: string;
        created_at: string;
        last_used_at: string | null;
        revoked_at: string | null;
      }>(keysResult).map((row) => ({
        id: row.id,
        label: row.label,
        prefix: row.key_prefix,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at,
      })),
      payments: resultRows<{
        id: string;
        amount_usd_micros: number;
        pay_currency: string;
        pay_amount: string | null;
        pay_address: string | null;
        invoice_url: string | null;
        status: string;
        created_at: string;
        updated_at: string;
      }>(paymentsResult).map((row) => ({
        id: row.id,
        amountUsdMicros: row.amount_usd_micros,
        payCurrency: row.pay_currency,
        payAmount: row.pay_amount,
        payAddress: row.pay_address,
        invoiceUrl: safeInvoiceUrl(row.invoice_url),
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      calls: resultRows<{
        id: string;
        method: string;
        upstream_path: string;
        platform: string;
        status_code: number;
        cost_usd_micros: number;
        latency_ms: number;
        refunded: number;
        created_at: string;
      }>(callsResult).map((row) => ({
        id: row.id,
        method: row.method,
        path: row.upstream_path,
        platform: row.platform,
        statusCode: row.status_code,
        costUsdMicros: row.cost_usd_micros,
        refunded: row.refunded === 1,
        latencyMs: row.latency_ms,
        createdAt: row.created_at,
      })),
    },
    200,
    requestId,
  );
}

async function handleCreateApiKey(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  const db = requireDb(env);
  const user = await requireAuthenticatedUser(request, db, env);
  const body = await readJsonBody<{ label?: unknown }>(
    request,
    MAX_DASHBOARD_BODY_BYTES,
  );
  const label = sanitizeLabel(body.label);

  const id = `key_${randomBase64Url(12)}`;
  const secret = `rb_live_${randomBase64Url(32)}`;
  const keyHash = await sha256Hex(secret);
  const prefix = `${secret.slice(0, 16)}…`;
  const rateLimit = clampInteger(env.API_RATE_LIMIT_RPM, 60, 1, 600);
  const createdAt = new Date().toISOString();

  const inserted = await db
    .prepare(
      `INSERT INTO api_keys
       (id, user_id, label, key_prefix, key_hash, rate_limit_rpm, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE (
         SELECT COUNT(*)
         FROM api_keys
         WHERE user_id = ? AND revoked_at IS NULL
       ) < 5`,
    )
    .bind(
      id,
      user.id,
      label,
      prefix,
      keyHash,
      rateLimit,
      createdAt,
      user.id,
    )
    .run();
  if (Number(inserted.meta?.changes ?? 0) !== 1) {
    throw new PlatformError(
      409,
      "api_key_limit",
      "每个账户最多保留 5 个有效 API Key。",
    );
  }

  return jsonResponse(
    {
      key: {
        id,
        label,
        prefix,
        secret,
        createdAt,
      },
    },
    201,
    requestId,
  );
}

async function handleRevokeApiKey(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  const db = requireDb(env);
  const user = await requireAuthenticatedUser(request, db, env);
  const body = await readJsonBody<{ id?: unknown }>(
    request,
    MAX_DASHBOARD_BODY_BYTES,
  );
  if (typeof body.id !== "string" || !/^key_[A-Za-z0-9_-]+$/.test(body.id)) {
    throw new PlatformError(400, "invalid_key_id", "API Key 编号无效。");
  }

  const result = await db
    .prepare(
      `UPDATE api_keys
       SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
       WHERE id = ? AND user_id = ?`,
    )
    .bind(body.id, user.id)
    .run();
  if (Number(result.meta?.changes ?? 0) === 0) {
    throw new PlatformError(404, "key_not_found", "没有找到这个 API Key。");
  }

  return jsonResponse({ ok: true }, 200, requestId);
}

async function handleCreatePayment(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  if (
    env.CRYPTO_PAYMENTS_ENABLED !== "true" ||
    env.LEGAL_REVIEW_CONFIRMED !== "true"
  ) {
    throw new PlatformError(
      503,
      "payments_in_sandbox",
      "真实加密充值尚未启用；完成商户审核与法律审查后方可开放。",
    );
  }
  const readiness = await operationalReadiness(env);
  if (!readiness.capabilities.schemaReady) {
    throw new PlatformError(
      503,
      "database_migrations_required",
      "数据库迁移尚未完成，暂不接受充值。",
    );
  }
  if (!readiness.capabilities.proxyEnabled) {
    throw new PlatformError(
      503,
      "service_not_ready",
      "数据代理尚未完成授权与配置，暂不接受充值。",
    );
  }
  if ((env.PAYMENT_PROVIDER ?? "nowpayments") !== "nowpayments") {
    throw new PlatformError(
      503,
      "payment_provider_unavailable",
      "当前支付服务商尚未配置。",
    );
  }

  const apiKey = env.NOWPAYMENTS_API_KEY;
  if (!apiKey || !env.NOWPAYMENTS_IPN_SECRET) {
    throw new PlatformError(
      503,
      "payment_provider_unavailable",
      "支付服务商密钥或回调验证密钥尚未配置。",
    );
  }

  const db = requireDb(env);
  const user = await requireAuthenticatedUser(request, db, env);
  const idempotencyKey = requireIdempotencyKey(request);
  const idempotencyHash = await sha256Hex(
    `${user.id}:${idempotencyKey}`,
  );
  const body = await readJsonBody<{
    amountUsd?: unknown;
    payCurrency?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const amountUsd =
    typeof body.amountUsd === "number" &&
    Number.isSafeInteger(body.amountUsd)
      ? body.amountUsd
      : Number.NaN;
  const payCurrency =
    typeof body.payCurrency === "string"
      ? body.payCurrency.trim().toLowerCase()
      : "";
  if (!PAYMENT_AMOUNTS.has(amountUsd)) {
    throw new PlatformError(
      400,
      "invalid_payment_amount",
      "充值金额仅支持 10、25、50 或 100 美元。",
    );
  }
  if (!PAYMENT_CURRENCIES.has(payCurrency)) {
    throw new PlatformError(
      400,
      "invalid_payment_currency",
      "请选择受支持的币种和网络。",
    );
  }

  const existingOrder = await paymentOrderByIdempotency(
    db,
    user.id,
    idempotencyHash,
  );
  if (existingOrder) {
    if (
      existingOrder.amount_usd_micros !== amountUsd * 1_000_000 ||
      existingOrder.pay_currency.toLowerCase() !== payCurrency
    ) {
      throw new PlatformError(
        409,
        "idempotency_payload_conflict",
        "该 Idempotency-Key 已用于不同金额或币种的充值单。",
      );
    }
    return paymentOrderResponse(existingOrder, 200, requestId);
  }
  if (!readiness.capabilities.catalogReady) {
    throw new PlatformError(
      503,
      "catalog_not_ready",
      "当前尚无已审核并开放的接口，暂不接受充值。",
    );
  }
  if (!readiness.ready) {
    throw new PlatformError(
      503,
      "service_not_ready",
      "支付管理、自动对账或运行配置尚未就绪，暂不接受充值。",
    );
  }

  await consumePaymentCreateRateLimit(db, user.id, env);
  const pending = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM payment_orders
       WHERE user_id = ?
         AND status NOT IN (
           'finished', 'refunded', 'failed', 'expired',
           'provider_error', 'manual_resolved'
         )
         AND datetime(created_at) >= datetime('now', '-24 hours')`,
    )
    .bind(user.id)
    .first<{ count: number }>();
  if (Number(pending?.count ?? 0) >= 3) {
    throw new PlatformError(
      409,
      "too_many_pending_payments",
      "你已有 3 个待处理充值单，请先完成、等待确认或联系支持处理。",
    );
  }

  const orderId = `pay_${randomBase64Url(16)}`;
  const amountUsdMicros = amountUsd * 1_000_000;
  const appOrigin = canonicalAppOrigin(request, env);
  const createdAt = new Date().toISOString();

  try {
    await db
      .prepare(
        `INSERT INTO payment_orders
         (id, user_id, provider, idempotency_hash, amount_usd_micros,
          pay_currency, status, created_at, updated_at)
         VALUES (?, ?, 'nowpayments', ?, ?, ?, 'creating', ?, ?)`,
      )
      .bind(
        orderId,
        user.id,
        idempotencyHash,
        amountUsdMicros,
        payCurrency,
        createdAt,
        createdAt,
      )
      .run();
  } catch {
    const racedOrder = await paymentOrderByIdempotency(
      db,
      user.id,
      idempotencyHash,
    );
    if (racedOrder) {
      if (
        racedOrder.amount_usd_micros !== amountUsdMicros ||
        racedOrder.pay_currency.toLowerCase() !== payCurrency
      ) {
        throw new PlatformError(
          409,
          "idempotency_payload_conflict",
          "该 Idempotency-Key 已用于不同金额或币种的充值单。",
        );
      }
      return paymentOrderResponse(racedOrder, 200, requestId);
    }
    throw new PlatformError(
      409,
      "payment_creation_conflict",
      "充值单正在创建，请使用同一 Idempotency-Key 重试。",
    );
  }

  let payment: NowPaymentsPayment;
  try {
    payment = await createNowPaymentsPayment(apiKey, {
      amountUsd,
      payCurrency,
      orderId,
      appOrigin,
    });
  } catch (error) {
    await db
      .prepare(
        `UPDATE payment_orders
         SET status = 'provider_error', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(orderId)
      .run();
    throw error;
  }

  const providerPaymentId = String(payment.payment_id ?? "");

  const update = await db
    .prepare(
      `UPDATE payment_orders
       SET provider_payment_id = ?, pay_amount = ?, pay_address = ?,
           invoice_url = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND provider_payment_id IS NULL`,
    )
    .bind(
      providerPaymentId,
      String(payment.pay_amount ?? ""),
      payment.pay_address ?? null,
      payment.invoice_url ?? null,
      payment.payment_status ?? "waiting",
      orderId,
    )
    .run();
  if (Number(update.meta?.changes ?? 0) !== 1) {
    throw new PlatformError(
      409,
      "payment_creation_conflict",
      "充值单已被其他请求更新，请使用同一 Idempotency-Key 查询。",
    );
  }

  const createdOrder = await paymentOrderById(db, orderId, user.id);
  if (!createdOrder) {
    throw new PlatformError(
      500,
      "payment_record_missing",
      "充值单已创建但本地记录暂时不可用，请使用同一 Idempotency-Key 重试。",
    );
  }
  return paymentOrderResponse(createdOrder, 201, requestId);
}

async function handleNowPaymentsWebhook(
  request: Request,
  env: PlatformEnv,
  ctx: WorkerExecutionContext,
  requestId: string,
): Promise<Response> {
  const ipnSecret = env.NOWPAYMENTS_IPN_SECRET;
  const apiKey = env.NOWPAYMENTS_API_KEY;
  if (!ipnSecret || !apiKey) {
    throw new PlatformError(
      503,
      "payment_provider_unavailable",
      "支付回调尚未配置。",
    );
  }

  const rawBody = await readBodyText(request, MAX_WEBHOOK_BODY_BYTES);
  let payload: NowPaymentsPayment;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!isPlainRecord(parsed)) {
      throw new Error("Webhook payload must be an object");
    }
    if (containsUnsafeJsonNumber(parsed)) {
      throw new Error("Webhook payload contains an unsafe number");
    }
    payload = parsed as NowPaymentsPayment;
  } catch {
    throw new PlatformError(400, "invalid_webhook", "支付回调格式无效。");
  }

  const signature = request.headers.get("x-nowpayments-sig") ?? "";
  const expectedSignature = await hmacSha512Hex(
    ipnSecret,
    JSON.stringify(sortObjectDeep(payload)),
  );
  if (!constantTimeEqual(signature.toLowerCase(), expectedSignature)) {
    throw new PlatformError(
      401,
      "invalid_webhook_signature",
      "支付回调签名无效。",
    );
  }

  const paymentId = String(payload.payment_id ?? "");
  const payloadOrderId =
    typeof payload.order_id === "string" ? payload.order_id.trim() : "";
  const parentPaymentId = String(payload.parent_payment_id ?? "").trim();
  const paymentStatus =
    typeof payload.payment_status === "string"
      ? payload.payment_status.trim().toLowerCase()
      : "";
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(paymentId) ||
    !/^[a-z_]{1,64}$/.test(paymentStatus) ||
    (!/^pay_[A-Za-z0-9_-]+$/.test(payloadOrderId) &&
      !/^[A-Za-z0-9_-]{1,128}$/.test(parentPaymentId))
  ) {
    throw new PlatformError(400, "invalid_webhook", "支付回调缺少订单信息。");
  }

  const db = requireDb(env);
  let orderId = payloadOrderId;
  if (!/^pay_[A-Za-z0-9_-]+$/.test(orderId)) {
    const parentOrder = await db
      .prepare(
        `SELECT id
         FROM payment_orders
         WHERE provider = 'nowpayments' AND provider_payment_id = ?
         LIMIT 1`,
      )
      .bind(parentPaymentId)
      .first<{ id: string }>();
    if (!parentOrder) {
      throw new PlatformError(
        404,
        "payment_not_found",
        "重复入金对应的原充值单不存在。",
      );
    }
    orderId = parentOrder.id;
  }
  const canonicalPayload = JSON.stringify(sortObjectDeep(payload));
  const payloadHash = await sha256Hex(canonicalPayload);
  const eventId = `evt_${payloadHash.slice(0, 40)}`;
  const storedEvent = await db
    .prepare(
      `INSERT OR IGNORE INTO payment_events
       (id, provider, provider_payment_id, order_id, payment_status,
        payload_json, payload_hash, received_at, next_attempt_at)
       VALUES (?, 'nowpayments', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP,
               CURRENT_TIMESTAMP)`,
    )
    .bind(
      eventId,
      paymentId,
      orderId,
      paymentStatus,
      canonicalPayload,
      payloadHash,
    )
    .run();

  let shouldProcess = Number(storedEvent.meta?.changes ?? 0) === 1;
  if (!shouldProcess) {
    const existingEvent = await db
      .prepare(
        `SELECT processed_at, processing_error,
                datetime(next_attempt_at) <= datetime('now') AS retry_due
         FROM payment_events
         WHERE id = ?`,
      )
      .bind(eventId)
      .first<{
        processed_at: string | null;
        processing_error: string | null;
        retry_due: number;
      }>();
    shouldProcess =
      existingEvent?.processed_at == null &&
      Boolean(existingEvent?.processing_error) &&
      existingEvent?.retry_due === 1;
  }
  if (shouldProcess) {
    ctx.waitUntil(
      processNowPaymentsEvent(db, apiKey, {
        eventId,
        paymentId,
        orderId,
        requestId,
      }),
    );
  }
  return paymentWebhookAck(requestId);
}

async function processNowPaymentsEvent(
  db: D1Database,
  apiKey: string,
  input: {
    eventId: string;
    paymentId: string;
    orderId: string;
    requestId: string;
  },
): Promise<void> {
  try {
    const verified = await getNowPaymentsPayment(apiKey, input.paymentId);
    await applyVerifiedNowPayment(db, verified, input);
    await db
      .prepare(
        `UPDATE payment_events
         SET processed_at = CURRENT_TIMESTAMP, processing_error = NULL,
             last_attempt_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(input.eventId)
      .run();
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "unknown error";
    await db
      .prepare(
        `UPDATE payment_events
         SET processing_error = ?,
             attempt_count = attempt_count + 1,
             last_attempt_at = CURRENT_TIMESTAMP,
             next_attempt_at = datetime(
               'now',
               CASE
                 WHEN attempt_count >= 5 THEN '+1 hour'
                 WHEN attempt_count >= 2 THEN '+15 minutes'
                 ELSE '+2 minutes'
               END
             )
         WHERE id = ? AND processed_at IS NULL`,
      )
      .bind(message, input.eventId)
      .run();
    console.error("NOWPayments event processing failed", {
      requestId: input.requestId,
      eventId: input.eventId,
      orderId: input.orderId,
      paymentId: input.paymentId,
      error: message,
    });
  }
}

async function applyVerifiedNowPayment(
  db: D1Database,
  verified: NowPaymentsPayment,
  input: {
    paymentId: string;
    orderId: string;
    requestId: string;
    allowManualReviewRecovery?: boolean;
  },
): Promise<void> {
  if (String(verified.payment_id ?? "") !== input.paymentId) {
    throw new PlatformError(
      409,
      "payment_order_mismatch",
      "支付订单信息不匹配。",
    );
  }

  const order = await paymentOrderById(db, input.orderId);
  if (!order) {
    throw new PlatformError(404, "payment_not_found", "支付订单不存在。");
  }
  const parentPaymentId = String(
    verified.parent_payment_id ?? "",
  ).trim();
  const isBoundChild =
    Boolean(parentPaymentId) &&
    order.provider_payment_id != null &&
    parentPaymentId === order.provider_payment_id &&
    (verified.order_id == null ||
      verified.order_id === "" ||
      verified.order_id === input.orderId);
  if (!isBoundChild && verified.order_id !== input.orderId) {
    throw new PlatformError(
      409,
      "payment_order_mismatch",
      "支付订单信息不匹配。",
    );
  }
  const status =
    typeof verified.payment_status === "string"
      ? verified.payment_status.trim().toLowerCase()
      : "";
  const actualPaidPositive =
    normalizedPositiveDecimal(verified.actually_paid) != null;
  const exactReview = await db
    .prepare(
      `SELECT id, status, reason, resolution_action
       FROM payment_review_cases
       WHERE order_id = ? AND provider_payment_id = ?
       LIMIT 1`,
    )
    .bind(input.orderId, input.paymentId)
    .first<{
      id: string;
      status: string;
      reason: string;
      resolution_action: string | null;
    }>();
  const exactRejectedReview =
    exactReview?.status === "resolved" &&
    exactReview.resolution_action === "reject";
  if (isBoundChild && status === "refunded") {
    await reversePaymentReviewCredits(
      db,
      input.orderId,
      input.paymentId,
    );
    return;
  }
  if (
    isBoundChild
  ) {
    if (exactRejectedReview) {
      if (actualPaidPositive) {
        await persistPaymentReviewCase(db, {
          orderId: input.orderId,
          providerPaymentId: input.paymentId,
          parentPaymentId,
          reason: "funds_after_manual_rejection",
          verified,
        });
      }
      return;
    }
    await persistPaymentReviewCase(db, {
      orderId: input.orderId,
      providerPaymentId: input.paymentId,
      parentPaymentId,
      reason: "repeated_deposit",
      verified,
    });
    console.warn("Repeated deposit moved to manual review", {
      requestId: input.requestId,
      orderId: input.orderId,
      paymentId: input.paymentId,
      parentPaymentId,
    });
    return;
  }
  if (
    order.provider_payment_id != null &&
    order.provider_payment_id !== input.paymentId
  ) {
    throw new PlatformError(
      409,
      "payment_order_mismatch",
      "支付服务商订单编号不匹配。",
    );
  }
  if (status === "refunded") {
    await reversePaymentReviewCredits(
      db,
      input.orderId,
      input.paymentId,
    );
    await reverseOriginalPaymentCredit(
      db,
      input.orderId,
      input.paymentId,
    );
    return;
  }

  if (exactReview?.status === "open") {
    await persistPaymentReviewCase(db, {
      orderId: input.orderId,
      providerPaymentId: input.paymentId,
      parentPaymentId: parentPaymentId || null,
      reason: exactReview.reason,
      verified,
    });
    return;
  }
  if (exactRejectedReview) {
    if (actualPaidPositive) {
      await persistPaymentReviewCase(db, {
        orderId: input.orderId,
        providerPaymentId: input.paymentId,
        parentPaymentId: parentPaymentId || null,
        reason: "funds_after_manual_rejection",
        verified,
      });
    }
    return;
  }
  if (order.status === "manual_resolved") return;
  const verifiedUsdMicros = parseUsdMicros(verified.price_amount);
  const currencyMatches =
    typeof verified.pay_currency === "string" &&
    verified.pay_currency.toLowerCase() === order.pay_currency.toLowerCase();
  const priceCurrencyMatches =
    typeof verified.price_currency === "string" &&
    verified.price_currency.toLowerCase() === "usd";
  const priceMatches = verifiedUsdMicros === order.amount_usd_micros;
  const providerPayAmount = normalizedPositiveDecimal(verified.pay_amount);
  const expectedPayAmount =
    normalizedPositiveDecimal(order.pay_amount) ?? providerPayAmount;
  const actualCoversExpected =
    expectedPayAmount != null &&
    verified.actually_paid != null &&
    compareDecimalAmounts(verified.actually_paid, expectedPayAmount) >= 0;
  const materiallyOverpaid =
    expectedPayAmount != null &&
    verified.actually_paid != null &&
    isMaterialOverpayment(verified.actually_paid, expectedPayAmount);
  const invoiceUrl = safeInvoiceUrl(
    typeof verified.invoice_url === "string" ? verified.invoice_url : null,
  );
  const payAddress =
    typeof verified.pay_address === "string" &&
    verified.pay_address.length >= 8 &&
    verified.pay_address.length <= 256
      ? verified.pay_address
      : null;

  if (
    !NOWPAYMENTS_STATUSES.has(status) ||
    !currencyMatches ||
    !priceCurrencyMatches ||
    !priceMatches ||
    providerPayAmount == null ||
    (status === "finished" && !actualCoversExpected) ||
    (status === "finished" && materiallyOverpaid) ||
    status === "partially_paid" ||
    ((status === "failed" || status === "expired") && actualPaidPositive)
  ) {
    const reason =
      status === "partially_paid"
        ? "partially_paid"
        : (status === "failed" || status === "expired") &&
            actualPaidPositive
          ? "terminal_with_funds"
          : status === "finished" && materiallyOverpaid
            ? "overpaid_finished"
          : status === "finished" && !actualCoversExpected
            ? "underpaid_finished"
            : "provider_data_mismatch";
    await persistPaymentReviewCase(db, {
      orderId: input.orderId,
      providerPaymentId: input.paymentId,
      parentPaymentId: parentPaymentId || null,
      reason,
      verified,
    });
    console.warn("Payment moved to manual review", {
      requestId: input.requestId,
      orderId: input.orderId,
      paymentId: input.paymentId,
      status,
      currencyMatches,
      priceCurrencyMatches,
      priceMatches,
      actualCoversExpected,
      materiallyOverpaid,
    });
    return;
  }

  if (order.provider_payment_id == null) {
    const binding = await db
      .prepare(
        `UPDATE payment_orders
         SET provider_payment_id = ?, pay_amount = ?,
             pay_address = COALESCE(pay_address, ?),
             invoice_url = COALESCE(invoice_url, ?),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND provider_payment_id IS NULL
           AND (
             status IN ('creating', 'provider_error', 'waiting', 'confirming',
                        'confirmed', 'sending', 'partially_paid')
             OR (status = 'manual_review' AND ? = 1)
           )`,
      )
      .bind(
        input.paymentId,
        providerPayAmount,
        payAddress,
        invoiceUrl,
        input.orderId,
        input.allowManualReviewRecovery ? 1 : 0,
      )
      .run();
    if (Number(binding.meta?.changes ?? 0) !== 1) {
      const rebound = await paymentOrderById(db, input.orderId);
      if (rebound?.provider_payment_id !== input.paymentId) {
        throw new PlatformError(
          409,
          "payment_binding_conflict",
          "支付订单绑定发生冲突，已停止自动入账。",
        );
      }
    }
  }

  const updatedAt = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];

  if (status === "finished") {
    statements.push(
      db
        .prepare(
          `UPDATE payment_orders
           SET status = 'finished', pay_amount = ?,
               pay_address = COALESCE(pay_address, ?),
               invoice_url = COALESCE(invoice_url, ?),
               updated_at = ?
           WHERE id = ?
             AND status NOT IN ('refunded', 'manual_resolved')
             AND (status != 'manual_review' OR ? = 1)
             AND NOT EXISTS (
               SELECT 1
               FROM payment_review_cases r
               JOIN balance_ledger l
                 ON l.reference_id =
                    'nowpayments-review:' || r.id || ':credit'
               WHERE r.order_id = payment_orders.id
                 AND r.provider_payment_id = ?
                 AND l.delta_usd_micros > 0
             )`,
        )
        .bind(
          providerPayAmount,
          payAddress,
          invoiceUrl,
          updatedAt,
          input.orderId,
          input.allowManualReviewRecovery ? 1 : 0,
          input.paymentId,
        ),
      db
        .prepare(
          `INSERT OR IGNORE INTO balance_ledger
           (id, user_id, entry_type, delta_usd_micros, reference_id, description, created_at)
           SELECT ?, user_id, 'payment_credit', amount_usd_micros, ?,
                  'Stablecoin balance top-up', ?
           FROM payment_orders
           WHERE id = ? AND status = 'finished'
             AND NOT EXISTS (
               SELECT 1
               FROM payment_review_cases r
               JOIN balance_ledger l
                 ON l.reference_id =
                    'nowpayments-review:' || r.id || ':credit'
               WHERE r.order_id = payment_orders.id
                 AND r.provider_payment_id = ?
                 AND l.delta_usd_micros > 0
             )`,
        )
        .bind(
          `led_${randomBase64Url(16)}`,
          `nowpayments:${input.paymentId}:credit`,
          updatedAt,
          input.orderId,
          input.paymentId,
        ),
      db
        .prepare(
          `UPDATE payment_orders
           SET credited_usd_micros = amount_usd_micros, updated_at = ?
           WHERE id = ? AND status = 'finished'`,
        )
        .bind(updatedAt, input.orderId),
    );
  } else {
    statements.push(
      db
        .prepare(
          `UPDATE payment_orders
           SET status = ?, pay_amount = ?,
               pay_address = COALESCE(pay_address, ?),
               invoice_url = COALESCE(invoice_url, ?),
               updated_at = ?
           WHERE id = ?
             AND status NOT IN ('finished', 'refunded', 'manual_review')`,
        )
        .bind(
          status,
          providerPayAmount,
          payAddress,
          invoiceUrl,
          updatedAt,
          input.orderId,
        ),
    );
  }

  await db.batch(statements);
}

async function reverseOriginalPaymentCredit(
  db: D1Database,
  orderId: string,
  paymentId: string,
): Promise<void> {
  const creditReference = `nowpayments:${paymentId}:credit`;
  const reversalReference = `nowpayments:${paymentId}:reversal`;
  await db.batch([
    db
      .prepare(
        `UPDATE payment_orders
         SET status = 'refunded', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(orderId),
    db
      .prepare(
        `INSERT OR IGNORE INTO balance_ledger
         (id, user_id, entry_type, delta_usd_micros, reference_id,
          description, created_at)
         SELECT ?, user_id, 'payment_reversal', -delta_usd_micros, ?,
                'Stablecoin payment refunded', CURRENT_TIMESTAMP
         FROM balance_ledger
         WHERE reference_id = ? AND delta_usd_micros > 0
         LIMIT 1`,
      )
      .bind(
        `led_${randomBase64Url(16)}`,
        reversalReference,
        creditReference,
      ),
    paymentCreditedRecalculation(db, orderId),
  ]);
}

async function reversePaymentReviewCredits(
  db: D1Database,
  orderId: string,
  providerPaymentId: string,
): Promise<void> {
  const cases = await db
    .prepare(
      `SELECT id
       FROM payment_review_cases
       WHERE order_id = ? AND provider_payment_id = ?`,
    )
    .bind(orderId, providerPaymentId)
    .all<{ id: string }>();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE payment_review_cases
         SET status = 'resolved',
             resolution_action = CASE
               WHEN resolution_action = 'credit'
                 THEN 'credited_then_refunded'
               WHEN resolution_action IS NULL
                 THEN 'refund_confirmed'
               ELSE resolution_action
             END,
             resolution_note = CASE
               WHEN resolution_action = 'credit'
                 THEN substr(
                   COALESCE(resolution_note || ' · ', '') ||
                   'Provider-confirmed refund reversed the review credit',
                   1, 500
                 )
               ELSE COALESCE(
                 resolution_note,
                 'Provider-confirmed refund processed automatically'
               )
             END,
             resolution_reference =
               'nowpayments-review:' || id || ':reversal',
             resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)
         WHERE order_id = ? AND provider_payment_id = ?`,
      )
      .bind(orderId, providerPaymentId),
  ];
  for (const reviewCase of cases.results ?? []) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO balance_ledger
           (id, user_id, entry_type, delta_usd_micros, reference_id,
            description, created_at)
           SELECT ?, user_id, 'payment_review_reversal',
                  -delta_usd_micros, ?,
                  'Operator-reviewed payment refunded', CURRENT_TIMESTAMP
           FROM balance_ledger
           WHERE reference_id = ? AND delta_usd_micros > 0
           LIMIT 1`,
        )
        .bind(
          `led_${randomBase64Url(16)}`,
          `nowpayments-review:${reviewCase.id}:reversal`,
          `nowpayments-review:${reviewCase.id}:credit`,
        ),
    );
  }
  statements.push(
    paymentCreditedRecalculation(db, orderId),
    db
      .prepare(
        `UPDATE payment_orders
         SET status = CASE
               WHEN EXISTS (
                 SELECT 1 FROM payment_review_cases
                 WHERE order_id = ? AND status = 'open'
               ) THEN 'manual_review'
               ELSE 'manual_resolved'
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status != 'refunded'`,
      )
      .bind(orderId, orderId),
  );
  await db.batch(statements);
}

function paymentCreditedRecalculation(
  db: D1Database,
  orderId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE payment_orders
       SET credited_usd_micros = (
             SELECT COALESCE(SUM(l.delta_usd_micros), 0)
             FROM balance_ledger l
             WHERE l.reference_id IN (
                     'nowpayments:' ||
                     COALESCE(payment_orders.provider_payment_id, '') ||
                     ':credit',
                     'nowpayments:' ||
                     COALESCE(payment_orders.provider_payment_id, '') ||
                     ':reversal'
                   )
                OR EXISTS (
                  SELECT 1
                  FROM payment_review_cases r
                  WHERE r.order_id = payment_orders.id
                    AND l.reference_id IN (
                      'nowpayments-review:' || r.id || ':credit',
                      'nowpayments-review:' || r.id || ':reversal'
                    )
                )
           ),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(orderId);
}

async function persistPaymentReviewCase(
  db: D1Database,
  input: {
    orderId: string;
    providerPaymentId: string;
    parentPaymentId: string | null;
    reason: string;
    verified: NowPaymentsPayment;
  },
): Promise<void> {
  const evidence = JSON.stringify({
    observationId: `obs_${randomBase64Url(12)}`,
    paymentId: String(input.verified.payment_id ?? "").slice(0, 128),
    parentPaymentId: input.parentPaymentId?.slice(0, 128) ?? null,
    orderId:
      typeof input.verified.order_id === "string"
        ? input.verified.order_id.slice(0, 160)
        : null,
    paymentStatus:
      typeof input.verified.payment_status === "string"
        ? input.verified.payment_status.slice(0, 64)
        : null,
    priceAmount: safeEvidenceScalar(input.verified.price_amount),
    priceCurrency:
      typeof input.verified.price_currency === "string"
        ? input.verified.price_currency.slice(0, 32)
        : null,
    payAmount: safeEvidenceScalar(input.verified.pay_amount),
    actuallyPaid: safeEvidenceScalar(input.verified.actually_paid),
    payCurrency:
      typeof input.verified.pay_currency === "string"
        ? input.verified.pay_currency.slice(0, 32)
        : null,
  });
  await db.batch([
    db
      .prepare(
        `INSERT INTO payment_review_cases
         (id, order_id, provider_payment_id, parent_payment_id, reason,
          status, actually_paid, pay_currency, evidence_json, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(provider_payment_id) DO UPDATE SET
           parent_payment_id = excluded.parent_payment_id,
           reason = excluded.reason,
           status = 'open',
           actually_paid = excluded.actually_paid,
           pay_currency = excluded.pay_currency,
           evidence_json = excluded.evidence_json,
           resolution_action = NULL,
           resolution_credit_usd_micros = NULL,
           resolution_request_hash = NULL,
           resolution_note = NULL,
           resolution_reference = NULL,
           resolved_at = NULL
         WHERE (
             payment_review_cases.status = 'open'
             OR (
               payment_review_cases.status = 'resolved'
               AND payment_review_cases.resolution_action = 'reject'
               AND ? = 1
             )
           )
           AND payment_review_cases.order_id = excluded.order_id`,
      )
      .bind(
        `prv_${randomBase64Url(18)}`,
        input.orderId,
        input.providerPaymentId,
        input.parentPaymentId,
        input.reason,
        safeEvidenceScalar(input.verified.actually_paid),
        typeof input.verified.pay_currency === "string"
          ? input.verified.pay_currency.slice(0, 32)
          : null,
        evidence,
        normalizedPositiveDecimal(input.verified.actually_paid) != null
          ? 1
          : 0,
      ),
    db
      .prepare(
        `UPDATE payment_orders
         SET status = 'manual_review', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status != 'refunded'
           AND EXISTS (
             SELECT 1 FROM payment_review_cases
             WHERE provider_payment_id = ? AND status = 'open'
           )`,
      )
      .bind(input.orderId, input.providerPaymentId),
  ]);
}

function safeEvidenceScalar(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text || text.length > 128 || /[\u0000-\u001F\u007F]/.test(text)) {
    return null;
  }
  return text;
}

async function handleProxyRequest(
  request: Request,
  env: PlatformEnv,
  ctx: WorkerExecutionContext,
  requestId: string,
): Promise<Response> {
  const readiness = await operationalReadiness(env);
  if (
    readiness.capabilities.databaseConfigured &&
    !readiness.capabilities.schemaReady
  ) {
    throw new PlatformError(
      503,
      "service_not_ready",
      "数据库迁移尚未完成，已停止真实调用与扣费。",
    );
  }
  if (!readiness.capabilities.proxyEnabled) {
    throw new PlatformError(
      503,
      "upstream_not_authorized",
      "上游转售尚未启用；需先完成 TikHub 经销/白标授权并配置服务端密钥。",
    );
  }
  if (
    !readiness.capabilities.reconciliationConfigured ||
    !readiness.capabilities.catalogReady
  ) {
    throw new PlatformError(
      503,
      "service_not_ready",
      "计费数据库、接口目录或自动对账尚未就绪，已停止真实调用。",
    );
  }
  const db = requireDb(env);
  if (request.method !== "GET" && request.method !== "POST") {
    throw new PlatformError(
      405,
      "method_not_allowed",
      "仅支持目录中经过审核的 GET 或 POST 数据查询。",
    );
  }

  const url = new URL(request.url);
  validateProxyPath(url.pathname);
  let reconciliationRecent = false;
  try {
    const heartbeat = await db
      .prepare(
        `SELECT EXISTS(
           SELECT 1 FROM operation_heartbeats
           WHERE name = 'reconciliation'
             AND datetime(last_success_at) >
                 datetime('now', '-5 minutes')
         ) AS recent`,
      )
      .first<{ recent: number }>();
    reconciliationRecent = Number(heartbeat?.recent ?? 0) === 1;
  } catch {
    throw new PlatformError(
      503,
      "service_not_ready",
      "数据库迁移尚未完成，已停止真实调用与扣费。",
    );
  }
  if (!reconciliationRecent) {
    throw new PlatformError(
      503,
      "reconciliation_stale",
      "自动对账心跳已超时，已停止真实调用与扣费。",
    );
  }
  let catalog: CatalogRecord | null;
  try {
    catalog = await db
      .prepare(
        `SELECT path, platform, http_method, upstream_price_usd_micros,
                customer_price_usd_micros, price_verified,
                enabled, read_only, sync_generation,
                (SELECT request_count
                 FROM upstream_rate_limit_buckets LIMIT 1)
                  AS _upstream_rate_limit_schema,
                (SELECT request_count
                 FROM payment_rate_limit_buckets LIMIT 1)
                  AS _payment_rate_limit_schema,
                (SELECT next_attempt_at FROM payment_events LIMIT 1)
                  AS _payment_events_schema,
                (SELECT generation FROM catalog_sync_locks LIMIT 1)
                  AS _catalog_sync_locks_schema,
                (SELECT last_success_generation
                 FROM catalog_sync_state LIMIT 1)
                  AS _catalog_sync_state_schema,
                (SELECT generation FROM catalog_sync_staging LIMIT 1)
                  AS _catalog_sync_staging_schema,
                (SELECT idempotency_hash FROM payment_orders LIMIT 1)
                  AS _payment_idempotency_schema,
                (SELECT upstream_cost_usd_micros FROM api_calls LIMIT 1)
                  AS _upstream_cost_schema,
                (SELECT sync_generation FROM endpoint_catalog LIMIT 1)
                  AS _sync_generation_schema
         FROM endpoint_catalog
         WHERE path = ?
           AND price_verified = 1
           AND sync_generation = (
             SELECT last_success_generation
             FROM catalog_sync_state
             WHERE id = 1
           )`,
      )
      .bind(url.pathname)
      .first<CatalogRecord>();
  } catch {
    throw new PlatformError(
      503,
      "service_not_ready",
      "数据库迁移尚未完成，已停止真实调用与扣费。",
    );
  }
  if (!catalog || catalog.enabled !== 1 || catalog.read_only !== 1) {
    throw new PlatformError(
      404,
      "endpoint_not_enabled",
      "该端点尚未通过只读与价格审核。",
    );
  }
  if (request.method !== catalog.http_method) {
    throw new PlatformError(
      405,
      "method_not_allowed",
      `该端点仅允许 ${catalog.http_method} 请求。`,
    );
  }
  let upstreamBody: string | undefined;
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      throw new PlatformError(
        415,
        "unsupported_media_type",
        "POST 数据查询仅接受 application/json 请求体。",
      );
    }
    upstreamBody = await readBodyText(request, MAX_PROXY_BODY_BYTES);
    try {
      const parsed = JSON.parse(upstreamBody) as unknown;
      if (
        (!isPlainRecord(parsed) && !Array.isArray(parsed)) ||
        containsUnsafeJsonNumber(parsed)
      ) {
        throw new Error("unsafe json");
      }
    } catch {
      throw new PlatformError(
        400,
        "invalid_json",
        "POST 请求体必须是有效的 JSON 对象或数组。",
      );
    }
  }

  const secret = bearerToken(request);
  if (!secret || !secret.startsWith("rb_live_")) {
    throw new PlatformError(
      401,
      "invalid_api_key",
      "请使用 Authorization: Bearer rb_live_… 提供 API Key。",
    );
  }
  const keyHash = await sha256Hex(secret);
  const key = await db
    .prepare(
      `SELECT k.id, k.user_id, k.rate_limit_rpm
       FROM api_keys k
       JOIN users u ON u.id = k.user_id
       WHERE k.key_hash = ? AND k.revoked_at IS NULL AND u.status = 'active'`,
    )
    .bind(keyHash)
    .first<ApiKeyRecord>();
  if (!key) {
    throw new PlatformError(
      401,
      "invalid_api_key",
      "API Key 无效或已撤销。",
    );
  }

  const suppliedIdempotencyKey = requireIdempotencyKey(request);
  const idempotencyHash = await sha256Hex(
    `${key.id}:${suppliedIdempotencyKey}`,
  );
  const ledgerReferenceId = `api:${key.id}:${idempotencyHash}:debit`;
  const previous = await db
    .prepare(
      `SELECT id, status
       FROM proxy_requests
       WHERE api_key_id = ? AND idempotency_hash = ?`,
    )
    .bind(key.id, idempotencyHash)
    .first<{ id: string; status: string }>();
  if (previous) {
    throw new PlatformError(
      409,
      "idempotency_conflict",
      `该 Idempotency-Key 已用于请求 ${previous.id}（${previous.status}），未重复调用或扣费。`,
    );
  }
  const upstreamCredential = await resolveTikHubCredential(env, db);
  if (!upstreamCredential) {
    throw new PlatformError(
      503,
      "upstream_not_configured",
      "TikHub 服务端密钥尚未配置。",
    );
  }
  if (
    !tikHubCredentialAllowsPath(
      upstreamCredential.scopes,
      url.pathname,
    )
  ) {
    throw new PlatformError(
      403,
      "upstream_credential_scope_denied",
      "当前 TikHub 活动凭据没有调用该数据接口的权限。",
    );
  }
  const currentCatalogCredential = await db
    .prepare(
      `SELECT EXISTS(
         SELECT 1 FROM catalog_sync_state
         WHERE id = 1 AND last_success_generation = ?
           AND credential_source = ?
           AND credential_id IS ?
           AND credential_fingerprint = ?
           AND credential_state_version = ?
       ) AS matches_current`,
    )
    .bind(
      catalog.sync_generation,
      upstreamCredential.source,
      upstreamCredential.id,
      upstreamCredential.fingerprint,
      upstreamCredential.stateVersion,
    )
    .first<{ matches_current: number }>();
  if (Number(currentCatalogCredential?.matches_current ?? 0) !== 1) {
    throw new PlatformError(
      409,
      "catalog_credential_changed",
      "TikHub 活动凭据在请求准备期间发生变化，请稍后重试。",
    );
  }

  const minuteBucket = new Date().toISOString().slice(0, 16);
  const rateSlot = await db
    .prepare(
      `INSERT INTO rate_limit_buckets
       (api_key_id, minute_bucket, request_count, updated_at)
       VALUES (?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(api_key_id, minute_bucket) DO UPDATE SET
         request_count = rate_limit_buckets.request_count + 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE rate_limit_buckets.request_count < ?
       RETURNING request_count`,
    )
    .bind(key.id, minuteBucket, key.rate_limit_rpm)
    .first<{ request_count: number }>();
  if (!rateSlot) {
    throw new PlatformError(
      429,
      "rate_limit_exceeded",
      `已达到 ${key.rate_limit_rpm} RPM 限制，请稍后重试。`,
    );
  }

  const reservation = await db
    .prepare(
      `INSERT OR IGNORE INTO proxy_requests
       (id, api_key_id, user_id, idempotency_hash, ledger_reference_id,
        path, status, cost_usd_micros, created_at)
       SELECT ?, ?, ?, ?, ?, ?, 'processing', ?, CURRENT_TIMESTAMP
       WHERE (
         SELECT COUNT(*)
         FROM proxy_requests
         WHERE user_id = ?
           AND status IN ('processing', 'charged')
           AND datetime(created_at) >= datetime('now', '-2 minutes')
       ) < ?`,
    )
    .bind(
      requestId,
      key.id,
      key.user_id,
      idempotencyHash,
      ledgerReferenceId,
      url.pathname,
      catalog.customer_price_usd_micros,
      key.user_id,
      clampInteger(env.ACCOUNT_CONCURRENCY_LIMIT, 5, 1, 50),
    )
    .run();
  if (Number(reservation.meta?.changes ?? 0) !== 1) {
    const previous = await db
      .prepare(
        `SELECT id, status
         FROM proxy_requests
         WHERE api_key_id = ? AND idempotency_hash = ?`,
      )
      .bind(key.id, idempotencyHash)
      .first<{ id: string; status: string }>();
    if (previous) {
      throw new PlatformError(
        409,
        "idempotency_conflict",
        `该 Idempotency-Key 已用于请求 ${previous.id}（${previous.status}），未重复调用或扣费。`,
      );
    }
    throw new PlatformError(
      429,
      "account_concurrency_exceeded",
      "账户并发请求数已达上限，请等待正在处理的请求完成。",
    );
  }

  if (crypto.getRandomValues(new Uint8Array(1))[0] === 0) {
    ctx.waitUntil(
      db
        .prepare(
          `DELETE FROM rate_limit_buckets
           WHERE datetime(updated_at) < datetime('now', '-2 days')`,
        )
        .run(),
    );
    ctx.waitUntil(
      db
        .prepare(
          `DELETE FROM upstream_rate_limit_buckets
           WHERE datetime(updated_at) < datetime('now', '-10 minutes')`,
        )
        .run(),
    );
  }

  const costUsdMicros = catalog.customer_price_usd_micros;
  const debitResult = await db
    .prepare(
      `INSERT INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id, description, created_at)
       SELECT ?, ?, 'api_debit', ?, ?, ?, ?
       WHERE (
         SELECT COALESCE(SUM(delta_usd_micros), 0)
         FROM balance_ledger
         WHERE user_id = ?
       ) >= ?`,
    )
    .bind(
      `led_${randomBase64Url(16)}`,
      key.user_id,
      -costUsdMicros,
      ledgerReferenceId,
      `${request.method} ${url.pathname}`,
      new Date().toISOString(),
      key.user_id,
      costUsdMicros,
    )
    .run();
  if (Number(debitResult.meta?.changes ?? 0) !== 1) {
    await db
      .prepare(`DELETE FROM proxy_requests WHERE id = ? AND status = 'processing'`)
      .bind(requestId)
      .run();
    throw new PlatformError(
      402,
      "insufficient_balance",
      "余额不足，请充值后重试。",
    );
  }

  const upstreamSlot = await db
    .prepare(
      `INSERT INTO upstream_rate_limit_buckets
       (endpoint_path, second_bucket, request_count, updated_at)
       VALUES (?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(endpoint_path, second_bucket) DO UPDATE SET
         request_count = upstream_rate_limit_buckets.request_count + 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE upstream_rate_limit_buckets.request_count < ?
       RETURNING request_count`,
    )
    .bind(
      "__global__",
      new Date().toISOString().slice(0, 19),
      clampInteger(env.UPSTREAM_RATE_LIMIT_RPS, 8, 1, 100),
    )
    .first<{ request_count: number }>();
  if (!upstreamSlot) {
    await refundRequest(
      db,
      key.user_id,
      ledgerReferenceId,
      costUsdMicros,
    );
    await markProxyRequest(db, requestId, "rate_limited", 429);
    throw new PlatformError(
      429,
      "upstream_rate_limit_exceeded",
      "共享上游已达到瞬时速率上限，请在 1 秒后重试。本次未扣费。",
    );
  }
  await markProxyRequest(db, requestId, "charged", null);

  const upstreamBase = normalizeUpstreamBase(env.TIKHUB_BASE_URL);
  const upstreamUrl = new URL(
    `${upstreamBase}${url.pathname.slice("/v1".length)}${url.search}`,
  );
  const upstreamHeaders = new Headers({
    authorization: `Bearer ${upstreamCredential.secret}`,
    accept: request.headers.get("accept") ?? "application/json",
    "user-agent": "RelayBase-API/1.0",
  });
  if (upstreamBody != null) {
    upstreamHeaders.set("content-type", "application/json");
  }

  const startedAt = Date.now();
  if (upstreamCredential.id) {
    ctx.waitUntil(
      db
        .prepare(
          `UPDATE upstream_credentials
           SET last_used_at = CURRENT_TIMESTAMP
           WHERE id = ? AND provider = 'tikhub' AND revoked_at IS NULL
             AND EXISTS (
               SELECT 1 FROM upstream_credential_state
               WHERE provider = 'tikhub'
                 AND active_credential_id = upstream_credentials.id
             )`,
        )
        .bind(upstreamCredential.id)
        .run(),
    );
  }
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body: upstreamBody,
      redirect: "error",
      signal: AbortSignal.timeout(
        clampInteger(env.UPSTREAM_TIMEOUT_MS, 45_000, 30_000, 60_000),
      ),
    });
  } catch {
    await refundRequest(
      db,
      key.user_id,
      ledgerReferenceId,
      costUsdMicros,
    );
    await logApiCall(db, {
      requestId,
      key,
      method: request.method,
      path: url.pathname,
      platform: catalog.platform,
      statusCode: 502,
      costUsdMicros,
      upstreamCostUsdMicros: catalog.upstream_price_usd_micros,
      latencyMs: Date.now() - startedAt,
      refunded: true,
    });
    throw new PlatformError(
      502,
      "upstream_unavailable",
      "上游数据服务暂时不可用，本次未扣费。",
    );
  }

  let successfulBodyText: string | null = null;
  if (upstreamResponse.status === 200) {
    try {
      const contentType =
        upstreamResponse.headers.get("content-type")?.toLowerCase() ?? "";
      if (
        !/(?:^|[;\s])application\/(?:[a-z0-9.+-]*\+)?json(?:[;\s]|$)/.test(
          contentType,
        )
      ) {
        throw new Error("upstream success was not JSON");
      }
      successfulBodyText = await readResponseText(
        upstreamResponse,
        clampInteger(
          env.UPSTREAM_MAX_RESPONSE_BYTES,
          8 * 1024 * 1024,
          64 * 1024,
          16 * 1024 * 1024,
        ),
        "upstream_invalid_response",
      );
      const parsed = JSON.parse(successfulBodyText) as unknown;
      if (!isPlainRecord(parsed) && !Array.isArray(parsed)) {
        throw new Error("upstream JSON must be an object or array");
      }
    } catch {
      await refundRequest(
        db,
        key.user_id,
        ledgerReferenceId,
        costUsdMicros,
      );
      try {
        await logApiCall(db, {
          requestId,
          key,
          method: request.method,
          path: url.pathname,
          platform: catalog.platform,
          statusCode: 502,
          costUsdMicros,
          upstreamCostUsdMicros: catalog.upstream_price_usd_micros,
          latencyMs: Date.now() - startedAt,
          refunded: true,
        });
      } catch {
        await markProxyRequest(db, requestId, "reconciled", 500);
      }
      const balance = await currentBalance(db, key.user_id);
      return upstreamErrorResponse(
        502,
        "上游返回了不完整、超限或非 JSON 的响应，本次未扣费。",
        requestId,
        new Headers({
          "x-relaybase-cost-usd-micros": "0",
          "x-relaybase-balance-usd-micros": String(balance),
          "cache-control": "private, no-store",
        }),
      );
    }
  }

  const requestState = await db
    .prepare(`SELECT status FROM proxy_requests WHERE id = ?`)
    .bind(requestId)
    .first<{ status: string }>();
  const refunded =
    upstreamResponse.status !== 200 || requestState?.status === "reconciled";
  if (upstreamResponse.status !== 200) {
    await refundRequest(
      db,
      key.user_id,
      ledgerReferenceId,
      costUsdMicros,
    );
  }

  try {
    await logApiCall(db, {
      requestId,
      key,
      method: request.method,
      path: url.pathname,
      platform: catalog.platform,
      statusCode: upstreamResponse.status,
      costUsdMicros,
      upstreamCostUsdMicros: catalog.upstream_price_usd_micros,
      latencyMs: Date.now() - startedAt,
      refunded,
    });
  } catch {
    await refundRequest(
      db,
      key.user_id,
      ledgerReferenceId,
      costUsdMicros,
    );
    await markProxyRequest(db, requestId, "reconciled", 500);
    throw new PlatformError(
      500,
      "request_record_failed",
      "请求记录写入失败，本次已退回余额。",
    );
  }

  const balance = await currentBalance(db, key.user_id);
  const responseHeaders = sanitizeUpstreamHeaders(upstreamResponse.headers);
  responseHeaders.set("x-request-id", requestId);
  responseHeaders.set(
    "x-relaybase-cost-usd-micros",
    refunded ? "0" : String(costUsdMicros),
  );
  responseHeaders.set("x-relaybase-balance-usd-micros", String(balance));
  responseHeaders.set("cache-control", "private, no-store");
  responseHeaders.set("x-content-type-options", "nosniff");

  if (upstreamResponse.status !== 200) {
    const upstreamMessage = await safeUpstreamErrorMessage(
      upstreamResponse,
      MAX_UPSTREAM_ERROR_BODY_BYTES,
      [upstreamCredential.secret],
    );
    return upstreamErrorResponse(
      upstreamResponse.status,
      upstreamMessage,
      requestId,
      responseHeaders,
    );
  }

  return new Response(successfulBodyText, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

async function handlePublicCatalog(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  const db = requireDb(env);
  const url = new URL(request.url);
  const rawPlatform = url.searchParams.get("platform")?.trim().toLowerCase();
  if (
    rawPlatform &&
    (!/^[a-z0-9_-]{1,40}$/.test(rawPlatform) ||
      url.searchParams.getAll("platform").length !== 1)
  ) {
    throw new PlatformError(
      400,
      "invalid_platform_filter",
      "平台筛选值无效。",
    );
  }
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit == null ? 200 : Number(rawLimit);
  if (
    url.searchParams.getAll("limit").length > 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  ) {
    throw new PlatformError(
      400,
      "invalid_limit",
      "limit 必须是 1–200 的整数。",
    );
  }
  const rawOffset = url.searchParams.get("offset");
  const offset = rawOffset == null ? 0 : Number(rawOffset);
  if (
    url.searchParams.getAll("offset").length > 1 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 5_000
  ) {
    throw new PlatformError(
      400,
      "invalid_offset",
      "offset 必须是 0–5000 的整数。",
    );
  }

  const query = rawPlatform
    ? db
        .prepare(
          `SELECT path, platform, http_method, summary,
                  customer_price_usd_micros, updated_at
           FROM endpoint_catalog
           WHERE enabled = 1 AND read_only = 1 AND price_verified = 1
             AND platform = ?
             AND sync_generation = (
               SELECT last_success_generation
               FROM catalog_sync_state
               WHERE id = 1
             )
           ORDER BY platform ASC, path ASC
           LIMIT ? OFFSET ?`,
        )
        .bind(rawPlatform, limit, offset)
    : db
        .prepare(
          `SELECT path, platform, http_method, summary,
                  customer_price_usd_micros, updated_at
           FROM endpoint_catalog
           WHERE enabled = 1 AND read_only = 1 AND price_verified = 1
             AND sync_generation = (
               SELECT last_success_generation
               FROM catalog_sync_state
               WHERE id = 1
             )
           ORDER BY platform ASC, path ASC
           LIMIT ? OFFSET ?`,
        )
        .bind(limit, offset);
  const countQuery = rawPlatform
    ? db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM endpoint_catalog
           WHERE enabled = 1 AND read_only = 1 AND price_verified = 1
             AND platform = ?
             AND sync_generation = (
               SELECT last_success_generation
               FROM catalog_sync_state
               WHERE id = 1
             )`,
        )
        .bind(rawPlatform)
    : db.prepare(
        `SELECT COUNT(*) AS count
         FROM endpoint_catalog
         WHERE enabled = 1 AND read_only = 1 AND price_verified = 1
           AND sync_generation = (
             SELECT last_success_generation
             FROM catalog_sync_state
             WHERE id = 1
           )`,
      );
  const rows = await query.all<{
    path: string;
    platform: string;
    http_method: string;
    summary: string | null;
    customer_price_usd_micros: number;
    updated_at: string;
  }>();
  const endpoints = (rows.results ?? []).map((row) => ({
    path: row.path,
    platform: row.platform,
    method: row.http_method,
    summary: row.summary,
    priceUsdMicros: row.customer_price_usd_micros,
    updatedAt: row.updated_at,
  }));
  const countRow = await countQuery.first<{ count: number }>();
  const total = Number(countRow?.count ?? 0);
  const nextOffset =
    offset + endpoints.length < total &&
    offset + endpoints.length < 5_000
      ? offset + endpoints.length
      : null;
  const readiness = await operationalReadiness(env);

  return jsonResponse(
    {
      mode: readiness.mode,
      endpoints,
      count: endpoints.length,
      total,
      offset,
      nextOffset,
    },
    200,
    requestId,
    {
      "cache-control": "public, max-age=30, s-maxage=60",
    },
  );
}

async function handleCatalogList(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "catalog");
  const db = requireDb(env);
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "200");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  if (
    url.searchParams.getAll("limit").length > 1 ||
    url.searchParams.getAll("offset").length > 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 500 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100_000
  ) {
    throw new PlatformError(
      400,
      "invalid_pagination",
      "分页参数无效。",
    );
  }
  const rows = await db
    .prepare(
      `SELECT path, platform, http_method, summary, description,
              parameter_schema_json, upstream_price_usd_micros,
              customer_price_usd_micros, price_verified, enabled, read_only,
              source_updated_at, sync_generation, reviewed_at, updated_at,
              sync_generation = (
                SELECT last_success_generation
                FROM catalog_sync_state
                WHERE id = 1
              ) AS present_in_latest_sync
       FROM endpoint_catalog
       ORDER BY enabled DESC, reviewed_at IS NULL DESC,
                platform ASC, path ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<{
      path: string;
      platform: string;
      http_method: string;
      summary: string | null;
      description: string | null;
      parameter_schema_json: string | null;
      upstream_price_usd_micros: number;
      customer_price_usd_micros: number;
      price_verified: number;
      enabled: number;
      read_only: number;
      source_updated_at: string | null;
      sync_generation: string | null;
      present_in_latest_sync: number | null;
      reviewed_at: string | null;
      updated_at: string;
    }>();

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS count FROM endpoint_catalog`)
    .first<{ count: number }>();
  const total = Number(totalRow?.count ?? 0);
  const endpoints = (rows.results ?? []).map((row) => ({
    path: row.path,
    platform: row.platform,
    method: row.http_method,
    summary: row.summary,
    description: row.description,
    parameterSchema: safeStoredJson(row.parameter_schema_json),
    upstreamPriceUsdMicros: row.upstream_price_usd_micros,
    customerPriceUsdMicros: row.customer_price_usd_micros,
    priceVerified: row.price_verified === 1,
    enabled: row.enabled === 1,
    readOnly: row.read_only === 1,
    sourceUpdatedAt: row.source_updated_at,
    presentInLatestSync: row.present_in_latest_sync === 1,
    reviewedAt: row.reviewed_at,
    updatedAt: row.updated_at,
  }));

  return jsonResponse(
    {
      endpoints,
      count: endpoints.length,
      total,
      offset,
      nextOffset:
        offset + endpoints.length < total
          ? offset + endpoints.length
          : null,
    },
    200,
    requestId,
  );
}

async function handleAdminOverview(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "platform");
  const db = requireDb(env);
  const readiness = await operationalReadiness(env);
  const upstreamSnapshot = await managedTikHubCredentialsSnapshot(db);
  const activeManagedCredential =
    upstreamSnapshot.credentials.find(
      (credential) => credential.status === "active",
    ) ?? null;
  const environmentUpstreamKey = env.TIKHUB_API_KEY;
  const environmentUpstreamConfigured = hasConfiguredCredential(
    environmentUpstreamKey,
  );
  const environmentUpstreamFingerprint =
    environmentUpstreamConfigured && !upstreamSnapshot.managedEnabled
      ? (await sha256Hex(environmentUpstreamKey)).slice(0, 16)
      : null;
  const [
    usersResult,
    callsResult,
    balanceResult,
    paymentsResult,
    recentCallsResult,
  ] = await db.batch([
    db.prepare(
      `SELECT COUNT(*) AS total_users,
              COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0)
                AS active_users
       FROM users`,
    ),
    db.prepare(
      `SELECT COUNT(*) AS calls_30d,
              COALESCE(SUM(CASE WHEN status_code = 200 THEN 1 ELSE 0 END), 0)
                AS successful_30d,
              COALESCE(SUM(
                CASE WHEN refunded = 0 THEN cost_usd_micros ELSE 0 END
              ), 0) AS gross_revenue_30d,
              COALESCE(SUM(
                CASE WHEN refunded = 0
                     THEN upstream_cost_usd_micros ELSE 0 END
              ), 0) AS upstream_cost_30d
       FROM api_calls
       WHERE datetime(created_at) >= datetime('now', '-30 days')`,
    ),
    db.prepare(
      `SELECT COALESCE(
         SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END),
         0
       ) AS outstanding_balance
       FROM (
         SELECT user_id, SUM(delta_usd_micros) AS balance
         FROM balance_ledger
         GROUP BY user_id
       )`,
    ),
    db.prepare(
      `SELECT COUNT(*) AS manual_review_payments
       FROM payment_orders
       WHERE status = 'manual_review'`,
    ),
    db.prepare(
      `SELECT c.id, u.email, c.upstream_path, c.platform,
              c.status_code, c.cost_usd_micros,
              c.upstream_cost_usd_micros, c.refunded, c.created_at
       FROM api_calls c
       JOIN users u ON u.id = c.user_id
       ORDER BY c.created_at DESC
       LIMIT 30`,
    ),
  ]);

  const users = firstResult<{
    total_users: number;
    active_users: number;
  }>(usersResult);
  const calls = firstResult<{
    calls_30d: number;
    successful_30d: number;
    gross_revenue_30d: number;
    upstream_cost_30d: number;
  }>(callsResult);
  const balances = firstResult<{ outstanding_balance: number }>(
    balanceResult,
  );
  const payments = firstResult<{ manual_review_payments: number }>(
    paymentsResult,
  );
  const calls30d = Number(calls?.calls_30d ?? 0);
  const successful30d = Number(calls?.successful_30d ?? 0);
  const grossRevenueUsdMicros = Number(
    calls?.gross_revenue_30d ?? 0,
  );
  const upstreamCostUsdMicros = Number(
    calls?.upstream_cost_30d ?? 0,
  );

  return jsonResponse(
    {
      summary: {
        totalUsers: Number(users?.total_users ?? 0),
        activeUsers: Number(users?.active_users ?? 0),
        calls30d,
        successRate:
          calls30d === 0
            ? 1
            : Math.round((successful30d / calls30d) * 10_000) / 10_000,
        grossRevenueUsdMicros,
        upstreamCostUsdMicros,
        grossMarginUsdMicros:
          grossRevenueUsdMicros - upstreamCostUsdMicros,
        outstandingBalanceUsdMicros: Math.max(
          0,
          Number(balances?.outstanding_balance ?? 0),
        ),
        manualReviewPayments: Number(
          payments?.manual_review_payments ?? 0,
        ),
      },
      recentCalls: resultRows<{
        id: string;
        email: string;
        upstream_path: string;
        platform: string;
        status_code: number;
        cost_usd_micros: number;
        upstream_cost_usd_micros: number;
        refunded: number;
        created_at: string;
      }>(recentCallsResult).map((row) => ({
        id: row.id,
        userEmail: row.email,
        path: row.upstream_path,
        platform: row.platform,
        statusCode: row.status_code,
        customerCostUsdMicros: row.cost_usd_micros,
        upstreamCostUsdMicros: row.upstream_cost_usd_micros,
        refunded: row.refunded === 1,
        createdAt: row.created_at,
      })),
      readiness: {
        ready: readiness.ready,
        mode: readiness.mode,
        missing: readiness.missing,
      },
      upstream: {
        configured: readiness.capabilities.upstreamConfigured,
        keyFingerprint:
          activeManagedCredential?.secret_hash.slice(0, 16) ??
          environmentUpstreamFingerprint,
        source: activeManagedCredential
          ? "managed"
          : !upstreamSnapshot.managedEnabled &&
              environmentUpstreamConfigured
            ? "environment"
            : "none",
        managedEnabled: upstreamSnapshot.managedEnabled,
        managedCredentialCount: upstreamSnapshot.credentials.length,
        stateVersion: upstreamSnapshot.stateVersion,
        encryptionConfigured: hasValidTikHubCredentialsEncryptionKey(
          env.TIKHUB_CREDENTIALS_ENCRYPTION_KEY,
        ),
        baseUrl: hasValidRuntimeConfiguration(env)
          ? normalizeUpstreamBase(env.TIKHUB_BASE_URL)
          : null,
      },
      generatedAt: new Date().toISOString(),
    },
    200,
    requestId,
  );
}

async function handleAdminUsers(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "platform");
  const db = requireDb(env);
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  if (
    url.searchParams.getAll("limit").length > 1 ||
    url.searchParams.getAll("offset").length > 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100_000
  ) {
    throw new PlatformError(
      400,
      "invalid_pagination",
      "分页参数无效。",
    );
  }

  const [usersResult, countResult] = await db.batch([
    db
      .prepare(
        `WITH balances AS (
           SELECT user_id, COALESCE(SUM(delta_usd_micros), 0) AS balance
           FROM balance_ledger
           GROUP BY user_id
         ),
         usage AS (
           SELECT user_id,
                  COALESCE(SUM(
                    CASE WHEN datetime(created_at) >= datetime('now', '-30 days')
                         THEN 1 ELSE 0 END
                  ), 0) AS calls_30d,
                  COALESCE(SUM(
                    CASE WHEN datetime(created_at) >= datetime('now', '-30 days')
                              AND refunded = 0
                         THEN cost_usd_micros ELSE 0 END
                  ), 0) AS spend_30d,
                  MAX(created_at) AS last_call_at
           FROM api_calls
           GROUP BY user_id
         )
         SELECT u.id, u.email, u.display_name, u.status, u.created_at,
                COALESCE(b.balance, 0) AS balance,
                COALESCE(g.calls_30d, 0) AS calls_30d,
                COALESCE(g.spend_30d, 0) AS spend_30d,
                g.last_call_at
         FROM users u
         LEFT JOIN balances b ON b.user_id = u.id
         LEFT JOIN usage g ON g.user_id = u.id
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(limit, offset),
    db.prepare(`SELECT COUNT(*) AS count FROM users`),
  ]);
  const count = Number(
    firstResult<{ count: number }>(countResult)?.count ?? 0,
  );
  const users = resultRows<{
    id: string;
    email: string;
    display_name: string | null;
    status: string;
    created_at: string;
    balance: number;
    calls_30d: number;
    spend_30d: number;
    last_call_at: string | null;
  }>(usersResult).map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name ?? row.email.split("@")[0],
    status: row.status,
    balanceUsdMicros: Number(row.balance),
    calls30d: Number(row.calls_30d),
    spend30dUsdMicros: Number(row.spend_30d),
    lastCallAt: row.last_call_at,
    createdAt: row.created_at,
  }));

  return jsonResponse(
    {
      users,
      count: users.length,
      total: count,
      offset,
      nextOffset:
        offset + users.length < count ? offset + users.length : null,
    },
    200,
    requestId,
  );
}

async function handleAdminUserUpdate(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "platform");
  const body = await readJsonBody<{
    userId?: unknown;
    status?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const userId =
    typeof body.userId === "string" ? body.userId.trim() : "";
  const status =
    typeof body.status === "string" ? body.status.trim() : "";
  if (!/^usr_[A-Za-z0-9_-]{8,128}$/.test(userId)) {
    throw new PlatformError(400, "invalid_user_id", "用户编号无效。");
  }
  if (status !== "active" && status !== "suspended") {
    throw new PlatformError(
      400,
      "invalid_user_status",
      "用户状态仅支持 active 或 suspended。",
    );
  }

  const db = requireDb(env);
  const results = await db.batch([
    db
      .prepare(
        `UPDATE users
         SET status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(status, userId),
    db
      .prepare(
        `UPDATE api_keys
         SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
         WHERE user_id = ? AND ? = 'suspended'`,
      )
      .bind(userId, status),
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    throw new PlatformError(404, "user_not_found", "没有找到这个用户。");
  }
  await writeAdminAudit(db, request, {
    action: "user.status_updated",
    targetType: "user",
    targetId: userId,
    details: { status },
  });
  return jsonResponse({ ok: true, userId, status }, 200, requestId);
}

async function handleAdminPayments(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "payments");
  const db = requireDb(env);
  const url = new URL(request.url);
  const status = url.searchParams.get("status")?.trim().toLowerCase();
  if (status && !/^[a-z_]{1,64}$/.test(status)) {
    throw new PlatformError(
      400,
      "invalid_payment_status",
      "支付状态筛选值无效。",
    );
  }
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  if (
    url.searchParams.getAll("limit").length > 1 ||
    url.searchParams.getAll("offset").length > 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100_000
  ) {
    throw new PlatformError(400, "invalid_pagination", "分页参数无效。");
  }
  const query = status
    ? db
        .prepare(
          `SELECT p.id, p.provider_payment_id, p.amount_usd_micros,
                  p.pay_currency, p.pay_amount, p.pay_address,
                  p.invoice_url, p.status, p.credited_usd_micros,
                  p.created_at, p.updated_at, u.email
           FROM payment_orders p
           JOIN users u ON u.id = p.user_id
           WHERE p.status = ?
           ORDER BY p.updated_at DESC
           LIMIT ? OFFSET ?`,
        )
        .bind(status, limit, offset)
    : db.prepare(
        `SELECT p.id, p.provider_payment_id, p.amount_usd_micros,
                p.pay_currency, p.pay_amount, p.pay_address,
                p.invoice_url, p.status, p.credited_usd_micros,
                p.created_at, p.updated_at, u.email
         FROM payment_orders p
         JOIN users u ON u.id = p.user_id
         ORDER BY p.updated_at DESC
         LIMIT ? OFFSET ?`,
      ).bind(limit, offset);
  const countQuery = status
    ? db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM payment_orders
           WHERE status = ?`,
        )
        .bind(status)
    : db.prepare(`SELECT COUNT(*) AS count FROM payment_orders`);
  const [rowsResult, countResult] = await db.batch([query, countQuery]);
  const rows = resultRows<
    Omit<PaymentOrderRecord, "user_id" | "idempotency_hash"> & {
      email: string;
    }
  >(rowsResult);
  const total = Number(
    firstResult<{ count: number }>(countResult)?.count ?? 0,
  );

  return jsonResponse(
    {
      payments: rows.map((row) => ({
        id: row.id,
        userEmail: row.email,
        providerPaymentId: row.provider_payment_id,
        amountUsdMicros: row.amount_usd_micros,
        payCurrency: row.pay_currency,
        payAmount: row.pay_amount,
        payAddress: row.pay_address,
        invoiceUrl: safeInvoiceUrl(row.invoice_url),
        status: row.status,
        creditedUsdMicros: row.credited_usd_micros,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      count: rows.length,
      total,
      offset,
      nextOffset:
        offset + rows.length < total ? offset + rows.length : null,
    },
    200,
    requestId,
  );
}

async function handleRecoverPayment(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "payments");
  const apiKey = env.NOWPAYMENTS_API_KEY;
  if (!apiKey) {
    throw new PlatformError(
      503,
      "payment_provider_unavailable",
      "支付服务商密钥尚未配置。",
    );
  }
  const body = await readJsonBody<{
    orderId?: unknown;
    paymentId?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const orderId =
    typeof body.orderId === "string" ? body.orderId.trim() : "";
  const paymentId =
    typeof body.paymentId === "string" ? body.paymentId.trim() : "";
  if (
    !/^pay_[A-Za-z0-9_-]+$/.test(orderId) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(paymentId)
  ) {
    throw new PlatformError(
      400,
      "invalid_payment_recovery",
      "充值单编号或支付服务商编号无效。",
    );
  }

  const db = requireDb(env);
  const order = await paymentOrderById(db, orderId);
  if (!order) {
    throw new PlatformError(404, "payment_not_found", "支付订单不存在。");
  }
  if (
    order.provider_payment_id != null &&
    order.provider_payment_id !== paymentId
  ) {
    throw new PlatformError(
      409,
      "payment_binding_conflict",
      "充值单已绑定到其他支付服务商编号。",
    );
  }
  const openReview = await db
    .prepare(
      `SELECT id
       FROM payment_review_cases
       WHERE order_id = ? AND status = 'open'
       LIMIT 1`,
    )
    .bind(orderId)
    .first<{ id: string }>();
  if (openReview) {
    throw new PlatformError(
      409,
      "payment_review_required",
      "该充值单存在待处理资金复核，请先在支付复核中显式处置。",
    );
  }

  const verified = await getNowPaymentsPayment(apiKey, paymentId);
  await applyVerifiedNowPayment(db, verified, {
    paymentId,
    orderId,
    requestId,
    allowManualReviewRecovery: true,
  });
  const recovered = await paymentOrderById(db, orderId);
  if (!recovered) {
    throw new PlatformError(
      500,
      "payment_record_missing",
      "恢复后的充值单记录不可用。",
    );
  }
  await writeAdminAudit(db, request, {
    action: "payment.recovered",
    targetType: "payment_order",
    targetId: orderId,
    details: { paymentId, status: recovered.status },
  });
  return paymentOrderResponse(recovered, 200, requestId);
}

async function handlePaymentReviewList(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "payments");
  const url = new URL(request.url);
  const status = (url.searchParams.get("status") ?? "open")
    .trim()
    .toLowerCase();
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  if (
    (status !== "open" && status !== "resolved" && status !== "all") ||
    url.searchParams.getAll("status").length > 1 ||
    url.searchParams.getAll("limit").length > 1 ||
    url.searchParams.getAll("offset").length > 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100_000
  ) {
    throw new PlatformError(
      400,
      "invalid_review_filter",
      "支付复核筛选参数无效。",
    );
  }
  const db = requireDb(env);
  const predicate = status === "all" ? "" : "WHERE r.status = ?";
  const list = status === "all"
    ? db
        .prepare(
          `SELECT r.id, r.order_id, r.provider_payment_id,
                  r.parent_payment_id, r.reason, r.status,
                  r.actually_paid, r.pay_currency, r.evidence_json,
                  r.resolution_action, r.resolution_note,
                  r.resolution_reference, r.created_at, r.resolved_at,
                  p.user_id, u.email
           FROM payment_review_cases r
           JOIN payment_orders p ON p.id = r.order_id
           JOIN users u ON u.id = p.user_id
           ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END,
                    r.created_at DESC
           LIMIT ? OFFSET ?`,
        )
        .bind(limit, offset)
    : db
        .prepare(
          `SELECT r.id, r.order_id, r.provider_payment_id,
                  r.parent_payment_id, r.reason, r.status,
                  r.actually_paid, r.pay_currency, r.evidence_json,
                  r.resolution_action, r.resolution_note,
                  r.resolution_reference, r.created_at, r.resolved_at,
                  p.user_id, u.email
           FROM payment_review_cases r
           JOIN payment_orders p ON p.id = r.order_id
           JOIN users u ON u.id = p.user_id
           ${predicate}
           ORDER BY r.created_at DESC
           LIMIT ? OFFSET ?`,
        )
        .bind(status, limit, offset);
  const countQuery =
    status === "all"
      ? db.prepare(`SELECT COUNT(*) AS count FROM payment_review_cases`)
      : db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM payment_review_cases
             WHERE status = ?`,
          )
          .bind(status);
  const [rowsResult, countResult] = await db.batch([list, countQuery]);
  const rows = resultRows<{
    id: string;
    order_id: string;
    provider_payment_id: string;
    parent_payment_id: string | null;
    reason: string;
    status: string;
    actually_paid: string | null;
    pay_currency: string | null;
    evidence_json: string;
    resolution_action: string | null;
    resolution_note: string | null;
    resolution_reference: string | null;
    created_at: string;
    resolved_at: string | null;
    user_id: string;
    email: string;
  }>(rowsResult);
  return jsonResponse(
    {
      reviews: rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        userId: row.user_id,
        email: row.email,
        providerPaymentId: row.provider_payment_id,
        parentPaymentId: row.parent_payment_id,
        reason: row.reason,
        status: row.status,
        actuallyPaid: row.actually_paid,
        payCurrency: row.pay_currency,
        evidence: safeStoredJson(row.evidence_json),
        resolutionAction: row.resolution_action,
        resolutionNote: row.resolution_note,
        resolutionReference: row.resolution_reference,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
      })),
      count: rows.length,
      total: Number(
        firstResult<{ count: number }>(countResult)?.count ?? 0,
      ),
      status,
      offset,
      nextOffset:
        offset + rows.length <
        Number(firstResult<{ count: number }>(countResult)?.count ?? 0)
          ? offset + rows.length
          : null,
    },
    200,
    requestId,
  );
}

async function handlePaymentReviewResolve(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "payments");
  const apiKey = env.NOWPAYMENTS_API_KEY;
  if (!hasConfiguredCredential(apiKey)) {
    throw new PlatformError(
      503,
      "payment_provider_unavailable",
      "支付服务商密钥尚未配置。",
    );
  }
  const body = await readJsonBody<{
    caseId?: unknown;
    action?: unknown;
    creditUsdMicros?: unknown;
    note?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const caseId =
    typeof body.caseId === "string" ? body.caseId.trim() : "";
  const action =
    typeof body.action === "string" ? body.action.trim() : "";
  const note =
    typeof body.note === "string"
      ? body.note.replace(/\s+/g, " ").trim()
      : "";
  if (!/^prv_[A-Za-z0-9_-]{12,100}$/.test(caseId)) {
    throw new PlatformError(400, "invalid_review_case", "复核案件编号无效。");
  }
  if (
    action !== "credit" &&
    action !== "refund_confirmed" &&
    action !== "reject"
  ) {
    throw new PlatformError(400, "invalid_review_action", "复核操作无效。");
  }
  if (note.length < 4 || note.length > 500) {
    throw new PlatformError(
      400,
      "invalid_review_note",
      "复核备注必须为 4–500 个字符。",
    );
  }
  const creditUsdMicros =
    action === "credit" &&
    typeof body.creditUsdMicros === "number" &&
    Number.isSafeInteger(body.creditUsdMicros)
      ? body.creditUsdMicros
      : null;
  if (
    action === "credit" &&
    (creditUsdMicros == null || creditUsdMicros < 1)
  ) {
    throw new PlatformError(
      400,
      "invalid_review_credit",
      "人工入账金额必须是大于 0 的美元微单位整数。",
    );
  }
  const resolutionRequestHash = await sha256Hex(
    JSON.stringify({
      action,
      creditUsdMicros,
      note,
    }),
  );

  const db = requireDb(env);
  const review = await db
    .prepare(
      `SELECT r.id, r.order_id, r.provider_payment_id,
              r.parent_payment_id, r.reason, r.status, r.evidence_json,
              r.resolution_action, r.resolution_credit_usd_micros,
              r.resolution_request_hash,
              p.user_id, p.provider_payment_id AS order_payment_id,
              p.amount_usd_micros, p.pay_currency, p.pay_amount
       FROM payment_review_cases r
       JOIN payment_orders p ON p.id = r.order_id
       WHERE r.id = ?`,
    )
    .bind(caseId)
    .first<{
      id: string;
      order_id: string;
      provider_payment_id: string;
      parent_payment_id: string | null;
      reason: string;
      status: string;
      evidence_json: string;
      resolution_action: string | null;
      resolution_credit_usd_micros: number | null;
      resolution_request_hash: string | null;
      user_id: string;
      order_payment_id: string | null;
      amount_usd_micros: number;
      pay_currency: string;
      pay_amount: string | null;
    }>();
  if (!review) {
    throw new PlatformError(404, "review_case_not_found", "复核案件不存在。");
  }
  if (review.status === "resolved") {
    if (
      review.resolution_action !== action ||
      review.resolution_request_hash !== resolutionRequestHash ||
      review.resolution_credit_usd_micros !== creditUsdMicros
    ) {
      throw new PlatformError(
        409,
        "review_already_resolved",
        "该案件已用其他参数处理；请刷新并核对已落账金额与备注。",
      );
    }
    return jsonResponse(
      { ok: true, caseId, status: "resolved", action },
      200,
      requestId,
    );
  }

  if (
    action === "credit" &&
    creditUsdMicros != null &&
    creditUsdMicros > review.amount_usd_micros
  ) {
    throw new PlatformError(
      400,
      "invalid_review_credit",
      "人工入账金额必须是大于 0 且不超过原充值单金额的美元微单位整数。",
    );
  }

  const verified = await getNowPaymentsPayment(
    apiKey,
    review.provider_payment_id,
  );
  const verifiedPaymentId = String(verified.payment_id ?? "");
  const verifiedParentId = String(verified.parent_payment_id ?? "").trim();
  const verifiedStatus =
    typeof verified.payment_status === "string"
      ? verified.payment_status.trim().toLowerCase()
      : "";
  const verifiedOrderMatches =
    review.parent_payment_id != null
      ? verifiedParentId === review.parent_payment_id &&
        review.order_payment_id === review.parent_payment_id &&
        (verified.order_id == null ||
          verified.order_id === "" ||
          verified.order_id === review.order_id)
      : verified.order_id === review.order_id &&
        (review.order_payment_id == null ||
          review.order_payment_id === review.provider_payment_id);
  if (
    verifiedPaymentId !== review.provider_payment_id ||
    !verifiedOrderMatches
  ) {
    throw new PlatformError(
      409,
      "payment_review_mismatch",
      "服务商复核结果与案件绑定信息不一致。",
    );
  }
  if (
    action === "credit" &&
    (!NOWPAYMENTS_REVIEW_CREDITABLE_STATUSES.has(verifiedStatus) ||
      normalizedPositiveDecimal(verified.actually_paid) == null ||
      typeof verified.pay_currency !== "string" ||
      verified.pay_currency.toLowerCase() !==
        review.pay_currency.toLowerCase())
  ) {
    throw new PlatformError(
      409,
      "payment_review_not_creditable",
      "服务商状态尚未确认可入账资金，或到账币种不匹配，不能人工入账。",
    );
  }
  if (action === "credit" && creditUsdMicros != null) {
    const expectedPayAmount =
      normalizedPositiveDecimal(review.pay_amount) ??
      normalizedPositiveDecimal(verified.pay_amount);
    const maxCreditUsdMicros =
      expectedPayAmount == null
        ? null
        : proportionalPaymentCreditUsdMicros(
            review.amount_usd_micros,
            verified.actually_paid,
            expectedPayAmount,
          );
    if (
      maxCreditUsdMicros == null ||
      creditUsdMicros > maxCreditUsdMicros
    ) {
      throw new PlatformError(
        400,
        "review_credit_exceeds_verified_payment",
        maxCreditUsdMicros == null
          ? "无法从服务商证据计算可入账上限，不能人工入账。"
          : `人工入账不能超过已验证到账比例对应的 ${maxCreditUsdMicros} 美元微单位。`,
      );
    }
  }
  if (action === "refund_confirmed" && verifiedStatus !== "refunded") {
    throw new PlatformError(
      409,
      "refund_not_confirmed",
      "服务商状态尚未确认退款，不能关闭为已退款。",
    );
  }
  if (action === "reject") {
    const actualPaid = decimalToScaledInteger(
      verified.actually_paid,
      18,
    );
    if (
      (verifiedStatus !== "failed" && verifiedStatus !== "expired") ||
      actualPaid !== BigInt(0)
    ) {
      throw new PlatformError(
        409,
        "payment_review_reject_not_safe",
        "只有服务商已确认失败或过期且实际到账为零的案件才能拒绝；已收到资金的案件必须入账、冻结或确认退款。",
      );
    }
  }

  const ledgerReference = `nowpayments-review:${caseId}:credit`;
  const originalCreditReference =
    `nowpayments:${review.provider_payment_id}:credit`;
  const resolutionReference =
    action === "credit"
      ? ledgerReference
      : `nowpayments:${review.provider_payment_id}:${verifiedStatus || "unknown"}`;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE payment_review_cases
         SET status = 'resolved', resolution_action = ?,
             resolution_credit_usd_micros = ?,
             resolution_request_hash = ?,
             resolution_note = ?, resolution_reference = ?,
             resolved_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'open'
           AND (? != 'reject' OR evidence_json = ?)
           AND (
             ? != 'credit'
             OR NOT EXISTS (
               SELECT 1
               FROM balance_ledger
               WHERE reference_id = ?
                 AND delta_usd_micros > 0
             )
           )`,
      )
      .bind(
        action,
        creditUsdMicros,
        resolutionRequestHash,
        note,
        resolutionReference,
        caseId,
        action,
        review.evidence_json,
        action,
        originalCreditReference,
      ),
  ];
  if (action === "credit" && creditUsdMicros != null) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO balance_ledger
           (id, user_id, entry_type, delta_usd_micros, reference_id,
            description, created_at)
           SELECT ?, ?, 'payment_review_credit', ?, ?,
                  'Operator-reviewed stablecoin credit', CURRENT_TIMESTAMP
           WHERE EXISTS (
             SELECT 1 FROM payment_review_cases
             WHERE id = ? AND status = 'resolved'
               AND resolution_action = 'credit'
               AND resolution_request_hash = ?
           )
             AND NOT EXISTS (
               SELECT 1
               FROM balance_ledger
               WHERE reference_id = ?
                 AND delta_usd_micros > 0
             )`,
        )
        .bind(
          `led_${randomBase64Url(16)}`,
          review.user_id,
          creditUsdMicros,
          ledgerReference,
          caseId,
          resolutionRequestHash,
          originalCreditReference,
        ),
      paymentCreditedRecalculation(db, review.order_id),
    );
  }
  if (action === "refund_confirmed") {
    if (review.order_payment_id === review.provider_payment_id) {
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO balance_ledger
             (id, user_id, entry_type, delta_usd_micros, reference_id,
              description, created_at)
             SELECT ?, user_id, 'payment_reversal',
                    -delta_usd_micros, ?,
                    'Provider-confirmed payment refund', CURRENT_TIMESTAMP
             FROM balance_ledger
             WHERE reference_id = ? AND delta_usd_micros > 0
               AND EXISTS (
                 SELECT 1
                 FROM payment_review_cases
                 WHERE id = ? AND status = 'resolved'
                   AND resolution_action = 'refund_confirmed'
                   AND resolution_request_hash = ?
               )
             LIMIT 1`,
          )
          .bind(
            `led_${randomBase64Url(16)}`,
            `nowpayments:${review.provider_payment_id}:reversal`,
            `nowpayments:${review.provider_payment_id}:credit`,
            caseId,
            resolutionRequestHash,
          ),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO balance_ledger
           (id, user_id, entry_type, delta_usd_micros, reference_id,
            description, created_at)
           SELECT ?, user_id, 'payment_review_reversal',
                  -delta_usd_micros, ?,
                  'Provider-confirmed reviewed payment refund',
                  CURRENT_TIMESTAMP
           FROM balance_ledger
           WHERE reference_id = ? AND delta_usd_micros > 0
             AND EXISTS (
               SELECT 1
               FROM payment_review_cases
               WHERE id = ? AND status = 'resolved'
                 AND resolution_action = 'refund_confirmed'
                 AND resolution_request_hash = ?
             )
           LIMIT 1`,
        )
        .bind(
          `led_${randomBase64Url(16)}`,
          `nowpayments-review:${caseId}:reversal`,
          `nowpayments-review:${caseId}:credit`,
          caseId,
          resolutionRequestHash,
        ),
      paymentCreditedRecalculation(db, review.order_id),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE payment_orders
         SET status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND EXISTS (
             SELECT 1
             FROM payment_review_cases
             WHERE id = ? AND status = 'resolved'
               AND resolution_action = ?
               AND resolution_request_hash = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM payment_review_cases
             WHERE order_id = ? AND status = 'open'
           )`,
      )
      .bind(
        action === "refund_confirmed" &&
          review.order_payment_id === review.provider_payment_id
          ? "refunded"
          : "manual_resolved",
        review.order_id,
        caseId,
        action,
        resolutionRequestHash,
        review.order_id,
      ),
  );
  statements.push(
    await prepareAdminAuditStatement(db, request, {
      action: `payment_review.${action}`,
      targetType: "payment_review_case",
      targetId: caseId,
      idempotencyKey: resolutionRequestHash,
      paymentReviewResolution: {
        caseId,
        action,
        requestHash: resolutionRequestHash,
      },
      details: {
        orderId: review.order_id,
        providerPaymentId: review.provider_payment_id,
        creditUsdMicros,
        note,
      },
    }),
  );
  const results = await db.batch(statements);
  const resolutionChanged =
    Number(results[0]?.meta?.changes ?? 0) === 1;
  const reviewCreditChanged =
    action !== "credit" ||
    Number(results[1]?.meta?.changes ?? 0) === 1;
  if (!resolutionChanged || !reviewCreditChanged) {
    const current = await db
      .prepare(
        `SELECT status, resolution_action,
                resolution_credit_usd_micros,
                resolution_request_hash, evidence_json
         FROM payment_review_cases
         WHERE id = ?`,
      )
      .bind(caseId)
      .first<{
        status: string;
        resolution_action: string | null;
        resolution_credit_usd_micros: number | null;
        resolution_request_hash: string | null;
        evidence_json: string;
      }>();
    const exactReplay =
      current?.status === "resolved" &&
      current.resolution_action === action &&
      current.resolution_credit_usd_micros === creditUsdMicros &&
      current.resolution_request_hash === resolutionRequestHash;
    if (!exactReplay) {
      if (
        action === "reject" &&
        current?.status === "open" &&
        current.evidence_json !== review.evidence_json
      ) {
        throw new PlatformError(
          409,
          "payment_review_evidence_changed",
          "案件在拒绝处理期间收到了新的服务商证据；已保留为待复核，请刷新后重新核对。",
        );
      }
      if (action === "credit") {
        const originalCredit = await db
          .prepare(
            `SELECT 1 AS present
             FROM balance_ledger
             WHERE reference_id = ? AND delta_usd_micros > 0
             LIMIT 1`,
          )
          .bind(originalCreditReference)
          .first<{ present: number }>();
        if (originalCredit) {
          throw new PlatformError(
            409,
            "payment_already_credited",
            "该服务商支付已自动入账，不能再次人工入账。",
          );
        }
      }
      throw new PlatformError(
        409,
        "review_resolution_conflict",
        "复核案件已被其他管理员处理，请刷新。",
      );
    }
  }
  return jsonResponse(
    { ok: true, caseId, status: "resolved", action },
    200,
    requestId,
  );
}

async function handleAdminAuditList(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "platform");
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "100");
  if (
    url.searchParams.getAll("limit").length > 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  ) {
    throw new PlatformError(400, "invalid_limit", "limit 参数无效。");
  }
  const rows = await requireDb(env)
    .prepare(
      `SELECT id, actor_fingerprint, action, target_type, target_id,
              details_json, created_at
       FROM admin_audit_logs
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<{
      id: string;
      actor_fingerprint: string;
      action: string;
      target_type: string;
      target_id: string;
      details_json: string | null;
      created_at: string;
    }>();
  return jsonResponse(
    {
      events: (rows.results ?? []).map((row) => ({
        id: row.id,
        actorFingerprint: row.actor_fingerprint,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        details: safeStoredJson(row.details_json),
        createdAt: row.created_at,
      })),
      count: rows.results?.length ?? 0,
    },
    200,
    requestId,
  );
}

async function handleUpstreamCredentialsList(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "platform");
  const db = requireDb(env);
  const snapshot = await managedTikHubCredentialsSnapshot(db);
  const active =
    snapshot.credentials.find((row) => row.status === "active") ?? null;
  const environmentKey = env.TIKHUB_API_KEY;
  const environmentConfigured = hasConfiguredCredential(environmentKey);
  const environmentFingerprint = environmentConfigured
    ? (await sha256Hex(environmentKey)).slice(0, 16)
    : null;

  return jsonResponse(
    {
      credentials: snapshot.credentials.map(publicManagedTikHubCredential),
      activeSource: active
        ? "managed"
        : !snapshot.managedEnabled && environmentConfigured
          ? "environment"
          : "none",
      activeCredentialId: snapshot.activeCredentialId,
      activeFingerprint:
        active?.secret_hash.slice(0, 16) ??
        (!snapshot.managedEnabled ? environmentFingerprint : null),
      stateVersion: snapshot.stateVersion,
      managedEnabled: snapshot.managedEnabled,
      encryptionConfigured: hasValidTikHubCredentialsEncryptionKey(
        env.TIKHUB_CREDENTIALS_ENCRYPTION_KEY,
      ),
      environmentFallbackConfigured: environmentConfigured,
    },
    200,
    requestId,
  );
}

async function handleUpstreamCredentialCreate(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  requireAdminSecret(request, env, "platform");
  const encryptionKey = requireTikHubCredentialsEncryptionKey(env);
  const body = await readJsonBody<{
    label?: unknown;
    apiKey?: unknown;
    activate?: unknown;
    expectedVersion?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const label = sanitizeUpstreamCredentialLabel(body.label);
  const apiKey =
    typeof body.apiKey === "string" ? body.apiKey : "";
  if (!isValidTikHubApiKey(apiKey)) {
    throw new PlatformError(
      400,
      "invalid_upstream_credential",
      "TikHub API Key 格式无效。",
    );
  }
  if (typeof body.activate !== "boolean") {
    throw new PlatformError(
      400,
      "invalid_upstream_credential_action",
      "必须明确选择是否在保存后验证并启用。",
    );
  }
  const expectedVersion =
    typeof body.expectedVersion === "number"
      ? body.expectedVersion
      : Number.NaN;
  if (
    body.activate &&
    (!Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      expectedVersion > 2_147_483_647)
  ) {
    throw new PlatformError(
      400,
      "invalid_upstream_credential_version",
      "启用 TikHub 凭据时必须提供当前状态版本。",
    );
  }

  const db = requireDb(env);
  if (body.activate) {
    const currentState = await upstreamCredentialState(db);
    if (currentState.version !== expectedVersion) {
      throw new PlatformError(
        409,
        "upstream_credential_update_conflict",
        "TikHub 活动凭据已发生变化，请刷新后重试。",
      );
    }
  }
  const verification = body.activate
    ? await verifyTikHubApiKey(apiKey, env)
    : null;

  const id = `upc_${randomBase64Url(18)}`;
  const secretHash = await sha256Hex(apiKey);
  const fingerprint = secretHash.slice(0, 16);
  const encryptedSecret = await encryptTikHubApiKey(
    apiKey,
    encryptionKey,
    id,
  );
  const created = await db
    .prepare(
      `INSERT INTO upstream_credentials
       (id, provider, label, encrypted_secret, secret_hash,
        verified_scopes_json, expires_at, verified_at, created_at)
       SELECT ?, 'tikhub', ?, ?, ?, ?, ?,
              CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
              CURRENT_TIMESTAMP
       WHERE NOT EXISTS (
         SELECT 1 FROM upstream_credentials
         WHERE provider = 'tikhub' AND secret_hash = ?
       )
       AND (
         SELECT COUNT(*)
         FROM upstream_credentials
         WHERE provider = 'tikhub'
       ) < 100`,
    )
    .bind(
      id,
      label,
      encryptedSecret,
      secretHash,
      verification ? JSON.stringify(verification.scopes) : null,
      verification?.expiresAt ?? null,
      body.activate ? 1 : 0,
      secretHash,
    )
    .run();
  if (Number(created.meta?.changes ?? 0) !== 1) {
    throw new PlatformError(
      409,
      "upstream_credential_exists",
      "相同 TikHub API Key 已经存在。",
    );
  }
  await writeAdminAudit(db, request, {
    action: "upstream_credential.created",
    targetType: "upstream_credential",
    targetId: id,
    details: {
      provider: "tikhub",
      label,
      fingerprint,
      activateRequested: body.activate,
    },
  });

  let activationConflict = false;
  if (body.activate) {
    try {
      await activateManagedTikHubCredential(
        db,
        request,
        id,
        expectedVersion,
      );
    } catch (error) {
      if (
        error instanceof PlatformError &&
        error.code === "upstream_credential_update_conflict"
      ) {
        activationConflict = true;
      } else {
        throw error;
      }
    }
  }
  const stored = await managedTikHubCredentialById(db, id);
  if (!stored) {
    throw new PlatformError(
      500,
      "upstream_credential_write_failed",
      "TikHub 凭据保存失败。",
    );
  }
  return jsonResponse(
    {
      credential: publicManagedTikHubCredential(stored),
      verified: body.activate,
      activationConflict,
    },
    activationConflict ? 202 : 201,
    requestId,
  );
}

async function handleUpstreamCredentialUpdate(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  requireAdminSecret(request, env, "platform");
  const body = await readJsonBody<{
    id?: unknown;
    action?: unknown;
    expectedVersion?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const action =
    typeof body.action === "string" ? body.action.trim() : "";
  if (!/^upc_[A-Za-z0-9_-]{16,80}$/.test(id)) {
    throw new PlatformError(
      400,
      "invalid_upstream_credential_id",
      "TikHub 凭据编号无效。",
    );
  }
  if (action !== "activate" && action !== "revoke") {
    throw new PlatformError(
      400,
      "invalid_upstream_credential_action",
      "TikHub 凭据操作仅支持 activate 或 revoke。",
    );
  }
  const expectedVersion =
    typeof body.expectedVersion === "number"
      ? body.expectedVersion
      : Number.NaN;
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0 ||
    expectedVersion > 2_147_483_647
  ) {
    throw new PlatformError(
      400,
      "invalid_upstream_credential_version",
      "TikHub 凭据操作必须提供当前状态版本。",
    );
  }

  const db = requireDb(env);
  const existing = await managedTikHubCredentialById(db, id);
  if (!existing) {
    throw new PlatformError(
      404,
      "upstream_credential_not_found",
      "没有找到这个 TikHub 凭据。",
    );
  }
  if (existing.status === "revoked") {
    throw new PlatformError(
      409,
      "upstream_credential_revoked",
      "已撤销的 TikHub 凭据不能再次使用。",
    );
  }

  if (action === "activate") {
    const currentState = await upstreamCredentialState(db);
    if (currentState.version !== expectedVersion) {
      throw new PlatformError(
        409,
        "upstream_credential_update_conflict",
        "TikHub 活动凭据已发生变化，请刷新后重试。",
      );
    }
    const encryptionKey = requireTikHubCredentialsEncryptionKey(env);
    const apiKey = await decryptTikHubApiKey(
      existing.encrypted_secret,
      encryptionKey,
      existing.id,
    );
    const verification = await verifyTikHubApiKey(apiKey, env);
    const storedVerification = await db
      .prepare(
        `UPDATE upstream_credentials
         SET verified_scopes_json = ?, expires_at = ?,
             verified_at = CURRENT_TIMESTAMP
         WHERE id = ? AND provider = 'tikhub' AND revoked_at IS NULL`,
      )
      .bind(
        JSON.stringify(verification.scopes),
        verification.expiresAt,
        id,
      )
      .run();
    if (Number(storedVerification.meta?.changes ?? 0) !== 1) {
      throw new PlatformError(
        409,
        "upstream_credential_update_conflict",
        "TikHub 凭据状态已发生变化，请刷新后重试。",
      );
    }
    await activateManagedTikHubCredential(
      db,
      request,
      id,
      expectedVersion,
    );
  } else {
    if (existing.status === "active") {
      const revokedActive = await db.batch([
        db
          .prepare(
            `UPDATE upstream_credential_state
             SET active_credential_id = NULL, version = version + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE provider = 'tikhub' AND active_credential_id = ?
               AND version = ?`,
          )
          .bind(id, expectedVersion),
        db
          .prepare(
            `UPDATE upstream_credentials
             SET revoked_at = CURRENT_TIMESTAMP,
                 encrypted_secret = 'revoked'
             WHERE id = ? AND provider = 'tikhub' AND revoked_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM upstream_credential_state
                 WHERE provider = 'tikhub' AND managed_enabled = 1
                   AND active_credential_id IS NULL AND version = ?
               )`,
          )
          .bind(id, expectedVersion + 1),
        db
          .prepare(
            `DELETE FROM catalog_sync_state
             WHERE id = 1
               AND EXISTS (
                 SELECT 1 FROM upstream_credential_state
                 WHERE provider = 'tikhub' AND managed_enabled = 1
                   AND active_credential_id IS NULL AND version = ?
               )`,
          )
          .bind(expectedVersion + 1),
      ]);
      if (
        Number(revokedActive[0]?.meta?.changes ?? 0) !== 1 ||
        Number(revokedActive[1]?.meta?.changes ?? 0) !== 1
      ) {
        throw new PlatformError(
          409,
          "upstream_credential_update_conflict",
          "TikHub 活动凭据已发生变化，请刷新后重试。",
        );
      }
    } else {
      const revoked = await db
        .prepare(
          `UPDATE upstream_credentials
           SET revoked_at = CURRENT_TIMESTAMP,
               encrypted_secret = 'revoked'
           WHERE id = ? AND provider = 'tikhub' AND revoked_at IS NULL
             AND EXISTS (
               SELECT 1 FROM upstream_credential_state
               WHERE provider = 'tikhub' AND version = ?
                 AND (
                   active_credential_id IS NULL OR
                   active_credential_id != ?
                 )
             )`,
        )
        .bind(id, expectedVersion, id)
        .run();
      if (Number(revoked.meta?.changes ?? 0) !== 1) {
        throw new PlatformError(
          409,
          "upstream_credential_update_conflict",
          "TikHub 凭据状态已发生变化，请刷新后重试。",
        );
      }
    }
    await writeAdminAudit(db, request, {
      action: "upstream_credential.revoked",
      targetType: "upstream_credential",
      targetId: id,
      details: {
        provider: "tikhub",
        label: existing.label,
        fingerprint: existing.secret_hash.slice(0, 16),
      },
    });
  }

  const updated = await managedTikHubCredentialById(db, id);
  if (!updated) {
    throw new PlatformError(
      500,
      "upstream_credential_write_failed",
      "TikHub 凭据状态更新失败。",
    );
  }
  return jsonResponse(
    { credential: publicManagedTikHubCredential(updated) },
    200,
    requestId,
  );
}

async function handleCatalogSync(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "catalog");
  const db = requireDb(env);
  const syncGeneration = `sync_${randomBase64Url(16)}`;
  const acquiredLock = await db
    .prepare(
      `INSERT INTO catalog_sync_locks (id, generation, locked_at)
       VALUES (1, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         generation = excluded.generation,
         locked_at = CURRENT_TIMESTAMP
       WHERE datetime(catalog_sync_locks.locked_at) <
             datetime('now', '-15 minutes')
       RETURNING generation`,
    )
    .bind(syncGeneration)
    .first<{ generation: string }>();
  if (acquiredLock?.generation !== syncGeneration) {
    throw new PlatformError(
      409,
      "catalog_sync_in_progress",
      "已有目录同步正在进行，请稍后重试。",
    );
  }

  try {
    const credential = await resolveTikHubCredential(env, db);
    if (!credential) {
      throw new PlatformError(
        503,
        "upstream_not_configured",
        "TikHub 服务端密钥尚未配置。",
      );
    }

    const upstreamBase = normalizeUpstreamBase(env.TIKHUB_BASE_URL);
    let response: Response;
    try {
      response = await fetch(
        `${upstreamBase}/tikhub/user/get_all_endpoints_info`,
        {
          headers: {
            authorization: `Bearer ${credential.secret}`,
            accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(
            clampInteger(
              env.UPSTREAM_TIMEOUT_MS,
              45_000,
              30_000,
              60_000,
            ),
          ),
        },
      );
    } catch {
      throw new PlatformError(
        502,
        "catalog_sync_failed",
        "TikHub 端点目录暂时不可用。",
      );
    }
    if (!response.ok) {
      throw new PlatformError(
        502,
        "catalog_sync_failed",
        `TikHub 端点目录同步失败（${response.status}）。`,
      );
    }

    const payload = await readResponseJson(
      response,
      MAX_CATALOG_RESPONSE_BYTES,
      "catalog_sync_failed",
    );
    let openApiResponse: Response;
    try {
      openApiResponse = await fetch(
        `${new URL(upstreamBase).origin}/openapi.json`,
        {
          headers: { accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(
            clampInteger(
              env.UPSTREAM_TIMEOUT_MS,
              45_000,
              30_000,
              60_000,
            ),
          ),
        },
      );
    } catch {
      throw new PlatformError(
        502,
        "catalog_schema_sync_failed",
        "TikHub OpenAPI 文档暂时不可用。",
      );
    }
    if (!openApiResponse.ok) {
      throw new PlatformError(
        502,
        "catalog_schema_sync_failed",
        `TikHub OpenAPI 文档同步失败（${openApiResponse.status}）。`,
      );
    }
    const openApiPayload = await readResponseJson(
      openApiResponse,
      MAX_OPENAPI_RESPONSE_BYTES,
      "catalog_schema_sync_failed",
    );
    const prices = extractCatalogPrices(payload);
    const openApi = extractOpenApiCatalog(openApiPayload);
    const entries = mergeCatalogEntries(
      prices,
      openApi,
      credential.scopes,
    );
    const pricedEntries = entries.filter(
      (entry) => entry.priceVerified,
    ).length;
    if (
      prices.length === 0 ||
      openApi.size === 0 ||
      entries.length === 0 ||
      pricedEntries === 0
    ) {
      throw new PlatformError(
        502,
        "catalog_sync_failed",
        "上游响应中没有识别到完整端点与价格，请人工检查响应格式。",
      );
    }
    if (entries.length > 5_000) {
      throw new PlatformError(
        502,
        "catalog_sync_failed",
        "上游端点目录超过安全处理上限，请人工检查响应。",
      );
    }

    const currentCount = await db
      .prepare(`SELECT COUNT(*) AS count FROM endpoint_catalog`)
      .first<{ count: number }>();
    const knownCount = Number(currentCount?.count ?? 0);
    if (knownCount >= 20 && entries.length < Math.floor(knownCount / 2)) {
      throw new PlatformError(
        502,
        "catalog_snapshot_incomplete",
        "本次目录数量较历史记录异常减少，已停止同步以避免误停端点。",
      );
    }

    const markupBps = clampInteger(
      env.PRICE_MARKUP_BPS,
      3000,
      0,
      50_000,
    );
    let synced = 0;
    await db
      .prepare(
        `DELETE FROM catalog_sync_staging
         WHERE datetime(created_at) < datetime('now', '-1 day')`,
      )
      .run();
    for (let offset = 0; offset < entries.length; offset += 50) {
      const renewal = await db
        .prepare(
          `UPDATE catalog_sync_locks
           SET locked_at = CURRENT_TIMESTAMP
           WHERE id = 1 AND generation = ?`,
        )
        .bind(syncGeneration)
        .run();
      if (Number(renewal.meta?.changes ?? 0) !== 1) {
        throw new PlatformError(
          409,
          "catalog_sync_lease_lost",
          "目录同步租约已失效，本次快照不会发布。",
        );
      }
      const statements = entries
        .slice(offset, offset + 50)
        .map((entry, batchIndex) => {
          const customerPrice = Math.max(
            entry.upstreamPriceUsdMicros,
            Math.ceil(
              (entry.upstreamPriceUsdMicros * (10_000 + markupBps)) /
                10_000,
            ),
          );
          return db
            .prepare(
              `INSERT INTO catalog_sync_staging
               (id, generation, path, platform, http_method, summary,
                description, parameter_schema_json,
                upstream_price_usd_micros,
                suggested_customer_price_usd_micros,
                price_verified, looks_read_only, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            )
            .bind(
              `${syncGeneration}:${offset + batchIndex}`,
              syncGeneration,
              entry.path,
              entry.platform,
              entry.httpMethod,
              entry.summary,
              entry.description,
              entry.parameterSchemaJson,
              entry.upstreamPriceUsdMicros,
              customerPrice,
              entry.priceVerified ? 1 : 0,
              entry.looksReadOnly ? 1 : 0,
            );
        });
      await db.batch(statements);
      synced += statements.length;
    }
    const staged = await db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM catalog_sync_staging
         WHERE generation = ?`,
      )
      .bind(syncGeneration)
      .first<{ count: number }>();
    if (Number(staged?.count ?? 0) !== entries.length) {
      throw new PlatformError(
        409,
        "catalog_snapshot_incomplete",
        "目录暂存快照不完整，本次不会发布。",
      );
    }

    const publishCredential = await resolveTikHubCredential(env, db);
    if (
      !publishCredential ||
      publishCredential.id !== credential.id ||
      publishCredential.source !== credential.source ||
      publishCredential.fingerprint !== credential.fingerprint ||
      publishCredential.stateVersion !== credential.stateVersion
    ) {
      throw new PlatformError(
        409,
        "catalog_sync_credential_changed",
        "TikHub 活动凭据在同步期间发生变化，本次快照不会发布。",
      );
    }
    const managedCredentialFlag =
      credential.source === "managed" ? 1 : 0;
    const finalization = await db.batch([
      db
        .prepare(
          `INSERT INTO endpoint_catalog
           (path, platform, http_method, summary, description,
            parameter_schema_json, upstream_price_usd_micros,
            customer_price_usd_micros, price_verified, enabled, read_only,
            source_updated_at, sync_generation, created_at, updated_at)
           SELECT s.path, s.platform, s.http_method, s.summary,
                  s.description, s.parameter_schema_json,
                  s.upstream_price_usd_micros,
                  s.suggested_customer_price_usd_micros,
                  s.price_verified, 0, s.looks_read_only,
                  CURRENT_TIMESTAMP, s.generation,
                  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
           FROM catalog_sync_staging s
           WHERE s.generation = ?
             AND EXISTS (
               SELECT 1 FROM catalog_sync_locks l
               WHERE l.id = 1 AND l.generation = ?
             )
             AND EXISTS (
               SELECT 1 FROM upstream_credential_state u
               WHERE u.provider = 'tikhub' AND u.version = ?
                 AND u.managed_enabled = ?
                 AND u.active_credential_id IS ?
             )
           ON CONFLICT(path) DO UPDATE SET
             platform = excluded.platform,
             http_method = excluded.http_method,
             summary = excluded.summary,
             description = excluded.description,
             parameter_schema_json = excluded.parameter_schema_json,
             upstream_price_usd_micros = excluded.upstream_price_usd_micros,
             price_verified = excluded.price_verified,
             customer_price_usd_micros =
               endpoint_catalog.customer_price_usd_micros,
             enabled = CASE
               WHEN excluded.price_verified = 0
                 OR endpoint_catalog.http_method != excluded.http_method
                 OR endpoint_catalog.upstream_price_usd_micros !=
                    excluded.upstream_price_usd_micros
               THEN 0
               ELSE endpoint_catalog.enabled
             END,
             read_only = CASE
               WHEN excluded.read_only = 0 THEN 0
               ELSE endpoint_catalog.read_only
             END,
             reviewed_at = CASE
               WHEN excluded.price_verified = 0
                 OR endpoint_catalog.http_method != excluded.http_method
                 OR endpoint_catalog.upstream_price_usd_micros !=
                    excluded.upstream_price_usd_micros
                 OR excluded.read_only = 0
               THEN NULL
               ELSE endpoint_catalog.reviewed_at
             END,
             sync_generation = excluded.sync_generation,
             source_updated_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          syncGeneration,
          syncGeneration,
          credential.stateVersion,
          managedCredentialFlag,
          credential.id,
        ),
      db
        .prepare(
          `UPDATE endpoint_catalog
           SET enabled = 0, reviewed_at = NULL, source_updated_at = NULL,
               sync_generation = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE NOT EXISTS (
             SELECT 1
             FROM catalog_sync_staging s
             WHERE s.generation = ? AND s.path = endpoint_catalog.path
           )
             AND EXISTS (
               SELECT 1 FROM catalog_sync_locks l
               WHERE l.id = 1 AND l.generation = ?
             )
             AND EXISTS (
               SELECT 1 FROM upstream_credential_state u
               WHERE u.provider = 'tikhub' AND u.version = ?
                 AND u.managed_enabled = ?
                 AND u.active_credential_id IS ?
             )`,
        )
        .bind(
          syncGeneration,
          syncGeneration,
          credential.stateVersion,
          managedCredentialFlag,
          credential.id,
        ),
      db
        .prepare(
          `INSERT INTO catalog_sync_state
           (id, last_success_generation, credential_source,
            credential_id, credential_fingerprint,
            credential_state_version, synced_at)
           SELECT 1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
           WHERE EXISTS (
             SELECT 1 FROM catalog_sync_locks
             WHERE id = 1 AND generation = ?
           )
             AND EXISTS (
               SELECT 1 FROM upstream_credential_state u
               WHERE u.provider = 'tikhub' AND u.version = ?
                 AND u.managed_enabled = ?
                 AND u.active_credential_id IS ?
             )
           ON CONFLICT(id) DO UPDATE SET
             last_success_generation = excluded.last_success_generation,
             credential_source = excluded.credential_source,
             credential_id = excluded.credential_id,
             credential_fingerprint = excluded.credential_fingerprint,
             credential_state_version =
               excluded.credential_state_version,
             synced_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          syncGeneration,
          credential.source,
          credential.id,
          credential.fingerprint,
          credential.stateVersion,
          syncGeneration,
          credential.stateVersion,
          managedCredentialFlag,
          credential.id,
        ),
      db
        .prepare(
          `DELETE FROM catalog_sync_staging
           WHERE generation = ?`,
        )
        .bind(syncGeneration),
    ]);
    const published = await db
      .prepare(
        `SELECT last_success_generation, credential_source,
                credential_id, credential_fingerprint,
                credential_state_version
         FROM catalog_sync_state
         WHERE id = 1`,
      )
      .first<{
        last_success_generation: string;
        credential_source: string | null;
        credential_id: string | null;
        credential_fingerprint: string | null;
        credential_state_version: number | null;
      }>();
    if (
      published?.last_success_generation !== syncGeneration ||
      published.credential_source !== credential.source ||
      published.credential_id !== credential.id ||
      published.credential_fingerprint !== credential.fingerprint ||
      Number(published.credential_state_version) !==
        credential.stateVersion
    ) {
      throw new PlatformError(
        409,
        "catalog_sync_lease_lost",
        "目录同步租约已失效，本次快照未发布。",
      );
    }
    await writeAdminAudit(db, request, {
      action: "catalog.synced",
      targetType: "catalog_generation",
      targetId: syncGeneration,
      details: {
        synced,
        priced: entries.filter((entry) => entry.priceVerified).length,
        awaitingPrice: entries.filter((entry) => !entry.priceVerified)
          .length,
        disabledMissing: Number(finalization[1]?.meta?.changes ?? 0),
      },
    });

    return jsonResponse(
      {
        synced,
        priced: entries.filter((entry) => entry.priceVerified).length,
        awaitingPrice: entries.filter((entry) => !entry.priceVerified).length,
        disabledMissing: Number(finalization[1]?.meta?.changes ?? 0),
        note: "新端点默认禁用；已审核端点的上游价格一旦变化会自动停用并清除审核状态，客户价格不会被同步任务静默覆盖。",
      },
      200,
      requestId,
    );
  } finally {
    await db.batch([
      db
        .prepare(
          `DELETE FROM catalog_sync_staging
           WHERE generation = ?`,
        )
        .bind(syncGeneration),
      db
        .prepare(
          `DELETE FROM catalog_sync_locks
           WHERE id = 1 AND generation = ?`,
        )
        .bind(syncGeneration),
    ]);
  }
}

async function handleCatalogUpdate(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "catalog");
  const body = await readJsonBody<{
    path?: unknown;
    enabled?: unknown;
    readOnly?: unknown;
    customerPriceUsdMicros?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  if (typeof body.path !== "string") {
    throw new PlatformError(400, "invalid_endpoint", "端点路径无效。");
  }
  const path = normalizeCatalogPath(body.path);
  if (
    typeof body.enabled !== "boolean" ||
    typeof body.readOnly !== "boolean"
  ) {
    throw new PlatformError(
      400,
      "invalid_endpoint_review",
      "必须明确设置 enabled 与 readOnly。",
    );
  }
  if (body.enabled && !body.readOnly) {
    throw new PlatformError(
      400,
      "unsafe_endpoint",
      "MVP 不允许启用非只读端点。",
    );
  }
  const price =
    typeof body.customerPriceUsdMicros === "number"
      ? body.customerPriceUsdMicros
      : Number.NaN;
  if (!Number.isSafeInteger(price) || price < 1 || price > 100_000_000) {
    throw new PlatformError(
      400,
      "invalid_endpoint_price",
      "客户价格必须是有效的美元微单位整数。",
    );
  }

  const db = requireDb(env);
  const existing = await db
    .prepare(
      `SELECT http_method, upstream_price_usd_micros, price_verified,
              sync_generation,
              (
                SELECT last_success_generation
                FROM catalog_sync_state
                WHERE id = 1
              ) AS last_success_generation
       FROM endpoint_catalog
       WHERE path = ?`,
    )
    .bind(path)
    .first<{
      upstream_price_usd_micros: number;
      http_method: string;
      price_verified: number;
      sync_generation: string | null;
      last_success_generation: string | null;
    }>();
  if (!existing) {
    throw new PlatformError(
      404,
      "endpoint_not_found",
      "目录中没有这个端点，请先同步上游目录。",
    );
  }
  if (
    body.enabled &&
    (existing.sync_generation == null ||
      existing.sync_generation !== existing.last_success_generation)
  ) {
    throw new PlatformError(
      409,
      "endpoint_not_in_latest_catalog",
      "该端点不在最近一次成功同步的上游目录中，不能重新启用。",
    );
  }
  if (price < existing.upstream_price_usd_micros) {
    throw new PlatformError(
      400,
      "price_below_upstream_cost",
      "客户价格不能低于当前上游成本。",
    );
  }
  if (
    body.readOnly &&
    (existing.http_method !== "GET" && existing.http_method !== "POST")
  ) {
    throw new PlatformError(
      409,
      "unsupported_endpoint_method",
      "该端点的请求方法不受支持。",
    );
  }
  if (
    body.readOnly &&
    !looksLikeReadOnlyOperation(
      path,
      existing.http_method as "GET" | "POST",
    )
  ) {
    throw new PlatformError(
      403,
      "unsafe_endpoint",
      "账户、Cookie、发布、互动或其他高风险端点不能标记为公开只读服务。",
    );
  }
  if (body.enabled && existing.price_verified !== 1) {
    throw new PlatformError(
      409,
      "endpoint_price_unverified",
      "该端点尚未从 TikHub 价格目录获得可验证价格，不能启用。",
    );
  }
  const result = await db
    .prepare(
      `UPDATE endpoint_catalog
       SET enabled = ?, read_only = ?, customer_price_usd_micros = ?,
           reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE path = ?
         AND http_method = ?
         AND upstream_price_usd_micros = ?
         AND price_verified = ?
         AND sync_generation IS ?
         AND ? >= upstream_price_usd_micros
         AND (
           ? = 0
           OR (
             price_verified = 1
             AND sync_generation = (
               SELECT last_success_generation
               FROM catalog_sync_state
               WHERE id = 1
             )
           )
         )`,
    )
    .bind(
      body.enabled ? 1 : 0,
      body.readOnly ? 1 : 0,
      price,
      path,
      existing.http_method,
      existing.upstream_price_usd_micros,
      existing.price_verified,
      existing.sync_generation,
      price,
      body.enabled ? 1 : 0,
    )
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new PlatformError(
      409,
      "catalog_update_conflict",
      "目录在审核期间发生变化，请刷新后重新确认成本与状态。",
    );
  }
  await writeAdminAudit(db, request, {
    action: "catalog.endpoint_updated",
    targetType: "catalog_endpoint",
    targetId: path,
    details: {
      enabled: body.enabled,
      readOnly: body.readOnly,
      customerPriceUsdMicros: price,
      upstreamPriceUsdMicros: existing.upstream_price_usd_micros,
      syncGeneration: existing.sync_generation,
    },
  });

  return jsonResponse(
    { ok: true, path, enabled: body.enabled, readOnly: body.readOnly },
    200,
    requestId,
  );
}

async function handleReconciliation(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env, "reconciliation");
  const db = requireDb(env);
  const stale = await db
    .prepare(
      `SELECT id, user_id, ledger_reference_id, cost_usd_micros
       FROM proxy_requests
       WHERE status IN ('processing', 'charged')
         AND datetime(created_at) < datetime('now', '-2 minutes')
       ORDER BY created_at ASC
       LIMIT 100`,
    )
    .all<{
      id: string;
      user_id: string;
      ledger_reference_id: string;
      cost_usd_micros: number;
    }>();

  let refunded = 0;
  for (const item of stale.results ?? []) {
    const refund = await db
      .prepare(
        `INSERT OR IGNORE INTO balance_ledger
         (id, user_id, entry_type, delta_usd_micros, reference_id, description, created_at)
         SELECT ?, ?, 'api_reconciliation', ?, ?,
                'Stale proxy request reconciliation', CURRENT_TIMESTAMP
         WHERE EXISTS (
           SELECT 1 FROM balance_ledger
           WHERE reference_id = ? AND delta_usd_micros = ?
         )
         AND EXISTS (
           SELECT 1 FROM proxy_requests
           WHERE id = ?
             AND status IN ('processing', 'charged')
             AND datetime(created_at) < datetime('now', '-2 minutes')
         )`,
      )
      .bind(
        `led_${randomBase64Url(16)}`,
        item.user_id,
        item.cost_usd_micros,
        `${item.ledger_reference_id}:refund`,
        item.ledger_reference_id,
        -item.cost_usd_micros,
        item.id,
      )
      .run();
    const changes = Number(refund.meta?.changes ?? 0);
    refunded += changes;
    const refundReference = `${item.ledger_reference_id}:refund`;
    const refundRecorded =
      changes === 1 ||
      Boolean(
        await db
          .prepare(
            `SELECT 1 AS present
             FROM balance_ledger
             WHERE reference_id = ?
             LIMIT 1`,
          )
          .bind(refundReference)
          .first<{ present: number }>(),
      );
    if (refundRecorded) {
      await db
        .prepare(
          `UPDATE proxy_requests
           SET status = 'reconciled', response_status = 500,
               completed_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status IN ('processing', 'charged')`,
        )
        .bind(item.id)
        .run();
    }
  }

  let paymentEventsProcessed = 0;
  let paymentsPolled = 0;
  let creditedPaymentsPolled = 0;
  let rejectedPaymentsPolled = 0;
  let paymentErrors = 0;
  const paymentApiKey = env.NOWPAYMENTS_API_KEY;
  if (paymentApiKey) {
    const events = await db
      .prepare(
        `SELECT id, provider_payment_id, order_id
         FROM payment_events
         WHERE provider = 'nowpayments' AND processed_at IS NULL
           AND datetime(next_attempt_at) <= datetime('now')
         ORDER BY attempt_count ASC, next_attempt_at ASC, received_at ASC
         LIMIT 12`,
      )
      .all<{
        id: string;
        provider_payment_id: string;
        order_id: string;
      }>();
    const eventRows = events.results ?? [];
    for (let offset = 0; offset < eventRows.length; offset += 3) {
      await Promise.all(
        eventRows.slice(offset, offset + 3).map(async (event) => {
          await processNowPaymentsEvent(db, paymentApiKey, {
            eventId: event.id,
            paymentId: event.provider_payment_id,
            orderId: event.order_id,
            requestId,
          });
          const processed = await db
            .prepare(
              `SELECT processed_at
               FROM payment_events
               WHERE id = ?`,
            )
            .bind(event.id)
            .first<{ processed_at: string | null }>();
          if (processed?.processed_at) paymentEventsProcessed += 1;
          else paymentErrors += 1;
        }),
      );
    }

    const pendingPayments = await db
      .prepare(
        `SELECT id, provider_payment_id
         FROM payment_orders
         WHERE provider = 'nowpayments'
           AND provider_payment_id IS NOT NULL
           AND (
             (
               status IN ('waiting', 'confirming', 'confirmed', 'sending',
                          'creating')
               AND datetime(updated_at) < datetime('now', '-1 minute')
             )
             OR (
               status = 'expired'
               AND datetime(updated_at) < datetime('now', '-6 hours')
               AND datetime(created_at) >= datetime('now', '-7 days')
             )
           )
         ORDER BY updated_at ASC
         LIMIT 12`,
      )
      .all<{ id: string; provider_payment_id: string }>();
    const pendingRows = pendingPayments.results ?? [];
    for (let offset = 0; offset < pendingRows.length; offset += 3) {
      await Promise.all(
        pendingRows.slice(offset, offset + 3).map(async (payment) => {
          try {
            const verified = await getNowPaymentsPayment(
              paymentApiKey,
              payment.provider_payment_id,
            );
            await applyVerifiedNowPayment(db, verified, {
              paymentId: payment.provider_payment_id,
              orderId: payment.id,
              requestId,
            });
            await db
              .prepare(
                `INSERT INTO operation_heartbeats
                 (name, last_success_at, details_json)
                 VALUES (?, CURRENT_TIMESTAMP, ?)
                 ON CONFLICT(name) DO UPDATE SET
                   last_success_at = CURRENT_TIMESTAMP,
                   details_json = excluded.details_json`,
              )
              .bind(
                `payment-status:${payment.provider_payment_id}`,
                JSON.stringify({
                  orderId: payment.id,
                  source: "pending_reconciliation",
                }),
              )
              .run();
            paymentsPolled += 1;
          } catch (error) {
            paymentErrors += 1;
            await db
              .prepare(
                `UPDATE payment_orders
                 SET updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
              )
              .bind(payment.id)
              .run();
            console.error("Payment reconciliation failed", {
              requestId,
              orderId: payment.id,
              paymentId: payment.provider_payment_id,
              error: error instanceof Error ? error.message : "unknown error",
            });
          }
        }),
      );
    }

    const rejectedCandidates = await db
      .prepare(
        `SELECT r.order_id, r.provider_payment_id
         FROM payment_review_cases r
         JOIN payment_orders p ON p.id = r.order_id
         LEFT JOIN operation_heartbeats h
           ON h.name =
              'payment-rejected-status:' || r.provider_payment_id
         WHERE p.provider = 'nowpayments'
           AND r.status = 'resolved'
           AND r.resolution_action = 'reject'
           AND r.resolved_at IS NOT NULL
           AND datetime(r.resolved_at) >= datetime('now', '-7 days')
           AND datetime(r.resolved_at) <= datetime('now', '-6 hours')
           AND NOT EXISTS (
             SELECT 1
             FROM balance_ledger l
             WHERE l.delta_usd_micros > 0
               AND l.reference_id IN (
                 'nowpayments:' || r.provider_payment_id || ':credit',
                 'nowpayments-review:' || r.id || ':credit'
               )
           )
           AND (
             h.name IS NULL
             OR datetime(h.last_success_at) <
                datetime('now', '-6 hours')
           )
         ORDER BY COALESCE(h.last_success_at, r.resolved_at) ASC,
                  r.provider_payment_id ASC
         LIMIT 4`,
      )
      .all<{ order_id: string; provider_payment_id: string }>();
    const rejectedRows = rejectedCandidates.results ?? [];
    for (let offset = 0; offset < rejectedRows.length; offset += 2) {
      await Promise.all(
        rejectedRows.slice(offset, offset + 2).map(async (payment) => {
          const heartbeatName =
            `payment-rejected-status:${payment.provider_payment_id}`;
          const claimed = await db
            .prepare(
              `INSERT INTO operation_heartbeats
               (name, last_success_at, details_json)
               VALUES (?, CURRENT_TIMESTAMP, ?)
               ON CONFLICT(name) DO UPDATE SET
                 last_success_at = CURRENT_TIMESTAMP,
                 details_json = excluded.details_json
               WHERE datetime(operation_heartbeats.last_success_at) <
                     datetime('now', '-6 hours')
               RETURNING name`,
            )
            .bind(
              heartbeatName,
              JSON.stringify({
                orderId: payment.order_id,
                source: "rejected_payment_reconciliation",
                state: "polling",
              }),
            )
            .first<{ name: string }>();
          if (!claimed) return;
          let pollError: string | null = null;
          try {
            const verified = await getNowPaymentsPayment(
              paymentApiKey,
              payment.provider_payment_id,
            );
            await applyVerifiedNowPayment(db, verified, {
              paymentId: payment.provider_payment_id,
              orderId: payment.order_id,
              requestId,
            });
            rejectedPaymentsPolled += 1;
          } catch (error) {
            paymentErrors += 1;
            pollError =
              error instanceof Error
                ? error.message.slice(0, 300)
                : "unknown error";
            console.error("Rejected payment status polling failed", {
              requestId,
              orderId: payment.order_id,
              paymentId: payment.provider_payment_id,
              error: pollError,
            });
          } finally {
            const nextRotationTimestamp = new Date(
              Date.now() - (pollError ? 5 * 60 * 60_000 : 0),
            ).toISOString();
            await db
              .prepare(
                `INSERT INTO operation_heartbeats
                 (name, last_success_at, details_json)
                 VALUES (?, ?, ?)
                 ON CONFLICT(name) DO UPDATE SET
                   last_success_at = excluded.last_success_at,
                   details_json = excluded.details_json`,
              )
              .bind(
                heartbeatName,
                nextRotationTimestamp,
                JSON.stringify({
                  orderId: payment.order_id,
                  source: "rejected_payment_reconciliation",
                  error: pollError,
                }),
              )
              .run();
          }
        }),
      );
    }

    const creditedCandidates = await db
      .prepare(
        `WITH candidates(order_id, provider_payment_id) AS (
           SELECT p.id, p.provider_payment_id
           FROM payment_orders p
           JOIN balance_ledger credit
             ON credit.reference_id =
                'nowpayments:' || p.provider_payment_id || ':credit'
              AND credit.delta_usd_micros > 0
           LEFT JOIN balance_ledger reversal
             ON reversal.reference_id =
                'nowpayments:' || p.provider_payment_id || ':reversal'
           WHERE p.provider = 'nowpayments'
             AND p.provider_payment_id IS NOT NULL
             AND datetime(p.created_at) >= datetime('now', '-180 days')
             AND reversal.id IS NULL
           UNION
           SELECT r.order_id, r.provider_payment_id
           FROM payment_review_cases r
           JOIN balance_ledger credit
             ON credit.reference_id =
                'nowpayments-review:' || r.id || ':credit'
              AND credit.delta_usd_micros > 0
           LEFT JOIN balance_ledger reversal
             ON reversal.reference_id =
                'nowpayments-review:' || r.id || ':reversal'
           WHERE reversal.id IS NULL
         )
         SELECT c.order_id, c.provider_payment_id
         FROM candidates c
         LEFT JOIN operation_heartbeats h
           ON h.name = 'payment-status:' || c.provider_payment_id
         WHERE h.name IS NULL
            OR datetime(h.last_success_at) <
               datetime('now', '-6 hours')
         ORDER BY COALESCE(h.last_success_at, '1970-01-01') ASC,
                  c.provider_payment_id ASC
         LIMIT 12`,
      )
      .all<{ order_id: string; provider_payment_id: string }>();
    const creditedRows = creditedCandidates.results ?? [];
    for (let offset = 0; offset < creditedRows.length; offset += 3) {
      await Promise.all(
        creditedRows.slice(offset, offset + 3).map(async (payment) => {
          let pollError: string | null = null;
          try {
            const verified = await getNowPaymentsPayment(
              paymentApiKey,
              payment.provider_payment_id,
            );
            await applyVerifiedNowPayment(db, verified, {
              paymentId: payment.provider_payment_id,
              orderId: payment.order_id,
              requestId,
            });
            creditedPaymentsPolled += 1;
          } catch (error) {
            paymentErrors += 1;
            pollError =
              error instanceof Error
                ? error.message.slice(0, 300)
                : "unknown error";
            console.error("Credited payment status polling failed", {
              requestId,
              orderId: payment.order_id,
              paymentId: payment.provider_payment_id,
              error: pollError,
            });
          } finally {
            const nextRotationTimestamp = new Date(
              Date.now() - (pollError ? 5 * 60 * 60_000 : 0),
            ).toISOString();
            await db
              .prepare(
                `INSERT INTO operation_heartbeats
                 (name, last_success_at, details_json)
                 VALUES (?, ?, ?)
                 ON CONFLICT(name) DO UPDATE SET
                   last_success_at = excluded.last_success_at,
                   details_json = excluded.details_json`,
              )
              .bind(
                `payment-status:${payment.provider_payment_id}`,
                nextRotationTimestamp,
                JSON.stringify({
                  orderId: payment.order_id,
                  error: pollError,
                }),
              )
              .run();
          }
        }),
      );
    }
  }

  await db.batch([
    db
      .prepare(
        `DELETE FROM payment_rate_limit_buckets
         WHERE datetime(updated_at) < datetime('now', '-2 days')`,
      ),
    db
      .prepare(
        `DELETE FROM upstream_rate_limit_buckets
         WHERE datetime(updated_at) < datetime('now', '-10 minutes')`,
      ),
    db
      .prepare(
        `DELETE FROM payment_events
         WHERE processed_at IS NOT NULL
           AND datetime(processed_at) < datetime('now', '-90 days')`,
      ),
    db
      .prepare(
        `DELETE FROM auth_rate_limit_buckets
         WHERE datetime(updated_at) < datetime('now', '-2 days')`,
      ),
    db
      .prepare(
        `DELETE FROM auth_challenges
         WHERE datetime(expires_at) < datetime('now', '-1 day')
            OR (consumed_at IS NOT NULL
                AND datetime(consumed_at) < datetime('now', '-1 day'))`,
      ),
    db
      .prepare(
        `DELETE FROM auth_sessions
         WHERE datetime(expires_at) <= datetime('now')`,
      ),
    db
      .prepare(
        `DELETE FROM operation_heartbeats
         WHERE (
             name LIKE 'payment-status:%'
             OR name LIKE 'payment-rejected-status:%'
           )
           AND datetime(last_success_at) < datetime('now', '-200 days')`,
      ),
    db
      .prepare(
        `INSERT INTO operation_heartbeats
         (name, last_success_at, details_json)
         VALUES ('reconciliation', CURRENT_TIMESTAMP, ?)
         ON CONFLICT(name) DO UPDATE SET
           last_success_at = CURRENT_TIMESTAMP,
           details_json = excluded.details_json`,
      )
      .bind(
        JSON.stringify({
          refunded,
          paymentEventsProcessed,
          paymentsPolled,
          creditedPaymentsPolled,
          rejectedPaymentsPolled,
          paymentErrors,
        }),
      ),
  ]);

  return jsonResponse(
    {
      proxy: {
        inspected: stale.results?.length ?? 0,
        refunded,
      },
      payments: {
        eventsProcessed: paymentEventsProcessed,
        polled: paymentsPolled,
        creditedPolled: creditedPaymentsPolled,
        rejectedPolled: rejectedPaymentsPolled,
        errors: paymentErrors,
        skipped: paymentApiKey ? null : "NOWPAYMENTS_API_KEY 未配置",
      },
      note: "回退两分钟前仍未完成且存在扣款流水的代理请求，并复核未处理事件、待确认充值、近期零入账拒绝案件与已入账退款状态。",
    },
    200,
    requestId,
  );
}

async function createNowPaymentsPayment(
  apiKey: string,
  input: {
    amountUsd: number;
    payCurrency: string;
    orderId: string;
    appOrigin: string;
  },
): Promise<NowPaymentsPayment> {
  let response: Response;
  try {
    response = await fetch("https://api.nowpayments.io/v1/payment", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        price_amount: input.amountUsd,
        price_currency: "usd",
        pay_currency: input.payCurrency,
        order_id: input.orderId,
        order_description: `RelayBase API balance · ${input.orderId}`,
        ipn_callback_url: `${input.appOrigin}/api/payments/nowpayments/ipn`,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new PlatformError(
      502,
      "payment_provider_error",
      "支付服务商暂时不可用。",
    );
  }
  const payload = (await readResponseJson(
    response,
    MAX_PROVIDER_RESPONSE_BYTES,
    "invalid_provider_response",
  ).catch(() => null)) as
    | NowPaymentsPayment
    | { message?: string }
    | null;
  if (!response.ok) {
    const providerMessage =
      isPlainRecord(payload) &&
      "message" in payload &&
      typeof payload.message === "string" &&
      payload.message.length < 180
        ? `：${payload.message}`
        : "";
    throw new PlatformError(
      502,
      "payment_provider_error",
      `支付服务商创建订单失败${providerMessage}`,
    );
  }
  if (!isPlainRecord(payload)) {
    throw new PlatformError(
      502,
      "invalid_provider_response",
      "支付服务商返回了无法识别的订单。",
    );
  }
  const payment = payload as NowPaymentsPayment;
  const paymentId = String(payment.payment_id ?? "");
  const payAmount = normalizedPositiveDecimal(payment.pay_amount);
  const paymentStatus =
    typeof payment.payment_status === "string"
      ? payment.payment_status.trim().toLowerCase()
      : "waiting";
  const invoiceUrl = safeInvoiceUrl(
    typeof payment.invoice_url === "string" ? payment.invoice_url : null,
  );
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(paymentId) ||
    payment.order_id !== input.orderId ||
    parseUsdMicros(payment.price_amount) !== input.amountUsd * 1_000_000 ||
    typeof payment.price_currency !== "string" ||
    payment.price_currency.toLowerCase() !== "usd" ||
    typeof payment.pay_currency !== "string" ||
    payment.pay_currency.toLowerCase() !== input.payCurrency ||
    !NOWPAYMENTS_STATUSES.has(paymentStatus) ||
    typeof payment.pay_address !== "string" ||
    payment.pay_address.length < 8 ||
    payment.pay_address.length > 256 ||
    payAmount == null ||
    (payment.invoice_url != null && invoiceUrl == null)
  ) {
    throw new PlatformError(
      502,
      "invalid_provider_response",
      "支付服务商返回了无法识别的订单。",
    );
  }
  return {
    ...payment,
    payment_id: paymentId,
    pay_amount: payAmount,
    pay_currency: input.payCurrency,
    payment_status: paymentStatus,
    invoice_url: invoiceUrl ?? undefined,
  };
}

async function getNowPaymentsPayment(
  apiKey: string,
  paymentId: string,
): Promise<NowPaymentsPayment> {
  let response: Response;
  try {
    response = await fetch(
      `https://api.nowpayments.io/v1/payment/${encodeURIComponent(paymentId)}`,
      {
        headers: {
          "x-api-key": apiKey,
          accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(6_000),
      },
    );
  } catch {
    throw new PlatformError(
      502,
      "provider_verification_failed",
      "支付服务商订单复核暂时不可用。",
    );
  }
  if (!response.ok) {
    throw new PlatformError(
      502,
      "provider_verification_failed",
      `支付服务商订单复核失败（${response.status}）。`,
    );
  }
  const payload = await readResponseJson(
    response,
    MAX_PROVIDER_RESPONSE_BYTES,
    "provider_verification_failed",
  ).catch(() => null);
  if (!isPlainRecord(payload)) {
    throw new PlatformError(
      502,
      "provider_verification_failed",
      "支付服务商返回了无法识别的订单状态。",
    );
  }
  return payload as NowPaymentsPayment;
}

async function managedTikHubCredentialsSnapshot(
  db: D1Database,
): Promise<{
  credentials: ManagedUpstreamCredentialRecord[];
  activeCredentialId: string | null;
  managedEnabled: boolean;
  stateVersion: number;
}> {
  const state = await upstreamCredentialState(db);
  let rows: D1Result<ManagedUpstreamCredentialRecord>;
  try {
    rows = await db
      .prepare(
        `SELECT c.id, c.label, c.encrypted_secret, c.secret_hash,
                c.verified_scopes_json, c.expires_at,
                CASE
                  WHEN c.revoked_at IS NOT NULL THEN 'revoked'
                  WHEN s.active_credential_id = c.id THEN 'active'
                  ELSE 'standby'
                END AS status,
                c.verified_at, c.created_at, c.last_used_at, c.revoked_at
         FROM upstream_credentials c
         JOIN upstream_credential_state s
           ON s.provider = c.provider
         WHERE c.provider = 'tikhub'
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT 100`,
      )
      .all<ManagedUpstreamCredentialRecord>();
  } catch {
    throw new PlatformError(
      503,
      "database_migrations_required",
      "TikHub 凭据库迁移尚未完成。",
    );
  }
  return {
    credentials: rows.results ?? [],
    activeCredentialId: state.activeCredentialId,
    managedEnabled: state.managedEnabled,
    stateVersion: state.version,
  };
}

async function upstreamCredentialState(
  db: D1Database,
): Promise<{
  activeCredentialId: string | null;
  managedEnabled: boolean;
  version: number;
}> {
  try {
    const row = await db
      .prepare(
        `SELECT active_credential_id, managed_enabled, version
         FROM upstream_credential_state
         WHERE provider = 'tikhub'`,
      )
      .first<{
        active_credential_id: string | null;
        managed_enabled: number;
        version: number;
      }>();
    const managedEnabled = Number(row?.managed_enabled);
    const version = Number(row?.version);
    if (
      !row ||
      (managedEnabled !== 0 && managedEnabled !== 1) ||
      !Number.isSafeInteger(version) ||
      version < 0 ||
      (managedEnabled === 0 && row.active_credential_id !== null)
    ) {
      throw new Error("missing credential state");
    }
    return {
      activeCredentialId: row.active_credential_id,
      managedEnabled: managedEnabled === 1,
      version,
    };
  } catch {
    throw new PlatformError(
      503,
      "database_migrations_required",
      "TikHub 凭据库迁移尚未完成。",
    );
  }
}

async function managedTikHubCredentialById(
  db: D1Database,
  id: string,
): Promise<ManagedUpstreamCredentialRecord | null> {
  try {
    return await db
      .prepare(
        `SELECT c.id, c.label, c.encrypted_secret, c.secret_hash,
                c.verified_scopes_json, c.expires_at,
                CASE
                  WHEN c.revoked_at IS NOT NULL THEN 'revoked'
                  WHEN s.active_credential_id = c.id THEN 'active'
                  ELSE 'standby'
                END AS status,
                c.verified_at, c.created_at, c.last_used_at, c.revoked_at
         FROM upstream_credentials c
         JOIN upstream_credential_state s
           ON s.provider = c.provider
         WHERE c.provider = 'tikhub' AND c.id = ?`,
      )
      .bind(id)
      .first<ManagedUpstreamCredentialRecord>();
  } catch {
    throw new PlatformError(
      503,
      "database_migrations_required",
      "TikHub 凭据库迁移尚未完成。",
    );
  }
}

function publicManagedTikHubCredential(
  credential: ManagedUpstreamCredentialRecord,
) {
  let scopeCount = 0;
  try {
    const scopes = normalizeTikHubCredentialScopes(
      credential.verified_scopes_json
        ? (JSON.parse(credential.verified_scopes_json) as unknown)
        : null,
    );
    scopeCount = scopes?.length ?? 0;
  } catch {
    scopeCount = 0;
  }
  return {
    id: credential.id,
    label: credential.label,
    fingerprint: credential.secret_hash.slice(0, 16),
    status: credential.status,
    scopeCount,
    expiresAt: credential.expires_at,
    verifiedAt: credential.verified_at,
    createdAt: credential.created_at,
    lastUsedAt: credential.last_used_at,
    revokedAt: credential.revoked_at,
  };
}

async function activateManagedTikHubCredential(
  db: D1Database,
  request: Request,
  id: string,
  expectedVersion: number,
): Promise<void> {
  const existing = await managedTikHubCredentialById(db, id);
  if (!existing) {
    throw new PlatformError(
      404,
      "upstream_credential_not_found",
      "没有找到这个 TikHub 凭据。",
    );
  }
  if (existing.status === "revoked") {
    throw new PlatformError(
      409,
      "upstream_credential_revoked",
      "已撤销的 TikHub 凭据不能再次使用。",
    );
  }
  const activated = await db
    .prepare(
      `UPDATE upstream_credential_state
       SET managed_enabled = 1, active_credential_id = ?,
           version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE provider = 'tikhub' AND version = ?
         AND EXISTS (
           SELECT 1 FROM upstream_credentials
           WHERE id = ? AND provider = 'tikhub' AND revoked_at IS NULL
         )`,
    )
    .bind(id, expectedVersion, id)
    .run();
  if (Number(activated.meta?.changes ?? 0) !== 1) {
    throw new PlatformError(
      409,
      "upstream_credential_update_conflict",
      "TikHub 活动凭据已发生变化，请刷新后重试。",
    );
  }
  await db
    .prepare(
      `DELETE FROM catalog_sync_state
       WHERE id = 1
         AND EXISTS (
           SELECT 1 FROM upstream_credential_state
           WHERE provider = 'tikhub' AND managed_enabled = 1
             AND active_credential_id = ? AND version = ?
         )`,
    )
    .bind(id, expectedVersion + 1)
    .run();
  await writeAdminAudit(db, request, {
    action: "upstream_credential.activated",
    targetType: "upstream_credential",
    targetId: id,
    details: {
      provider: "tikhub",
      label: existing.label,
      fingerprint: existing.secret_hash.slice(0, 16),
      previousStateVersion: expectedVersion,
    },
  });
}

function sanitizeUpstreamCredentialLabel(value: unknown): string {
  if (typeof value !== "string") {
    throw new PlatformError(
      400,
      "invalid_upstream_credential_label",
      "TikHub 凭据名称无效。",
    );
  }
  const label = value.replace(/\s+/g, " ").trim();
  if (
    label.length < 2 ||
    label.length > 80 ||
    /[\u0000-\u001F\u007F]/.test(label)
  ) {
    throw new PlatformError(
      400,
      "invalid_upstream_credential_label",
      "TikHub 凭据名称必须是 2–80 个可见字符。",
    );
  }
  return label;
}

function isValidTikHubApiKey(value: string): boolean {
  return /^[\x21-\x7E]{16,512}$/.test(value);
}

function hasValidTikHubCredentialsEncryptionKey(
  value?: string,
): value is string {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  try {
    return base64UrlToBytes(value).length === 32;
  } catch {
    return false;
  }
}

function requireTikHubCredentialsEncryptionKey(env: PlatformEnv): string {
  if (
    !hasValidTikHubCredentialsEncryptionKey(
      env.TIKHUB_CREDENTIALS_ENCRYPTION_KEY,
    )
  ) {
    throw new PlatformError(
      503,
      "upstream_credential_encryption_unavailable",
      "TikHub 凭据加密主密钥尚未正确配置。",
    );
  }
  return env.TIKHUB_CREDENTIALS_ENCRYPTION_KEY;
}

async function importTikHubCredentialsEncryptionKey(
  encodedKey: string,
): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    bytesToArrayBuffer(base64UrlToBytes(encodedKey)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function tikHubCredentialAdditionalData(id: string): ArrayBuffer {
  return bytesToArrayBuffer(
    new TextEncoder().encode(`relaybase:tikhub:${id}:v1`),
  );
}

async function encryptTikHubApiKey(
  apiKey: string,
  encodedKey: string,
  id: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: tikHubCredentialAdditionalData(id),
      tagLength: 128,
    },
    await importTikHubCredentialsEncryptionKey(encodedKey),
    new TextEncoder().encode(apiKey),
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(
    new Uint8Array(ciphertext),
  )}`;
}

async function decryptTikHubApiKey(
  encryptedSecret: string,
  encodedKey: string,
  id: string,
): Promise<string> {
  const parts = encryptedSecret.split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== "v1" ||
    !/^[A-Za-z0-9_-]{16}$/.test(parts[1] ?? "") ||
    !/^[A-Za-z0-9_-]{32,800}$/.test(parts[2] ?? "")
  ) {
    throw new PlatformError(
      503,
      "upstream_credential_decryption_failed",
      "TikHub 凭据密文格式无效，已停止上游调用。",
    );
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytesToArrayBuffer(base64UrlToBytes(parts[1] ?? "")),
        additionalData: tikHubCredentialAdditionalData(id),
        tagLength: 128,
      },
      await importTikHubCredentialsEncryptionKey(encodedKey),
      bytesToArrayBuffer(base64UrlToBytes(parts[2] ?? "")),
    );
    const apiKey = new TextDecoder("utf-8", { fatal: true }).decode(
      plaintext,
    );
    if (!isValidTikHubApiKey(apiKey)) {
      throw new Error("invalid decrypted secret");
    }
    return apiKey;
  } catch {
    throw new PlatformError(
      503,
      "upstream_credential_decryption_failed",
      "TikHub 凭据无法解密，已停止上游调用。",
    );
  }
}

async function verifyTikHubApiKey(
  apiKey: string,
  env: PlatformEnv,
): Promise<TikHubCredentialVerification> {
  const upstreamBase = normalizeUpstreamBase(env.TIKHUB_BASE_URL);
  let response: Response;
  try {
    response = await fetch(`${upstreamBase}/tikhub/user/get_user_info`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new PlatformError(
      502,
      "upstream_credential_verification_failed",
      "TikHub 暂时无法验证这个 API Key。",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new PlatformError(
      400,
      "upstream_credential_rejected",
      "TikHub 拒绝了这个 API Key。",
    );
  }
  if (!response.ok) {
    throw new PlatformError(
      502,
      "upstream_credential_verification_failed",
      `TikHub 凭据验证失败（${response.status}）。`,
    );
  }
  const payload = await readResponseJson(
    response,
    MAX_PROVIDER_RESPONSE_BYTES,
    "upstream_credential_verification_failed",
  );
  if (
    !isPlainRecord(payload) ||
    Number(payload.code) !== 200 ||
    !isPlainRecord(payload.api_key_data) ||
    !isPlainRecord(payload.user_data)
  ) {
    throw new PlatformError(
      502,
      "upstream_credential_verification_failed",
      "TikHub 凭据验证响应格式无效。",
    );
  }
  const apiKeyData = payload.api_key_data;
  const userData = payload.user_data;
  if (
    Number(apiKeyData.api_key_status) !== 1 ||
    userData.account_disabled !== false ||
    userData.is_active !== true
  ) {
    throw new PlatformError(
      400,
      "upstream_credential_inactive",
      "这个 TikHub API Key 或所属账户当前不可用。",
    );
  }
  let expiresAt: string | null = null;
  if (apiKeyData.expires_at !== null) {
    if (
      typeof apiKeyData.expires_at !== "string" ||
      !Number.isFinite(Date.parse(apiKeyData.expires_at)) ||
      Date.parse(apiKeyData.expires_at) <= Date.now()
    ) {
      throw new PlatformError(
        400,
        "upstream_credential_expired",
        "这个 TikHub API Key 已过期。",
      );
    }
    expiresAt = new Date(apiKeyData.expires_at).toISOString();
  }
  const scopes = normalizeTikHubCredentialScopes(
    apiKeyData.api_key_scopes,
  );
  if (!scopes || !hasTikHubDataScope(scopes)) {
    throw new PlatformError(
      400,
      "upstream_credential_scope_insufficient",
      "这个 TikHub API Key 没有可用于数据接口的授权范围。",
    );
  }
  return { scopes, expiresAt };
}

function normalizeTikHubCredentialScopes(
  value: unknown,
): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
    return null;
  }
  const normalized: string[] = [];
  for (const scope of value) {
    if (typeof scope !== "string") return null;
    const compact = scope.trim().toLowerCase().replace(/\/+$/, "");
    if (
      !compact ||
      compact.length > 512 ||
      (compact !== "*" &&
        compact !== "all" &&
        !/^\/api\/v1(?:\/[a-z0-9_-]+)*$/.test(compact))
    ) {
      return null;
    }
    normalized.push(compact);
  }
  return [...new Set(normalized)].sort();
}

function hasTikHubDataScope(scopes: string[]): boolean {
  return scopes.some((normalized) => {
    if (
      normalized === "*" ||
      normalized === "all" ||
      normalized === "/api/v1"
    ) {
      return true;
    }
    if (!normalized.startsWith("/api/v1/")) return false;
    return (
      !normalized.startsWith("/api/v1/tikhub/user") &&
      !normalized.startsWith("/api/v1/tikhub/admin") &&
      !normalized.startsWith("/api/v1/demo")
    );
  });
}

function tikHubCredentialAllowsPath(
  scopes: string[] | null,
  catalogPath: string,
): boolean {
  if (scopes === null) return true;
  const upstreamPath = `/api${catalogPath}`.toLowerCase();
  return scopes.some((scope) => {
    if (scope === "*" || scope === "all" || scope === "/api/v1") {
      return true;
    }
    return (
      upstreamPath === scope ||
      upstreamPath.startsWith(`${scope}/`)
    );
  });
}

function storedTikHubCredentialScopes(value: string | null): string[] {
  if (!value) {
    throw new PlatformError(
      503,
      "upstream_credential_state_invalid",
      "TikHub 活动凭据缺少已验证的授权范围。",
    );
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    const scopes = normalizeTikHubCredentialScopes(parsed);
    if (!scopes || !hasTikHubDataScope(scopes)) throw new Error();
    return scopes;
  } catch {
    throw new PlatformError(
      503,
      "upstream_credential_state_invalid",
      "TikHub 活动凭据授权范围无效，已停止上游调用。",
    );
  }
}

async function resolveTikHubCredential(
  env: PlatformEnv,
  db: D1Database,
): Promise<ResolvedTikHubCredential | null> {
  const state = await upstreamCredentialState(db);
  if (state.managedEnabled) {
    if (!state.activeCredentialId) return null;
    const managed = await managedTikHubCredentialById(
      db,
      state.activeCredentialId,
    );
    if (!managed || managed.status !== "active" || managed.revoked_at) {
      throw new PlatformError(
        503,
        "upstream_credential_state_invalid",
        "TikHub 活动凭据状态无效，已停止上游调用。",
      );
    }
    if (
      managed.expires_at !== null &&
      (!Number.isFinite(Date.parse(managed.expires_at)) ||
        Date.parse(managed.expires_at) <= Date.now())
    ) {
      throw new PlatformError(
        503,
        "upstream_credential_expired",
        "TikHub 活动凭据已过期，已停止上游调用。",
      );
    }
    const encryptionKey = requireTikHubCredentialsEncryptionKey(env);
    return {
      secret: await decryptTikHubApiKey(
        managed.encrypted_secret,
        encryptionKey,
        managed.id,
      ),
      fingerprint: managed.secret_hash.slice(0, 16),
      source: "managed",
      id: managed.id,
      scopes: storedTikHubCredentialScopes(
        managed.verified_scopes_json,
      ),
      expiresAt: managed.expires_at,
      stateVersion: state.version,
    };
  }
  if (!hasConfiguredCredential(env.TIKHUB_API_KEY)) return null;
  return {
    secret: env.TIKHUB_API_KEY,
    fingerprint: (await sha256Hex(env.TIKHUB_API_KEY)).slice(0, 16),
    source: "environment",
    id: null,
    scopes: null,
    expiresAt: null,
    stateVersion: state.version,
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid base64url");
  }
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function platformReadiness(env: PlatformEnv) {
  const databaseConfigured = Boolean(env.DB);
  const legalReviewConfirmed = env.LEGAL_REVIEW_CONFIRMED === "true";
  const resellerAuthorized = env.RESELLER_AUTHORIZED === "true";
  const upstreamConfigured = hasConfiguredCredential(env.TIKHUB_API_KEY);
  const configurationValid = hasValidRuntimeConfiguration(env);
  const masterAdminConfigured =
    hasConfiguredAdminSecret(env.ADMIN_MASTER_SECRET);
  const catalogAdminConfigured =
    masterAdminConfigured ||
    hasConfiguredAdminSecret(env.CATALOG_SYNC_SECRET);
  const reconciliationConfigured =
    hasConfiguredAdminSecret(env.RECONCILIATION_SECRET);
  const paymentAdminConfigured =
    masterAdminConfigured ||
    hasConfiguredAdminSecret(env.PAYMENT_ADMIN_SECRET);
  const adminConfigured =
    catalogAdminConfigured &&
    reconciliationConfigured &&
    paymentAdminConfigured;
  const paymentProviderConfigured =
    (env.PAYMENT_PROVIDER ?? "nowpayments") === "nowpayments" &&
    hasConfiguredCredential(env.NOWPAYMENTS_API_KEY) &&
    hasConfiguredCredential(env.NOWPAYMENTS_IPN_SECRET);
  const googleAuthenticationConfigured =
    hasConfiguredCredential(env.GOOGLE_CLIENT_ID) &&
    hasConfiguredCredential(env.GOOGLE_CLIENT_SECRET);
  const walletAuthenticationConfigured =
    env.WALLET_LOGIN_ENABLED === "true";
  const trustedSitesIdentityConfigured =
    env.TRUST_SITES_IDENTITY_HEADERS === "true";
  const authenticationConfigured =
    googleAuthenticationConfigured ||
    walletAuthenticationConfigured ||
    trustedSitesIdentityConfigured;
  const proxyEnabled =
    databaseConfigured &&
    legalReviewConfirmed &&
    resellerAuthorized &&
    upstreamConfigured &&
    configurationValid;
  const paymentsEnabled =
    proxyEnabled &&
    authenticationConfigured &&
    env.CRYPTO_PAYMENTS_ENABLED === "true" &&
    paymentProviderConfigured;
  const missing: string[] = [];
  if (!databaseConfigured) missing.push("database");
  if (!configurationValid) missing.push("configuration");
  if (!legalReviewConfirmed) missing.push("legal_review");
  if (!resellerAuthorized) missing.push("reseller_authorization");
  if (!upstreamConfigured) missing.push("upstream_credentials");
  if (!adminConfigured) missing.push("admin_credentials");
  if (env.CRYPTO_PAYMENTS_ENABLED !== "true") {
    missing.push("crypto_payments");
  }
  if (!paymentProviderConfigured) missing.push("payment_provider");
  if (!authenticationConfigured) missing.push("authentication");
  const ready =
    proxyEnabled &&
    paymentsEnabled &&
    adminConfigured &&
    authenticationConfigured;
  const mode = ready
    ? "live"
    : proxyEnabled || paymentsEnabled
      ? "partial"
      : "sandbox";

  return {
    ready,
    mode,
    capabilities: {
      databaseConfigured,
      configurationValid,
      legalReviewConfirmed,
      resellerAuthorized,
      upstreamConfigured,
      proxyEnabled,
      paymentsEnabled,
      adminConfigured,
      masterAdminConfigured,
      catalogAdminConfigured,
      reconciliationConfigured,
      paymentAdminConfigured,
      authenticationConfigured,
      googleAuthenticationConfigured,
      walletAuthenticationConfigured,
      trustedSitesIdentityConfigured,
    },
    missing,
  };
}

function hasConfiguredCredential(value?: string): value is string {
  return Boolean(value && value.trim().length > 0 && value === value.trim());
}

function hasConfiguredAdminSecret(value?: string): value is string {
  return Boolean(
    value &&
      value.length >= 32 &&
      value.length <= 512 &&
      value === value.trim(),
  );
}

function hasValidRuntimeConfiguration(env: PlatformEnv): boolean {
  try {
    normalizeUpstreamBase(env.TIKHUB_BASE_URL);
  } catch {
    return false;
  }
  if (
    env.TIKHUB_CREDENTIALS_ENCRYPTION_KEY &&
    !hasValidTikHubCredentialsEncryptionKey(
      env.TIKHUB_CREDENTIALS_ENCRYPTION_KEY,
    )
  ) {
    return false;
  }
  const rawAppUrl = env.PUBLIC_APP_URL;
  if (!rawAppUrl) return false;
  if (rawAppUrl !== rawAppUrl.trim()) return false;
  try {
    const url = new URL(rawAppUrl);
    const localhost =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return (
      (url.protocol === "https:" || localhost) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === "" || url.pathname === "/")
    );
  } catch {
    return false;
  }
}

async function operationalReadiness(env: PlatformEnv) {
  const base = platformReadiness(env);
  let catalogReady = false;
  let schemaReady = false;
  let reconciliationRecent = false;
  let upstreamConfigured = base.capabilities.upstreamConfigured;
  if (env.DB) {
    try {
      const row = await env.DB
        .prepare(
          `SELECT
             EXISTS(
               SELECT 1
               FROM endpoint_catalog
               WHERE enabled = 1 AND read_only = 1
                 AND price_verified = 1
                 AND sync_generation = (
                   SELECT last_success_generation
                   FROM catalog_sync_state
                   WHERE id = 1
                 )
               LIMIT 1
             ) AS enabled_count,
             (SELECT request_count
              FROM upstream_rate_limit_buckets LIMIT 1)
               AS upstream_rate_limit_schema,
             (SELECT request_count
              FROM payment_rate_limit_buckets LIMIT 1)
               AS payment_rate_limit_schema,
             (SELECT next_attempt_at FROM payment_events LIMIT 1)
               AS payment_events_schema,
             (SELECT generation FROM catalog_sync_locks LIMIT 1)
               AS catalog_sync_locks_schema,
             (SELECT last_success_generation
              FROM catalog_sync_state LIMIT 1)
               AS catalog_sync_state_schema,
             (SELECT credential_source
              FROM catalog_sync_state LIMIT 1)
               AS catalog_credential_source,
             (SELECT credential_id
              FROM catalog_sync_state LIMIT 1)
               AS catalog_credential_id,
             (SELECT credential_fingerprint
              FROM catalog_sync_state LIMIT 1)
               AS catalog_credential_fingerprint,
             (SELECT credential_state_version
              FROM catalog_sync_state LIMIT 1)
               AS catalog_credential_state_version,
             (SELECT generation FROM catalog_sync_staging LIMIT 1)
               AS catalog_sync_staging_schema,
             (SELECT idempotency_hash FROM payment_orders LIMIT 1)
               AS payment_idempotency_schema,
             (SELECT upstream_cost_usd_micros FROM api_calls LIMIT 1)
               AS upstream_cost_schema,
             (SELECT sync_generation FROM endpoint_catalog LIMIT 1)
               AS sync_generation_schema,
             (SELECT http_method FROM endpoint_catalog LIMIT 1)
               AS http_method_schema,
             (SELECT price_verified FROM endpoint_catalog LIMIT 1)
               AS price_verified_schema,
             (SELECT provider FROM auth_identities LIMIT 1)
               AS auth_identities_schema,
             (SELECT provider FROM auth_sessions LIMIT 1)
               AS auth_sessions_schema,
             (SELECT provider FROM auth_challenges LIMIT 1)
               AS auth_challenges_schema,
             (SELECT request_count FROM auth_rate_limit_buckets LIMIT 1)
               AS auth_rate_limit_schema,
             (SELECT resolution_request_hash
              FROM payment_review_cases LIMIT 1)
               AS payment_review_request_schema,
             (SELECT resolution_credit_usd_micros
              FROM payment_review_cases LIMIT 1)
               AS payment_review_credit_schema,
             (SELECT id FROM admin_audit_logs LIMIT 1)
               AS admin_audit_schema,
             (SELECT secret_hash FROM upstream_credentials LIMIT 1)
               AS upstream_credentials_schema,
             (SELECT managed_enabled
              FROM upstream_credential_state LIMIT 1)
               AS upstream_credential_state_schema,
             EXISTS(
               SELECT 1
               FROM operation_heartbeats
               WHERE name = 'reconciliation'
                 AND datetime(last_success_at) >
                     datetime('now', '-5 minutes')
             ) AS reconciliation_recent`,
        )
        .first<{
          enabled_count: number;
          reconciliation_recent: number;
          catalog_credential_source: string | null;
          catalog_credential_id: string | null;
          catalog_credential_fingerprint: string | null;
          catalog_credential_state_version: number | null;
        }>();
      schemaReady = row != null;
      reconciliationRecent =
        Number(row?.reconciliation_recent ?? 0) === 1;
      try {
        const resolved = await resolveTikHubCredential(env, env.DB);
        upstreamConfigured = Boolean(resolved);
        catalogReady =
          resolved != null &&
          Number(row?.enabled_count ?? 0) > 0 &&
          row?.catalog_credential_source === resolved.source &&
          row.catalog_credential_id === resolved.id &&
          row.catalog_credential_fingerprint === resolved.fingerprint &&
          Number(row.catalog_credential_state_version) ===
            resolved.stateVersion;
      } catch {
        upstreamConfigured = false;
        catalogReady = false;
      }
    } catch {
      schemaReady = false;
      catalogReady = false;
      reconciliationRecent = false;
      upstreamConfigured = false;
    }
  }
  const proxyEnabled =
    base.capabilities.databaseConfigured &&
    base.capabilities.configurationValid &&
    base.capabilities.legalReviewConfirmed &&
    base.capabilities.resellerAuthorized &&
    upstreamConfigured;
  const paymentsEnabled =
    proxyEnabled &&
    base.capabilities.authenticationConfigured &&
    env.CRYPTO_PAYMENTS_ENABLED === "true" &&
    (env.PAYMENT_PROVIDER ?? "nowpayments") === "nowpayments" &&
    hasConfiguredCredential(env.NOWPAYMENTS_API_KEY) &&
    hasConfiguredCredential(env.NOWPAYMENTS_IPN_SECRET) &&
    base.capabilities.adminConfigured &&
    schemaReady &&
    catalogReady &&
    reconciliationRecent;
  const ready =
    proxyEnabled &&
    paymentsEnabled &&
    base.capabilities.adminConfigured &&
    base.capabilities.authenticationConfigured &&
    schemaReady &&
    catalogReady &&
    reconciliationRecent;
  const missing = base.missing.filter(
    (item) => item !== "upstream_credentials",
  );
  if (!upstreamConfigured) missing.push("upstream_credentials");
  if (!schemaReady) missing.push("database_migrations");
  if (!catalogReady) missing.push("enabled_catalog");
  if (!reconciliationRecent) missing.push("scheduled_reconciliation");
  const mode = ready
    ? "live"
    : proxyEnabled
      ? "partial"
      : "sandbox";

  return {
    ready,
    mode,
    capabilities: {
      ...base.capabilities,
      upstreamConfigured,
      proxyEnabled,
      schemaReady,
      catalogReady,
      reconciliationRecent,
      paymentsEnabled,
    },
    missing,
  };
}

function requireIdempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) {
    throw new PlatformError(
      400,
      "invalid_idempotency_key",
      "Idempotency-Key 必须是 8–128 个字母、数字、点、下划线、冒号或连字符。",
    );
  }
  return value;
}

async function paymentOrderByIdempotency(
  db: D1Database,
  userId: string,
  idempotencyHash: string,
): Promise<PaymentOrderRecord | null> {
  return db
    .prepare(
      `SELECT id, user_id, provider_payment_id, idempotency_hash,
              amount_usd_micros, pay_currency, pay_amount, pay_address,
              invoice_url, status, credited_usd_micros, created_at, updated_at
       FROM payment_orders
       WHERE user_id = ? AND idempotency_hash = ?`,
    )
    .bind(userId, idempotencyHash)
    .first<PaymentOrderRecord>();
}

async function paymentOrderById(
  db: D1Database,
  orderId: string,
  userId?: string,
): Promise<PaymentOrderRecord | null> {
  const statement = userId
    ? db
        .prepare(
          `SELECT id, user_id, provider_payment_id, idempotency_hash,
                  amount_usd_micros, pay_currency, pay_amount, pay_address,
                  invoice_url, status, credited_usd_micros, created_at, updated_at
           FROM payment_orders
           WHERE id = ? AND user_id = ? AND provider = 'nowpayments'`,
        )
        .bind(orderId, userId)
    : db
        .prepare(
          `SELECT id, user_id, provider_payment_id, idempotency_hash,
                  amount_usd_micros, pay_currency, pay_amount, pay_address,
                  invoice_url, status, credited_usd_micros, created_at, updated_at
           FROM payment_orders
           WHERE id = ? AND provider = 'nowpayments'`,
        )
        .bind(orderId);
  return statement.first<PaymentOrderRecord>();
}

function paymentOrderResponse(
  order: PaymentOrderRecord,
  status: number,
  requestId: string,
): Response {
  if (
    order.provider_payment_id == null &&
    (order.status === "creating" || order.status === "provider_error")
  ) {
    throw new PlatformError(
      409,
      "payment_creation_pending",
      "充值单创建结果尚未确认。请保留同一 Idempotency-Key，等待对账后重试。",
    );
  }
  return jsonResponse(
    {
      payment: {
        id: order.id,
        status: order.status,
        amountUsdMicros: order.amount_usd_micros,
        payAddress: order.pay_address,
        payAmount: order.pay_amount,
        payCurrency: order.pay_currency,
        invoiceUrl: safeInvoiceUrl(order.invoice_url),
        createdAt: order.created_at,
        updatedAt: order.updated_at,
      },
    },
    status,
    requestId,
  );
}

async function consumePaymentCreateRateLimit(
  db: D1Database,
  userId: string,
  env: PlatformEnv,
): Promise<void> {
  const minuteBucket = new Date().toISOString().slice(0, 16);
  const limits = [
    {
      scope: `user:${userId}`,
      limit: clampInteger(env.PAYMENT_CREATE_LIMIT_PER_MINUTE, 3, 1, 20),
      message: "充值单创建过于频繁，请一分钟后重试。",
    },
    {
      scope: "provider:nowpayments",
      limit: clampInteger(env.PAYMENT_PROVIDER_LIMIT_PER_MINUTE, 60, 1, 180),
      message: "支付通道当前繁忙，请一分钟后重试。",
    },
  ];
  for (const item of limits) {
    const slot = await db
      .prepare(
        `INSERT INTO payment_rate_limit_buckets
         (scope, minute_bucket, request_count, updated_at)
         VALUES (?, ?, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(scope, minute_bucket) DO UPDATE SET
           request_count = payment_rate_limit_buckets.request_count + 1,
           updated_at = CURRENT_TIMESTAMP
         WHERE payment_rate_limit_buckets.request_count < ?
         RETURNING request_count`,
      )
      .bind(item.scope, minuteBucket, item.limit)
      .first<{ request_count: number }>();
    if (!slot) {
      throw new PlatformError(
        429,
        "payment_rate_limit_exceeded",
        item.message,
      );
    }
  }
}

function normalizedPositiveDecimal(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (text.length === 0 || text.length > 80) return null;
  const scaled = decimalToScaledInteger(text, 18);
  if (scaled == null || scaled <= BigInt(0)) return null;
  return text;
}

function safeInvoiceUrl(value: string | null): string | null {
  if (!value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      (url.hostname !== "nowpayments.io" &&
        !url.hostname.endsWith(".nowpayments.io"))
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function readResponseJson(
  response: Response,
  limit: number,
  errorCode: string,
): Promise<unknown> {
  const text = await readResponseText(response, limit, errorCode);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isPlainRecord(parsed) && !Array.isArray(parsed)) {
      throw new Error("response must be an object or array");
    }
    if (containsUnsafeJsonNumber(parsed)) {
      throw new Error("response contains unsafe numbers");
    }
    return parsed;
  } catch {
    throw new PlatformError(
      502,
      errorCode,
      "外部服务返回了无法识别的数据。",
    );
  }
}

async function readResponseText(
  response: Response,
  limit: number,
  errorCode: string,
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > limit) {
    response.body?.cancel("response too large").catch(() => undefined);
    throw new PlatformError(502, errorCode, "外部服务响应超过安全上限。");
  }
  if (!response.body) {
    throw new PlatformError(502, errorCode, "外部服务返回了空响应。");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("response too large");
        throw new PlatformError(
          502,
          errorCode,
          "外部服务响应超过安全上限。",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function safeUpstreamErrorMessage(
  response: Response,
  limit: number,
  sensitiveValues: string[] = [],
): Promise<string> {
  let text: string;
  try {
    text = await readResponseText(response, limit, "upstream_error");
  } catch {
    return `上游返回 HTTP ${response.status}，本次未扣费。`;
  }
  let message = "";
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isPlainRecord(parsed)) {
      message =
        firstString(parsed, ["message", "detail", "msg", "error"]) ?? "";
      if (!message && isPlainRecord(parsed.error)) {
        message =
          firstString(parsed.error, ["message", "detail", "msg"]) ?? "";
      }
    }
  } catch {
    message = text;
  }
  let redacted = message.replace(
    /\bbearer\s+[\x21-\x7E]{8,512}/gi,
    "Bearer [redacted]",
  );
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue.length >= 8) {
      redacted = redacted.split(sensitiveValue).join("[redacted]");
    }
  }
  const safe = redacted
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return safe || `上游返回 HTTP ${response.status}，本次未扣费。`;
}

function upstreamErrorResponse(
  status: number,
  message: string,
  requestId: string,
  headers: Headers,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.delete("etag");
  responseHeaders.delete("last-modified");
  responseHeaders.delete("content-type");
  return jsonResponse(
    {
      error: {
        code: "upstream_error",
        message,
        requestId,
        upstreamStatus: status,
      },
    },
    status,
    requestId,
    responseHeaders,
  );
}

async function requireAuthenticatedUser(
  request: Request,
  db: D1Database,
  env: PlatformEnv,
): Promise<AuthenticatedUser> {
  const sessionToken = cookieValue(request, SESSION_COOKIE);
  if (
    sessionToken &&
    /^[A-Za-z0-9_-]{32,160}$/.test(sessionToken)
  ) {
    const tokenHash = await sha256Hex(sessionToken);
    const session = await db
      .prepare(
        `SELECT u.id, u.email, u.display_name, u.status,
                s.provider, s.last_seen_at, ai.wallet_address
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN auth_identities ai
           ON ai.user_id = s.user_id AND ai.provider = s.provider
         WHERE s.token_hash = ?
           AND datetime(s.expires_at) > datetime('now')
         LIMIT 1`,
      )
      .bind(tokenHash)
      .first<{
        id: string;
        email: string;
        display_name: string | null;
        status: string;
        provider: string;
        last_seen_at: string;
        wallet_address: string | null;
      }>();
    if (session) {
      if (session.status !== "active") {
        throw new PlatformError(403, "account_suspended", "账户当前不可用。");
      }
      if (session.provider !== "google" && session.provider !== "wallet") {
        throw new PlatformError(
          401,
          "authentication_required",
          "登录会话无效，请重新登录。",
        );
      }
      if (
        Date.parse(session.last_seen_at) <
        Date.now() - 15 * 60_000
      ) {
        await db
          .prepare(
            `UPDATE auth_sessions
             SET last_seen_at = CURRENT_TIMESTAMP
             WHERE token_hash = ?
               AND datetime(last_seen_at) <
                   datetime('now', '-15 minutes')`,
          )
          .bind(tokenHash)
          .run();
      }
      return {
        id: session.id,
        email: session.email,
        displayName: session.display_name ?? session.email,
        provider: session.provider,
        walletAddress: session.wallet_address,
      };
    }
  }

  if (env.TRUST_SITES_IDENTITY_HEADERS !== "true") {
    throw new PlatformError(
      401,
      "authentication_required",
      "请先登录后再使用控制台。",
    );
  }
  const email = request.headers
    .get(USER_EMAIL_HEADER)
    ?.trim()
    .toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new PlatformError(
      401,
      "authentication_required",
      "请先登录后再使用控制台。",
    );
  }

  const encodedName = request.headers.get(USER_NAME_HEADER);
  const displayName =
    encodedName &&
    request.headers.get(USER_NAME_ENCODING_HEADER) === "percent-encoded-utf-8"
      ? safeDecodeURIComponent(encodedName) ?? email
      : email;
  const id = `usr_${(await sha256Hex(email)).slice(0, 24)}`;

  let stored = await db
    .prepare(
      `SELECT id, email, display_name
       FROM users
       WHERE email = ? AND status = 'active'`,
    )
    .bind(email)
    .first<{ id: string; email: string; display_name: string | null }>();
  if (!stored) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO users
         (id, email, display_name, status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(id, email, displayName)
      .run();
    stored = await db
      .prepare(
        `SELECT id, email, display_name
         FROM users
         WHERE email = ? AND status = 'active'`,
      )
      .bind(email)
      .first<{ id: string; email: string; display_name: string | null }>();
  } else if (stored.display_name !== displayName) {
    await db
      .prepare(
        `UPDATE users
         SET display_name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND display_name IS NOT ?`,
      )
      .bind(displayName, stored.id, displayName)
      .run();
    stored = { ...stored, display_name: displayName };
  }
  if (!stored) {
    throw new PlatformError(403, "account_suspended", "账户当前不可用。");
  }

  return {
    id: stored.id,
    email: stored.email,
    displayName: stored.display_name ?? stored.email,
    provider: "chatgpt",
    walletAddress: null,
  };
}

async function refundRequest(
  db: D1Database,
  userId: string,
  ledgerReferenceId: string,
  costUsdMicros: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id, description, created_at)
       VALUES (?, ?, 'api_refund', ?, ?, 'API request refund', ?)`,
    )
    .bind(
      `led_${randomBase64Url(16)}`,
      userId,
      costUsdMicros,
      `${ledgerReferenceId}:refund`,
      new Date().toISOString(),
    )
    .run();
}

async function markProxyRequest(
  db: D1Database,
  requestId: string,
  status: string,
  responseStatus: number | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE proxy_requests
       SET status = ?, response_status = ?,
           completed_at = CASE
             WHEN ? IN ('completed', 'refunded', 'reconciled', 'rate_limited', 'insufficient_balance')
             THEN CURRENT_TIMESTAMP
             ELSE completed_at
           END
       WHERE id = ?`,
    )
    .bind(status, responseStatus, status, requestId)
    .run();
}

async function logApiCall(
  db: D1Database,
  input: {
    requestId: string;
    key: ApiKeyRecord;
    method: string;
    path: string;
    platform: string;
    statusCode: number;
    costUsdMicros: number;
    upstreamCostUsdMicros: number;
    latencyMs: number;
    refunded: boolean;
  },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO api_calls
         (id, user_id, api_key_id, method, upstream_path, platform,
          status_code, cost_usd_micros, upstream_cost_usd_micros,
          latency_ms, refunded, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(
        input.requestId,
        input.key.user_id,
        input.key.id,
        input.method,
        input.path,
        input.platform,
        input.statusCode,
        input.costUsdMicros,
        input.upstreamCostUsdMicros,
        input.latencyMs,
        input.refunded ? 1 : 0,
      ),
    db
      .prepare(
        `UPDATE api_keys
         SET last_used_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(input.key.id),
    db
      .prepare(
        `UPDATE proxy_requests
         SET status = ?, response_status = ?, completed_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status != 'reconciled'`,
      )
      .bind(
        input.refunded ? "refunded" : "completed",
        input.statusCode,
        input.requestId,
      ),
  ]);
}

async function currentBalance(
  db: D1Database,
  userId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
       FROM balance_ledger
       WHERE user_id = ?`,
    )
    .bind(userId)
    .first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}

type CatalogSyncEntry = {
  path: string;
  platform: string;
  httpMethod: "GET" | "POST";
  summary: string | null;
  description: string | null;
  parameterSchemaJson: string | null;
  upstreamPriceUsdMicros: number;
  priceVerified: boolean;
  looksReadOnly: boolean;
};

function extractCatalogPrices(payload: unknown): Array<{
  path: string;
  httpMethod: "GET" | "POST" | null;
  upstreamPriceUsdMicros: number;
}> {
  const byPath = new Map<
    string,
    {
      path: string;
      httpMethod: "GET" | "POST" | null;
      upstreamPriceUsdMicros: number;
    }
  >();

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    const rawPath = firstString(record, [
      "path",
      "endpoint",
      "api_path",
      "url",
      "route",
    ]);
    const rawPrice = firstNumber(record, [
      "price",
      "cost",
      "price_per_request",
      "unit_price",
      "base_price",
    ]);
    if (rawPath && rawPrice != null && rawPrice > 0 && rawPrice <= 100) {
      try {
        const path = normalizeCatalogPath(rawPath);
        const rawMethod = firstString(record, [
          "method",
          "http_method",
          "httpMethod",
        ])?.toUpperCase();
        const httpMethod =
          rawMethod === "GET" || rawMethod === "POST"
            ? rawMethod
            : null;
        byPath.set(path, {
          path,
          httpMethod,
          upstreamPriceUsdMicros: Math.max(
            1,
            Math.round(rawPrice * 1_000_000),
          ),
        });
      } catch {
        // Ignore non-endpoint URLs and malformed catalog records.
      }
    }

    for (const nested of Object.values(record)) visit(nested);
  };

  visit(payload);
  return [...byPath.values()];
}

function extractOpenApiCatalog(
  payload: unknown,
): Map<
  string,
  Omit<CatalogSyncEntry, "upstreamPriceUsdMicros" | "priceVerified">
> {
  if (!isPlainRecord(payload) || !isPlainRecord(payload.paths)) {
    throw new PlatformError(
      502,
      "catalog_schema_sync_failed",
      "TikHub OpenAPI 文档格式无效。",
    );
  }
  const byPath = new Map<
    string,
    Omit<CatalogSyncEntry, "upstreamPriceUsdMicros" | "priceVerified">
  >();
  for (const [rawPath, pathItem] of Object.entries(payload.paths)) {
    if (!isPlainRecord(pathItem)) continue;
    let selected:
      | Omit<
          CatalogSyncEntry,
          "upstreamPriceUsdMicros" | "priceVerified"
        >
      | null = null;
    let methodCount = 0;
    for (const method of ["get", "post"] as const) {
      const operation = pathItem[method];
      if (!isPlainRecord(operation)) continue;
      methodCount += 1;
      try {
        const path = normalizeCatalogPath(rawPath);
        const httpMethod = method.toUpperCase() as "GET" | "POST";
        const schemaPayload = {
          parameters: Array.isArray(operation.parameters)
            ? operation.parameters
            : [],
          requestBody: isPlainRecord(operation.requestBody)
            ? operation.requestBody
            : null,
        };
        const serializedSchema = JSON.stringify(schemaPayload);
        const entry = {
          path,
          platform: path.split("/")[2] || "other",
          httpMethod,
          summary: compactCatalogText(operation.summary, 240),
          description: compactCatalogText(operation.description, 2_000),
          parameterSchemaJson:
            serializedSchema.length <= 16_384
              ? serializedSchema
              : JSON.stringify({ truncated: true }),
          looksReadOnly: looksLikeReadOnlyOperation(path, httpMethod),
        };
        if (selected == null || httpMethod === "GET") selected = entry;
      } catch {
        // Ignore malformed non-v1 documentation paths.
      }
    }
    if (selected) {
      byPath.set(selected.path, {
        ...selected,
        looksReadOnly: selected.looksReadOnly && methodCount === 1,
      });
    }
  }
  return byPath;
}

function mergeCatalogEntries(
  prices: ReturnType<typeof extractCatalogPrices>,
  openApi: ReturnType<typeof extractOpenApiCatalog>,
  credentialScopes: string[] | null,
): CatalogSyncEntry[] {
  const pricesByPath = new Map(prices.map((price) => [price.path, price]));
  return [...openApi.values()].map((metadata) => {
    const price = pricesByPath.get(metadata.path);
    const methodMatches =
      price != null &&
      (price.httpMethod == null ||
        price.httpMethod === metadata.httpMethod) &&
      tikHubCredentialAllowsPath(credentialScopes, metadata.path);
    return {
      ...metadata,
      upstreamPriceUsdMicros: methodMatches
        ? price.upstreamPriceUsdMicros
        : 0,
      priceVerified: methodMatches,
    };
  });
}

function compactCatalogText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, maxLength) : null;
}

function safeStoredJson(value: string | null): unknown {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainRecord(parsed) || Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeCatalogPath(value: string): string {
  try {
    let path = value.trim();
    if (/^https?:\/\//i.test(path)) {
      const url = new URL(path);
      if (
        url.protocol !== "https:" ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.hostname !== "api.tikhub.io" &&
          url.hostname !== "api.tikhub.dev")
      ) {
        throw new Error("Untrusted endpoint host");
      }
      path = url.pathname;
    }
    if (path.startsWith("/api/v1/")) path = path.slice("/api".length);
    if (!path.startsWith("/v1/")) {
      throw new Error("Unsupported endpoint path");
    }
    validateCatalogPathSyntax(path);
    return path;
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw new PlatformError(400, "invalid_endpoint", "端点路径无效。");
  }
}

function looksLikeReadOnlyPath(path: string): boolean {
  const normalized = path.toLowerCase();
  const blockedSignals = [
    "/creator/",
    "publish_",
    "create_",
    "delete_",
    "remove_",
    "send_",
    "reply_",
    "increase_",
    "follow_",
    "unfollow_",
    "like_",
    "login",
    "captcha",
    "verify_code",
    "temp_email",
    "signature",
    "sign_url",
    "get_guest_cookie",
    "register_device",
    "generate_ms_token",
    "update_",
    "upload_",
    "set_cookie",
    "/tikhub/",
    "/demo/",
    "encrypt_",
    "decrypt_",
    "add_",
    "open_",
  ];
  return !blockedSignals.some((signal) => normalized.includes(signal));
}

function looksLikeReadOnlyOperation(
  path: string,
  method: "GET" | "POST",
): boolean {
  if (!looksLikeReadOnlyPath(path)) return false;
  if (method === "GET") return true;
  const operation = path.split("/").pop()?.toLowerCase() ?? "";
  return /^(fetch|get|search|query|batch_fetch|batch_get|parse|resolve|calculate|check|list)_/.test(
    operation,
  );
}

function normalizeUpstreamBase(value?: string): string {
  const raw = (value || "https://api.tikhub.io/api/v1").trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PlatformError(
      500,
      "invalid_upstream_configuration",
      "上游地址配置无效。",
    );
  }
  if (
    url.protocol !== "https:" ||
    Boolean(url.port) ||
    Boolean(url.username) ||
    Boolean(url.password) ||
    Boolean(url.search) ||
    Boolean(url.hash) ||
    (url.hostname !== "api.tikhub.io" && url.hostname !== "api.tikhub.dev")
  ) {
    throw new PlatformError(
      500,
      "invalid_upstream_configuration",
      "上游地址配置无效。",
    );
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== "/api/v1") {
    throw new PlatformError(
      500,
      "invalid_upstream_configuration",
      "上游地址必须以 /api/v1 结尾。",
    );
  }
  return `${url.origin}${path}`;
}

function validateProxyPath(path: string): void {
  validateCatalogPathSyntax(path);
  if (!looksLikeReadOnlyPath(path)) {
    throw new PlatformError(
      403,
      "unsafe_endpoint",
      "账户、Cookie、发布、互动或其他非只读端点不在开放范围内。",
    );
  }
}

function validateCatalogPathSyntax(path: string): void {
  if (
    !/^\/v1\/[a-zA-Z0-9/_-]+$/.test(path) ||
    path.includes("..") ||
    path.includes("//") ||
    path.endsWith("/")
  ) {
    throw new PlatformError(400, "invalid_endpoint", "端点路径无效。");
  }
}

function sanitizeUpstreamHeaders(headers: Headers): Headers {
  const safe = new Headers();
  const allowed = ["content-type", "content-language", "etag", "last-modified"];
  for (const name of allowed) {
    const value = headers.get(name);
    if (value) safe.set(name, value);
  }
  return safe;
}

function requireDb(env: PlatformEnv): D1Database {
  if (!env.DB) {
    throw new PlatformError(
      503,
      "database_unavailable",
      "数据库尚未完成配置。",
    );
  }
  return env.DB;
}

function requireAdminSecret(
  request: Request,
  env: PlatformEnv,
  scope: "catalog" | "payments" | "reconciliation" | "platform",
): void {
  const supplied = bearerToken(request);
  const scoped =
    scope === "catalog"
      ? env.CATALOG_SYNC_SECRET
      : scope === "payments"
        ? env.PAYMENT_ADMIN_SECRET
        : scope === "reconciliation"
          ? env.RECONCILIATION_SECRET
          : undefined;
  const candidates = [env.ADMIN_MASTER_SECRET, scoped].filter(
    hasConfiguredAdminSecret,
  );
  if (
    !supplied ||
    candidates.length === 0 ||
    !candidates.some((configured) =>
      constantTimeEqual(supplied, configured),
    )
  ) {
    throw new PlatformError(401, "admin_unauthorized", "管理员凭证无效。");
  }
}

async function writeAdminAudit(
  db: D1Database,
  request: Request,
  input: {
    action: string;
    targetType: string;
    targetId: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await (await prepareAdminAuditStatement(db, request, input)).run();
}

async function prepareAdminAuditStatement(
  db: D1Database,
  request: Request,
  input: {
    action: string;
    targetType: string;
    targetId: string;
    details?: Record<string, unknown>;
    idempotencyKey?: string;
    paymentReviewResolution?: {
      caseId: string;
      action: string;
      requestHash: string;
    };
  },
): Promise<D1PreparedStatement> {
  const supplied = bearerToken(request);
  if (!supplied) {
    throw new PlatformError(401, "admin_unauthorized", "管理员凭证无效。");
  }
  const details = input.details ? JSON.stringify(input.details) : null;
  if (details != null && details.length > 8_192) {
    throw new PlatformError(
      500,
      "audit_record_too_large",
      "管理员操作审计信息超过安全上限。",
    );
  }
  const auditId = input.idempotencyKey
    ? `aud_${(
        await sha256Hex(
          `${input.action}:${input.targetType}:${input.targetId}:${input.idempotencyKey}`,
        )
      ).slice(0, 32)}`
    : `aud_${randomBase64Url(18)}`;
  const values = [
    auditId,
    (await sha256Hex(supplied)).slice(0, 16),
    input.action.slice(0, 120),
    input.targetType.slice(0, 80),
    input.targetId.slice(0, 180),
    details,
  ];
  if (input.paymentReviewResolution) {
    return db
      .prepare(
        `INSERT OR IGNORE INTO admin_audit_logs
         (id, actor_fingerprint, action, target_type, target_id,
          details_json, created_at)
         SELECT ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
         WHERE EXISTS (
           SELECT 1
           FROM payment_review_cases
           WHERE id = ? AND status = 'resolved'
             AND resolution_action = ?
             AND resolution_request_hash = ?
         )`,
      )
      .bind(
        ...values,
        input.paymentReviewResolution.caseId,
        input.paymentReviewResolution.action,
        input.paymentReviewResolution.requestHash,
      );
  }
  return db
    .prepare(
      `INSERT OR IGNORE INTO admin_audit_logs
       (id, actor_fingerprint, action, target_type, target_id,
        details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(...values);
}

function assertSameOrigin(request: Request, env: PlatformEnv): void {
  const origin = request.headers.get("origin");
  const allowed = new Set([new URL(request.url).origin]);
  if (env.PUBLIC_APP_URL) {
    try {
      allowed.add(new URL(env.PUBLIC_APP_URL).origin);
    } catch {
      throw new PlatformError(
        500,
        "invalid_app_configuration",
        "公开站点地址配置无效。",
      );
    }
  }
  if (!origin || !allowed.has(origin)) {
    throw new PlatformError(
      403,
      "cross_site_request_blocked",
      "已阻止跨站请求。",
    );
  }
}

function canonicalAppOrigin(request: Request, env: PlatformEnv): string {
  const origin = env.PUBLIC_APP_URL
    ? new URL(env.PUBLIC_APP_URL).origin
    : new URL(request.url).origin;
  if (
    !/^https:\/\//.test(origin) &&
    !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)
  ) {
    throw new PlatformError(
      500,
      "invalid_app_configuration",
      "公开站点地址必须使用 HTTPS。",
    );
  }
  return origin;
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || null;
}

function sanitizeLabel(value: unknown): string {
  if (typeof value !== "string") return "默认密钥";
  const label = value.trim().replace(/\s+/g, " ");
  if (!label) return "默认密钥";
  if (label.length > 60) {
    throw new PlatformError(
      400,
      "invalid_key_label",
      "API Key 名称不能超过 60 个字符。",
    );
  }
  return label;
}

async function readJsonBody<T>(
  request: Request,
  limit: number,
): Promise<T> {
  const text = await readBodyText(request, limit);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isPlainRecord(parsed)) {
      throw new Error("JSON body must be an object");
    }
    return parsed as T;
  } catch {
    throw new PlatformError(
      400,
      "invalid_json",
      "请求体必须是有效的 JSON 对象。",
    );
  }
}

async function readBodyText(request: Request, limit: number): Promise<string> {
  const bytes = await readBodyBuffer(request, limit);
  return new TextDecoder().decode(bytes);
}

async function readBodyBuffer(
  request: Request,
  limit: number,
): Promise<ArrayBuffer> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw new PlatformError(413, "payload_too_large", "请求体过大。");
  }
  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("payload too large");
        throw new PlatformError(413, "payload_too_large", "请求体过大。");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw new PlatformError(400, "invalid_body", "请求体读取失败。");
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

function jsonResponse(
  data: unknown,
  status: number,
  requestId: string,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(JSON_HEADERS);
  if (extraHeaders) {
    const extra = new Headers(extraHeaders);
    extra.forEach((value, name) => headers.set(name, value));
  }
  headers.set("content-type", JSON_HEADERS["content-type"]);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-request-id", requestId);
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

function paymentWebhookAck(requestId: string): Response {
  return new Response("OK", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string,
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
        requestId,
      },
    },
    status,
    requestId,
  );
}

function resultRows<T>(result: D1Result<unknown>): T[] {
  return (result.results ?? []) as T[];
}

function firstResult<T>(result: D1Result<unknown>): T | null {
  return resultRows<T>(result)[0] ?? null;
}

function clampInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseUsdMicros(value: unknown): number | null {
  const scaled = decimalToScaledInteger(value, 6);
  if (
    scaled == null ||
    scaled < BigInt(0) ||
    scaled > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }
  return Number(scaled);
}

function compareDecimalAmounts(left: unknown, right: unknown): number {
  const leftScaled = decimalToScaledInteger(left, 18);
  const rightScaled = decimalToScaledInteger(right, 18);
  if (leftScaled == null || rightScaled == null) return -1;
  if (leftScaled === rightScaled) return 0;
  return leftScaled > rightScaled ? 1 : -1;
}

function proportionalPaymentCreditUsdMicros(
  orderUsdMicros: number,
  actualPaid: unknown,
  expectedPayAmount: unknown,
): number | null {
  if (!Number.isSafeInteger(orderUsdMicros) || orderUsdMicros <= 0) {
    return null;
  }
  const actualScaled = decimalToScaledInteger(actualPaid, 18);
  const expectedScaled = decimalToScaledInteger(expectedPayAmount, 18);
  if (
    actualScaled == null ||
    expectedScaled == null ||
    actualScaled <= BigInt(0) ||
    expectedScaled <= BigInt(0)
  ) {
    return null;
  }
  const proportional =
    (BigInt(orderUsdMicros) * actualScaled) / expectedScaled;
  const capped =
    proportional > BigInt(orderUsdMicros)
      ? BigInt(orderUsdMicros)
      : proportional;
  if (capped < BigInt(1) || capped > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(capped);
}

function isMaterialOverpayment(actual: unknown, expected: unknown): boolean {
  const actualScaled = decimalToScaledInteger(actual, 18);
  const expectedScaled = decimalToScaledInteger(expected, 18);
  if (actualScaled == null || expectedScaled == null) return false;
  const oneTokenMicroUnit = BigInt(10) ** BigInt(12);
  const oneBasisPoint = expectedScaled / BigInt(10_000);
  const tolerance =
    oneBasisPoint > oneTokenMicroUnit
      ? oneBasisPoint
      : oneTokenMicroUnit;
  return actualScaled > expectedScaled + tolerance;
}

function decimalToScaledInteger(
  value: unknown,
  precision: number,
): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > precision && /[1-9]/.test(fraction.slice(precision))) {
    return null;
  }
  const paddedFraction = fraction
    .slice(0, precision)
    .padEnd(precision, "0");
  try {
    return (
      BigInt(whole) * BigInt(10) ** BigInt(precision) +
      BigInt(paddedFraction || "0")
    );
  } catch {
    return null;
  }
}

function randomBase64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha512Hex(
  secret: string,
  value: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(signature));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    mismatch |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function sortObjectDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (!value || typeof value !== "object") return value;
  const sorted = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortObjectDeep(
      (value as Record<string, unknown>)[key],
    );
  }
  return sorted;
}

function containsUnsafeJsonNumber(value: unknown): boolean {
  if (typeof value === "number") {
    return (
      !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    );
  }
  if (Array.isArray(value)) return value.some(containsUnsafeJsonNumber);
  if (!isPlainRecord(value)) return false;
  return Object.values(value).some(containsUnsafeJsonNumber);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function firstString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(
  record: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() === "") continue;
    if (
      (typeof value === "number" || typeof value === "string") &&
      value !== ""
    ) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
