# Changelog

所有重要变更记录在此。RelayBase 在公开生产就绪前使用 preview 版本。

## Unreleased

### Changed

- 全站九个页面（首页、数据市场、定价、文档、登录、控制台、运营后台及其子页）从暖纸浅色
  主题改为近黑仪表主题：单一近黑底色、五级墨阶、一个信号绿加待处理琥珀 / 阻断红，直角、
  1px 发丝线、72px 网格与暗角。标签与读数使用 JetBrains Mono，标题使用 Noto Sans SC 900，
  两套字体经 `next/font` 自托管，不产生第三方字体请求。接口、计费语义、权限边界与数据结构
  均未改动。
- `app/globals.css` 的兼容别名层补齐了 `--font-display`、`--font-mono`、`--font-sans`、
  `--success`、`--surface-soft`、`--console-muted`、`--ink-muted` 与 `--tan-dark`：这些变量
  此前被 `admin.css`、`console.css` 与 `docs-pricing.css` 引用但从未定义，相关声明一直被
  浏览器静默丢弃，现已生效。

### Added

- 后台「路由与定价」新增「能力」子页（`app/admin/CapabilitiesTab.tsx`）：列出全部
  能力，从端点创建草稿，并以 `expectedRevision` CAS 切换 draft / published /
  deprecated。冲突时明确告知本次操作未生效并重新加载，不静默重试——重试会覆盖别人
  的修改。共用的管理端请求、校验与状态面板抽到 `app/admin/adminApi.tsx`，
  `AdminClient.tsx` 不再继续膨胀。

### Fixed

- `npm run lint` 不再扫描 `.claude/`。工作树建在仓库根的 `.claude/worktrees/` 下，
  eslint 会把其他工作树里的整份仓库副本一起扫，本地 `npm run check` 因此在 lint 阶段
  就失败（数千条来自副本的告警），测试根本跑不到。CI 从干净克隆运行，不受影响。
- 能力管理端的审计记录改为与写入同批，并加 `changes() = 1` 守卫。此前审计在写入
  **之后**单独执行：具名管理员身份无法归属时审计抛 401，而能力其实已经改完，运营
  看到失败去重试，只会撞上 CAS 冲突；同时被拒绝的 CAS 也会留下一条"改过了"的审计，
  读日志的人会据此相信状态变了。集成测试走 bearer 密钥路径，两种情况都没暴露，是
  在本地跑起后台点出来的。

## [0.5.0-preview.1] - 2026-09-08

### Changed

- 版本升至 `0.5.0-preview.1`。能力层（Phase 1）除后台「能力」子页外全部完成；子页留到
  全站近黑仪表改版落地后再做，避免同一批样式写两遍。

### Fixed

- 全新数据库不再丢失已验证的能力证据。迁移 `0019` 用
  `INSERT ... SELECT FROM endpoint_catalog` 播种 `endpoint_capabilities`，再逐条
  `UPDATE` 写入证据；全新库执行迁移时目录仍为空，播种 0 行、8 条 UPDATE 全部
  影响 0 行，8 个原生批量与分页端点在新部署上没有任何证据。运行时此前读的是两个
  硬编码常量，因此这个缺陷一直被掩盖。

### Added

- 首页 hero 新增 `app/components/HeroFlow.tsx`：以 three.js 绘制供给流水（分散供给 → 审核
  闸门 → 有序目录点阵，未通过审核的供给在闸门处被打回）。three.js 以动态 import 分离为独立
  chunk（gzip 171KB），其余页面不加载；`prefers-reduced-motion` 与视口宽度不足 1100px 时
  完全跳过，连 chunk 都不会请求。
- 迁移 `0023` 新增 `capability_evidence_seed`，并把
  `endpoint_capabilities_after_catalog_insert` 触发器改写为 `LEFT JOIN` 种子表：
  证据在目录行插入时注入，覆盖目录同步、人工 SQL 与测试夹具全部插入路径；种子
  缺失时 `COALESCE` 落回原来的 `direct`/`pending` 默认值。已有部署由同一迁移回填，
  并保护运营人工确认过的行。同一迁移新增
  `endpoint_capabilities_after_catalog_method_change`：目录同步用 `ON CONFLICT`
  重写 `http_method`，而证据是按方法给出的，仅 `AFTER INSERT` 的触发器覆盖不到这条
  路径——方法被改正为证据方法后端点将永远拿不回证据，x402 会按 `fanout` 少收。
