const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const MAX_DASHBOARD_BODY_BYTES = 16 * 1024;
const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
const PAYMENT_AMOUNTS = new Set([10, 25, 50, 100]);
const PAYMENT_CURRENCIES = new Set([
  "usdttrc20",
  "usdterc20",
  "usdtbsc",
  "usdcbase",
  "usdcpolygon",
  "usdcsol",
]);

export interface PlatformEnv {
  DB?: D1Database;
  TIKHUB_API_KEY?: string;
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
  CATALOG_SYNC_SECRET?: string;
  PRICE_MARKUP_BPS?: string;
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
};

type ApiKeyRecord = {
  id: string;
  user_id: string;
  rate_limit_rpm: number;
};

type CatalogRecord = {
  path: string;
  platform: string;
  customer_price_usd_micros: number;
  enabled: number;
  read_only: number;
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
      return jsonResponse(
        {
          ok: true,
          service: "relaybase-api",
          mode: isLiveProxyEnabled(env) ? "live" : "sandbox",
          timestamp: new Date().toISOString(),
        },
        200,
        requestId,
      );
    }

    if (
      url.pathname === "/api/payments/nowpayments/ipn" &&
      request.method === "POST"
    ) {
      return await handleNowPaymentsWebhook(request, env, requestId);
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
      url.pathname === "/api/admin/catalog/sync" &&
      request.method === "POST"
    ) {
      return await handleCatalogSync(request, env, requestId);
    }

    if (
      url.pathname === "/api/admin/catalog" &&
      request.method === "PATCH"
    ) {
      return await handleCatalogUpdate(request, env, requestId);
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

async function handleDashboard(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  const db = requireDb(env);
  const user = await requireAuthenticatedUser(request, db);

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
        `SELECT id, amount_usd_micros, pay_currency, status, created_at
         FROM payment_orders
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 10`,
      )
      .bind(user.id),
    db
      .prepare(
        `SELECT id, method, upstream_path, platform, status_code,
                cost_usd_micros, latency_ms, created_at
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
        status: string;
        created_at: string;
      }>(paymentsResult).map((row) => ({
        id: row.id,
        amountUsdMicros: row.amount_usd_micros,
        payCurrency: row.pay_currency,
        status: row.status,
        createdAt: row.created_at,
      })),
      calls: resultRows<{
        id: string;
        method: string;
        upstream_path: string;
        platform: string;
        status_code: number;
        cost_usd_micros: number;
        latency_ms: number;
        created_at: string;
      }>(callsResult).map((row) => ({
        id: row.id,
        method: row.method,
        path: row.upstream_path,
        platform: row.platform,
        statusCode: row.status_code,
        costUsdMicros: row.cost_usd_micros,
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
  const user = await requireAuthenticatedUser(request, db);
  const body = await readJsonBody<{ label?: unknown }>(
    request,
    MAX_DASHBOARD_BODY_BYTES,
  );
  const label = sanitizeLabel(body.label);

  const active = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM api_keys
       WHERE user_id = ? AND revoked_at IS NULL`,
    )
    .bind(user.id)
    .first<{ count: number }>();
  if (Number(active?.count ?? 0) >= 5) {
    throw new PlatformError(
      409,
      "api_key_limit",
      "每个账户最多保留 5 个有效 API Key。",
    );
  }

  const id = `key_${randomBase64Url(12)}`;
  const secret = `rb_live_${randomBase64Url(32)}`;
  const keyHash = await sha256Hex(secret);
  const prefix = `${secret.slice(0, 16)}…`;
  const rateLimit = clampInteger(env.API_RATE_LIMIT_RPM, 60, 1, 600);
  const createdAt = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO api_keys
       (id, user_id, label, key_prefix, key_hash, rate_limit_rpm, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, user.id, label, prefix, keyHash, rateLimit, createdAt)
    .run();

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
  const user = await requireAuthenticatedUser(request, db);
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
  if ((env.PAYMENT_PROVIDER ?? "nowpayments") !== "nowpayments") {
    throw new PlatformError(
      503,
      "payment_provider_unavailable",
      "当前支付服务商尚未配置。",
    );
  }

  const apiKey = env.NOWPAYMENTS_API_KEY;
  if (!apiKey) {
    throw new PlatformError(
      503,
      "payment_provider_unavailable",
      "支付服务商密钥尚未配置。",
    );
  }

  const db = requireDb(env);
  const user = await requireAuthenticatedUser(request, db);
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

  const orderId = `pay_${randomBase64Url(16)}`;
  const amountUsdMicros = amountUsd * 1_000_000;
  const appOrigin = canonicalAppOrigin(request, env);
  const createdAt = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, amount_usd_micros, pay_currency, status, created_at, updated_at)
       VALUES (?, ?, 'nowpayments', ?, ?, 'creating', ?, ?)`,
    )
    .bind(
      orderId,
      user.id,
      amountUsdMicros,
      payCurrency,
      createdAt,
      createdAt,
    )
    .run();

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
  if (!providerPaymentId) {
    throw new PlatformError(
      502,
      "invalid_provider_response",
      "支付服务商没有返回有效订单。",
    );
  }

  await db
    .prepare(
      `UPDATE payment_orders
       SET provider_payment_id = ?, pay_amount = ?, pay_address = ?,
           invoice_url = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
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

  return jsonResponse(
    {
      payment: {
        id: orderId,
        status: payment.payment_status ?? "waiting",
        payAddress: payment.pay_address ?? null,
        payAmount: String(payment.pay_amount ?? ""),
        payCurrency: payment.pay_currency ?? payCurrency,
        invoiceUrl: payment.invoice_url ?? null,
      },
    },
    201,
    requestId,
  );
}

