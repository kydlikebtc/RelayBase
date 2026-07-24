# Changelog

RelayBase 的用户可见变化、计费语义、安全边界与数据库迁移都记录在这里。版本号遵循
[Semantic Versioning](https://semver.org/)；在公开生产就绪前使用预发布版本。

## [Unreleased]

### Added

- 待下一轮迭代记录。

## [0.3.0-preview.6] - 2026-07-24

### Added

- 新增独立的 `TIKHUB_CRYPTO_PAYMENT_CLEARED` 生产门禁；只有 TikHub 已书面确认其
  业务限制不禁止把稳定币仅作为 API 服务付款方式、且证据已归档后才能设置为
  `true`。
- D1 迁移 `0013` 将 RelayBase 归一化 `dataType`、TikHub 官方 tags、调用表面和
  `operationId` 持久化到同步暂存、实时端点目录与不可变批量计划。
- `0013` 同时增加余额账本 UPDATE/DELETE 与支付订单 DELETE 保护触发器，用户级联
  删除不能再移除已有财务审计证据。
- 管理目录与批量预览增加精确数据类型、官方 tag 和调用表面选择器，可按同一分类
  范围批量上架、重算客户价或下架。
- Worker 新增 `scheduled` 对账入口；托管 Cron Trigger 可以直接运行与受保护管理
  API 相同的退款、支付事件与状态轮询流程。
- 支付后台新增“已知订单号 + NOWPayments payment_id”的受控恢复表单；用户最近
  充值新增实际入账、退款冲销和复核原因。

### Changed

- 运营后台将 readiness 缺失代码显示为可执行的中文说明；用户控制台在书面澄清
  缺失时明确说明真实充值保持关闭。
- 静态参考生成器与实时 OpenAPI 同步共享同一套数据类型和调用表面归一化规则；
  开放目录返回当前成功同步代次的分类元数据，参考市场只有在实时分类也完全一致时
  才叠加价格和 `available` 状态。
- 管理用户列表新增 Google/钱包/Sites 身份来源、钱包地址、有效 API Key 与会话数；
  暂停/恢复更新要求旧状态 CAS，避免陈旧后台页面覆盖并发安全操作。
- 正式 readiness 现在同时要求 Google OAuth 和钱包登录；Sites 身份头仅作为私有
  预览回退。
- 对账会低频复查最近 7 天的 `failed` 零入账订单，并取消已入账付款 180 天退款
  轮询上限。

### Security

- 书面澄清门禁缺失、拼写错误或不是精确 `true` 时，真实 TikHub 代理、新充值和
  `mode=live` 全部 fail closed；其他支付与法律开关已满足时，支付接口返回专用
  `tikhub_crypto_payment_not_cleared` 错误。
- `0013` 会安全下架全部旧目录、清除审核和成功同步代次，并丢弃未完成的同步暂存与
  租约；必须用完整分类元数据重新全量同步、人工复核后才能再次开放真实调用。分类
  元数据缺失、损坏、超限或与参考快照不一致时继续 fail closed。
- 实时同步会拒绝畸形 v1 operation、归一化后重复路径，以及包含密钥、Token 或
  Bearer 凭据样式文本的分类标签；失败同步不会替换上一成功目录。readiness 通过
  独立 `taxonomyReady` 能力报告严格分类校验，避免虚假的 `mode=live`。
- 首次 Google/钱包登录的用户与身份写入改为同一 D1 事务；任一步骤失败都会回滚，
  不会留下无法重试的孤立账户。
- 会话和客户 API Key 的最终 INSERT 会在事务内重新确认用户仍为 active，关闭与
  管理员暂停操作竞态导致凭据在恢复账户后重新生效的窗口。

## [0.3.0-preview.5] - 2026-07-24

### Added

- 新增 TikHub OpenAPI V5.3.2 静态参考市场与可重现生成器，收录 1,025 个
  operations（GET 839、POST 186）、27 个平台和 53 个实际 operation tags；
  `catalog:reference` 负责生成，`catalog:reference:check` 使用 `--check` 做字节级
  过期校验。
- 新增公开的 `GET /api/marketplace` 能力发现接口，支持关键词、平台、53 个 TikHub
  官方 tags、15 个 RelayBase 归一化类型、GET/POST 方法、APP/WEB 调用表面、
  可用状态筛选和服务端分页。
- 新增 `GET /api/marketplace/detail` 详情接口与同页市场详情，展示端点描述、参数、
  请求体、官方 tags、`operationId`、响应状态与上游 Schema 标识，以及 cURL、
  JavaScript 和 Python 三种调用示例。
- 客户付费调用支持可选 `X-RelayBase-Max-Cost-Usd-Micros` 上限；实时价格超过
  客户报价时返回 `409 price_quote_exceeded`，不调用上游也不扣费。

### Changed

- 静态参考市场明确区分“可发现”和“可调用”：只有真实 TikHub Key、完整目录同步与
  覆盖证明、当前安全审核、核价并上架、近期对账健康全部满足时，端点才标记为
  `available`；`pending` 与 `restricted` 不进入真实代理。
- 客户文档不再把所有公开数据能力表述为“仅 GET”；安全审核后的只读数据端点可以
  使用 GET 或 POST，但写入、发布、互动、删除和控制面操作仍禁止代理。

### Security

- 上线门禁新增 TikHub 业务限制核对：由于产品计划接受稳定币付款，必须先取得上游
  对“虚拟货币及相关行业”限制适用范围的书面澄清；确认前真实加密收款保持关闭。
- 静态参考生成器只解析有界的本地 `#/components/...` 引用，并为引用深度、引用数、
  节点、字符串和展开体积设置硬上限；安全展开参数与请求体输入，外部引用、循环和
  超限 schema 均 fail closed。
- 生成器和运行时会对 Cookie、Token、会话、密码、代理、私钥和 API Key 字段的
  `example/default` 做字段感知脱敏；本次参考快照中的结构化敏感输入值全部替换为
  固定占位符。
  description 与响应说明中的凭据式赋值会再次净化，上游原始示例代码块不会进入公开
  参考产物。默认 `npm run check` 新增不依赖源快照的产物结构、完整覆盖、脱敏和
  稳定序列化校验。
- 公开市场只有在实时同步的 OpenAPI 快照哈希、操作数与完整 `(method, path)`
  身份集合均和已提交参考快照一致时，才会叠加 `available` 与客户价格；不同代、
  缺行或重复目录保持 `pending`，避免旧 Schema 搭配新价格或可用状态。
- 当一轮对账存在支付 provider 调用且全部失败时，不再刷新成功
  `reconciliation` heartbeat；仅记录失败诊断、返回 `502`，让 readiness 随旧成功
  心跳过期而安全关闭。
- 管理员停用用户时，用户状态变更、该用户全部 API Key 撤销、全部登录 session
  删除和管理员审计在同一 D1 原子批次提交；重新启用不会恢复旧凭据。

## [0.3.0-preview.4] - 2026-07-23

### Added

- 管理后台“路由与定价”新增服务端批量预览、精确确认和原子应用流程，可按平台、
  搜索、状态和安全分类批量上架、重算客户价或下架；预览和应用各自支持幂等重放。
- D1 迁移 `0012` 增加端点 revision、`safe_data_read` / `ambiguous` /
  `prohibited` 安全分类，以及持久化批量计划、不可变目标项、前后摘要和应用回执。
- 管理 API 新增 `POST /api/admin/catalog/batches/preview`、
  `GET /api/admin/catalog/batches/{id}` 和
  `POST /api/admin/catalog/batches/{id}/apply`。

### Changed

- 新同步端点一律以禁用、未人工复核状态写入；机器安全分类不再复用 `read_only`
  字段。明确写动作、控制面端点或接收 Cookie、会话、令牌、密钥和代理凭据的操作
  不能进入公开代理；驼峰、连字符、嵌套参数和敏感字段前后缀使用同一规范化规则。
- 单端点目录更新要求 `expectedRevision` 并在更新、审计同一事务中比较旧价格、
  状态、代次和 revision，避免多个管理员静默互相覆盖。
- TikHub Key 在线验证对临时网络、限流和服务端错误最多尝试 3 次，单次超时按
  `UPSTREAM_TIMEOUT_MS` 限制在 30–60 秒；创建、激活和撤销的状态变化与管理员
  审计改为原子提交。
- 未撤销 TikHub 凭据才计入 100 条运营上限；达到上限与相同 Key 重复现在返回
  不同错误。

### Security

- 批量应用绑定管理员指纹、目录代次、活动 TikHub 凭据编号/指纹/状态版本、
  OpenAPI 与价格快照哈希和每行 revision。任一 CAS 不匹配时整批零变更并要求
  重新预览。
- 批量应用要求独立稳定的 `Idempotency-Key`、64 位目标摘要、预览 version 和
  服务端生成的完整确认文本；成功回执可重放但不会重复增加 revision 或审计。
- 公开目录与真实代理统一要求当前安全策略和完整覆盖证明；批量预览中断后使用
  D1 时间判定并原子恢复，目录同步发布与其管理员审计在同一事务落库。
- 迁移 `0012` 会把旧目录安全下架并标记为需重新同步，防止历史启发式只读状态被
  当作新安全策略的人工批准。

## [0.3.0-preview.3] - 2026-07-23

### Added

- D1 迁移 `0011` 持久化 OpenAPI 版本、操作数、价格原始/去重、路径与方法映射、
  仅价格目录、仅 OpenAPI、Key scope 排除、正价/零价/待核验分解，以及两个原始
  响应的 SHA-256。
- 管理后台新增“目录覆盖证明”，展示成功目录代次的覆盖计数、活动 Key 指纹和
  快照指纹；同步完成提示不再丢弃已核价与待核价数量。

### Fixed

- 目录价格解析改为兼容 TikHub 当前正式字段 `endpoint_uri` /
  `endpoint_cost`；此前使用旧式 `path` / `price` 形状会使真实全量同步识别为
  0 条并失败。
- 显式零成本端点现在会标记为价格已验证；完全相同的重复价格记录安全去重。
- 同一路径出现冲突成本或冲突显式方法时整次同步 fail closed，保留上一成功目录、
  清理暂存数据与同步租约，不会随机采用最后一条价格。
- 价格记录显式声明 GET/POST 之外的方法时不再降级成方法通配符，而是停止同步。
- 成本使用严格的 USD micro 定点解析；指数/十六进制字符串、负数、超过 6 位小数和
  小于 1 micro 的非零成本不再被隐式接受或舍入为零。
- 同一凭据的价格覆盖异常缩小时保留上一成功目录，防止价格接口部分响应批量下架
  端点并清除人工审核。
- OpenAPI 同一路径多方法或出现 GET/POST 之外的方法时停止同步，不再以路径数
  冒充操作数。

### Security

- readiness 与付费代理新增 `0011` schema 与证据自洽校验；数据库未迁移或旧
  目录尚未重新生成覆盖证据时继续安全关闭，不会沿用旧目录计费。
- 覆盖卡只在所有计数闭合且两个 64 位快照哈希有效时展示；损坏证据不会被前端
  当作成功同步。
- 管理页面只显示快照哈希和截断 Key 指纹，不暴露 TikHub Key 或价格目录原文。

## [0.3.0-preview.2] - 2026-07-23

### Fixed

- 同一服务商付款存在开放案件时，任何状态查询都会先刷新带唯一观察 ID 的案件
  证据；人工拒绝再对最初读取的证据执行原子比较。即使旧的零到账查询晚于足额
  到账查询落库，也不能形成 ABA 并让旧拒绝覆盖资金。
- 人工案件结算后的账本冲销、订单状态和管理员审计全部绑定本次 action 与请求
  哈希；失败或过期的管理请求不能回退并发退款状态，也不会留下假成功审计。
- 对最近 7 天内已拒绝且未入账的 NOWPayments 付款增加有时间窗、轮询间隔、
  批次和并发上限的低频对账；即使晚到资金 IPN 丢失也会重新打开案件。
- 晚到款重开必须精确匹配同一订单与服务商付款编号，避免父付款因子付款案件改变
  共享订单状态后被误建复核案件。
- 已入账父付款的退款轮询改以正向账本和未冲销状态为准，不再依赖父子付款共享的
  订单状态；子付款仍在人工复核时也不会漏掉父付款退款。

## [0.3.0-preview.1] - 2026-07-23

### Added

- 管理后台新增“TikHub 数据源”，支持 API Key 加密保存、在线验证、备用、
  CAS 切换、到期显示和永久撤销。
- D1 迁移 `0009`–`0010`，增加 AES-256-GCM 密文、完整 Key 哈希、已验证
  scope、到期时间、唯一活动凭据状态以及目录凭据代次。
- 管理 API `GET/POST/PATCH /api/admin/upstream-credentials`；列表只返回
  凭据元数据和 16 位指纹，不返回明文、密文或完整哈希。

### Changed

- 代理、目录同步、readiness 和管理总览统一从活动 TikHub 凭据 resolver 取值；
  首次启用托管模式后，缺失、撤销、过期或无法解密时不再回退环境变量。
- 目录同步在上游读取前取得租约，只允许 OpenAPI 与价格目录方法一致的交集进入
  可定价状态，并按活动 Key scope 隔离端点。
- 目录发布绑定活动 Key 指纹和状态版本；切换/撤销 Key 会使旧目录失效，代理在
  扣费前再次校验目录代次。
- 支付人工入账仅接受服务商 `finished`，且金额受实际到账比例和订单面值双重上限
  约束。

### Security

- TikHub Key 使用 32-byte 服务端 KEK、随机 96-bit IV、AES-256-GCM 和绑定
  provider/凭据编号/格式版本的 AAD 加密。
- Key 验证同时检查 TikHub 响应码、Key/账户状态、到期时间和 scope；运行时对
  密文、scope、到期和状态指针异常全部 fail closed。
- 永久撤销凭据时同时清除其可解密密文，仅保留哈希指纹和审计元数据。
- 人工支付案件只有“失败或过期且实际到账为零”才能拒绝；结案后发现晚到资金会
  自动重新打开案件。

### Fixed

- 阻止备用 Key 在并发启用期间被误撤销，也阻止旧确认框用新状态版本执行操作。
- 阻止 price-only 或方法不匹配的路径被误标为可信价格并上架。
- 阻止并发目录同步在取得租约前重复读取可能计费的 TikHub 价格目录。
- 阻止部分付款按完整订单面值人工入账，以及已收到资金的支付案件被直接拒绝。

## [0.2.0-preview.1] - 2026-07-23

### Added

- 完整的公共首页、接口目录、定价、文档、客户控制台与运营管理后台。
- TikHub OpenAPI 与可信价格目录的全量同步、分阶段发布、人工审核、定价和上下架。
- Google OAuth PKCE、EVM 钱包签名、受信任 Sites 身份和哈希会话体系。
- 客户 API Key、原子余额账本、逐请求幂等计费、限流、并发控制与失败退款。
- NOWPayments 幂等订单、IPN 验签、主动轮询对账、异常支付复核和精确退款冲销。
- D1 迁移 `0002`–`0008`，覆盖认证、目录同步、支付事件、复核审计和运行心跳。
- 语义化版本、版本一致性检查、GitHub CI、Pull Request 清单和发布/回滚规范。

### Changed

- TikHub 成功响应在最终扣费前必须是完整、有界的 JSON 对象或数组。
- 新同步端点默认关闭；成本、方法或目录代次变化后必须重新审核。
- 真实代理和充值依赖近期对账心跳，并受转售授权、商户和法律门控保护。

### Security

- TikHub、支付商和管理密钥仅从服务端环境读取，不写入数据库或浏览器持久存储。
- Google subject 不会仅凭同名邮箱自动接管已有账户。
- 自动支付入账与人工复核入账在事务内互斥，阻止并发双重入账。
- 已入账支付即使退款元数据异常，也会按支付级唯一引用精确冲销且保持幂等。

### Fixed

- 补齐站点 favicon，并修正桌面与手机首屏标题在临界宽度下的不自然断行。
- 失败代理请求在客户账单中显示净费用为零并保留退款状态。
- 刷新控制台后可恢复尚未完成订单的安全支付信息。
- 支付回调丢失、乱序、重复入金和服务商退款不会造成永久漏账或重复入账。

## 0.1.0 - 2026-07-23

### Added

- RelayBase 初始市场页、安全沙盒、基础 TikHub 代理、客户 API Key 与预付余额原型。

[Unreleased]: https://github.com/kydlikebtc/RelayBase/compare/v0.3.0-preview.6...HEAD
[0.3.0-preview.6]: https://github.com/kydlikebtc/RelayBase/compare/v0.3.0-preview.5...v0.3.0-preview.6
[0.3.0-preview.5]: https://github.com/kydlikebtc/RelayBase/compare/v0.3.0-preview.4...v0.3.0-preview.5
[0.3.0-preview.4]: https://github.com/kydlikebtc/RelayBase/compare/v0.3.0-preview.3...v0.3.0-preview.4
[0.3.0-preview.3]: https://github.com/kydlikebtc/RelayBase/compare/v0.3.0-preview.2...v0.3.0-preview.3
[0.3.0-preview.2]: https://github.com/kydlikebtc/RelayBase/compare/v0.3.0-preview.1...v0.3.0-preview.2
[0.3.0-preview.1]: https://github.com/kydlikebtc/RelayBase/releases/tag/v0.3.0-preview.1
[0.2.0-preview.1]: https://github.com/kydlikebtc/RelayBase/releases/tag/v0.2.0-preview.1
