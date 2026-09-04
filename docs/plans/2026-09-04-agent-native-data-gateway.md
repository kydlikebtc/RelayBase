# RelayBase Agent 原生数据网关实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 先修复内核的四个 P1（热路径、对账饥饿、x402 兜底、两个安全项），把单次付费调用的 D1 往返压到 15 次以内并消灭永久卡死状态，为后续的能力层与 Agent 分发层打好地基。

**Architecture:** 所有资金不变量保持"单语句守卫加 changes 校验"的现有模式；readiness 结果按 env 对象做短 TTL 缓存并在管理端写操作后显式失效；目录完整性扫描从请求路径移到同步发布与定时对账；余额改为"快照加增量"的单表达式；对账任务新增终态与 x402 清扫；新逻辑放进 `worker/lib/` 纯函数模块并配单元测试。

**Tech Stack:** TypeScript、Cloudflare Workers、D1（SQLite）、Drizzle ORM、vinext/Vite、`node --test`（集成测试用 `node:sqlite` 内存库 + 真实迁移；单元测试用 `--experimental-strip-types`）。

设计文档：`docs/plans/2026-09-04-agent-native-data-gateway-design.md`。本计划把 **Phase 0 展开为可逐步执行的任务**；Phase 1 与 Phase 2 在文末给出任务级概要，待 Phase 0 合并后按最终函数签名展开。

---

## 0. 执行约定（先读）

1. **分支。** 当前在 `main`，先建分支：`git checkout -b codex/phase0-agent-gateway`。
2. **行号基线。** 所有行号基于 `main` @ `1885553`。每个任务都给了 `grep -n` 锚点，行号漂移时以锚点为准。
3. **集成测试必须先构建。** 测试导入的是 `dist/server/index.js`：
   ```bash
   npm run build && node --test --test-name-pattern "<用例名片段>" tests/rendered-html.test.mjs
   ```
   只跑单元测试：`npm run test:unit`（任务 2 之后可用，不需要构建）。
4. **格式化钩子。** 本机存在一个会对被读取的 `.ts` 文件执行 Prettier 的钩子。每次提交前运行 `git status`；如果出现你没有改过的文件且 `git diff` 只是换行差异，执行 `git checkout -- <file>` 还原。永远用显式路径 `git add`，不要 `git add -A`。
5. **文档门禁。** `npm run check` 在 CI 里要求 `app|worker|db|drizzle|build|public|scripts` 的改动与 README、CHANGELOG 同一变更集；本地提交不受影响，任务 16 统一补文档。
6. **错误消息风格。** 客户可见错误继续用 `PlatformError(status, code, 中文消息)`。
7. **不要提交 `dist/`、`.wrangler/`。** 它们已在 `.gitignore`。
8. **不要打 tag、不要 push**，除非用户明确要求。
9. **安全提醒钩子。** 本机的 security-guidance 钩子会把 `node:sqlite` 的 `DatabaseSync.exec(...)` 误判为 `child_process.exec`。编辑测试 harness 时若 Write/Edit 被拦截，改用 `sed`/heredoc 写入，并在提交说明里注明这是 sqlite 的 `exec`。

---

## Phase 0：内核 P1 修复（目标版本 0.4.0-preview.6）

### Task 1: 测试 harness：迁移清单读 journal、D1 往返统计、默认关闭 readiness 缓存

**Files:**
- Modify: `tests/rendered-html.test.mjs:30-98`（`D1Statement`、`TestD1`）
- Modify: `tests/rendered-html.test.mjs:145-155`（`baseEnv`）
- Modify: `tests/rendered-html.test.mjs:168-190`（`migrationFiles`）

**Step 1: 用带统计的 D1 shim 替换两个类**

把第 30 行开始的 `class D1Statement { ... }` 与紧随其后的 `class TestD1 { ... }`（到 `close()` 结束，`PausableBatchD1` 之前）整体替换为：

```js
class D1Statement {
  constructor(database, sql, stats) {
    this.database = database;
    this.sql = sql;
    this.params = [];
    this.stats = stats;
  }

  bind(...params) {
    const statement = new D1Statement(this.database, this.sql, this.stats);
    statement.params = params;
    return statement;
  }

  record() {
    this.stats.statements += 1;
    if (!this.stats.inBatch) this.stats.roundTrips += 1;
    if (this.stats.trace) {
      this.stats.trace.push(this.sql.replace(/\s+/g, " ").trim().slice(0, 90));
    }
  }

  first() {
    this.record();
    return this.database.prepare(this.sql).get(...this.params) ?? null;
  }

  all() {
    this.record();
    return {
      success: true,
      results: this.database.prepare(this.sql).all(...this.params),
      meta: {},
    };
  }

  run() {
    this.record();
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
    this.stats = {
      roundTrips: 0,
      statements: 0,
      batches: 0,
      inBatch: false,
      trace: null,
    };
  }

  prepare(sql) {
    return new D1Statement(this.raw, sql, this.stats);
  }

  resetStats({ trace = false } = {}) {
    this.stats.roundTrips = 0;
    this.stats.statements = 0;
    this.stats.batches = 0;
    this.stats.trace = trace ? [] : null;
  }

  batch(statements) {
    this.stats.roundTrips += 1;
    this.stats.batches += 1;
    this.stats.inBatch = true;
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
    } finally {
      this.stats.inBatch = false;
    }
  }

  close() {
    this.raw.close();
  }
}
```

`PausableBatchD1` 不用改：它的 `batch()` 最终调用 `super.batch(statements)`。

**Step 2: 迁移清单改为读取 journal**

把 `const migrationFiles = [ ... ];`（21 个文件名的数组）替换为：

```js
const migrationJournal = JSON.parse(
  await readFile(new URL("drizzle/meta/_journal.json", root), "utf8"),
);
const migrationFiles = migrationJournal.entries.map(
  (entry) => `drizzle/${entry.tag}.sql`,
);
```

**Step 3: 测试环境默认关闭 readiness 缓存**

在 `baseEnv` 返回对象里、`UPSTREAM_ALLOWED_ORIGINS: TEST_UPSTREAM_ORIGIN,` 之后加一行：

```js
    READINESS_CACHE_TTL_MS: "0",
```

（任务 6 引入该变量；提前加不影响现有代码。）

**Step 4: 验证 harness 仍然工作**

Run:
```bash
node -e "const j=require('./drizzle/meta/_journal.json');console.log(j.entries.length)"
npm run build && node --test --test-name-pattern "sandbox health|migrations are stale|idempotent billing" tests/rendered-html.test.mjs
```
Expected: 第一条打印 `21`；第二条输出末尾 `# pass 3`、`# fail 0`。

**Step 5: Commit**

```bash
git add tests/rendered-html.test.mjs
git commit -m "test: derive migrations from journal and count D1 round trips in harness"
```

---

### Task 2: 单元测试运行器 + 请求状态常量模块

**Files:**
- Create: `worker/lib/proxy-request-status.ts`
- Create: `tests/unit/proxy-request-status.test.mjs`
- Modify: `package.json:8-18`（scripts）

**Step 1: 写失败的单元测试**

```js
// tests/unit/proxy-request-status.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  PROXY_REQUEST_STATUSES,
  isProxyRequestStatus,
  isTerminalProxyRequestStatus,
  terminalProxyRequestStatusSql,
} from "../../worker/lib/proxy-request-status.ts";

test("abandoned is a terminal status and processing is not", () => {
  assert.equal(isTerminalProxyRequestStatus("abandoned"), true);
  assert.equal(isTerminalProxyRequestStatus("reconciled"), true);
  assert.equal(isTerminalProxyRequestStatus("processing"), false);
  assert.equal(isTerminalProxyRequestStatus("charged"), false);
});

test("validates status strings and renders a SQL IN list", () => {
  assert.equal(isProxyRequestStatus("charged"), true);
  assert.equal(isProxyRequestStatus("insufficient_balance"), false);
  assert.equal(PROXY_REQUEST_STATUSES.length, 7);
  assert.equal(
    terminalProxyRequestStatusSql(),
    "'completed', 'refunded', 'reconciled', 'rate_limited', 'abandoned'",
  );
});
```

**Step 2: 加脚本并确认测试失败**

`package.json` 的 `scripts` 改为：

```json
    "test:unit": "node --experimental-strip-types --no-warnings --test tests/unit/*.test.mjs",
    "test": "npm run test:unit && npm run build && node --test tests/rendered-html.test.mjs",
```

（保留其余脚本不变。）

Run: `npm run test:unit`
Expected: FAIL，报 `Cannot find module '.../worker/lib/proxy-request-status.ts'`。

**Step 3: 实现模块**

```ts
// worker/lib/proxy-request-status.ts
export const PROXY_REQUEST_STATUSES = [
  "processing",
  "charged",
  "completed",
  "refunded",
  "reconciled",
  "rate_limited",
  "abandoned",
] as const;

export type ProxyRequestStatus = (typeof PROXY_REQUEST_STATUSES)[number];

export const TERMINAL_PROXY_REQUEST_STATUSES: readonly ProxyRequestStatus[] = [
  "completed",
  "refunded",
  "reconciled",
  "rate_limited",
  "abandoned",
];

export function isProxyRequestStatus(value: unknown): value is ProxyRequestStatus {
  return (
    typeof value === "string" &&
    (PROXY_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

export function isTerminalProxyRequestStatus(status: ProxyRequestStatus): boolean {
  return TERMINAL_PROXY_REQUEST_STATUSES.includes(status);
}

export function terminalProxyRequestStatusSql(): string {
  return TERMINAL_PROXY_REQUEST_STATUSES.map((status) => `'${status}'`).join(", ");
}
```

**Step 4: 运行通过**

Run: `npm run test:unit`
Expected: `# pass 2`、`# fail 0`。

Run: `npm run typecheck && npm run lint`
Expected: 无错误。

**Step 5: Commit**

```bash
git add worker/lib/proxy-request-status.ts tests/unit/proxy-request-status.test.mjs package.json
git commit -m "test: add unit test runner and proxy request status constants"
```

---

### Task 3: Schema 与迁移 0021（已验证代次列、余额快照表）

**Files:**
- Modify: `db/schema.ts:148-170`（`balanceLedger` 之后新增表）
- Modify: `db/schema.ts:811-837`（`catalogSyncState` 新增列）
- Create: `drizzle/0021_<自动命名>.sql`、`drizzle/meta/0021_snapshot.json`、`drizzle/meta/_journal.json`（由 drizzle-kit 生成）

**Step 1: 修改 schema**

在 `export const balanceLedger = sqliteTable(...)` 定义结束后插入：

```ts
export const balanceSnapshots = sqliteTable(
  "balance_snapshots",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    balanceUsdMicros: integer("balance_usd_micros").notNull().default(0),
    throughCreatedAt: text("through_created_at").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("balance_snapshots_updated_idx").on(table.updatedAt)],
);
```

在 `catalogSyncState` 里 `priceSnapshotHash: text("price_snapshot_hash"),` 之后加：

```ts
  taxonomyVerifiedGeneration: text("taxonomy_verified_generation"),
```

**Step 2: 生成迁移**

Run: `npm run db:generate`
Expected: 输出包含 `drizzle/0021_….sql`。然后：

```bash
ls drizzle/0021_*.sql && cat drizzle/0021_*.sql
```
Expected: 包含 `CREATE TABLE \`balance_snapshots\``、`CREATE INDEX \`balance_snapshots_updated_idx\``、`ALTER TABLE \`catalog_sync_state\` ADD \`taxonomy_verified_generation\` text;`，语句之间由 `--> statement-breakpoint` 分隔。

**Step 3: 验证旧库升级与 fail-closed 测试仍通过**

Run:
```bash
npm run build && node --test --test-name-pattern "migrations are stale|populated catalog|pre-taxonomy schema|sandbox health" tests/rendered-html.test.mjs
```
Expected: `# fail 0`。

