# RelayBase 数据市场

RelayBase 是面向 AI、产品与研究团队的多平台数据市场。它将分散的公开数据能力
标准化为可发现、可比较、可计价、可调用的数据产品；客户使用 RelayBase 签发的
访问 Key 消费统一 `/v1/...` 路径，服务端负责供给审核、客户定价、余额预扣、
上游调用、失败退款、幂等、限流和审计。

当前应用版本：`v0.4.0-preview.4`。默认运行在安全沙盒。未完成书面商业授权、法律审查、
支付商审批、登录配置、目录审核和近期对账之前，真实代理与稳定币充值都会安全关闭。

## 已实现能力

- Google OAuth 与 EVM 钱包签名登录
- 用户、登录身份、会话、客户 API Key 和调用数据管理
- 管理后台维护运行时数据源、加密凭据、目录路由、成本、客户价和上下架状态
- 已恢复运行时完整市场目录；同时保留完整定义条目与仅价格目录的文档待同步条目，
  新端点默认下架，价格变化会自动等待复核
- 数据市场按平台、RelayBase 数据分类、产品类型、调用方式和可用状态筛选
- 预付余额、请求级幂等、最高报价保护、成功计费与失败自动退款
- NOWPayments 稳定币订单、验签回调、定时对账、晚到款、重复入金和退款冲销
- 管理员支付复核、孤儿订单恢复、不可变资金证据和完整操作审计
- 严格 readiness 门禁；任一关键配置、目录证据或对账心跳缺失时 fail closed

## 目录与文档策略

公开仓库不保存第三方完整 OpenAPI 快照、原始文档、官方标签清单、来源哈希或控制面
路由。`GET /api/marketplace` 只读取当前部署在管理后台成功同步的运行时目录：

- 未配置数据库或未完成同步时返回空结果。
- 公共列表只发布 RelayBase 自有分类和自写说明。
- 不公开 Provider 名称、来源地址、原始描述、原始 operationId、响应 Schema 或
  快照哈希。
- 上游内部账户、凭据、价格等控制面服务不会进入客户市场。
- 完整市场由“完整定义条目”和“文档待同步条目”组成。后者是价格目录存在、但尚未
  匹配到运行时接口文档与 HTTP 方法的 price-only 条目，只用于能力发现，不可调用
  或上架。
- 只有完成能力、文档、安全和成本校验，并由后台人工核价和明确上架的端点才会标记
  为 `available`。

详细边界见 [上游数据源集成边界](docs/UPSTREAM-INTEGRATION.md)。

## 本地开发

要求 Node.js `>=22.13.0`：

```bash
npm install
npm run dev
```

常用验证：

```bash
npm run typecheck
npm run lint
npm test
npm run check
```

`npm run check` 会验证版本一致性、公共文档敏感信息门禁、类型、代码规范、生产构建
和集成测试。

## 环境变量

复制 `.env.example` 的键名，在本地或托管 Secret 中填入真实值。不要提交任何真实
密钥、钱包私钥、支付凭据或客户数据。

### 上游

- `UPSTREAM_ALLOWED_ORIGINS`：允许管理员在后台选择的、以逗号分隔的精确 HTTPS
  origin 白名单；必须作为托管 Secret 保存，留空时同步、验证和代理全部 fail closed
- `UPSTREAM_CREDENTIALS_ENCRYPTION_KEY`：32 个随机字节编码成 43 字符、无
  padding 的 base64url；必须跨部署稳定保存
- `RESELLER_AUTHORIZED=true`：仅在多租户转售、白标、缓存和价格加成得到书面授权
  后设置
- `UPSTREAM_COMMERCIAL_CLEARANCE_CONFIRMED=true`：仅在付款模式已获上游书面确认
  且证据已私下归档后设置

来源地址、API Key 和目录路由只允许在管理后台运行时录入；公开代码、构建模板和
示例配置不得保存真实来源。后台只接受 `UPSTREAM_ALLOWED_ORIGINS` 白名单内的
HTTPS origin，并加密保存凭据。加密主密钥丢失、密文异常、活动 Key 撤销或过期
都会立即关闭真实上游调用。公共市场、健康接口、日志和构建产物只暴露中性运行
状态，不返回实际 Origin、数据源路由或凭据。

执行 `0014` 中性化迁移时，所有旧托管上游密钥都会被永久撤销，原密文会被不可逆
覆盖，托管模式和活动密钥也会被清空。升级后必须在后台重新保存运行时数据源、重新
录入并验证一条新凭据，再完成全量同步和人工审核；旧记录不能恢复或重新启用。

### 登录

- `PUBLIC_APP_URL`：生产站点唯一 HTTPS origin
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `WALLET_LOGIN_ENABLED=true`
- `AUTH_SESSION_TTL_DAYS`
- `TRUST_SITES_IDENTITY_HEADERS`：只允许 owner-only 私有预览使用；不能替代正式
  Google 与钱包登录

