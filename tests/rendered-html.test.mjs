import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";

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

class PausableBatchD1 extends TestD1 {
  pauseNextBatch(predicate) {
    let markPaused;
    let resume;
    const paused = new Promise((resolve) => {
      markPaused = resolve;
    });
    const resumed = new Promise((resolve) => {
      resume = resolve;
    });
    this.batchPause = {
      predicate,
      markPaused,
      resumed,
      resume,
    };
    return {
      paused,
      release: () => resume(),
    };
  }

  batch(statements) {
    const pause = this.batchPause;
    if (pause && pause.predicate(statements)) {
      this.batchPause = null;
      pause.markPaused();
      return pause.resumed.then(() => super.batch(statements));
    }
    return super.batch(statements);
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
    PUBLIC_APP_URL: "http://localhost",
    TRUST_SITES_IDENTITY_HEADERS: "true",
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

const migrationFiles = [
  "drizzle/0000_wandering_richard_fisk.sql",
  "drizzle/0001_overrated_ted_forrester.sql",
  "drizzle/0002_overrated_iron_fist.sql",
  "drizzle/0003_woozy_switch.sql",
  "drizzle/0004_sad_azazel.sql",
  "drizzle/0005_red_swarm.sql",
  "drizzle/0006_needy_barracuda.sql",
  "drizzle/0007_ambiguous_colonel_america.sql",
  "drizzle/0008_good_apocalypse.sql",
];

async function migrate(db, names = migrationFiles) {
  for (const name of names) {
    const sql = await readFile(new URL(name, root), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) db.raw.exec(statement);
    }
  }
}

function enableCatalogEndpoint(
  db,
  path = "/v1/tiktok/web/fetch_user_profile",
  customerPriceUsdMicros = 2000,
) {
  const generation = "sync-test-complete";
  db.raw
    .prepare(
      `INSERT INTO catalog_sync_state
       (id, last_success_generation, synced_at)
       VALUES (1, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         last_success_generation = excluded.last_success_generation,
         synced_at = CURRENT_TIMESTAMP`,
    )
    .run(generation);
  db.raw
    .prepare(
      `UPDATE endpoint_catalog
       SET enabled = 1, read_only = 1,
           customer_price_usd_micros = ?,
           price_verified = 1, http_method = 'GET',
           sync_generation = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE path = ?`,
    )
    .run(customerPriceUsdMicros, generation, path);
  db.raw
    .prepare(
      `INSERT INTO operation_heartbeats
       (name, last_success_at, details_json)
       VALUES ('reconciliation', CURRENT_TIMESTAMP, '{}')
       ON CONFLICT(name) DO UPDATE SET
         last_success_at = CURRENT_TIMESTAMP`,
    )
    .run();
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

function responseCookie(response, name) {
  const header = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`(?:^|,?\\s*)${name}=([^;]*)`).exec(header);
  return match ? `${name}=${match[1]}` : null;
}

test("renders the finished product routes without starter metadata", async () => {
  for (const [path, expected] of [
    ["/", "把分散的数据接口"],
    ["/docs", "API 文档"],
    ["/catalog", "接口目录"],
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

test("fails readiness and payment creation when database migrations are stale", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db, migrationFiles.slice(0, 2));
  db.raw
    .prepare(
      `UPDATE endpoint_catalog
       SET enabled = 1, read_only = 1, reviewed_at = CURRENT_TIMESTAMP`,
    )
    .run();

  const env = baseEnv({
    DB: db,
    LEGAL_REVIEW_CONFIRMED: "true",
    RESELLER_AUTHORIZED: "true",
    TIKHUB_API_KEY: "upstream-key",
    CRYPTO_PAYMENTS_ENABLED: "true",
    PAYMENT_PROVIDER: "nowpayments",
    NOWPAYMENTS_API_KEY: "provider-key",
    NOWPAYMENTS_IPN_SECRET: "ipn-secret",
    CATALOG_SYNC_SECRET: "catalog-secret-32-characters-minimum",
    RECONCILIATION_SECRET: "reconcile-secret-32-characters-minimum",
    PAYMENT_ADMIN_SECRET: "payment-admin-secret-32-characters-minimum",
  });

  const readiness = await fetchWorker("/api/readiness", {}, env);
  assert.equal(readiness.status, 503);
  const readinessData = await readiness.json();
  assert.equal(readinessData.capabilities.schemaReady, false);
  assert.ok(readinessData.missing.includes("database_migrations"));

  const keyResponse = await fetchWorker(
    "/api/keys",
    {
      method: "POST",
      headers: signedInHeaders(),
      body: JSON.stringify({ label: "stale schema key" }),
    },
    env,
  );
  assert.equal(keyResponse.status, 201);
  const key = (await keyResponse.json()).key;
  const user = db.raw
    .prepare("SELECT id FROM users WHERE email = ?")
    .get("owner@example.com");
  db.raw
    .prepare(
      `INSERT INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id)
       VALUES ('stale-schema-credit', ?, 'test_credit', 1000000,
               'test:stale-schema')`,
    )
    .run(user.id);
  const proxy = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile?uniqueId=schema",
    {
      headers: {
        authorization: `Bearer ${key.secret}`,
        "idempotency-key": "stale-schema-proxy",
      },
    },
    env,
  );
  assert.equal(proxy.status, 503);
  assert.equal((await proxy.json()).error.code, "service_not_ready");
  assert.equal(
    db.raw
      .prepare(
        `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
         FROM balance_ledger
         WHERE user_id = ?`,
      )
      .get(user.id).balance,
    1000000,
  );

  const payment = await fetchWorker(
    "/api/payments",
    {
      method: "POST",
      headers: signedInHeaders({
        "idempotency-key": "stale-schema-payment",
      }),
      body: JSON.stringify({
        amountUsd: 10,
        payCurrency: "usdttrc20",
      }),
    },
    env,
  );
  assert.equal(payment.status, 503);
  assert.equal(
    (await payment.json()).error.code,
    "database_migrations_required",
  );
});

test("upgrades populated payment events through the auth and review migrations", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db, migrationFiles.slice(0, 7));
  db.raw
    .prepare(
      `INSERT INTO payment_events
       (id, provider, provider_payment_id, order_id, payment_status,
        payload_json, payload_hash, received_at, processing_error)
       VALUES ('evt-upgrade', 'nowpayments', 'np-upgrade', 'pay-upgrade',
               'waiting', '{}', 'hash-upgrade',
               '2026-07-23 10:00:00', 'retry me')`,
    )
    .run();

  await migrate(db, migrationFiles.slice(7));
  const event = db.raw
    .prepare(
      `SELECT attempt_count, last_attempt_at, next_attempt_at,
              processing_error
       FROM payment_events
       WHERE id = 'evt-upgrade'`,
    )
    .get();
  assert.equal(event.attempt_count, 0);
  assert.equal(event.last_attempt_at, null);
  assert.equal(event.next_attempt_at, "2026-07-23 10:00:00");
  assert.equal(event.processing_error, "retry me");
  assert.ok(
    db.raw
      .prepare(
        `SELECT 1 AS present
         FROM sqlite_master
         WHERE type = 'table' AND name = 'auth_sessions'`,
      )
      .get()?.present,
  );
  assert.ok(
    db.raw
      .prepare(
        `SELECT 1 AS present
         FROM pragma_table_info('payment_review_cases')
         WHERE name = 'resolution_request_hash'`,
      )
      .get()?.present,
  );
});