**Step 4: Commit**

```bash
git add db/schema.ts drizzle/
git commit -m "feat(db): add balance snapshots and taxonomy verified generation"
```

---

### Task 4: TTL 缓存模块

**Files:**
- Create: `worker/lib/ttl-cache.ts`
- Create: `tests/unit/ttl-cache.test.mjs`

**Step 1: 写失败的单元测试**

```js
// tests/unit/ttl-cache.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { TtlCache, parseTtlMs } from "../../worker/lib/ttl-cache.ts";

test("remember returns the cached promise inside the ttl and recomputes after it", async () => {
  let now = 1_000;
  const cache = new TtlCache(() => now);
  const key = {};
  let computed = 0;
  const compute = async () => ++computed;

  assert.equal(await cache.remember(key, 500, compute), 1);
  assert.equal(await cache.remember(key, 500, compute), 1);
  now = 1_499;
  assert.equal(await cache.remember(key, 500, compute), 1);
  now = 1_500;
  assert.equal(await cache.remember(key, 500, compute), 2);
});

test("ttl of zero bypasses the cache and rejections are evicted", async () => {
  const cache = new TtlCache(() => 0);
  const key = {};
  let calls = 0;
  await cache.remember(key, 0, async () => ++calls);
  await cache.remember(key, 0, async () => ++calls);
  assert.equal(calls, 2);

  await assert.rejects(
    cache.remember(key, 1_000, async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(await cache.remember(key, 1_000, async () => 42), 42);
});

test("delete forces recomputation and keys are isolated", async () => {
  const cache = new TtlCache(() => 0);
  const a = {};
  const b = {};
  assert.equal(await cache.remember(a, 1_000, async () => "a1"), "a1");
  assert.equal(await cache.remember(b, 1_000, async () => "b1"), "b1");
  cache.delete(a);
  assert.equal(await cache.remember(a, 1_000, async () => "a2"), "a2");
  assert.equal(await cache.remember(b, 1_000, async () => "b2"), "b1");
});

test("parseTtlMs clamps and falls back", () => {
  assert.equal(parseTtlMs(undefined, 10_000, 60_000), 10_000);
  assert.equal(parseTtlMs("abc", 10_000, 60_000), 10_000);
  assert.equal(parseTtlMs("-5", 10_000, 60_000), 10_000);
  assert.equal(parseTtlMs("0", 10_000, 60_000), 0);
  assert.equal(parseTtlMs("999999", 10_000, 60_000), 60_000);
  assert.equal(parseTtlMs("2500", 10_000, 60_000), 2_500);
});
```

**Step 2: 运行确认失败**

Run: `npm run test:unit`
Expected: FAIL，`Cannot find module '.../worker/lib/ttl-cache.ts'`。

**Step 3: 实现**

```ts
// worker/lib/ttl-cache.ts
type Entry<T> = { expiresAt: number; value: Promise<T> };

export class TtlCache<T> {
  private readonly entries = new WeakMap<object, Entry<T>>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  get(key: object): Promise<T> | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  delete(key: object): void {
    this.entries.delete(key);
  }

  async remember(
    key: object,
    ttlMs: number,
    compute: () => Promise<T>,
  ): Promise<T> {
    if (ttlMs <= 0) return await compute();
    const cached = this.get(key);
    if (cached) return await cached;
    const value = compute();
    this.entries.set(key, { expiresAt: this.now() + ttlMs, value });
    try {
      return await value;
    } catch (error) {
      this.entries.delete(key);
      throw error;
    }
  }
}

export function parseTtlMs(
  raw: string | undefined,
  fallback: number,
  max: number,
): number {
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return fallback;
  return Math.min(max, parsed);
}
```

**Step 4: 运行通过**

Run: `npm run test:unit`
Expected: `# pass 6`、`# fail 0`。

**Step 5: Commit**

```bash
git add worker/lib/ttl-cache.ts tests/unit/ttl-cache.test.mjs
git commit -m "feat(lib): add object-keyed ttl cache"
```

---

### Task 5: 目录完整性检查移出请求路径

目标：readiness 在热路径只比较 `catalog_sync_state.taxonomy_verified_generation`；同步发布时写入该列；定时对账每轮全量复核并维护该列；`/api/health`、`/api/readiness` 继续执行全量扫描。

**Files:**
- Modify: `worker/platform.ts:18414-18742`（`operationalReadiness`）
- Modify: `worker/platform.ts:15606-15680`（同步发布的 `INSERT INTO catalog_sync_state`）
- Modify: `worker/platform.ts:16690-16790`（`handleReconciliation` 维护语句）
- Modify: `tests/rendered-html.test.mjs:240-350`（`enableCatalogEndpoint`）
- Test: `tests/rendered-html.test.mjs`（文末追加）

**Step 1: 写失败的集成测试**

在测试文件末尾追加：

```js
test("re-verifies stored taxonomy during reconciliation instead of on every proxy call", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({
    DB: db,
    RESELLER_AUTHORIZED: "true",
    LEGAL_REVIEW_CONFIRMED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
    UPSTREAM_API_KEY: "upstream-secret",
    RECONCILIATION_SECRET: "reconcile-secret-32-characters-minimum",
  });
  const createKey = await fetchWorker(
    "/api/keys",
    {
      method: "POST",
      headers: signedInHeaders(),
      body: JSON.stringify({ label: "taxonomy key" }),
    },
    env,
  );
  const created = (await createKey.json()).key;
  const user = db.raw
    .prepare("SELECT id FROM users WHERE email = ?")
    .get("owner@example.com");
  const path = "/v1/tiktok/web/fetch_user_profile";
  enableCatalogEndpoint(db, path, 2000, "upstream-secret");
  db.raw
    .prepare(
      `INSERT INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id)
       VALUES ('seed-taxonomy', ?, 'test_credit', 100000, 'test:taxonomy')`,
    )
    .run(user.id);
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ code: 200, data: { ok: true }, request_id: "r" });
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });
  const call = (key) =>
    fetchWorker(
      `${path}?uniqueId=taxonomy`,
      {
        headers: {
          authorization: `Bearer ${created.secret}`,
          "idempotency-key": key,
        },
      },
      env,
    );
  const reconcile = () =>
    fetchWorker(
      "/api/admin/reconcile",
      {
        method: "POST",
        headers: { authorization: `Bearer ${env.RECONCILIATION_SECRET}` },
      },
      env,
    );

  assert.equal((await call("tax-1")).status, 200);

  db.raw
    .prepare(`UPDATE endpoint_catalog SET data_type = 'bogus' WHERE path = ?`)
    .run(path);
  assert.equal((await call("tax-2")).status, 200, "hot path trusts the verified column");
  assert.equal((await reconcile()).status, 200);
  assert.equal(
    db.raw
      .prepare("SELECT taxonomy_verified_generation AS g FROM catalog_sync_state WHERE id = 1")
      .get().g,
    null,
  );
  const blocked = await call("tax-3");
  assert.equal(blocked.status, 503);
  assert.equal((await blocked.json()).error.code, "service_not_ready");
  const readiness = await fetchWorker("/api/readiness", {}, env);
  assert.ok((await readiness.json()).missing.includes("catalog_taxonomy"));

  db.raw
    .prepare(`UPDATE endpoint_catalog SET data_type = 'profile_creator' WHERE path = ?`)
    .run(path);
  assert.equal((await reconcile()).status, 200);
  assert.equal(
    db.raw
      .prepare("SELECT taxonomy_verified_generation AS g FROM catalog_sync_state WHERE id = 1")
      .get().g,
    TEST_CATALOG_GENERATION,
  );
  assert.equal((await call("tax-4")).status, 200);
});
```

**Step 2: 运行确认失败**

Run: `npm run build && node --test --test-name-pattern "re-verifies stored taxonomy" tests/rendered-html.test.mjs`
Expected: FAIL（`tax-2` 那次调用返回 503，因为当前实现每次都全量扫描）。

**Step 3: harness 的 `enableCatalogEndpoint` 写入已验证代次**

在 `enableCatalogEndpoint` 里的 `INSERT INTO catalog_sync_state` 语句：

- 列清单 `price_snapshot_hash, synced_at)` 改为 `price_snapshot_hash, taxonomy_verified_generation, synced_at)`；
- `VALUES (... , ?, ?,\n CURRENT_TIMESTAMP)` 改为 `VALUES (... , ?, ?, ?,\n CURRENT_TIMESTAMP)`；
- `ON CONFLICT` 里 `price_snapshot_hash = excluded.price_snapshot_hash,` 之后加 `taxonomy_verified_generation = excluded.taxonomy_verified_generation,`；
- `.run(generation, credentialFingerprint, credentialStateVersion, TEST_UPSTREAM_SOURCE_CONFIG_HASH, "a".repeat(64), "b".repeat(64))` 末尾追加第 7 个参数 `generation`。

**Step 4: readiness 改为读列，并支持 `verifyTaxonomy`**

锚点：`grep -n "^async function operationalReadiness" worker/platform.ts`（当前 18414）。

4a. 签名改为：

```ts
async function operationalReadiness(
  env: PlatformEnv,
  options: { verifyTaxonomy?: boolean } = {},
) {
```

4b. 在 readiness 的大 SELECT 里，`EXISTS(\n SELECT 1\n FROM operation_heartbeats` 那一段（别名 `reconciliation_recent`）之前插入：

```sql
             (SELECT taxonomy_verified_generation
              FROM catalog_sync_state WHERE id = 1)
               AS taxonomy_verified_generation,
             (SELECT last_success_generation
              FROM catalog_sync_state WHERE id = 1)
               AS last_success_generation,
             (SELECT balance_usd_micros
              FROM balance_snapshots LIMIT 1)
               AS balance_snapshots_schema,
```

并在 `.first<{ ... }>()` 的类型里加：

```ts
          taxonomy_verified_generation: string | null;
          last_success_generation: string | null;
```

4c. 把这段（锚点 `grep -n "await assertStoredCatalogTaxonomyIntegrity(env.DB)" worker/platform.ts`）：

```ts
      try {
        await assertStoredCatalogTaxonomyIntegrity(env.DB);
        taxonomyReady = true;
      } catch {
        taxonomyReady = false;
      }
```

替换为：

```ts
      const taxonomyColumnVerified =
        row != null &&
        row.taxonomy_verified_generation != null &&
        row.taxonomy_verified_generation === row.last_success_generation;
      if (options.verifyTaxonomy) {
        try {
          await assertStoredCatalogTaxonomyIntegrity(env.DB);
          taxonomyReady = taxonomyColumnVerified;
        } catch {
          taxonomyReady = false;
        }
      } else {
        taxonomyReady = taxonomyColumnVerified;
      }
```

4d. `/api/health` 与 `/api/readiness` 两处（锚点 `grep -n "const readiness = await operationalReadiness(env);" worker/platform.ts` 的前两个命中，当前 997、1015）改为 `operationalReadiness(env, { verifyTaxonomy: true })`。

**Step 5: 同步发布写入该列**

锚点：`grep -n "INSERT INTO catalog_sync_state" worker/platform.ts`（当前 15606）。在该语句里：

- 列清单 `price_snapshot_hash, synced_at)` 改为 `price_snapshot_hash, taxonomy_verified_generation, synced_at)`；
- `SELECT 1, ?, ... ?, ?,\n CURRENT_TIMESTAMP` 的占位符再加一个 `?`（共 23 个）；
- `ON CONFLICT` 的 `price_snapshot_hash = excluded.price_snapshot_hash,` 之后加 `taxonomy_verified_generation = excluded.taxonomy_verified_generation,`；
- `.bind(...)` 中，在 `price_snapshot_hash` 对应的实参之后、锁守卫的 `syncGeneration` 之前，插入 `syncGeneration,`。

