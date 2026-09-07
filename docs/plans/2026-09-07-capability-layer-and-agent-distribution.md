# 能力层与 Agent 分发层实施计划（Phase 1 剩余 + Phase 2）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `capabilities` 表接线成可调用的能力层（`/v1/c/{id}` 与 `/api/capabilities`），再在其上建 Agent 分发层（Key 作用域、自助注册、CLI 与 Skill），使 Agent 无需人工开户即可发现、调用并结算数据产品。

**Architecture:** `endpoint_capabilities` 升格为运行时唯一真相，已验证证据由无外键的种子表经**表触发器**注入，覆盖全部插入路径；`handleProxyRequest` 抽出 `executeCatalogRequest`，原路径与能力入口共用同一套鉴权、幂等、限流、扣款与校验；能力层只做输入别名翻译与响应信封，不新增任何计费语义。

**Tech Stack:** TypeScript、Cloudflare Workers、D1（SQLite）、Drizzle ORM、vinext/Vite、`node --test`（集成测试用 `node:sqlite` 内存库 + 真实迁移；单元测试用 `--experimental-strip-types`）。

**上游文档：** 设计 `docs/plans/2026-09-04-agent-native-data-gateway-design.md`；Phase 0 计划 `docs/plans/2026-09-04-agent-native-data-gateway.md`。本文件取代该计划文末的 Phase 1 / Phase 2 概要表。

---

## 0. 执行约定（先读）

1. **基线。** 所有锚点基于 `main` @ `5dad2f0` 加 PR #5（`codex/phase1-capability-layer`）。**永远用 `grep -n` 锚点定位，不要相信行号**——`worker/platform.ts` 有 22645 行，任何改动都会让下游行号漂移。
2. **已完成，不要重做。** P1-1 前半、P1-2、P1-3 已在 PR #5 落地：`capabilities` 表 + 迁移 `0022`、`worker/lib/capability-id.ts`、`worker/lib/capability-io.ts`，单元测试 34 项。
3. **集成测试必须先构建。** 测试导入的是 `dist/server/index.js`：

   ```bash
   npm run build && node --test --test-name-pattern "<用例名片段>" tests/rendered-html.test.mjs
   ```

   只跑单元测试：`npm run test:unit`（不需要构建）。
4. **文档门禁按 PR 生效，不是按阶段。** `scripts/check-doc-sync.mjs` 对 `app|worker|db|drizzle|build|public|scripts` 或 `package(-lock).json` 的**任何**改动，强制要求 README.md 与 CHANGELOG.md 出现在同一变更集。**本地 `npm run check` 会跳过这条门禁**，只在 CI 设了 `DOC_SYNC_BASE` 时才执行。每个 PR 推送前务必本地复现：

   ```bash
   DOC_SYNC_BASE=$(git rev-parse origin/main) npm run check
   ```

   门禁比对的是**提交历史**（`base...HEAD`），不是工作区——文档必须先 commit 再验证。
5. **格式化钩子。** 本机存在一个对被读取文件执行 Prettier 的钩子，且不限于 `.ts`。每次提交前 `git status`；出现你没改过的文件且 `git diff -w` 为空时，`git checkout -- <file>` 还原。永远用显式路径 `git add`，**不要 `git add -A`**（仓库根有未跟踪的 `.claude/`）。
6. **安全提醒钩子会误报。** 它把任何 `.exec(` 当成 `child_process.exec`，包括 `RegExp.prototype.exec` 与 `node:sqlite` 的 `DatabaseSync.exec`；连**文档里的示例代码**也会被拦。被拦时优先改写代码避开（手写解析常常更易读），实在需要就用 `sed`/heredoc 写入，并在提交说明里注明。
7. **错误消息风格。** 客户可见错误继续用 `PlatformError(status, code, 中文消息)`。
8. **不要提交 `dist/`、`.wrangler/`。** 已在 `.gitignore`。
9. **不要打 tag。** 推送与开 PR 需用户明确要求。

---

## 1. 已确认的三处设计缺陷与处置

执行前必须知道，否则会重新踩一遍。

### 1.1 slug 正则无法表达真实平台名（已修，PR #5）

设计文档 5.1 写的 `^[a-z0-9]+(\.[a-z0-9_]+){1,3}$` 首段不允许下划线，而目录里真实存在 `wechat_mp`、`temp_mail`、`ios_shortcut`、`net_ease_cloud_music`。已改为每段允许下划线、禁止首尾与连续下划线。**不要按设计文档的原正则回改。**