- `endpoint_capabilities` 新增 `evidence_http_method`。被删除的
  `VERIFIED_ENDPOINT_METHODS` 常量让运行时在每次查询时确认目录仍在提供证据对应的
  方法；把方法存到行上保留了这一校验，同时让 `endpointCapabilityFor` 保持为对预载
  映射求值的纯函数。
- `executeCatalogRequest` 从 `handleProxyRequest` 中抽出，承载目录解析、输入校验、
  鉴权、幂等、限流、扣费与响应装配。能力入口复用同一实现，两条路径的计费与幂等
  语义因此不会分叉。搬移的函数体逐字节相同。
- 能力调用入口 `GET /v1/c/{capabilityId}`。路径段中畸形的百分号转义按 404 处理，
  不再变成 500。用量按端点记账；草稿与不存在同为 404，
  已下架为 410；输入别名冲突返回 400 `capability_input_conflict`。`items` 与
  `nextCursor` 提取失败时为 `null` 而非空数组。
- 公开能力接口 `GET /api/capabilities` 与 `GET /api/capabilities/{id}`。详情把上游
  参数名换成能力字段名后再输出，示例直接指向 `/v1/c/{id}`；输入结构仍经市场同一套
  allowlist 过滤。
- 管理端能力 CRUD：`GET|POST /api/admin/capabilities`、
  `PATCH /api/admin/capabilities/{id}`（`expectedRevision` CAS，冲突 409）与
  `POST /api/admin/capabilities/draft-from-endpoint`（推导不出合法 id 时 400）。
  目录同步下架端点时，同一 batch 内把关联**已发布**能力置为 `deprecated`；草稿是
  运营的在途工作，不会被同步销毁，也不会因此从 404 变成 410 而暴露其存在。
- `worker/lib/capability-io.ts` 新增 `translateCapabilityQuery` 与
  `parseCapabilityAliases`。查询串翻译单独实现：记录表达不了 `?id=1&id=2`，
  合并重复值会改变调用方的请求。单元测试由 34 项增至 41 项，集成测试增至 85 项。

  合并重复值会改变调用方的请求。
- 管理端能力写入落 `admin_audit_logs`（`capability.create` / `capability.update`）。
  目录同步的响应新增 `deprecatedCapabilities`，让运营看得到一次同步静默下架了多少
  个已发布能力。
- 单元测试由 34 项增至 43 项，集成测试由 76 项增至 88 项。

### Security

- 能力证据读取改为失败关闭。此前读表失败会降级成空证据并被缓存 5 秒，已验证的
  `native_batch` 端点会在 x402 报价里被当作 `fanout`：按 `requests.length` 而不是
  目标数计价，交付 50 条数据只收 1 个单位。降级并不等同于"回到删除常量之前"——
  常量是编译期的，不可能读不到。现在证据不可读时返回 503 `service_not_ready`，
  只有后台目录列表这类不计费的展示路径才降级。
- 就绪性探针扩展到 `evidence_http_method` 与 `capabilities` 表。此前停留在迁移
  `0022` 的数据库会报告 schema 就绪，却读不出运行时用来计价的那一列。
- 迁移 `0022` 新增 `capabilities` 表，作为能力层（Phase 1）的数据地基：能力 id 为
  主键，`endpoint_path` 对 `endpoint_catalog` 级联，`status` 默认 `draft`，
  `revision` 沿用既有的 `expectedRevision` 乐观并发。**当前没有任何路由读取该表，
  运行时行为与迁移前完全一致。**
- `worker/lib/capability-id.ts` 与 `worker/lib/capability-io.ts` 两个纯函数模块：
  前者负责能力 id 的校验、草稿 id 推导与列 CHECK 表达式；后者负责输入别名翻译，
  以及按 JSON 路径从上游响应提取 `items` 与 `nextCursor`。两者均只在缺失或类型不符
  时返回 null，不伪造游标或空数组——伪造会让调用方的分页循环静默出错。JSON 路径
  解析在解析期拒绝 `__proto__`、`constructor` 与 `prototype`，避免恶意上游响应经由
  操作员配置的路径触达原型链。单元测试由 9 项增至 34 项。
- 生产依赖通过 `overrides` 把 `nanoid` 升级到 `3.3.18`、`postcss` 升级到 `8.5.28`，修复
  GHSA-28wg-ghj8-5hjv、GHSA-2v37-7h3g-55p8 与 GHSA-fxqj-rqcc-2cmp；
  `npm audit --omit=dev --audit-level=high` 恢复为零高危生产依赖漏洞。

## [0.4.0-preview.6] - 2026-09-04

### Changed

