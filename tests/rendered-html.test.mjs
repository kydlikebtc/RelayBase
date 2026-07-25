import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";

const root = new URL("../", import.meta.url);
const packageMetadata = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const TEST_UPSTREAM_ORIGIN = "https://source.example";
const TEST_UPSTREAM_SOURCE_CONFIG = Object.freeze({
  enabled: true,
  sourceOrigin: TEST_UPSTREAM_ORIGIN,
  apiPathPrefix: "/api",
  openApiPath: "/openapi.json",
  catalogPath: "/api/v1/control/catalog",
  credentialPath: "/api/v1/control/credential",
  catalogAuthMode: "optional",
  publicExcludedPrefixes: ["/v1/control/"],
});
const TEST_UPSTREAM_SOURCE_CONFIG_HASH = createHash("sha256")
  .update(JSON.stringify(TEST_UPSTREAM_SOURCE_CONFIG))
  .digest("hex");

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
    UPSTREAM_ALLOWED_ORIGINS: TEST_UPSTREAM_ORIGIN,
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
  "drizzle/0009_conscious_unicorn.sql",
  "drizzle/0010_solid_wasp.sql",
  "drizzle/0011_eminent_molten_man.sql",
  "drizzle/0012_mute_wasp.sql",
  "drizzle/0013_overrated_thunderball.sql",
  "drizzle/0014_reflective_firestar.sql",
];

async function migrate(db, names = migrationFiles) {
  for (const name of names) {
    const sql = await readFile(new URL(name, root), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) db.raw.exec(statement);
    }
  }
  if (names === migrationFiles) configureUpstreamSource(db);
}

function configureUpstreamSource(db) {
  db.raw
    .prepare(
      `INSERT INTO upstream_source_config
       (id, enabled, version, config_hash, source_origin,
        api_path_prefix, openapi_path, catalog_path, credential_path,
        catalog_auth_mode, public_excluded_prefixes_json, updated_at)
       VALUES (1, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         enabled = excluded.enabled,
         version = excluded.version,
         config_hash = excluded.config_hash,
         source_origin = excluded.source_origin,
         api_path_prefix = excluded.api_path_prefix,
         openapi_path = excluded.openapi_path,
         catalog_path = excluded.catalog_path,
         credential_path = excluded.credential_path,
         catalog_auth_mode = excluded.catalog_auth_mode,
         public_excluded_prefixes_json =
           excluded.public_excluded_prefixes_json,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .run(
      TEST_UPSTREAM_SOURCE_CONFIG_HASH,
      TEST_UPSTREAM_SOURCE_CONFIG.sourceOrigin,
      TEST_UPSTREAM_SOURCE_CONFIG.apiPathPrefix,
      TEST_UPSTREAM_SOURCE_CONFIG.openApiPath,
      TEST_UPSTREAM_SOURCE_CONFIG.catalogPath,
      TEST_UPSTREAM_SOURCE_CONFIG.credentialPath,
      TEST_UPSTREAM_SOURCE_CONFIG.catalogAuthMode,
      JSON.stringify(
        TEST_UPSTREAM_SOURCE_CONFIG.publicExcludedPrefixes,
      ),
    );
}

const TEST_CATALOG_GENERATION = "sync_test_complete_0001";

function enableCatalogEndpoint(
  db,
  path = "/v1/tiktok/web/fetch_user_profile",
  customerPriceUsdMicros = 2000,
  upstreamApiKey = "upstream-key",
) {
  configureUpstreamSource(db);
  const generation = TEST_CATALOG_GENERATION;
  const surface = path.split("/").includes("web") ? "web" : "other";
  const dataType = path.includes("profile") ? "profile_creator" : "other";
  const tags =
    path === "/v1/tiktok/web/fetch_user_profile"
      ? ["TikTok-Web-API"]
      : [dataType, surface].sort();
  const operationId =
    path === "/v1/tiktok/web/fetch_user_profile"
      ? "fetch_user_profile_api_v1_tiktok_web_fetch_user_profile_get"
      : `relaybase_${path
          .split("/")
          .filter(Boolean)
          .join("_")}`;
  const credentialFingerprint = createHash("sha256")
    .update(upstreamApiKey)
    .digest("hex")
    .slice(0, 16);
  const credentialStateVersion = Number(
    db.raw
      .prepare(
        `SELECT version
         FROM upstream_credential_state
         WHERE provider = 'primary'`,
      )
      .get()?.version ?? 0,
  );
  db.raw
    .prepare(
      `INSERT INTO catalog_sync_state
       (id, last_success_generation, credential_source, credential_id,
        credential_fingerprint, credential_state_version,
        source_config_version, source_config_hash,
        openapi_operation_count, raw_price_row_count,
        normalized_price_count, openapi_price_mapped_count,
        price_only_count, openapi_only_count, scope_excluded_count,
        matched_price_count,
        positive_price_count, zero_price_count, awaiting_price_count,
        openapi_snapshot_hash, price_snapshot_hash, synced_at)
       VALUES (1, ?, 'environment', NULL, ?, ?, 1, ?,
               1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, ?, ?,
               CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         last_success_generation = excluded.last_success_generation,
         credential_source = excluded.credential_source,
         credential_id = excluded.credential_id,
         credential_fingerprint = excluded.credential_fingerprint,
         credential_state_version = excluded.credential_state_version,
         source_config_version = excluded.source_config_version,
         source_config_hash = excluded.source_config_hash,
         openapi_operation_count = excluded.openapi_operation_count,
         raw_price_row_count = excluded.raw_price_row_count,
         normalized_price_count = excluded.normalized_price_count,
         openapi_price_mapped_count =
           excluded.openapi_price_mapped_count,
         price_only_count = excluded.price_only_count,
         openapi_only_count = excluded.openapi_only_count,
         scope_excluded_count = excluded.scope_excluded_count,
         matched_price_count = excluded.matched_price_count,
         positive_price_count = excluded.positive_price_count,
         zero_price_count = excluded.zero_price_count,
         awaiting_price_count = excluded.awaiting_price_count,
         openapi_snapshot_hash = excluded.openapi_snapshot_hash,
         price_snapshot_hash = excluded.price_snapshot_hash,
         synced_at = CURRENT_TIMESTAMP`,
    )
    .run(
      generation,
      credentialFingerprint,
      credentialStateVersion,
      TEST_UPSTREAM_SOURCE_CONFIG_HASH,
      "a".repeat(64),
      "b".repeat(64),
    );
  db.raw
    .prepare(
      `UPDATE endpoint_catalog
       SET enabled = 1, read_only = 1,
           customer_price_usd_micros = ?,
           price_verified = 1, http_method = 'GET',
           safety_classification = 'safe_data_read',
           safety_reasons_json = '["test_fixture"]',
           safety_policy_version = 1,
           data_type = ?, tags_json = ?, surface = ?, operation_id = ?,
           sync_generation = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE path = ?`,
    )
    .run(
      customerPriceUsdMicros,
      dataType,
      JSON.stringify(tags),
      surface,
      operationId,
      generation,
      path,
    );
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
    ["/", "The multi-platform"],
    ["/docs", "Build your first request"],
    ["/catalog", "Multi-platform data market"],
    ["/pricing", "Pay only for real requests"],
    ["/login", "Enter your"],
  ]) {
    const response = await fetchWorker(path, {
      headers: { accept: "text/html" },
    });
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(
      response.headers.get("content-security-policy"),
      "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
    );
    assert.equal(
      response.headers.get("referrer-policy"),
      "strict-origin-when-cross-origin",
    );
    const html = await response.text();
    assert.match(html, /RelayBase/);
    assert.match(html, new RegExp(expected));
    assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
    assert.doesNotMatch(html, /react-loading-skeleton/i);
    assert.doesNotMatch(html, /安全沙盒/i);
  }
});

test("renders the Chinese public experience when the locale cookie is set", async () => {
  for (const [path, expected] of [
    ["/", "面向 AI 与应用的"],
    ["/docs", "把第一条请求跑起来"],
    ["/catalog", "多平台数据市场"],
    ["/pricing", "只为真实请求付费"],
    ["/login", "进入你的"],
  ]) {
    const response = await fetchWorker(path, {
      headers: {
        accept: "text/html",
        cookie: "relaybase_locale=zh",
      },
    });
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, new RegExp(expected));
    assert.doesNotMatch(html, /安全沙盒/i);
  }
});

test("redirects signed-out console visits before rendering private UI", async () => {
  for (const [path, returnTo] of [
    ["/console", "/console"],
    ["/console?_rsc=internal-navigation", "/console"],
    ["/console/keys", "/console/keys"],
    ["/console/billing", "/console/billing"],
  ]) {
    const response = await fetchWorker(path, {
      headers: { accept: "text/html" },
      redirect: "manual",
    });
    assert.equal(response.status, 307, path);
    assert.equal(
      response.headers.get("location"),
      `http://localhost/login?return_to=${encodeURIComponent(returnTo)}`,
    );
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(await response.text(), "");
  }
});

test("renders the console only after server-side authentication", async () => {
  const db = new TestD1();
  await migrate(db);
  const env = baseEnv({ DB: db });

  try {
    const staleSession = await fetchWorker(
      "/console",
      {
        headers: {
          accept: "text/html",
          cookie: `rb_session=${"x".repeat(32)}`,
        },
        redirect: "manual",
      },
      env,
    );
    assert.equal(staleSession.status, 307);
    assert.equal(
      staleSession.headers.get("location"),
      "http://localhost/login?return_to=%2Fconsole",
    );

    for (const [headers, expected] of [
      [
        signedInHeaders({ accept: "text/html" }),
        "Console",
      ],
      [
        signedInHeaders({
          accept: "text/html",
          cookie: "relaybase_locale=zh",
        }),
        "控制台",
      ],
    ]) {
      const response = await fetchWorker("/console", { headers }, env);
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get("content-type") ?? "",
        /^text\/html\b/i,
      );
      assert.match(await response.text(), new RegExp(expected));
    }

    for (const [path, expected] of [
      ["/console/keys", "API Keys"],
      ["/console/billing", "Top-up &amp; billing"],
    ]) {
      const response = await fetchWorker(path, {
        headers: signedInHeaders({ accept: "text/html" }),
      }, env);
      assert.equal(response.status, 200, path);
      assert.match(
        response.headers.get("content-type") ?? "",
        /^text\/html\b/i,
      );
      assert.match(await response.text(), new RegExp(expected));
    }
  } finally {
    db.close();
  }
});

test("returns an empty provider-neutral marketplace before runtime sync", async () => {
  const marketplace = await fetchWorker("/api/marketplace?limit=20&offset=0");
  assert.equal(marketplace.status, 200);
  assert.equal(marketplace.headers.get("cache-control"), "no-store");
  const data = await marketplace.json();
  assert.deepEqual(data.catalog, {
    revision: "cat_pending",
    updatedAt: null,
    complete: false,
    serviceCount: 0,
  });
  assert.equal(data.stats.total, 0);
  assert.equal(data.stats.available, 0);
  assert.equal(data.stats.pending, 0);
  assert.equal(data.stats.restricted, 0);
  assert.deepEqual(data.endpoints, []);
  assert.equal(data.total, 0);
  assert.equal(data.nextOffset, null);

  const detail = await fetchWorker(
    "/api/marketplace/detail?path=%2Fv1%2Fexample%2Fprofile%2Fread&method=GET",
  );
  assert.equal(detail.status, 404);

  const duplicateFilter = await fetchWorker(
    "/api/marketplace?method=GET&method=POST",
  );
  assert.equal(duplicateFilter.status, 400);
  assert.equal(
    (await duplicateFilter.json()).error.code,
    "invalid_marketplace_filter",
  );
});

test("publishes only the runtime catalog with provider-neutral public metadata", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  enableCatalogEndpoint(db);
  const env = baseEnv({
    DB: db,
    UPSTREAM_API_KEY: "upstream-key",
    RESELLER_AUTHORIZED: "true",
    LEGAL_REVIEW_CONFIRMED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
    RECONCILIATION_SECRET: "marketplace-reconcile-secret-32-characters",
  });

  const marketplace = await fetchWorker("/api/marketplace", {}, env);
  assert.equal(marketplace.status, 200);
  const marketplaceData = await marketplace.json();
  assert.equal(marketplaceData.catalog.revision, TEST_CATALOG_GENERATION);
  assert.equal(marketplaceData.catalog.complete, true);
  assert.equal(marketplaceData.catalog.serviceCount, 1);
  assert.ok(Date.parse(marketplaceData.catalog.updatedAt));
  assert.equal(marketplaceData.total, 1);
  assert.equal(marketplaceData.stats.available, 1);
  assert.equal(marketplaceData.endpoints[0].documentationStatus, "complete");
  assert.equal(
    marketplaceData.endpoints[0].pricing.amountUsdMicros,
    2000,
  );
  assert.doesNotMatch(
    JSON.stringify(marketplaceData),
    /source\.example|\/api\/v1\/control\//i,
  );

  const detail = await fetchWorker(
    "/api/marketplace/detail?path=%2Fv1%2Ftiktok%2Fweb%2Ffetch_user_profile&method=GET",
    {},
    env,
  );
  assert.equal(detail.status, 200);
  const available = await detail.json();
  assert.equal(available.endpoint.availability, "available");
  assert.equal(available.endpoint.pricing.amountUsdMicros, 2000);
  assert.deepEqual(available.endpoint.categories, [
    "profile_creator",
    "web",
  ]);
  assert.equal(available.endpoint.documentationStatus, "complete");
  assert.deepEqual(available.endpoint.input.parameters, []);
  assert.equal(available.endpoint.input.requestBody, null);
  assert.equal(available.endpoint.response.mode, "relaybase_envelope");
  assert.match(available.endpoint.summary, /Fetch User Profile/);
  assert.match(available.endpoint.description, /RelayBase/);
  assert.doesNotMatch(
    JSON.stringify(available),
    /source\.example|\/api\/v1\/control\//i,
  );
  assert.match(
    available.examples.curl,
    /X-RelayBase-Max-Cost-Usd-Micros: 2000/,
  );

  db.raw
    .prepare(
      `UPDATE catalog_sync_state
       SET openapi_operation_count = 2, openapi_only_count = 1,
           awaiting_price_count = 1
       WHERE id = 1`,
    )
    .run();
  const inconsistent = await fetchWorker(
    "/api/marketplace/detail?path=%2Fv1%2Ftiktok%2Fweb%2Ffetch_user_profile&method=GET",
    {},
    { ...env },
  );
  assert.equal(inconsistent.status, 200);
  assert.equal((await inconsistent.json()).endpoint.availability, "pending");
});

