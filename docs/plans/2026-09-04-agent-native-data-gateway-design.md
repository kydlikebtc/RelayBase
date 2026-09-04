# RelayBase Agent 原生数据网关设计

- 日期：2026-09-04
- 状态：已确认（路线 A 为主线，路线 C 的 P1 项前置）
- 基线：`main` @ `1885553`，应用版本 `0.4.0-preview.5`
- 对标对象：xapi.to（面向 Agent 的 API 网关）

## 1. 背景与结论摘要

RelayBase 当前是面向人类开发者的多平台数据市场：客户在网页市场发现产品，用预充值余额与 `rb_live_` Key 调用 `/v1/...` 路径；运营方在后台同步上游目录、核价、上架；x402 提供钱包按批结算。财务正确性、安全分类、审计与合规门禁是它最强的部分。

对标 xapi.to 得到三个结论：

1. xapi 的分发方式是 Agent 原生：一行 `npx skills add` 让任意 Agent 学会发现与调用，Agent 可自助注册拿 Key，CLI 与 Skill 开源，文档提供 llms.txt 与 MCP。RelayBase 在这一层为零。
2. xapi 已把 RelayBase 依赖的同一个上游（TikHub）作为第三方服务上架，其 TikTok、抖音、小红书、微博指南中的 action ID 就是该上游的接口路径。RelayBase 的数据供给本身不构成差异化。
3. RelayBase 的热路径与资金兜底存在四个 P1 缺陷，在扩大分发面之前必须先修：每次付费请求执行完整 readiness 并全表扫描目录；对账窗口会被永久卡死的请求占满；x402 有多个无兜底的终态；Sites 身份头与同源检查存在越权面。

因此本设计以"保留内核、新增能力层与分发层"为主线，把内核 P1 修复作为第一阶段。

## 2. 目标、成功标准与非目标

### 2.1 目标

把 RelayBase 从"人类可浏览的数据市场"升级为"Agent 可自助发现、注册、调用、付费的数据网关"，并用中文社媒数据的深度与可信的财务合规内核形成差异化。

### 2.2 成功标准

| 指标                     | 现状                          | 目标                                     |
| ------------------------ | ----------------------------- | ---------------------------------------- |
| Agent 从零到首次成功调用 | 需人类登录网页创建 Key 并充值 | 不超过 3 分钟，无需打开网页              |
| 单次代理调用 D1 往返     | 约 32 到 51 次                | 不超过 15 次，测试断言                   |
| 对账与 x402 永久卡死状态 | 存在                          | 不存在，均有终态或人工入口               |
| CI 测试层次              | 仅后端集成                    | 新增单元层与前端层                       |
| 能力发现面               | 网页市场                      | 网页、CLI、Skill、MCP、llms.txt、OpenAPI |

### 2.3 非目标

- 不做 AI 网关、Sandbox、SMS 等 xapi 式广度。
- 不做第三方服务商自助上架。
- Stripe 法币充值需要 KYB，列为后续可选。
- 不做整体拆单体，只对本轮触碰到的逻辑做"抽出即模块化"。

## 3. 总体架构

```
Agent / 开发者
   │  CLI · Skill · MCP · HTTP
   ▼
分发层（新）  Key 作用域 · 账户端点 · 自助注册与绑定 · llms.txt/OpenAPI · 市场统计
   │
能力层（新）  capabilities 表 · /v1/c/{id} · 输入别名 · 分页游标 · 响应信封
   │
内核层（现有） 目录同步 · 计费 · 幂等 · 限流 · 容量路由 · 支付 · x402 · 审计 · readiness
   │
上游数据源（运行时配置，加密凭据）
```

设计原则：

- 能力层只做翻译，不碰账本、幂等与限流；现有资金不变量与 962 个断言原样保护。
- 所有新写入沿用"单语句守卫加 changes 校验"的模式；新表状态列一律带 CHECK。
- 任何门禁缺失仍然 fail closed；自助注册在 sandbox 模式下可注册、可发现、不可调用。
- 不引入新的 Cloudflare 绑定（Durable Objects、KV、Queues），因为托管仍是 OpenAI Sites。

## 4. Phase 0：内核 P1 修复（0.4.0-preview.6，迁移 0021）

### 4.1 热路径瘦身

问题：`handleProxyRequest` 开头调用 `operationalReadiness`，后者内部调用 `assertStoredCatalogTaxonomyIntegrity` 对整张 `endpoint_catalog` 按 500 行分页全扫描；同一请求内来源配置与凭据被解析三次；余额是对用户全量账本求和。

方案：