- 版本升至 `0.4.0-preview.6`。
- readiness 结果按 Worker 实例缓存 `READINESS_CACHE_TTL_MS`（默认 10 秒）并在管理端
  写操作后立即失效；目录完整性全量校验改为由同步发布、定时对账、`/api/health`、
  `/api/readiness` 与公开目录 `/api/catalog` 执行，客户热路径只比较已验证代次。被
  调用端点自身的分类损坏仍由单行严格校验拦下，错误码由 `service_not_ready` 变为更
  精确的 `catalog_taxonomy_invalid`（状态码与"绝不触达上游"的保证不变）。
- 代理热路径去除重复的对账心跳查询、重复的上游来源与凭据解析，以及 1/256 概率触发
  的随机清理（等价清理已并入定时对账，并补上了此前缺失的 `rate_limit_buckets`）；
  上游尝试后的健康度、审计日志与 `last_used_at` 写入合并为一个 batch；代次与凭据一
  致性校验并入目录查询；扣款与 `charged` 标记同批；余额读取并入调用日志 batch。单
  次成功付费调用的 D1 往返由 26 次降至 14 次，并由集成测试以 15 次预算断言。
- 余额改为 `balance_snapshots` 快照加快照边界之后的账本增量；快照水位线比当前时间早
  5 秒以避开并发写入竞态。没有快照的账户自动退化为全量账本求和，正确性不依赖快照。

### Added

- 新表 `balance_snapshots` 与 `catalog_sync_state.taxonomy_verified_generation`
  （迁移 `0021`）。升级后该列为 `NULL`，首次对账完成前热路径判定为未验证。目录同步发布
  时先把该列置空，只有发布后的完整性全量扫描通过才盖章——同步只校验它自己写入的行，
  存量历史行必须由全量扫描覆盖。
- 对账的余额快照重算不与心跳共享事务，避免重算超时连带回滚心跳而关停真实代理与充值。
  由数据库瞬时故障降级的 readiness 结果不进入缓存，一次抖动不再让整个 Worker 实例在
  整个 TTL 内持续 503。
- 对账新增 `abandoned` 终态：预留超过两分钟且从未扣款的代理请求不再反复占满每轮
  100 条的复核窗口；这类请求没有扣款，因此不产生退款流水。
- 对账新增 x402 停滞批次清扫、失败分支释放容量租约与过期租约回收。清扫是**建议性**
  的：它无法知道某个执行是否仍在运行，因此执行器的终态写入也接受"已被清扫但尚无回执"
  的行，晚完成的执行仍会落库并自愈；停滞判定阈值为 30 分钟（默认配置下一次合法执行
  最坏可达约 20 分钟），终态写入影响 0 行时会记录批次编号。
- 新增 `POST /api/admin/x402/batches/{id}/resolve`，供 owner 人工确认结算
  （`mark_settled_manually`，需 Base 交易哈希）或标记过期（`mark_expired`），均需说明
  并写入管理审计；重复处理与回执冲突返回 `409`。
- 匿名 x402 批次查询按客户端地址限流
  （`X402_LOOKUP_RATE_LIMIT_RPS` / `X402_LOOKUP_RATE_LIMIT_BURST`）。
- 新增 `npm run test:unit` 单元测试运行器与 `worker/lib/` 纯函数模块；测试 harness
  统计 D1 往返，迁移清单改为读取 `drizzle/meta/_journal.json`。

### Security

- 生产登录（Google 与钱包）配置齐全后自动忽略 Sites 身份头，Worker 入口剥离全部
  `oai-authenticated-user-*` 请求头。`/api/health` 新增
  `capabilities.trustedIdentityHeadersActive` 反映当前状态。
- 同源检查在配置了 `PUBLIC_APP_URL` 时只接受该 origin，不再把请求自身的 Host 视为
  同源。

## [0.4.0-preview.5] - 2026-07-26

### Added

- 新增具名运营后台成员和 `owner` / `operator` / `auditor` 服务端 RBAC。主密钥只
  用于首次 Owner 引导或灾难恢复，不再保存为日常浏览器凭据；成员授权、角色变更和
  停用均要求显式确认并写入带具名用户来源的审计日志。
- 运营后台路由与 x402 清单改为每页最多 50 条，避免完整运行时目录一次性创建上千
  行 DOM，同时保留组合筛选和批量操作。
- 新增 API Key 与账户聚合两层持久化 GCRA 秒级限流；控制台展示每个 Key 与账户的
  RPS / burst，`429` 返回可执行的 `Retry-After` 和 `X-RateLimit-*` 响应头。