test("reports sandbox health and blocks live operations by default", async () => {
  const health = await fetchWorker("/api/health");
  assert.equal(health.status, 200);
  const healthData = await health.json();
  assert.equal(healthData.mode, "sandbox");
  assert.equal(healthData.version, packageMetadata.version);
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

test("requires exact Synthetic Provider crypto-payment clearance before proxy or checkout", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({
    DB: db,
    LEGAL_REVIEW_CONFIRMED: "true",
    RESELLER_AUTHORIZED: "true",
    UPSTREAM_API_KEY: "upstream-key",
    CRYPTO_PAYMENTS_ENABLED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "TRUE",
    PAYMENT_PROVIDER: "nowpayments",
    NOWPAYMENTS_API_KEY: "provider-key",
    NOWPAYMENTS_IPN_SECRET: "ipn-secret",
    CATALOG_SYNC_SECRET: "catalog-secret-32-characters-minimum",
    RECONCILIATION_SECRET:
      "reconciliation-secret-32-characters-minimum",
    PAYMENT_ADMIN_SECRET:
      "payment-admin-secret-32-characters-minimum",
  });
  const health = await fetchWorker("/api/health", {}, env);
  assert.equal(health.status, 200);
  const healthData = await health.json();
  assert.equal(
    healthData.capabilities.commercialClearanceConfirmed,
    false,
  );
  assert.equal(healthData.capabilities.proxyEnabled, false);
  assert.equal(healthData.capabilities.paymentsEnabled, false);
  assert.ok(
    healthData.missing.includes("commercial_clearance"),
  );
  const readiness = await fetchWorker("/api/readiness", {}, env);
  assert.equal(readiness.status, 503);
  const readinessData = await readiness.json();
  assert.equal(readinessData.ok, false);
  assert.notEqual(readinessData.mode, "live");
  assert.equal(
    readinessData.capabilities.commercialClearanceConfirmed,
    false,
  );

  const nativeFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls += 1;
    throw new Error("uncleared deployment must not call an upstream");
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const proxy = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile?uniqueId=uncleared",
    {
      headers: {
        authorization: "Bearer rb_live_not-used",
        "idempotency-key": "uncleared-proxy-request",
      },
    },
    env,
  );
  assert.equal(proxy.status, 503);
  assert.equal(
    (await proxy.json()).error.code,
    "commercial_clearance_required",
  );

  const payment = await fetchWorker(
    "/api/payments",
    {
      method: "POST",
      headers: signedInHeaders({
        "idempotency-key": "uncleared-payment-request",
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
    "commercial_clearance_required",
  );
  assert.equal(externalCalls, 0);
  assert.equal(
    db.raw.prepare("SELECT COUNT(*) AS count FROM payment_orders").get()
      .count,
    0,
  );
  assert.equal(
    db.raw.prepare("SELECT COUNT(*) AS count FROM balance_ledger").get()
      .count,
    0,
  );

  const clearedHealth = await fetchWorker(
    "/api/health",
    {},
    {
      ...env,
      UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
    },
  );
  const clearedHealthData = await clearedHealth.json();
  assert.equal(
    clearedHealthData.capabilities.commercialClearanceConfirmed,
    true,
  );
  assert.ok(
    !clearedHealthData.missing.includes(
      "commercial_clearance",
    ),
  );
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
    UPSTREAM_API_KEY: "upstream-key",
    CRYPTO_PAYMENTS_ENABLED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
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

  await migrate(db, migrationFiles.slice(7, 13));
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
  const credentialState = db.raw
    .prepare(
      `SELECT managed_enabled, active_credential_id, version
       FROM upstream_credential_state
       WHERE provider = 'primary'`,
    )
    .get();
  assert.equal(credentialState.managed_enabled, 0);
  assert.equal(credentialState.active_credential_id, null);
  assert.equal(credentialState.version, 0);
  assert.ok(
    db.raw
      .prepare(
        `SELECT 1 AS present
         FROM pragma_table_info('catalog_sync_state')
         WHERE name = 'credential_fingerprint'`,
      )
      .get()?.present,
  );
  assert.equal(
    db.raw.prepare("PRAGMA foreign_key_check").all().length,
    0,
  );
});

test("adds catalog coverage evidence without changing the previous live generation", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db, migrationFiles.slice(0, 11));
  const upstreamKey = "upstream-key";
  const credentialFingerprint = createHash("sha256")
    .update(upstreamKey)
    .digest("hex")
    .slice(0, 16);
  db.raw
    .prepare(
      `INSERT INTO catalog_sync_state
       (id, last_success_generation, credential_source, credential_id,
        credential_fingerprint, credential_state_version, synced_at)
       VALUES (1, 'sync-before-coverage', 'environment', NULL,
               ?, 0, '2026-07-23 10:00:00')`,
    )
    .run(credentialFingerprint);

  await migrate(db, migrationFiles.slice(11, 13));
  const state = db.raw
    .prepare(
      `SELECT last_success_generation, credential_fingerprint,
              openapi_operation_count, raw_price_row_count,
              price_only_count, openapi_snapshot_hash
       FROM catalog_sync_state
       WHERE id = 1`,
    )
    .get();
  assert.deepEqual({ ...state }, {
    last_success_generation: "sync-before-coverage",
    credential_fingerprint: credentialFingerprint,
    openapi_operation_count: null,
    raw_price_row_count: null,
    price_only_count: null,
    openapi_snapshot_hash: null,
  });
  assert.equal(
    db.raw.prepare("PRAGMA foreign_key_check").all().length,
    0,
  );
  const migratedEndpoint = db.raw
    .prepare(
      `SELECT enabled, read_only, safety_classification,
              safety_reasons_json, safety_policy_version, revision
       FROM endpoint_catalog
       WHERE path = '/v1/tiktok/web/fetch_user_profile'`,
    )
    .get();
  assert.deepEqual({ ...migratedEndpoint }, {
    enabled: 0,
    read_only: 0,
    safety_classification: "ambiguous",
    safety_reasons_json: '["migration_requires_resync"]',
    safety_policy_version: 1,
    revision: 0,
  });

  db.raw
    .prepare(
      `UPDATE endpoint_catalog
       SET enabled = 1, read_only = 1, price_verified = 1,
           http_method = 'GET',
           safety_classification = 'safe_data_read',
           safety_policy_version = 1,
           sync_generation = 'sync-before-coverage',
           reviewed_at = CURRENT_TIMESTAMP
       WHERE path = '/v1/tiktok/web/fetch_user_profile'`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO operation_heartbeats
       (name, last_success_at, details_json)
       VALUES ('reconciliation', CURRENT_TIMESTAMP, '{}')`,
    )
    .run();
  const env = baseEnv({
    DB: db,
    UPSTREAM_API_KEY: upstreamKey,
    RESELLER_AUTHORIZED: "true",
    LEGAL_REVIEW_CONFIRMED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
    RECONCILIATION_SECRET: "coverage-reconcile-secret-32-minimum",
  });
  const health = await fetchWorker("/api/health", {}, env);
  assert.equal(health.status, 200);
  const healthData = await health.json();
  assert.equal(healthData.capabilities.schemaReady, false);
  assert.equal(healthData.capabilities.taxonomyReady, false);
  assert.equal(healthData.capabilities.catalogReady, false);
  assert.ok(healthData.missing.includes("database_migrations"));
  assert.ok(healthData.missing.includes("enabled_catalog"));

  const proxy = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile",
    {},
    env,
  );
  assert.equal(proxy.status, 503);
  assert.equal((await proxy.json()).error.code, "service_not_ready");
});

test("upgrades the populated catalog to persisted taxonomy and requires a fresh review", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db, migrationFiles.slice(0, 13));

  db.raw
    .prepare(
      `UPDATE endpoint_catalog
       SET enabled = 1, read_only = 1, price_verified = 1,
           safety_classification = 'safe_data_read',
           safety_reasons_json = '["pre_taxonomy_review"]',
           revision = 7, sync_generation = 'sync-before-taxonomy',
           reviewed_at = '2026-07-24 08:00:00'
       WHERE path = '/v1/tiktok/web/fetch_user_profile'`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO endpoint_catalog
       (path, platform, http_method,
        upstream_price_usd_micros, customer_price_usd_micros,
        price_verified, enabled, read_only, safety_classification,
        safety_reasons_json, safety_policy_version, revision,
        sync_generation, reviewed_at)
       VALUES ('/v1/youtube/web/fetch_video_detail', 'youtube', 'GET',
               1000, 2000, 1, 1, 1, 'safe_data_read',
               '["pre_taxonomy_review"]', 1, 3,
               'sync-before-taxonomy', '2026-07-24 08:00:00')`,
    )
    .run();
  const stagingInsert = db.raw.prepare(
    `INSERT INTO catalog_sync_staging
     (id, generation, path, platform, http_method,
      upstream_price_usd_micros, suggested_customer_price_usd_micros,
      price_verified, looks_read_only)
     VALUES (?, 'sync-incomplete-taxonomy',
             '/v1/tiktok/web/fetch_user_profile', 'tiktok', 'GET',
             1000, 2000, 1, 1)`,
  );
  stagingInsert.run("staging-taxonomy-1");
  stagingInsert.run("staging-taxonomy-2");
  db.raw
    .prepare(
      `INSERT INTO catalog_sync_locks (id, generation)
       VALUES (1, 'sync-incomplete-taxonomy')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO catalog_sync_state
       (id, last_success_generation, synced_at)
       VALUES (1, 'sync-before-taxonomy', '2026-07-24 08:00:00')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO catalog_batch_plans
       (id, actor_fingerprint, preview_idempotency_hash,
        preview_request_hash, policy_version, action, status, version,
        filter_status, filter_safety, selector_json, mutation_json,
        catalog_generation, openapi_snapshot_hash, price_snapshot_hash,
        matched_count, selected_count, excluded_stale_count,
        excluded_unverified_count, excluded_unsafe_count,
        no_change_count, price_increase_count, price_decrease_count,
        price_unchanged_count, blocked_count,
        upstream_total_usd_micros, before_customer_total_usd_micros,
        after_customer_total_usd_micros, target_digest, before_digest,
        after_digest, confirmation_text, expires_at)
       VALUES ('plan-before-taxonomy', 'actor', 'preview-idempotency',
               'preview-request', 1, 'reprice', 'ready', 0,
               'enabled', 'safe_data_read', '{}', '{}',
               'sync-before-taxonomy', 'openapi-hash', 'price-hash',
               1, 1, 0, 0, 0, 0, 0, 0, 1, 0,
               1000, 2000, 2000, 'target-digest', 'before-digest',
               'after-digest', 'CONFIRM', '2099-01-01 00:00:00')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO catalog_batch_plan_items
       (id, plan_id, path, ordinal, platform, http_method,
        expected_revision, original_upstream_price_usd_micros,
        original_customer_price_usd_micros, original_price_verified,
        original_enabled, original_read_only, original_sync_generation,
        original_updated_at, target_customer_price_usd_micros,
        target_enabled, target_read_only, will_change, item_digest)
       VALUES ('item-before-taxonomy', 'plan-before-taxonomy',
               '/v1/tiktok/web/fetch_user_profile', 0, 'tiktok', 'GET',
               7, 1000, 2000, 1, 1, 1, 'sync-before-taxonomy',
               '2026-07-24 08:00:00', 2000, 1, 1, 0, 'item-digest')`,
    )
    .run();

  await migrate(db, migrationFiles.slice(13));

  const columnsFor = (table) =>
    new Set(
      db.raw
        .prepare(`SELECT name FROM pragma_table_info('${table}')`)
        .all()
        .map((column) => column.name),
    );
  for (const table of [
    "endpoint_catalog",
    "catalog_sync_staging",
    "catalog_batch_plan_items",
  ]) {
    const columns = columnsFor(table);
    for (const column of [
      "data_type",
      "tags_json",
      "surface",
      "operation_id",
    ]) {
      assert.ok(columns.has(column), `${table}.${column}`);
    }
  }

  const endpoints = db.raw
    .prepare(
      `SELECT path, enabled, read_only, reviewed_at, sync_generation,
              revision, data_type, tags_json, surface, operation_id
       FROM endpoint_catalog
       WHERE path IN (
         '/v1/tiktok/web/fetch_user_profile',
         '/v1/youtube/web/fetch_video_detail'
       )
       ORDER BY path`,
    )
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(endpoints, [
    {
      path: "/v1/tiktok/web/fetch_user_profile",
      enabled: 0,
      read_only: 0,
      reviewed_at: null,
      sync_generation: null,
      revision: 8,
      data_type: "other",
      tags_json: "[]",
      surface: "other",
      operation_id: null,
    },
    {
      path: "/v1/youtube/web/fetch_video_detail",
      enabled: 0,
      read_only: 0,
      reviewed_at: null,
      sync_generation: null,
      revision: 4,
      data_type: "other",
      tags_json: "[]",
      surface: "other",
      operation_id: null,
    },
  ]);
  assert.equal(
    db.raw.prepare("SELECT COUNT(*) AS count FROM catalog_sync_staging")
      .get().count,
    0,
  );
  assert.equal(
    db.raw.prepare("SELECT COUNT(*) AS count FROM catalog_sync_locks")
      .get().count,
    0,
  );
  assert.equal(
    db.raw.prepare("SELECT COUNT(*) AS count FROM catalog_sync_state")
      .get().count,
    0,
  );
  assert.deepEqual(
    {
      ...db.raw
        .prepare(
          `SELECT data_type, tags_json, surface, operation_id,
                  expected_revision
           FROM catalog_batch_plan_items
           WHERE id = 'item-before-taxonomy'`,
        )
        .get(),
    },
    {
      data_type: "other",
      tags_json: "[]",
      surface: "other",
      operation_id: null,
      expected_revision: 7,
    },
  );
  assert.equal(
    db.raw.prepare("PRAGMA foreign_key_check").all().length,
    0,
  );
});

test("fails closed when the catalog is still on the pre-taxonomy schema", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db, migrationFiles.slice(0, 13));

  const nativeFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    throw new Error("pre-taxonomy schema must not reach an upstream");
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });
  const env = baseEnv({
    DB: db,
    LEGAL_REVIEW_CONFIRMED: "true",
    RESELLER_AUTHORIZED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
    UPSTREAM_API_KEY: "upstream-key",
    RECONCILIATION_SECRET:
      "pre-taxonomy-reconcile-secret-32-minimum",
  });

  const readiness = await fetchWorker("/api/readiness", {}, env);
  assert.equal(readiness.status, 503);
  const readinessData = await readiness.json();
  assert.equal(readinessData.capabilities.schemaReady, false);
  assert.ok(readinessData.missing.includes("database_migrations"));

  const proxy = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile?uniqueId=pre-taxonomy",
    {
      headers: {
        authorization: "Bearer rb_live_pre_taxonomy",
        "idempotency-key": "pre-taxonomy-proxy-request",
      },
    },
    env,
  );
  assert.equal(proxy.status, 503);
  assert.equal((await proxy.json()).error.code, "service_not_ready");
  assert.equal(upstreamCalls, 0);
});

test("never reports live readiness for non-canonical stored taxonomy", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  enableCatalogEndpoint(db);
  db.raw
    .prepare(
      `UPDATE endpoint_catalog
       SET tags_json = '["bad?tag"]'
       WHERE path = '/v1/tiktok/web/fetch_user_profile'`,
    )
    .run();
  const env = baseEnv({
    DB: db,
    UPSTREAM_API_KEY: "upstream-key",
    RESELLER_AUTHORIZED: "true",
    LEGAL_REVIEW_CONFIRMED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
    RECONCILIATION_SECRET:
      "taxonomy-corruption-reconcile-secret-32-minimum",
  });
  const nativeFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    throw new Error("corrupt taxonomy must not reach upstream");
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const health = await fetchWorker("/api/health", {}, env);
  assert.equal(health.status, 200);
  const healthData = await health.json();
  assert.equal(healthData.ready, false);
  assert.notEqual(healthData.mode, "live");
  assert.equal(healthData.capabilities.schemaReady, true);
  assert.equal(healthData.capabilities.taxonomyReady, false);
  assert.equal(healthData.capabilities.catalogReady, false);
  assert.ok(healthData.missing.includes("catalog_taxonomy"));

  const catalog = await fetchWorker("/api/catalog", {}, env);
  assert.equal(catalog.status, 503);
  assert.equal((await catalog.json()).error.code, "catalog_taxonomy_invalid");

  const proxy = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile?uniqueId=corrupt-taxonomy",
    {
      headers: {
        authorization: "Bearer rb_live_corrupt_taxonomy",
        "idempotency-key": "corrupt-taxonomy-proxy-request",
      },
    },
    env,
  );
  assert.equal(proxy.status, 503);
  assert.equal((await proxy.json()).error.code, "service_not_ready");
  assert.equal(upstreamCalls, 0);
});

test("keeps financial ledger and payment evidence append-only after migration", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-financial-retention', 'retention@example.com',
               'Financial Retention')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, amount_usd_micros, pay_currency, status)
       VALUES ('pay_financial_retention', 'usr-financial-retention',
               'nowpayments', 10000000, 'usdttrc20', 'waiting')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id)
       VALUES ('led-financial-retention', 'usr-financial-retention',
               'payment_credit', 10000000,
               'nowpayments:financial-retention:credit')`,
    )
    .run();

  assert.throws(
    () =>
      db.raw
        .prepare(
          `UPDATE balance_ledger
           SET delta_usd_micros = 1
           WHERE id = 'led-financial-retention'`,
        )
        .run(),
    /balance_ledger is append-only/,
  );
  assert.throws(
    () =>
      db.raw
        .prepare(
          `DELETE FROM balance_ledger
           WHERE id = 'led-financial-retention'`,
        )
        .run(),
    /balance_ledger is append-only/,
  );
  assert.throws(
    () =>
      db.raw
        .prepare(
          `DELETE FROM payment_orders
           WHERE id = 'pay_financial_retention'`,
        )
        .run(),
    /payment_orders are retained for audit/,
  );
  assert.throws(
    () =>
      db.raw
        .prepare(
          `DELETE FROM users
           WHERE id = 'usr-financial-retention'`,
        )
        .run(),
    /(balance_ledger is append-only|payment_orders are retained for audit)/,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM balance_ledger
         WHERE user_id = 'usr-financial-retention'`,
      )
      .get().count,
    1,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM payment_orders
         WHERE user_id = 'usr-financial-retention'`,
      )
      .get().count,
    1,
  );
});

test("fails closed before upstream access when catalog coverage evidence is inconsistent", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  enableCatalogEndpoint(db);
  const catalogSecret = "catalog-evidence-secret-32-minimum";
  const env = baseEnv({
    DB: db,
    UPSTREAM_API_KEY: "upstream-key",
    RESELLER_AUTHORIZED: "true",
    LEGAL_REVIEW_CONFIRMED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
    CATALOG_SYNC_SECRET: catalogSecret,
    RECONCILIATION_SECRET: "catalog-evidence-reconcile-secret-32-minimum",
  });

  const healthy = await fetchWorker("/api/health", {}, env);
  assert.equal(healthy.status, 200);
  assert.equal((await healthy.json()).capabilities.catalogReady, true);

  db.raw
    .prepare(
      `UPDATE catalog_sync_state
       SET matched_price_count = 0
       WHERE id = 1`,
    )
    .run();
  const health = await fetchWorker("/api/health", {}, env);
  assert.equal(health.status, 200);
  const healthData = await health.json();
  assert.equal(healthData.capabilities.schemaReady, true);
  assert.equal(healthData.capabilities.catalogReady, false);

  const adminCatalog = await fetchWorker(
    "/api/admin/catalog?limit=1&offset=0",
    {
      headers: { authorization: `Bearer ${catalogSecret}` },
    },
    env,
  );
  assert.equal(adminCatalog.status, 200);
  assert.equal((await adminCatalog.json()).sync.coverage, null);

  const nativeFetch = globalThis.fetch;
  let upstreamReads = 0;
  globalThis.fetch = async () => {
    upstreamReads += 1;
    throw new Error("upstream must not be called");
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });
  const proxy = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile",
    {},
    env,
  );
  assert.equal(proxy.status, 503);
  assert.equal((await proxy.json()).error.code, "service_not_ready");
  assert.equal(upstreamReads, 0);
});

test("encrypts, verifies, rotates and fail-closes managed Synthetic Provider credentials", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);

  const adminSecret = "managed-upstream-admin-secret-32-minimum";
  const managedApiKey = "managed-source-secret-value-0001";
  const legacyApiKey = "legacy-source-environment-secret";
  const encryptionKey = Buffer.alloc(32, 7).toString("base64url");
  const env = baseEnv({
    DB: db,
    ADMIN_MASTER_SECRET: adminSecret,
    UPSTREAM_API_KEY: legacyApiKey,
    UPSTREAM_CREDENTIALS_ENCRYPTION_KEY: encryptionKey,
    LEGAL_REVIEW_CONFIRMED: "true",
    RESELLER_AUTHORIZED: "true",
  });
  const adminHeaders = {
    authorization: `Bearer ${adminSecret}`,
    origin: "http://localhost",
    "content-type": "application/json",
  };

  const initialList = await fetchWorker(
    "/api/admin/upstream-credentials",
    {
      headers: { authorization: `Bearer ${adminSecret}` },
    },
    env,
  );
  assert.equal(initialList.status, 200);
  const initialData = await initialList.json();
  assert.equal(initialData.activeSource, "environment");
  assert.equal(initialData.managedEnabled, false);
  assert.equal(initialData.stateVersion, 1);
  assert.doesNotMatch(JSON.stringify(initialData), new RegExp(legacyApiKey));

  const createdResponse = await fetchWorker(
    "/api/admin/upstream-credentials",
    {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        label: "Synthetic Provider production",
        apiKey: managedApiKey,
        activate: false,
        expectedVersion: 1,
      }),
    },
    env,
  );
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.credential.status, "standby");
  assert.equal(created.verified, false);
  assert.equal(created.activationConflict, false);
  assert.doesNotMatch(JSON.stringify(created), new RegExp(managedApiKey));

  const stored = db.raw
    .prepare(
      `SELECT encrypted_secret, secret_hash
       FROM upstream_credentials
       WHERE id = ?`,
    )
    .get(created.credential.id);
  assert.match(stored.encrypted_secret, /^v1\.[A-Za-z0-9_-]{16}\./);
  assert.equal(stored.secret_hash.length, 64);
  assert.doesNotMatch(stored.encrypted_secret, new RegExp(managedApiKey));

  const nativeFetch = globalThis.fetch;
  const upstreamAuthorizations = [];
  let credentialVerificationAttempts = 0;
  let forceActivationRace = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    upstreamAuthorizations.push(new Headers(init?.headers).get("authorization"));
    if (url.pathname === "/api/v1/control/credential") {
      credentialVerificationAttempts += 1;
      if (credentialVerificationAttempts < 3) {
        return Response.json(
          { message: "temporary upstream failure" },
          { status: 503 },
        );
      }
      if (forceActivationRace) {
        forceActivationRace = false;
        db.raw
          .prepare(
            `UPDATE upstream_credential_state
             SET version = version + 1
             WHERE provider = 'primary'`,
          )
          .run();
      }
      return Response.json({
        code: 200,
        router: url.pathname,
        api_key_data: {
          api_key_name: "Managed test key",
          api_key_scopes: ["/api/v1/tiktok/"],
          created_at: "2026-07-01T00:00:00Z",
          expires_at: "2030-07-01T00:00:00Z",
          api_key_status: 1,
        },
        user_data: {
          email: "owner@example.com",
          balance: 50,
          free_credit: 0,
          email_verified: true,
          account_disabled: false,
          is_active: true,
        },
      });
    }
    if (url.pathname === "/api/v1/control/catalog") {
      return Response.json({
        data: [
          {
            endpoint_uri: "/api/v1/tiktok/web/fetch_user_profile",
            endpoint_cost: 0.001,
            allow_free_credit: 1,
            allow_discount: 1,
            rate_limit: "10/second",
            endpoint_type: "self-operated",
            endpoint_owner: "Synthetic Provider",
          },
        ],
      });
    }
    if (url.pathname === "/openapi.json") {
      return Response.json({
        openapi: "3.1.0",
        info: { title: "Synthetic Provider API", version: "test-5.3.2" },
        paths: {
          "/api/v1/tiktok/web/fetch_user_profile": {
            get: {
              summary: "Fetch TikTok user profile",
              parameters: [],
            },
          },
        },
      });
    }
    throw new Error(`Unexpected upstream URL ${url.href}`);
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const activateResponse = await fetchWorker(
    "/api/admin/upstream-credentials",
    {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        id: created.credential.id,
        action: "activate",
        expectedVersion: 1,
      }),
    },
    env,
  );
  assert.equal(activateResponse.status, 200);
  assert.equal((await activateResponse.json()).credential.status, "active");
  assert.equal(credentialVerificationAttempts, 3);
  assert.equal(
    upstreamAuthorizations.at(-1),
    `Bearer ${managedApiKey}`,
  );

  const staleActivation = await fetchWorker(
    "/api/admin/upstream-credentials",
    {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        id: created.credential.id,
        action: "activate",
        expectedVersion: 1,
      }),
    },
    env,
  );
  assert.equal(staleActivation.status, 409);
  assert.equal(
    (await staleActivation.json()).error.code,
    "upstream_credential_update_conflict",
  );

  const synced = await fetchWorker(
    "/api/admin/catalog/sync",
    {
      method: "POST",
      headers: { authorization: `Bearer ${adminSecret}` },
    },
    env,
  );
  assert.equal(synced.status, 200);
  assert.equal((await synced.json()).priced, 1);
  assert.deepEqual(upstreamAuthorizations.slice(-2), [
    `Bearer ${managedApiKey}`,
    `Bearer ${managedApiKey}`,
  ]);

  const managedList = await fetchWorker(
    "/api/admin/upstream-credentials",
    {
      headers: { authorization: `Bearer ${adminSecret}` },
    },
    env,
  );
  assert.equal(managedList.status, 200);
  const managedData = await managedList.json();
  assert.equal(managedData.activeSource, "managed");
  assert.equal(managedData.stateVersion, 2);
  assert.equal(managedData.credentials[0].status, "active");
  const managedListText = JSON.stringify(managedData);
  assert.doesNotMatch(managedListText, new RegExp(managedApiKey));
  assert.doesNotMatch(managedListText, /encrypted_secret|secret_hash/);
  assert.doesNotMatch(managedListText, new RegExp(stored.encrypted_secret));

  const standbyResponse = await fetchWorker(
    "/api/admin/upstream-credentials",
    {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        label: "Synthetic Provider standby",
        apiKey: "managed-source-secret-value-0002",
        activate: false,
        expectedVersion: 2,
      }),
    },
    env,
  );
  assert.equal(standbyResponse.status, 201);
  const standby = await standbyResponse.json();
  forceActivationRace = true;
  const racedActivation = await fetchWorker(
    "/api/admin/upstream-credentials",
    {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        id: standby.credential.id,
        action: "activate",
        expectedVersion: 2,
      }),
    },
    env,
  );
  assert.equal(racedActivation.status, 409);
  assert.equal(
    (await racedActivation.json()).error.code,
    "upstream_credential_update_conflict",
  );
  const racedCredential = db.raw
    .prepare(
      `SELECT verified_scopes_json, expires_at, verified_at
       FROM upstream_credentials
       WHERE id = ?`,
    )
    .get(standby.credential.id);
  assert.deepEqual({ ...racedCredential }, {
    verified_scopes_json: null,
    expires_at: null,
    verified_at: null,
  });
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM admin_audit_logs
         WHERE action = 'upstream_credential.activated'
           AND target_id = ?`,
      )
      .get(standby.credential.id).count,
    0,
  );

  const wrongKeyEnv = {
    ...env,
    UPSTREAM_CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString(
      "base64url",
    ),
  };
  const wrongKeyReadiness = await fetchWorker(
    "/api/readiness",
    {},
    wrongKeyEnv,
  );
  assert.equal(wrongKeyReadiness.status, 503);
  const wrongKeyData = await wrongKeyReadiness.json();
  assert.equal(wrongKeyData.capabilities.upstreamConfigured, false);
  assert.equal(wrongKeyData.capabilities.proxyEnabled, false);

  const beforeProxyRows = db.raw
    .prepare("SELECT COUNT(*) AS count FROM proxy_requests")
    .get().count;
  const wrongKeyProxy = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile?uniqueId=blocked",
    {
      headers: {
        authorization: "Bearer rb_live_not-used",
        "idempotency-key": "managed-wrong-kek-proxy",
      },
    },
    wrongKeyEnv,
  );
  assert.equal(wrongKeyProxy.status, 503);
  assert.equal(
    db.raw.prepare("SELECT COUNT(*) AS count FROM proxy_requests").get()
      .count,
    beforeProxyRows,
  );

  const revoked = await fetchWorker(
    "/api/admin/upstream-credentials",
    {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        id: created.credential.id,
        action: "revoke",
        expectedVersion: 3,
      }),
    },
    env,
  );
  assert.equal(revoked.status, 200);
  assert.equal((await revoked.json()).credential.status, "revoked");

  const afterRevoke = await fetchWorker(
    "/api/admin/upstream-credentials",
    {
      headers: { authorization: `Bearer ${adminSecret}` },
    },
    env,
  );
  assert.equal(afterRevoke.status, 200);
  const afterRevokeData = await afterRevoke.json();
  assert.equal(afterRevokeData.managedEnabled, true);
  assert.equal(afterRevokeData.activeSource, "none");
  assert.equal(afterRevokeData.activeCredentialId, null);
  assert.equal(afterRevokeData.activeFingerprint, null);
  assert.equal(afterRevokeData.stateVersion, 4);

  const failClosedReadiness = await fetchWorker("/api/readiness", {}, env);
  assert.equal(failClosedReadiness.status, 503);
  assert.equal(
    (await failClosedReadiness.json()).capabilities.upstreamConfigured,
    false,
  );
});

