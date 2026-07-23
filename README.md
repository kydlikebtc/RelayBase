# RelayBase API

RelayBase 是一个面向公开、只读数据接口的预付费 API 网关。客户使用
RelayBase 自己签发的 API Key；服务端验证余额和端点价格后，再调用 TikHub
作为上游。稳定币充值通过可替换的支付适配器入账。

> 当前仓库默认是安全沙盒。未取得 TikHub 经销/白标书面授权、商户审核和适用
> 地区的法律意见前，不要打开真实代理或真实加密收款。

当前应用版本：`v0.3.0-preview.5` · API 契约版本：`v1`

[查看变更日志](CHANGELOG.md) · [查看发布与回滚规范](docs/RELEASES.md) ·
[查看 TikHub 来源与再分发边界](docs/TIKHUB-PROVENANCE.md)

## 已实现

- 公共首页、API 市场、控制台、定价页和 API 文档
- Google OAuth、EVM 钱包签名与可选受信任 Sites 身份登录
- 用户、用量、TikHub 加密数据源、目录定价和支付复核管理后台
- D1 用户、API Key、不可变余额账本、支付订单、端点目录和调用日志
- API Key 仅创建时展示明文；数据库只保存 SHA-256 哈希
- TikHub V5.3.2 静态参考市场收录 1,025 个 GET/POST 数据操作，并提供搜索、
  多维筛选、服务端分页和同页参数/示例详情
- 同步 TikHub OpenAPI 路径与可信价格目录；新端点默认禁用
- 后台可按路径设置客户价与上下架，也可先冻结服务端筛选结果，再原子批量调价、
  上架或下架；高风险或无可验证价格的端点强制关闭
- TikHub API Key 可在后台加密保存、在线验证、切换和永久撤销
- 余额原子扣减；TikHub 非 `200` 或网络失败自动原路退回内部余额
- 每个 Key 的分钟级限流、请求体限制、上游超时和响应头清洗
- 共享 TikHub Key 的全局秒级限流和账户并发保护
- NOWPayments 订单幂等创建、HMAC-SHA512 IPN 验签、事件持久化、异步二次查询和幂等入账
- 丢失支付回调的主动轮询对账，以及刷新后可恢复的充值地址和 invoice
- 重复入金、少付和异常终态的持久化人工复核、审计与精确退款冲销
- TikHub 转售授权和加密支付法律审查双重开关

## 本地运行

```bash
npm install
npm run dev
```

默认地址为 `http://localhost:3000`。未注入 Sites 身份头和 D1 时，公开页面可以
预览，但控制台写操作会返回明确的认证或数据库配置错误。

提交或发布前运行完整门禁：

```bash
npm run check
```

它会依次校验应用版本元数据、已提交参考目录的结构/计数/脱敏/稳定序列化、
TypeScript、ESLint、生产构建和集成测试。GitHub Pull Request 与 `main`
分支推送也会执行相同门禁。

生成 TikHub 静态参考市场时，传入已审计的本地 OpenAPI 快照；生成器不会联网：

```bash
npm run catalog:reference -- --input /absolute/path/to/tikhub-openapi.json
npm run catalog:reference:check -- --input /absolute/path/to/tikhub-openapi.json
npm run catalog:reference:validate
```

第一条命令稳定生成 `data/tikhub-catalog-reference.json`；第二条使用 `--check`
按字节验证已提交产物仍与同一输入一致，不会改写文件；第三条不依赖本地源快照，
会在默认 CI 中自检已提交产物的完整覆盖、统计、路径、输入脱敏与稳定序列化。
生成器只允许本地
`#/components/...` 引用，并对引用深度、数量、节点、字符串和展开体积设置硬上限；
它会安全展开 `parameters` 与 `requestBody` 所需输入结构，并把 Cookie、Token、
密码、代理和密钥字段的 `example/default` 替换成固定占位符；上游 description
中的原始示例代码块会移除，描述和响应说明中的凭据式赋值会再次净化。遇到外部引用、
循环或任何上限超出时直接失败。

生成数据库迁移：

```bash
npm run db:generate
```

部署时由 Sites 根据 `.openai/hosting.json` 创建并绑定 D1。迁移位于
`drizzle/0000_*.sql` 至 `drizzle/0012_*.sql`，必须按编号顺序执行。`0007`
会无损重建已有的支付事件表，以支持失败事件退避重试；`0009`–`0010`
增加加密上游凭据、唯一活动指针和目录凭据代次绑定；`0011` 保存目录覆盖计数和
上下游快照哈希；`0012` 增加机器安全分类、端点 revision，以及不可变批量预览与
应用回执。`0012` 会安全下架旧目录，迁移后必须重新同步并重新审核。

