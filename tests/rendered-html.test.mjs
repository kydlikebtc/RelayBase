import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = new URL("../", import.meta.url);
const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

class D1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    const statement = new D1Statement(this.database, this.sql);
    statement.params = params;
    return statement;
  }

  first() {
    return this.database.prepare(this.sql).get(...this.params) ?? null;
  }

  all() {
    return {
      success: true,
      results: this.database.prepare(this.sql).all(...this.params),
      meta: {},
    };
  }

  run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes ?? 0) },
    };
  }
}

class TestD1 {
  constructor() {
    this.raw = new DatabaseSync(":memory:");
    this.raw.exec("PRAGMA foreign_keys = ON");
  }

  prepare(sql) {
    return new D1Statement(this.raw, sql);
  }

  batch(statements) {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => {
        if (!statement || !(statement instanceof D1Statement)) {
          throw new TypeError("Unsupported D1 statement");
        }
        if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(statement.sql)) {
          return statement.all();
        }
        return statement.run();
      });
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.raw.close();
  }
}

function context() {
  const pending = [];
  return {
    pending,
    waitUntil(promise) {
      pending.push(Promise.resolve(promise));
    },
    passThroughOnException() {},
  };
}

function baseEnv(overrides = {}) {
  return {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
    ...overrides,
  };
}

async function fetchWorker(path, init = {}, env = baseEnv()) {
  const ctx = context();
  const response = await worker.fetch(
    new Request(new URL(path, "http://localhost"), init),
    env,
    ctx,
  );
  await Promise.allSettled(ctx.pending);
  return response;
}

async function migrate(db) {
  const names = [
    "drizzle/0000_wandering_richard_fisk.sql",
    "drizzle/0001_overrated_ted_forrester.sql",
  ];
  for (const name of names) {
    const sql = await readFile(new URL(name, root), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) db.raw.exec(statement);
    }
  }
}

function signedInHeaders(extra = {}) {
  return {
    origin: "http://localhost",
    "content-type": "application/json",
    "oai-authenticated-user-email": "owner@example.com",
    "oai-authenticated-user-full-name": "Relay%20Owner",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    ...extra,
  };
}

function sortForSignature(value) {
  if (Array.isArray(value)) return value.map(sortForSignature);
  if (!value || typeof value !== "object") return value;
  const sorted = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortForSignature(value[key]);
  }
  return sorted;
}

function nowPaymentsSignature(secret, payload) {
  return createHmac("sha512", secret)
    .update(JSON.stringify(sortForSignature(payload)))
    .digest("hex");
}

test("renders the finished product routes without starter metadata", async () => {
  for (const [path, expected] of [
    ["/", "把分散的数据接口"],
    ["/docs", "API 文档"],
    ["/pricing", "只为真实请求付费"],
    ["/console", "控制台"],
  ]) {
    const response = await fetchWorker(path, {
      headers: { accept: "text/html" },
    });
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.match(html, /RelayBase/);
    assert.match(html, new RegExp(expected));
    assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
    assert.doesNotMatch(html, /react-loading-skeleton/i);
  }
});

test("reports sandbox health and blocks live operations by default", async () => {
  const health = await fetchWorker("/api/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).mode, "sandbox");
  assert.ok(health.headers.get("x-request-id"));

  const proxy = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile?uniqueId=test",
    {
      headers: { authorization: "Bearer rb_live_fake" },
    },
  );
  assert.equal(proxy.status, 503);
  assert.equal((await proxy.json()).error.code, "upstream_not_authorized");

  const payment = await fetchWorker("/api/payments", {
    method: "POST",
    headers: signedInHeaders(),
    body: JSON.stringify({ amountUsd: 10, payCurrency: "usdttrc20" }),
  });
  assert.equal(payment.status, 503);
  assert.equal((await payment.json()).error.code, "payments_in_sandbox");
});