用 `node --test --test-name-pattern "serializes catalog sync|publishes reviewed catalog prices"` 校验 bind 数量正确（占位符数与实参数不符会直接报 D1 错误）。

**Step 6: 对账任务复核并维护该列**

锚点：`grep -n "await db.batch(maintenanceStatements);" worker/platform.ts`（当前约 16780）。在这一行之前插入：

```ts
  let taxonomyVerified = false;
  try {
    await assertStoredCatalogTaxonomyIntegrity(db);
    taxonomyVerified = true;
  } catch {
    taxonomyVerified = false;
  }
  maintenanceStatements.push(
    db.prepare(
      taxonomyVerified
        ? `UPDATE catalog_sync_state
           SET taxonomy_verified_generation = last_success_generation
           WHERE id = 1`
        : `UPDATE catalog_sync_state
           SET taxonomy_verified_generation = NULL
           WHERE id = 1`,
    ),
  );
```

并在最终 `return jsonResponse({ proxy: {...` 的对象里加一项 `catalog: { taxonomyVerified },`。

**Step 7: 运行通过并跑全量回归**

Run: `npm run build && node --test --test-name-pattern "re-verifies stored taxonomy" tests/rendered-html.test.mjs`
Expected: `# pass 1`。

Run: `npm run build && node --test tests/rendered-html.test.mjs`
Expected: `# fail 0`。若 "never reports live readiness for non-canonical stored taxonomy" 失败，确认它访问的是 `/api/readiness` 或 `/api/health`（这两处已启用 `verifyTaxonomy`）；若它直接调用代理，在该用例里先执行一次 `/api/admin/reconcile` 再断言。

**Step 8: Commit**

```bash
git add worker/platform.ts tests/rendered-html.test.mjs
git commit -m "perf(readiness): verify catalog taxonomy at publish and reconcile time"
```

---

### Task 6: readiness 缓存接线、上游上下文复用、删除热路径 GC 与重复心跳查询

**Files:**
- Modify: `worker/platform.ts:33`（模块头部）
- Modify: `worker/platform.ts:147-200`（`PlatformEnv`）
- Modify: `worker/platform.ts:18414`（`operationalReadiness` 拆成 compute + 缓存包装）
- Modify: `worker/platform.ts:7546-7660`、`7912-7925`、`8055-8093`（`handleProxyRequest`）
- Modify: `worker/platform.ts:16958`、`18090-18111`（凭据状态去重）
- Modify: 四处 `marketplaceOverlayCache.delete(env as object)` 与若干管理端成功返回处
- Test: `tests/rendered-html.test.mjs`

**Step 1: 写失败的集成测试**

在测试文件顶部 `const TEST_CATALOG_GENERATION = ...` 之后加：

```js
const D1_ROUND_TRIP_BUDGET = 20;
```

文末追加：

```js
test("serves one billable call within the D1 round-trip budget and refreshes readiness after catalog changes", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({
    DB: db,
    READINESS_CACHE_TTL_MS: "10000",
    RESELLER_AUTHORIZED: "true",
    LEGAL_REVIEW_CONFIRMED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
    UPSTREAM_API_KEY: "upstream-secret",
    CATALOG_SYNC_SECRET: "catalog-sync-secret-32-characters-minimum",
    RECONCILIATION_SECRET: "reconcile-secret-32-characters-minimum",
  });
  const createKey = await fetchWorker(
    "/api/keys",
    {
      method: "POST",
      headers: signedInHeaders(),
      body: JSON.stringify({ label: "budget key" }),
    },
    env,
  );
  assert.equal(createKey.status, 201);
  const created = (await createKey.json()).key;
  const user = db.raw
    .prepare("SELECT id FROM users WHERE email = ?")
    .get("owner@example.com");
  const path = "/v1/tiktok/web/fetch_user_profile";
  enableCatalogEndpoint(db, path, 2000, "upstream-secret");
  db.raw
    .prepare(
      `INSERT INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id)
       VALUES ('seed-budget', ?, 'test_credit', 1000000, 'test:budget')`,
    )
    .run(user.id);
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ code: 200, data: { uniqueId: "budget" }, request_id: "r" });
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });
  const call = (key) =>
    fetchWorker(
      `${path}?uniqueId=budget`,
      {
        headers: {
          authorization: `Bearer ${created.secret}`,
          "idempotency-key": key,
        },
      },
      env,
    );

  db.resetStats({ trace: true });
  assert.equal((await call("budget-001")).status, 200);
  const coldRoundTrips = db.stats.roundTrips;

  db.resetStats({ trace: true });
  assert.equal((await call("budget-002")).status, 200);
  const warmRoundTrips = db.stats.roundTrips;
  assert.ok(
    warmRoundTrips < coldRoundTrips,
    `cached readiness must cut round trips (${warmRoundTrips} vs ${coldRoundTrips})`,
  );
  assert.ok(
    warmRoundTrips <= D1_ROUND_TRIP_BUDGET,
    `warm call used ${warmRoundTrips} round trips:\n${db.stats.trace.join("\n")}`,
  );

  const revision = db.raw
    .prepare("SELECT revision FROM endpoint_catalog WHERE path = ?")
    .get(path).revision;
  const disable = await fetchWorker(
    "/api/admin/catalog",
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${env.CATALOG_SYNC_SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        path,
        enabled: false,
        readOnly: false,
        customerPriceUsdMicros: 2000,
        expectedRevision: revision,
      }),
    },
    env,
  );
  assert.equal(disable.status, 200);
  const afterDisable = await call("budget-003");
  assert.equal(afterDisable.status, 503);
  assert.equal((await afterDisable.json()).error.code, "service_not_ready");
});
```

**Step 2: 运行确认失败**

Run: `npm run build && node --test --test-name-pattern "round-trip budget" tests/rendered-html.test.mjs`
Expected: FAIL（`warmRoundTrips < coldRoundTrips` 不成立，或预算超出）。

**Step 3: 环境变量与缓存包装**

3a. `PlatformEnv` 接口（`grep -n "export interface PlatformEnv" worker/platform.ts`）中 `TRUST_SITES_IDENTITY_HEADERS?: string;` 之后加：

```ts
  READINESS_CACHE_TTL_MS?: string;
```

3b. 文件顶部 `const JSON_HEADERS = {...};` 之前加 import，之后加类型与缓存实例：

```ts
import { TtlCache, parseTtlMs } from "./lib/ttl-cache";
```

```ts
type OperationalReadiness = Awaited<
  ReturnType<typeof computeOperationalReadiness>
>;
const readinessCache = new TtlCache<OperationalReadiness>();
```

3c. 把 `async function operationalReadiness(env: PlatformEnv, options: { verifyTaxonomy?: boolean } = {}) {` 改名为 `computeOperationalReadiness`（同样签名），并在它上方新增：

```ts
async function operationalReadiness(
  env: PlatformEnv,
  options: { verifyTaxonomy?: boolean } = {},
): Promise<OperationalReadiness> {
  const ttlMs = parseTtlMs(env.READINESS_CACHE_TTL_MS, 10_000, 60_000);
  if (options.verifyTaxonomy || ttlMs === 0 || !env.DB) {
    return await computeOperationalReadiness(env, options);
  }
  return await readinessCache.remember(env as object, ttlMs, () =>
    computeOperationalReadiness(env, options),
  );
}

function invalidateRuntimeCaches(env: PlatformEnv): void {
  readinessCache.delete(env as object);
  marketplaceOverlayCache.delete(env as object);
}
```

3d. 在 `computeOperationalReadiness` 里，`let upstreamConfigured = base.capabilities.upstreamConfigured;` 之后加：

```ts
  let upstream: {
    sourceConfig: UpstreamSourceConfig;
    credential: ResolvedUpstreamProviderCredential;
  } | null = null;
```

在 `upstreamConfigured = Boolean(resolved);` 之后加：

```ts
        if (sourceConfig && resolved) {
          upstream = { sourceConfig, credential: resolved };
        }
```

返回对象里 `missing,` 之后加 `upstream,`。

**Step 4: 代理复用 readiness 的上游上下文，删除重复心跳查询与随机 GC**

4a. 锚点 `grep -n "let reconciliationRecent = false;" worker/platform.ts`（`handleProxyRequest` 内，当前约 7604）。把从这一行到 `throw new PlatformError(503, "reconciliation_stale", ...)` 的整个 `if` 块结束为止，替换为：

```ts
  if (!readiness.capabilities.reconciliationRecent) {
    throw new PlatformError(
      503,
      "reconciliation_stale",
      "自动对账心跳已超时，已停止真实调用与扣费。",
    );
  }
```

4b. 锚点 `grep -n "const sourceConfig = await loadUpstreamSourceConfig(db, env, true);" worker/platform.ts` 中位于 `handleProxyRequest` 的那一处（当前 7912）。把它和紧随的 `const upstreamCredential = await resolveUpstreamProviderCredential(env, db, sourceConfig);` 替换为：

```ts
  const upstream = readiness.upstream;
  if (!upstream) {
    throw new PlatformError(
      503,
      "upstream_not_configured",
      "UpstreamProvider 服务端密钥尚未配置。",
    );
  }
  const sourceConfig = upstream.sourceConfig;
  const upstreamCredential = upstream.credential;
```

紧随其后的 `if (!upstreamCredential) { throw ... upstream_not_configured }` 块删除。

4c. 锚点 `grep -n "crypto.getRandomValues(new Uint8Array(1))\[0\] === 0" worker/platform.ts`（当前约 8055）。删除整个 `if (...) { ctx.waitUntil(...) ×4 }` 块。这些清理已在对账维护语句中存在。

**Step 5: 凭据状态去重**

`managedUpstreamProviderCredentialsSnapshot(db: D1Database)` 改为：

```ts
async function managedUpstreamProviderCredentialsSnapshot(
  db: D1Database,
  preloadedState?: Awaited<ReturnType<typeof upstreamCredentialState>>,
): Promise<{...保持原返回类型...}> {
  const state = preloadedState ?? (await upstreamCredentialState(db));
```

在 `resolveUpstreamProviderCredentialsForPath` 里把 `const snapshot = await managedUpstreamProviderCredentialsSnapshot(db);` 改为 `const snapshot = await managedUpstreamProviderCredentialsSnapshot(db, state);`。

**Step 6: 失效点**

6a. 把四处 `marketplaceOverlayCache.delete(env as object);`（锚点 `grep -n "marketplaceOverlayCache.delete(env as object)" worker/platform.ts`）全部改为 `invalidateRuntimeCaches(env);`。

6b. 在下列处理函数中，每个"写入成功后"的 `return jsonResponse(` 之前插入 `invalidateRuntimeCaches(env);`：

```bash
grep -n "^async function handleCatalogSync\|^async function handleCatalogBatchApply\|^async function handleUpstreamConfigPut\|^async function handleUpstreamCredentialCreate\|^async function handleUpstreamCredentialUpdate\|^async function handleReconciliation" worker/platform.ts
```

（`handleReconciliation` 在 `await db.batch(maintenanceStatements);` 之后插入。）

**Step 7: 运行通过并全量回归**

Run: `npm run build && node --test --test-name-pattern "round-trip budget" tests/rendered-html.test.mjs`
Expected: `# pass 1`。如果预算超出，测试输出会打印每条 SQL 的前 90 个字符；用它对照文末的往返清单定位多余语句。

Run: `npm run build && node --test tests/rendered-html.test.mjs && npm run typecheck && npm run lint`
Expected: 全部通过。

**Step 8: Commit**

```bash
git add worker/platform.ts tests/rendered-html.test.mjs
git commit -m "perf(proxy): cache readiness per isolate and reuse resolved upstream context"
```

---

### Task 7: 上游尝试后的四次写入合并为一个 batch