### 登录配置

- Google OAuth 回调地址固定为
  `${PUBLIC_APP_URL}/api/auth/google/callback`；服务端使用 PKCE、state、nonce
  和 Google 令牌校验，不能只信任浏览器 userinfo。
- 钱包登录使用一次性、限时的 EIP-4361 风格消息，绑定正式域名、链 ID 和地址；
  签名不发起交易。
- 会话 Cookie 为 `HttpOnly`、`SameSite=Lax`，生产 HTTPS 下带 `Secure`；
  数据库仅保存令牌哈希。
- `TRUST_SITES_IDENTITY_HEADERS` 默认关闭。只有托管边缘会剥离客户自带
  `oai-authenticated-user-*` 并注入已认证身份时，才可显式设为 `true`。
- 新 Google subject 不会仅凭同名邮箱接管已有账户；冲突必须走受控账户恢复。
- 管理员把用户设为 `suspended` 时，用户状态、全部客户 API Key 撤销、全部登录
  session 删除和管理员审计在同一 D1 原子批次提交；重新启用账户不会恢复旧凭据。

## 环境变量

复制 `.env.example` 的键名，在托管环境中设置真实值。不要提交真实密钥。
`PUBLIC_APP_URL` 必须是正式站点唯一的 HTTPS origin。`CATALOG_SYNC_SECRET`、`RECONCILIATION_SECRET` 与
`PAYMENT_ADMIN_SECRET` 分别保护目录、代理对账和异常支付操作。三者都使用至少
32 个互不相同的高熵字符，并与客户 API Key、TikHub Key 和支付商密钥完全分离。
`ADMIN_MASTER_SECRET` 用于完整管理后台，浏览器仅在内存中保留，服务端审计只记录
其不可逆指纹。

后台托管 TikHub Key 还要求
`TIKHUB_CREDENTIALS_ENCRYPTION_KEY`：它必须是 32 个随机字节编码成的、无
padding 的 43 字符 base64url。该 KEK 只存在于服务端 Secret 中，必须跨部署稳定
保存；丢失或错误会使现有密文不可解密并立即关闭上游调用。`TIKHUB_API_KEY`
只作为首次迁移前的环境变量回退。一旦在后台成功启用过托管 Key，系统会永久进入
managed mode；没有活动 Key、Key 已过期、KEK 错误或密文异常时都不会回退旧环境
变量。

关键开关：

- `RESELLER_AUTHORIZED=true`：只在 TikHub 已书面允许多租户转售/白标后设置。
- `CRYPTO_PAYMENTS_ENABLED=true`：支付商生产账户获批后设置。
- `LEGAL_REVIEW_CONFIRMED=true`：运营主体和目标客户地区完成法律审查后设置。

三个条件以及数据库、登录方式、TikHub/支付商密钥、管理密钥、已审核目录和五分钟
内的对账心跳未全部满足时，对应真实操作会安全失败。支付创建要求至少有一个已审核
开放的接口，避免“可以充值但没有服务可用”。

## API 市场参考目录

仓库内置的 `data/tikhub-catalog-reference.json` 来自 TikHub OpenAPI V5.3.2
静态快照，共 1,025 个 operations：GET 839、POST 186，覆盖 27 个平台和 53 个
实际 operation tags，并映射为 15 个 RelayBase 归一化类型。它用于能力发现、搜索
与详情展示，不代表当前部署的 TikHub Key 已有 scope，也不代表价格、授权或上游
状态已经可用于真实调用。

公开参考市场接口：

```text
GET /api/marketplace?q=user&platform=tiktok&tag=TikTok-App-V3-API&dataType=profile_creator&method=GET&surface=web&availability=available&limit=20&offset=0
GET /api/marketplace/detail?path=%2Fv1%2Ftiktok%2Fweb%2Ffetch_user_profile&method=GET
```

`GET /api/marketplace` 返回 `source`、全局 `stats`、`facets`、当前页
`endpoints`、`total`、`count`、`offset` 和 `nextOffset`；默认每页 20 条，可按
关键词、平台、TikHub 官方 `tag`、RelayBase 归一化 `dataType`、GET/POST 方法、
APP/WEB 调用表面和
`available|pending|restricted` 状态筛选。`GET /api/marketplace/detail` 必须同时
传入精确 `path` 与 `method`，返回同代 `source`、官方 tags、`operationId`、端点
描述、参数、请求体、响应状态与上游 Schema 标识，以及 cURL、JavaScript、Python
三种调用示例。`schemaRef` 是来源标识，不是可在该响应内独立解析的完整 components。