Google 回调地址固定为：

```text
${PUBLIC_APP_URL}/api/auth/google/callback
```

Google 登录使用 PKCE、state 与 nonce；钱包登录使用一次性限时签名消息，不会发起
链上交易。会话 Cookie 为 `HttpOnly`、`SameSite=Lax`，生产 HTTPS 下带 `Secure`。

### 支付与管理

- `PAYMENT_PROVIDER=nowpayments`
- `NOWPAYMENTS_API_KEY` / `NOWPAYMENTS_IPN_SECRET`
- `CRYPTO_PAYMENTS_ENABLED=true`
- `LEGAL_REVIEW_CONFIRMED=true`
- `ADMIN_MASTER_SECRET`
- `CATALOG_SYNC_SECRET`
- `RECONCILIATION_SECRET`
- `PAYMENT_ADMIN_SECRET`

管理与调度密钥必须互不相同，且至少包含 32 个高熵字符。浏览器只在当前管理会话
内存中保留主密钥；服务端审计仅记录不可逆指纹。

### x402 Agent 批量结算

x402 是与预充值并存的独立入口，不是 API Key 的可切换付款模式：

- 标准 `/v1/...` 请求携带 `Authorization: Bearer rb_live_...`，始终从登录账户的
  预充值余额扣费
- `POST /v1/x402/batch` 使用调用方钱包生成的 `PAYMENT-SIGNATURE`，不需要也不接受
  API Key 作为付款凭据；RelayBase 不生成或托管调用方私钥
- 首版固定使用 x402 v2 `exact`、Base 主网原生 USDC、同步批量、先支付后执行；
  一个批次一次结算

生产启用需要：

- `X402_ENABLED=true`
- `X402_PAY_TO_ADDRESS`：RelayBase 的 Base USDC 收款地址
- `X402_FACILITATOR_URL`：默认 CDP x402 facilitator
- `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`：仅用于 RelayBase 服务端向 CDP
  facilitator 鉴权；Secret 必须是 64-byte Ed25519 base64，不是调用方钱包私钥

使用私有 facilitator 时可改为
`X402_FACILITATOR_BEARER_TOKEN`。`X402_FACILITATOR_ALLOW_UNAUTHENTICATED=true`
仅允许在隔离的本地测试环境使用。

x402 与预充值账本严格隔离：充值属于现金流入与递延余额负债；标准 API 成功完成且
未退款时确认预充值用量收入。x402 只有 facilitator 结算成功、且 Base 交易哈希已
持久化时确认收入，永远不会充值或扣减用户余额。结算完成后批量执行仍可能失败；
首版不支持退款争议、部分成功计费、多链多币或自动降级。

## 管理后台

打开：

```text
${PUBLIC_APP_URL}/admin
```

后台提供：

- 实际用户、身份、会话、API Key 和用量统计
- 加密上游凭据的保存、在线验证、切换与永久撤销
- 运行时数据源 Origin、API 前缀、文档/价格/凭据路由与公开排除前缀
- 目录同步、覆盖证明、安全分类、成本与客户价
- price-only 文档待同步服务的隔离查看和客户价预设
- 单端点或批量定价、上架、调价和下架
- 单端点 x402 开关、单目标价格、每批上限与实际在线状态
- 支付订单、人工复核、退款冲销和孤儿订单恢复
- 预充值用量账本与 x402 Base USDC 结算账本的独立呈现和统一收入汇总
- readiness 缺口与操作审计

凭据使用 AES-256-GCM、随机 96-bit IV 和绑定记录编号的 AAD 加密；数据库只保存
密文、哈希、已验证 scope 与到期时间，管理页面仅显示截断指纹。

## 数据市场

运行时市场：

```text
GET /api/marketplace?q=profile&platform=example&category=profile_creator&dataType=profile_creator&method=GET&surface=web&availability=available&limit=20&offset=0
GET /api/marketplace/detail?path=%2Fv1%2Fexample%2Fprofile%2Fread&method=GET
```

`GET /api/marketplace` 返回 `catalog`、`stats`、`facets`、`endpoints`、`total`、
`count`、`offset` 和 `nextOffset`。完整市场包含已匹配运行时接口文档的完整定义
条目，也包含只存在于价格目录的 price-only 条目。price-only 条目的
`documentationStatus=pending`、`method=null`，不可调用或上架，直到后续运行时
文档补齐方法和输入定义并经新一轮同步匹配。`GET /api/marketplace/detail` 需要精确
的 `path`；查询完整定义条目时必须同时传入 `method=GET|POST`，查询 price-only
条目时省略未知方法。只有完整定义条目才会返回安全过滤后的输入结构和非空调用示例。

真实可调用目录：

```text
GET /api/catalog
GET /api/catalog?platform=example&dataType=profile_creator&tag=profile_creator&surface=web
```