test("validates browser and admin JSON without coercion", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({
    DB: db,
    CRYPTO_PAYMENTS_ENABLED: "true",
    LEGAL_REVIEW_CONFIRMED: "true",
    PAYMENT_PROVIDER: "nowpayments",
    NOWPAYMENTS_API_KEY: "test-provider-key",
    CATALOG_SYNC_SECRET: "catalog-secret",
  });

  const stringAmount = await fetchWorker(
    "/api/payments",
    {
      method: "POST",
      headers: signedInHeaders(),
      body: JSON.stringify({
        amountUsd: "10",
        payCurrency: "usdttrc20",
      }),
    },
    env,
  );
  assert.equal(stringAmount.status, 400);
  assert.equal(
    (await stringAmount.json()).error.code,
    "invalid_payment_amount",
  );

  const nullBody = await fetchWorker(
    "/api/keys",
    {
      method: "POST",
      headers: signedInHeaders(),
      body: "null",
    },
    env,
  );
  assert.equal(nullBody.status, 400);
  assert.equal((await nullBody.json()).error.code, "invalid_json");

  const stringPrice = await fetchWorker(
    "/api/admin/catalog",
    {
      method: "PATCH",
      headers: {
        authorization: "Bearer catalog-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        path: "/v1/tiktok/web/fetch_user_profile",
        enabled: false,
        readOnly: true,
        customerPriceUsdMicros: "2000",
      }),
    },
    env,
  );
  assert.equal(stringPrice.status, 400);
  assert.equal(
    (await stringPrice.json()).error.code,
    "invalid_endpoint_price",
  );

  const invalidPath = await fetchWorker(
    "/api/admin/catalog",
    {
      method: "PATCH",
      headers: {
        authorization: "Bearer catalog-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        path: "/v2/private",
        enabled: false,
        readOnly: true,
        customerPriceUsdMicros: 2000,
      }),
    },
    env,
  );
  assert.equal(invalidPath.status, 400);
  assert.equal((await invalidPath.json()).error.code, "invalid_endpoint");
});

test("creates hashed customer keys and proxies with idempotent billing", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({
    DB: db,
    RESELLER_AUTHORIZED: "true",
    TIKHUB_API_KEY: "upstream-secret",
    TIKHUB_BASE_URL: "https://api.tikhub.io/api/v1",
    API_RATE_LIMIT_RPM: "2",
  });

  const createKey = await fetchWorker(
    "/api/keys",
    {
      method: "POST",
      headers: signedInHeaders(),
      body: JSON.stringify({ label: "CI key" }),
    },
    env,
  );
  assert.equal(createKey.status, 201);
  const created = (await createKey.json()).key;
  assert.match(created.secret, /^rb_live_/);

  const storedKey = db.raw
    .prepare("SELECT key_hash, key_prefix FROM api_keys WHERE id = ?")
    .get(created.id);
  assert.notEqual(storedKey.key_hash, created.secret);
  assert.equal(storedKey.key_prefix, created.prefix);
  const user = db.raw
    .prepare("SELECT id FROM users WHERE email = ?")
    .get("owner@example.com");
  db.raw
    .prepare(
      `INSERT INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id)
       VALUES ('seed-credit', ?, 'test_credit', 1000000, 'test:seed')`,
    )
    .run(user.id);
  db.raw
    .prepare(
      `UPDATE endpoint_catalog
       SET enabled = 1, read_only = 1, customer_price_usd_micros = 2000,
           reviewed_at = CURRENT_TIMESTAMP
       WHERE path = '/v1/tiktok/web/fetch_user_profile'`,
    )
    .run();

  const nativeFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async (input) => {
    upstreamCalls += 1;
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    assert.equal(url.origin, "https://api.tikhub.io");
    assert.equal(
      url.pathname,
      "/api/v1/tiktok/web/fetch_user_profile",
    );
    if (url.searchParams.get("uniqueId") === "missing") {
      return Response.json(
        { code: 404, message: "not found" },
        { status: 404 },
      );
    }
    return Response.json({ code: 200, data: { uniqueId: "test" } });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const authHeaders = {
    authorization: `Bearer ${created.secret}`,
    "idempotency-key": "job-0001",
  };
  const success = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile?uniqueId=test",
    { headers: authHeaders },
    env,
  );
  assert.equal(success.status, 200);
  assert.equal(success.headers.get("x-relaybase-cost-usd-micros"), "2000");
  assert.equal(
    success.headers.get("x-relaybase-balance-usd-micros"),
    "998000",
  );
  assert.equal(upstreamCalls, 1);

  const duplicate = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile?uniqueId=test",
    { headers: authHeaders },
    env,
  );
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, "idempotency_conflict");
  assert.equal(upstreamCalls, 1);

  const failed = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile?uniqueId=missing",
    {
      headers: {
        authorization: `Bearer ${created.secret}`,
        "idempotency-key": "job-0002",
      },
    },
    env,
  );
  assert.equal(failed.status, 404);
  assert.equal(failed.headers.get("x-relaybase-cost-usd-micros"), "0");
  assert.equal(
    failed.headers.get("x-relaybase-balance-usd-micros"),
    "998000",
  );
  assert.equal(upstreamCalls, 2);

  const limited = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile?uniqueId=third",
    {
      headers: {
        authorization: `Bearer ${created.secret}`,
        "idempotency-key": "job-0003",
      },
    },
    env,
  );
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, "rate_limit_exceeded");
  assert.equal(upstreamCalls, 2);

  const post = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile",
    {
      method: "POST",
      headers: { authorization: `Bearer ${created.secret}` },
      body: "{}",
    },
    env,
  );
  assert.equal(post.status, 405);
  assert.equal(upstreamCalls, 2);

  const dashboard = await fetchWorker(
    "/api/dashboard",
    { headers: signedInHeaders() },
    env,
  );
  assert.equal(dashboard.status, 200);
  const dashboardData = await dashboard.json();
  assert.equal(dashboardData.balanceUsdMicros, 998000);
  assert.equal(dashboardData.keys[0].secret, undefined);
  assert.equal(dashboardData.calls.length, 2);
});

