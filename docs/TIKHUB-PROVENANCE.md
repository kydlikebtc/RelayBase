# TikHub 来源、派生范围与再分发门禁

本文记录 RelayBase API 市场参考数据的来源、可重现性和发布边界。它不是 TikHub
授权书，也不授予任何上游文档、商标、接口或数据的许可。

## 来源快照

- 提供方：TikHub
- 用户侧 API 市场：<https://user.tikhub.io/dashboard/api-marketplace>
- 官方文档入口：<https://docs.tikhub.io/4579905m0>
- TikHub 使用条款：<https://docs.tikhub.io/5508540m0>
- TikHub 业务限制：<https://docs.tikhub.io/5432446m0>
- OpenAPI 版本：`V5.3.2`
- 本地取得日期：`2026-07-23`
- 原始字节数：`2,714,792`
- 原始 SHA-256：
  `f941ffbce28988ca158b2fb8febf2a206004eaba1d2d0e1a7eba9678f9461a01`
- 发现范围：1,025 个 operations（GET 839、POST 186）、27 个平台、53 个
  operation tags

原始 OpenAPI 文件不提交到仓库。发布证据应在受控存储中保留原始快照、上述哈希和
`npm run catalog:reference:check -- --input <snapshot>` 的成功结果。

## RelayBase 派生产物

`data/tikhub-catalog-reference.json` 是面向能力发现的有界派生产物，不是 TikHub
OpenAPI 的完整镜像：

- 路径统一为 RelayBase `/v1/...`；
- 保留 GET/POST、平台、官方 tags、`operationId`、说明、参数、请求体和响应状态；
- 将官方 tags 与 RelayBase 的 15 个归一化 `dataType` 分开呈现；
- 只展开输入所需的本地 `#/components/...` 引用，并限制深度、节点、字符串、引用数
  和展开字节；
- 对敏感字段的 example/default 做占位符替换；
- 移除上游 description 中的原始示例代码块，并净化描述和响应说明中的凭据式文本；
- 响应 `schemaRef` 只保留为上游来源标识，不包含可独立解析的完整 components；
- 不包含 TikHub API Key、RelayBase 客户 Key、支付密钥或管理密钥。

参考产物只表示 TikHub 文档中声明过的能力。它不证明当前 TikHub Key 拥有 scope，
不证明上游价格、稳定性或转售权，也不表示该端点已经在 RelayBase 上架。

## 授权与发布门禁

仓库目前没有可验证的 TikHub 文档/元数据再分发许可文本。公开以下任一内容之前，
必须取得并归档覆盖目标地区和业务模式的书面证据：

1. TikHub 经销、转售或白标授权；
2. API 市场元数据与派生文档的再分发权；
3. 商标、署名和必要的免责声明要求；
4. 上游条款要求的客户限制、速率限制与数据使用边界；
5. 由于 RelayBase 计划接受稳定币付款，TikHub 书面确认其“虚拟货币及相关行业”
   业务限制不禁止把加密资产仅作为 API 服务的付款方式。

在证据归档前，`0.3.0-preview.5` 只能作为私有验收候选：Sites 保持 owner-only，
真实代理、真实收款和公开访问保持关闭。即使代码和目录已部署，也不得把该候选描述为
公开商业上线。

TikHub 名称和相关标识归其各自权利人所有。RelayBase 是独立封装项目，不代表 TikHub
背书、合作或保证。