- 新增上游容量组、Key 路由优先级/权重、凭据与“容量组 + API 路径”健康状态、
  冷却熔断和逐次路由审计。标准 API 调用与 x402 批量共用同一容量控制。
- 运营后台可将同一 TikHub 账号的多个 Key 归入共享容量组，或为独立账号创建可
  叠加的容量组，并显示账号有效 RPS 与运行健康。
- 新增端点能力目录：独立记录执行模式、原生批量上限与目标编码、分页/游标字段、
  典型返回规模及 `verified` / `openapi_inferred` / `pending` 证据状态；数据市场、
  中英文文档和运营后台使用同一能力对象。
- 新增 `Hc` 客户请求、`Hu` 上游 HTTP attempt、`T` 逻辑目标、`D` 可验证返回条目
  与 `P` 分页单位五套独立计量；用户控制台显示近期标准请求的计量，x402 历史显示
  计划/实际上游请求与返回条目。
- x402 新增付款前容量租约、公平容量份额与可验证原生批量分片。报价会冻结能力
  revision、执行模式、逻辑目标数和计划上游请求数，付款后按冻结计划聚合结果。
- 运营后台容量组增加最近 15 分钟成功率、鉴权失败、账号限流、平均延迟与活跃
  x402 容量租约观测。

### Changed

- 版本升至 `0.4.0-preview.5`。
- 公共页运行状态只在 `/api/health` 同时返回 `ready=true` 与 `mode=live` 时显示
  Operational；支付选项只在 `paymentsEnabled=true` 时开放，其他状态均明确显示
  配置未完成或通道未开放。
- `/api/catalog` 改为复用数据市场的运行时可用性覆盖，只返回与后台、市场详情和
  实际代理一致的 `available` 路由，避免“目录可见但实际不可调用”。
- 上游限流从单实例固定桶改为每容量组的持久化全局原子限流，并对目录声明了更低
  RPS 的 API 路径叠加第二层原子限流；默认保留 20% 安全余量。
- 上游调用最多执行两次路由尝试；鉴权失败隔离具体 Key，余额、限流、超时、5xx
  或网络错误隔离对应容量组与路径。全部容量用满时返回
  `upstream_capacity_exhausted` 并保证不最终计费。
- 目录同步把可信价格目录中的接口 RPS 一并发布到数据市场、标准代理和 x402
  执行链路。
- 同账号多 Key 只在可归因于单凭据的 `401/403` 上切换；过期/禁用 Key 会提前
  排除，`402/408/429/5xx` 与不可归因的网络异常按账号容量组故障处理，不以备用
  Key 虚构吞吐或掩盖上游整体异常。
- 仅对端点级官方文档与当前 HTTP method 一致的能力启用原生批量；其余路径即使
  名称包含 `multi`、`list` 或 `batch`，仍保持 1:1 / fanout 并标记待确认。

### Migration

- 新增 `0020_regular_steve_rogers.sql`，建立具名管理员成员、角色与状态约束。
- 新增 `0018_previous_jackpot.sql`。迁移为旧活动凭据建立默认
  `10 RPS × 80%` 账号容量组，但不会自动启用未经运营方确认的备用 Key。
- 新增 `0019_previous_patriot.sql`。迁移建立端点能力、x402 容量租约与独立执行
  计量字段，并为已有 x402 批次保守回填 `fanout` 历史执行口径。

### Security

- 生产依赖 PostCSS 升级到 `8.5.18`，`npm audit --omit=dev --audit-level=high`
  恢复为零高危生产依赖漏洞。

## [0.4.0-preview.4] - 2026-07-24

### Fixed

- 目录与 OpenAPI 同步请求使用中性 User-Agent，并将来源抓取网络错误以去除 URL 的
  诊断写入私有 Worker 日志，便于区分平台出站限制与来源服务失败。
- 来源抓取改为手动拒绝 HTTP 重定向，避免运行时在 `redirect=error` 下把重定向
  直接折叠为无诊断的网络异常，同时仍禁止凭据跟随到其他 Origin。

### Changed

- 版本升至 `0.4.0-preview.4`。

## [0.4.0-preview.3] - 2026-07-24

### Fixed

- 管理后台运营总览与运行时数据源状态使用同一响应契约；不再因前端仍校验已删除的
  固定来源地址字段而拒绝正确响应。

### Changed

- 版本升至 `0.4.0-preview.3`。

## [0.4.0-preview.2] - 2026-07-24

### Breaking

- 删除固定来源地址和启动回退凭据环境变量；来源 HTTPS origin、API Key 与目录路由
  改为只在管理后台运行时配置。