### 1.2 已验证能力证据在新库会丢失（未修，Task 1 处理）

设计文档称「0019 已包含相同数据，迁移只校验存在」。**这句对全新数据库不成立。**

`drizzle/0019_previous_patriot.sql:32` 的播种是 `INSERT ... SELECT FROM endpoint_catalog`，随后逐条 `UPDATE ... WHERE path = '...'`。新库执行迁移时 `endpoint_catalog` 为空，播种 0 行，8 条已验证证据的 UPDATE 影响 0 行。实测全新库跑完 22 个迁移后：

```
endpoint_capabilities rows: 1, verified: 0
```

若直接删除 `VERIFIED_ENDPOINT_CAPABILITIES`，8 个原生批量端点（TikTok / 抖音 / Instagram，上限 10 与 25）会在所有新部署上静默降级为 `direct`。

**为什么必须用触发器而不是在目录同步时写入：** x402 原生批量集成测试用 **raw SQL 直插** `endpoint_catalog`（`tests/rendered-html.test.mjs`，搜 `INSERT INTO endpoint_catalog`），不走 `handleCatalogSync`。触发器挂在表上，覆盖全部插入路径；挂在同步代码上会漏掉测试与人工插入。

### 1.3 JSON 路径需挡原型链（已修，PR #5）

`response_items_path` 是操作员配置、用于遍历上游不可信 JSON 的。解析期已拒绝 `__proto__` / `constructor` / `prototype`。新增任何路径遍历代码时保持同样约束。

---

## 2. 交付策略

分三个 PR。**不要合成一个**——PR① 的评审契约与另外两个性质不同。

| PR | 任务 | 评审契约 |
|---|---|---|
| ① 地基与抽取 | Task 1–2 | **对外行为零变化**；76 项集成测试原样全绿且不修改；D1 warm 预算 ≤15 不破 |
| ② 对外能力面 | Task 3–5 | 新增 `/v1/c/{id}`、`/api/capabilities`、管理端 CRUD；计费语义与原路径逐项一致 |
| ③ 后台与发版 | Task 6–7 | 后台「能力」子页 + 文档 + 版本 `0.5.0-preview.1` |

PR③ 是唯一触碰前端的部分。若全站改版 PR #4 尚未合并，先做 PR①②（完全不碰前端），把 PR③ 留到改版落地后，否则后台子页样式要写两遍。

---

## Task 1: 证据种子表 + 触发器改写 + `endpoint_capabilities` 升格

对应 P1-1 后半。这是整个 Phase 1 唯一触及热路径的任务。

**Files:**

- Create: `drizzle/0023_capability_evidence_seed.sql`（手写，不用 `db:generate`——drizzle-kit 不生成触发器）
- Modify: `db/schema.ts`（新增 `capabilityEvidenceSeed` 表定义）
- Modify: `worker/platform.ts`（`endpointCapabilityFor` 及其 9 处调用点）
- Test: `tests/rendered-html.test.mjs`

### Step 1: 把 8 条证据从常量导出为 SQL

先读出常量内容，不要手抄：

```bash
sed -n "/^const VERIFIED_ENDPOINT_CAPABILITIES/,/^};/p" worker/platform.ts
sed -n "/^const VERIFIED_ENDPOINT_METHODS/,/^};/p" worker/platform.ts
```

`VERIFIED_ENDPOINT_METHODS` 决定证据是否适用（原实现要求 method 匹配才认证据）。种子表必须保留这一语义，因此加 `http_method` 列。

### Step 2: 写迁移 `drizzle/0023_capability_evidence_seed.sql`

结构如下。8 行 VALUES 从 Step 1 的输出填入，**不要凭记忆写**。

