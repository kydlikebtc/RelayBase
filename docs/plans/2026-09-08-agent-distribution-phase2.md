# Agent 分发层实施计划（Phase 2）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Agent 无需人工开户即可自助注册、按作用域与花费上限安全调用、自查账单与用量，并让能力在市场里带上真实调用统计。

**Architecture:** Phase 1 已把 `/v1/{path}` 与 `/v1/c/{id}` 收敛到同一个 `executeCatalogRequest`，因此作用域与花费上限**只需要在这一个函数里实现一次**；账户自助接口用 API Key Bearer 鉴权，与现有 session cookie 路径并存互不影响。

**上游文档：** Phase 1 计划 `docs/plans/2026-09-07-capability-layer-and-agent-distribution.md`（本文件取代其文末的 Phase 2 概要表）；设计 `docs/plans/2026-09-04-agent-native-data-gateway-design.md`。

**基线：** `main` @ `a6cee80`（Phase 1 全部 7 个任务 + 近黑改版，`npm run check` exit 0，43 单元 / 88 集成）。

---

## 0. 执行约定（先读）

1. **永远用 `grep -n` 锚点定位，不要相信行号。** `worker/platform.ts` 约 23000 行，任何改动都会让下游行号漂移。本文件给的行号只用于说明相对顺序。
2. **本机格式化钩子会在 Edit/Write 后对整个文件跑 prettier。** 仓库没有 prettier 配置也不是 prettier 格式，因此对 `worker/platform.ts`、`app/**/*.tsx` 这类大文件**改用 Bash + Python 精确替换**（带断言），否则会产生上万行无关 diff。新建的小文件同理用 heredoc 写，风格对齐邻居。
3. **`npm run check` 现在本地可用**（`lint` 已忽略 `.claude/`）。每个 PR 推送前跑：
   ```bash
   DOC_SYNC_BASE=$(git rev-parse origin/main) npm run check
   ```
   文档门禁比对**提交历史**而非工作区，文档必须先 commit。
4. **集成测试必须先构建**（测试导入 `dist/server/index.js`）：
   ```bash
   npm run build && node --test --test-name-pattern "<用例名片段>" tests/rendered-html.test.mjs
   ```
   只跑单元测试：`npm run test:unit`（不需要构建）。
5. **每个 `worker/lib/*.ts` 都必须有同名单测**（`tests/unit/<name>.test.mjs`），这是仓库既有惯例。模块必须是**纯擦除可用的 TS**（不能用 `enum`、构造函数参数属性），因为单测用 `node --experimental-strip-types`。
6. **没有前端测试框架**，这是 Phase 1 已确认的决定。前端改动靠**把应用跑起来**验证（见约定 9）。
7. **安全提醒钩子会把任何 `.exec(` 当成 `child_process.exec`**，包括正则与文档示例。被拦时改写代码避开，或用 heredoc 写入。
8. **不要提交 `dist/`、`.wrangler/`、`.dev.vars`。** 前两个在 `.gitignore`，**`.dev.vars` 不在**——用完必须删。
9. **本地跑 gated 控制台/后台的完整配方**（Phase 1 踩完的坑，别再踩一遍）：
   - `printf 'TRUST_SITES_IDENTITY_HEADERS=true\n' > .dev.vars`，用完删。
   - dev server 绑 **IPv6 `[::1]:3000`**；本机另有无关项目占着 IPv4 `127.0.0.1:3000`，代理必须连 `::1`。
   - `curl` 需要 `--noproxy '*'`（本机设了 `HTTP_PROXY`）。
   - 鉴权是请求头，用本地代理注入 `oai-authenticated-user-email`；代理**不要改写 Host**，否则 worker 的同源校验必然失败。
   - 用 `node:sqlite` 按 `_journal.json` 顺序灌 `drizzle/*.sql` 到 `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`（24 个迁移全部干净通过；`sqlite3` CLI 会在 0019 卡住）。
   - 管理员夹具的 user id **必须是 `usr_<sha256(email)[:24]>`**，审计归属按这个公式反查；用别的 id 会得到 401「管理员身份无法写入审计记录」。
10. **不要打 tag。推送与开 PR 需用户明确要求。**

---

## 1. 必须先知道的既有事实

执行前确认这些，否则会做出错误设计。

### 1.1 钱只在一个地方动

`executeCatalogRequest`（锚点 `async function executeCatalogRequest`）内部顺序是固定的：