**Files:**
- Modify: `worker/platform.ts:7045-7231`（`recordUpstreamAttemptHealth`、`logUpstreamAttempt` 改为语句构造器）
- Modify: `worker/platform.ts:7464-7492`（`routedUpstreamFetch` 内的三次 await）
- Test: `tests/rendered-html.test.mjs`（预算常量）

**Step 1: 收紧预算**

把 `const D1_ROUND_TRIP_BUDGET = 20;` 改为 `17`。

Run: `npm run build && node --test --test-name-pattern "round-trip budget" tests/rendered-html.test.mjs`
Expected: FAIL（超出 17）。

**Step 2: 改为语句构造器**

把 `async function recordUpstreamAttemptHealth(...): Promise<void>` 改名为 `upstreamAttemptHealthStatements`，返回 `D1PreparedStatement[]`：函数体内的计算保持不变，`if (credential.id) { await db.prepare(...).bind(...).run(); }` 改为 `if (credential.id) statements.push(db.prepare(...).bind(...));`，末尾的路由健康语句同样 `statements.push(...)`，最后 `return statements;`。开头声明 `const statements: D1PreparedStatement[] = [];`。

把 `async function logUpstreamAttempt(db, input): Promise<void>` 改名为 `upstreamAttemptLogStatement`，返回 `D1PreparedStatement`：去掉 `await` 与 `.run()`，直接 `return db.prepare(...).bind(...);`。

**Step 3: 在 `routedUpstreamFetch` 中合批**

把这三段：

```ts
    await recordUpstreamAttemptHealth(input.db, selected, input.endpointPath, statusCode, errorCode, latencyMs, retryAfterSeconds);
    await logUpstreamAttempt(input.db, { ... });
    if (selected.id) {
      await input.db.prepare(`UPDATE upstream_credentials SET last_used_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL`).bind(selected.id).run();
    }
```

替换为：

```ts
    const attemptStatements: D1PreparedStatement[] = [
      ...upstreamAttemptHealthStatements(
        input.db,
        selected,
        input.endpointPath,
        statusCode,
        errorCode,
        latencyMs,
        retryAfterSeconds,
      ),
      upstreamAttemptLogStatement(input.db, {
        contextType: input.contextType,
        contextId: input.contextId,
        endpointPath: input.endpointPath,
        credential: selected,
        attemptNumber: attempt,
        outcome:
          statusCode === 200
            ? "success"
            : errorCode ??
              (statusCode === 429 ? "rate_limited" : "upstream_error"),
        statusCode,
        latencyMs,
        upstreamRequestId:
          response?.headers.get("x-request-id")?.slice(0, 160) ?? null,
        targetCount: Math.max(1, input.targetCount ?? 1),
        paginationUnitCount: Math.max(0, input.paginationUnitCount ?? 0),
      }),
    ];
    if (selected.id) {
      attemptStatements.push(
        input.db
          .prepare(
            `UPDATE upstream_credentials
             SET last_used_at = CURRENT_TIMESTAMP
             WHERE id = ? AND revoked_at IS NULL`,
          )
          .bind(selected.id),
      );
    }
    await input.db.batch(attemptStatements);
```

**Step 4: 运行通过并回归**

Run: `npm run build && node --test --test-name-pattern "round-trip budget|fails over once|x402 wallet-paid batch" tests/rendered-html.test.mjs`
Expected: `# fail 0`。

**Step 5: Commit**

```bash
git add worker/platform.ts tests/rendered-html.test.mjs
git commit -m "perf(routing): batch upstream attempt health, log and last-used writes"
```

---

### Task 8: 代次校验并入目录查询、扣款与标记合批、余额并入日志 batch（预算 15）

**Files:**
- Modify: `worker/platform.ts:223-245`（`CatalogRecord`）
- Modify: `worker/platform.ts:7926-7968`（目录查询与代次校验）
- Modify: `worker/platform.ts:8080-8124`（扣款 + `markProxyRequest("charged")`）
- Modify: `worker/platform.ts:19271-19340`（`logApiCall`）
- Modify: `worker/platform.ts:8306-8345`（成功路径取余额）

**Step 1: 收紧预算**

`D1_ROUND_TRIP_BUDGET` 改为 `15`。运行预算测试，Expected: FAIL。

**Step 2: 目录查询带出代次校验字段**

`CatalogRecord` 类型末尾加：

```ts
  in_latest_generation: number;
  sync_credential_source: string | null;
  sync_credential_id: string | null;
  sync_credential_fingerprint: string | null;
  sync_credential_state_version: number | null;
  sync_source_config_version: number | null;
  sync_source_config_hash: string | null;
```

`handleProxyRequest` 的目录 SELECT（锚点 `grep -n "AS coverage_verified," worker/platform.ts` 中位于 7900 之后的那一处）在 `AS coverage_verified,` 之后加：

```sql
                EXISTS(
                  SELECT 1 FROM catalog_sync_state
                  WHERE id = 1
                    AND last_success_generation = endpoint_catalog.sync_generation
                ) AS in_latest_generation,
                (SELECT credential_source FROM catalog_sync_state WHERE id = 1)
                  AS sync_credential_source,
                (SELECT credential_id FROM catalog_sync_state WHERE id = 1)
                  AS sync_credential_id,
                (SELECT credential_fingerprint FROM catalog_sync_state WHERE id = 1)
                  AS sync_credential_fingerprint,
                (SELECT credential_state_version FROM catalog_sync_state WHERE id = 1)
                  AS sync_credential_state_version,
                (SELECT source_config_version FROM catalog_sync_state WHERE id = 1)
                  AS sync_source_config_version,
                (SELECT source_config_hash FROM catalog_sync_state WHERE id = 1)
                  AS sync_source_config_hash,
```

确认该 SELECT 的 `FROM endpoint_catalog` 没有别名；若有别名，把 `endpoint_catalog.sync_generation` 改成对应别名。

把 `const currentCatalogCredential = await db.prepare(...).bind(...).first<{ matches_current: number }>();` 与其后的 `if (Number(currentCatalogCredential?.matches_current ?? 0) !== 1) { throw ... catalog_credential_changed }` 替换为：

```ts
  const catalogMatchesCredential =
    Number(catalog.in_latest_generation) === 1 &&
    catalog.sync_credential_source === upstreamCredential.source &&
    (catalog.sync_credential_id ?? null) === (upstreamCredential.id ?? null) &&
    catalog.sync_credential_fingerprint === upstreamCredential.fingerprint &&
    Number(catalog.sync_credential_state_version) ===
      upstreamCredential.stateVersion &&
    Number(catalog.sync_source_config_version) === sourceConfig.version &&
    catalog.sync_source_config_hash === sourceConfig.hash;
  if (!catalogMatchesCredential) {
    throw new PlatformError(
      409,
      "catalog_credential_changed",
      "UpstreamProvider 活动凭据在请求准备期间发生变化，请稍后重试。",
    );
  }
```

**Step 3: 扣款与标记 charged 合批**

把 `const debitResult = await db.prepare(\`INSERT INTO balance_ledger ...\`).bind(...).run();` 改为：

```ts
  const [debitResult] = await db.batch([
    db
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
      ),
    db
      .prepare(
        `UPDATE proxy_requests
         SET status = 'charged'
         WHERE id = ? AND status = 'processing'
           AND EXISTS (
             SELECT 1 FROM balance_ledger WHERE reference_id = ?
           )`,
      )
      .bind(requestId, ledgerReferenceId),
  ]);
```

保留原来的 `if (Number(debitResult.meta?.changes ?? 0) !== 1) { DELETE 预留; throw 402 }`，并删除其后的 `await markProxyRequest(db, requestId, "charged", null);`。

**Step 4: `logApiCall` 顺带返回余额**

`logApiCall` 返回类型改为 `Promise<number | null>`；batch 数组末尾追加第 4 条语句：

```ts
    db
      .prepare(
        `SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance
         FROM balance_ledger
         WHERE user_id = ?`,
      )
      .bind(input.key.user_id),
```

函数体改为 `const results = await db.batch([...]);` 后：

```ts
  const balanceRow = (results[3] as D1Result<{ balance: number }> | undefined)
    ?.results?.[0];
  return balanceRow ? Number(balanceRow.balance) : null;
```

成功路径（锚点 `grep -n "const balance = await currentBalance(db, key.user_id);" worker/platform.ts`）：在 `try {` 之前声明 `let balance: number | null = null;`，把 `await logApiCall(db, {...})` 改为 `balance = await logApiCall(db, {...})`，把 `const balance = await currentBalance(db, key.user_id);` 改为 `if (balance == null) balance = await currentBalance(db, key.user_id);`。失败路径里对 `logApiCall` 的调用不用改（忽略返回值）。

**Step 5: 运行通过并回归**

Run: `npm run build && node --test --test-name-pattern "round-trip budget|idempotent billing|fails over once" tests/rendered-html.test.mjs`
Expected: `# fail 0`。

若预算仍是 16，看 trace：最常见的多余语句是 `resolveUpstreamProviderCredential` 内部重复读取 `upstream_credential_state`。此时给 `resolveUpstreamProviderCredential` 增加可选的 `preloadedState` 参数，并在 `resolveUpstreamProviderCredentialsForPath` 的环境凭据分支把 `state` 传入。不要放宽预算。

Run: `npm run build && node --test tests/rendered-html.test.mjs`
Expected: `# fail 0`。

**Step 6: Commit**

```bash
git add worker/platform.ts tests/rendered-html.test.mjs
git commit -m "perf(proxy): fold generation pinning, charge marking and balance read into existing statements"
```

---

### Task 9: 余额快照

**Files:**
- Create: `worker/lib/balance-sql.ts`
- Create: `tests/unit/balance-sql.test.mjs`
- Modify: `worker/platform.ts`（扣款 WHERE、`logApiCall` 余额、`currentBalance`、`handleDashboard` 的余额查询、对账维护语句）
- Test: `tests/rendered-html.test.mjs`

**Step 1: 单元测试**

```js
// tests/unit/balance-sql.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  AVAILABLE_BALANCE_SQL,
  SNAPSHOT_MARGIN_SECONDS,
  availableBalanceBindings,
} from "../../worker/lib/balance-sql.ts";

test("balance expression binds the user id exactly three times", () => {
  const placeholders = (AVAILABLE_BALANCE_SQL.match(/\?/g) ?? []).length;
  assert.equal(placeholders, 3);
  assert.deepEqual(availableBalanceBindings("usr_1"), ["usr_1", "usr_1", "usr_1"]);
  assert.match(AVAILABLE_BALANCE_SQL, /balance_snapshots/);
  assert.match(AVAILABLE_BALANCE_SQL, /datetime\(l\.created_at\) > datetime\(/);
  assert.equal(SNAPSHOT_MARGIN_SECONDS, 5);
});
```

Run: `npm run test:unit` → Expected: FAIL（模块不存在）。

**Step 2: 实现**

```ts
// worker/lib/balance-sql.ts
export const SNAPSHOT_MARGIN_SECONDS = 5;

/** 可用余额 = 快照余额 + 快照边界之后的账本增量；三个 ? 都绑定 user_id。 */
export const AVAILABLE_BALANCE_SQL = `(
  COALESCE(
    (SELECT s.balance_usd_micros FROM balance_snapshots s WHERE s.user_id = ?),
    0
  ) + COALESCE(
    (SELECT SUM(l.delta_usd_micros)
     FROM balance_ledger l
     WHERE l.user_id = ?
       AND datetime(l.created_at) > datetime(
         COALESCE(
           (SELECT s2.through_created_at
            FROM balance_snapshots s2
            WHERE s2.user_id = ?),
           '1970-01-01 00:00:00'
         )
       )),
    0
  )
)`;

export function availableBalanceBindings(
  userId: string,
): [string, string, string] {
  return [userId, userId, userId];
}

/** 对最近一天有账本活动的用户重算快照；边界留出安全余量避免与并发写入竞争。 */
export const REFRESH_BALANCE_SNAPSHOTS_SQL = `
  INSERT INTO balance_snapshots
    (user_id, balance_usd_micros, through_created_at, updated_at)
  SELECT l.user_id,
         COALESCE(SUM(l.delta_usd_micros), 0),
         datetime('now', '-${SNAPSHOT_MARGIN_SECONDS} seconds'),
         CURRENT_TIMESTAMP
  FROM balance_ledger l
  WHERE datetime(l.created_at) <= datetime('now', '-${SNAPSHOT_MARGIN_SECONDS} seconds')
    AND l.user_id IN (
      SELECT DISTINCT user_id
      FROM balance_ledger
      WHERE datetime(created_at) > datetime('now', '-1 day')
    )
  GROUP BY l.user_id
  ON CONFLICT(user_id) DO UPDATE SET
    balance_usd_micros = excluded.balance_usd_micros,
    through_created_at = excluded.through_created_at,
    updated_at = CURRENT_TIMESTAMP`;
```