```sql
CREATE TABLE `capability_evidence_seed` (
	`path` text PRIMARY KEY NOT NULL,
	`http_method` text NOT NULL,
	`execution_mode` text NOT NULL,
	`native_batch_supported` integer NOT NULL,
	`native_batch_max` integer,
	`target_field` text,
	`target_encoding` text,
	`evidence_status` text NOT NULL,
	`evidence_url` text,
	`evidence_note` text,
	`verified_at` text
);--> statement-breakpoint
INSERT INTO `capability_evidence_seed` VALUES
  ('/v1/tiktok/app/v3/fetch_multi_video', 'POST', 'native_batch', 1, 10,
   'aweme_ids', 'json_array', 'verified',
   'https://docs.tikhub.io/190419367e0', '<从常量抄写>', '2026-07-26');
--> statement-breakpoint
DROP TRIGGER `endpoint_capabilities_after_catalog_insert`;--> statement-breakpoint
CREATE TRIGGER `endpoint_capabilities_after_catalog_insert`
AFTER INSERT ON `endpoint_catalog`
BEGIN
  INSERT OR IGNORE INTO `endpoint_capabilities`
    (`path`, `execution_mode`, `native_batch_supported`, `native_batch_max`,
     `target_field`, `target_encoding`, `evidence_status`, `evidence_url`,
     `evidence_note`, `capability_revision`, `verified_at`, `updated_at`)
  SELECT
    NEW.`path`,
    COALESCE(s.`execution_mode`, 'direct'),
    COALESCE(s.`native_batch_supported`, 0),
    s.`native_batch_max`, s.`target_field`, s.`target_encoding`,
    COALESCE(s.`evidence_status`, 'pending'),
    s.`evidence_url`,
    COALESCE(s.`evidence_note`, '<0019 里的原默认文案>'),
    1, s.`verified_at`, CURRENT_TIMESTAMP
  FROM (SELECT NEW.`path` AS p, NEW.`http_method` AS m) n
  LEFT JOIN `capability_evidence_seed` s
    ON s.`path` = n.p AND s.`http_method` = n.m;
END;
```

`LEFT JOIN` 是关键：种子缺失时右侧全为 NULL，`COALESCE` 落回原来的 `direct`/`pending` 默认值，行为与改写前一致。`http_method` 参与 JOIN 保留了原常量「method 不匹配就不认证据」的语义。

回填已有部署（目录在 0019 之后才同步的情况）需再写一条 UPDATE，用**相关子查询**而非 `UPDATE ... FROM`，避免依赖 SQLite 版本；条件限定 `evidence_status != 'verified'`，不要覆盖运营已人工确认的行。

### Step 3: 先验证迁移，再动代码

写一个临时脚本：在内存库按序应用 `drizzle/*.sql`，插入 `/v1/tiktok/app/v3/fetch_multi_video`（`http_method='POST'`），读回 `endpoint_capabilities`。

Expected: `execution_mode='native_batch'`、`native_batch_max=10`、`evidence_status='verified'`。

再插一个不在种子里的端点，Expected: `direct` / `pending`。再插一个种子里有但 method 不匹配的，Expected: `direct` / `pending`。

### Step 4: `endpointCapabilityFor` 改读表

签名从同步改为接受预加载的映射，**不要在函数内部发查询**——它有 9 个调用点，其中四处在列表渲染循环里（`grep -n 'endpointCapabilityFor(' worker/platform.ts`），逐行查询会放大成 N+1。

```ts
const capabilityCache = new TtlCache<Map<string, EndpointCapability>>();

async function endpointCapabilityMap(env: Env): Promise<Map<string, EndpointCapability>> {
  return capabilityCache.remember(env as object, 5_000, async () => {
    // SELECT * FROM endpoint_capabilities
  });
}
```

`TtlCache` 用法见 `worker/lib/ttl-cache.ts` 与 `readinessCache` 的三处调用（`remember` / `delete`）。缓存键是 `env` 对象，与 readiness 缓存一致。管理端写操作后需 `capabilityCache.delete(env)`，参照 readiness 的失效点。

`endpointCapabilityFor(path, parameterSchema, documentationStatus, method, map)` 保持纯函数：先查 map，未命中再走原有的 `inferredPaginationCapability` 推断与 `direct`/`pending` 兜底。

### Step 5: 删除两个常量

```bash
grep -n 'VERIFIED_ENDPOINT_CAPABILITIES\|VERIFIED_ENDPOINT_METHODS' worker/platform.ts
```

删干净后应为空。注意 `endpointCapabilityFor` 兜底分支里有一条引用 `VERIFIED_ENDPOINT_METHODS[path]` 的错误说明文案，改为从 map 取。

### Step 6: 验证 D1 往返预算未破

```bash
npm run build && node --test --test-name-pattern "D1 round-trip budget" tests/rendered-html.test.mjs
```