1. **readiness 缓存。** 新模块 `worker/lib/readiness-cache.ts`，以 env 对象为键的 `WeakMap`，TTL 默认 15 秒，可由 `READINESS_CACHE_TTL_MS` 覆盖。失效点与现有 `marketplaceOverlayCache` 完全一致：目录同步、单条与批量目录更新、凭据变更、来源配置变更、x402 配置变更、成员变更。`/api/readiness` 与 `/api/health` 保持直读不走缓存。
2. **目录完整性移出请求路径。** `catalog_sync_state` 新增 `taxonomy_verified_generation TEXT`。同步发布语句在同一 batch 内写入该列等于新代次；readiness 只比较 `taxonomy_verified_generation = last_success_generation`。对账任务每轮执行一次全量校验，不一致时把该列置空并写审计，平台在最多 1 分钟内退回 fail closed。
3. **请求级上游上下文。** 新类型 `UpstreamContext = { sourceConfig, credentialSnapshot, resolvedAt }`。`operationalReadiness` 返回值附带该对象，`handleProxyRequest`、`routedUpstreamFetch`、`resolveUpstreamProviderCredentialsForPath` 通过参数接收，不再各自查询。缓存命中时上下文来自缓存；凭据变更失效缓存。
4. **余额快照。** 新表 `balance_snapshots(user_id TEXT PK, balance_usd_micros INTEGER NOT NULL, through_ledger_id TEXT, through_created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`。扣款语句的 WHERE 改为：

   ```sql
   COALESCE((SELECT balance_usd_micros FROM balance_snapshots WHERE user_id = ?), 0)
   + COALESCE((SELECT SUM(delta_usd_micros) FROM balance_ledger
               WHERE user_id = ? AND created_at > COALESCE(
                 (SELECT through_created_at FROM balance_snapshots WHERE user_id = ?), '')), 0)
   >= ?
   ```

   快照由对账任务对最近 24 小时活跃用户重算，边界取 `created_at <= datetime('now','-1 second')`，避免与并发写入竞争。`currentBalance` 与仪表盘使用同一表达式。账本仍只追加。

5. **限流不变。** 现有 D1 GCRA 实现正确且单往返，保留。

验收：集成测试统计一次成功调用的 D1 语句数并断言不超过 15；缓存失效点各有一条用例。

### 4.2 对账饥饿

问题：预留之后、扣款之前崩溃的请求永久停在 `processing` 且账本无扣款；对账查询按时间升序取 100 条，死行占满窗口后真实的过期扣款永不退款。

方案：

- 状态集合在 `worker/lib/proxy-request-status.ts` 定义为 union 常量：`processing | charged | completed | refunded | reconciled | rate_limited | abandoned`。
- 对账新增单语句：`UPDATE proxy_requests SET status='abandoned', completed_at=CURRENT_TIMESTAMP WHERE status='processing' AND datetime(created_at) < datetime('now','-2 minutes') AND NOT EXISTS (SELECT 1 FROM balance_ledger WHERE reference_id = proxy_requests.ledger_reference_id)`。
- 现有退款逻辑保持，只处理账本中确有扣款的行；查询窗口排除终态。
- CHECK 约束留待表重建时补，本轮不重建表。

验收：用例构造"有预留无扣款"的行，跑对账后状态为 `abandoned`，且后续窗口能处理其后的正常过期扣款。

### 4.3 x402 兜底

问题：`settlement_failed` 无管理端处理；`executing` 卡死无清扫；失败分支不释放容量租约；租约表无回收；批次查询接口无鉴权无限流。

方案：

- 对账任务新增 x402 清扫：
  - `payment_verifying`、`payment_verified` 超过 10 分钟：置 `settlement_failed`，`failure_code = stale_<原状态>`。
  - `settlement_pending` 超过 10 分钟：置 `settlement_failed`，`failure_code = stale_settlement_pending_manual_review`，因为链上可能已成交。
  - `executing` 超过 5 分钟：置 `execution_failed`，保留 `revenue_recognized_at`，响应体注明付款已确认。
  - 所有清扫都是带状态前置条件的单语句 UPDATE。
- 新增 `POST /api/admin/x402/batches/{id}/resolve`，权限 `owner_write`，同源校验，body `{ action: "mark_settled_manually", transactionHash } | { action: "mark_expired" }`，仅对 `settlement_failed` 生效；交易哈希唯一索引防重；写审计。
- `payment_rejected` 与 `settlement_failed` 分支调用租约释放；对账任务删除 `expires_at` 早于 1 天的租约。
- `GET /api/x402/batches/{id}` 增加按 IP 的 GCRA 限流，scope `x402_lookup_ip`，默认 30 RPS burst 60。