test("validates browser and admin JSON without coercion", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({
    DB: db,
    CRYPTO_PAYMENTS_ENABLED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
    LEGAL_REVIEW_CONFIRMED: "true",
    RESELLER_AUTHORIZED: "true",
    UPSTREAM_API_KEY: "upstream-test-key",
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
        expectedRevision: 0,
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
        expectedRevision: 0,
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

test("rolls back first-login users when identity linking fails and retries cleanly", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({
    DB: db,
    TRUST_SITES_IDENTITY_HEADERS: "false",
    WALLET_LOGIN_ENABLED: "true",
  });
  const account = privateKeyToAccount(
    "0x59c6995e998f97a5a0044976f7d6d55f53f6d2f695e356f13e36f9d53e87b6b8",
  );
  const verifyFreshChallenge = async () => {
    const challengeResponse = await fetchWorker(
      "/api/auth/wallet/challenge",
      {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.30",
        },
        body: JSON.stringify({
          address: account.address,
          chainId: "0x1",
          returnTo: "/console",
        }),
      },
      env,
    );
    assert.equal(challengeResponse.status, 200);
    const challenge = await challengeResponse.json();
    const signature = await account.signMessage({
      message: challenge.message,
    });
    return fetchWorker(
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
  };

  db.raw.exec(
    `CREATE TRIGGER fail_first_identity_link
     BEFORE INSERT ON auth_identities
     BEGIN
       SELECT RAISE(ABORT, 'forced identity link failure');
     END`,
  );
  const failed = await verifyFreshChallenge();
  assert.equal(failed.status, 500);
  assert.equal(
    db.raw.prepare("SELECT COUNT(*) AS count FROM users").get().count,
    0,
  );
  assert.equal(
    db.raw
      .prepare("SELECT COUNT(*) AS count FROM auth_identities")
      .get().count,
    0,
  );

  db.raw.exec("DROP TRIGGER fail_first_identity_link");
  const retried = await verifyFreshChallenge();
  assert.equal(retried.status, 200);
  assert.ok(responseCookie(retried, "rb_session"));
  assert.equal(
    db.raw.prepare("SELECT COUNT(*) AS count FROM users").get().count,
    1,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM auth_identities
         WHERE provider = 'wallet' AND subject = ?`,
      )
      .get(account.address.toLowerCase()).count,
    1,
  );
});

test("rejects sessions and API keys whose writes lose a suspension race", async (t) => {
  const db = new PausableBatchD1();
  t.after(() => db.close());
  await migrate(db);
  const adminSecret = "suspension-race-admin-secret-32-minimum";
  const userId = "usr_suspension_race_0001";
  const account = privateKeyToAccount(
    "0x5de4111afa1c4b3daadb435b6b1e7cc0bb6c227bc5feefc7a45722801a0b2f3a",
  );
  const walletAddress = account.address.toLowerCase();
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES (?, ?, 'Suspension Race')`,
    )
    .run(
      userId,
      `${walletAddress.slice(2)}@wallet.relaybase.invalid`,
    );
  db.raw
    .prepare(
      `INSERT INTO auth_identities
       (id, user_id, provider, subject, wallet_address)
       VALUES ('aid_suspension_race_0001', ?, 'wallet', ?, ?)`,
    )
    .run(userId, walletAddress, walletAddress);
  const env = baseEnv({
    DB: db,
    ADMIN_MASTER_SECRET: adminSecret,
    TRUST_SITES_IDENTITY_HEADERS: "false",
    WALLET_LOGIN_ENABLED: "true",
  });
  const usersBeforeRace = await fetchWorker(
    "/api/admin/users",
    {
      headers: {
        authorization: `Bearer ${adminSecret}`,
      },
    },
    env,
  );
  assert.equal(usersBeforeRace.status, 200);
  const userBeforeRace = (await usersBeforeRace.json()).users[0];
  assert.deepEqual(userBeforeRace.providers, ["wallet"]);
  assert.equal(userBeforeRace.walletAddress, walletAddress);
  assert.equal(userBeforeRace.activeKeyCount, 0);
  assert.equal(userBeforeRace.activeSessionCount, 0);
  const updateStatus = (status) => {
    const expectedStatus = db.raw
      .prepare("SELECT status FROM users WHERE id = ?")
      .get(userId).status;
    return fetchWorker(
      "/api/admin/users",
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${adminSecret}`,
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: JSON.stringify({ userId, status, expectedStatus }),
      },
      env,
    );
  };

  const challengeResponse = await fetchWorker(
    "/api/auth/wallet/challenge",
    {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.31",
      },
      body: JSON.stringify({
        address: account.address,
        chainId: "0x1",
        returnTo: "/console",
      }),
    },
    env,
  );
  assert.equal(challengeResponse.status, 200);
  const challenge = await challengeResponse.json();
  const signature = await account.signMessage({
    message: challenge.message,
  });
  const sessionGate = db.pauseNextBatch((statements) =>
    statements.some((statement) =>
      statement.sql.includes("INSERT INTO auth_sessions"),
    ),
  );
  const verifyPromise = fetchWorker(
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
  await sessionGate.paused;
  const suspendedDuringLogin = await updateStatus("suspended");
  assert.equal(suspendedDuringLogin.status, 200);
  sessionGate.release();
  const rejectedLogin = await verifyPromise;
  assert.equal(rejectedLogin.status, 403);
  assert.equal(
    (await rejectedLogin.json()).error.code,
    "account_suspended",
  );
  assert.equal(
    db.raw
      .prepare(
        "SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id = ?",
      )
      .get(userId).count,
    0,
  );

  const resumedForKey = await updateStatus("active");
  assert.equal(resumedForKey.status, 200);
  const token = "session_suspension_race_token_000000000001";
  db.raw
    .prepare(
      `INSERT INTO auth_sessions
       (token_hash, user_id, provider, expires_at)
       VALUES (?, ?, 'wallet', datetime('now', '+1 day'))`,
    )
    .run(createHash("sha256").update(token).digest("hex"), userId);
  const keyGate = db.pauseNextBatch((statements) =>
    statements.some((statement) =>
      statement.sql.includes("INSERT INTO api_keys"),
    ),
  );
  const keyPromise = fetchWorker(
    "/api/keys",
    {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
        cookie: `rb_session=${token}`,
      },
      body: JSON.stringify({ label: "racing key" }),
    },
    env,
  );
  await keyGate.paused;
  const suspendedDuringKey = await updateStatus("suspended");
  assert.equal(suspendedDuringKey.status, 200);
  keyGate.release();
  const rejectedKey = await keyPromise;
  assert.equal(rejectedKey.status, 403);
  assert.equal(
    (await rejectedKey.json()).error.code,
    "account_suspended",
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM api_keys
         WHERE user_id = ? AND revoked_at IS NULL`,
      )
      .get(userId).count,
    0,
  );

  const resumedAfterRaces = await updateStatus("active");
  assert.equal(resumedAfterRaces.status, 200);
  assert.equal(
    db.raw
      .prepare(
        "SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id = ?",
      )
      .get(userId).count,
    0,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM api_keys
         WHERE user_id = ? AND revoked_at IS NULL`,
      )
      .get(userId).count,
    0,
  );
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
  enableCatalogEndpoint(db);
  for (let index = 0; index < 30; index += 1) {
    db.raw
      .prepare(
        `INSERT INTO endpoint_catalog
         (path, platform, http_method, upstream_price_usd_micros,
          customer_price_usd_micros, price_verified, enabled, read_only,
          sync_generation, created_at, updated_at)
         VALUES (?, 'historical', 'GET', 1000, 2000, 1, 0, 1,
                 NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run(`/v1/historical/web/fetch_item_${index}`);
  }
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

test("atomically invalidates every session and API key when suspending a user", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  enableCatalogEndpoint(
    db,
    "/v1/tiktok/web/fetch_user_profile",
    2000,
    "upstream-secret",
  );

  const userId = "usr_suspend_target_0001";
  const adminSecret = "user-suspension-admin-secret-32-minimum";
  const sessionTokens = [
    "session_suspend_target_token_000000000001",
    "session_suspend_target_token_000000000002",
  ];
  const apiKeySecrets = [
    "rb_live_suspend_target_key_000000000001",
    "rb_live_suspend_target_key_000000000002",
  ];
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES (?, 'suspend-target@example.com', 'Suspend Target')`,
    )
    .run(userId);
  for (const token of sessionTokens) {
    db.raw
      .prepare(
        `INSERT INTO auth_sessions
         (token_hash, user_id, provider, expires_at)
         VALUES (?, ?, 'google', datetime('now', '+1 day'))`,
      )
      .run(
        createHash("sha256").update(token).digest("hex"),
        userId,
      );
  }
  for (const [index, secret] of apiKeySecrets.entries()) {
    db.raw
      .prepare(
        `INSERT INTO api_keys
         (id, user_id, label, key_prefix, key_hash)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        `key_suspend_target_000${index + 1}`,
        userId,
        `Suspend key ${index + 1}`,
        `${secret.slice(0, 16)}…`,
        createHash("sha256").update(secret).digest("hex"),
      );
  }

  const env = baseEnv({
    DB: db,
    ADMIN_MASTER_SECRET: adminSecret,
    TRUST_SITES_IDENTITY_HEADERS: "false",
    RESELLER_AUTHORIZED: "true",
    LEGAL_REVIEW_CONFIRMED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
    UPSTREAM_API_KEY: "upstream-secret",
    RECONCILIATION_SECRET: "user-suspend-reconcile-secret-32-minimum",
  });
  const updateStatus = (status) => {
    const expectedStatus = db.raw
      .prepare("SELECT status FROM users WHERE id = ?")
      .get(userId).status;
    return fetchWorker(
      "/api/admin/users",
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${adminSecret}`,
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: JSON.stringify({ userId, status, expectedStatus }),
      },
      env,
    );
  };

  const activeSession = await fetchWorker(
    "/api/auth/me",
    {
      headers: { cookie: `rb_session=${sessionTokens[0]}` },
    },
    env,
  );
  assert.equal(activeSession.status, 200);

  db.raw.exec(
    `CREATE TRIGGER fail_user_status_audit
     BEFORE INSERT ON admin_audit_logs
     WHEN NEW.action = 'user.status_updated'
     BEGIN
       SELECT RAISE(ABORT, 'forced user status audit failure');
     END`,
  );
  const rolledBackSuspend = await updateStatus("suspended");
  assert.equal(rolledBackSuspend.status, 500);
  assert.equal(
    db.raw
      .prepare("SELECT status FROM users WHERE id = ?")
      .get(userId).status,
    "active",
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM api_keys
         WHERE user_id = ? AND revoked_at IS NULL`,
      )
      .get(userId).count,
    2,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM auth_sessions
         WHERE user_id = ?`,
      )
      .get(userId).count,
    2,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM admin_audit_logs
         WHERE action = 'user.status_updated' AND target_id = ?`,
      )
      .get(userId).count,
    0,
  );
  db.raw.exec("DROP TRIGGER fail_user_status_audit");

  const suspended = await updateStatus("suspended");
  assert.equal(suspended.status, 200);
  assert.equal(
    db.raw
      .prepare("SELECT status FROM users WHERE id = ?")
      .get(userId).status,
    "suspended",
  );
  const revokedAfterSuspend = db.raw
    .prepare(
      `SELECT id, revoked_at
       FROM api_keys
       WHERE user_id = ?
       ORDER BY id`,
    )
    .all(userId);
  assert.equal(revokedAfterSuspend.length, 2);
  assert.ok(revokedAfterSuspend.every((key) => key.revoked_at));
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM auth_sessions
         WHERE user_id = ?`,
      )
      .get(userId).count,
    0,
  );
  const suspendAudit = db.raw
    .prepare(
      `SELECT details_json
       FROM admin_audit_logs
       WHERE action = 'user.status_updated' AND target_id = ?`,
    )
    .get(userId);
  assert.deepEqual(JSON.parse(suspendAudit.details_json), {
    status: "suspended",
    expectedStatus: "active",
    credentialsInvalidated: true,
  });

  const suspendedSession = await fetchWorker(
    "/api/auth/me",
    {
      headers: { cookie: `rb_session=${sessionTokens[0]}` },
    },
    env,
  );
  assert.equal(suspendedSession.status, 401);

  const resumed = await updateStatus("active");
  assert.equal(resumed.status, 200);
  assert.equal(
    db.raw
      .prepare("SELECT status FROM users WHERE id = ?")
      .get(userId).status,
    "active",
  );
  const revokedAfterResume = db.raw
    .prepare(
      `SELECT id, revoked_at
       FROM api_keys
       WHERE user_id = ?
       ORDER BY id`,
    )
    .all(userId);
  assert.deepEqual(
    revokedAfterResume.map((key) => ({ ...key })),
    revokedAfterSuspend.map((key) => ({ ...key })),
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM auth_sessions
         WHERE user_id = ?`,
      )
      .get(userId).count,
    0,
  );
  const staleResume = await fetchWorker(
    "/api/admin/users",
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${adminSecret}`,
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        userId,
        status: "active",
        expectedStatus: "suspended",
      }),
    },
    env,
  );
  assert.equal(staleResume.status, 409);
  assert.equal(
    (await staleResume.json()).error.code,
    "user_status_conflict",
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM admin_audit_logs
         WHERE action = 'user.status_updated' AND target_id = ?`,
      )
      .get(userId).count,
    2,
  );

  const resumedOldSession = await fetchWorker(
    "/api/auth/me",
    {
      headers: { cookie: `rb_session=${sessionTokens[0]}` },
    },
    env,
  );
  assert.equal(resumedOldSession.status, 401);

  const nativeFetch = globalThis.fetch;
  let upstreamReads = 0;
  globalThis.fetch = async () => {
    upstreamReads += 1;
    throw new Error("revoked API key must not reach upstream");
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });
  const resumedOldKey = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile?uniqueId=suspended-user",
    {
      headers: {
        authorization: `Bearer ${apiKeySecrets[0]}`,
        "idempotency-key": "suspended-user-old-key",
      },
    },
    env,
  );
  assert.equal(resumedOldKey.status, 401);
  assert.equal((await resumedOldKey.json()).error.code, "invalid_api_key");
  assert.equal(upstreamReads, 0);
});

test("creates hashed customer keys and proxies with idempotent billing", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({
    DB: db,
    RESELLER_AUTHORIZED: "true",
    LEGAL_REVIEW_CONFIRMED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
    UPSTREAM_API_KEY: "upstream-secret",
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
  enableCatalogEndpoint(
    db,
    "/v1/tiktok/web/fetch_user_profile",
    2000,
    "upstream-secret",
  );

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
  const privateUpstreamMarkers = [
    "ExampleSourceBrand",
    "https://private-source.example",
    "source-request-id-should-not-leak",
  ];
  globalThis.fetch = async (input) => {
    upstreamCalls += 1;
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    assert.equal(url.origin, TEST_UPSTREAM_ORIGIN);
    assert.equal(
      url.pathname,
      "/api/v1/tiktok/web/fetch_user_profile",
    );
    if (url.searchParams.get("uniqueId") === "missing") {
      return Response.json(
        {
          code: 404,
          message:
            `${privateUpstreamMarkers[0]} at ` +
            `${privateUpstreamMarkers[1]} could not find the resource`,
          request_id: privateUpstreamMarkers[2],
        },
        { status: 404 },
      );
    }
    if (url.searchParams.get("uniqueId") === "invalid-json") {
      return new Response("<html>upstream bot check</html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return Response.json({
      code: 200,
      message: `${privateUpstreamMarkers[0]} request succeeded`,
      docs: privateUpstreamMarkers[1],
      request_id: privateUpstreamMarkers[2],
      data: { uniqueId: "test" },
    });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const rejectedRequestState = () => ({
    proxyRequests: db.raw
      .prepare("SELECT COUNT(*) AS count FROM proxy_requests")
      .get().count,
    ledgerRows: db.raw
      .prepare("SELECT COUNT(*) AS count FROM balance_ledger")
      .get().count,
    ledgerBalance: db.raw
      .prepare(
        `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
         FROM balance_ledger`,
      )
      .get().balance,
    customerRateSlots: db.raw
      .prepare(
        `SELECT COALESCE(SUM(request_count), 0) AS count
         FROM rate_limit_buckets`,
      )
      .get().count,
    upstreamRateSlots: db.raw
      .prepare(
        `SELECT COALESCE(SUM(request_count), 0) AS count
         FROM upstream_rate_limit_buckets`,
      )
      .get().count,
    apiCalls: db.raw
      .prepare("SELECT COUNT(*) AS count FROM api_calls")
      .get().count,
    apiKeyLastUsedAt: db.raw
      .prepare("SELECT last_used_at FROM api_keys WHERE id = ?")
      .get(created.id).last_used_at,
  });
  const beforeRejectedRequests = rejectedRequestState();
  const priceCap = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile?uniqueId=price-cap",
    {
      headers: {
        authorization: `Bearer ${created.secret}`,
        "idempotency-key": "job-price-cap",
        "x-relaybase-max-cost-usd-micros": "1999",
      },
    },
    env,
  );
  assert.equal(priceCap.status, 409);
  assert.equal(
    (await priceCap.json()).error.code,
    "price_quote_exceeded",
  );
  assert.equal(upstreamCalls, 0);
  assert.deepEqual(
    rejectedRequestState(),
    beforeRejectedRequests,
    "price-cap rejection must not reserve, debit, or consume rate limits",
  );
  const invalidPriceCap = await fetchWorker(
    "/v1/tiktok/web/fetch_user_profile?uniqueId=invalid-price-cap",
    {
      headers: {
        authorization: `Bearer ${created.secret}`,
        "idempotency-key": "job-invalid-price-cap",
        "x-relaybase-max-cost-usd-micros": "2.5",
      },
    },
    env,
  );
  assert.equal(invalidPriceCap.status, 400);
  assert.equal(
    (await invalidPriceCap.json()).error.code,
    "invalid_max_cost",
  );
  assert.equal(upstreamCalls, 0);
  assert.deepEqual(
    rejectedRequestState(),
    beforeRejectedRequests,
    "invalid price cap must not reserve, debit, or consume rate limits",
  );

  const authHeaders = {
    authorization: `Bearer ${created.secret}`,
    "idempotency-key": "job-0001",
    "x-relaybase-max-cost-usd-micros": "2000",
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
  const successBody = await success.clone().json();
  assert.deepEqual(successBody, {
    success: true,
    data: { uniqueId: "test" },
  });
  const publicSuccess = JSON.stringify(successBody);
  for (const marker of privateUpstreamMarkers) {
    assert.equal(publicSuccess.includes(marker), false, marker);
  }
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
  const failedBody = await failed.clone().json();
  assert.equal(failedBody.error.code, "upstream_error");
  assert.match(failedBody.error.message, /数据服务/);
  const publicFailure = JSON.stringify(failedBody);
  for (const marker of privateUpstreamMarkers) {
    assert.equal(publicFailure.includes(marker), false, marker);
  }
  assert.notEqual(
    failedBody.error.requestId,
    privateUpstreamMarkers[2],
  );
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

  const unsafeReject = await fetchWorker(
    "/api/admin/payment-reviews/resolve",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${paymentAdminSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        caseId: reviews[0].id,
        action: "reject",
        note: "Funds are present, so rejection must remain blocked.",
      }),
    },
    env,
  );
  assert.equal(unsafeReject.status, 409);
  assert.equal(
    (await unsafeReject.json()).error.code,
    "payment_review_reject_not_safe",
  );

  verifiedStatus = "finished";
  const excessiveCredit = await fetchWorker(
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
        creditUsdMicros: 10000000,
        note: "This exceeds the verified proportional receipt.",
      }),
    },
    env,
  );
  assert.equal(excessiveCredit.status, 400);
  assert.equal(
    (await excessiveCredit.json()).error.code,
    "review_credit_exceeds_verified_payment",
  );

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