该测试断言的是 **warm**（第二次）调用 ≤ `D1_ROUND_TRIP_BUDGET`，冷调用只要求「warm < cold」。5 秒 TTL 缓存在两次调用间必然命中，预算不会破。**若此测试变红，说明缓存没有按 env 对象命中，回去检查缓存键，不要调高预算。**

### Step 7: 全量验证并提交

```bash
npm run build && npm test
```

Expected: 单元 34+ 全绿；集成 76 全绿且 `tests/rendered-html.test.mjs` **未作任何修改**。

```bash
git add drizzle/0023_capability_evidence_seed.sql db/schema.ts worker/platform.ts
git commit -m "feat(capabilities): promote endpoint_capabilities to runtime truth"
```

---

## Task 2: 从 `handleProxyRequest` 抽出 `executeCatalogRequest`

对应 P1-4。**本计划风险最高的一步**：`handleProxyRequest` 815 行，是计费、幂等、限流、扣款与校验的核心路径。

**Files:** Modify `worker/platform.ts`（`grep -n 'async function handleProxyRequest' worker/platform.ts`，至下一个顶层 `function` 声明）

### Step 1: 先画边界，不要先动手

读完整个函数，用注释标出四段：①请求解析与鉴权 ②目录解析与校验 ③执行与计费 ④响应组装。`executeCatalogRequest(ctx, catalog, method, input)` 只包 ②③④——①留在 `handleProxyRequest`，因为能力入口的解析方式不同（按 id 而非路径），但 ② 之后完全共用。

### Step 2: 纯移动，零逻辑改动

第一次提交只做「把代码搬进新函数并调用它」，不要顺手重命名变量或改结构。

```bash
npm run build && npm test
```

Expected: 76 项集成测试全绿。**任何一项变红都说明抽取改变了语义，回退重来，不要就地修测试。**

### Step 3: 提交

```bash
git commit -m "refactor(proxy): extract executeCatalogRequest from handleProxyRequest"
```

**PR① 到此结束。** 按约定 4 补 README + CHANGELOG，本地跑 `DOC_SYNC_BASE=... npm run check` 后开 PR。

---

## Task 3: `/v1/c/{capabilityId}` 调用入口

对应 P1-5。**Files:** Modify `worker/platform.ts`（路由锚点：`grep -n 'url.pathname.startsWith("/v1/")' worker/platform.ts`）

处理顺序（设计文档 5.2）：

1. 解析能力；`status` 必须为 `published`，否则 `capability_not_found`（404）或 `capability_deprecated`（410）。
2. 用 `translateCapabilityInput` 翻译输入。**冲突必须返回 400 `capability_input_conflict`**，不要自行取舍。翻译后仍必须过现有 `validateCatalogProxyInputs`。
3. 调 Task 2 抽出的 `executeCatalogRequest`。
4. 信封：`{ success: true, capability, data, items, nextCursor }`。`items` 由 `extractItems` 提取，`nextCursor` 由 `extractNextCursor` 提取，**失败一律 null，不伪造**。

**集成测试（先写，必须先红）：** published 可调用且计费与原路径一致；deprecated 返回 410；draft 返回 404；`items`/`nextCursor` 正确提取；提取失败返回 null 而非 `[]`。

---

## Task 4: 公开能力接口

对应 P1-6。**Files:** Modify `worker/platform.ts`（锚点：`grep -n 'url.pathname === "/api/marketplace"' worker/platform.ts`，紧邻其后注册）

- `GET /api/capabilities?q&platform&category&limit&offset`：分页列表，含价格与可用性。
- `GET /api/capabilities/{id}`：详情，输入结构**必须经现有 allowlist 过滤**（复用 `marketplacePublicInputSchema`），含 curl / JavaScript / Python 示例。

**集成测试：** 不泄露上游来源地址、原始 operationId、凭据或控制面路由——照抄 `tests/rendered-html.test.mjs` 中 marketplace 的同类断言。

---

## Task 5: 管理端能力 CRUD

对应 P1-7。29 个现有 `/api/admin` 路由可作模式参照。