Run: `npm run test:unit` → Expected: `# fail 0`。

**Step 3: 写失败的集成测试**

```js
test("debits against balance snapshots plus incremental ledger rows", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({
    DB: db,
    RESELLER_AUTHORIZED: "true",
    LEGAL_REVIEW_CONFIRMED: "true",
    UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED: "true",
    UPSTREAM_API_KEY: "upstream-secret",
    RECONCILIATION_SECRET: "reconcile-secret-32-characters-minimum",
  });
  const createKey = await fetchWorker(
    "/api/keys",
    { method: "POST", headers: signedInHeaders(), body: JSON.stringify({ label: "snapshot key" }) },
    env,
  );
  const created = (await createKey.json()).key;
  const user = db.raw
    .prepare("SELECT id FROM users WHERE email = ?")
    .get("owner@example.com");
  const path = "/v1/tiktok/web/fetch_user_profile";
  enableCatalogEndpoint(db, path, 2000, "upstream-secret");
  db.raw
    .prepare(
      `INSERT INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id, created_at)
       VALUES ('snap-1', ?, 'test_credit', 5000, 'test:snap-1', '2026-01-01 00:00:00'),
              ('snap-2', ?, 'test_debit', -1000, 'test:snap-2', '2026-01-02 00:00:00')`,
    )
    .run(user.id, user.id);
  const reconcile = await fetchWorker(
    "/api/admin/reconcile",
    { method: "POST", headers: { authorization: `Bearer ${env.RECONCILIATION_SECRET}` } },
    env,
  );
  assert.equal(reconcile.status, 200);
  assert.equal(
    db.raw.prepare("SELECT balance_usd_micros AS b FROM balance_snapshots WHERE user_id = ?").get(user.id).b,
    4000,
  );
  db.raw
    .prepare(
      `INSERT INTO balance_ledger
       (id, user_id, entry_type, delta_usd_micros, reference_id)
       VALUES ('snap-3', ?, 'test_credit', 1000, 'test:snap-3')`,
    )
    .run(user.id);

  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ code: 200, data: { ok: true }, request_id: "r" });
  t.after(() => {
    globalThis.fetch = nativeFetch;
  });
  const call = (key) =>
    fetchWorker(
      `${path}?uniqueId=snapshot`,
      { headers: { authorization: `Bearer ${created.secret}`, "idempotency-key": key } },
      env,
    );
  const first = await call("snap-call-1");
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-relaybase-balance-usd-micros"), "3000");
  const second = await call("snap-call-2");
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-relaybase-balance-usd-micros"), "1000");
  const third = await call("snap-call-3");
  assert.equal(third.status, 402);
  assert.equal((await third.json()).error.code, "insufficient_balance");
});
```

Run: `npm run build && node --test --test-name-pattern "balance snapshots plus incremental" tests/rendered-html.test.mjs`
Expected: FAIL（`balance_snapshots` 为空）。

**Step 4: 接线**

4a. `import { AVAILABLE_BALANCE_SQL, REFRESH_BALANCE_SNAPSHOTS_SQL, availableBalanceBindings } from "./lib/balance-sql";`

4b. 扣款语句的 `WHERE (SELECT COALESCE(SUM(delta_usd_micros), 0) FROM balance_ledger WHERE user_id = ?) >= ?` 改为 `WHERE ${AVAILABLE_BALANCE_SQL} >= ?`，`.bind(...)` 里把对应的单个 `key.user_id` 改为 `...availableBalanceBindings(key.user_id)`（保持 `costUsdMicros` 在最后）。

4c. `logApiCall` 第 4 条语句改为 `SELECT ${AVAILABLE_BALANCE_SQL} AS balance` 并 `.bind(...availableBalanceBindings(input.key.user_id))`。

4d. `currentBalance` 改为同一表达式：

```ts
  const row = await db
    .prepare(`SELECT ${AVAILABLE_BALANCE_SQL} AS balance`)
    .bind(...availableBalanceBindings(userId))
    .first<{ balance: number }>();
```

4e. `handleDashboard` 里的余额查询（锚点 `grep -n "SELECT COALESCE(SUM(delta_usd_micros), 0) AS balance" worker/platform.ts` 中位于 `handleDashboard` 内的那处，当前约 2574）同样替换。

4f. 对账维护：在 `maintenanceStatements` 数组的第一条语句之前加 `db.prepare(REFRESH_BALANCE_SNAPSHOTS_SQL),`。

**Step 5: 运行通过并回归**

Run: `npm run build && node --test --test-name-pattern "balance snapshots plus incremental|round-trip budget|idempotent billing" tests/rendered-html.test.mjs`
Expected: `# fail 0`。

Run: `npm run build && node --test tests/rendered-html.test.mjs`
Expected: `# fail 0`。

**Step 6: Commit**

```bash
git add worker/lib/balance-sql.ts tests/unit/balance-sql.test.mjs worker/platform.ts tests/rendered-html.test.mjs
git commit -m "perf(billing): compute available balance from snapshots plus incremental ledger rows"
```

---

### Task 10: 对账为无扣款的过期请求引入 abandoned 终态

**Files:**
- Modify: `worker/platform.ts:16265-16330`（`handleReconciliation` 过期请求段）
- Modify: `worker/platform.ts:19250-19270`（`markProxyRequest`）
- Test: `tests/rendered-html.test.mjs`

**Step 1: 写失败的集成测试**

```js
test("marks reserved-but-never-debited requests abandoned so the reconciliation window cannot starve", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({
    DB: db,
    RECONCILIATION_SECRET: "reconcile-secret-32-characters-minimum",
  });
  const createKey = await fetchWorker(
    "/api/keys",
    { method: "POST", headers: signedInHeaders(), body: JSON.stringify({ label: "stale key" }) },
    env,
  );
  const created = (await createKey.json()).key;
  const user = db.raw
    .prepare("SELECT id FROM users WHERE email = ?")
    .get("owner@example.com");
  const insertRequest = (id, status, hasDebit) => {
    db.raw
      .prepare(
        `INSERT INTO proxy_requests
         (id, api_key_id, user_id, idempotency_hash, ledger_reference_id,
          path, status, cost_usd_micros, created_at)
         VALUES (?, ?, ?, ?, ?, '/v1/tiktok/web/fetch_user_profile', ?, 2000,
                 datetime('now', '-3 minutes'))`,
      )
      .run(id, created.id, user.id, `hash-${id}`, `api:${id}:debit`, status);
    if (hasDebit) {
      db.raw
        .prepare(
          `INSERT INTO balance_ledger
           (id, user_id, entry_type, delta_usd_micros, reference_id)
           VALUES (?, ?, 'api_debit', -2000, ?)`,
        )
        .run(`led-${id}`, user.id, `api:${id}:debit`);
    }
  };
  insertRequest("req-orphan", "processing", false);
  insertRequest("req-charged", "charged", true);

  const reconcile = await fetchWorker(
    "/api/admin/reconcile",
    { method: "POST", headers: { authorization: `Bearer ${env.RECONCILIATION_SECRET}` } },
    env,
  );
  assert.equal(reconcile.status, 200);
  const body = await reconcile.json();
  assert.equal(body.proxy.abandoned, 1);
  assert.equal(body.proxy.refunded, 1);
  const statuses = Object.fromEntries(
    db.raw
      .prepare("SELECT id, status FROM proxy_requests")
      .all()
      .map((row) => [row.id, row.status]),
  );
  assert.equal(statuses["req-orphan"], "abandoned");
  assert.equal(statuses["req-charged"], "reconciled");
  assert.equal(
    db.raw.prepare("SELECT COUNT(*) AS c FROM balance_ledger WHERE reference_id = 'api:req-orphan:debit:refund'").get().c,
    0,
  );
});
```

Run: `npm run build && node --test --test-name-pattern "abandoned so the reconciliation" tests/rendered-html.test.mjs`
Expected: FAIL（`body.proxy.abandoned` 为 undefined，且 `req-orphan` 仍是 `processing`）。

**Step 2: 实现**

2a. `import { type ProxyRequestStatus, terminalProxyRequestStatusSql } from "./lib/proxy-request-status";`

2b. 在 `handleReconciliation` 里 `const stale = await db.prepare(...)` 之前插入：

```ts
  const abandoned = await db
    .prepare(
      `UPDATE proxy_requests
       SET status = 'abandoned', response_status = 500,
           completed_at = CURRENT_TIMESTAMP
       WHERE status = 'processing'
         AND datetime(created_at) < datetime('now', '-2 minutes')
         AND NOT EXISTS (
           SELECT 1 FROM balance_ledger
           WHERE balance_ledger.reference_id = proxy_requests.ledger_reference_id
         )`,
    )
    .run();
  const abandonedCount = Number(abandoned.meta?.changes ?? 0);
```

过期查询的 `WHERE status IN ('processing', 'charged')` 保持不变（abandoned 已不在其中）。响应体 `proxy: { inspected, refunded }` 改为 `proxy: { inspected: stale.results?.length ?? 0, refunded, abandoned: abandonedCount }`。

2c. `markProxyRequest` 的参数 `status: string` 改为 `status: ProxyRequestStatus`，SQL 里的 `WHEN ? IN ('completed', 'refunded', 'reconciled', 'rate_limited', 'insufficient_balance')` 改为 `WHEN ? IN (${terminalProxyRequestStatusSql()})`。

**Step 3: 运行通过并回归**

Run: `npm run build && node --test --test-name-pattern "abandoned so the reconciliation|scheduled handler|idempotent billing" tests/rendered-html.test.mjs && npm run typecheck`
Expected: 全部通过。

**Step 4: Commit**

```bash
git add worker/platform.ts tests/rendered-html.test.mjs
git commit -m "fix(reconcile): abandon reserved requests that never debited"
```

---

### Task 11: x402 清扫、失败分支释放租约、租约回收

**Files:**
- Modify: `worker/platform.ts:16690-16790`（对账维护）
- Modify: `worker/platform.ts:4655-4700`、`4752-4800`（失败分支）
- Test: `tests/rendered-html.test.mjs`

**Step 1: 写失败的集成测试**