参考展示和真实可调用目录是两层状态。只有部署具备真实且已验证的 TikHub Key，
完成 OpenAPI 与可信价格目录的全量同步和覆盖证明，端点通过当前安全策略与人工审核，
客户价格已核验且明确上架，并且近期对账健康时，市场中的 `availability` 才会是
`available`。静态参考与实时目录还必须具有相同的快照哈希、操作数，以及完整一致的
`(method, path)` 身份集合；任何缺行、重复行或不同代数据都会保持 `pending`。
`pending` 和 `restricted` 只用于发现或审计，不能代理。客户程序应以
`GET /api/catalog` 返回端点级已开放目录；客户还必须确认响应中的
`mode=live`，并满足账户、余额、限流和最新 readiness 条件后才能真实调用。

## 上游端点与价格

客户路径使用 `/v1/...`，服务端只会转发到配置好的
`https://api.tikhub.io/api/v1` 或 `https://api.tikhub.dev/api/v1`，不能由客户
指定主机。

### 在管理后台配置 TikHub 数据源

打开 `${PUBLIC_APP_URL}/admin`，使用 `ADMIN_MASTER_SECRET` 登录后进入
“TikHub 数据源”：

1. 输入仅用于辨识的名称和 TikHub API Key。
2. 可先加密保存为备用，或让服务端向 TikHub 验证后立即启用。
3. 验证会在 30–60 秒超时范围内对临时网络/服务端错误最多尝试 3 次，并检查 Key
   状态、账户状态、到期时间和数据接口 scope。
4. Key 使用 AES-256-GCM、随机 96-bit IV 和绑定凭据编号的 AAD 加密；D1 只保存
   密文、完整 SHA-256 哈希、已验证 scope 与到期时间，管理页面只显示截断指纹。
5. 保存、切换和撤销与管理员审计使用同一 D1 事务；切换或撤销还使用状态版本
   比较，防止并发管理员相互覆盖。进入 managed mode 后，撤销唯一活动 Key 会
   安全关闭目录同步和客户调用，直到验证并启用另一个 Key。

每次活动 Key 或 scope 变化都会使旧目录代次失效。必须用新活动 Key 重新同步目录；
目录发布同时绑定 Key 指纹与状态版本，代理在扣费前再次核对，避免用新 Key 按旧
账户的 scope 或成本调用。

同步 TikHub 目录：

```bash
curl -X POST "$APP_URL/api/admin/catalog/sync" \
  -H "Authorization: Bearer $CATALOG_SYNC_SECRET"
```

对账任务改用 `RECONCILIATION_SECRET`；支付查询和孤儿订单恢复使用
`PAYMENT_ADMIN_SECRET`，不要复用目录管理密钥。

同步把 OpenAPI 中识别到的路径带入后台，包括 GET/POST 方法、摘要、描述与参数
schema。只有同时存在于 OpenAPI、方法匹配、位于活动 Key 的已验证 scope 内，且
在可信价格目录中找到成本的路径，才会标记为“价格已验证”；其他路径不能启用。
同步会将操作分为 `safe_data_read`、`ambiguous` 和 `prohibited`。只有明确读动作、
输入 schema 可完整检查且不接收 Cookie、会话、令牌、密钥或代理凭据的
`safe_data_read` 路径才允许审核上架；其他路径保留供审计，但不能公开代理。
字段检查会统一识别驼峰、连字符、数组/嵌套键和 `x-api-key` 等变体；客户请求在
扣费前还会递归执行同一输入保护。仅分页用途的明确 token 字段列入允许清单。
静态参考生成也只展开有界的本地 `$ref` 输入结构；外部引用、循环引用和超过
深度、节点、引用数量或体积限制的 schema 不会进入参考产物。

TikHub 当前价格目录的正式字段 `endpoint_uri` 与 `endpoint_cost` 会被直接解析；
显式零成本也属于已验证价格。完全相同的重复记录只计一次，而同一路径出现不同
成本、不同显式方法，或出现 GET/POST 之外的显式方法会让整次同步 fail closed，
并保留上一成功目录。后台“目录覆盖
证明”会展示 OpenAPI 操作数、价格原始/去重数、路径与方法映射数、仅价格目录数、
仅 OpenAPI 数、Key scope 排除数、最终正价/零价核验数、OpenAPI 版本和两个原始
响应的 SHA-256 指纹；这些计数必须满足闭合关系并随成功目录代次一起持久化，不能
用前端估算冒充全量同步。部署 `0011` 或 `0012` 后必须成功重新同步一次；旧目录没有完整覆盖
证据，或证据计数/哈希不自洽时，readiness 与真实代理都会 fail closed。