| 锚点 | 意义 |
|---|---|
| `catalog = await db` | 目录记录，**此刻 `customer_price_usd_micros` 已知** |
| `const catalogCapability = endpointCapabilityFor(` | 能力证据（失败关闭） |
| `const requestTargetCount = requestTargetCountForCapability(` | 目标数已知 |
| **`const secret = bearerToken(request);`** | **API Key 提取起点** |
| `const key = await db` | Key 载入（`api_keys JOIN users`），此后 `key` 可用 |
| `const suppliedIdempotencyKey = requireIdempotencyKey(request);` | 幂等键 |
| `const keyRateDecision = await consumeGcraRateLimit(` | 限流（**有副作用，消耗令牌**） |
| `const reservation = await db` | **第一次持久化写**（`proxy_requests` = 'processing'） |
| **`const costUsdMicros = catalog.customer_price_usd_micros;`** | **扣费批的前一行——作用域与额度检查必须在此之前** |

`refundRequest` 有 4 个调用点，`logApiCall` 有 3 个（全仓库只有这三处）。**扣费金额恒等于 `catalog.customer_price_usd_micros`，不乘 `requestTargetCount`。**

### 1.2 今天没有账户自助接口

用户侧只有 `GET /api/dashboard`（session cookie）。**没有 `/api/account`、`/api/usage`、`/api/topups`，也没有任何按 requestId 查单次用量的接口。** P2-3 是纯新增。

`/api/payments` POST 是 session + same-origin + `Idempotency-Key`，P2-3 的 Key Bearer 充值要复用它的幂等语义，但不能复用它的鉴权。

### 1.3 今天没有虚拟用户

用户 id 一律是 `usr_<sha256(email)[:24]>`（`worker/platform.ts` 里有两处独立实现这个公式：用户创建与审计归属）。**P2-4 引入的虚拟用户必须选择一个不会与真实邮箱碰撞的 id 方案**，并且不能破坏审计归属的反查。

### 1.4 错误消息今天只有中文

`PlatformError` 是硬编码中文消息，全文件 468 处 `new PlatformError`。所有错误经**唯一出口** `errorResponse`（只有 3 处引用，2 处调用都在 `handlePlatformRequest` 的顶层 catch，`request` 在作用域内）——这是 P2-11 天然的收敛点。另有两处绕开该出口自拼信封：`x402QuoteResponse` 与 `upstreamErrorResponse`，**改造时不能漏**。

前端已有一份 code→英文表（`app/console/ConsoleClient.tsx` 的 `englishApiError`）：中文直接透传 worker 消息，英文丢弃它改用本地表。P2-11 落到 worker 后要决定这份前端表的去留。

### 1.5 市场筛选今天完全不进 URL

`app/catalog/CatalogClient.tsx` 用 `useState` 持有 8 个需要入 URL 的状态（`query` + 6 个 filter + `offset`），刷新即归零、无法分享。全仓 `app/` **没有任何 `useSearchParams` / `pushState` 用法**。项目跑在 `vinext`（不是原生 Next），其 `next/navigation` shim **确实导出** `useSearchParams` 与 `useRouter().replace()`。`app/catalog/page.tsx` 不读 `searchParams` 也没有 `<Suspense>` 包裹。

### 1.6 没有逐字节快照测试机制

现有"快照式"测试是**取整份响应体 + 一组 `assert.match` / `assert.doesNotMatch` 正则**，不是逐字节快照。P2-7 与 P2-9 要求"快照测试"——沿用这个既有形状即可，**不要为此引入新机制**（引入 Node 的 `t.assert.snapshot` 属于新增测试栈，与 Phase 1 已否决 Vitest 的决定同性质）。

---

## 2. 交付策略

| PR | 任务 | 评审契约 |
|---|---|---|
| ① 作用域与额度 | P2-1、P2-2 | 存量 Key **默认全作用域、不得因升级失效**；检查发生在**扣款前**；88 项现有集成测试原样全绿 |
| ② 账户自助面 | P2-3、P2-4、P2-5 | Key Bearer 鉴权与 session 路径互不影响；注册限流与 promo 幂等有测试 |
| ③ 统计与文档面 | P2-6、P2-7、P2-9 | 聚合数值有测试；文档产物有快照式断言 |
| ④ 前端与收尾 | P2-8、P2-11、P2-12 | 筛选状态可分享可回退；错误消息双语；版本 `0.6.0` |

**P2-10（独立仓库 `relaybase-cli`）不在本仓库轨道**，需要单独立项，本计划不覆盖。

---

## Task P2-1: 迁移 0024（作用域、花费上限、账户类型、绑定令牌、能力统计）

**Files:** Create `drizzle/0024_*.sql`（用 `npm run db:generate` 生成 DDL，再手写数据回填）；Modify `db/schema.ts`

### Step 1: schema.ts 加列与表