```js
function seedX402Batch(db, { id, status, endpoint, updatedAt, executionStartedAt = null }) {
  db.raw
    .prepare(
      `INSERT INTO x402_batches
       (id, idempotency_hash, endpoint_path, request_hash, verified_quantity,
        unit_price_usd_micros, amount_usdc_atomic, asset, pay_to,
        payment_requirements_json, facilitator_mode, status, expires_at,
        execution_started_at, created_at, quoted_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 3000, 3000, '0xasset', '0xpayto', '{}', 'custom', ?,
               datetime('now', '+10 minutes'), ?, ?, ?, ?)`,
    )
    .run(id, `idem-${id}`, endpoint, `req-${id}`, status, executionStartedAt, updatedAt, updatedAt, updatedAt);
  db.raw
    .prepare(
      `INSERT INTO upstream_capacity_leases
       (id, context_type, context_id, capacity_group_id, endpoint_path,
        planned_requests, status, expires_at)
       VALUES (?, 'x402', ?, 'environment-primary', ?, 1, 'reserved',
               datetime('now', '+1 minute'))`,
    )
    .run(`lease-${id}`, id, endpoint);
}

test("sweeps stuck x402 batches during reconciliation and releases their leases", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const endpoint = "/v1/tiktok/web/fetch_user_profile";
  enableCatalogEndpoint(db, endpoint, 2000);
  const env = baseEnv({
    DB: db,
    RECONCILIATION_SECRET: "reconcile-secret-32-characters-minimum",
  });
  const old = "2020-01-01 00:00:00";
  seedX402Batch(db, { id: "xb_stale_verifying_000000000000", status: "payment_verifying", endpoint, updatedAt: old });
  seedX402Batch(db, { id: "xb_stale_pending_0000000000000", status: "settlement_pending", endpoint, updatedAt: old });
  seedX402Batch(db, { id: "xb_stale_executing_00000000000", status: "executing", endpoint, updatedAt: old, executionStartedAt: old });
  seedX402Batch(db, { id: "xb_fresh_quoted_00000000000000", status: "quoted", endpoint, updatedAt: old });

  const reconcile = await fetchWorker(
    "/api/admin/reconcile",
    { method: "POST", headers: { authorization: `Bearer ${env.RECONCILIATION_SECRET}` } },
    env,
  );
  assert.equal(reconcile.status, 200);
  const body = await reconcile.json();
  assert.deepEqual(body.x402, { staleVerifications: 1, staleSettlements: 1, staleExecutions: 1 });
  const rows = Object.fromEntries(
    db.raw
      .prepare("SELECT id, status, failure_code FROM x402_batches")
      .all()
      .map((row) => [row.id, row]),
  );
  assert.equal(rows["xb_stale_verifying_000000000000"].status, "settlement_failed");
  assert.equal(rows["xb_stale_verifying_000000000000"].failure_code, "stale_payment_verifying");
  assert.equal(rows["xb_stale_pending_0000000000000"].failure_code, "stale_settlement_pending_manual_review");
  assert.equal(rows["xb_stale_executing_00000000000"].status, "execution_failed");
  assert.equal(rows["xb_fresh_quoted_00000000000000"].status, "quoted");
  const leases = Object.fromEntries(
    db.raw
      .prepare("SELECT context_id, status FROM upstream_capacity_leases")
      .all()
      .map((row) => [row.context_id, row.status]),
  );
  assert.equal(leases["xb_stale_verifying_000000000000"], "expired");
  assert.equal(leases["xb_fresh_quoted_00000000000000"], "reserved");
});
```

Run: `npm run build && node --test --test-name-pattern "sweeps stuck x402" tests/rendered-html.test.mjs`
Expected: FAIL（`body.x402` 为 undefined）。

**Step 2: 实现清扫**

在 `handleReconciliation` 里、`let taxonomyVerified = false;`（任务 5 加入）之前插入：

```ts
  const x402Sweep = await db.batch([
    db.prepare(
      `UPDATE x402_batches
       SET status = 'settlement_failed', failure_code = 'stale_' || status,
           updated_at = CURRENT_TIMESTAMP
       WHERE status IN ('payment_verifying', 'payment_verified')
         AND datetime(updated_at) < datetime('now', '-10 minutes')`,
    ),
    db.prepare(
      `UPDATE x402_batches
       SET status = 'settlement_failed',
           failure_code = 'stale_settlement_pending_manual_review',
           updated_at = CURRENT_TIMESTAMP
       WHERE status = 'settlement_pending'
         AND datetime(updated_at) < datetime('now', '-10 minutes')`,
    ),
    db.prepare(
      `UPDATE x402_batches
       SET status = 'execution_failed', failure_code = 'stale_executing',
           completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE status = 'executing'
         AND datetime(COALESCE(execution_started_at, updated_at)) <
             datetime('now', '-5 minutes')`,
    ),
    db.prepare(
      `UPDATE upstream_capacity_leases
       SET status = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE context_type = 'x402'
         AND status IN ('reserved', 'consuming')
         AND context_id IN (
           SELECT id FROM x402_batches
           WHERE status IN ('settlement_failed', 'execution_failed',
                            'payment_rejected', 'expired')
         )`,
    ),
  ]);
  const x402SweepCounts = {
    staleVerifications: Number(x402Sweep[0]?.meta?.changes ?? 0),
    staleSettlements: Number(x402Sweep[1]?.meta?.changes ?? 0),
    staleExecutions: Number(x402Sweep[2]?.meta?.changes ?? 0),
  };
```

响应体加 `x402: x402SweepCounts,`。维护语句数组里加一条：

```ts
    db.prepare(
      `DELETE FROM upstream_capacity_leases
       WHERE datetime(expires_at) < datetime('now', '-1 day')`,
    ),
```

**Step 3: 失败分支释放租约**

在 `continueX402Batch` 的四处失败 UPDATE 之后（两处 `SET status = 'payment_rejected'`、两处 `SET status = 'settlement_failed'`，锚点 `grep -n "SET status = 'payment_rejected'\|SET status = 'settlement_failed'" worker/platform.ts`），各自的 `.run();` 之后加：

```ts
    await setX402CapacityLeaseStatus(db, stored.id, "released");
```

**Step 4: 运行通过并回归**

Run: `npm run build && node --test --test-name-pattern "sweeps stuck x402|x402 wallet-paid batch|native batches by logical targets" tests/rendered-html.test.mjs`
Expected: `# fail 0`。

**Step 5: Commit**

```bash
git add worker/platform.ts tests/rendered-html.test.mjs
git commit -m "fix(x402): sweep stuck batches, release leases on failure and recycle expired leases"
```

---

### Task 12: 管理端 x402 批次 resolve 接口

**Files:**
- Modify: `worker/platform.ts:1334-1358`（路由）
- Modify: `worker/platform.ts`（新增 `handleAdminX402BatchResolve`，放在 `handleAdminX402RuntimeConfig` 之后）
- Test: `tests/rendered-html.test.mjs`

**Step 1: 写失败的集成测试**

```js
test("lets an owner resolve a failed x402 settlement with an on-chain receipt exactly once", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const endpoint = "/v1/tiktok/web/fetch_user_profile";
  enableCatalogEndpoint(db, endpoint, 2000);
  const env = baseEnv({
    DB: db,
    ADMIN_MASTER_SECRET: "x402-admin-secret-32-characters-minimum",
  });
  seedX402Batch(db, { id: "xb_failed_settlement_000000000", status: "settlement_failed", endpoint, updatedAt: "2020-01-01 00:00:00" });
  seedX402Batch(db, { id: "xb_failed_settlement_000000001", status: "settlement_failed", endpoint, updatedAt: "2020-01-01 00:00:00" });
  const resolve = (id, body) =>
    fetchWorker(
      `/api/admin/x402/batches/${id}/resolve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.ADMIN_MASTER_SECRET}`,
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
      env,
    );
  const txHash = `0x${"a".repeat(64)}`;
  const first = await resolve("xb_failed_settlement_000000000", {
    action: "mark_settled_manually",
    transactionHash: txHash,
    note: "Verified on Basescan by operator",
  });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).batch.status, "settled");
  assert.equal(
    db.raw.prepare("SELECT COUNT(*) AS c FROM admin_audit_logs WHERE action = 'x402.batch.mark_settled_manually'").get().c,
    1,
  );
  const replay = await resolve("xb_failed_settlement_000000000", {
    action: "mark_settled_manually",
    transactionHash: txHash,
    note: "Verified on Basescan by operator",
  });
  assert.equal(replay.status, 409);
  const duplicateReceipt = await resolve("xb_failed_settlement_000000001", {
    action: "mark_settled_manually",
    transactionHash: txHash,
    note: "Same receipt reused",
  });
  assert.equal(duplicateReceipt.status, 409);
  assert.equal((await duplicateReceipt.json()).error.code, "x402_receipt_conflict");
  const expired = await resolve("xb_failed_settlement_000000001", {
    action: "mark_expired",
    note: "No funds observed on chain",
  });
  assert.equal(expired.status, 200);
  assert.equal((await expired.json()).batch.status, "expired");
  assert.equal(
    db.raw.prepare("SELECT status FROM upstream_capacity_leases WHERE context_id = 'xb_failed_settlement_000000001'").get().status,
    "released",
  );
});
```

Run: `npm run build && node --test --test-name-pattern "resolve a failed x402 settlement" tests/rendered-html.test.mjs`
Expected: FAIL（路由不存在，返回 Next 的 404 页面）。

**Step 2: 路由**

在 `if (url.pathname === "/api/admin/x402/runtime-config" && request.method === "PUT") {...}` 之后加：

```ts
    if (
      /^\/api\/admin\/x402\/batches\/xb_[A-Za-z0-9_-]{20,80}\/resolve$/.test(
        url.pathname,
      ) &&
      request.method === "POST"
    ) {
      return await handleAdminX402BatchResolve(request, env, requestId);
    }
```

**Step 3: 处理函数**

```ts
async function handleAdminX402BatchResolve(
  request: Request,
  env: PlatformEnv,
  requestId: string,
): Promise<Response> {
  assertSameOrigin(request, env);
  requireAdminSecret(request, env, "platform");
  const db = requireDb(env);
  const batchId = new URL(request.url).pathname.split("/").at(-2) ?? "";
  const body = await readJsonBody<{
    action?: unknown;
    transactionHash?: unknown;
    note?: unknown;
  }>(request, MAX_DASHBOARD_BODY_BYTES);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (
    (body.action !== "mark_settled_manually" && body.action !== "mark_expired") ||
    note.length < 4
  ) {
    throw new PlatformError(
      400,
      "invalid_x402_resolution",
      "必须提供 mark_settled_manually 或 mark_expired 动作，以及至少 4 个字符的说明。",
    );
  }
  let changes = 0;
  if (body.action === "mark_settled_manually") {
    if (!isX402TransactionHash(body.transactionHash)) {
      throw new PlatformError(
        400,
        "invalid_x402_transaction_hash",
        "人工确认结算必须提供 Base 链上的 0x 交易哈希。",
      );
    }
    try {
      const result = await db
        .prepare(
          `UPDATE x402_batches
           SET status = 'settled', transaction_hash = ?, failure_code = NULL,
               settled_at = CURRENT_TIMESTAMP,
               revenue_recognized_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'settlement_failed'
             AND transaction_hash IS NULL`,
        )
        .bind(body.transactionHash, batchId)
        .run();
      changes = Number(result.meta?.changes ?? 0);
    } catch {
      throw new PlatformError(
        409,
        "x402_receipt_conflict",
        "该链上交易哈希已经绑定到其他批次。",
      );
    }
  } else {
    const result = await db
      .prepare(
        `UPDATE x402_batches
         SET status = 'expired', failure_code = 'resolved_expired',
             completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'settlement_failed'`,
      )
      .bind(batchId)
      .run();
    changes = Number(result.meta?.changes ?? 0);
    if (changes === 1) {
      await setX402CapacityLeaseStatus(db, batchId, "released");
    }
  }
  if (changes !== 1) {
    throw new PlatformError(
      409,
      "x402_batch_not_resolvable",
      "只有处于 settlement_failed 状态的批次可以人工处理。",
    );
  }
  await writeAdminAudit(db, request, {
    action: `x402.batch.${body.action}`,
    targetType: "x402_batch",
    targetId: batchId,
    details: {
      note,
      transactionHash:
        body.action === "mark_settled_manually" ? body.transactionHash : null,
    },
    idempotencyKey: `x402-resolve:${batchId}:${body.action}`,
  });
  const batch = await x402BatchById(db, batchId);
  return jsonResponse(
    { batch: batch ? adminX402Batch(batch) : null },
    200,
    requestId,
  );
}
```