成本只接受 `0–100 USD`、最多 6 位小数的 JSON number 或普通十进制字符串；指数或
十六进制字符串、负数和无法精确表示到 USD micro 的非零值都会停止同步，不会被四舍五入
成免费接口。同一凭据下，如果 OpenAPI 快照不变而核价覆盖下降，或新核价覆盖异常
小于上一成功代次的一半，系统会保留旧目录，避免价格接口部分响应造成批量下架。

新端点同步后仍为禁用状态。同步不会覆盖人工客户价格；已审核端点的上游价格一旦
变化会自动停用并清除审核状态；上游完整快照中消失的端点也会停用。人工确认其为
公开、只读端点并核对客户价格后再启用：

```bash
curl -X PATCH "$APP_URL/api/admin/catalog" \
  -H "Authorization: Bearer $CATALOG_SYNC_SECRET" \
  -H "Content-Type: application/json" \
  --data '{
    "path": "/v1/tiktok/web/fetch_user_profile",
    "enabled": true,
    "readOnly": true,
    "customerPriceUsdMicros": 2000,
    "expectedRevision": 4
  }'
```

金额单位是 USD micros：`1 USD = 1,000,000`，因此 `2000` 表示 `$0.002`。
`expectedRevision` 必须取自最近一次 `GET /api/admin/catalog`；目录同步或其他
管理员先修改该端点时，旧 revision 会返回 `409`，不会静默覆盖。

### 批量定价与上下架

管理后台“路由与定价”会把当前平台、搜索、状态与安全分类作为服务端选择器。
“生成预览”后，服务端冻结每个端点的 revision、成本、客户价、审核状态、目录代次、
活动数据源指纹和 OpenAPI/价格快照哈希，并返回需手输的确认文本。预览默认 30 分钟
过期；批量上架最多 500 个端点，调价或下架最多 2,000 个，超过时必须缩小筛选范围。

预览和应用分别要求稳定且不同的 `Idempotency-Key`。应用只接受预览编号、version、
目标摘要和完整确认文本；任一端点、目录代次、活动 TikHub Key 或快照变化都会使
整批 `409`，不会只修改其中一部分。任一选中端点不安全、未核价或已过期时，整个
上架/调价预览为 `blocked`；批量下架只降低权限，并保留价格和审核证据。
如果 Worker 在写入预览项目期间中断，相同幂等键会先返回“生成中”；超过两分钟后
会按 D1 时间原子清理未完成计划，并用同一请求重新生成，不会返回残缺预览。

相关管理 API：

- `POST /api/admin/catalog/batches/preview`
- `GET /api/admin/catalog/batches/{planId}`
- `POST /api/admin/catalog/batches/{planId}/apply`

客户可以读取 `GET /api/catalog`，运营者可读取
`GET /api/admin/catalog` 查看开放与待审核路径。

## 客户调用

```bash
curl "$APP_URL/v1/tiktok/web/fetch_user_profile?uniqueId=tiktok" \
  -H "Authorization: Bearer rb_live_..." \
  -H "Idempotency-Key: profile-sync-20260724-001" \
  -H "X-RelayBase-Max-Cost-Usd-Micros: 2000"
```

`Idempotency-Key` 是每个付费请求的必填项；重试必须复用原值。返回头会包含
请求编号、本次实际扣费和调用后余额。建议把市场或开放目录中的当前微美元价格作为
`X-RelayBase-Max-Cost-Usd-Micros` 上限；若调用时价格已超过上限，服务返回
`409 price_quote_exceeded`，不会调用上游或扣费。只有 TikHub HTTP `200` 响应扣费；其他
状态会自动退款并转换为统一 RelayBase 错误体。即使状态为 `200`，服务端也会先
完整读取并验证有界 JSON；截断、超限、HTML 风控页或畸形 JSON 都按失败退款。

## 支付语义

当前适配器为 NOWPayments：

1. 后端使用客户与 `Idempotency-Key` 创建固定的 `$10 / $25 / $50 / $100`
   预付订单，重试不会创建第二个地址。
