# RelayBase API

RelayBase 是一个面向公开、只读数据接口的预付费 API 网关。客户使用
RelayBase 自己签发的 API Key；服务端验证余额和端点价格后，再调用 TikHub
作为上游。稳定币充值通过可替换的支付适配器入账。

> 当前仓库默认是安全沙盒。未取得 TikHub 经销/白标书面授权、商户审核和适用
> 地区的法律意见前，不要打开真实代理或真实加密收款。

当前应用版本：`v0.3.0-preview.2` · API 契约版本：`v1`

[查看变更日志](CHANGELOG.md) · [查看发布与回滚规范](docs/RELEASES.md)

## 已实现

- 公共首页、接口目录、控制台、定价页和 API 文档
- Google OAuth、EVM 钱包签名与可选受信任 Sites 身份登录
- 用户、用量、TikHub 加密数据源、目录定价和支付复核管理后台
- D1 用户、API Key、不可变余额账本、支付订单、端点目录和调用日志
- API Key 仅创建时展示明文；数据库只保存 SHA-256 哈希
- 同步 TikHub OpenAPI 路径与可信价格目录；新端点默认禁用
- 后台可按路径设置客户价与上下架；高风险或无可验证价格的端点强制关闭
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

它会依次校验应用版本元数据、TypeScript、ESLint、生产构建和集成测试。GitHub
Pull Request 与 `main` 分支推送也会执行相同门禁。

生成数据库迁移：

```bash
npm run db:generate
```

部署时由 Sites 根据 `.openai/hosting.json` 创建并绑定 D1。迁移位于
`drizzle/0000_*.sql` 至 `drizzle/0010_*.sql`，必须按编号顺序执行。`0007`
会无损重建已有的支付事件表，以支持失败事件退避重试；`0009`–`0010`
增加加密上游凭据、唯一活动指针和目录凭据代次绑定。

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

## 上游端点与价格

客户路径使用 `/v1/...`，服务端只会转发到配置好的
`https://api.tikhub.io/api/v1` 或 `https://api.tikhub.dev/api/v1`，不能由客户
指定主机。

### 在管理后台配置 TikHub 数据源

打开 `${PUBLIC_APP_URL}/admin`，使用 `ADMIN_MASTER_SECRET` 登录后进入
“TikHub 数据源”：

1. 输入仅用于辨识的名称和 TikHub API Key。
2. 可先加密保存为备用，或让服务端向 TikHub 验证后立即启用。
3. 验证会检查 Key 状态、账户状态、到期时间和数据接口 scope。
4. Key 使用 AES-256-GCM、随机 96-bit IV 和绑定凭据编号的 AAD 加密；D1 只保存
   密文、完整 SHA-256 哈希、已验证 scope 与到期时间，管理页面只显示截断指纹。
5. 切换或撤销使用状态版本比较，防止并发管理员相互覆盖。进入 managed mode 后，
   撤销唯一活动 Key 会安全关闭目录同步和客户调用，直到验证并启用另一个 Key。

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
账号、Cookie、发布、互动、验证码等高风险路径也会保留供审计，但不能公开代理。

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
    "customerPriceUsdMicros": 2000
  }'
```

金额单位是 USD micros：`1 USD = 1,000,000`，因此 `2000` 表示 `$0.002`。
客户可以读取 `GET /api/catalog`，运营者可读取
`GET /api/admin/catalog` 查看开放与待审核路径。

## 客户调用

```bash
curl "$APP_URL/v1/tiktok/web/fetch_user_profile?uniqueId=tiktok" \
  -H "Authorization: Bearer rb_live_..." \
  -H "Idempotency-Key: profile-sync-20260723-001"
```

`Idempotency-Key` 是每个付费请求的必填项；重试必须复用原值。返回头会包含
请求编号、本次实际扣费和调用后余额。只有 TikHub HTTP `200` 响应扣费；其他
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

生产环境仍需配置外部定时触发器，并增加 AML/制裁筛查、按主体的充值限额、人工
退款审批和异常支付处置流程。

## 版本与发布

RelayBase 使用语义化版本。公开生产就绪前使用
`v0.x.y-preview.n`；同一候选版本的代码、README、`VERSION`、变更日志、Git
tag、GitHub Release 和 Sites 保存版本必须来自同一源码树。优先使用同一提交
SHA；若托管连接器重建了提交对象，Release 必须记录 GitHub SHA、Sites SHA 与
双方一致的 Git tree SHA。

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
- 对账会写入运行心跳；超过五分钟没有成功心跳时，真实代理与充值都会自动关闭
- 设置生产密钥、回调 URL、监控、告警、日对账与备份
- 正式站点必须允许客户 API 与支付商 IPN 访问；owner-only 私有预览不能用于真实
  收款。切换公开访问前必须先完成授权、法律审查、条款、隐私政策与支持渠道配置

运行状态：

- `GET /api/health` 是进程存活检查，始终返回配置缺口与能力状态。
- `GET /api/readiness` 只有数据库迁移、登录、转售/法律门控、上游、支付、管理、
  已审核目录和近期对账心跳全部就绪时返回 `200`；未就绪返回 `503`。