test("does not let a prepared rejection overwrite concurrent arrival evidence", async (t) => {
  const db = new PausableBatchD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-reject-race', 'reject-race@example.com',
               'Reject Race')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, provider_payment_id, amount_usd_micros,
        pay_currency, pay_amount, status)
       VALUES ('pay_reject_race', 'usr-reject-race', 'nowpayments',
               'np-reject-race', 10000000, 'usdttrc20', '10',
               'manual_review')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_review_cases
       (id, order_id, provider_payment_id, reason, status, actually_paid,
        pay_currency, evidence_json)
       VALUES ('prv_reject_race_case', 'pay_reject_race',
               'np-reject-race', 'provider_data_mismatch', 'open', '0',
               'usdttrc20', ?)`,
    )
    .run(
      JSON.stringify({
        paymentId: "np-reject-race",
        parentPaymentId: null,
        orderId: "pay_reject_race",
        paymentStatus: "failed",
        priceAmount: "10",
        priceCurrency: "usd",
        payAmount: "10",
        actuallyPaid: "0",
        payCurrency: "usdttrc20",
      }),
    );
  const initialEvidence = db.raw
    .prepare(
      `SELECT evidence_json
       FROM payment_review_cases
       WHERE id = 'prv_reject_race_case'`,
    )
    .get().evidence_json;

  const ipnSecret = "reject-race-ipn-secret";
  const adminSecret = "reject-race-admin-secret-32-characters";
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
    const hasFunds = providerRead === 3;
    return Response.json({
      payment_id: "np-reject-race",
      payment_status: hasFunds ? "finished" : "failed",
      order_id: "pay_reject_race",
      price_amount: 10,
      price_currency: "usd",
      pay_amount: "10",
      actually_paid: hasFunds ? "10" : "0",
      pay_currency: "usdttrc20",
    });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const gate = db.pauseNextBatch((statements) =>
    statements.some((statement) =>
      statement.sql.includes("SET status = 'resolved', resolution_action"),
    ),
  );
  t.after(() => gate.release());
  const preparedReject = fetchWorker(
    "/api/admin/payment-reviews/resolve",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        caseId: "prv_reject_race_case",
        action: "reject",
        note: "Provider reported a terminal zero-funds payment.",
      }),
    },
    env,
  );
  await gate.paused;

  const sendWebhook = (paymentStatus, sequence) => {
    const payload = {
      payment_id: "np-reject-race",
      payment_status: paymentStatus,
      order_id: "pay_reject_race",
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
  const staleEvidenceGate = db.pauseNextBatch((statements) =>
    statements.some((statement) =>
      statement.sql.includes("INSERT INTO payment_review_cases"),
    ),
  );
  t.after(() => staleEvidenceGate.release());
  const delayedZeroObservation = sendWebhook("failed", 1);
  await staleEvidenceGate.paused;

  const freshFundsObservation = await sendWebhook("finished", 2);
  assert.equal(freshFundsObservation.status, 200);
  staleEvidenceGate.release();
  assert.equal((await delayedZeroObservation).status, 200);

  gate.release();
  const rejected = await preparedReject;
  assert.equal(rejected.status, 409);
  assert.equal(
    (await rejected.json()).error.code,
    "payment_review_evidence_changed",
  );

  const review = db.raw
    .prepare(
      `SELECT status, reason, actually_paid, evidence_json,
              resolution_action, resolved_at
       FROM payment_review_cases
       WHERE id = 'prv_reject_race_case'`,
    )
    .get();
  assert.equal(review.status, "open");
  assert.equal(review.reason, "provider_data_mismatch");
  assert.equal(review.actually_paid, "0");
  assert.match(review.evidence_json, /"observationId":"obs_[^"]+"/);
  assert.match(review.evidence_json, /"actuallyPaid":"0"/);
  assert.notEqual(review.evidence_json, initialEvidence);
  assert.equal(review.resolution_action, null);
  assert.equal(review.resolved_at, null);
  assert.equal(
    db.raw
      .prepare(
        `SELECT status FROM payment_orders WHERE id = 'pay_reject_race'`,
      )
      .get().status,
    "manual_review",
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM balance_ledger
         WHERE user_id = 'usr-reject-race'`,
      )
      .get().count,
    0,
  );
});

test("does not reopen a rejected case from a delayed zero-funds observation", async (t) => {
  const db = new PausableBatchD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-zero-delay', 'zero-delay@example.com', 'Zero Delay')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, provider_payment_id, amount_usd_micros,
        pay_currency, pay_amount, status)
       VALUES ('pay_zero_delay', 'usr-zero-delay', 'nowpayments',
               'np-zero-delay', 10000000, 'usdttrc20', '10',
               'manual_review')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_review_cases
       (id, order_id, provider_payment_id, reason, status, actually_paid,
        pay_currency, evidence_json)
       VALUES ('prv_zero_delay_case', 'pay_zero_delay', 'np-zero-delay',
               'provider_data_mismatch', 'open', '0', 'usdttrc20', '{}')`,
    )
    .run();

  const ipnSecret = "zero-delay-ipn-secret";
  const adminSecret = "zero-delay-admin-secret-32-characters";
  const env = baseEnv({
    DB: db,
    NOWPAYMENTS_API_KEY: "provider-test-key",
    NOWPAYMENTS_IPN_SECRET: ipnSecret,
    PAYMENT_ADMIN_SECRET: adminSecret,
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      payment_id: "np-zero-delay",
      payment_status: "failed",
      order_id: "pay_zero_delay",
      price_amount: 10,
      price_currency: "usd",
      pay_amount: "10",
      actually_paid: "0",
      pay_currency: "usdttrc20",
    });
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const staleEvidenceGate = db.pauseNextBatch((statements) =>
    statements.some((statement) =>
      statement.sql.includes("INSERT INTO payment_review_cases"),
    ),
  );
  t.after(() => staleEvidenceGate.release());
  const payload = {
    payment_id: "np-zero-delay",
    payment_status: "failed",
    order_id: "pay_zero_delay",
  };
  const delayedObservation = fetchWorker(
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
  await staleEvidenceGate.paused;

  const rejected = await fetchWorker(
    "/api/admin/payment-reviews/resolve",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        caseId: "prv_zero_delay_case",
        action: "reject",
        note: "Provider still confirms terminal zero-funds status.",
      }),
    },
    env,
  );
  assert.equal(rejected.status, 200);
  staleEvidenceGate.release();
  assert.equal((await delayedObservation).status, 200);

  const review = db.raw
    .prepare(
      `SELECT status, resolution_action
       FROM payment_review_cases
       WHERE id = 'prv_zero_delay_case'`,
    )
    .get();
  assert.equal(review.status, "resolved");
  assert.equal(review.resolution_action, "reject");
  assert.equal(
    db.raw
      .prepare(
        `SELECT status
         FROM payment_orders
         WHERE id = 'pay_zero_delay'`,
      )
      .get().status,
    "manual_resolved",
  );
});

test("does not let a stale rejection undo a concurrent provider refund", async (t) => {
  const db = new PausableBatchD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-reject-refund', 'reject-refund@example.com',
               'Reject Refund')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, provider_payment_id, amount_usd_micros,
        pay_currency, pay_amount, status, credited_usd_micros)
       VALUES ('pay_reject_refund', 'usr-reject-refund', 'nowpayments',
               'np-reject-refund', 10000000, 'usdttrc20', '10',
               'manual_review', 10000000)`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id)
       VALUES ('led-reject-refund', 'usr-reject-refund',
               'payment_credit', 10000000,
               'nowpayments:np-reject-refund:credit')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_review_cases
       (id, order_id, provider_payment_id, reason, status, actually_paid,
        pay_currency, evidence_json)
       VALUES ('prv_reject_refund_case', 'pay_reject_refund',
               'np-reject-refund', 'provider_data_mismatch', 'open', '0',
               'usdttrc20', '{}')`,
    )
    .run();

  const ipnSecret = "reject-refund-ipn-secret";
  const adminSecret = "reject-refund-admin-secret-32-characters";
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
    const refunded = providerRead > 1;
    return Response.json({
      payment_id: "np-reject-refund",
      payment_status: refunded ? "refunded" : "failed",
      order_id: "pay_reject_refund",
      price_amount: 10,
      price_currency: "usd",
      pay_amount: "10",
      actually_paid: refunded ? "10" : "0",
      pay_currency: "usdttrc20",
    });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const gate = db.pauseNextBatch((statements) =>
    statements.some((statement) =>
      statement.sql.includes("SET status = 'resolved', resolution_action"),
    ),
  );
  t.after(() => gate.release());
  const preparedReject = fetchWorker(
    "/api/admin/payment-reviews/resolve",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        caseId: "prv_reject_refund_case",
        action: "reject",
        note: "This stale request must not undo a concurrent refund.",
      }),
    },
    env,
  );
  await gate.paused;

  const payload = {
    payment_id: "np-reject-refund",
    payment_status: "refunded",
    order_id: "pay_reject_refund",
  };
  const refundWebhook = await fetchWorker(
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
  assert.equal(refundWebhook.status, 200);
  gate.release();

  const rejected = await preparedReject;
  assert.equal(rejected.status, 409);
  const review = db.raw
    .prepare(
      `SELECT status, resolution_action
       FROM payment_review_cases
       WHERE id = 'prv_reject_refund_case'`,
    )
    .get();
  assert.equal(review.status, "resolved");
  assert.equal(review.resolution_action, "refund_confirmed");
  const order = db.raw
    .prepare(
      `SELECT status, credited_usd_micros
       FROM payment_orders
       WHERE id = 'pay_reject_refund'`,
    )
    .get();
  assert.equal(order.status, "refunded");
  assert.equal(order.credited_usd_micros, 0);
  assert.equal(
    db.raw
      .prepare(
        `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
         FROM balance_ledger
         WHERE user_id = 'usr-reject-refund'`,
      )
      .get().balance,
    0,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM admin_audit_logs
         WHERE action = 'payment_review.reject'
           AND target_id = 'prv_reject_refund_case'`,
      )
      .get().count,
    0,
  );
});

test("reopens a rejected payment review when provider later reports funds", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-late-funds', 'late-funds@example.com', 'Late Funds')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, provider_payment_id, amount_usd_micros,
        pay_currency, pay_amount, status)
       VALUES ('pay_late_funds', 'usr-late-funds', 'nowpayments',
               'np-late-funds', 10000000, 'usdttrc20', '10',
               'manual_resolved')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_review_cases
       (id, order_id, provider_payment_id, reason, status, evidence_json,
        resolution_action, resolution_request_hash, resolution_note,
        resolution_reference, resolved_at)
       VALUES ('prv_late_funds_case', 'pay_late_funds',
               'np-late-funds', 'provider_data_mismatch', 'resolved', '{}',
               'reject', 'late-funds-reject-hash',
               'Provider previously reported zero funds.',
               'nowpayments:np-late-funds:failed', CURRENT_TIMESTAMP)`,
    )
    .run();

  const ipnSecret = "late-funds-ipn-secret";
  const env = baseEnv({
    DB: db,
    NOWPAYMENTS_API_KEY: "provider-test-key",
    NOWPAYMENTS_IPN_SECRET: ipnSecret,
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      payment_id: "np-late-funds",
      payment_status: "finished",
      order_id: "pay_late_funds",
      price_amount: 10,
      price_currency: "usd",
      pay_amount: "10",
      actually_paid: "1",
      pay_currency: "usdttrc20",
    });
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const payload = {
    payment_id: "np-late-funds",
    payment_status: "finished",
    order_id: "pay_late_funds",
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

  const reopened = db.raw
    .prepare(
      `SELECT status, reason, resolution_action, resolved_at
       FROM payment_review_cases
       WHERE id = 'prv_late_funds_case'`,
    )
    .get();
  assert.equal(reopened.status, "open");
  assert.equal(reopened.reason, "funds_after_manual_rejection");
  assert.equal(reopened.resolution_action, null);
  assert.equal(reopened.resolved_at, null);
  assert.equal(
    db.raw
      .prepare(
        `SELECT status FROM payment_orders WHERE id = 'pay_late_funds'`,
      )
      .get().status,
    "manual_review",
  );
});

test("polls recent zero-credit rejections on a bounded interval and reopens late funds", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-rejected-poll', 'rejected-poll@example.com',
               'Rejected Poll')`,
    )
    .run();
  for (const [suffix, resolvedAt] of [
    ["funded", "datetime('now', '-7 hours')"],
    ["zero", "datetime('now', '-7 hours')"],
    ["fresh", "datetime('now', '-5 hours')"],
    ["old", "datetime('now', '-8 days')"],
  ]) {
    db.raw
      .prepare(
        `INSERT INTO payment_orders
         (id, user_id, provider, provider_payment_id, amount_usd_micros,
          pay_currency, pay_amount, status, credited_usd_micros)
         VALUES (?, 'usr-rejected-poll', 'nowpayments', ?, 10000000,
                 'usdttrc20', '10', 'manual_resolved', 0)`,
      )
      .run(`pay-rejected-${suffix}`, `np-rejected-${suffix}`);
    db.raw
      .prepare(
        `INSERT INTO payment_review_cases
         (id, order_id, provider_payment_id, reason, status, evidence_json,
          resolution_action, resolution_request_hash, resolution_note,
          resolution_reference, resolved_at)
         VALUES (?, ?, ?, 'provider_data_mismatch', 'resolved', '{}',
                 'reject', ?, 'Provider reported zero funds.',
                 ?, ${resolvedAt})`,
      )
      .run(
        `prv_rejected_${suffix}_case`,
        `pay-rejected-${suffix}`,
        `np-rejected-${suffix}`,
        `rejected-${suffix}-hash`,
        `nowpayments:np-rejected-${suffix}:failed`,
      );
  }

  const env = baseEnv({
    DB: db,
    NOWPAYMENTS_API_KEY: "provider-test-key",
    RECONCILIATION_SECRET: "rejected-poll-reconcile-secret-32-minimum",
  });
  const providerReads = [];
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const paymentId = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    ).pathname.split("/").at(-1);
    providerReads.push(paymentId);
    if (paymentId !== "np-rejected-funded" &&
        paymentId !== "np-rejected-zero") {
      throw new Error(`unexpected rejected payment poll: ${paymentId}`);
    }
    const funded = paymentId === "np-rejected-funded";
    return Response.json({
      payment_id: paymentId,
      payment_status: funded ? "finished" : "failed",
      order_id: funded ? "pay-rejected-funded" : "pay-rejected-zero",
      price_amount: 10,
      price_currency: "usd",
      pay_amount: "10",
      actually_paid: funded ? "1" : "0",
      pay_currency: "usdttrc20",
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
          authorization:
            "Bearer rejected-poll-reconcile-secret-32-minimum",
        },
      },
      env,
    );
  const [first, concurrent] = await Promise.all([
    reconcile(),
    reconcile(),
  ]);
  assert.equal(first.status, 200);
  assert.equal(concurrent.status, 200);
  const firstResult = await first.json();
  const concurrentResult = await concurrent.json();
  assert.equal(
    firstResult.payments.rejectedPolled +
      concurrentResult.payments.rejectedPolled,
    2,
  );
  assert.deepEqual(
    [...providerReads].sort(),
    ["np-rejected-funded", "np-rejected-zero"],
  );

  const fundedReview = db.raw
    .prepare(
      `SELECT status, reason, resolution_action
       FROM payment_review_cases
       WHERE id = 'prv_rejected_funded_case'`,
    )
    .get();
  assert.equal(fundedReview.status, "open");
  assert.equal(fundedReview.reason, "funds_after_manual_rejection");
  assert.equal(fundedReview.resolution_action, null);
  const zeroReview = db.raw
    .prepare(
      `SELECT status, resolution_action
       FROM payment_review_cases
       WHERE id = 'prv_rejected_zero_case'`,
    )
    .get();
  assert.equal(zeroReview.status, "resolved");
  assert.equal(zeroReview.resolution_action, "reject");
  assert.ok(
    db.raw
      .prepare(
        `SELECT 1 AS present
         FROM operation_heartbeats
         WHERE name = 'payment-rejected-status:np-rejected-zero'`,
      )
      .get()?.present,
  );

  const replay = await reconcile();
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).payments.rejectedPolled, 0);
  assert.equal(providerReads.length, 2);
});