async function handleNowPaymentsWebhook(
  request: Request,
  env: PlatformEnv,
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
  const orderId =
    typeof payload.order_id === "string" ? payload.order_id.trim() : "";
  if (!paymentId || !/^pay_[A-Za-z0-9_-]+$/.test(orderId)) {
    throw new PlatformError(400, "invalid_webhook", "支付回调缺少订单信息。");
  }

  const verified = await getNowPaymentsPayment(apiKey, paymentId);
  if (String(verified.payment_id ?? "") !== paymentId) {
    throw new PlatformError(
      502,
      "provider_verification_failed",
      "支付订单复核失败。",
    );
  }
  if (verified.order_id !== orderId) {
    throw new PlatformError(
      409,
      "payment_order_mismatch",
      "支付订单信息不匹配。",
    );
  }

  const db = requireDb(env);
  const order = await db
    .prepare(
      `SELECT id, user_id, provider_payment_id, amount_usd_micros,
              pay_currency, pay_amount, status, credited_usd_micros
       FROM payment_orders
       WHERE id = ? AND provider = 'nowpayments'`,
    )
    .bind(orderId)
    .first<{
      id: string;
      user_id: string;
      provider_payment_id: string | null;
      amount_usd_micros: number;
      pay_currency: string;
      pay_amount: string | null;
      status: string;
      credited_usd_micros: number;
    }>();
  if (!order || order.provider_payment_id !== paymentId) {
    throw new PlatformError(404, "payment_not_found", "支付订单不存在。");
  }
  const status = verified.payment_status ?? "unknown";
  const updatedAt = new Date().toISOString();
  const needsAmountVerification = status === "finished";
  const verifiedUsdMicros = parseUsdMicros(verified.price_amount);
  const currencyMatches =
    typeof verified.pay_currency === "string" &&
    verified.pay_currency.toLowerCase() === order.pay_currency.toLowerCase();
  const priceCurrencyMatches =
    typeof verified.price_currency === "string" &&
    verified.price_currency.toLowerCase() === "usd";
  const priceMatches = verifiedUsdMicros === order.amount_usd_micros;
  const actualCoversExpected =
    order.pay_amount != null &&
    verified.actually_paid != null &&
    compareDecimalAmounts(verified.actually_paid, order.pay_amount) >= 0;

  if (
    !currencyMatches ||
    (needsAmountVerification &&
      (!priceCurrencyMatches || !priceMatches || !actualCoversExpected))
  ) {
    await db
      .prepare(
        `UPDATE payment_orders
         SET status = 'manual_review', updated_at = ?
         WHERE id = ? AND status != 'refunded'`,
      )
      .bind(updatedAt, orderId)
      .run();
    console.warn("Payment moved to manual review", {
      requestId,
      orderId,
      paymentId,
      status,
      currencyMatches,
      priceCurrencyMatches,
      priceMatches,
      actualCoversExpected,
    });
    return paymentWebhookAck(requestId);
  }

  const statements: D1PreparedStatement[] = [];

  if (status === "finished") {
    statements.push(
      db
        .prepare(
          `UPDATE payment_orders
           SET status = 'finished', updated_at = ?
           WHERE id = ? AND status NOT IN ('refunded', 'manual_review')`,
        )
        .bind(updatedAt, orderId),
    );
    const ledgerId = `led_${randomBase64Url(16)}`;
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO balance_ledger
           (id, user_id, entry_type, delta_usd_micros, reference_id, description, created_at)
           SELECT ?, user_id, 'payment_credit', amount_usd_micros, ?,
                  'Stablecoin balance top-up', ?
           FROM payment_orders
           WHERE id = ? AND status = 'finished'`,
        )
        .bind(
          ledgerId,
          `nowpayments:${paymentId}:credit`,
          updatedAt,
          orderId,
        ),
    );
    statements.push(
      db
        .prepare(
          `UPDATE payment_orders
           SET credited_usd_micros = amount_usd_micros, updated_at = ?
           WHERE id = ? AND status = 'finished'`,
        )
        .bind(updatedAt, orderId),
    );
  }

  if (status === "refunded") {
    statements.push(
      db
        .prepare(
          `UPDATE payment_orders
           SET status = 'refunded', updated_at = ?
           WHERE id = ?`,
        )
        .bind(updatedAt, orderId),
    );
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO balance_ledger
           (id, user_id, entry_type, delta_usd_micros, reference_id, description, created_at)
           SELECT ?, user_id, 'payment_reversal', -amount_usd_micros, ?,
                  'Stablecoin payment refunded', ?
           FROM payment_orders
           WHERE id = ? AND credited_usd_micros > 0`,
        )
        .bind(
          `led_${randomBase64Url(16)}`,
          `nowpayments:${paymentId}:reversal`,
          updatedAt,
          orderId,
        ),
    );
  }

  if (status !== "finished" && status !== "refunded") {
    statements.push(
      db
        .prepare(
          `UPDATE payment_orders
           SET status = ?, updated_at = ?
           WHERE id = ?
             AND status NOT IN ('finished', 'refunded', 'manual_review')`,
        )
        .bind(status, updatedAt, orderId),
    );
  }

  await db.batch(statements);
  return paymentWebhookAck(requestId);
}