- `GET|POST /api/admin/capabilities`、`PATCH /api/admin/capabilities/{id}`：权限 `catalog_write`（锚点 `grep -n 'catalog_write' worker/platform.ts`），`expectedRevision` CAS，冲突 409。
- `POST /api/admin/capabilities/draft-from-endpoint`：用 `deriveCapabilityId` 生成草稿 id。**该函数返回 null 时必须返回 400 并说明原因**，不要自造 id。
- `handleCatalogSync` 下架端点时，同一 batch 内把关联能力置 `deprecated`。

**集成测试：** CAS 冲突 409；下架联动在同一 batch 内生效（部分提交是目录一致性事故）。

**PR② 到此结束。** 补文档，验证，开 PR。

---

## Task 6: 后台「能力」子页

对应 P1-8。**Files:** Create `app/admin/CapabilitiesTab.tsx`；Modify `app/admin/AdminClient.tsx`（导航锚点：`grep -n 'id: "routing"' app/admin/AdminClient.tsx`）

`AdminClient.tsx` 有 9550 行，**不要往里继续堆**——新子页作为独立组件挂到「路由与定价」下。沿用现有 `expectedRevision` 与审计模式。

> **决策待定：** 原计划要求引入 Vitest + Testing Library 作为首个前端测试。仓库现在只有 `node --test`。**执行到此任务前先与用户确认**是否引入第二套测试运行器；若不引入，改为用现有集成测试覆盖后台接口，UI 不做自动化测试。

---

## Task 7: 文档与发版

对应 P1-9。README、CHANGELOG、`VERSION`、`package.json` 与 lockfile 同步升至 `0.5.0-preview.1`，`npm run check:version` 必须通过。发布规范见 `docs/RELEASES.md`。

**PR③ 到此结束，Phase 1 完成。**

---

## Phase 2：Agent 分发层（0.5.0-preview.2 → 0.6.0，迁移 0024+）

Phase 1 合并后按当时的真实签名把下表展开为逐步任务，**展开前不要开工**——P2-2 依赖 Task 2 抽出的 `executeCatalogRequest` 最终形态，P2-6 依赖 Task 4 的响应结构。

| 任务 | 内容 | 关键约束 |
|---|---|---|
| P2-1 | 迁移：`api_keys.scopes_json`、`spend_limit_usd_micros`、`spent_usd_micros`；`users.account_kind`；`account_bind_tokens`；`capability_stats` | 回填测试；存量 Key 默认全作用域，不得因升级失效 |
| P2-2 | Key 作用域校验与花费上限 | **扣款前**比较，`logApiCall` 同批累加；`key_scope_denied` / `key_spend_limit_exceeded` |
| P2-3 | `GET /api/account`、`/api/account/usage/{requestId}`、`POST /api/account/topups`（Key Bearer） | 作用域缺失 403；充值幂等 |
| P2-4 | `POST /api/auth/register`（GCRA 限流、虚拟用户、全作用域 Key、promo 账本、绑定令牌） | promo 幂等；sandbox 下可注册但不可调用 |
| P2-5 | 绑定升级页 `/bind?token=` 与回调 | 同批迁移身份、更新账户类型、消费令牌；冲突 409 |
| P2-6 | `capability_stats` 聚合（对账每 5 分钟，p95 用排序偏移）与市场展示 | 聚合数值有测试 |
| P2-7 | `/llms.txt`、`/docs.md`、`/openapi.json` | 快照测试 |
| P2-8 | 市场筛选状态同步到 URL | 前端测试（取决于 Task 6 的测试栈决策） |
| P2-9 | `scripts/generate-skill-guides.mjs` | 快照测试 |
| P2-10 | **独立仓库** `relaybase-cli`：`register/config/list/search/get/call/balance/usage/topup/mcp` 与 `skills/relaybase/SKILL.md` | 不在本仓库轨道，建议单独立项 |
| P2-11 | 能力层与账户端点错误消息按 `Accept-Language` 双语 | `worker/lib/messages.ts` + 单元测试 |
| P2-12 | 文档、CHANGELOG、版本 `0.6.0` | `npm run check` |

---

## 附：当前在途工作

| 分支 / PR | 状态 |
|---|---|
| `claude/page-design-iteration-aeb188` → PR #4 | 全站近黑仪表主题改版，CI 绿，**待合并**。只改 `admin.css`，未动 `AdminClient.tsx`，与 Task 6 无文件冲突 |
| `codex/phase1-capability-layer` → PR #5 | 本计划 Task 1 之前的地基（P1-1 前半、P1-2、P1-3） |