test("does not infer a parent rejection from a child review sharing its order", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-parent-child', 'parent-child@example.com',
               'Parent Child')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, provider_payment_id, amount_usd_micros,
        pay_currency, pay_amount, status, credited_usd_micros)
       VALUES ('pay-parent-child', 'usr-parent-child', 'nowpayments',
               'np-parent-safe', 10000000, 'usdttrc20', '10',
               'manual_resolved', 10000000)`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id)
       VALUES ('led-parent-safe', 'usr-parent-child', 'payment_credit',
               10000000, 'nowpayments:np-parent-safe:credit')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_review_cases
       (id, order_id, provider_payment_id, parent_payment_id, reason,
        status, evidence_json, resolution_action, resolution_request_hash,
        resolution_note, resolution_reference, resolved_at)
       VALUES ('prv_child_rejected_case', 'pay-parent-child',
               'np-child-rejected', 'np-parent-safe', 'repeated_deposit',
               'resolved', '{}', 'reject', 'child-rejected-hash',
               'Child payment had no funds.',
               'nowpayments:np-child-rejected:failed', CURRENT_TIMESTAMP)`,
    )
    .run();

  const env = baseEnv({
    DB: db,
    NOWPAYMENTS_API_KEY: "provider-test-key",
    RECONCILIATION_SECRET: "parent-child-reconcile-secret-32-minimum",
  });
  const providerReads = [];
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const paymentId = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    ).pathname.split("/").at(-1);
    providerReads.push(paymentId);
    assert.equal(paymentId, "np-parent-safe");
    return Response.json({
      payment_id: "np-parent-safe",
      payment_status: "finished",
      order_id: "pay-parent-child",
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

  const reconciliation = await fetchWorker(
    "/api/admin/reconcile",
    {
      method: "POST",
      headers: {
        authorization:
          "Bearer parent-child-reconcile-secret-32-minimum",
      },
    },
    env,
  );
  assert.equal(reconciliation.status, 200);
  const result = await reconciliation.json();
  assert.equal(result.payments.creditedPolled, 1);
  assert.equal(result.payments.rejectedPolled, 0);
  assert.deepEqual(providerReads, ["np-parent-safe"]);
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM payment_review_cases
         WHERE provider_payment_id = 'np-parent-safe'`,
      )
      .get().count,
    0,
  );
  const childReview = db.raw
    .prepare(
      `SELECT status, resolution_action
       FROM payment_review_cases
       WHERE id = 'prv_child_rejected_case'`,
    )
    .get();
  assert.equal(childReview.status, "resolved");
  assert.equal(childReview.resolution_action, "reject");
});

test("polls and reverses a refunded parent while its child review is still open", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-open-child-refund', 'open-child-refund@example.com',
               'Open Child Refund')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, provider_payment_id, amount_usd_micros,
        pay_currency, pay_amount, status, credited_usd_micros,
        created_at, updated_at)
       VALUES ('pay-open-child-refund', 'usr-open-child-refund',
               'nowpayments', 'np-open-child-parent', 10000000,
               'usdttrc20', '10', 'manual_review', 10000000,
               datetime('now', '-181 days'),
               datetime('now', '-181 days'))`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id)
       VALUES ('led-open-child-parent', 'usr-open-child-refund',
               'payment_credit', 10000000,
               'nowpayments:np-open-child-parent:credit')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_review_cases
       (id, order_id, provider_payment_id, parent_payment_id, reason,
        status, actually_paid, pay_currency, evidence_json)
       VALUES ('prv_open_child_refund_case', 'pay-open-child-refund',
               'np-open-child-payment', 'np-open-child-parent',
               'repeated_deposit', 'open', '10', 'usdttrc20', '{}')`,
    )
    .run();

  const env = baseEnv({
    DB: db,
    NOWPAYMENTS_API_KEY: "provider-test-key",
    RECONCILIATION_SECRET:
      "open-child-refund-reconcile-secret-32-minimum",
  });
  const providerReads = [];
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const paymentId = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    ).pathname.split("/").at(-1);
    providerReads.push(paymentId);
    assert.equal(paymentId, "np-open-child-parent");
    return Response.json({
      payment_id: paymentId,
      payment_status: "refunded",
      order_id: "pay-open-child-refund",
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

  const reconciliation = await fetchWorker(
    "/api/admin/reconcile",
    {
      method: "POST",
      headers: {
        authorization:
          "Bearer open-child-refund-reconcile-secret-32-minimum",
      },
    },
    env,
  );
  assert.equal(reconciliation.status, 200);
  assert.equal((await reconciliation.json()).payments.creditedPolled, 1);
  assert.deepEqual(providerReads, ["np-open-child-parent"]);
  assert.equal(
    db.raw
      .prepare(
        `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
         FROM balance_ledger
         WHERE user_id = 'usr-open-child-refund'`,
      )
      .get().balance,
    0,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT status, credited_usd_micros
         FROM payment_orders
         WHERE id = 'pay-open-child-refund'`,
      )
      .get().status,
    "refunded",
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT credited_usd_micros
         FROM payment_orders
         WHERE id = 'pay-open-child-refund'`,
      )
      .get().credited_usd_micros,
    0,
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT status
         FROM payment_review_cases
         WHERE id = 'prv_open_child_refund_case'`,
      )
      .get().status,
    "open",
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM balance_ledger
         WHERE reference_id =
               'nowpayments:np-open-child-parent:reversal'`,
      )
      .get().count,
    1,
  );
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
    UPSTREAM_API_KEY: "upstream-key",
    CATALOG_SYNC_SECRET: catalogSecret,
  });
  let youtubeTags = ["YouTube-Web-API"];
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
              tags: youtubeTags,
              operationId: "fetch_youtube_video",
              parameters: [],
            },
          },
        },
      });
    }
    assert.equal(
      url.href,
      `${TEST_UPSTREAM_ORIGIN}/api/v1/control/catalog`,
    );
    return Response.json({
      data: [
        {
          endpoint_uri: "/api/v1/youtube/web/fetch_video",
          endpoint_cost: 0.001,
          allow_free_credit: 1,
          allow_discount: 1,
          rate_limit: "10/second",
          endpoint_type: "self-operated",
          endpoint_owner: "Synthetic Provider",
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
  assert.equal(upstreamReads, 2);
  assert.equal(
    db.raw
      .prepare("SELECT COUNT(*) AS count FROM catalog_sync_locks")
      .get().count,
    0,
  );

  const removed = db.raw
    .prepare(
      `SELECT enabled, source_updated_at, sync_generation, revision
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
        expectedRevision: removed.revision,
      }),
    },
    env,
  );
  assert.equal(staleEnable.status, 409);
  assert.equal(
    (await staleEnable.json()).error.code,
    "endpoint_not_in_latest_catalog",
  );

  const currentRevision = db.raw
    .prepare(
      `SELECT revision FROM endpoint_catalog
       WHERE path = '/v1/youtube/web/fetch_video'`,
    )
    .get().revision;
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
        expectedRevision: currentRevision,
      }),
    },
    env,
  );
  assert.equal(enableCurrent.status, 200);
  assert.equal((await enableCurrent.json()).revision, currentRevision + 1);

  const staleDisable = await fetchWorker(
    "/api/admin/catalog",
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${catalogSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        path: "/v1/youtube/web/fetch_video",
        enabled: false,
        readOnly: true,
        customerPriceUsdMicros: 2000,
        expectedRevision: currentRevision,
      }),
    },
    env,
  );
  assert.equal(staleDisable.status, 409);
  assert.equal(
    (await staleDisable.json()).error.code,
    "catalog_update_conflict",
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT enabled FROM endpoint_catalog
         WHERE path = '/v1/youtube/web/fetch_video'`,
      )
      .get().enabled,
    1,
  );

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
  assert.deepEqual(publicData.endpoints[0].categories, [
    "content",
    "web",
  ]);

  youtubeTags = ["YouTube-Web-V2-API"];
  const taxonomyChanged = await sync();
  assert.equal(taxonomyChanged.status, 200);
  const taxonomyChangedEndpoint = db.raw
    .prepare(
      `SELECT enabled, read_only, reviewed_at, revision, tags_json
       FROM endpoint_catalog
       WHERE path = '/v1/youtube/web/fetch_video'`,
    )
    .get();
  assert.deepEqual({ ...taxonomyChangedEndpoint }, {
    enabled: 0,
    read_only: 0,
    reviewed_at: null,
    revision: currentRevision + 2,
    tags_json: '["YouTube-Web-V2-API"]',
  });
});

test("normalizes a custom API prefix and anonymously publishes an optional-auth catalog without an active managed key", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);

  const adminSecret = "custom-source-admin-secret-32-minimum";
  const catalogSecret = "custom-source-catalog-secret-32-minimum";
  const env = baseEnv({
    DB: db,
    ADMIN_MASTER_SECRET: adminSecret,
    CATALOG_SYNC_SECRET: catalogSecret,
  });
  const configured = await fetchWorker(
    "/api/admin/upstream-config",
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${adminSecret}`,
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        expectedVersion: 1,
        enabled: true,
        sourceOrigin: TEST_UPSTREAM_ORIGIN,
        apiPathPrefix: "/gateway/api/",
        openApiPath: "/gateway/openapi.json/",
        catalogPath: "/gateway/api/v1/control/catalog/",
        credentialPath: "/gateway/api/v1/control/credential/",
        catalogAuthMode: "optional",
        publicExcludedPrefixes: [],
      }),
    },
    env,
  );
  assert.equal(configured.status, 200, await configured.clone().text());
  const configuredData = await configured.json();
  assert.equal(configuredData.config.version, 2);
  assert.equal(configuredData.config.apiPathPrefix, "/gateway/api");
  assert.equal(configuredData.config.openApiPath, "/gateway/openapi.json");
  assert.equal(
    configuredData.config.catalogPath,
    "/gateway/api/v1/control/catalog",
  );
  assert.deepEqual(
    configuredData.config.publicExcludedPrefixes,
    ["/v1/control/"],
  );

  db.raw
    .prepare(
      `UPDATE upstream_credential_state
       SET managed_enabled = 1, active_credential_id = NULL
       WHERE provider = 'primary'`,
    )
    .run();

  const upstreamRequests = [];
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    upstreamRequests.push({
      path: url.pathname,
      authorization: new Headers(init?.headers).get("authorization"),
      userAgent: new Headers(init?.headers).get("user-agent"),
      redirect: init?.redirect,
    });
    if (url.pathname === "/gateway/api/v1/control/catalog") {
      return Response.json({
        code: 200,
        data: [
          {
            endpoint_uri:
              "/gateway/api/v1/example/web/fetch_profile",
            endpoint_cost: 0.001,
          },
        ],
      });
    }
    if (url.pathname === "/gateway/openapi.json") {
      return Response.json({
        openapi: "3.1.0",
        info: { version: "custom-prefix-test" },
        paths: {
          "/gateway/api/v1/example/web/fetch_profile": {
            get: {
              summary: "Fetch a public profile",
              parameters: [],
            },
          },
        },
      });
    }
    throw new Error(`Unexpected upstream URL ${url.href}`);
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const synced = await fetchWorker(
    "/api/admin/catalog/sync",
    {
      method: "POST",
      headers: { authorization: `Bearer ${catalogSecret}` },
    },
    env,
  );
  assert.equal(synced.status, 200, await synced.clone().text());
  assert.equal((await synced.json()).synced, 1);
  assert.deepEqual(upstreamRequests, [
    {
      path: "/gateway/api/v1/control/catalog",
      authorization: null,
      userAgent: "RelayBase-API/1.0",
      redirect: "manual",
    },
    {
      path: "/gateway/openapi.json",
      authorization: null,
      userAgent: "RelayBase-API/1.0",
      redirect: "manual",
    },
  ]);

  const normalizedEndpoint = db.raw
    .prepare(
      `SELECT path, platform
       FROM endpoint_catalog
       WHERE path = '/v1/example/web/fetch_profile'`,
    )
    .get();
  assert.deepEqual({ ...normalizedEndpoint }, {
    path: "/v1/example/web/fetch_profile",
    platform: "example",
  });
  const syncState = db.raw
    .prepare(
      `SELECT credential_source, credential_id,
              source_config_version, source_config_hash
       FROM catalog_sync_state
       WHERE id = 1`,
    )
    .get();
  assert.equal(syncState.credential_source, null);
  assert.equal(syncState.credential_id, null);
  assert.equal(syncState.source_config_version, 2);
  assert.equal(
    syncState.source_config_hash,
    db.raw
      .prepare(
        `SELECT config_hash
         FROM upstream_source_config
         WHERE id = 1`,
      )
      .get().config_hash,
  );

  db.raw
    .prepare(
      `UPDATE endpoint_catalog
       SET enabled = 1, read_only = 1, reviewed_at = CURRENT_TIMESTAMP
       WHERE path = '/v1/example/web/fetch_profile'`,
    )
    .run();
  const published = await fetchWorker("/api/catalog", {}, env);
  assert.equal(published.status, 200);
  const publishedData = await published.json();
  assert.equal(publishedData.catalog.complete, true);
  assert.equal(publishedData.count, 1);
  assert.equal(
    publishedData.endpoints[0].path,
    "/v1/example/web/fetch_profile",
  );

  db.raw
    .prepare(
      `UPDATE catalog_sync_state
       SET source_config_hash = ?
       WHERE id = 1`,
    )
    .run("0".repeat(64));
  const invalidStateCatalog = await fetchWorker("/api/catalog", {}, env);
  assert.equal(invalidStateCatalog.status, 200);
  const invalidStateData = await invalidStateCatalog.json();
  assert.equal(invalidStateData.catalog.complete, false);
  assert.equal(invalidStateData.catalog.revision, "cat_pending");
  assert.deepEqual(invalidStateData.endpoints, []);
  assert.equal(invalidStateData.total, 0);
});

test("syncs the real Synthetic Provider price shape, verifies zero cost and deduplicates identical rows", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);

  const catalogSecret = "catalog-real-shape-secret-32-minimum";
  const env = baseEnv({
    DB: db,
    UPSTREAM_API_KEY: "upstream-key",
    CATALOG_SYNC_SECRET: catalogSecret,
  });
  const syntheticOpenApi = {
    openapi: "3.1.0",
    info: { title: "Synthetic Provider API", version: "test-5.3.2" },
    paths: {
      "/api/v1/ios_shortcut/shortcut": {
        get: {
          summary: "iOS shortcut metadata",
          tags: ["iOS-Shortcut"],
          operationId: "fetch_ios_shortcut",
          parameters: [],
        },
      },
      "/api/v1/youtube/web/fetch_video": {
        get: {
          summary: "Fetch a YouTube video",
          tags: ["YouTube-Web-API"],
          operationId: "fetch_youtube_video",
          parameters: [],
        },
      },
      "/api/v1/reddit/web/fetch_new": {
        get: {
          summary: "OpenAPI-only endpoint",
          parameters: [],
        },
      },
    },
  };
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.pathname === "/openapi.json") {
      return Response.json(syntheticOpenApi);
    }
    assert.equal(
      url.href,
      `${TEST_UPSTREAM_ORIGIN}/api/v1/control/catalog`,
    );
    const youtubePrice = {
      endpoint_uri: "/api/v1/youtube/web/fetch_video",
      endpoint_cost: 0.001,
      allow_free_credit: 1,
      allow_discount: 1,
      rate_limit: "10/second",
      endpoint_type: "self-operated",
      endpoint_owner: "Synthetic Provider",
    };
    return Response.json({
      code: 200,
      data: [
        {
          endpoint_uri: "/api/v1/ios_shortcut/shortcut",
          endpoint_cost: 0,
          allow_free_credit: 0,
          allow_discount: 0,
          rate_limit: "10/second",
          endpoint_type: "self-operated",
          endpoint_owner: "Synthetic Provider",
        },
        youtubePrice,
        { ...youtubePrice },
        {
          endpoint_uri: "/api/v1/legacy/web/fetch_price_only",
          endpoint_cost: 0.002,
          rate_limit: "5/second",
          endpoint_type: "self-operated",
          endpoint_owner: "Synthetic Provider",
        },
      ],
    });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const response = await fetchWorker(
    "/api/admin/catalog/sync",
    {
      method: "POST",
      headers: { authorization: `Bearer ${catalogSecret}` },
    },
    env,
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.synced, 3);
  assert.equal(result.pendingDocumentation, 1);
  assert.equal(result.openApiVersion, "test-5.3.2");
  assert.equal(result.openApiOperations, 3);
  assert.equal(result.rawPriceRows, 4);
  assert.equal(result.normalizedPrices, 3);
  assert.equal(result.openApiPriceMapped, 2);
  assert.equal(result.priceOnly, 1);
  assert.equal(result.openApiOnly, 1);
  assert.equal(result.scopeExcluded, 0);
  assert.equal(result.priced, 2);
  assert.equal(result.positivePrice, 1);
  assert.equal(result.zeroPrice, 1);
  assert.equal(result.awaitingPrice, 1);
  assert.match(result.openApiSnapshotHash, /^[a-f0-9]{64}$/);
  assert.match(result.priceSnapshotHash, /^[a-f0-9]{64}$/);

  const marketplace = await fetchWorker(
    "/api/marketplace?q=fetch_price_only",
    {},
    env,
  );
  assert.equal(marketplace.status, 200);
  const marketplaceData = await marketplace.json();
  assert.equal(marketplaceData.catalog.complete, true);
  assert.equal(marketplaceData.catalog.serviceCount, 4);
  assert.equal(marketplaceData.total, 1);
  assert.deepEqual(marketplaceData.endpoints[0], {
    id: marketplaceData.endpoints[0].id,
    path: "/v1/legacy/web/fetch_price_only",
    platform: "legacy",
    dataType: "other",
    method: null,
    surface: "web",
    availability: "pending",
    summary: "Fetch Price Only",
    pricing: {
      amountUsdMicros: 2600,
      currency: "USD",
      unit: "request",
      verified: true,
    },
    rateLimitRps: 5,
    documentationStatus: "pending",
  });
  assert.doesNotMatch(
    JSON.stringify(marketplaceData),
    /source\.example|\/api\/v1\/control\//i,
  );

  const pendingDocumentation = await fetchWorker(
    "/api/marketplace/detail?path=" +
      encodeURIComponent("/v1/legacy/web/fetch_price_only"),
    {},
    env,
  );
  assert.equal(pendingDocumentation.status, 200);
  const pendingDocumentationData = await pendingDocumentation.json();
  assert.equal(
    pendingDocumentationData.endpoint.documentationStatus,
    "pending",
  );
  assert.equal(pendingDocumentationData.endpoint.method, null);
  assert.equal(pendingDocumentationData.endpoint.input.parameters, null);
  assert.equal(pendingDocumentationData.endpoint.input.requestBody, null);
  assert.deepEqual(pendingDocumentationData.examples, {
    curl: "",
    javascript: "",
    python: "",
  });

  const pendingAdmin = await fetchWorker(
    "/api/admin/catalog/pending?limit=500&offset=0",
    {
      headers: { authorization: `Bearer ${catalogSecret}` },
    },
    env,
  );
  assert.equal(pendingAdmin.status, 200);
  const pendingAdminData = await pendingAdmin.json();
  assert.equal(pendingAdminData.total, 1);
  assert.equal(pendingAdminData.endpoints[0].callable, false);
  assert.equal(
    pendingAdminData.endpoints[0].documentationStatus,
    "pending",
  );
  const pendingReprice = await fetchWorker(
    "/api/admin/catalog/pending",
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${catalogSecret}`,
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        path: "/v1/legacy/web/fetch_price_only",
        customerPriceUsdMicros: 3_000,
        expectedUpdatedAt: pendingAdminData.endpoints[0].updatedAt,
      }),
    },
    env,
  );
  assert.equal(pendingReprice.status, 200);
  assert.equal(
    (await pendingReprice.json()).customerPriceUsdMicros,
    3_000,
  );

  const rows = db.raw
    .prepare(
      `SELECT path, upstream_price_usd_micros, price_verified,
              enabled, read_only, safety_classification,
              safety_policy_version, revision, data_type, tags_json,
              surface, operation_id
       FROM endpoint_catalog
       WHERE path IN (
         '/v1/ios_shortcut/shortcut',
         '/v1/youtube/web/fetch_video'
       )
       ORDER BY path`,
    )
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    {
      path: "/v1/ios_shortcut/shortcut",
      upstream_price_usd_micros: 0,
      price_verified: 1,
      enabled: 0,
      read_only: 0,
      safety_classification: "safe_data_read",
      safety_policy_version: 1,
      revision: 0,
      data_type: "system",
      tags_json: '["iOS-Shortcut"]',
      surface: "app",
      operation_id: "fetch_ios_shortcut",
    },
    {
      path: "/v1/youtube/web/fetch_video",
      upstream_price_usd_micros: 1000,
      price_verified: 1,
      enabled: 0,
      read_only: 0,
      safety_classification: "safe_data_read",
      safety_policy_version: 1,
      revision: 0,
      data_type: "content",
      tags_json: '["YouTube-Web-API"]',
      surface: "web",
      operation_id: "fetch_youtube_video",
    },
  ]);
  const syncState = db.raw
    .prepare(
      `SELECT openapi_version, openapi_operation_count,
              raw_price_row_count, normalized_price_count,
              openapi_price_mapped_count, price_only_count,
              openapi_only_count, scope_excluded_count,
              matched_price_count, positive_price_count,
              zero_price_count, awaiting_price_count,
              openapi_snapshot_hash, price_snapshot_hash
       FROM catalog_sync_state
       WHERE id = 1`,
    )
    .get();
  assert.deepEqual(
    {
      ...syncState,
      openapi_snapshot_hash: "64-hex",
      price_snapshot_hash: "64-hex",
    },
    {
      openapi_version: "test-5.3.2",
      openapi_operation_count: 3,
      raw_price_row_count: 4,
      normalized_price_count: 3,
      openapi_price_mapped_count: 2,
      price_only_count: 1,
      openapi_only_count: 1,
      scope_excluded_count: 0,
      matched_price_count: 2,
      positive_price_count: 1,
      zero_price_count: 1,
      awaiting_price_count: 1,
      openapi_snapshot_hash: "64-hex",
      price_snapshot_hash: "64-hex",
    },
  );
  assert.match(syncState.openapi_snapshot_hash, /^[a-f0-9]{64}$/);
  assert.match(syncState.price_snapshot_hash, /^[a-f0-9]{64}$/);

  const adminCatalog = await fetchWorker(
    "/api/admin/catalog?dataType=content&tag=youtube-web-api" +
      "&surface=web&limit=10&offset=0",
    {
      headers: { authorization: `Bearer ${catalogSecret}` },
    },
    env,
  );
  assert.equal(adminCatalog.status, 200);
  const adminCatalogData = await adminCatalog.json();
  assert.equal(adminCatalogData.count, 1);
  assert.deepEqual(
    {
      path: adminCatalogData.endpoints[0].path,
      dataType: adminCatalogData.endpoints[0].dataType,
      tags: adminCatalogData.endpoints[0].tags,
      surface: adminCatalogData.endpoints[0].surface,
      operationId: adminCatalogData.endpoints[0].operationId,
    },
    {
      path: "/v1/youtube/web/fetch_video",
      dataType: "content",
      tags: ["YouTube-Web-API"],
      surface: "web",
      operationId: "fetch_youtube_video",
    },
  );
  assert.equal(adminCatalogData.sync.coverage.openApiOperations, 3);
  assert.equal(adminCatalogData.sync.coverage.rawPriceRows, 4);
  assert.equal(adminCatalogData.sync.coverage.normalizedPrices, 3);
  assert.equal(adminCatalogData.sync.coverage.openApiPriceMapped, 2);
  assert.equal(adminCatalogData.sync.coverage.priceOnly, 1);
  assert.equal(adminCatalogData.sync.coverage.openApiOnly, 1);
  assert.equal(adminCatalogData.sync.coverage.scopeExcluded, 0);
  assert.equal(adminCatalogData.sync.coverage.matchedPrices, 2);
  assert.equal(adminCatalogData.sync.coverage.positivePrices, 1);
  assert.equal(adminCatalogData.sync.coverage.zeroPrices, 1);
  assert.equal(adminCatalogData.sync.coverage.awaitingPrice, 1);

  const partialTag = await fetchWorker(
    "/api/admin/catalog?tag=YouTube-Web&limit=10",
    {
      headers: { authorization: `Bearer ${catalogSecret}` },
    },
    env,
  );
  assert.equal(partialTag.status, 200);
  assert.equal((await partialTag.json()).count, 0);

  const duplicateFilter = await fetchWorker(
    "/api/admin/catalog?dataType=content&dataType=other",
    {
      headers: { authorization: `Bearer ${catalogSecret}` },
    },
    env,
  );
  assert.equal(duplicateFilter.status, 400);
  assert.equal(
    (await duplicateFilter.json()).error.code,
    "invalid_catalog_filter",
  );
  for (const query of [
    "dataType=not_a_real_type",
    "surface=desktop",
  ]) {
    const invalidFilter = await fetchWorker(
      `/api/admin/catalog?${query}`,
      {
        headers: { authorization: `Bearer ${catalogSecret}` },
      },
      env,
    );
    assert.equal(invalidFilter.status, 400, query);
    assert.equal(
      (await invalidFilter.json()).error.code,
      "invalid_catalog_filter",
      query,
    );
  }
});

test("classifies Synthetic Provider data reads without trusting mutation or credential inputs", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const catalogSecret = "catalog-safety-secret-32-characters-minimum";
  const env = baseEnv({
    DB: db,
    UPSTREAM_API_KEY: "upstream-key",
    CATALOG_SYNC_SECRET: catalogSecret,
  });
  const nativeFetch = globalThis.fetch;
  let proxyReads = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.pathname === "/openapi.json") {
      return Response.json({
        openapi: "3.1.0",
        info: { title: "Synthetic Provider API", version: "safety-test" },
        paths: {
          "/api/v1/douyin/creator/fetch_creator_activity_list": {
            get: {
              summary: "Fetch creator activity list",
              parameters: [
                {
                  name: "creator_id",
                  in: "query",
                  schema: { type: "string" },
                },
              ],
            },
          },
          "/api/v1/instagram/v2/fetch_post_comments": {
            get: {
              summary: "Fetch public post comments",
              parameters: [],
            },
          },
          "/api/v1/example/web/fetch_public_profile": {
            parameters: [
              {
                name: "headers[Authorization]",
                in: "query",
                schema: { type: "string" },
              },
            ],
            get: {
              summary: "Fetch public profile",
              parameters: [],
            },
          },
          "/api/v1/example/web/fetch_then_repost": {
            get: {
              summary: "Fetch and then repost an item",
              parameters: [],
            },
          },
          "/api/v1/tiktok/creator/get_account_insights_overview": {
            post: {
              summary: "Get account insights",
              requestBody: {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        cookie: { type: "string" },
                        proxyUrl: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
    }
    if (url.pathname === "/api/v1/control/catalog") {
      return Response.json({
        data: [
          {
            endpoint_uri:
              "/api/v1/douyin/creator/fetch_creator_activity_list",
            endpoint_cost: 0.001,
          },
          {
            endpoint_uri: "/api/v1/instagram/v2/fetch_post_comments",
            endpoint_cost: 0.001,
          },
          {
            endpoint_uri: "/api/v1/example/web/fetch_public_profile",
            endpoint_cost: 0.001,
          },
          {
            endpoint_uri: "/api/v1/example/web/fetch_then_repost",
            endpoint_cost: 0.001,
          },
          {
            endpoint_uri:
              "/api/v1/tiktok/creator/get_account_insights_overview",
            endpoint_cost: 0.002,
          },
        ],
      });
    }
    proxyReads += 1;
    return Response.json({ ok: true });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const synced = await fetchWorker(
    "/api/admin/catalog/sync",
    {
      method: "POST",
      headers: { authorization: `Bearer ${catalogSecret}` },
    },
    env,
  );
  assert.equal(synced.status, 200);
  const rows = db.raw
    .prepare(
      `SELECT path, enabled, read_only, safety_classification,
              safety_reasons_json
       FROM endpoint_catalog
       WHERE sync_generation = (
         SELECT last_success_generation FROM catalog_sync_state WHERE id = 1
       )
       ORDER BY path`,
    )
    .all()
    .map((row) => ({ ...row }));
  assert.equal(rows.length, 5);
  assert.deepEqual(
    rows.map((row) => ({
      path: row.path,
      enabled: row.enabled,
      read_only: row.read_only,
      safety_classification: row.safety_classification,
    })),
    [
      {
        path: "/v1/douyin/creator/fetch_creator_activity_list",
        enabled: 0,
        read_only: 0,
        safety_classification: "safe_data_read",
      },
      {
        path: "/v1/example/web/fetch_public_profile",
        enabled: 0,
        read_only: 0,
        safety_classification: "prohibited",
      },
      {
        path: "/v1/example/web/fetch_then_repost",
        enabled: 0,
        read_only: 0,
        safety_classification: "prohibited",
      },
      {
        path: "/v1/instagram/v2/fetch_post_comments",
        enabled: 0,
        read_only: 0,
        safety_classification: "safe_data_read",
      },
      {
        path: "/v1/tiktok/creator/get_account_insights_overview",
        enabled: 0,
        read_only: 0,
        safety_classification: "prohibited",
      },
    ],
  );
  assert.match(
    rows.find(
      (row) =>
        row.path ===
        "/v1/tiktok/creator/get_account_insights_overview",
    ).safety_reasons_json,
    /sensitive_input:(cookie|proxy)/,
  );
  assert.match(
    rows.find(
      (row) => row.path === "/v1/example/web/fetch_public_profile",
    ).safety_reasons_json,
    /sensitive_input:headers_authorization/,
  );
  assert.match(
    rows.find(
      (row) => row.path === "/v1/example/web/fetch_then_repost",
    ).safety_reasons_json,
    /chained_write_action:repost/,
  );

  const generation = db.raw
    .prepare(
      `SELECT last_success_generation AS generation
       FROM catalog_sync_state WHERE id = 1`,
    )
    .get().generation;
  db.raw
    .prepare(
      `UPDATE endpoint_catalog
       SET enabled = 1, read_only = 1, reviewed_at = CURRENT_TIMESTAMP
       WHERE path IN (
         '/v1/douyin/creator/fetch_creator_activity_list',
         '/v1/tiktok/creator/get_account_insights_overview'
       )`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO operation_heartbeats
       (name, last_success_at, details_json)
       VALUES ('reconciliation', CURRENT_TIMESTAMP, '{}')`,
    )
    .run();
  const liveEnv = {
    ...env,
    RESELLER_AUTHORIZED: "true",
    LEGAL_REVIEW_CONFIRMED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
    RECONCILIATION_SECRET: "safety-reconcile-secret-32-minimum",
  };
  assert.match(generation, /^sync_/);
  const prohibited = await fetchWorker(
    "/v1/tiktok/creator/get_account_insights_overview",
    {
      method: "POST",
      headers: {
        authorization: "Bearer customer-key-does-not-matter",
        "content-type": "application/json",
        "idempotency-key": "safety-proxy-request-0001",
      },
      body: "{}",
    },
    liveEnv,
  );
  assert.equal(prohibited.status, 403);
  assert.equal((await prohibited.json()).error.code, "unsafe_endpoint");
  const unsafeInput = await fetchWorker(
    "/v1/douyin/creator/fetch_creator_activity_list?accessToken=customer-cookie",
    {
      headers: {
        authorization: "Bearer customer-key-does-not-matter",
      },
    },
    liveEnv,
  );
  assert.equal(unsafeInput.status, 403);
  assert.equal(
    (await unsafeInput.json()).error.code,
    "unsafe_proxy_input",
  );
  assert.equal(proxyReads, 0);
});