test("validates browser and admin JSON without coercion", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({
    DB: db,
    CRYPTO_PAYMENTS_ENABLED: "true",
    LEGAL_REVIEW_CONFIRMED: "true",
    RESELLER_AUTHORIZED: "true",
    TIKHUB_API_KEY: "upstream-test-key",
    PAYMENT_PROVIDER: "nowpayments",
    NOWPAYMENTS_API_KEY: "test-provider-key",
    NOWPAYMENTS_IPN_SECRET: "test-ipn-secret",
    CATALOG_SYNC_SECRET: "catalog-secret-32-characters-minimum",
  });

  const stringAmount = await fetchWorker(
    "/api/payments",
    {
      method: "POST",
      headers: signedInHeaders({
        "idempotency-key": "payment-test-amount",
      }),
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
        authorization: "Bearer catalog-secret-32-characters-minimum",
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
        authorization: "Bearer catalog-secret-32-characters-minimum",
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

test("uses one-time wallet signatures and ignores untrusted identity headers", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({
    DB: db,
    TRUST_SITES_IDENTITY_HEADERS: "false",
    WALLET_LOGIN_ENABLED: "true",
  });

  const spoofed = await fetchWorker(
    "/api/auth/me",
    {
      headers: {
        "oai-authenticated-user-email": "attacker@example.com",
      },
    },
    env,
  );
  assert.equal(spoofed.status, 401);

  const account = privateKeyToAccount(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  );
  const challengeResponse = await fetchWorker(
    "/api/auth/wallet/challenge",
    {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.10",
      },
      body: JSON.stringify({
        address: account.address,
        chainId: "0x1",
        returnTo: "/console?from=wallet",
      }),
    },
    env,
  );
  assert.equal(challengeResponse.status, 200);
  const challenge = await challengeResponse.json();
  assert.match(challenge.message, /does not send a transaction/);
  assert.match(challenge.message, /Chain ID: 1/);
  const signature = await account.signMessage({
    message: challenge.message,
  });
  const verify = () =>
    fetchWorker(
      "/api/auth/wallet/verify",
      {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          address: account.address,
          signature,
        }),
      },
      env,
    );
  const verified = await verify();
  assert.equal(verified.status, 200);
  const verifiedPayload = await verified.json();
  assert.equal(verifiedPayload.user.provider, "wallet");
  assert.equal(verifiedPayload.user.email, null);
  assert.equal(verifiedPayload.returnTo, "/console?from=wallet");
  const sessionCookie = responseCookie(verified, "rb_session");
  assert.ok(sessionCookie);

  const me = await fetchWorker(
    "/api/auth/me",
    { headers: { cookie: sessionCookie } },
    env,
  );
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.walletAddress, account.address.toLowerCase());

  const replay = await verify();
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).error.code, "wallet_challenge_expired");

  const signout = await fetchWorker(
    "/api/auth/signout",
    {
      method: "POST",
      headers: {
        origin: "http://localhost",
        cookie: sessionCookie,
      },
    },
    env,
  );
  assert.equal(signout.status, 200);
  const signedOutMe = await fetchWorker(
    "/api/auth/me",
    { headers: { cookie: sessionCookie } },
    env,
  );
  assert.equal(signedOutMe.status, 401);
});

test("verifies Google PKCE state, nonce and server-side identity before session creation", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({
    DB: db,
    TRUST_SITES_IDENTITY_HEADERS: "false",
    GOOGLE_CLIENT_ID: "google-client.apps.exampleusercontent.com",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
  });

  const start = await fetchWorker(
    "/api/auth/google/start?return_to=%2Fconsole%3Ffrom%3Dgoogle",
    {
      headers: {
        "cf-connecting-ip": "203.0.113.11",
      },
    },
    env,
  );
  assert.equal(start.status, 302);
  const authorizationUrl = new URL(start.headers.get("location"));
  assert.equal(authorizationUrl.hostname, "accounts.google.com");
  assert.equal(
    authorizationUrl.searchParams.get("code_challenge_method"),
    "S256",
  );
  const state = authorizationUrl.searchParams.get("state");
  assert.match(state, /^auth_/);
  const stateCookie = responseCookie(start, "rb_oauth_state");
  assert.ok(stateCookie);
  const storedChallenge = db.raw
    .prepare(
      `SELECT subject_hint
       FROM auth_challenges
       WHERE id = ?`,
    )
    .get(state);

  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({
        id_token: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
      });
    }
    if (url.startsWith("https://oauth2.googleapis.com/tokeninfo?")) {
      return Response.json({
        iss: "https://accounts.google.com",
        aud: env.GOOGLE_CLIENT_ID,
        sub: "google-subject-123456",
        email: "verified.user@example.com",
        email_verified: "true",
        exp: String(Math.floor(Date.now() / 1000) + 600),
        nonce: storedChallenge.subject_hint,
        name: "Verified User",
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const callback = await fetchWorker(
    `/api/auth/google/callback?code=google-code-123&state=${encodeURIComponent(state)}`,
    {
      headers: { cookie: stateCookie },
    },
    env,
  );
  assert.equal(callback.status, 302);
  assert.equal(
    callback.headers.get("location"),
    "http://localhost/console?from=google",
  );
  const sessionCookie = responseCookie(callback, "rb_session");
  assert.ok(sessionCookie);
  const me = await fetchWorker(
    "/api/auth/me",
    { headers: { cookie: sessionCookie } },
    env,
  );
  assert.equal(me.status, 200);
  const user = (await me.json()).user;
  assert.deepEqual(user, {
    displayName: "Verified User",
    email: "verified.user@example.com",
    walletAddress: null,
    provider: "google",
  });
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM auth_identities
         WHERE provider = 'google' AND subject = 'google-subject-123456'`,
      )
      .get().count,
    1,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM auth_challenges
         WHERE id = ? AND consumed_at IS NOT NULL`,
      )
      .get(state).count,
    1,
  );
});