**Step 4: 运行通过并回归**

Run: `npm run build && node --test --test-name-pattern "resolve a failed x402 settlement|bootstraps named admins" tests/rendered-html.test.mjs && npm run typecheck`
Expected: 全部通过。

**Step 5: Commit**

```bash
git add worker/platform.ts tests/rendered-html.test.mjs
git commit -m "feat(admin): resolve failed x402 settlements with audited manual receipts"
```

---

### Task 13: x402 批次查询接口按 IP 限流

**Files:**
- Modify: `worker/platform.ts:147-200`（`PlatformEnv`）
- Modify: `worker/platform.ts:6747-6760`（`consumeGcraRateLimit` 的 scope 类型）
- Modify: `worker/platform.ts:2950-2972`（`handleX402BatchLookup`）
- Test: `tests/rendered-html.test.mjs`

**Step 1: 写失败的集成测试**

```js
test("rate limits anonymous x402 batch lookups per client address", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const endpoint = "/v1/tiktok/web/fetch_user_profile";
  enableCatalogEndpoint(db, endpoint, 2000);
  seedX402Batch(db, { id: "xb_lookup_limit_00000000000000", status: "quoted", endpoint, updatedAt: "2020-01-01 00:00:00" });
  const env = baseEnv({
    DB: db,
    X402_LOOKUP_RATE_LIMIT_RPS: "1",
    X402_LOOKUP_RATE_LIMIT_BURST: "2",
  });
  const lookup = () =>
    fetchWorker(
      "/api/x402/batches/xb_lookup_limit_00000000000000",
      { headers: { "cf-connecting-ip": "203.0.113.9" } },
      env,
    );
  assert.equal((await lookup()).status, 200);
  assert.equal((await lookup()).status, 200);
  const limited = await lookup();
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, "x402_lookup_rate_limited");
  assert.ok(limited.headers.get("retry-after"));
});
```

Run: `npm run build && node --test --test-name-pattern "rate limits anonymous x402" tests/rendered-html.test.mjs`
Expected: FAIL（第三次仍返回 200）。

**Step 2: 实现**

2a. `PlatformEnv` 加：

```ts
  X402_LOOKUP_RATE_LIMIT_RPS?: string;
  X402_LOOKUP_RATE_LIMIT_BURST?: string;
```

2b. `consumeGcraRateLimit` 的 `scope: "api_key" | "account"` 改为 `scope: "api_key" | "account" | "x402_lookup"`；`rateLimitHeaders` 的 scope 参数类型若为同一联合类型，同样扩展。

2c. `handleX402BatchLookup` 开头（`const id = ...` 之前）加：

```ts
  const db = requireDb(env);
  const clientAddress =
    request.headers.get("cf-connecting-ip")?.trim().slice(0, 64) || "unknown";
  const lookupDecision = await consumeGcraRateLimit(
    db,
    "x402_lookup",
    (await sha256Hex(clientAddress)).slice(0, 24),
    clampInteger(env.X402_LOOKUP_RATE_LIMIT_RPS, 30, 1, 1_000),
    clampInteger(env.X402_LOOKUP_RATE_LIMIT_BURST, 60, 1, 2_000),
  );
  if (!lookupDecision.allowed) {
    throw new PlatformError(
      429,
      "x402_lookup_rate_limited",
      "x402 批次查询过于频繁，请稍后重试。",
      rateLimitHeaders(lookupDecision, "x402_lookup"),
    );
  }
```

并把后面的 `x402BatchById(requireDb(env), id)` 改为 `x402BatchById(db, id)`。

**Step 3: 运行通过**

Run: `npm run build && node --test --test-name-pattern "rate limits anonymous x402|x402 wallet-paid batch" tests/rendered-html.test.mjs && npm run typecheck`
Expected: 全部通过。

**Step 4: Commit**

```bash
git add worker/platform.ts tests/rendered-html.test.mjs
git commit -m "fix(x402): rate limit anonymous batch lookups per client address"
```

---

### Task 14: 生产登录配置齐全后忽略 Sites 身份头

**Files:**
- Create: `worker/lib/identity-headers.ts`
- Create: `tests/unit/identity-headers.test.mjs`
- Modify: `worker/index.ts:60-95`（入口处剥离头）
- Modify: `worker/platform.ts:1395-1416`（`handleAuthProviders`）、`1416-1455`（`handleConsolePageGate`）、`19132`（`requireAuthenticatedUser`）、`18226-18341`（`platformReadiness` 的能力位）
- Test: `tests/rendered-html.test.mjs`

**Step 1: 单元测试**

```js
// tests/unit/identity-headers.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  IDENTITY_HEADER_NAMES,
  productionAuthenticationConfigured,
  trustedIdentityHeadersActive,
  withoutIdentityHeaders,
} from "../../worker/lib/identity-headers.ts";

test("identity headers stay active only while production login is incomplete", () => {
  assert.equal(trustedIdentityHeadersActive({ TRUST_SITES_IDENTITY_HEADERS: "true" }), true);
  assert.equal(trustedIdentityHeadersActive({ TRUST_SITES_IDENTITY_HEADERS: "false" }), false);
  const production = {
    TRUST_SITES_IDENTITY_HEADERS: "true",
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    WALLET_LOGIN_ENABLED: "true",
  };
  assert.equal(productionAuthenticationConfigured(production), true);
  assert.equal(trustedIdentityHeadersActive(production), false);
  assert.equal(
    trustedIdentityHeadersActive({ ...production, WALLET_LOGIN_ENABLED: "false" }),
    true,
  );
  assert.equal(
    productionAuthenticationConfigured({ ...production, GOOGLE_CLIENT_ID: " id " }),
    false,
  );
});

test("withoutIdentityHeaders strips every oai identity header and keeps the rest", () => {
  const request = new Request("https://app.example/api/auth/me", {
    method: "POST",
    headers: {
      "oai-authenticated-user-email": "victim@example.com",
      "oai-authenticated-user-full-name": "Victim",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
      authorization: "Bearer rb_live_x",
    },
    body: "{}",
  });
  const sanitized = withoutIdentityHeaders(request);
  for (const name of IDENTITY_HEADER_NAMES) {
    assert.equal(sanitized.headers.get(name), null);
  }
  assert.equal(sanitized.headers.get("authorization"), "Bearer rb_live_x");
  assert.equal(sanitized.method, "POST");
});
```

Run: `npm run test:unit` → Expected: FAIL（模块不存在）。

**Step 2: 实现模块**

```ts
// worker/lib/identity-headers.ts
export const IDENTITY_HEADER_NAMES = [
  "oai-authenticated-user-email",
  "oai-authenticated-user-full-name",
  "oai-authenticated-user-full-name-encoding",
] as const;

export type IdentityHeaderEnv = {
  TRUST_SITES_IDENTITY_HEADERS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  WALLET_LOGIN_ENABLED?: string;
};

function configured(value?: string): boolean {
  return Boolean(
    value && value.trim().length > 0 && value === value.trim(),
  );
}

export function productionAuthenticationConfigured(
  env: IdentityHeaderEnv,
): boolean {
  return (
    configured(env.GOOGLE_CLIENT_ID) &&
    configured(env.GOOGLE_CLIENT_SECRET) &&
    env.WALLET_LOGIN_ENABLED === "true"
  );
}

/** Sites 身份头只在显式开启且生产登录尚未配置齐全时才被信任。 */
export function trustedIdentityHeadersActive(env: IdentityHeaderEnv): boolean {
  return (
    env.TRUST_SITES_IDENTITY_HEADERS === "true" &&
    !productionAuthenticationConfigured(env)
  );
}

export function withoutIdentityHeaders(request: Request): Request {
  if (!IDENTITY_HEADER_NAMES.some((name) => request.headers.has(name))) {
    return request;
  }
  const headers = new Headers(request.headers);
  for (const name of IDENTITY_HEADER_NAMES) headers.delete(name);
  return new Request(request, { headers });
}
```

Run: `npm run test:unit` → Expected: `# fail 0`。

**Step 3: 写失败的集成测试**

```js
test("ignores trusted identity headers once production login is configured", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({
    DB: db,
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    WALLET_LOGIN_ENABLED: "true",
  });
  const me = await fetchWorker("/api/auth/me", { headers: signedInHeaders() }, env);
  assert.equal(me.status, 401);
  const keys = await fetchWorker(
    "/api/keys",
    { method: "POST", headers: signedInHeaders(), body: JSON.stringify({ label: "spoof" }) },
    env,
  );
  assert.equal(keys.status, 401);
  const health = await fetchWorker("/api/health", {}, env);
  assert.equal((await health.json()).capabilities.trustedIdentityHeadersActive, false);
  assert.equal(
    db.raw.prepare("SELECT COUNT(*) AS c FROM users").get().c,
    0,
    "no user may be auto-provisioned from a spoofed header",
  );
});
```

Run: `npm run build && node --test --test-name-pattern "ignores trusted identity headers" tests/rendered-html.test.mjs`
Expected: FAIL（`/api/auth/me` 返回 200）。

**Step 4: 接线**

4a. `worker/index.ts`：`import { trustedIdentityHeadersActive, withoutIdentityHeaders } from "./lib/identity-headers";`。`fetch(request: Request, env, ctx)` 参数改名为 `rawRequest`，函数体第一行加：

```ts
    const request = trustedIdentityHeadersActive(env ?? {})
      ? rawRequest
      : withoutIdentityHeaders(rawRequest);
```

4b. `worker/platform.ts`：`import { trustedIdentityHeadersActive } from "./lib/identity-headers";`，然后：

- `handleAuthProviders`（锚点 `grep -n 'enabled: env.TRUST_SITES_IDENTITY_HEADERS === "true"' worker/platform.ts`）改为 `enabled: trustedIdentityHeadersActive(env)`。
- `handleConsolePageGate`（锚点 `grep -n 'env.TRUST_SITES_IDENTITY_HEADERS === "true" &&' worker/platform.ts`）改为 `trustedIdentityHeadersActive(env) &&`。
- `requireAuthenticatedUser`（锚点 `grep -n 'if (env.TRUST_SITES_IDENTITY_HEADERS !== "true") {' worker/platform.ts`）改为 `if (!trustedIdentityHeadersActive(env)) {`。
- `platformReadiness`：在 `trustedSitesIdentityConfigured` 旁新增 `const trustedIdentityHeadersActiveNow = trustedIdentityHeadersActive(env);`，并在返回的 `capabilities` 里加 `trustedIdentityHeadersActive: trustedIdentityHeadersActiveNow,`。

`adminActorFingerprint` 不用改：入口已经剥离了头。

**Step 5: 运行通过并全量回归**

Run: `npm run build && node --test --test-name-pattern "ignores trusted identity headers|Google PKCE|one-time wallet signatures|console only after server-side authentication" tests/rendered-html.test.mjs`
Expected: `# fail 0`。若某个既有用例同时配置了 Google 与钱包又依赖身份头，把该用例的 `WALLET_LOGIN_ENABLED` 去掉或改用真实登录流程，而不是放宽实现。

Run: `npm run build && node --test tests/rendered-html.test.mjs && npm run typecheck && npm run lint`
Expected: 全部通过。

**Step 6: Commit**

```bash
git add worker/lib/identity-headers.ts tests/unit/identity-headers.test.mjs worker/index.ts worker/platform.ts tests/rendered-html.test.mjs
git commit -m "fix(auth): ignore Sites identity headers once production login is configured"
```

---

### Task 15: 同源检查只认公开站点地址

**Files:**
- Modify: `worker/platform.ts:21862-21885`（`assertSameOrigin`）
- Test: `tests/rendered-html.test.mjs`

**Step 1: 写失败的集成测试**