- `apiKeys`：`scopesJson: text("scopes_json").notNull().default('["*"]')`、`spendLimitUsdMicros: integer(...)`（可空 = 不限）、`spentUsdMicros: integer(...).notNull().default(0)`。
- `users`：`accountKind: text("account_kind").notNull().default("human")`，CHECK 限定 `('human','agent')`。
- 新表 `accountBindTokens`、`capabilityStats`。

**存量 Key 不得失效**：`scopes_json` 的 DEFAULT 必须是全作用域 `'["*"]'`，且 `ALTER TABLE ADD COLUMN` 会把该默认值写进所有存量行。**这一条要有测试。**

### Step 2: 生成迁移并验证

```bash
npm run db:generate    # 产出 DDL 与 0024_snapshot.json，并写 _journal.json
```
手写迁移必须自己补 journal 条目；`db:generate` 会代劳。生成后**必须再跑一次 `db:generate` 确认输出 "No schema changes"**，否则 schema 与迁移不同步。

### Step 3: 用内存库验证回填

写临时脚本（不提交）：按 `_journal.json` 顺序应用全部迁移到 `node:sqlite` 内存库，插入一条 0024 之前就存在的 `api_keys` 行，应用 0024，断言 `scopes_json = '["*"]'`、`spent_usd_micros = 0`、`spend_limit_usd_micros IS NULL`。

**Expected:** 存量 Key 升级后仍是全作用域。

---

## Task P2-2: Key 作用域校验与花费上限

**Files:** Create `worker/lib/key-scopes.ts` + `tests/unit/key-scopes.test.mjs`；Modify `worker/platform.ts`

### Step 1: 纯函数模块先行

`key-scopes.ts` 导出 `parseKeyScopes(raw: unknown): string[]`（畸形配置回落到**空数组=拒绝**，不是全放行）与 `scopeAllows(scopes, { path, capabilityId })`。作用域语法与匹配规则在这里定义并单测，**不要写进 platform.ts**。

> 失败方向很重要：作用域配置读不出来时必须**拒绝**。回落成全放行会把一次配置错误变成一次越权调用。这与 Phase 1 能力证据"失败关闭"是同一条原则。

### Step 2: 接进热路径

锚点：`const costUsdMicros = catalog.customer_price_usd_micros;`
在**这一行之前**插入作用域与额度检查（此时 `key`、`catalog`、`requestTargetCount` 都已就绪，且还没有任何扣费）：

- 作用域不匹配 → 403 `key_scope_denied`
- `spend_limit_usd_micros` 非空且 `spent_usd_micros + costUsdMicros > limit` → 402 `key_spend_limit_exceeded`

### Step 3: 累加放进同一批

`spent_usd_micros` 的累加**必须与扣费同批**（扣费批锚点 `const [debitResult] = await db.batch([`），否则扣了钱没记额度，或记了额度没扣钱。退款路径（4 个 `refundRequest` 调用点）必须对称回滚 `spent_usd_micros`。

> 这一条是本任务最容易出错的地方：Phase 1 的审计缺陷就是"写入与记录不同批"造成的。

### Step 4: 测试（先写，必须先红）

- 作用域外路径 → 403 且**不产生 `api_calls` 行、不扣费**
- 额度刚好够 → 成功且 `spent_usd_micros` 精确增加
- 额度不足 → 402 且不扣费
- 上游失败退款后 `spent_usd_micros` 回到原值
- 存量全作用域 Key 调用任意端点仍成功

---

## Task P2-3: 账户自助接口（Key Bearer）

**Files:** Modify `worker/platform.ts`

- `GET /api/account`：余额、账户类型、Key 的作用域与额度。
- `GET /api/account/usage/{requestId}`：单次调用的用量与计费。**只能返回该 Key 自己的记录**，跨 Key 查询返回 404 而不是 403（不泄露 requestId 是否存在）。
- `POST /api/account/topups`：复用 `/api/payments` 的幂等语义（`Idempotency-Key`），但用 Key Bearer 鉴权。

作用域缺失 → 403。路由注册在 `/api/dashboard` 附近，鉴权走 Key 而非 session。

**测试：** 作用域缺失 403；跨 Key 查 usage 得 404；同一 `Idempotency-Key` 重复充值只产生一笔订单。

---

## Task P2-4: 自助注册

**Files:** Modify `worker/platform.ts`

`POST /api/auth/register`：GCRA 限流（复用 `consumeGcraRateLimit`，新建一个 context 维度）、创建 `account_kind='agent'` 的虚拟用户、签发全作用域 Key、写 promo 账本、签发绑定令牌。

**约束：** promo 必须幂等（同一来源不得重复赠送）；sandbox 模式下**可注册但不可调用**（调用侧的就绪性检查已经保证这一点，注册不应绕过）。

**测试：** 限流生效；promo 幂等；sandbox 下注册成功但 `/v1` 调用仍 503。