async function handleProxyRequest(
  request: Request,
  env: PlatformEnv,
  ctx: WorkerExecutionContext,
  requestId: string,
): Promise<Response> {
  if (!isLiveProxyEnabled(env)) {
    throw new PlatformError(
      503,
      "upstream_not_authorized",
      "上游转售尚未启用；需先完成 TikHub 经销/白标授权并配置服务端密钥。",
    );
  }
  if (request.method !== "GET") {
    throw new PlatformError(
      405,
      "method_not_allowed",
      "安全沙盒当前只允许经过审核的 GET 只读调用。",
    );
  }

  const url = new URL(request.url);
  validateProxyPath(url.pathname);
  const db = requireDb(env);
  const catalog = await db
    .prepare(
      `SELECT path, platform, customer_price_usd_micros, enabled, read_only
       FROM endpoint_catalog
       WHERE path = ?`,
    )
    .bind(url.pathname)
    .first<CatalogRecord>();
  if (!catalog || catalog.enabled !== 1 || catalog.read_only !== 1) {
    throw new PlatformError(
      404,
      "endpoint_not_enabled",
      "该端点尚未通过只读与价格审核。",
    );
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

  const suppliedIdempotencyKey = request.headers
    .get("idempotency-key")
    ?.trim();
  if (
    suppliedIdempotencyKey &&
    (!/^[\x20-\x7E]{8,128}$/.test(suppliedIdempotencyKey) ||
      suppliedIdempotencyKey.includes("\\"))
  ) {
    throw new PlatformError(
      400,
      "invalid_idempotency_key",
      "Idempotency-Key 必须是 8–128 个可打印 ASCII 字符。",
    );
  }
  const idempotencyHash = await sha256Hex(
    `${key.id}:${suppliedIdempotencyKey ?? requestId}`,
  );
  const ledgerReferenceId = `api:${key.id}:${idempotencyHash}:debit`;
  if (suppliedIdempotencyKey) {
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
       VALUES (?, ?, ?, ?, ?, ?, 'processing', ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      requestId,
      key.id,
      key.user_id,
      idempotencyHash,
      ledgerReferenceId,
      url.pathname,
      catalog.customer_price_usd_micros,
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
    throw new PlatformError(
      409,
      "idempotency_conflict",
      `该 Idempotency-Key 已用于请求 ${previous?.id ?? "unknown"}（${previous?.status ?? "unknown"}），未重复调用或扣费。`,
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
  await markProxyRequest(db, requestId, "charged", null);

  const upstreamBase = normalizeUpstreamBase(env.TIKHUB_BASE_URL);
  const upstreamUrl = new URL(
    `${upstreamBase}${url.pathname.slice("/v1".length)}${url.search}`,
  );
  const upstreamHeaders = new Headers({
    authorization: `Bearer ${env.TIKHUB_API_KEY}`,
    accept: request.headers.get("accept") ?? "application/json",
    "user-agent": "RelayBase-API/1.0",
  });
  const contentType = request.headers.get("content-type");
  if (contentType) upstreamHeaders.set("content-type", contentType);

  const startedAt = Date.now();
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
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
      latencyMs: Date.now() - startedAt,
      refunded: true,
    });
    throw new PlatformError(
      502,
      "upstream_unavailable",
      "上游数据服务暂时不可用，本次未扣费。",
    );
  }

  const refunded = upstreamResponse.status !== 200;
  if (refunded) {
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

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

async function handleCatalogSync(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env);
  if (!env.TIKHUB_API_KEY) {
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
          authorization: `Bearer ${env.TIKHUB_API_KEY}`,
          accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(
          clampInteger(env.UPSTREAM_TIMEOUT_MS, 45_000, 30_000, 60_000),
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

  const payload = (await response.json()) as unknown;
  const entries = extractCatalogEntries(payload);
  if (entries.length === 0) {
    throw new PlatformError(
      502,
      "catalog_sync_failed",
      "上游响应中没有识别到端点与价格，请人工检查响应格式。",
    );
  }

  const db = requireDb(env);
  const markupBps = clampInteger(env.PRICE_MARKUP_BPS, 3000, 0, 50_000);
  let synced = 0;
  for (let offset = 0; offset < entries.length; offset += 50) {
    const statements = entries.slice(offset, offset + 50).map((entry) => {
      const customerPrice = Math.max(
        entry.upstreamPriceUsdMicros,
        Math.ceil(
          (entry.upstreamPriceUsdMicros * (10_000 + markupBps)) / 10_000,
        ),
      );
      return db
        .prepare(
          `INSERT INTO endpoint_catalog
           (path, platform, upstream_price_usd_micros,
            customer_price_usd_micros, enabled, read_only,
            source_updated_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(path) DO UPDATE SET
             platform = excluded.platform,
             upstream_price_usd_micros = excluded.upstream_price_usd_micros,
             customer_price_usd_micros = endpoint_catalog.customer_price_usd_micros,
             enabled = CASE
               WHEN endpoint_catalog.upstream_price_usd_micros != excluded.upstream_price_usd_micros
               THEN 0
               ELSE endpoint_catalog.enabled
             END,
             read_only = endpoint_catalog.read_only,
             reviewed_at = CASE
               WHEN endpoint_catalog.upstream_price_usd_micros != excluded.upstream_price_usd_micros
               THEN NULL
               ELSE endpoint_catalog.reviewed_at
             END,
             source_updated_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          entry.path,
          entry.platform,
          entry.upstreamPriceUsdMicros,
          customerPrice,
          entry.looksReadOnly ? 1 : 0,
        );
    });
    await db.batch(statements);
    synced += statements.length;
  }

  return jsonResponse(
    {
      synced,
      note: "新端点默认禁用；已审核端点的上游价格一旦变化会自动停用并清除审核状态，客户价格不会被同步任务静默覆盖。",
    },
    200,
    requestId,
  );
}

async function handleCatalogUpdate(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  requireAdminSecret(request, env);
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
  const result = await db
    .prepare(
      `UPDATE endpoint_catalog
       SET enabled = ?, read_only = ?, customer_price_usd_micros = ?,
           reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE path = ?`,
    )
    .bind(body.enabled ? 1 : 0, body.readOnly ? 1 : 0, price, path)
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new PlatformError(
      404,
      "endpoint_not_found",
      "目录中没有这个端点，请先同步上游目录。",
    );
  }

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
  requireAdminSecret(request, env);
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
         )`,
      )
      .bind(
        `led_${randomBase64Url(16)}`,
        item.user_id,
        item.cost_usd_micros,
        `${item.ledger_reference_id}:refund`,
        item.ledger_reference_id,
        -item.cost_usd_micros,
      )
      .run();
    refunded += Number(refund.meta?.changes ?? 0);
    await markProxyRequest(db, item.id, "reconciled", 500);
  }

  return jsonResponse(
    {
      inspected: stale.results?.length ?? 0,
      refunded,
      note: "仅回退两分钟前仍未完成、且确实存在扣款流水的代理请求。",
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
  const payload = (await response.json().catch(() => null)) as
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
  if (
    (typeof payment.payment_id !== "string" &&
      typeof payment.payment_id !== "number") ||
    typeof payment.pay_address !== "string" ||
    !payment.pay_address ||
    (typeof payment.pay_amount !== "string" &&
      typeof payment.pay_amount !== "number") ||
    typeof payment.pay_currency !== "string"
  ) {
    throw new PlatformError(
      502,
      "invalid_provider_response",
      "支付服务商返回了无法识别的订单。",
    );
  }
  return payment;
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
        signal: AbortSignal.timeout(20_000),
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
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!isPlainRecord(payload)) {
    throw new PlatformError(
      502,
      "provider_verification_failed",
      "支付服务商返回了无法识别的订单状态。",
    );
  }
  return payload as NowPaymentsPayment;
}

async function requireAuthenticatedUser(
  request: Request,
  db: D1Database,
): Promise<AuthenticatedUser> {
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

  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(email) DO UPDATE SET
         display_name = excluded.display_name,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(id, email, displayName)
    .run();

  const stored = await db
    .prepare(
      `SELECT id, email, display_name
       FROM users
       WHERE email = ? AND status = 'active'`,
    )
    .bind(email)
    .first<{ id: string; email: string; display_name: string | null }>();
  if (!stored) {
    throw new PlatformError(403, "account_suspended", "账户当前不可用。");
  }

  return {
    id: stored.id,
    email: stored.email,
    displayName: stored.display_name ?? stored.email,
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
       VALUES (?, ?, 'api_refund', ?, ?, 'Non-200 upstream response', ?)`,
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
    latencyMs: number;
    refunded: boolean;
  },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO api_calls
         (id, user_id, api_key_id, method, upstream_path, platform,
          status_code, cost_usd_micros, latency_ms, refunded, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
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
         WHERE id = ?`,
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

function extractCatalogEntries(payload: unknown): Array<{
  path: string;
  platform: string;
  upstreamPriceUsdMicros: number;
  looksReadOnly: boolean;
}> {
  const byPath = new Map<
    string,
    {
      path: string;
      platform: string;
      upstreamPriceUsdMicros: number;
      looksReadOnly: boolean;
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
        const platform = path.split("/")[2] || "other";
        const micros = Math.max(1, Math.round(rawPrice * 1_000_000));
        byPath.set(path, {
          path,
          platform,
          upstreamPriceUsdMicros: micros,
          looksReadOnly: looksLikeReadOnlyPath(path),
        });
      } catch {
        // Ignore non-endpoint URLs and malformed catalog records.
      }
    }

    for (const nested of Object.values(record)) visit(nested);
  };

  visit(payload);
  return [...byPath.values()].slice(0, 2_000);
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
    validateProxyPath(path);
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
  ];
  return !blockedSignals.some((signal) => normalized.includes(signal));
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
  if (
    !/^\/v1\/[a-zA-Z0-9/_-]+$/.test(path) ||
    path.includes("..") ||
    path.includes("//") ||
    path.endsWith("/")
  ) {
    throw new PlatformError(400, "invalid_endpoint", "端点路径无效。");
  }
  if (
    path.toLowerCase().startsWith("/v1/tikhub/") ||
    !looksLikeReadOnlyPath(path)
  ) {
    throw new PlatformError(
      403,
      "unsafe_endpoint",
      "账户、Cookie、发布、互动或其他非只读端点不在开放范围内。",
    );
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

function requireAdminSecret(request: Request, env: PlatformEnv): void {
  const configured = env.CATALOG_SYNC_SECRET;
  const supplied = bearerToken(request);
  if (
    !configured ||
    !supplied ||
    !constantTimeEqual(supplied, configured)
  ) {
    throw new PlatformError(401, "admin_unauthorized", "管理员凭证无效。");
  }
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
  if (!/^https:\/\//.test(origin) && !/^http:\/\/localhost(?::\d+)?$/.test(origin)) {
    throw new PlatformError(
      500,
      "invalid_app_configuration",
      "公开站点地址必须使用 HTTPS。",
    );
  }
  return origin;
}

function isLiveProxyEnabled(env: PlatformEnv): boolean {
  return env.RESELLER_AUTHORIZED === "true" && Boolean(env.TIKHUB_API_KEY);
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
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      "x-request-id": requestId,
    },
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
