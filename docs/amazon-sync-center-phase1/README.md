# Amazon 同步中心 Phase 1 交付记录

日期：2026-11-04。用户已通过 Phase 0，并明确确认共享模型、API、Worker 和性能影响后的 Phase 1 范围。**代码已实现，全仓 check:fast 及针对性回归已通过；CI 构建状态以 [PR #3](https://github.com/75865162-eng/woker/pull/3) 检查为准，生产验收待完成，未部署。** 不进入 Phase 2。

- [实现、模型、API 与 UI](implementation.md)
- [验证证据及未完成验收](validation.md)与[机器可读摘要](verification-summary.json)
- [试点启用、部署和回滚](rollout.md)
- [逐文件变更清单](files.md)
- [模拟容量原始记录](capacity-fixture.json)
- [Phase 0 审计及官方接口证据](../amazon-sync-center-phase0/README.md)

复用既有 Schedule / Run / BullMQ / amazon-sync-worker 和库存、刊登快照；没有另建同义 Plan / Task 表或队列。ProductRecord 不被同步覆盖，赛狐补货分支不变。新模式默认关闭，按组织＋工作区精确开关；未启用范围继续旧流程。

用户在完整范围说明后确认继续，本轮将早于本任务的应用、代理路由、设置页、市场 Agent 与部署配置改动一起纳入当前分支同步；文件清单区分了这些改动的来源。已有 PR #3 随分支更新，CI 由 PR 事件触发，不合并 PR。没有访问生产、修改生产环境变量、执行生产迁移或发布。

## 本轮验证收尾

全仓 669 项测试通过，lint 0 errors / 4 条既有警告，全仓 TypeScript 通过；新中心 5 项和旧经营中台 17 项浏览器回归通过。修复仅涉及本机重复依赖的解析与过时测试预期，没有调整生产数据源行为。真实 Amazon、生产容量和部署验收仍待完成；CI 结果查阅 PR 检查记录。
