# RelayBase 版本、发布与回滚规范

本规范保证客户看到的行为、GitHub 源码、README、数据库迁移和 Sites 线上版本可以
追溯到同一源码树。任何发布不得只更新网站而遗漏源码或文档。

## 1. 版本模型

- 应用版本使用 SemVer：`MAJOR.MINOR.PATCH`。
- 公开生产就绪前使用 `0.x.y-preview.n`：
  - `preview.n`：私有验收候选，不表示可公开收款。
  - `PATCH`：兼容的错误修复、文档或运营改进。
  - `MINOR`：兼容的新能力、管理功能或数据库迁移。
  - 破坏 `/v1`、登录、余额、支付或计费语义时，必须先设计新契约并提升相应主版本。
- API 路径版本与应用版本分开管理。当前 API 契约为 `/v1`。

`package.json` 是应用版本的主来源，并镜像到：

- `package-lock.json`
- `VERSION`
- README 的“当前应用版本”
- `CHANGELOG.md` 对应版本章节

`npm run check:version` 会阻止这些文件不一致的提交。

## 2. 每轮迭代

1. 从最新 `main` 创建 `codex/<主题>` 或团队约定的功能分支。
2. 实现代码、测试和必要的单向 D1 迁移。已发布迁移不得修改或重排。
3. 同步更新 README 中受影响的接口、配置、计费、支付或运营说明。
4. 在 `CHANGELOG.md` 的 `Unreleased` 记录用户可见变化、安全边界和迁移影响。
5. 运行 `npm run check`，确认版本一致性、类型、Lint、构建和集成测试全部通过。
6. 通过 Pull Request 清单和 CI 后合并；禁止在失败门禁下发布。

## 3. 形成候选版本

1. 选择新 SemVer，并同步修改 `package.json`、`package-lock.json`、`VERSION` 和
   README。
2. 将 `Unreleased` 内容移动到带日期的新版本章节，并重新保留空的
   `Unreleased`。
3. 再次运行 `npm run check` 和 `npm audit --omit=dev`。
4. 创建一个包含源码、README、变更日志和迁移的提交。
5. 使用同名 annotated tag：`v<version>`。
6. GitHub Release 必须指向该 tag；预览版本标记为 prerelease。

优先让 GitHub 与 Sites 引用同一个 commit SHA。若托管连接器因自身作者元数据重建
提交对象，两个 commit SHA 可能不同；此时必须验证两端 Git tree SHA 完全相同，并
在 Release 中显式记录 GitHub SHA ↔ Sites SHA 映射，不能声称它们是同一提交。

## 4. Sites 发布

1. 将候选提交完整推送到 Sites 项目的私有源仓库。
2. 从同一提交执行生产构建，并用该构建创建 Sites archive。
3. 保存 Sites 版本时使用 Sites 源分支的精确 SHA；不得用未提交或不同源码树的构建。
4. 部署保存版本，并等待部署状态明确为成功。
5. 验收首页、目录、登录、控制台、后台、`/api/health` 和
   `/api/readiness`；健康响应中的 `version` 必须等于发布版本。
6. 公开访问、真实 TikHub 转售和真实加密支付必须继续经过 README 上线清单中的
   授权、KYB、法律与运营门禁。

## 5. 数据库迁移

- 迁移只向前追加，文件名和 journal 顺序不可回写。
- 每个迁移必须在空库和上一已发布版本的已填充数据库上验证。
- 破坏性字段变更使用“新表 → 复制校验 → 原子切换”，并记录数据保留策略。
- 应用必须在缺少所需迁移时 fail closed；不得以兼容猜测继续计费或入账。

## 6. 回滚

- 代码或静态资源故障：部署上一个成功的 Sites 保存版本。
- 新迁移已执行：默认只回滚应用代码，不自动降级数据库；应用必须兼容该次向前迁移。
- 计费、支付或对账异常：先关闭真实能力开关，保留不可变账本和支付事件，再调查。
- TikHub 凭据 KEK 必须随数据库备份并独立托管；代码回滚不得回滚或随机重建 KEK。
- 密钥泄露：立即轮换对应密钥、撤销会话或客户 Key，并在审计与变更日志中记录影响。
  TikHub KEK 轮换必须先完成受控重加密，不能直接替换后让已有密文失效。

回滚后建立修复版本，重复完整门禁；不得直接修改已经打 tag 的发布内容。

## 7. 可追溯证据

每个发布应能提供：

- Git commit SHA、tag 和 GitHub Release
- GitHub 与 Sites SHA 不同时的双向映射，以及一致的 Git tree SHA
- `npm run check` 与生产依赖审计结果
- Sites 保存版本号、部署状态和 URL
- D1 迁移范围与验收结果
- 外部授权或运营门禁仍未满足时的明确 NO-GO 说明