验收：清扫三种超时各一条用例；人工结算重复交易哈希返回 409；查询限流返回 429 与 Retry-After。

### 4.4 安全两项

- **身份头。** 当 `productionAuthenticationConfigured` 为真时，`requireAuthenticatedUser` 与 `adminActorFingerprint` 一律忽略 `oai-authenticated-user-*` 头，不论 `TRUST_SITES_IDENTITY_HEADERS` 取值。readiness 新增只读字段 `trustedIdentityHeadersActive`。
- **同源。** `assertSameOrigin` 在 `PUBLIC_APP_URL` 已配置时只允许该 origin；未配置时才回退到请求自身 origin。

验收：生产配置齐全时携带身份头访问控制台返回 401；配置了公开站点地址后从 workers.dev origin 发起的写请求返回 403。

## 5. Phase 1：能力层（0.5.0-preview.1，迁移 0022）

### 5.1 数据模型

表 `capabilities`：

| 列                          | 类型                                                      | 说明                                                                         |
| --------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `id`                        | TEXT PK                                                   | 三段式 slug，正则 `^[a-z0-9]+(\.[a-z0-9_]+){1,3}$`，如 `douyin.user.profile` |
| `platform`                  | TEXT NOT NULL                                             | 与目录 platform 一致                                                         |
| `category`                  | TEXT NOT NULL                                             | 复用 `PROVIDER_DATA_TYPES`                                                   |
| `endpoint_path`             | TEXT NOT NULL FK → endpoint_catalog.path                  | 一个能力只指向一个端点                                                       |
| `http_method`               | TEXT NOT NULL CHECK IN ('GET','POST')                     |                                                                              |
| `status`                    | TEXT NOT NULL CHECK IN ('draft','published','deprecated') |                                                                              |
| `input_aliases_json`        | TEXT NOT NULL DEFAULT '{}'                                | 能力字段名 → 上游参数名                                                      |
| `pagination_json`           | TEXT                                                      | 游标入参、响应游标 JSON 路径、页大小字段、页大小上限                         |
| `response_items_path`       | TEXT                                                      | 返回条目数组的 JSON 路径                                                     |
| `summary_zh` / `summary_en` | TEXT NOT NULL                                             | 自写说明                                                                     |
| `revision`                  | INTEGER NOT NULL DEFAULT 1                                | 乐观并发                                                                     |
| `created_at` / `updated_at` | TEXT                                                      |                                                                              |

索引：`endpoint_path`，`(platform, status)`。一个端点可有多个能力作为别名或版本。

`endpoint_capabilities` 表升格为运行时真相：删除 `VERIFIED_ENDPOINT_CAPABILITIES` 与 `VERIFIED_ENDPOINT_METHODS` 常量，`endpointCapabilityFor` 改为读表并做 5 秒缓存；迁移把常量内容写入表（0019 已包含相同数据，迁移只校验存在）。后台新增证据编辑入口。

### 5.2 调用入口 `/v1/c/{capabilityId}`

处理顺序：

1. 解析能力，`status` 必须为 `published`，否则 `capability_not_found` 或 `capability_deprecated`。
2. 按 `input_aliases_json` 翻译输入；未知字段透传，但必须通过现有 `validateCatalogProxyInputs`。
3. 调用从 `handleProxyRequest` 抽出的内部函数 `executeCatalogRequest(ctx, catalogRecord, method, input)` 完成鉴权、幂等、限流、扣款、路由与校验，计费语义与五套计量口径不变。
4. 成功响应信封：`{ success: true, capability, data, items, nextCursor }`。`items` 按 `response_items_path` 提取，`nextCursor` 按 `pagination_json` 提取；提取失败返回 `null`，不伪造。

### 5.3 公开与管理接口

- `GET /api/capabilities?q&platform&category&limit&offset`：分页列表，含价格、可用性、7 天统计。
- `GET /api/capabilities/{id}`：详情，输入结构经现有 allowlist 过滤，含 curl、JavaScript、Python 示例。
- `GET /api/admin/capabilities`、`POST /api/admin/capabilities`、`PATCH /api/admin/capabilities/{id}`：权限 `catalog_write`，`expectedRevision` CAS。
- `POST /api/admin/capabilities/draft-from-endpoint`：从已上架端点生成草稿，slug 由平台、数据类型与路径末段推导。
- 同步导致端点下架时，同一 batch 内把关联能力置为 `deprecated`。

### 5.4 后台

"路由与定价"下新增"能力"子页：列表、从端点生成草稿、编辑 slug 与别名、发布与弃用。沿用现有的 `expectedRevision` 与审计模式。