test("does not auto-link a reassigned Google email to an existing account", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-victim', 'victim@example.com', 'Original Owner')`,
    )
    .run();
  const env = baseEnv({
    DB: db,
    TRUST_SITES_IDENTITY_HEADERS: "false",
    GOOGLE_CLIENT_ID: "google-client.apps.exampleusercontent.com",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
  });
  const start = await fetchWorker(
    "/api/auth/google/start",
    { headers: { "cf-connecting-ip": "203.0.113.12" } },
    env,
  );
  const authorizationUrl = new URL(start.headers.get("location"));
  const state = authorizationUrl.searchParams.get("state");
  const nonce = db.raw
    .prepare(
      `SELECT subject_hint FROM auth_challenges WHERE id = ?`,
    )
    .get(state).subject_hint;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({
        id_token: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIyIn0.signature",
      });
    }
    return Response.json({
      iss: "https://accounts.google.com",
      aud: env.GOOGLE_CLIENT_ID,
      sub: "new-google-holder-123456",
      email: "victim@example.com",
      email_verified: "true",
      exp: String(Math.floor(Date.now() / 1000) + 600),
      nonce,
      name: "New Mailbox Holder",
    });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const callback = await fetchWorker(
    `/api/auth/google/callback?code=google-code-456&state=${encodeURIComponent(state)}`,
    {
      headers: {
        cookie: responseCookie(start, "rb_oauth_state"),
      },
    },
    env,
  );
  assert.equal(callback.status, 302);
  const failureLocation = new URL(callback.headers.get("location"));
  assert.equal(
    failureLocation.searchParams.get("error"),
    "identity_link_required",
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM auth_identities
         WHERE provider = 'google'
           AND subject = 'new-google-holder-123456'`,
      )
      .get().count,
    0,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT display_name
         FROM users WHERE id = 'usr-victim'`,
      )
      .get().display_name,
    "Original Owner",
  );
});

test("creates hashed customer keys and proxies with idempotent billing", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({
    DB: db,
    RESELLER_AUTHORIZED: "true",
    LEGAL_REVIEW_CONFIRMED: "true",
    TIKHUB_API_KEY: "upstream-secret",
    TIKHUB_BASE_URL: "https://api.tikhub.io/api/v1",
    API_RATE_LIMIT_RPM: "4",
    RECONCILIATION_SECRET: "reconcile-secret-32-characters-minimum",
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
  enableCatalogEndpoint(db);

  const noBalance = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile?uniqueId=no-balance",
    {
      headers: {
        authorization: `Bearer ${created.secret}`,
        "idempotency-key": "job-zero-balance",
      },
    },
    env,
  );
  assert.equal(noBalance.status, 402);
  assert.equal(
    db.raw
      .prepare(
        "SELECT COUNT(*) AS count FROM upstream_rate_limit_buckets",
      )
      .get().count,
    0,
  );

  db.raw
    .prepare(
      `INSERT INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id)
       VALUES ('seed-credit', ?, 'test_credit', 1000000, 'test:seed')`,
    )
    .run(user.id);

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
    if (url.searchParams.get("uniqueId") === "invalid-json") {
      return new Response("<html>upstream bot check</html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
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
  assert.equal((await failed.clone().json()).error.code, "upstream_error");
  assert.equal(failed.headers.get("x-relaybase-cost-usd-micros"), "0");
  assert.equal(
    failed.headers.get("x-relaybase-balance-usd-micros"),
    "998000",
  );
  assert.equal(upstreamCalls, 2);

  const invalidSuccess = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile?uniqueId=invalid-json",
    {
      headers: {
        authorization: `Bearer ${created.secret}`,
        "idempotency-key": "job-invalid-success",
      },
    },
    env,
  );
  assert.equal(invalidSuccess.status, 502);
  assert.equal(
    (await invalidSuccess.json()).error.code,
    "upstream_error",
  );
  assert.equal(
    invalidSuccess.headers.get("x-relaybase-cost-usd-micros"),
    "0",
  );
  assert.equal(
    invalidSuccess.headers.get("x-relaybase-balance-usd-micros"),
    "998000",
  );
  assert.equal(upstreamCalls, 3);

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
  assert.equal(upstreamCalls, 3);

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
  assert.equal(upstreamCalls, 3);

  const dashboard = await fetchWorker(
    "/api/dashboard",
    { headers: signedInHeaders() },
    env,
  );
  assert.equal(dashboard.status, 200);
  const dashboardData = await dashboard.json();
  assert.equal(dashboardData.balanceUsdMicros, 998000);
  assert.equal(dashboardData.keys[0].secret, undefined);
  assert.equal(dashboardData.calls.length, 3);
  assert.equal(dashboardData.calls[0].refunded, true);
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
  let providerReads = 0;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    providerReads += 1;
    return Response.json({
      payment_id: "np-1",
      payment_status: verifiedStatus,
      order_id: "pay_terminal",
      price_amount: 10,
      price_currency: "usd",
      pay_amount: "10",
      actually_paid: "10",
      pay_currency: "usdttrc20",
    });
  };
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
  const duplicateRefund = await sendIpn("refunded");
  assert.equal(duplicateRefund.status, 200);
  assert.equal(providerReads, 1);
  verifiedStatus = "finished";
  const staleFinished = await sendIpn("finished");
  assert.equal(staleFinished.status, 200);
  assert.equal(providerReads, 2);
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

test("holds materially overpaid finished orders for operator review", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-overpay', 'overpay@example.com', 'Overpayer')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, provider_payment_id, amount_usd_micros,
        pay_currency, pay_amount, status)
       VALUES ('pay_overpay', 'usr-overpay', 'nowpayments', 'np-overpay',
               10000000, 'usdttrc20', '10', 'confirming')`,
    )
    .run();
  const ipnSecret = "overpay-ipn-secret";
  const env = baseEnv({
    DB: db,
    NOWPAYMENTS_API_KEY: "provider-test-key",
    NOWPAYMENTS_IPN_SECRET: ipnSecret,
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      payment_id: "np-overpay",
      payment_status: "finished",
      order_id: "pay_overpay",
      price_amount: 10,
      price_currency: "usd",
      pay_amount: "10",
      actually_paid: "10.25",
      pay_currency: "usdttrc20",
    });
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });
  const payload = {
    payment_id: "np-overpay",
    payment_status: "finished",
    order_id: "pay_overpay",
  };
  const webhook = await fetchWorker(
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
  assert.equal(webhook.status, 200);
  const held = db.raw
    .prepare(
      `SELECT p.status, p.credited_usd_micros, r.reason
       FROM payment_orders p
       JOIN payment_review_cases r ON r.order_id = p.id
       WHERE p.id = 'pay_overpay'`,
    )
    .get();
  assert.equal(held.status, "manual_review");
  assert.equal(held.credited_usd_micros, 0);
  assert.equal(held.reason, "overpaid_finished");
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM balance_ledger
         WHERE user_id = 'usr-overpay'`,
      )
      .get().count,
    0,
  );
});