客户必须同时确认响应中的 `mode=live`。未出现在 `/api/catalog` 的路径不可调用。

## 目录同步与审核

同步当前上游能力、文档状态和价格：

```bash
curl -X POST "$APP_URL/api/admin/catalog/sync" \
  -H "Authorization: Bearer $CATALOG_SYNC_SECRET"
```

同步会：

1. 获取运行时能力规范和可信价格目录。
2. 区分完整定义条目与 price-only 文档待同步条目，并校验完整性、路径、方法、
   分类、scope 和价格精度。
3. 解析 GET/POST、参数结构、RelayBase 数据类型和调用表面。
4. 对 Cookie、会话、令牌、密钥、写入、发布、互动和删除能力执行安全分类。
5. 在临时代次完成全部验证后原子发布；失败时保留上一成功目录。

后台可预设 price-only 条目的客户价，但不能补造缺失的方法或把它上架。只有在后续
运行时文档中出现匹配定义，并重新同步为完整定义条目后，才能继续安全分类、人工
核价和上架审核。最终只有 `safe_data_read`、文档与价格已验证且经过人工审核的
服务可以调用。客户价格使用 USD micros：`1 USD = 1,000,000`。

客户调用成功时统一返回 `{"success":true,"data":...}`；外部服务的顶层文档链接、
支持入口、消息、状态文本和请求 ID 不会透传。RelayBase 请求 ID 仅通过
`x-request-id` 响应头返回。

单端点审核示例：

```bash
curl -X PATCH "$APP_URL/api/admin/catalog" \
  -H "Authorization: Bearer $CATALOG_SYNC_SECRET" \
  -H "Content-Type: application/json" \
  --data '{
    "path": "/v1/example/profile/read",
    "enabled": true,
    "readOnly": true,
    "customerPriceUsdMicros": 2000,
    "expectedRevision": 4
  }'
```

批量操作使用服务端冻结的预览计划和独立幂等键。目录代次、端点 revision、成本、
分类、上游凭据或快照发生变化时，整批操作返回 `409`，不会部分提交。

## 客户调用

```bash
curl "$APP_URL/v1/example/profile/read?profile_id=demo-123" \
  -H "Authorization: Bearer rb_live_YOUR_KEY" \
  -H "Idempotency-Key: profile-read-20260724-001" \
  -H "X-RelayBase-Max-Cost-Usd-Micros: 2000"
```

- `Idempotency-Key` 是每个付费请求的必填项，重试必须复用原值。
- `X-RelayBase-Max-Cost-Usd-Micros` 防止调用期间调价。
- 只有完整、有界、合法的上游 HTTP `200` JSON 响应才扣费。
- 网络失败、非成功状态、超限、截断、HTML 或畸形 JSON 会自动退款。
- 返回头包含请求编号、本次实际扣费和调用后余额。

完整调用说明见站内 `/docs`。

## 支付与对账语义

稳定币充值采用预付订单：

1. 客户和幂等键唯一确定 `$10 / $25 / $50 / $100` 订单。
2. 浏览器成功页不会直接入账。
3. IPN 通过签名与服务商查询双重确认。
4. 只有最终 `finished` 状态写入余额。
5. 重复、乱序回调和重复入金不会重复充值。
6. 少付、错币、错链、异常多付和晚到款进入管理员复核。
7. 服务商退款只冲销对应付款的净入账。
8. 定时对账持续检查待确认、失败后晚到款、重复入金和仍有净余额的历史付款。

Worker 已实现 `scheduled` 入口。生产必须配置每分钟 Cron Trigger，或由受保护的
外部调度器调用：

```text
POST /api/admin/reconcile
```

本轮所有支付查询都失败时不会刷新成功心跳；心跳超过五分钟后真实代理与充值自动
关闭。

## 版本与发布

RelayBase 使用语义化版本；公开生产前使用 `v0.x.y-preview.n`。行为、配置、迁移或
运营流程变化必须同步更新：

- 源码与测试
- README 与站内文档
- `CHANGELOG.md`
- `VERSION`、`package.json` 和 lockfile
- 必要的单向数据库迁移及回滚说明

发布规范见 [docs/RELEASES.md](docs/RELEASES.md)。

公开 GitHub 分支不得包含第三方派生目录、原始文档或曾包含这些 blob 的提交历史。
生产部署还必须满足书面商业授权、法律审查、支付商 KYB、AML/制裁流程、正式客户
条款、隐私政策、支持渠道、监控、备份和定时对账。敏感性处理不替代任何授权。

## 健康检查

- `GET /api/health`：进程存活与配置缺口，始终返回 JSON。
- `GET /api/readiness`：只有数据库、登录、商业授权、法律、上游、支付、管理、
  已审核目录和近期对账全部就绪时返回 `200`；否则返回 `503`。