## 6. Phase 2：Agent 分发层（0.5.0-preview.2 到 0.6.0，迁移 0023）

### 6.1 Key 作用域与限额

- `api_keys` 新增 `scopes_json TEXT NOT NULL DEFAULT '["data:call"]'`、`spend_limit_usd_micros INTEGER`、`spent_usd_micros INTEGER NOT NULL DEFAULT 0`。
- 作用域取值：`data:call`、`account:read`、`account:topup`。
- 累计花费在 `logApiCall` 的同一 batch 内更新；扣款前比较 `spent + price <= limit`，超限返回 402 `key_spend_limit_exceeded`。

### 6.2 账户端点（Key Bearer 鉴权）

| 接口                                 | 作用域          | 说明                                                               |
| ------------------------------------ | --------------- | ------------------------------------------------------------------ |
| `GET /api/account`                   | `account:read`  | 余额、限流、模式、账户类型、绑定状态                               |
| `GET /api/account/usage/{requestId}` | `account:read`  | 成本、退款、调用后余额、状态                                       |
| `POST /api/account/topups`           | `account:topup` | 复用支付创建内核；需 `Idempotency-Key`；不需同源检查；返回发票地址 |

### 6.3 自助注册与绑定

注册 `POST /api/auth/register`：

1. 前置：`SELF_REGISTRATION_ENABLED=true` 且 readiness 模式为 `live` 或 `partial`，否则 `registration_disabled`。
2. 按 IP 的 GCRA 限流，默认每小时 10 次，超限 `registration_rate_limited`。
3. 可选 `inviteCode`（仅记录，本轮无奖励逻辑）与 `label`。
4. 单个 batch 创建：`users` 一行，`email = {id}@virtual.relaybase.invalid`，`account_kind = 'virtual'`；一把含三项作用域的 Key；promo 账本记录 `entry_type = promo_credit`、`reference_id = promo:signup:{userId}`、金额 `SIGNUP_CREDIT_USD_MICROS`，默认 0 时不写；绑定令牌表 `account_bind_tokens(token_hash PK, user_id, expires_at, consumed_at)`，24 小时。
5. 响应一次性返回 `apiKey` 与 `bindUrl`。

`users` 新增 `account_kind TEXT NOT NULL DEFAULT 'google' CHECK IN ('virtual','google','wallet','chatgpt')`，迁移按现有身份回填。

绑定升级：`/bind?token=` 页面要求 Google 或钱包登录；回调时若令牌有效且该身份未绑定其他用户，则在同一 batch 内把 `auth_identities.user_id` 指向虚拟用户、更新 `users.email` 与 `account_kind`、消费令牌；冲突返回 409 `bind_token_invalid` 或 `identity_link_required`。

### 6.4 CLI、Skill 与 MCP

独立仓库 `relaybase-cli`，npm 包 `relaybase`，MIT。本仓库只提供 API 契约与生成脚本。

命令：`register`、`config set|show|health`、`list`、`search`、`get`、`call`、`balance`、`usage <requestId>`、`topup`、`mcp`。

约定：

- Key 存 `~/.relaybase/config.json`，权限 600；环境变量 `RELAYBASE_KEY` 优先。
- `call` 自动生成 UUID 幂等键并在重试时复用；`X-RelayBase-Max-Cost-Usd-Micros` 由 `get` 返回的价格自动填写；输出默认 JSON。
- `mcp` 为 stdio 模式，暴露 `search_capabilities`、`get_capability`、`call_capability`、`get_balance` 四个工具。
- Skill 包 `skills/relaybase/SKILL.md` 与 `guides/<platform>.md`，由本仓库 `scripts/generate-skill-guides.mjs` 调 `/api/capabilities` 生成，避免手写漂移。

### 6.5 文档 Agent 化

- `GET /llms.txt`：站点索引加能力目录链接。
- `GET /docs.md`：文档页的 Markdown 版本。
- `GET /openapi.json`：从能力表生成，公开无鉴权，缓存 30 秒。

### 6.6 市场社会证明

表 `capability_stats(subject_type TEXT CHECK IN ('capability','path'), subject_id TEXT, window TEXT CHECK IN ('7d'), calls INTEGER, success_rate_bps INTEGER, p50_ms INTEGER, p95_ms INTEGER, computed_at TEXT, PRIMARY KEY(subject_type, subject_id, window))`。

对账任务每 5 分钟从 `api_calls` 聚合最近 7 天；p95 用 `ORDER BY latency_ms LIMIT 1 OFFSET floor(0.95 * n)` 取值。市场卡片与能力详情展示。市场筛选状态同步到 URL 查询参数，能力详情可分享。