test("atomically reverses credited funds when an operator confirms a provider refund", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-refund-review', 'refund-review@example.com',
               'Refund Review')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, provider_payment_id, amount_usd_micros,
        pay_currency, pay_amount, status, credited_usd_micros)
       VALUES ('pay_refund_review', 'usr-refund-review', 'nowpayments',
               'np-refund-review', 10000000, 'usdttrc20', '10',
               'manual_review', 10000000)`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id)
       VALUES ('led-refund-review', 'usr-refund-review', 'payment_credit',
               10000000, 'nowpayments:np-refund-review:credit')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_review_cases
       (id, order_id, provider_payment_id, reason, status, evidence_json)
       VALUES ('prv_refund_review_case', 'pay_refund_review',
               'np-refund-review', 'provider_data_mismatch', 'open', '{}')`,
    )
    .run();
  const adminSecret = "refund-review-admin-secret-32-characters";
  const env = baseEnv({
    DB: db,
    NOWPAYMENTS_API_KEY: "provider-test-key",
    PAYMENT_ADMIN_SECRET: adminSecret,
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      payment_id: "np-refund-review",
      payment_status: "refunded",
      order_id: "pay_refund_review",
      price_amount: 10,
      price_currency: "usd",
      pay_amount: "10",
      actually_paid: "10",
      pay_currency: "usdttrc20",
    });
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });
  const unsafeCredit = await fetchWorker(
    "/api/admin/payment-reviews/resolve",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        caseId: "prv_refund_review_case",
        action: "credit",
        creditUsdMicros: 10000000,
        note: "This must be rejected because provider says refunded.",
      }),
    },
    env,
  );
  assert.equal(unsafeCredit.status, 409);
  assert.equal(
    (await unsafeCredit.json()).error.code,
    "payment_review_not_creditable",
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
         FROM balance_ledger
         WHERE user_id = 'usr-refund-review'`,
      )
      .get().balance,
    10000000,
  );
  const resolve = () =>
    fetchWorker(
      "/api/admin/payment-reviews/resolve",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${adminSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          caseId: "prv_refund_review_case",
          action: "refund_confirmed",
          note: "Provider status confirms the original payment refund.",
        }),
      },
      env,
    );
  const first = await resolve();
  assert.equal(first.status, 200);
  const replay = await resolve();
  assert.equal(replay.status, 200);
  assert.equal(
    db.raw
      .prepare(
        `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
         FROM balance_ledger
         WHERE user_id = 'usr-refund-review'`,
      )
      .get().balance,
    0,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT status, credited_usd_micros
         FROM payment_orders
         WHERE id = 'pay_refund_review'`,
      )
      .get().status,
    "refunded",
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT credited_usd_micros
         FROM payment_orders
         WHERE id = 'pay_refund_review'`,
      )
      .get().credited_usd_micros,
    0,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM balance_ledger
         WHERE reference_id = 'nowpayments:np-refund-review:reversal'`,
      )
      .get().count,
    1,
  );
});

test("refuses a manual review credit after the same provider payment was automatically credited", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-auto-first', 'auto-first@example.com', 'Auto First')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, provider_payment_id, amount_usd_micros,
        pay_currency, pay_amount, status)
       VALUES ('pay_auto_first', 'usr-auto-first', 'nowpayments',
               'np-auto-first', 10000000, 'usdttrc20', '10', 'waiting')`,
    )
    .run();

  const ipnSecret = "auto-first-ipn-secret";
  const adminSecret = "auto-first-admin-secret-32-characters";
  const env = baseEnv({
    DB: db,
    NOWPAYMENTS_API_KEY: "provider-test-key",
    NOWPAYMENTS_IPN_SECRET: ipnSecret,
    PAYMENT_ADMIN_SECRET: adminSecret,
  });
  let providerStatus = "finished";
  let actuallyPaid = "10";
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      payment_id: "np-auto-first",
      payment_status: providerStatus,
      order_id: "pay_auto_first",
      price_amount: 10,
      price_currency: "usd",
      pay_amount: "10",
      actually_paid: actuallyPaid,
      pay_currency: "usdttrc20",
    });
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const sendWebhook = (paymentStatus) => {
    const payload = {
      payment_id: "np-auto-first",
      payment_status: paymentStatus,
      order_id: "pay_auto_first",
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
  };

  assert.equal((await sendWebhook("finished")).status, 200);
  providerStatus = "failed";
  actuallyPaid = "2";
  assert.equal((await sendWebhook("failed")).status, 200);
  const review = db.raw
    .prepare(
      `SELECT id, status
       FROM payment_review_cases
       WHERE provider_payment_id = 'np-auto-first'`,
    )
    .get();
  assert.equal(review.status, "open");

  providerStatus = "finished";
  actuallyPaid = "10";
  const resolve = await fetchWorker(
    "/api/admin/payment-reviews/resolve",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        caseId: review.id,
        action: "credit",
        creditUsdMicros: 10000000,
        note: "Do not duplicate the already posted automatic credit.",
      }),
    },
    env,
  );
  assert.equal(resolve.status, 409);
  assert.equal(
    (await resolve.json()).error.code,
    "payment_already_credited",
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
         FROM balance_ledger
         WHERE user_id = 'usr-auto-first'`,
      )
      .get().balance,
    10000000,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM balance_ledger
         WHERE reference_id = ?`,
      )
      .get(`nowpayments-review:${review.id}:credit`).count,
    0,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT status
         FROM payment_review_cases
         WHERE id = ?`,
      )
      .get(review.id).status,
    "open",
  );
});