2. 浏览器成功页绝不入账。
3. IPN 验签并持久化后立即确认，再异步通过支付商 API 查询该 `payment_id`。
4. 只有最终状态 `finished` 才写入余额。
5. `(provider, payment_id, credit)` 形成唯一账本引用，重复和乱序回调不会重复充值。
6. 定时对账会重试未处理事件并轮询待确认订单，弥补回调丢失；对最近 7 天内
   “已拒绝且该付款从未入账”的案件，会在结案 6 小时后开始低频复查。同一付款
   成功查询后至少间隔 6 小时，服务商错误至少间隔 1 小时；每轮最多 4 笔、并发
   最多 2 笔，避免无限扫描或过度调用。
7. 少付、错币、错链、晚到款、重复入金和超过支付商金额 1 bp 容差的多付进入
   唯一的资金复核案件；普通订单恢复会
   被阻止，避免绕过案件。
8. `GET /api/admin/payment-reviews` 查看证据；只有再次向支付商查询且状态为
   `finished` 后，才可用 `POST /api/admin/payment-reviews/resolve` 入账；金额不能
   超过 `订单美元金额 × 实际到账 / 应付数量`，并始终以订单面值为上限。
9. “拒绝”只允许服务商已确认失败或过期且实际到账为零的案件；结案后若发现晚到
   资金，只有同一订单、同一服务商付款编号的已拒绝案件会自动重新打开，不能吞掉
   资金，也不会因父子付款共享订单状态而误建案件。
10. 人工入账以案件级唯一账本引用保证幂等；后续服务商退款只冲销该笔付款对应的
   正常/人工入账，不会误冲其他重复入金。
11. 对账除待确认订单外，还会轮询最近 180 天内仍有净入账的父付款与重复入金
    子付款；候选以付款级正向账本和未冲销状态为准，不依赖父子付款共享的订单
    状态。即使子付款仍在人工复核且父付款退款 IPN 丢失，也会发现并精确冲销。
12. 如果本轮确实调用了支付 provider、但所有 provider 查询都失败，对账返回
    `502`，只记录失败诊断，不刷新成功的 `reconciliation` 心跳；readiness 会随
    旧成功心跳过期而自动关闭真实代理和充值。

生产环境仍需配置外部定时触发器，并增加 AML/制裁筛查、按主体的充值限额、人工
退款审批和异常支付处置流程。

## 版本与发布

RelayBase 使用语义化版本。公开生产就绪前使用
`v0.x.y-preview.n`。在上游派生内容尚未取得公开再分发授权时，候选版本只允许形成
本地提交并部署到 owner-only Sites；不得向公开 GitHub 推送派生目录、tag 或
Release。门禁满足后，同一候选版本的代码、README、`VERSION`、变更日志、Git tag、
GitHub Release 和 Sites 保存版本必须来自同一源码树。优先使用同一提交 SHA；若
托管连接器重建了提交对象，Release 必须记录 GitHub SHA、Sites SHA 与双方一致的
Git tree SHA。

每次行为、配置、迁移或运营流程变化都必须同步更新：

- 对应源码与测试
- README 中受影响的使用或配置说明
- `CHANGELOG.md` 的 `Unreleased` 或新版本章节
- 必要的单向 D1 迁移和回滚说明

版本一致性由 `npm run check:version` 自动检查。完整分支、版本升级、tag、GitHub
Release、Sites 部署和回滚步骤见 [发布规范](docs/RELEASES.md)。

## 上线前清单

- TikHub 明确授权：多租户主密钥、原始 JSON 转售、白标、缓存/存储和价格加成
- 约定批发价、RPS、SLA、价格变更通知和合同终止迁移期
- 支付商完成 KYB，并确认运营主体和客户地区受支持
- 就加密收款、预付积分、AML、制裁和数据跨境取得书面法律意见
- 只启用公开、只读端点；禁用 Cookie、互动、发布、验证码和账号操作类接口
- 每分钟由受保护的外部调度器调用 `POST /api/admin/reconcile`，回退两分钟前
  仍未完成但已扣费的代理请求，并处理支付事件和轮询待确认充值
- 对账只在支付 provider 本轮没有“全部失败”时刷新成功心跳；超过五分钟没有成功
  心跳时，真实代理与充值都会自动关闭
- 设置生产密钥、回调 URL、监控、告警、日对账与备份
- 正式站点必须允许客户 API 与支付商 IPN 访问；owner-only 私有预览不能用于真实
  收款。切换公开访问前必须先完成授权、法律审查、条款、隐私政策与支持渠道配置

运行状态：

- `GET /api/health` 是进程存活检查，始终返回配置缺口与能力状态。
- `GET /api/readiness` 只有数据库迁移、登录、转售/法律门控、上游、支付、管理、
  已审核目录和近期对账心跳全部就绪时返回 `200`；未就绪返回 `503`。
