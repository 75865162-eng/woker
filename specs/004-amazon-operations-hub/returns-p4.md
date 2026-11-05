# Returns P4 实施追踪

问题定性：退货域仍为规划入口，属业务缺口；错误归属、跨报告重复计数和自由文本泄露是数据一致性/权限风险。

## Spec / plan

用户已确认进入 P4。沿用 Reports v2021-06-30 的现有客户端、processor、审批、Prisma 和隔离 runner。具体文件级实施计划/官方链接/冲突/回滚/业务选择见 `docs/amazon-returns-p4-plan.md`。不改变已上线三链路或 P1/P2/P3 行为。

## Tasks

- [x] 只读检查当前 Reports JSON 下载、轮询、retry 及密文状态边界。
- [x] 当前官方 FBA Returns reportType 与 13 项原始字段核验。
- [x] createReport/getReport/getReportDocument 的 v2021-06-30 OpenAPI 与默认预算核验。
- [x] 核验 restricted report 的 RDT 特定路径规则和报告静态加密要求。
- [x] 发现并记录 External Fulfillment Returns v2024-09-11 对原始“无独立 API”表述的纠正。
- [x] 提供具体计划、影响、验收和报告内/跨报告幂等口径。
- [x] 用户确认以 FBA 仓库已收退货为唯一 P4 范围。
- [x] TSV adapter / policy / client 向后兼容扩展。
- [x] additive migration / 审批冻结 / cursor / 原件密文归档与批次恢复。
- [x] processor / 有界轮询 / 404退避 / 报告身份核验 / 解绑 fence。
- [x] 查询 / UI / 订单与ASIN关联 / 原因维度。
- [x] fixture/unit/临时PG/退货与Orders/Finance浏览器专项回归。
- [x] 用户恢复Docker后 `test:amazon-sync:offline` 全资源重跑：84单元+116PG集成+7浏览器通过，临时容器清理完成。
- [x] PR 草案/README/AGENTS/验收逐条自检；等待 P5。

## Validation / remaining risks

用户明确确认 FBA 仓收报告、仅加密留原件、无评论展示、单报告查询范围。P4 已实现；详细结果见 `docs/amazon-returns-p4-validation.md`，本地 PR 描述见 `docs/amazon-returns-p4-pr.md`。P4专项84单元+21PG+7浏览器通过，763核心测试与类型检查通过；Docker恢复后的完整同步回归84单元+116数据库集成+7浏览器通过，环境阻塞已解决；尚未执行CI/正式PR或发布。离线验证使用仓库 fixture、mock transport、临时 PostgreSQL/Redis 和浏览器请求拦截。没有读取真实凭证、启动真实任务或生产迁移；生产日期格式/原因业务映射/保留预算和 Node 22 CI 仍须人工核对。P5 尚未启动，等待阶段确认。