test("prevents a prepared automatic credit from racing a manual review credit", async (t) => {
  const db = new PausableBatchD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-review-first', 'review-first@example.com',
               'Review First')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, provider_payment_id, amount_usd_micros,
        pay_currency, pay_amount, status)
       VALUES ('pay_review_first', 'usr-review-first', 'nowpayments',
               'np-review-first', 10000000, 'usdttrc20', '10', 'waiting')`,
    )
    .run();

  const ipnSecret = "review-first-ipn-secret";
  const adminSecret = "review-first-admin-secret-32-characters";
  const env = baseEnv({
    DB: db,
    NOWPAYMENTS_API_KEY: "provider-test-key",
    NOWPAYMENTS_IPN_SECRET: ipnSecret,
    PAYMENT_ADMIN_SECRET: adminSecret,
  });
  let providerRead = 0;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    providerRead += 1;
    const paymentStatus = providerRead === 2 ? "failed" : "finished";
    return Response.json({
      payment_id: "np-review-first",
      payment_status: paymentStatus,
      order_id: "pay_review_first",
      price_amount: 10,
      price_currency: "usd",
      pay_amount: "10",
      actually_paid: paymentStatus === "failed" ? "2" : "10",
      pay_currency: "usdttrc20",
    });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const sendWebhook = (paymentStatus, sequence) => {
    const payload = {
      payment_id: "np-review-first",
      payment_status: paymentStatus,
      order_id: "pay_review_first",
      sequence,
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
  };

  const gate = db.pauseNextBatch((statements) =>
    statements.some((statement) =>
      statement.sql.includes("SET status = 'finished'"),
    ),
  );
  t.after(() => gate.release());
  const preparedAutomaticCredit = sendWebhook("finished", 1);
  await gate.paused;

  assert.equal((await sendWebhook("failed", 2)).status, 200);
  const review = db.raw
    .prepare(
      `SELECT id, status
       FROM payment_review_cases
       WHERE provider_payment_id = 'np-review-first'`,
    )
    .get();
  assert.equal(review.status, "open");
  const resolve = await fetchWorker(
    "/api/admin/payment-reviews/resolve",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        caseId: review.id,
        action: "credit",
        creditUsdMicros: 10000000,
        note: "Credit the verified receipt exactly once.",
      }),
    },
    env,
  );
  assert.equal(resolve.status, 200);

  gate.release();
  assert.equal((await preparedAutomaticCredit).status, 200);
  const order = db.raw
    .prepare(
      `SELECT status, credited_usd_micros
       FROM payment_orders
       WHERE id = 'pay_review_first'`,
    )
    .get();
  assert.equal(order.status, "manual_resolved");
  assert.equal(order.credited_usd_micros, 10000000);
  assert.equal(
    db.raw
      .prepare(
        `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
         FROM balance_ledger
         WHERE user_id = 'usr-review-first'`,
      )
      .get().balance,
    10000000,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM balance_ledger
         WHERE reference_id = 'nowpayments:np-review-first:credit'`,
      )
      .get().count,
    0,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM balance_ledger
         WHERE reference_id = ?`,
      )
      .get(`nowpayments-review:${review.id}:credit`).count,
    1,
  );
});

test("reverses a resolved original review credit on mismatched refund metadata exactly once", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-refund-mismatch', 'refund-mismatch@example.com',
               'Refund Mismatch')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, provider_payment_id, amount_usd_micros,
        pay_currency, pay_amount, status, credited_usd_micros)
       VALUES ('pay_refund_mismatch', 'usr-refund-mismatch', 'nowpayments',
               'np-refund-mismatch', 10000000, 'usdttrc20', '10',
               'manual_resolved', 2000000)`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_review_cases
       (id, order_id, provider_payment_id, reason, status, evidence_json,
        resolution_action, resolution_credit_usd_micros,
        resolution_request_hash, resolution_note, resolution_reference,
        resolved_at)
       VALUES ('prv_refund_mismatch_case', 'pay_refund_mismatch',
               'np-refund-mismatch', 'provider_data_mismatch', 'resolved',
               '{}', 'credit', 2000000, 'resolved-refund-mismatch',
               'Manually verified mismatched provider metadata.',
               'nowpayments-review:prv_refund_mismatch_case:credit',
               CURRENT_TIMESTAMP)`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id)
       VALUES ('led-refund-mismatch', 'usr-refund-mismatch',
               'payment_review_credit', 2000000,
               'nowpayments-review:prv_refund_mismatch_case:credit')`,
    )
    .run();

  const ipnSecret = "refund-mismatch-ipn-secret";
  const env = baseEnv({
    DB: db,
    NOWPAYMENTS_API_KEY: "provider-test-key",
    NOWPAYMENTS_IPN_SECRET: ipnSecret,
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      payment_id: "np-refund-mismatch",
      payment_status: "refunded",
      order_id: "pay_refund_mismatch",
      price_amount: 999,
      price_currency: "eur",
      pay_amount: "not-a-number",
      actually_paid: "2",
      pay_currency: "btc",
    });
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const sendWebhook = (sequence) => {
    const payload = {
      payment_id: "np-refund-mismatch",
      payment_status: "refunded",
      order_id: "pay_refund_mismatch",
      sequence,
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
  };

  assert.equal((await sendWebhook(1)).status, 200);
  assert.equal((await sendWebhook(2)).status, 200);
  assert.equal(
    db.raw
      .prepare(
        `SELECT status, credited_usd_micros
         FROM payment_orders
         WHERE id = 'pay_refund_mismatch'`,
      )
      .get().status,
    "refunded",
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT credited_usd_micros
         FROM payment_orders
         WHERE id = 'pay_refund_mismatch'`,
      )
      .get().credited_usd_micros,
    0,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
         FROM balance_ledger
         WHERE user_id = 'usr-refund-mismatch'`,
      )
      .get().balance,
    0,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM balance_ledger
         WHERE reference_id =
           'nowpayments-review:prv_refund_mismatch_case:reversal'`,
      )
      .get().count,
    1,
  );
});

test("holds paid failures for review and safely recovers a verified orphan payment", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-manual', 'manual@example.com', 'Manual Review')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, amount_usd_micros, pay_currency,
        pay_amount, status)
       VALUES ('pay_manual', 'usr-manual', 'nowpayments', 10000000,
               'usdttrc20', '10', 'provider_error')`,
    )
    .run();

  const ipnSecret = "manual-ipn-secret";
  const paymentAdminSecret =
    "payment-admin-secret-32-characters-minimum";
  const env = baseEnv({
    DB: db,
    NOWPAYMENTS_API_KEY: "provider-test-key",
    NOWPAYMENTS_IPN_SECRET: ipnSecret,
    PAYMENT_ADMIN_SECRET: paymentAdminSecret,
  });
  let verifiedStatus = "failed";
  let actuallyPaid = "2";
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      payment_id: "np-manual",
      payment_status: verifiedStatus,
      order_id: "pay_manual",
      price_amount: 10,
      price_currency: "usd",
      pay_amount: "10",
      actually_paid: actuallyPaid,
      pay_currency: "usdttrc20",
      pay_address: "TManualReviewAddress123456789",
    });
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const webhookPayload = {
    payment_id: "np-manual",
    payment_status: "failed",
    order_id: "pay_manual",
  };
  const webhook = await fetchWorker(
    "/api/payments/nowpayments/ipn",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nowpayments-sig": nowPaymentsSignature(
          ipnSecret,
          webhookPayload,
        ),
      },
      body: JSON.stringify(webhookPayload),
    },
    env,
  );
  assert.equal(webhook.status, 200);
  const held = db.raw
    .prepare(
      `SELECT provider_payment_id, status, credited_usd_micros
       FROM payment_orders
       WHERE id = 'pay_manual'`,
    )
    .get();
  assert.equal(held.provider_payment_id, null);
  assert.equal(held.status, "manual_review");
  assert.equal(held.credited_usd_micros, 0);

  const recover = () =>
    fetchWorker(
      "/api/admin/payments/recover",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${paymentAdminSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          orderId: "pay_manual",
          paymentId: "np-manual",
        }),
      },
      env,
    );
  const blockedRecovery = await recover();
  assert.equal(blockedRecovery.status, 409);
  assert.equal(
    (await blockedRecovery.json()).error.code,
    "payment_review_required",
  );

  const reviewList = await fetchWorker(
    "/api/admin/payment-reviews?status=open",
    {
      headers: {
        authorization: `Bearer ${paymentAdminSecret}`,
      },
    },
    env,
  );
  assert.equal(reviewList.status, 200);
  const reviews = (await reviewList.json()).reviews;
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].reason, "terminal_with_funds");

  verifiedStatus = "finished";
  const resolveReview = () =>
    fetchWorker(
      "/api/admin/payment-reviews/resolve",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${paymentAdminSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          caseId: reviews[0].id,
          action: "credit",
          creditUsdMicros: 2000000,
          note: "Verified the partial receipt with the provider.",
        }),
      },
      env,
    );
  const resolved = await resolveReview();
  assert.equal(resolved.status, 200);
  assert.deepEqual(await resolved.json().then((value) => ({
    ok: value.ok,
    caseId: value.caseId,
    status: value.status,
    action: value.action,
  })), {
    ok: true,
    caseId: reviews[0].id,
    status: "resolved",
    action: "credit",
  });
  const resolutionReplay = await resolveReview();
  assert.equal(resolutionReplay.status, 200);

  verifiedStatus = "finished";
  actuallyPaid = "10";
  const recovered = await recover();
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).payment.status, "manual_resolved");

  const completed = db.raw
    .prepare(
      `SELECT provider_payment_id, status, credited_usd_micros
       FROM payment_orders
       WHERE id = 'pay_manual'`,
    )
    .get();
  assert.equal(completed.provider_payment_id, null);
  assert.equal(completed.status, "manual_resolved");
  assert.equal(completed.credited_usd_micros, 2000000);
  const credits = db.raw
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(delta_usd_micros), 0) AS balance
       FROM balance_ledger
       WHERE reference_id = ?`,
    )
    .get(`nowpayments-review:${reviews[0].id}:credit`);
  assert.equal(credits.count, 1);
  assert.equal(credits.balance, 2000000);
});

test("reviews repeated deposits with null order ids and reverses only the refunded child credit", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-repeat', 'repeat@example.com', 'Repeat Deposit')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, provider_payment_id, amount_usd_micros,
        pay_currency, pay_amount, status, credited_usd_micros)
       VALUES ('pay_repeat', 'usr-repeat', 'nowpayments', 'np-parent',
               10000000, 'usdttrc20', '10', 'finished', 10000000)`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id)
       VALUES ('led-parent', 'usr-repeat', 'payment_credit', 10000000,
               'nowpayments:np-parent:credit')`,
    )
    .run();

  const ipnSecret = "repeat-ipn-secret";
  const adminSecret = "repeat-payment-admin-secret-32-minimum";
  const reconcileSecret = "repeat-reconcile-secret-32-characters";
  const env = baseEnv({
    DB: db,
    NOWPAYMENTS_API_KEY: "provider-test-key",
    NOWPAYMENTS_IPN_SECRET: ipnSecret,
    PAYMENT_ADMIN_SECRET: adminSecret,
    RECONCILIATION_SECRET: reconcileSecret,
  });
  let providerStatus = "finished";
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const paymentId = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    ).pathname.split("/").at(-1);
    if (paymentId === "np-parent") {
      return Response.json({
        payment_id: "np-parent",
        payment_status: "finished",
        order_id: "pay_repeat",
        price_amount: 10,
        price_currency: "usd",
        pay_amount: "10",
        actually_paid: "10",
        pay_currency: "usdttrc20",
      });
    }
    return Response.json({
      payment_id: "np-child",
      parent_payment_id: "np-parent",
      payment_status: providerStatus,
      order_id: null,
      price_amount: 10,
      price_currency: "usd",
      pay_amount: "10",
      actually_paid: "10",
      pay_currency: "usdttrc20",
    });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const sendChildWebhook = async (paymentStatus) => {
    const payload = {
      payment_id: "np-child",
      parent_payment_id: "np-parent",
      payment_status: paymentStatus,
      order_id: null,
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
  };

  const childFinished = await sendChildWebhook("finished");
  assert.equal(childFinished.status, 200);
  const review = db.raw
    .prepare(
      `SELECT id, reason, status
       FROM payment_review_cases
       WHERE provider_payment_id = 'np-child'`,
    )
    .get();
  assert.equal(review.reason, "repeated_deposit");
  assert.equal(review.status, "open");
  assert.equal(
    db.raw
      .prepare(
        `SELECT status FROM payment_orders WHERE id = 'pay_repeat'`,
      )
      .get().status,
    "manual_review",
  );

  const resolve = await fetchWorker(
    "/api/admin/payment-reviews/resolve",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        caseId: review.id,
        action: "credit",
        creditUsdMicros: 10000000,
        note: "Provider confirms the repeated child deposit.",
      }),
    },
    env,
  );
  assert.equal(resolve.status, 200);
  assert.equal(
    db.raw
      .prepare(
        `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
         FROM balance_ledger
         WHERE user_id = 'usr-repeat'`,
      )
      .get().balance,
    20000000,
  );

  providerStatus = "refunded";
  const reconciliation = await fetchWorker(
    "/api/admin/reconcile",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${reconcileSecret}`,
      },
    },
    env,
  );
  assert.equal(reconciliation.status, 200);
  assert.equal(
    (await reconciliation.json()).payments.creditedPolled,
    2,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
         FROM balance_ledger
         WHERE user_id = 'usr-repeat'`,
      )
      .get().balance,
    10000000,
  );
  const reversedCase = db.raw
    .prepare(
      `SELECT resolution_action, resolution_reference
       FROM payment_review_cases
       WHERE id = ?`,
    )
    .get(review.id);
  assert.equal(reversedCase.resolution_action, "credited_then_refunded");
  assert.equal(
    reversedCase.resolution_reference,
    `nowpayments-review:${review.id}:reversal`,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM balance_ledger
         WHERE reference_id = ?`,
      )
      .get(`nowpayments-review:${review.id}:reversal`).count,
    1,
  );

  const refundReplay = await fetchWorker(
    "/api/admin/reconcile",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${reconcileSecret}`,
      },
    },
    env,
  );
  assert.equal(refundReplay.status, 200);
  assert.equal((await refundReplay.json()).payments.creditedPolled, 0);
  assert.equal(
    db.raw
      .prepare(
        `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
         FROM balance_ledger
         WHERE user_id = 'usr-repeat'`,
      )
      .get().balance,
    10000000,
  );
});

test("serializes catalog sync and refuses to re-enable removed endpoints", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO catalog_sync_locks (id, generation, locked_at)
       VALUES (1, 'sync-active', CURRENT_TIMESTAMP)`,
    )
    .run();

  const catalogSecret = "catalog-secret-32-characters-minimum";
  const env = baseEnv({
    DB: db,
    TIKHUB_API_KEY: "upstream-key",
    CATALOG_SYNC_SECRET: catalogSecret,
  });
  const nativeFetch = globalThis.fetch;
  let upstreamReads = 0;
  globalThis.fetch = async (input) => {
    upstreamReads += 1;
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.pathname === "/openapi.json") {
      return Response.json({
        openapi: "3.1.0",
        paths: {
          "/api/v1/youtube/web/fetch_video": {
            get: {
              summary: "Fetch a YouTube video",
              parameters: [],
            },
          },
        },
      });
    }
    assert.equal(
      url.href,
      "https://api.tikhub.io/api/v1/tikhub/user/get_all_endpoints_info",
    );
    return Response.json({
      data: [
        {
          path: "/v1/youtube/web/fetch_video",
          price: 0.001,
        },
      ],
    });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const sync = () =>
    fetchWorker(
      "/api/admin/catalog/sync",
      {
        method: "POST",
        headers: { authorization: `Bearer ${catalogSecret}` },
      },
      env,
    );
  const concurrent = await sync();
  assert.equal(concurrent.status, 409);
  assert.equal(
    (await concurrent.json()).error.code,
    "catalog_sync_in_progress",
  );

  db.raw
    .prepare(
      `UPDATE catalog_sync_locks
       SET locked_at = datetime('now', '-20 minutes')
       WHERE id = 1`,
    )
    .run();
  const completed = await sync();
  assert.equal(completed.status, 200);
  assert.equal((await completed.json()).synced, 1);
  assert.equal(upstreamReads, 4);
  assert.equal(
    db.raw
      .prepare("SELECT COUNT(*) AS count FROM catalog_sync_locks")
      .get().count,
    0,
  );

  const removed = db.raw
    .prepare(
      `SELECT enabled, source_updated_at, sync_generation
       FROM endpoint_catalog
       WHERE path = '/v1/tiktok/web/fetch_user_profile'`,
    )
    .get();
  assert.equal(removed.enabled, 0);
  assert.equal(removed.source_updated_at, null);
  assert.equal(removed.sync_generation, null);

  const staleEnable = await fetchWorker(
    "/api/admin/catalog",
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${catalogSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        path: "/v1/tiktok/web/fetch_user_profile",
        enabled: true,
        readOnly: true,
        customerPriceUsdMicros: 2000,
      }),
    },
    env,
  );
  assert.equal(staleEnable.status, 409);
  assert.equal(
    (await staleEnable.json()).error.code,
    "endpoint_not_in_latest_catalog",
  );

  const enableCurrent = await fetchWorker(
    "/api/admin/catalog",
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${catalogSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        path: "/v1/youtube/web/fetch_video",
        enabled: true,
        readOnly: true,
        customerPriceUsdMicros: 2000,
      }),
    },
    env,
  );
  assert.equal(enableCurrent.status, 200);

  const publicCatalog = await fetchWorker(
    "/api/catalog?limit=1&offset=0",
    {},
    env,
  );
  assert.equal(publicCatalog.status, 200);
  const publicData = await publicCatalog.json();
  assert.equal(publicData.count, 1);
  assert.equal(publicData.total, 1);
  assert.equal(publicData.offset, 0);
  assert.equal(publicData.nextOffset, null);
  assert.equal(
    publicData.endpoints[0].path,
    "/v1/youtube/web/fetch_video",
  );
});