```js
test("rejects state-changing requests from a non-canonical host once PUBLIC_APP_URL is set", async (t) => {
  const db = new TestD1();
  t.after(() => db.close());
  await migrate(db);
  const env = baseEnv({ DB: db });
  const ctx = context();
  const response = await worker.fetch(
    new Request("http://alt.localhost/api/keys", {
      method: "POST",
      headers: signedInHeaders({ origin: "http://alt.localhost" }),
      body: JSON.stringify({ label: "cross host" }),
    }),
    env,
    ctx,
  );
  await Promise.allSettled(ctx.pending);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "cross_site_request_blocked");
});
```

Run: `npm run build && node --test --test-name-pattern "non-canonical host" tests/rendered-html.test.mjs`
Expected: FAIL（返回 201）。

**Step 2: 实现**

```ts
function assertSameOrigin(request: Request, env: PlatformEnv): void {
  const origin = request.headers.get("origin");
  const allowed = new Set<string>();
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
  } else {
    allowed.add(new URL(request.url).origin);
  }
  if (!origin || !allowed.has(origin)) {
    throw new PlatformError(
      403,
      "cross_site_request_blocked",
      "已阻止跨站请求。",
    );
  }
}
```

**Step 3: 运行通过并回归**

Run: `npm run build && node --test tests/rendered-html.test.mjs`
Expected: `# fail 0`（所有既有用例都用 `http://localhost`，与 `baseEnv` 的 `PUBLIC_APP_URL` 一致）。

**Step 4: Commit**

```bash
git add worker/platform.ts tests/rendered-html.test.mjs
git commit -m "fix(security): pin same-origin checks to PUBLIC_APP_URL"
```

---

### Task 16: 文档、环境变量、版本与发布门禁

**Files:**
- Modify: `README.md`（"环境变量"、"管理后台"、"支付与对账语义"、"当前应用版本"）
- Modify: `CHANGELOG.md`（新增 `## [0.4.0-preview.6]` 章节，保留空的 `## Unreleased`）
- Modify: `.env.example`、`worker-configuration.d.ts`
- Modify: `package.json`、`package-lock.json`（根 `version` 与 `packages[""].version`）、`VERSION`

**Step 1: 文档**

README：

- "请求限流与多 Key 路由"末尾加一段：`READINESS_CACHE_TTL_MS` 默认 `10000`，readiness 结果在单个 Worker 实例内缓存该毫秒数，管理端写操作后立即失效；`/api/health` 与 `/api/readiness` 始终直读并执行目录完整性全量校验；热路径只比较 `catalog_sync_state.taxonomy_verified_generation`，由同步发布与定时对账维护。
- "客户调用"加：余额由快照加增量计算，快照由定时对账维护。
- "支付与对账语义"加：对账把预留超过两分钟且无扣款的请求标记为 `abandoned`；把停滞的 x402 批次标记为 `settlement_failed` 或 `execution_failed`；回收过期容量租约。
- "管理后台"加：`POST /api/admin/x402/batches/{id}/resolve`，动作 `mark_settled_manually`（需 `transactionHash`）或 `mark_expired`，需 `note`，仅 owner；写审计。
- "登录"加：生产登录（Google 与钱包）配置齐全后，`TRUST_SITES_IDENTITY_HEADERS` 自动失效，入口剥离 `oai-authenticated-user-*` 头。
- 环境变量段加 `X402_LOOKUP_RATE_LIMIT_RPS=30`、`X402_LOOKUP_RATE_LIMIT_BURST=60`。
- `当前应用版本：\`v0.4.0-preview.5\`` 改为 `v0.4.0-preview.6`。

`.env.example` 的"Optional operational tuning"段加：

```bash
READINESS_CACHE_TTL_MS=10000
X402_LOOKUP_RATE_LIMIT_RPS=30
X402_LOOKUP_RATE_LIMIT_BURST=60
```

`worker-configuration.d.ts` 的 `Env` 加这三个可选字段。

CHANGELOG 在 `## Unreleased` 之后新增：

```markdown
## [0.4.0-preview.6] - <今天日期>

### Changed

- 版本升至 `0.4.0-preview.6`。
- readiness 结果按 Worker 实例缓存 `READINESS_CACHE_TTL_MS`（默认 10 秒）并在管理端写操作后失效；目录完整性全量校验改为同步发布与定时对账执行，热路径只比较已验证代次。
- 代理热路径去除重复的来源与凭据解析、重复心跳查询与随机清理；上游尝试后的写入合并为一个 batch；代次校验并入目录查询；扣款与 charged 标记同批；余额改为快照加增量。单次成功调用的 D1 往返由 30 余次降至 15 次以内，并由集成测试断言。

### Added

- 新表 `balance_snapshots` 与 `catalog_sync_state.taxonomy_verified_generation`（迁移 `0021`）。
- 对账新增 `abandoned` 终态、x402 停滞批次清扫、失败分支释放租约与过期租约回收。
- 新增 `POST /api/admin/x402/batches/{id}/resolve` 供 owner 人工确认结算或标记过期。
- 匿名 x402 批次查询按客户端地址限流。

### Security

- 生产登录（Google 与钱包）配置齐全后自动忽略 Sites 身份头，入口剥离相关请求头。
- 同源检查在配置了 `PUBLIC_APP_URL` 时只接受该 origin。
```

**Step 2: 版本**

`package.json` 的 `"version"` 改为 `0.4.0-preview.6`；`package-lock.json` 根 `"version"` 与 `"packages": { "": { "version" } }` 同步；`VERSION` 文件改为 `0.4.0-preview.6`。

Run: `npm run check:version`
Expected: 通过。

**Step 3: 全量门禁**

Run: `npm run check && npm audit --omit=dev --audit-level=high`
Expected: 全部通过；`check:docs` 在本地无 `DOC_SYNC_BASE` 时打印 "diff gate skipped"。

**Step 4: Commit**

```bash
git add README.md CHANGELOG.md .env.example worker-configuration.d.ts package.json package-lock.json VERSION
git commit -m "chore(release): v0.4.0-preview.6"
```

不打 tag、不 push；按 `docs/RELEASES.md` 由用户决定发布。

---

## 附：往返清单（用于核对预算）

任务 8 完成后，一次成功的 `/v1` 调用应只剩以下 D1 往返：

| # | 语句 | 往返 |
|---|---|---|
| 1 | 目录查询（含 coverage、代次与凭据字段） | 1 |
| 2 | API Key 查询 | 1 |
| 3 | 幂等探测 | 1 |
| 4 | Key 级 GCRA | 1 |
| 5 | 账户级 GCRA | 1 |
| 6 | 并发预留 | 1 |
| 7 | 扣款 + charged 标记（batch） | 1 |
| 8 | 凭据状态 | 1 |
| 9 | 凭据快照 | 1 |
| 10 | 路由健康 | 1 |
| 11 | 容量组桶 | 1 |
| 12 | 尝试后写入（batch） | 1 |
| 13 | 请求状态重读 | 1 |
| 14 | 调用日志 + Key 更新 + 请求完成 + 余额（batch） | 1 |

合计 14，预算 15 留 1 的余量。目录声明了更低 RPS 的端点会多 1 次接口桶；这类端点不在预算测试里。

---

## Phase 1 概要：能力层（0.5.0-preview.1）

以下任务在 Phase 0 合并后，按届时的函数签名展开为逐步任务。

| 任务 | 文件 | 测试 |
|---|---|---|
| P1-1 `capabilities` 表与迁移 0022；`endpoint_capabilities` 升格为运行时真相，删除 `VERIFIED_ENDPOINT_CAPABILITIES` 与 `VERIFIED_ENDPOINT_METHODS`，`endpointCapabilityFor` 改读表并 5 秒缓存 | `db/schema.ts`、`drizzle/0022_*`、`worker/platform.ts:392-660` | 迁移含 8 条既有能力；x402 原生批量测试不变 |
| P1-2 `worker/lib/capability-id.ts`：slug 正则、从平台 + 数据类型 + 路径末段推导草稿 ID | 新文件 | 单元测试覆盖合法/非法 slug 与推导 |
| P1-3 `worker/lib/capability-io.ts`：输入别名翻译、按 JSON 路径提取 `nextCursor` 与 `items`，失败返回 null | 新文件 | 单元测试覆盖别名冲突、缺失路径 |
| P1-4 从 `handleProxyRequest` 抽出 `executeCatalogRequest(ctx, catalog, method, input)`，原路径与 `/v1/c/{id}` 共用 | `worker/platform.ts:7546-8404` | 现有代理测试全绿；新增"能力调用计费与原始路径一致" |
| P1-5 `/v1/c/{capabilityId}` 入口与响应信封 | 路由 + 新 handler | 集成测试：published 可调、deprecated 404、items/nextCursor 提取 |
| P1-6 `GET /api/capabilities`、`GET /api/capabilities/{id}`（allowlist 过滤、示例、价格、可用性） | 新 handler | 集成测试：不泄露上游字段 |
| P1-7 管理端能力 CRUD、`draft-from-endpoint`、同步下架时同批 deprecated | 新 handler + `handleCatalogSync` | 集成测试：CAS 冲突 409、下架联动 |
| P1-8 后台"能力"子页（从 `AdminClient.tsx` 抽出为独立组件 `app/admin/CapabilitiesTab.tsx`） | 新组件 | Vitest + Testing Library 首个前端测试 |
| P1-9 README、CHANGELOG、版本 0.5.0-preview.1 | 文档 | `npm run check` |

## Phase 2 概要：Agent 分发层（0.5.0-preview.2 到 0.6.0）

| 任务 | 文件 | 测试 |
|---|---|---|
| P2-1 迁移 0023：`api_keys.scopes_json`、`spend_limit_usd_micros`、`spent_usd_micros`；`users.account_kind`；`account_bind_tokens`；`capability_stats` | schema + 迁移 | 迁移回填测试 |
| P2-2 Key 作用域校验与花费上限（扣款前比较，`logApiCall` 同批累加） | `worker/platform.ts` | 集成测试：`key_scope_denied`、`key_spend_limit_exceeded` |
| P2-3 账户端点 `GET /api/account`、`GET /api/account/usage/{requestId}`、`POST /api/account/topups`（Key Bearer） | 新 handler | 集成测试：作用域缺失 403、幂等充值 |
| P2-4 `POST /api/auth/register`（GCRA 限流、虚拟用户、全作用域 Key、promo 账本、绑定令牌） | 新 handler + `worker/lib/registration.ts` | 单元 + 集成：限流、promo 幂等、sandbox 模式下可注册不可调用 |
| P2-5 绑定升级页面与回调（`/bind?token=`，同批迁移身份、更新账户类型、消费令牌） | `app/bind/*`、`handleGoogleAuthCallback`、`handleWalletVerify` | 集成测试：冲突 409 |
| P2-6 `capability_stats` 聚合（对账每 5 分钟；p95 用排序偏移）与市场展示 | `handleReconciliation`、`CatalogClient.tsx` | 集成测试：聚合数值 |
| P2-7 `/llms.txt`、`/docs.md`、`/openapi.json` | 路由 + 生成器 | 快照测试 |
| P2-8 市场筛选状态同步到 URL | `CatalogClient.tsx` | 前端测试 |
| P2-9 `scripts/generate-skill-guides.mjs`（从 `/api/capabilities` 生成 Skill 指南） | 新脚本 | 快照测试 |
| P2-10 独立仓库 `relaybase-cli`：`register/config/list/search/get/call/balance/usage/topup/mcp` 与 `skills/relaybase/SKILL.md` | 新仓库 | CLI 自带测试与录制 fixture |
| P2-11 能力层与账户端点错误消息按 `Accept-Language` 双语 | `worker/lib/messages.ts` | 单元测试 |
| P2-12 README、CHANGELOG、版本 0.6.0 | 文档 | `npm run check` |