- 新增 `UPSTREAM_ALLOWED_ORIGINS` 托管 Secret 作为精确来源 origin 白名单；留空、
  越界来源或验证失败时同步与真实代理全部 fail closed。
- 数据库迁移会永久撤销所有旧托管来源凭据、不可逆覆盖原密文并关闭托管来源；
  升级后必须重新保存运行时来源、重新录入并验证新凭据、完整同步并逐项审核，
  不能恢复旧密钥或沿用旧审核状态恢复代理。

### Added

- 新增运行时来源配置，以及文档待同步条目的暂存和发布存储；文档待同步记录与客户
  可调用目录保持隔离。
- 恢复运行时完整市场目录：同时发布完整定义条目和仅价格目录的 price-only
  文档待同步条目，不再因缺少方法定义而丢失后者。

### Changed

- 完整市场明确由“完整定义条目”和“price-only 文档待同步条目”组成。后者的
  `method` 保持为空，不进入客户可调用目录，也不能在文档补齐前上架。
- 后台可为文档待同步条目预设客户价；缺失的方法和输入定义只能由后续运行时文档
  补齐。同步不得静默覆盖人工客户价或自动上架新增条目。
- 版本升至 `0.4.0-preview.2`。

### Fixed

- 文档同步检查在可选 `data/` 目录不存在时不再抛出 `ENOENT`，仍会继续检查其他
  禁止提交的派生目录和公开文档。

### Security

- 真实来源不再写入公开代码、构建模板或示例环境文件；来源选择受 Secret 白名单
  和后台运行时配置约束，API Key 单独加密保存，公共接口不返回来源信息。
- 成功代理响应统一包装为 RelayBase 的 `{ success: true, data }`，不再透传外部
  服务的顶层文档、支持信息、消息、状态文本或请求 ID。

## [0.4.0-preview.1] - 2026-07-24

### Breaking

- 移除仓库内置的第三方完整 API 目录、目录生成器、来源快照、原始文档说明和精确
  来源指纹。
- API 市场改为只读取管理后台成功同步的运行时目录；未同步时返回空结果，不再使用
  静态回退。
- 公共市场来源字段改为通用运行时状态；不再返回 Provider 名称、OpenAPI 版本、
  原始描述、原始 operationId、响应 Schema 或快照哈希。
- 上游启动配置调整为运行时托管凭据、独立加密主密钥和商业门禁；部署升级时必须
  同步迁移 Secret。

### Added

- 新增 `docs/UPSTREAM-INTEGRATION.md`，定义公开源码、运行时目录与私有合规证据的
  边界。
- 公共文档检查会阻止派生目录文件、生成器、来源版本、固定数量和快照指纹重新进入
  仓库。
- API 市场详情使用 RelayBase 自写摘要、归一化分类和安全过滤后的运行时参数结构。
- 公开市场排除上游账户、凭据、价格和其他控制面路径。
- 新增无运行时同步时的空市场测试，以及运行时市场不泄露 Provider 元数据的测试。

### Changed

- 目录 taxonomy 模块改为 Provider 中性命名。
- 市场、站内文档、控制台和管理后台统一使用“上游数据源”“能力分类”等中性术语。
- 示例路径、标签和说明改为 RelayBase 自有的合成契约。
- 版本升至 `0.4.0-preview.1`，反映市场响应和部署配置的破坏性调整。

### Security

- 去除可被公开构建打包的第三方描述、参数全集、标签清单和来源哈希。
- 真实目录只在部署运行时获取并存入受控数据库；任何同步、覆盖、审核或对账异常均
  fail closed。
- 敏感性处理明确不替代书面转售授权、法律审查、支付商审批或付款模式确认。

## 0.3.0 preview 系列 — 2026-07

- 完成后台托管上游凭据、在线验证、切换、撤销和 AES-256-GCM 加密。
- 完成目录全量同步、覆盖证明、安全分类、人工核价和批量上下架。
- 增加 Google OAuth、钱包签名登录、用户与身份管理、会话和客户 API Key。
- 强化付费请求幂等、最高报价保护、原子预扣、失败退款和共享上游限流。
- 完成稳定币订单、IPN 验签、支付查询、人工复核、晚到款、重复入金与退款冲销。
- 增加定时对账、成功心跳、孤儿订单恢复和不可变资金证据。
- 建立商业授权、法律审查、支付审批和对账健康的生产门禁。

## 0.2.0-preview.1

- 建立生产安全基线、数据库迁移、管理 API、readiness 和审计。

## 0.1.0

- 初始 API 市场、客户 Key、余额账本与代理原型。