---

## Task P2-5: 绑定升级

**Files:** Create `app/bind/page.tsx` + client component；Modify `worker/platform.ts`

`/bind?token=` 与回调：把虚拟用户的余额、Key、用量迁移到真实身份。**同批**完成身份迁移、账户类型更新与令牌消费；冲突 409。

> 部分提交会造成"钱在旧账户、Key 在新账户"，这是资金一致性事故。整个迁移必须是一个 `db.batch`。

前端页面按约定 9 跑起来验证。

---

## Task P2-6: `capability_stats` 聚合与市场展示

**Files:** Modify `worker/platform.ts`

在 `handleReconciliation`（锚点 `async function handleReconciliation`）里加聚合步骤，每 5 分钟一次；p95 用排序偏移而不是近似算法。结果写 `capability_stats`，由 `publicCapabilitySummary` / `handleCapabilityDetail` 展示。

**测试：** 造已知分布的 `api_calls` 行，断言聚合出的调用量、成功率与 p95 数值精确正确。

---

## Task P2-7: `/llms.txt`、`/docs.md`、`/openapi.json`

**Files:** Modify `worker/platform.ts`

三者都从**已发布能力**生成，复用 `capabilityCodeExamples` 与市场的 allowlist 过滤。**绝不能泄露上游来源地址、operationId 或控制面路由**——照抄市场既有的 `assert.doesNotMatch(..., /source\.example|\/api\/v1\/control\//i)` 断言。

**测试：** 按 1.6 的既有形状写（整份响应体 + 正则断言），不引入新的快照机制。

---

## Task P2-8: 市场筛选状态同步到 URL

**Files:** Modify `app/catalog/CatalogClient.tsx`、可能 `app/catalog/page.tsx`

用 vinext 的 `useSearchParams` 读初值、`useRouter().replace()` 写回（`replace` 而非 `push`，否则每次改筛选都往历史里塞一条）。8 个状态：`q` + 6 个 filter + `offset`。

**注意：** 现有代码在分页越界时会 `setOffset(lastOffset)` 自我纠正，URL 同步不能与这个纠正打架造成循环。搜索有 280ms 防抖，URL 写入应跟随防抖后的 `query` 而不是 `searchInput`。

若 `useSearchParams` 需要 `<Suspense>` 边界（仓库目前一处都没有），在 `app/catalog/page.tsx` 补。

**验证：** 无前端测试框架，按约定 9 跑起来验证：改筛选 → URL 变化 → 刷新保持 → 后退恢复上一组筛选。

---

## Task P2-9: `scripts/generate-skill-guides.mjs`

**Files:** Create `scripts/generate-skill-guides.mjs`

从已发布能力生成 Skill 指南。**不得把生成产物提交进仓库**——`scripts/check-doc-sync.mjs` 会拒绝任何 `data/*catalog*.json`、`scripts/generate-*catalog-reference*` 与 `docs/*provider*provenance*` 形状的文件，生成器的产物落点要避开这些模式，或明确不提交。

---

## Task P2-11: 错误消息双语

**Files:** Create `worker/lib/messages.ts` + `tests/unit/messages.test.mjs`；Modify `worker/platform.ts`

按 `Accept-Language` 选择语言。收敛点是 `errorResponse`（顶层 catch 里 `request` 在作用域内），外加 `x402QuoteResponse` 与 `upstreamErrorResponse` 两处自拼信封。

**范围限定为能力层与账户端点的错误码**（见 1.4 的清单），不要一次性改 468 处 `new PlatformError`。做法：`messages.ts` 维护 `code → { zh, en }` 表，`errorResponse` 按语言查表命中则替换、未命中则原样透传中文。这样未覆盖的错误码行为完全不变。

对外形状沿用既有惯例：`capabilities` 已经用 `summary: { zh, en }` 的嵌套对象。

---

## Task P2-12: 文档与发版

README、CHANGELOG、`VERSION`、`package.json` 与 lockfile 同步升至 `0.6.0`，`npm run check:version` 必须通过。发布规范见 `docs/RELEASES.md`。

---

## 附：Phase 2 待决策项

| 决策 | 影响 | 建议 |
|---|---|---|
| 作用域语法（前缀匹配 / 通配 / 能力 id 与路径混用） | P2-2 的核心契约，落库后难改 | 执行 P2-2 Step 1 前与用户确认 |
| 虚拟用户 id 方案 | 不能与 `usr_<sha256(email)>` 碰撞，且要能被审计归属反查 | 执行 P2-4 前确认 |
| 前端 `englishApiError` 表的去留 | P2-11 落地后与 worker 的双语表重复 | 建议 worker 权威、前端表退化为兜底 |