test("keeps refunded payments terminal and limits webhook bodies", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-payment', 'payer@example.com', 'Payer')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, provider_payment_id, amount_usd_micros,
        pay_currency, pay_amount, status)
       VALUES ('pay_terminal', 'usr-payment', 'nowpayments', 'np-1',
               10000000, 'usdttrc20', '10', 'waiting')`,
    )
    .run();

  const ipnSecret = "ipn-test-secret";
  const env = baseEnv({
    DB: db,
    NOWPAYMENTS_API_KEY: "provider-test-key",
    NOWPAYMENTS_IPN_SECRET: ipnSecret,
  });
  let verifiedStatus = "refunded";
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      payment_id: "np-1",
      payment_status: verifiedStatus,
      order_id: "pay_terminal",
      price_amount: 10,
      price_currency: "usd",
      pay_amount: "10",
      actually_paid: "10",
      pay_currency: "usdttrc20",
    });
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  async function sendIpn(status) {
    const payload = {
      payment_id: "np-1",
      payment_status: status,
      order_id: "pay_terminal",
    };
    return fetchWorker(
      "/api/payments/nowpayments/ipn",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-nowpayments-sig": nowPaymentsSignature(ipnSecret, payload),
        },
        body: JSON.stringify(payload),
      },
      env,
    );
  }

  const refundFirst = await sendIpn("refunded");
  assert.equal(refundFirst.status, 200);
  verifiedStatus = "finished";
  const staleFinished = await sendIpn("finished");
  assert.equal(staleFinished.status, 200);
  const order = db.raw
    .prepare(
      "SELECT status, credited_usd_micros FROM payment_orders WHERE id = 'pay_terminal'",
    )
    .get();
  assert.equal(order.status, "refunded");
  assert.equal(order.credited_usd_micros, 0);
  const balance = db.raw
    .prepare(
      "SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance FROM balance_ledger WHERE user_id = 'usr-payment'",
    )
    .get();
  assert.equal(balance.balance, 0);

  const oversized = await fetchWorker(
    "/api/payments/nowpayments/ipn",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(70 * 1024) }),
    },
    env,
  );
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, "payload_too_large");
});