test("resolves bounded local OpenAPI refs before classifying inputs", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const catalogSecret = "catalog-ref-secret-32-characters-minimum";
  const env = baseEnv({
    DB: db,
    UPSTREAM_API_KEY: "upstream-key",
    CATALOG_SYNC_SECRET: catalogSecret,
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.pathname === "/openapi.json") {
      return Response.json({
        openapi: "3.1.0",
        info: { title: "Synthetic Provider API", version: "ref-test" },
        components: {
          schemas: {
            SafeQuery: {
              type: "object",
              required: ["video_id"],
              properties: {
                video_id: {
                  type: "string",
                  description:
                    'deviceId = "runtime-device-fixture-not-a-secret"',
                },
                cursor: { type: "integer" },
              },
            },
            SensitiveQuery: {
              type: "object",
              properties: {
                "x-api-key": {
                  type: "string",
                  example: "sk-this-value-must-never-be-persisted",
                },
                public_payload: {
                  type: "object",
                  example: {
                    csrf: "runtime-csrf-fixture-not-a-secret",
                  },
                  examples: [
                    {
                      cookie:
                        "runtime-plural-cookie-fixture-not-a-secret",
                    },
                    {
                      summary: {
                        note:
                          "runtime-invalid-summary-fixture-not-a-secret",
                      },
                      description: [
                        "runtime-invalid-description-fixture-not-a-secret",
                      ],
                      externalValue: {
                        href:
                          "runtime-invalid-external-fixture-not-a-secret",
                      },
                      value: {
                        credential:
                          "runtime-plural-credential-fixture-not-a-secret",
                      },
                    },
                  ],
                },
              },
            },
            RecursiveA: {
              type: "object",
              properties: {
                nested: { $ref: "#/components/schemas/RecursiveB" },
              },
            },
            RecursiveB: {
              type: "object",
              properties: {
                nested: { $ref: "#/components/schemas/RecursiveA" },
              },
            },
            LargeField: {
              type: "string",
              description: "x".repeat(12_000),
            },
            LargeBody: {
              type: "object",
              properties: Object.fromEntries(
                Array.from({ length: 8 }, (_, index) => [
                  `field_${index}`,
                  { $ref: "#/components/schemas/LargeField" },
                ]),
              ),
            },
          },
          requestBodies: {
            SafeBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SafeQuery" },
                },
              },
            },
          },
        },
        paths: {
          "/api/v1/youtube/web/fetch_video_details": {
            post: {
              summary:
                "Fetch video details with Bearer runtime-bearer-fixture-value",
              description:
                "Read-only video metadata.\n" +
                "# Example\n" +
                "```json\n" +
                '{"cookies":{"sid_guard":"runtime-cookie-fixture-not-a-secret"}}\n' +
                "```\n" +
                "# Notes\n" +
                "Returns public metadata only.",
              operationId: "fetch_video_details",
              requestBody: {
                $ref: "#/components/requestBodies/SafeBody",
              },
            },
          },
          "/api/v1/instagram/v3/fetch_private_profile": {
            post: {
              summary: "Fetch private profile",
              operationId: "fetch_private_profile",
              requestBody: {
                content: {
                  "application/json": {
                    schema: {
                      $ref: "#/components/schemas/SensitiveQuery",
                    },
                  },
                },
              },
            },
          },
          "/api/v1/reddit/app/fetch_recursive": {
            post: {
              summary: "Fetch recursive data",
              operationId: "fetch_recursive",
              requestBody: {
                content: {
                  "application/json": {
                    schema: {
                      $ref: "#/components/schemas/RecursiveA",
                    },
                  },
                },
              },
            },
          },
          "/api/v1/youtube/web/fetch_large_ref": {
            post: {
              summary: "Fetch data with repeated large refs",
              operationId: "fetch_large_ref",
              requestBody: {
                content: {
                  "application/json": {
                    schema: {
                      $ref: "#/components/schemas/LargeBody",
                    },
                  },
                },
              },
            },
          },
        },
      });
    }
    return Response.json({
      code: 200,
      data: [
        {
          endpoint_uri: "/api/v1/youtube/web/fetch_video_details",
          endpoint_cost: 0.001,
        },
        {
          endpoint_uri: "/api/v1/instagram/v3/fetch_private_profile",
          endpoint_cost: 0.001,
        },
        {
          endpoint_uri: "/api/v1/reddit/app/fetch_recursive",
          endpoint_cost: 0.001,
        },
        {
          endpoint_uri: "/api/v1/youtube/web/fetch_large_ref",
          endpoint_cost: 0.001,
        },
      ],
    });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const synced = await fetchWorker(
    "/api/admin/catalog/sync",
    {
      method: "POST",
      headers: { authorization: `Bearer ${catalogSecret}` },
    },
    env,
  );
  assert.equal(synced.status, 200, await synced.clone().text());
  const rows = db.raw
    .prepare(
      `SELECT path, summary, description, safety_classification,
              safety_reasons_json, parameter_schema_json
       FROM endpoint_catalog
       ORDER BY path`,
    )
    .all();
  const safe = rows.find(
    (row) => row.path === "/v1/youtube/web/fetch_video_details",
  );
  assert.equal(safe.safety_classification, "safe_data_read");
  assert.doesNotMatch(safe.parameter_schema_json, /"\$ref"/);
  assert.match(safe.parameter_schema_json, /"video_id"/);
  assert.match(safe.summary, /Bearer \[REDACTED\]/);
  assert.doesNotMatch(safe.summary, /runtime-bearer-fixture-value/);
  assert.match(safe.description, /上游原始示例已移除/);
  assert.match(safe.description, /Returns public metadata only/);
  assert.doesNotMatch(safe.description, /runtime-cookie-fixture/);
  assert.match(safe.parameter_schema_json, /YOUR_DEVICE_ID/);
  assert.doesNotMatch(
    safe.parameter_schema_json,
    /runtime-device-fixture/,
  );

  const sensitive = rows.find(
    (row) => row.path === "/v1/instagram/v3/fetch_private_profile",
  );
  assert.equal(sensitive.safety_classification, "prohibited");
  assert.match(sensitive.safety_reasons_json, /sensitive_input:x_api_key/);
  assert.match(sensitive.parameter_schema_json, /YOUR_X_API_KEY/);
  assert.match(sensitive.parameter_schema_json, /YOUR_CSRF/);
  assert.match(sensitive.parameter_schema_json, /YOUR_COOKIE/);
  assert.match(sensitive.parameter_schema_json, /YOUR_CREDENTIAL/);
  assert.equal(
    (
      sensitive.parameter_schema_json.match(
        /\[REDACTED_INVALID_EXAMPLE_METADATA\]/g,
      ) ?? []
    ).length,
    3,
  );
  assert.doesNotMatch(
    sensitive.parameter_schema_json,
    /(?:sk-this-value|runtime-(?:csrf|plural|invalid))/,
  );

  const safeDocumentation = await fetchWorker(
    "/api/marketplace/detail?path=" +
      encodeURIComponent("/v1/youtube/web/fetch_video_details") +
      "&method=POST",
    {},
    env,
  );
  assert.equal(safeDocumentation.status, 200);
  const safeDocumentationData = await safeDocumentation.json();
  const safeMedia =
    safeDocumentationData.endpoint.input.requestBody.content[
      "application/json"
    ];
  assert.equal(safeMedia.schema.type, "object");
  assert.deepEqual(
    new Set(Object.keys(safeMedia.schema.properties)),
    new Set(["video_id", "cursor"]),
  );
  assert.equal(safeMedia.schema.properties.video_id.type, "string");

  const sensitiveDocumentation = await fetchWorker(
    "/api/marketplace/detail?path=" +
      encodeURIComponent("/v1/instagram/v3/fetch_private_profile") +
      "&method=POST",
    {},
    env,
  );
  assert.equal(sensitiveDocumentation.status, 200);
  const sensitiveDocumentationData =
    await sensitiveDocumentation.json();
  const sensitiveMedia =
    sensitiveDocumentationData.endpoint.input.requestBody.content[
      "application/json"
    ];
  assert.equal(sensitiveMedia.schema.type, "object");
  assert.equal(
    Object.hasOwn(sensitiveMedia.schema.properties, "x-api-key"),
    false,
  );
  assert.deepEqual(
    sensitiveMedia.schema.properties.public_payload,
    { type: "object" },
  );
  assert.doesNotMatch(
    JSON.stringify(sensitiveDocumentationData),
    /(?:sk-this-value|runtime-(?:csrf|plural|invalid))/,
  );

  const recursive = rows.find(
    (row) => row.path === "/v1/reddit/app/fetch_recursive",
  );
  assert.equal(recursive.safety_classification, "ambiguous");
  assert.match(
    recursive.safety_reasons_json,
    /unresolved_schema_reference/,
  );
  assert.match(recursive.parameter_schema_json, /reference_cycle/);

  const oversized = rows.find(
    (row) => row.path === "/v1/youtube/web/fetch_large_ref",
  );
  assert.equal(oversized.safety_classification, "ambiguous");
  assert.match(
    oversized.safety_reasons_json,
    /unresolved_schema_reference/,
  );
  assert.match(oversized.parameter_schema_json, /byte_limit/);
  assert.ok(oversized.parameter_schema_json.length < 1_000);
});

test("rejects conflicting duplicate Synthetic Provider prices without replacing the live catalog", async (t) => {
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
  const catalogSecret = "catalog-conflict-secret-32-minimum";
  const env = baseEnv({
    DB: db,
    UPSTREAM_API_KEY: "upstream-key",
    CATALOG_SYNC_SECRET: catalogSecret,
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
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
    const priceRecord = {
      endpoint_uri: "/api/v1/youtube/web/fetch_video",
      allow_free_credit: 1,
      allow_discount: 1,
      rate_limit: "10/second",
      endpoint_type: "self-operated",
      endpoint_owner: "Synthetic Provider",
    };
    return Response.json({
      code: 200,
      data: [
        { ...priceRecord, endpoint_cost: 0.001 },
        { ...priceRecord, endpoint_cost: 0.002 },
      ],
    });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const response = await fetchWorker(
    "/api/admin/catalog/sync",
    {
      method: "POST",
      headers: { authorization: `Bearer ${catalogSecret}` },
    },
    env,
  );
  assert.equal(response.status, 502);
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
  assert.deepEqual(
    {
      ...db.raw
        .prepare(
          `SELECT enabled, sync_generation
           FROM endpoint_catalog
           WHERE path = '/v1/tiktok/web/fetch_user_profile'`,
        )
        .get(),
    },
    {
      enabled: 1,
      sync_generation: previousGeneration,
    },
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM endpoint_catalog
         WHERE path = '/v1/youtube/web/fetch_video'`,
      )
      .get().count,
    0,
  );
  assert.equal(
    db.raw
      .prepare("SELECT COUNT(*) AS count FROM catalog_sync_staging")
      .get().count,
    0,
  );
  assert.equal(
    db.raw
      .prepare("SELECT COUNT(*) AS count FROM catalog_sync_locks")
      .get().count,
    0,
  );
});

test("rejects an explicit unsupported Synthetic Provider price method instead of treating it as a wildcard", async (t) => {
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
  const catalogSecret = "catalog-method-secret-32-minimum";
  const env = baseEnv({
    DB: db,
    UPSTREAM_API_KEY: "upstream-key",
    CATALOG_SYNC_SECRET: catalogSecret,
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.pathname === "/openapi.json") {
      return Response.json({
        openapi: "3.1.0",
        paths: {
          "/api/v1/youtube/web/fetch_video": {
            get: { parameters: [] },
          },
        },
      });
    }
    return Response.json({
      data: [
        {
          endpoint_uri: "/api/v1/youtube/web/fetch_video",
          endpoint_cost: 0.001,
          method: "DELETE",
        },
      ],
    });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const response = await fetchWorker(
    "/api/admin/catalog/sync",
    {
      method: "POST",
      headers: { authorization: `Bearer ${catalogSecret}` },
    },
    env,
  );
  assert.equal(response.status, 502);
  assert.equal(
    (await response.json()).error.code,
    "catalog_price_method_invalid",
  );
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
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM endpoint_catalog
         WHERE path = '/v1/youtube/web/fetch_video'`,
      )
      .get().count,
    0,
  );
});

test("rejects malformed official Synthetic Provider price envelopes without legacy-field fallback", async (t) => {
  const cases = [
    {
      payload: {
        code: 200,
        data: [
          {
            endpoint_uri: null,
            path: "/api/v1/youtube/web/fetch_video",
            endpoint_cost: 0.001,
          },
        ],
      },
      code: "catalog_price_schema_invalid",
    },
    {
      payload: {
        code: 500,
        data: [
          {
            endpoint_uri: "/api/v1/youtube/web/fetch_video",
            endpoint_cost: 0.001,
          },
        ],
      },
      code: "catalog_price_response_failed",
    },
  ];
  for (const [index, item] of cases.entries()) {
    const db = new TestD1();
    t.after(() => db.close());
    await migrate(db);
    enableCatalogEndpoint(db);
    const catalogSecret = `catalog-price-envelope-secret-32-minimum-${index}`;
    const env = baseEnv({
      DB: db,
      UPSTREAM_API_KEY: "upstream-key",
      CATALOG_SYNC_SECRET: catalogSecret,
    });
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL
          ? input
          : input.url,
      );
      if (url.pathname === "/openapi.json") {
        return Response.json({
          openapi: "3.1.0",
          paths: {
            "/api/v1/youtube/web/fetch_video": {
              get: { parameters: [] },
            },
          },
        });
      }
      return Response.json(item.payload);
    };
    try {
      const response = await fetchWorker(
        "/api/admin/catalog/sync",
        {
          method: "POST",
          headers: { authorization: `Bearer ${catalogSecret}` },
        },
        env,
      );
      assert.equal(response.status, 502);
      assert.equal((await response.json()).error.code, item.code);
      assert.equal(
        db.raw
          .prepare(
            `SELECT COUNT(*) AS count
             FROM endpoint_catalog
             WHERE path = '/v1/youtube/web/fetch_video'`,
          )
          .get().count,
        0,
      );
      assert.equal(
        db.raw
          .prepare("SELECT COUNT(*) AS count FROM catalog_sync_locks")
          .get().count,
        0,
      );
    } finally {
      globalThis.fetch = nativeFetch;
    }
  }
});

