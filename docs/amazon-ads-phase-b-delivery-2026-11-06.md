# Amazon Ads Phase B 交付记录

日期：2026-11-06

本阶段在现有同步任务、BullMQ Worker、Profile 级锁、lease/fencing 与加密 checkpoint 基础上，完成 Sponsored Products 结构数据同步落库，并接入统一结构查询服务。验证只使用离线 fixture、一次性 PostgreSQL/Redis 和 mock transport；未调用真实 Amazon Ads API、未应用迁移到持久数据库、未改凭证/运行配置，也未提交或推送。

## 已完成

- Worker 已执行 Campaign、Ad Group、Keyword、Target、Ad Group Negative Keyword/Target、Campaign Negative Keyword/Target 八类结构 reader。每次 dispatch 只处理一个 API 页，复用现有队列和任务表；加密 checkpoint 在下一页/数据域完成后推进。
- 使用 organization/workspace/Profile/entity type/Amazon ID 幂等写入实体快照，记录规范字段、原始 payload、来源 task、上游更新时间和落库时间；较旧任务/较旧上游观察不会覆盖较新快照，缺席实体不会被推断删除。
- 每次 dispatch 创建一条 `AmazonAdsSyncAttempt`，成功、可重试失败、阻断失败和租约过期均会结束对应 Attempt。Attempt 记录实际发起的 API 请求数、安全错误摘要与处理数量；相同 dispatch 幂等。
- `AmazonAdsSyncDomainState` 记录结构域同步中、成功、可重试等待和失败。短暂失败保留此前 `lastSuccessAt`；最终成功后更新 freshness。查询 envelope 将可重试等待呈现为同步中，不把它误报为当前。
- 过期租约恢复在一个数据库事务中 fence 旧任务、结束旧 Attempt 并更新结构域状态，再从已提交 checkpoint 重新投递。旧 dispatch 无法提交页面或改写新状态。暂停计划仍会取消待运行任务。
- 既有实体 API 与 UI 的结构查询继续从本地 PostgreSQL 服务端筛选、分页和排序；真实 API adapter 和生产同步配置仍 fail-closed。

## 修改范围

- Worker 与恢复：`src/lib/amazon-ads/sync-processor.ts`、`src/lib/amazon-ads/sync-scheduler.ts`。
- 生命周期查询状态：`src/lib/amazon-ads/query-service.ts`。
- 隔离集成验收：`tests/integration/amazon-ads.integration.ts`。
- Phase A 记录同步更新：`docs/amazon-ads-phase-a-delivery-2026-11-06.md`。

## 验证

- `node scripts/test-amazon-ads-offline.mjs`：7/7 通过，覆盖八类 reader 落库、Profile 隔离、筛选/分页、429 重试、重复 dispatch、旧任务 fencing、BullMQ 消费、过期租约恢复和暂停。
- Profile-scoped GET 同步状态测试也验证 Attempt/freshness 返回，并确认 checkpoint 与 lease 字段不会泄漏。
- `node scripts/test-amazon-ads-offline.mjs --reports`：11/11 报表隔离集成通过。该报表代码与结构 Worker 是工作区既有并行实现，本记录只记录其被隔离验证，不将它描述为 Amazon 官方字段合同已核验。
- `npm run test`：857/857 通过；`npm run typecheck`：通过；忽略 `.next-amazon-live/` 的全局 lint：0 errors、5 条既有 warning。
- 同步中心相关 Playwright：2/2 通过；`git diff --check`：通过。
- 未运行 `npm run check:fast`：工作区存在未跟踪的 `.next-amazon-live/` 构建产物，默认 ESLint 会递归扫描并将生成文件纳入范围；当前使用核心测试、排除该产物的全局 lint、TypeScript 和定向浏览器测试完成验证。

## 尚未完成与风险

- 本地 `prisma db push` 仅发生在离线 runner 创建的一次性数据库；新的持久化 migration 尚未在任何持久数据库执行或回滚验证。
- Reader contract fixture 验证不能替代真实授权 Profile 的只读验收。所有真实 OAuth/API 请求、同步计划启用和生产任务仍关闭。
- 结构域的 freshness 表示最近一次完整结构同步成功，不证明 Amazon 实体删除流或报告日期覆盖完整。
- 现有报表读写和 MCP 改动需要单独核对 Amazon Reporting 官方报告类型、字段、日期、币种及归因合同；隔离 fixture 通过只证明本地应用行为。
- 本次不改变工作台其它页面的 Demo 数据源，也不进入完整真实数据 UI 接线阶段。

## 回滚与后续

回滚本切片可撤销 Worker 写 Attempt/DomainState 与 scheduler 恢复状态的代码，保留数据库记录和已存实体快照；不删除数据、不回滚其他工作区改动。Phase C 的最近任务/freshness 概览已接入现有账户页，边界见 [Phase C 交付记录](./amazon-ads-phase-c-delivery-2026-11-06.md)。真实环境启用需单独审阅目标账号、Profile、运行配置和数据范围。
