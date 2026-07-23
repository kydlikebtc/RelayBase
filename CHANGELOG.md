# Changelog

RelayBase 的用户可见变化、计费语义、安全边界与数据库迁移都记录在这里。版本号遵循
[Semantic Versioning](https://semver.org/)；在公开生产就绪前使用预发布版本。

## [Unreleased]

### Added

- 待下一轮迭代记录。

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

[Unreleased]: https://github.com/kydlikebtc/RelayBase/compare/v0.2.0-preview.1...HEAD
[0.2.0-preview.1]: https://github.com/kydlikebtc/RelayBase/releases/tag/v0.2.0-preview.1