test("rejects non-decimal and sub-micro Synthetic Provider costs instead of rounding them", async (t) => {
  const invalidCosts = ["1e-3", "0x10", 0.0000004];
  for (const [index, endpointCost] of invalidCosts.entries()) {
    const db = new TestD1();
    t.after(() => db.close());
    await migrate(db);
    enableCatalogEndpoint(db);
    const catalogSecret = `catalog-price-value-secret-32-minimum-${index}`;
    const env = baseEnv({
      DB: db,
      UPSTREAM_API_KEY: "upstream-key",
      CATALOG_SYNC_SECRET: catalogSecret,
    });
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL
          ? input
          : input.url,
      );
      if (url.pathname === "/openapi.json") {
        return Response.json({
          openapi: "3.1.0",
          paths: {
            "/api/v1/youtube/web/fetch_video": {
              get: { parameters: [] },
            },
          },
        });
      }
      return Response.json({
        data: [
          {
            endpoint_uri: "/api/v1/youtube/web/fetch_video",
            endpoint_cost: endpointCost,
          },
        ],
      });
    };
    try {
      const response = await fetchWorker(
        "/api/admin/catalog/sync",
        {
          method: "POST",
          headers: { authorization: `Bearer ${catalogSecret}` },
        },
        env,
      );
      assert.equal(response.status, 502);
      assert.equal(
        (await response.json()).error.code,
        "catalog_price_value_invalid",
      );
      assert.equal(
        db.raw
          .prepare(
            `SELECT COUNT(*) AS count
             FROM endpoint_catalog
             WHERE path = '/v1/youtube/web/fetch_video'`,
          )
          .get().count,
        0,
      );
      assert.equal(
        db.raw
          .prepare("SELECT COUNT(*) AS count FROM catalog_sync_locks")
          .get().count,
        0,
      );
    } finally {
      globalThis.fetch = nativeFetch;
    }
  }
});

test("rejects ambiguous, malformed or sensitive OpenAPI operations", async (t) => {
  const cases = [
    {
      operations: {
        get: { parameters: [] },
        post: { requestBody: {} },
      },
      code: "catalog_openapi_method_collision",
    },
    {
      operations: {
        put: { requestBody: {} },
      },
      code: "catalog_openapi_method_unsupported",
    },
    {
      operations: {
        get: null,
      },
      code: "catalog_openapi_operation_invalid",
    },
    {
      operations: {
        $ref: "#/components/pathItems/unsafe",
      },
      code: "catalog_openapi_operation_invalid",
    },
    {
      operations: {
        get: {
          parameters: [],
          tags: ["Bearer abcdefghijklmnop"],
        },
      },
      code: "catalog_openapi_taxonomy_invalid",
    },
    {
      paths: {
        "/api/v1/youtube/web/fetch_video": {
          get: { parameters: [] },
        },
        "/v1/youtube/web/fetch_video": {
          get: { parameters: [] },
        },
      },
      code: "catalog_openapi_path_collision",
    },
  ];
  for (const [index, item] of cases.entries()) {
    const db = new TestD1();
    t.after(() => db.close());
    await migrate(db);
    const catalogSecret = `catalog-openapi-method-secret-32-minimum-${index}`;
    const env = baseEnv({
      DB: db,
      UPSTREAM_API_KEY: "upstream-key",
      CATALOG_SYNC_SECRET: catalogSecret,
    });
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL
          ? input
          : input.url,
      );
      if (url.pathname === "/openapi.json") {
        return Response.json({
          openapi: "3.1.0",
          paths:
            item.paths ??
            {
              "/api/v1/youtube/web/fetch_video": item.operations,
            },
        });
      }
      return Response.json({
        data: [
          {
            endpoint_uri: "/api/v1/youtube/web/fetch_video",
            endpoint_cost: 0.001,
          },
        ],
      });
    };
    try {
      const response = await fetchWorker(
        "/api/admin/catalog/sync",
        {
          method: "POST",
          headers: { authorization: `Bearer ${catalogSecret}` },
        },
        env,
      );
      assert.equal(response.status, 502);
      assert.equal((await response.json()).error.code, item.code);
      assert.equal(
        db.raw
          .prepare("SELECT COUNT(*) AS count FROM catalog_sync_locks")
          .get().count,
        0,
      );
    } finally {
      globalThis.fetch = nativeFetch;
    }
  }
});

test("keeps the live catalog when the same Synthetic Provider credential returns a partial price snapshot", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw.exec("DELETE FROM endpoint_catalog");
  const upstreamKey = "upstream-key";
  const credentialFingerprint = createHash("sha256")
    .update(upstreamKey)
    .digest("hex")
    .slice(0, 16);
  const credentialStateVersion = Number(
    db.raw
      .prepare(
        `SELECT version
         FROM upstream_credential_state
         WHERE provider = 'primary'`,
      )
      .get().version,
  );
  const paths = Array.from(
    { length: 20 },
    (_, index) => `/v1/youtube/web/fetch_video_${index}`,
  );
  const insert = db.raw.prepare(
    `INSERT INTO endpoint_catalog
     (path, platform, http_method, summary,
      upstream_price_usd_micros, customer_price_usd_micros,
      price_verified, enabled, read_only, sync_generation,
      reviewed_at, created_at, updated_at)
     VALUES (?, 'youtube', 'GET', ?, 1000, 2000, 1, 1, 1,
             'sync-full-prices', CURRENT_TIMESTAMP,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  for (const path of paths) insert.run(path, `Fetch ${path}`);
  db.raw
    .prepare(
      `INSERT INTO catalog_sync_state
       (id, last_success_generation, credential_source, credential_id,
        credential_fingerprint, credential_state_version,
        source_config_version, source_config_hash,
        openapi_operation_count, raw_price_row_count,
        normalized_price_count, openapi_price_mapped_count,
        price_only_count, openapi_only_count, scope_excluded_count,
        matched_price_count, positive_price_count, zero_price_count,
        awaiting_price_count, openapi_snapshot_hash,
        price_snapshot_hash, synced_at)
       VALUES (1, 'sync-full-prices', 'environment', NULL, ?, ?, 1, ?,
               20, 20, 20, 20, 0, 0, 0, 20, 20, 0, 0, ?, ?,
               CURRENT_TIMESTAMP)`,
    )
    .run(
      credentialFingerprint,
      credentialStateVersion,
      TEST_UPSTREAM_SOURCE_CONFIG_HASH,
      "a".repeat(64),
      "b".repeat(64),
    );

  const catalogSecret = "catalog-partial-price-secret-32-minimum";
  const env = baseEnv({
    DB: db,
    UPSTREAM_API_KEY: upstreamKey,
    CATALOG_SYNC_SECRET: catalogSecret,
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.pathname === "/openapi.json") {
      return Response.json({
        openapi: "3.1.0",
        paths: Object.fromEntries(
          paths.map((path) => [
            `/api${path}`,
            { get: { summary: `Fetch ${path}`, parameters: [] } },
          ]),
        ),
      });
    }
    return Response.json({
      data: [
        {
          endpoint_uri: `/api${paths[0]}`,
          endpoint_cost: 0.001,
        },
      ],
    });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const response = await fetchWorker(
    "/api/admin/catalog/sync",
    {
      method: "POST",
      headers: { authorization: `Bearer ${catalogSecret}` },
    },
    env,
  );
  assert.equal(response.status, 502);
  assert.equal(
    (await response.json()).error.code,
    "catalog_price_snapshot_incomplete",
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT last_success_generation
         FROM catalog_sync_state
         WHERE id = 1`,
      )
      .get().last_success_generation,
    "sync-full-prices",
  );
  assert.deepEqual(
    {
      ...db.raw
        .prepare(
          `SELECT COUNT(*) AS count,
                  SUM(enabled) AS enabled_count,
                  SUM(reviewed_at IS NOT NULL) AS reviewed_count
           FROM endpoint_catalog
           WHERE sync_generation = 'sync-full-prices'`,
        )
        .get(),
    },
    {
      count: 20,
      enabled_count: 20,
      reviewed_count: 20,
    },
  );
  assert.equal(
    db.raw
      .prepare("SELECT COUNT(*) AS count FROM catalog_sync_staging")
      .get().count,
    0,
  );
  assert.equal(
    db.raw
      .prepare("SELECT COUNT(*) AS count FROM catalog_sync_locks")
      .get().count,
    0,
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
          data: paths.map((path) => ({
            endpoint_uri: `/api${path}`,
            endpoint_cost: 0.001,
            allow_free_credit: 1,
            allow_discount: 1,
            rate_limit: "10/second",
            endpoint_type: "self-operated",
            endpoint_owner: "Synthetic Provider",
          })),
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
    UPSTREAM_API_KEY: "upstream-key",
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
    UPSTREAM_API_KEY: "upstream-key",
    CRYPTO_PAYMENTS_ENABLED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
    PAYMENT_PROVIDER: "nowpayments",
    NOWPAYMENTS_API_KEY: "provider-key",
    NOWPAYMENTS_IPN_SECRET: "ipn-secret",
    GOOGLE_CLIENT_ID: "google-client.apps.exampleusercontent.com",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    WALLET_LOGIN_ENABLED: "true",
    CATALOG_SYNC_SECRET: "operator-secret-32-characters-minimum",
    RECONCILIATION_SECRET: "reconcile-secret-32-characters-minimum",
    PAYMENT_ADMIN_SECRET: "payment-admin-secret-32-characters-minimum",
  });

  const health = await fetchWorker("/api/readiness", {}, env);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).mode, "live");

  const catalog = await fetchWorker(
    "/api/catalog?platform=tiktok&dataType=profile_creator" +
      "&tag=TikTok-Web-API&surface=web",
    {},
    env,
  );
  assert.equal(catalog.status, 200);
  const catalogData = await catalog.json();
  assert.equal(catalogData.count, 1);
  assert.deepEqual(catalogData.endpoints[0], {
    id: catalogData.endpoints[0].id,
    path: "/v1/tiktok/web/fetch_user_profile",
    platform: "tiktok",
    dataType: "profile_creator",
    categories: ["profile_creator", "web"],
    surface: "web",
    method: "GET",
    summary: "Fetch User Profile",
    pricing: {
      amountUsdMicros: 2500,
      currency: "USD",
      unit: "request",
      verified: true,
    },
    updatedAt: catalogData.endpoints[0].updatedAt,
  });

  const excludedCatalog = await fetchWorker(
    "/api/catalog?dataType=content&tag=TikTok-Web-API&surface=web",
    {},
    env,
  );
  assert.equal(excludedCatalog.status, 200);
  assert.equal((await excludedCatalog.json()).count, 0);

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
  assert.equal(dashboardData.payments[0].creditedUsdMicros, 0);
  assert.equal(dashboardData.payments[0].reversedUsdMicros, 0);
  assert.equal(dashboardData.payments[0].reviewReason, null);
  assert.equal(dashboardData.payments[0].reviewStatus, null);
});

test("uses one backend availability result for admin and Data Market", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  enableCatalogEndpoint(db);
  const catalogSecret = "catalog-availability-secret-32-characters-minimum";
  const envOptions = {
    DB: db,
    UPSTREAM_API_KEY: "upstream-key",
    RESELLER_AUTHORIZED: "true",
    LEGAL_REVIEW_CONFIRMED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
    CATALOG_SYNC_SECRET: catalogSecret,
    RECONCILIATION_SECRET:
      "catalog-availability-reconcile-secret-32-minimum",
  };
  const readyEnv = baseEnv(envOptions);
  const adminReady = await fetchWorker(
    "/api/admin/catalog?limit=10&offset=0",
    {
      headers: { authorization: `Bearer ${catalogSecret}` },
    },
    readyEnv,
  );
  assert.equal(adminReady.status, 200);
  const adminReadyEndpoint = (await adminReady.json()).endpoints.find(
    (endpoint) =>
      endpoint.path === "/v1/tiktok/web/fetch_user_profile",
  );
  assert.equal(adminReadyEndpoint.marketplaceAvailability, "available");
  assert.deepEqual(adminReadyEndpoint.availabilityReasons, []);

  const marketReady = await fetchWorker(
    "/api/marketplace?platform=tiktok&limit=100&offset=0",
    {},
    readyEnv,
  );
  assert.equal(marketReady.status, 200);
  const marketReadyEndpoint = (await marketReady.json()).endpoints.find(
    (endpoint) =>
      endpoint.path === "/v1/tiktok/web/fetch_user_profile",
  );
  assert.equal(marketReadyEndpoint.availability, "available");

  const disable = await fetchWorker(
    "/api/admin/catalog",
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${catalogSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        path: "/v1/tiktok/web/fetch_user_profile",
        enabled: false,
        readOnly: false,
        customerPriceUsdMicros:
          adminReadyEndpoint.customerPriceUsdMicros,
        expectedRevision: adminReadyEndpoint.revision,
      }),
    },
    readyEnv,
  );
  assert.equal(disable.status, 200, await disable.clone().text());
  const adminPending = await fetchWorker(
    "/api/admin/catalog?limit=10&offset=0",
    {
      headers: { authorization: `Bearer ${catalogSecret}` },
    },
    readyEnv,
  );
  assert.equal(adminPending.status, 200);
  const adminPendingEndpoint = (await adminPending.json()).endpoints.find(
    (endpoint) =>
      endpoint.path === "/v1/tiktok/web/fetch_user_profile",
  );
  assert.equal(adminPendingEndpoint.marketplaceAvailability, "pending");
  assert.ok(
    adminPendingEndpoint.availabilityReasons.includes(
      "pending_confirmation",
    ),
  );
  assert.ok(
    adminPendingEndpoint.availabilityReasons.includes(
      "read_only_not_confirmed",
    ),
  );

  const marketPending = await fetchWorker(
    "/api/marketplace?platform=tiktok&limit=100&offset=0",
    {},
    readyEnv,
  );
  assert.equal(marketPending.status, 200);
  const marketPendingEndpoint = (await marketPending.json()).endpoints.find(
    (endpoint) =>
      endpoint.path === "/v1/tiktok/web/fetch_user_profile",
  );
  assert.equal(marketPendingEndpoint.availability, "pending");
});

test("atomically confirms selected pending routes for the frontend", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  enableCatalogEndpoint(db);
  db.raw
    .prepare(
      `UPDATE endpoint_catalog
       SET enabled = 0, read_only = 0, reviewed_at = NULL, revision = 7
       WHERE path = '/v1/tiktok/web/fetch_user_profile'`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO endpoint_catalog
       (path, platform, http_method, data_type, tags_json, surface,
        operation_id, summary, upstream_price_usd_micros,
        customer_price_usd_micros, price_verified, enabled, read_only,
        safety_classification, safety_reasons_json, safety_policy_version,
        revision, sync_generation)
       VALUES ('/v1/tiktok/web/fetch_user_posts', 'tiktok', 'GET',
               'profile_creator', '["TikTok-Web-API"]', 'web',
               'fetch_user_posts', 'Fetch user posts', 1000, 2000,
               1, 0, 0, 'safe_data_read', '["test_fixture"]', 1, 4,
               'sync_test_complete_0001')`,
    )
    .run();
  db.raw
    .prepare(
      `UPDATE catalog_sync_state
       SET openapi_operation_count = 2, raw_price_row_count = 2,
           normalized_price_count = 2, openapi_price_mapped_count = 2,
           price_only_count = 0, openapi_only_count = 0,
           scope_excluded_count = 0, matched_price_count = 2,
           positive_price_count = 2, zero_price_count = 0,
           awaiting_price_count = 0
       WHERE id = 1`,
    )
    .run();
  const catalogSecret = "catalog-confirm-secret-32-characters-minimum";
  const env = baseEnv({
    DB: db,
    CATALOG_SYNC_SECRET: catalogSecret,
  });
  const confirm = await fetchWorker(
    "/api/admin/catalog/confirm",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${catalogSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            path: "/v1/tiktok/web/fetch_user_profile",
            expectedRevision: 7,
          },
          {
            path: "/v1/tiktok/web/fetch_user_posts",
            expectedRevision: 4,
          },
        ],
      }),
    },
    env,
  );
  assert.equal(confirm.status, 200, await confirm.clone().text());
  assert.deepEqual(await confirm.json(), {
    ok: true,
    count: 2,
    paths: [
      "/v1/tiktok/web/fetch_user_profile",
      "/v1/tiktok/web/fetch_user_posts",
    ],
  });
  assert.deepEqual(
    db.raw
      .prepare(
        `SELECT path, enabled, read_only, revision
         FROM endpoint_catalog
         WHERE path IN (
           '/v1/tiktok/web/fetch_user_profile',
           '/v1/tiktok/web/fetch_user_posts'
         )
         ORDER BY path`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        path: "/v1/tiktok/web/fetch_user_posts",
        enabled: 1,
        read_only: 1,
        revision: 5,
      },
      {
        path: "/v1/tiktok/web/fetch_user_profile",
        enabled: 1,
        read_only: 1,
        revision: 8,
      },
    ],
  );

  db.raw
    .prepare(
      `UPDATE endpoint_catalog
       SET enabled = 0, read_only = 0
       WHERE path IN (
         '/v1/tiktok/web/fetch_user_profile',
         '/v1/tiktok/web/fetch_user_posts'
       )`,
    )
    .run();
  const conflict = await fetchWorker(
    "/api/admin/catalog/confirm",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${catalogSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            path: "/v1/tiktok/web/fetch_user_profile",
            expectedRevision: 8,
          },
          {
            path: "/v1/tiktok/web/fetch_user_posts",
            expectedRevision: 999,
          },
        ],
      }),
    },
    env,
  );
  assert.equal(conflict.status, 409);
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM endpoint_catalog
         WHERE path IN (
           '/v1/tiktok/web/fetch_user_profile',
           '/v1/tiktok/web/fetch_user_posts'
         )
           AND enabled = 1`,
      )
      .get().count,
    0,
  );
});