test("keeps the last successful catalog live when a staged sync batch fails", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  enableCatalogEndpoint(db);
  const previousGeneration = db.raw
    .prepare(
      `SELECT last_success_generation
       FROM catalog_sync_state
       WHERE id = 1`,
    )
    .get().last_success_generation;

  const paths = Array.from(
    { length: 60 },
    (_, index) => `/v1/youtube/web/fetch_video_${index}`,
  );
  const openApiPaths = Object.fromEntries(
    paths.map((path) => [
      `/api${path}`,
      {
        get: {
          summary: `Fetch video ${path.split("_").at(-1)}`,
          parameters: [],
        },
      },
    ]),
  );
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    return url.pathname === "/openapi.json"
      ? Response.json({ openapi: "3.1.0", paths: openApiPaths })
      : Response.json({
          data: paths.map((path) => ({ path, price: 0.001 })),
        });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const originalBatch = db.batch.bind(db);
  let stagingBatches = 0;
  db.batch = (statements) => {
    if (
      statements.some((statement) =>
        statement.sql.includes("INSERT INTO catalog_sync_staging"),
      )
    ) {
      stagingBatches += 1;
      if (stagingBatches === 2) {
        throw new Error("simulated staging write failure");
      }
    }
    return originalBatch(statements);
  };

  const env = baseEnv({
    DB: db,
    TIKHUB_API_KEY: "upstream-key",
    CATALOG_SYNC_SECRET: "catalog-secret-32-characters-minimum",
  });
  const sync = await fetchWorker(
    "/api/admin/catalog/sync",
    {
      method: "POST",
      headers: {
        authorization:
          "Bearer catalog-secret-32-characters-minimum",
      },
    },
    env,
  );
  assert.equal(sync.status, 500);
  assert.equal(stagingBatches, 2);
  assert.equal(
    db.raw
      .prepare(
        `SELECT last_success_generation
         FROM catalog_sync_state
         WHERE id = 1`,
      )
      .get().last_success_generation,
    previousGeneration,
  );
  const stillLive = await fetchWorker("/api/catalog", {}, env);
  assert.equal(stillLive.status, 200);
  const liveData = await stillLive.json();
  assert.equal(liveData.total, 1);
  assert.equal(
    liveData.endpoints[0].path,
    "/v1/tiktok/web/fetch_user_profile",
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM catalog_sync_staging`,
      )
      .get().count,
    0,
  );
});

test("publishes reviewed catalog prices and creates idempotent recoverable payments", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  enableCatalogEndpoint(
    db,
    "/v1/tiktok/web/fetch_user_profile",
    2500,
  );

  const env = baseEnv({
    DB: db,
    LEGAL_REVIEW_CONFIRMED: "true",
    RESELLER_AUTHORIZED: "true",
    TIKHUB_API_KEY: "upstream-key",
    CRYPTO_PAYMENTS_ENABLED: "true",
    PAYMENT_PROVIDER: "nowpayments",
    NOWPAYMENTS_API_KEY: "provider-key",
    NOWPAYMENTS_IPN_SECRET: "ipn-secret",
    CATALOG_SYNC_SECRET: "operator-secret-32-characters-minimum",
    RECONCILIATION_SECRET: "reconcile-secret-32-characters-minimum",
    PAYMENT_ADMIN_SECRET: "payment-admin-secret-32-characters-minimum",
  });

  const health = await fetchWorker("/api/readiness", {}, env);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).mode, "live");

  const catalog = await fetchWorker("/api/catalog?platform=tiktok", {}, env);
  assert.equal(catalog.status, 200);
  const catalogData = await catalog.json();
  assert.equal(catalogData.count, 1);
  assert.deepEqual(catalogData.endpoints[0], {
    path: "/v1/tiktok/web/fetch_user_profile",
    platform: "tiktok",
    method: "GET",
    summary: null,
    priceUsdMicros: 2500,
    updatedAt: catalogData.endpoints[0].updatedAt,
  });

  const nativeFetch = globalThis.fetch;
  let providerCreates = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    assert.equal(url.href, "https://api.nowpayments.io/v1/payment");
    providerCreates += 1;
    const body = JSON.parse(init.body);
    return Response.json({
      payment_id: "np-created-1",
      payment_status: "waiting",
      pay_address: "TRelayBasePaymentAddress123456789",
      price_amount: 25,
      price_currency: "usd",
      pay_amount: "24.95",
      pay_currency: "usdttrc20",
      order_id: body.order_id,
      invoice_url: "https://nowpayments.io/payment/?iid=np-created-1",
    });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const paymentInit = {
    method: "POST",
    headers: signedInHeaders({
      "idempotency-key": "checkout-20260723-001",
    }),
    body: JSON.stringify({ amountUsd: 25, payCurrency: "usdttrc20" }),
  };
  const created = await fetchWorker("/api/payments", paymentInit, env);
  assert.equal(created.status, 201);
  const createdPayment = (await created.json()).payment;
  assert.equal(createdPayment.payAddress, "TRelayBasePaymentAddress123456789");

  const replay = await fetchWorker("/api/payments", paymentInit, env);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).payment.id, createdPayment.id);
  assert.equal(providerCreates, 1);

  const mismatchedReplay = await fetchWorker(
    "/api/payments",
    {
      ...paymentInit,
      body: JSON.stringify({ amountUsd: 50, payCurrency: "usdttrc20" }),
    },
    env,
  );
  assert.equal(mismatchedReplay.status, 409);
  assert.equal(
    (await mismatchedReplay.json()).error.code,
    "idempotency_payload_conflict",
  );
  assert.equal(providerCreates, 1);

  const dashboard = await fetchWorker(
    "/api/dashboard",
    { headers: signedInHeaders() },
    env,
  );
  const dashboardData = await dashboard.json();
  assert.equal(dashboardData.payments[0].payAddress, createdPayment.payAddress);
  assert.match(dashboardData.payments[0].invoiceUrl, /^https:\/\/nowpayments\.io\//);
});

test("reconciles missed payment callbacks without double credit", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-reconcile', 'reconcile@example.com', 'Reconcile')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, provider_payment_id, idempotency_hash,
        amount_usd_micros, pay_currency, pay_amount, pay_address,
        status, created_at, updated_at)
       VALUES ('pay_reconcile', 'usr-reconcile', 'nowpayments', 'np-reconcile',
               'idem-reconcile', 10000000, 'usdttrc20', '10',
               'TReconcileAddress123456789', 'confirming',
               datetime('now', '-3 minutes'), datetime('now', '-2 minutes'))`,
    )
    .run();

  const env = baseEnv({
    DB: db,
    NOWPAYMENTS_API_KEY: "provider-key",
    RECONCILIATION_SECRET: "reconcile-secret-32-characters-minimum",
  });
  const nativeFetch = globalThis.fetch;
  let providerReads = 0;
  globalThis.fetch = async () => {
    providerReads += 1;
    return Response.json({
      payment_id: "np-reconcile",
      payment_status: "finished",
      order_id: "pay_reconcile",
      price_amount: 10,
      price_currency: "usd",
      pay_amount: "10",
      actually_paid: "10",
      pay_currency: "usdttrc20",
      pay_address: "TReconcileAddress123456789",
    });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const reconcile = () =>
    fetchWorker(
      "/api/admin/reconcile",
      {
        method: "POST",
        headers: {
          authorization: "Bearer reconcile-secret-32-characters-minimum",
        },
      },
      env,
    );
  const first = await reconcile();
  assert.equal(first.status, 200);
  assert.equal((await first.json()).payments.polled, 1);
  const second = await reconcile();
  assert.equal(second.status, 200);
  assert.equal(providerReads, 1);

  const balance = db.raw
    .prepare(
      `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
       FROM balance_ledger
       WHERE user_id = 'usr-reconcile'`,
    )
    .get();
  assert.equal(balance.balance, 10000000);
  const credits = db.raw
    .prepare(
      `SELECT COUNT(*) AS count
       FROM balance_ledger
       WHERE reference_id = 'nowpayments:np-reconcile:credit'`,
    )
    .get();
  assert.equal(credits.count, 1);
});