## 7. 错误处理与安全边界

新增错误码沿用 `{ error: { code, message, requestId } }`：`capability_not_found`、`capability_deprecated`、`capability_input_invalid`、`key_scope_denied`、`key_spend_limit_exceeded`、`registration_disabled`、`registration_rate_limited`、`bind_token_invalid`。

能力层与账户端点的错误消息按 `Accept-Language` 提供中英文；其他路径本轮不改。

安全边界：

- 自助注册与充值受 readiness 门禁；sandbox 模式下可注册、可发现、不可调用。
- Key 作用域在每个账户端点入口校验；`data:call` 缺失的 Key 在 `/v1` 返回 403 `key_scope_denied`。
- 绑定令牌只存哈希，一次性消费，24 小时过期。
- 所有新增写入沿用单语句守卫加 changes 校验；新表状态列带 CHECK。

## 8. 测试策略

- **单元层。** 新逻辑放 `worker/lib/`：能力输入翻译、游标与条目提取、slug 校验、快照余额表达式构造、readiness 缓存、请求状态常量。`tests/unit/*.test.ts` 用 `node --experimental-strip-types --test` 运行，不需要构建。
- **集成层。** 现有 `tests/rendered-html.test.mjs` 拆为 `tests/integration/{auth,payments,catalog,proxy,x402,capabilities,registration}.test.mjs`，共享 `tests/harness.mjs`；迁移列表改为读取 `drizzle/meta/_journal.json`。新增用例：D1 往返上限、`abandoned` 终态、x402 三种清扫与人工结算、生产配置下身份头被忽略、同源只认公开站点地址、能力调用与原始路径计费一致、注册限流与 promo 幂等、Key 作用域与花费上限、绑定冲突。
- **前端层。** Vitest 加 Testing Library 覆盖市场筛选与 URL 状态；Playwright 三条冒烟：首页、市场筛选到详情、控制台登录门。
- **CLI 仓库。** 自带测试与录制的 HTTP fixture。

## 9. 发布与迁移计划

| 阶段    | 版本                     | 迁移 | 主要内容                                                                                     |
| ------- | ------------------------ | ---- | -------------------------------------------------------------------------------------------- |
| Phase 0 | 0.4.0-preview.6          | 0021 | `taxonomy_verified_generation`、`balance_snapshots`、请求终态、x402 清扫与 resolve、安全两项 |
| Phase 1 | 0.5.0-preview.1          | 0022 | `capabilities` 表、`/v1/c/`、能力常量入库、后台能力子页                                      |
| Phase 2 | 0.5.0-preview.2 到 0.6.0 | 0023 | Key 作用域与限额、账户端点、注册与绑定、统计表、llms.txt 与 OpenAPI、CLI 仓库                |

每阶段按 doc-sync 门禁同步更新 README 与 CHANGELOG，按 `docs/RELEASES.md` 打 preview 版本。"在 xapi 上架 RelayBase 服务"作为渠道实验不需要代码，属于运营并行项。

## 10. 假设与待定

1. 托管仍是 OpenAI Sites，不引入 Durable Objects、KV 或 Queues；限流留在 D1。
2. CLI、Skill、MCP 放独立仓库，本仓库只提供 API 契约与生成脚本。
3. Stripe 法币与第三方服务商自助上架不在本轮。
4. 注册赠送额度默认关闭，由运营方通过 env 打开。
5. 能力 ID 采用 `platform.object.action` 三段式。
6. 单体拆分只做触碰即抽出，不做整体重构。

## 附录：对标要点

| 维度     | RelayBase 现状                 | xapi.to                               |
| -------- | ------------------------------ | ------------------------------------- |
| 定位     | 面向人类开发者的多平台数据市场 | 面向 Agent 的通用 API 网关            |
| 供给     | 单上游只读数据                 | 500+ API 加 AI 加 Sandbox，含同一上游 |
| 上架方式 | 运营方人工同步、核价、上架     | 服务商自助上架、审核、按调用分成      |
| 分发渠道 | 网页市场加文档加 curl          | CLI 加 Skill 加 MCP 加 Agent 自助注册 |
| 能力命名 | 原始路径                       | 归一化能力 ID 与原始 API 双轨         |
| 计费     | 预充值四档加 x402 按批结算     | 预扣结算、Key 限额、法币加稳定币      |
| 市场信息 | 仅运行状态                     | 成功率、p95、调用量公开               |
| 治理     | 极严，缺一即关                 | 宽松                                  |
