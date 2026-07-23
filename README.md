# RelayBase API

RelayBase 是一个面向公开、只读数据接口的预付费 API 网关。客户使用
RelayBase 自己签发的 API Key；服务端验证余额和端点价格后，再调用 TikHub
作为上游。稳定币充值通过可替换的支付适配器入账。

> 当前仓库默认是安全沙盒。未取得 TikHub 经销/白标书面授权、商户审核和适用
> 地区的法律意见前，不要打开真实代理或真实加密收款。

## 已实现

- 公共首页、控制台、定价页和 API 文档
- ChatGPT / Sites 身份识别的控制台
- D1 用户、API Key、不可变余额账本、支付订单、端点目录和调用日志
- API Key 仅创建时展示明文；数据库只保存 SHA-256 哈希
- 端点白名单与按端点价格；目录同步后新端点默认禁用
- 余额原子扣减；TikHub 非 `200` 或网络失败自动原路退回内部余额
- 每个 Key 的分钟级限流、请求体限制、上游超时和响应头清洗
- NOWPayments 稳定币订单、HMAC-SHA512 IPN 验签、服务商二次查询和幂等入账
- TikHub 转售授权和加密支付法律审查双重开关

## 本地运行

```bash
npm install
npm run dev
```

默认地址为 `http://localhost:3000`。未注入 Sites 身份头和 D1 时，公开页面可以
预览，但控制台写操作会返回明确的认证或数据库配置错误。

生成数据库迁移：

```bash
npm run db:generate
```

部署时由 Sites 根据 `.openai/hosting.json` 创建并绑定 D1。迁移位于
`drizzle/0000_wandering_richard_fisk.sql` 和
`drizzle/0001_overrated_ted_forrester.sql`。

控制台身份依赖 Sites 转发并保护的 `oai-authenticated-user-*` 请求头。不要把
这一身份模式原样部署到允许客户端自行注入这些请求头的普通反向代理后面。

## 环境变量

复制 `.env.example` 的键名，在托管环境中设置真实值。不要提交真实密钥。

关键开关：

- `RESELLER_AUTHORIZED=true`：只在 TikHub 已书面允许多租户转售/白标后设置。
- `CRYPTO_PAYMENTS_ENABLED=true`：支付商生产账户获批后设置。
- `LEGAL_REVIEW_CONFIRMED=true`：运营主体和目标客户地区完成法律审查后设置。

三个条件未满足时，对应真实操作会安全失败，不会调用上游或创建付款。

## 上游端点与价格

客户路径使用 `/v1/...`，服务端只会转发到配置好的
`https://api.tikhub.io/api/v1` 或 `https://api.tikhub.dev/api/v1`，不能由客户
指定主机。

同步 TikHub 目录：

```bash
curl -X POST "$APP_URL/api/admin/catalog/sync" \
  -H "Authorization: Bearer $CATALOG_SYNC_SECRET"
```

新端点同步后仍为禁用状态。同步不会覆盖人工客户价格；已审核端点的上游价格一旦
变化，会自动停用并清除审核状态。人工确认其为公开、只读端点并核对客户价格后再启用：

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

## 客户调用

```bash
curl "$APP_URL/v1/tiktok/web/fetch_user_profile?uniqueId=tiktok" \
  -H "Authorization: Bearer rb_live_..."
```

返回头会包含请求编号、本次实际扣费和调用后余额。只有 TikHub HTTP `200` 响应
扣费；其他状态会自动写入退款流水。

## 支付语义

当前适配器为 NOWPayments：

1. 后端创建固定的 `$10 / $25 / $50 / $100` 预付订单。
2. 浏览器成功页绝不入账。
3. IPN 先验签，再通过支付商 API 查询该 `payment_id`。
4. 只有最终状态 `finished` 才写入余额。
5. `(provider, payment_id, credit)` 形成唯一账本引用，重复和乱序回调不会重复充值。
6. 少付、错币、错链、晚到款和退款都需要人工复核。

生产环境还应增加定时对账、AML/制裁筛查、充值限额、人工退款审批和提款地址白名单。

## 上线前清单

- TikHub 明确授权：多租户主密钥、原始 JSON 转售、白标、缓存/存储和价格加成
- 约定批发价、RPS、SLA、价格变更通知和合同终止迁移期
- 支付商完成 KYB，并确认运营主体和客户地区受支持
- 就加密收款、预付积分、AML、制裁和数据跨境取得书面法律意见
- 只启用公开、只读端点；禁用 Cookie、互动、发布、验证码和账号操作类接口
- 每分钟由受保护的外部调度器调用 `POST /api/admin/reconcile`，回退两分钟前
  仍未完成但已扣费的代理请求
- 设置生产密钥、回调 URL、监控、告警、日对账与备份
