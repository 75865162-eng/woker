# Finance P3 实施追踪

问题定性：核心财务同步缺口，新增 Finances v2024-06-19 单一 listTransactions 链路；不重写既有同步。

## Spec / Plan

官方唯一标识 `transactionId`；posted 日期窗口 + nextToken；金额 BigDecimal 为 number，必须无损解析原数字文本；逐页幂等提交，原币/折算证据分开；Finance and Accounting 角色与 tenant/seller/site/region 检查先于 HTTP。

文件级计划、官方链接、性能/权限影响、回滚与人工决策见 `docs/amazon-finance-p3-plan.md`。官方要求美国 MFN 查询省略 marketplaceId，与当前站点级绑定冲突，用户已明确批准卖家级采集扩展，按真实站点落库并隔离未知归属。

## Tasks

- [x] 仓库边界盘点及公开官方契约核验。
- [x] 确认 transactionId 唯一语义、可空风险、BigDecimal 数字模型、空页分页及 Finance and Accounting 角色。
- [x] 文件级计划/影响/回滚/待人工确认清单。
- [x] 用户确认卖家级采集或站点过滤的范围选择。
- [x] 策略与无损 HTTP 适配。
- [x] Prisma additive migration、权限冻结、逐页 processor。
- [x] ERP 分页读取和配置 UI。
- [x] 离线 fixtures/单测/临时 PG 集成/浏览器与旧链路回归。
- [x] 验收/README/AGENTS/本地 PR 草案；P3 结束等待确认。

## Validation / Remaining Risks

实现及验证见 `docs/amazon-finance-p3-validation.md`。保留计划中的可追溯实施链路；离线验证成功不等于生产授权或最终账务完整性。未读取真实凭证/配置，未调用 SP-API/LWA 或启动真实任务。未提交/推送混合 dirty 工作区，PR 仅本地草案；Node 22 独立运行、生产容量/保留策略及汇率口径仍为后续门槛。P3 结束等待确认后再进入 P4。