test("freezes, atomically applies and replays catalog batch plans", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  enableCatalogEndpoint(db);
  db.raw
    .prepare(
      `UPDATE endpoint_catalog
       SET enabled = 0, read_only = 0, reviewed_at = NULL,
           revision = 7
       WHERE path = '/v1/tiktok/web/fetch_user_profile'`,
    )
    .run();
  const catalogSecret = "catalog-batch-secret-32-characters-minimum";
  const env = baseEnv({
    DB: db,
    CATALOG_SYNC_SECRET: catalogSecret,
  });
  const previewHeaders = {
    authorization: `Bearer ${catalogSecret}`,
    "content-type": "application/json",
    "idempotency-key": "catalog-preview-stable-0001",
  };
  const previewBody = {
    action: "publish",
    expectedCatalogGeneration: "sync_test_complete_0001",
    selection: {
      platform: "tiktok",
      dataType: "profile_creator",
      tag: "TikTok-Web-API",
      surface: "web",
      query: "fetch_user_profile",
      status: "disabled",
      safety: "safe_data_read",
    },
    pricing: {
      markupBps: 1000,
      minimumCustomerPriceUsdMicros: 1,
    },
  };
  const recoveryHeaders = {
    ...previewHeaders,
    "idempotency-key": "catalog-preview-recovery-0001",
  };
  const interrupted = await fetchWorker(
    "/api/admin/catalog/batches/preview",
    {
      method: "POST",
      headers: recoveryHeaders,
      body: JSON.stringify(previewBody),
    },
    env,
  );
  assert.equal(interrupted.status, 200);
  const interruptedData = await interrupted.json();
  db.raw
    .prepare(
      `UPDATE catalog_batch_plans
       SET status = 'preparing', version = 0, previewed_at = NULL,
           created_at = datetime('now', '-3 minutes')
       WHERE id = ?`,
    )
    .run(interruptedData.batch.id);
  const recoveredPreview = await fetchWorker(
    "/api/admin/catalog/batches/preview",
    {
      method: "POST",
      headers: recoveryHeaders,
      body: JSON.stringify(previewBody),
    },
    env,
  );
  assert.equal(
    recoveredPreview.status,
    200,
    await recoveredPreview.clone().text(),
  );
  const recoveredPreviewData = await recoveredPreview.json();
  assert.equal(recoveredPreviewData.replayed, false);
  assert.equal(recoveredPreviewData.batch.status, "ready");
  assert.notEqual(
    recoveredPreviewData.batch.id,
    interruptedData.batch.id,
  );

  const preview = await fetchWorker(
    "/api/admin/catalog/batches/preview",
    {
      method: "POST",
      headers: previewHeaders,
      body: JSON.stringify(previewBody),
    },
    env,
  );
  assert.equal(preview.status, 200, await preview.clone().text());
  const previewData = await preview.json();
  assert.equal(previewData.replayed, false);
  assert.equal(previewData.batch.status, "ready");
  assert.equal(previewData.batch.version, 1);
  assert.deepEqual(previewData.batch.selection, {
    platform: "tiktok",
    dataType: "profile_creator",
    tag: "tiktok-web-api",
    surface: "web",
    query: "fetch_user_profile",
    status: "disabled",
    safety: "safe_data_read",
  });
  assert.deepEqual(previewData.batch.counts, {
    matched: 1,
    selected: 1,
    blocked: 0,
    stale: 0,
    unverified: 0,
    unsafe: 0,
    noChange: 0,
    priceIncrease: 0,
    priceDecrease: 1,
    priceUnchanged: 0,
  });
  assert.equal(previewData.items[0].expectedRevision, 7);
  assert.equal(previewData.items[0].dataType, "profile_creator");
  assert.deepEqual(previewData.items[0].tags, ["TikTok-Web-API"]);
  assert.equal(previewData.items[0].surface, "web");
  assert.equal(
    previewData.items[0].operationId,
    "fetch_user_profile_api_v1_tiktok_web_fetch_user_profile_get",
  );
  assert.equal(previewData.items[0].before.enabled, false);
  assert.equal(previewData.items[0].after.enabled, true);
  assert.match(previewData.batch.targetDigest, /^[0-9a-f]{64}$/);

  const replayPreview = await fetchWorker(
    "/api/admin/catalog/batches/preview",
    {
      method: "POST",
      headers: previewHeaders,
      body: JSON.stringify(previewBody),
    },
    env,
  );
  assert.equal(replayPreview.status, 200);
  assert.equal((await replayPreview.json()).replayed, true);
  const previewConflict = await fetchWorker(
    "/api/admin/catalog/batches/preview",
    {
      method: "POST",
      headers: previewHeaders,
      body: JSON.stringify({
        ...previewBody,
        pricing: { ...previewBody.pricing, markupBps: 2000 },
      }),
    },
    env,
  );
  assert.equal(previewConflict.status, 409);
  assert.equal(
    (await previewConflict.json()).error.code,
    "catalog_batch_idempotency_conflict",
  );

  const applyHeaders = {
    authorization: `Bearer ${catalogSecret}`,
    "content-type": "application/json",
    "idempotency-key": "catalog-apply-stable-0001",
  };
  const applyBody = {
    expectedVersion: previewData.batch.version,
    previewDigest: previewData.batch.targetDigest,
    confirmation: previewData.batch.confirmationText,
  };
  const applied = await fetchWorker(
    `/api/admin/catalog/batches/${previewData.batch.id}/apply`,
    {
      method: "POST",
      headers: applyHeaders,
      body: JSON.stringify(applyBody),
    },
    env,
  );
  assert.equal(applied.status, 200);
  const appliedData = await applied.json();
  assert.equal(appliedData.replayed, false);
  assert.equal(appliedData.batch.status, "applied");
  assert.equal(appliedData.batch.version, 3);
  const endpoint = db.raw
    .prepare(
      `SELECT customer_price_usd_micros, enabled, read_only, revision
       FROM endpoint_catalog
       WHERE path = '/v1/tiktok/web/fetch_user_profile'`,
    )
    .get();
  assert.equal(endpoint.customer_price_usd_micros, 1100);
  assert.equal(endpoint.enabled, 1);
  assert.equal(endpoint.read_only, 1);
  assert.equal(endpoint.revision, 8);
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count FROM admin_audit_logs
         WHERE action = 'catalog.batch_applied'
           AND target_id = ?`,
      )
      .get(previewData.batch.id).count,
    1,
  );

  const replayApply = await fetchWorker(
    `/api/admin/catalog/batches/${previewData.batch.id}/apply`,
    {
      method: "POST",
      headers: applyHeaders,
      body: JSON.stringify(applyBody),
    },
    env,
  );
  assert.equal(replayApply.status, 200);
  assert.equal((await replayApply.json()).replayed, true);
  assert.equal(
    db.raw
      .prepare(
        `SELECT revision FROM endpoint_catalog
         WHERE path = '/v1/tiktok/web/fetch_user_profile'`,
      )
      .get().revision,
    8,
  );
});

test("selects catalog batches by taxonomy and rejects taxonomy CAS drift atomically", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  enableCatalogEndpoint(db);
  db.raw
    .prepare(
      `UPDATE endpoint_catalog
       SET enabled = 0, read_only = 0, reviewed_at = NULL, revision = 7
       WHERE path = '/v1/tiktok/web/fetch_user_profile'`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO endpoint_catalog
       (path, platform, http_method, data_type, tags_json, surface,
        operation_id, summary, upstream_price_usd_micros,
        customer_price_usd_micros, price_verified, enabled, read_only,
        safety_classification, safety_reasons_json, safety_policy_version,
        revision, sync_generation)
       VALUES ('/v1/tiktok/web/fetch_user_posts', 'tiktok', 'GET',
               'profile_creator', '["TikTok-Web-API"]', 'web',
               'fetch_user_posts', 'Fetch user posts', 1000, 2000,
               1, 0, 0, 'safe_data_read', '["test_fixture"]', 1, 4,
               'sync_test_complete_0001')`,
    )
    .run();
  db.raw
    .prepare(
      `UPDATE catalog_sync_state
       SET openapi_operation_count = 2, raw_price_row_count = 2,
           normalized_price_count = 2, openapi_price_mapped_count = 2,
           price_only_count = 0, openapi_only_count = 0,
           scope_excluded_count = 0, matched_price_count = 2,
           positive_price_count = 2, zero_price_count = 0,
           awaiting_price_count = 0
       WHERE id = 1`,
    )
    .run();

  const catalogSecret =
    "catalog-batch-taxonomy-secret-32-characters-minimum";
  const env = baseEnv({
    DB: db,
    CATALOG_SYNC_SECRET: catalogSecret,
  });
  const preview = await fetchWorker(
    "/api/admin/catalog/batches/preview",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${catalogSecret}`,
        "content-type": "application/json",
        "idempotency-key": "catalog-taxonomy-preview-0001",
      },
      body: JSON.stringify({
        action: "publish",
        expectedCatalogGeneration: "sync_test_complete_0001",
        selection: {
          platform: "tiktok",
          dataType: "profile_creator",
          tag: "tiktok-web-api",
          surface: "web",
          query: "",
          status: "disabled",
          safety: "safe_data_read",
        },
        pricing: {
          markupBps: 1000,
          minimumCustomerPriceUsdMicros: 1,
        },
      }),
    },
    env,
  );
  assert.equal(preview.status, 200, await preview.clone().text());
  const plan = await preview.json();
  assert.equal(plan.batch.status, "ready");
  assert.equal(plan.batch.counts.matched, 2);
  assert.equal(plan.batch.counts.selected, 2);
  assert.deepEqual(plan.batch.selection, {
    platform: "tiktok",
    dataType: "profile_creator",
    tag: "tiktok-web-api",
    surface: "web",
    query: "",
    status: "disabled",
    safety: "safe_data_read",
  });
  assert.deepEqual(
    plan.items.map((item) => ({
      path: item.path,
      dataType: item.dataType,
      tags: item.tags,
      surface: item.surface,
      operationId: item.operationId,
    })),
    [
      {
        path: "/v1/tiktok/web/fetch_user_posts",
        dataType: "profile_creator",
        tags: ["TikTok-Web-API"],
        surface: "web",
        operationId: "fetch_user_posts",
      },
      {
        path: "/v1/tiktok/web/fetch_user_profile",
        dataType: "profile_creator",
        tags: ["TikTok-Web-API"],
        surface: "web",
        operationId:
          "fetch_user_profile_api_v1_tiktok_web_fetch_user_profile_get",
      },
    ],
  );

  db.raw
    .prepare(
      `UPDATE endpoint_catalog
       SET tags_json = '["TikTok-Web-V2-API"]'
       WHERE path = '/v1/tiktok/web/fetch_user_posts'`,
    )
    .run();
  const apply = await fetchWorker(
    `/api/admin/catalog/batches/${plan.batch.id}/apply`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${catalogSecret}`,
        "content-type": "application/json",
        "idempotency-key": "catalog-taxonomy-apply-0001",
      },
      body: JSON.stringify({
        expectedVersion: plan.batch.version,
        previewDigest: plan.batch.targetDigest,
        confirmation: plan.batch.confirmationText,
      }),
    },
    env,
  );
  assert.equal(apply.status, 409);
  assert.equal(
    (await apply.json()).error.code,
    "catalog_batch_apply_conflict",
  );
  assert.deepEqual(
    db.raw
      .prepare(
        `SELECT path, customer_price_usd_micros, enabled, read_only,
                revision, tags_json
         FROM endpoint_catalog
         WHERE path IN (
           '/v1/tiktok/web/fetch_user_posts',
           '/v1/tiktok/web/fetch_user_profile'
         )
         ORDER BY path`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        path: "/v1/tiktok/web/fetch_user_posts",
        customer_price_usd_micros: 2000,
        enabled: 0,
        read_only: 0,
        revision: 4,
        tags_json: '["TikTok-Web-V2-API"]',
      },
      {
        path: "/v1/tiktok/web/fetch_user_profile",
        customer_price_usd_micros: 2000,
        enabled: 0,
        read_only: 0,
        revision: 7,
        tags_json: '["TikTok-Web-API"]',
      },
    ],
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM admin_audit_logs
         WHERE action = 'catalog.batch_applied' AND target_id = ?`,
      )
      .get(plan.batch.id).count,
    0,
  );
});

test("blocks unsafe batch publication and rejects stale all-or-nothing plans", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  enableCatalogEndpoint(db);
  db.raw
    .prepare(
      `UPDATE endpoint_catalog
       SET enabled = 0, read_only = 0, reviewed_at = NULL,
           revision = 11
       WHERE path = '/v1/tiktok/web/fetch_user_profile'`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO endpoint_catalog
       (path, platform, http_method, upstream_price_usd_micros,
        customer_price_usd_micros, price_verified, enabled, read_only,
        safety_classification, safety_reasons_json,
        safety_policy_version, revision, sync_generation,
        created_at, updated_at)
       VALUES ('/v1/tiktok/web/process_video', 'tiktok', 'POST',
               1000, 2000, 1, 0, 0, 'ambiguous',
               '["operation_not_allowlisted"]', 1, 4,
               'sync_test_complete_0001', CURRENT_TIMESTAMP,
               CURRENT_TIMESTAMP)`,
    )
    .run();
  const catalogSecret = "catalog-batch-stale-secret-32-minimum";
  const env = baseEnv({
    DB: db,
    CATALOG_SYNC_SECRET: catalogSecret,
  });
  const preview = await fetchWorker(
    "/api/admin/catalog/batches/preview",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${catalogSecret}`,
        "content-type": "application/json",
        "idempotency-key": "catalog-preview-blocked-0001",
      },
      body: JSON.stringify({
        action: "publish",
        expectedCatalogGeneration: "sync_test_complete_0001",
        selection: {
          platform: "tiktok",
          query: "",
          status: "disabled",
          safety: "all",
        },
        pricing: {
          markupBps: 1000,
          minimumCustomerPriceUsdMicros: 1,
        },
      }),
    },
    env,
  );
  assert.equal(preview.status, 200, await preview.clone().text());
  const blocked = await preview.json();
  assert.equal(blocked.batch.status, "blocked");
  assert.equal(blocked.batch.counts.matched, 2);
  assert.equal(blocked.batch.counts.blocked, 1);
  assert.equal(blocked.batch.counts.unsafe, 1);

  const applyBlocked = await fetchWorker(
    `/api/admin/catalog/batches/${blocked.batch.id}/apply`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${catalogSecret}`,
        "content-type": "application/json",
        "idempotency-key": "catalog-apply-blocked-0001",
      },
      body: JSON.stringify({
        expectedVersion: blocked.batch.version,
        previewDigest: blocked.batch.targetDigest,
        confirmation: blocked.batch.confirmationText,
      }),
    },
    env,
  );
  assert.equal(applyBlocked.status, 409);
  assert.equal(
    (await applyBlocked.json()).error.code,
    "catalog_batch_not_applicable",
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT COUNT(*) AS count FROM endpoint_catalog WHERE enabled = 1`,
      )
      .get().count,
    0,
  );

  const credentialPreview = await fetchWorker(
    "/api/admin/catalog/batches/preview",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${catalogSecret}`,
        "content-type": "application/json",
        "idempotency-key": "catalog-preview-credential-stale-0001",
      },
      body: JSON.stringify({
        action: "publish",
        expectedCatalogGeneration: "sync_test_complete_0001",
        selection: {
          platform: "tiktok",
          query: "fetch_user_profile",
          status: "disabled",
          safety: "safe_data_read",
        },
        pricing: {
          markupBps: 1000,
          minimumCustomerPriceUsdMicros: 1,
        },
      }),
    },
    env,
  );
  assert.equal(credentialPreview.status, 200);
  const credentialPlan = await credentialPreview.json();
  db.raw
    .prepare(
      `UPDATE catalog_sync_state
       SET credential_fingerprint = ?
       WHERE id = 1`,
    )
    .run("f".repeat(16));
  const credentialConflict = await fetchWorker(
    `/api/admin/catalog/batches/${credentialPlan.batch.id}/apply`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${catalogSecret}`,
        "content-type": "application/json",
        "idempotency-key": "catalog-apply-credential-stale-0001",
      },
      body: JSON.stringify({
        expectedVersion: credentialPlan.batch.version,
        previewDigest: credentialPlan.batch.targetDigest,
        confirmation: credentialPlan.batch.confirmationText,
      }),
    },
    env,
  );
  assert.equal(credentialConflict.status, 409);
  assert.equal(
    (await credentialConflict.json()).error.code,
    "catalog_batch_apply_conflict",
  );
  assert.equal(
    db.raw
      .prepare(
        `SELECT enabled FROM endpoint_catalog
         WHERE path = '/v1/tiktok/web/fetch_user_profile'`,
      )
      .get().enabled,
    0,
  );
  db.raw
    .prepare(
      `UPDATE catalog_sync_state
       SET credential_fingerprint = ?
       WHERE id = 1`,
    )
    .run(
      createHash("sha256")
        .update("upstream-key")
        .digest("hex")
        .slice(0, 16),
    );

  const safePreview = await fetchWorker(
    "/api/admin/catalog/batches/preview",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${catalogSecret}`,
        "content-type": "application/json",
        "idempotency-key": "catalog-preview-stale-0001",
      },
      body: JSON.stringify({
        action: "publish",
        expectedCatalogGeneration: "sync_test_complete_0001",
        selection: {
          platform: "tiktok",
          query: "fetch_user_profile",
          status: "disabled",
          safety: "safe_data_read",
        },
        pricing: {
          markupBps: 1000,
          minimumCustomerPriceUsdMicros: 1,
        },
      }),
    },
    env,
  );
  assert.equal(safePreview.status, 200);
  const safePlan = await safePreview.json();
  db.raw
    .prepare(
      `UPDATE endpoint_catalog
       SET customer_price_usd_micros = 2500, revision = revision + 1
       WHERE path = '/v1/tiktok/web/fetch_user_profile'`,
    )
    .run();
  const staleApply = await fetchWorker(
    `/api/admin/catalog/batches/${safePlan.batch.id}/apply`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${catalogSecret}`,
        "content-type": "application/json",
        "idempotency-key": "catalog-apply-stale-0001",
      },
      body: JSON.stringify({
        expectedVersion: safePlan.batch.version,
        previewDigest: safePlan.batch.targetDigest,
        confirmation: safePlan.batch.confirmationText,
      }),
    },
    env,
  );
  assert.equal(staleApply.status, 409);
  assert.equal(
    (await staleApply.json()).error.code,
    "catalog_batch_apply_conflict",
  );
  const afterConflict = db.raw
    .prepare(
      `SELECT customer_price_usd_micros, enabled, revision
       FROM endpoint_catalog
       WHERE path = '/v1/tiktok/web/fetch_user_profile'`,
    )
    .get();
  assert.equal(afterConflict.customer_price_usd_micros, 2500);
  assert.equal(afterConflict.enabled, 0);
  assert.equal(afterConflict.revision, 12);
});

test("does not refresh reconciliation health when every due provider read fails", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  enableCatalogEndpoint(db);
  db.raw
    .prepare(
      `UPDATE operation_heartbeats
       SET last_success_at = datetime('now', '-10 minutes')
       WHERE name = 'reconciliation'`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-provider-down', 'provider-down@example.com',
               'Provider Down')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, provider_payment_id, amount_usd_micros,
        pay_currency, pay_amount, status, created_at, updated_at)
       VALUES ('pay_provider_down', 'usr-provider-down', 'nowpayments',
               'np-provider-down', 10000000, 'usdttrc20', '10',
               'confirming', datetime('now', '-5 minutes'),
               datetime('now', '-2 minutes'))`,
    )
    .run();

  const env = baseEnv({
    DB: db,
    UPSTREAM_API_KEY: "upstream-key",
    RESELLER_AUTHORIZED: "true",
    LEGAL_REVIEW_CONFIRMED: "true",
    CRYPTO_PAYMENTS_ENABLED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
    PAYMENT_PROVIDER: "nowpayments",
    NOWPAYMENTS_API_KEY: "provider-key",
    NOWPAYMENTS_IPN_SECRET: "provider-down-ipn-secret",
    CATALOG_SYNC_SECRET:
      "provider-down-catalog-secret-32-minimum",
    RECONCILIATION_SECRET:
      "provider-down-reconcile-secret-32-minimum",
    PAYMENT_ADMIN_SECRET:
      "provider-down-payment-secret-32-minimum",
  });
  const before = db.raw
    .prepare(
      `SELECT last_success_at
       FROM operation_heartbeats
       WHERE name = 'reconciliation'`,
    )
    .get().last_success_at;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("provider unavailable");
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const response = await fetchWorker(
    "/api/admin/reconcile",
    {
      method: "POST",
      headers: {
        authorization:
          "Bearer provider-down-reconcile-secret-32-minimum",
      },
    },
    env,
  );
  assert.equal(response.status, 502);
  const result = await response.json();
  assert.equal(result.payments.providerAttempts, 1);
  assert.equal(result.payments.providerSuccesses, 0);
  assert.equal(result.payments.providerHealthy, false);
  assert.equal(result.payments.errors, 1);
  assert.equal(
    db.raw
      .prepare(
        `SELECT last_success_at
         FROM operation_heartbeats
         WHERE name = 'reconciliation'`,
      )
      .get().last_success_at,
    before,
  );
  const lastRun = db.raw
    .prepare(
      `SELECT details_json
       FROM operation_heartbeats
       WHERE name = 'reconciliation:last-run'`,
    )
    .get();
  assert.match(lastRun.details_json, /"status":"provider_failed"/);

  const readiness = await fetchWorker("/api/readiness", {}, env);
  assert.equal(readiness.status, 503);
  const readinessData = await readiness.json();
  assert.equal(readinessData.capabilities.reconciliationRecent, false);
  assert.ok(
    readinessData.missing.includes("scheduled_reconciliation"),
  );
});

test("runs reconciliation from the worker scheduled handler", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({
    DB: db,
    RECONCILIATION_SECRET:
      "scheduled-reconcile-secret-32-minimum",
  });

  await worker.scheduled({}, env, context());
  const heartbeat = db.raw
    .prepare(
      `SELECT details_json
       FROM operation_heartbeats
       WHERE name = 'reconciliation'`,
    )
    .get();
  assert.ok(heartbeat);
  assert.match(heartbeat.details_json, /"status":"healthy"/);
});

test("rechecks recent failed zero-credit orders and captures late funds", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr-late-failed', 'late-failed@example.com',
               'Late Failed Payment')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO payment_orders
       (id, user_id, provider, provider_payment_id, amount_usd_micros,
        pay_currency, pay_amount, pay_address, status,
        credited_usd_micros, created_at, updated_at)
       VALUES ('pay_late_failed', 'usr-late-failed', 'nowpayments',
               'np-late-failed', 10000000, 'usdttrc20', '10',
               'TLateFailedAddress123456789', 'failed', 0,
               datetime('now', '-3 days'), datetime('now', '-7 hours'))`,
    )
    .run();
  const env = baseEnv({
    DB: db,
    NOWPAYMENTS_API_KEY: "provider-key",
    RECONCILIATION_SECRET:
      "late-failed-reconcile-secret-32-minimum",
  });
  const nativeFetch = globalThis.fetch;
  let providerReads = 0;
  globalThis.fetch = async () => {
    providerReads += 1;
    return Response.json({
      payment_id: "np-late-failed",
      payment_status: "finished",
      order_id: "pay_late_failed",
      price_amount: 10,
      price_currency: "usd",
      pay_amount: "10",
      actually_paid: "10",
      pay_currency: "usdttrc20",
      pay_address: "TLateFailedAddress123456789",
    });
  };
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });

  const reconciliation = await fetchWorker(
    "/api/admin/reconcile",
    {
      method: "POST",
      headers: {
        authorization:
          "Bearer late-failed-reconcile-secret-32-minimum",
      },
    },
    env,
  );
  assert.equal(reconciliation.status, 200);
  assert.equal((await reconciliation.json()).payments.polled, 1);
  assert.equal(providerReads, 1);
  const order = db.raw
    .prepare(
      `SELECT status, credited_usd_micros
       FROM payment_orders
       WHERE id = 'pay_late_failed'`,
    )
    .get();
  assert.equal(order.status, "finished");
  assert.equal(order.credited_usd_micros, 10000000);
  assert.equal(
    db.raw
      .prepare(
        `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
         FROM balance_ledger
         WHERE user_id = 'usr-late-failed'`,
      )
      .get().balance,
    10000000,
  );
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
