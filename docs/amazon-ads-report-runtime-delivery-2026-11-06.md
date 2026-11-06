# Amazon Ads 报告运行层隔离交付

日期：2026-11-06。对应 U2 / T08–T11 的隔离运行子项。**未完成正式报告常规 Worker 接入，不代表生产就绪或真实账号同步成功。**

## 本次代码

- `src/lib/amazon-ads/report-runtime.ts`：以数据库 Task/Attempt/ReportRequest 为事实源，提供注入式 enqueue、单步 dispatch 和 pause/resume/cancel。只接收已初始化的 `isolated-report` 任务；无默认 HTTP transport、生产启动钩子或对外 API。
- 调度最多扫描 100 条到期等待、租约过期或成功后遗留 RUNNING Attempt 的记录。入队失败保留到期状态，返回失败计数并继续其他任务；重复扫描/消息由数据库锁、dispatchVersion、fence 和原采集 reservation 阻止重复有效操作。投递端仍须限制队列积压，不能把该扫描器当完整生产调度器。
- 每条消息只执行一个有界阶段；远端等待持久化 nextAttemptAt 后释放 lease，不以 sleep 占据 Worker。租约过期换代后恢复只读阶段；create 结果未知进入 BLOCKED，不盲目重发。
- 同 Profile 同时只允许一个活跃报告操作；暂停/恢复保留远端报告 ID、原日期/时区合同、预算和总截止。取消使旧 fence 失效，晚响应不能推进或发布。此处是操作并发限制，**尚未实现整个重叠日期窗口的任务串行与版本新旧裁决**。
- 领取时实时查组织成员、同步权限、有效店铺/Profile 与授权；不可访问进入安全 BLOCKED。控制仅限任务原申请人及当前有效同步权限，不扩张为管理员全局控制政策。
- `report-deadline.ts` 统一拒绝缺失、非法或已到期的截止时间。采集开始、响应提交、暂存/发布入口及发布事务内复查；已提交成功的幂等查询不重新发布。
- 成功发布后进程退出导致 Attempt 尚未结束时，下一次 tick 只补齐本地 Attempt，不创建新报告或版本。

## 已执行验证

运行 `node scripts/test-amazon-ads-offline.mjs --reports`：一次性 PostgreSQL/Redis、独立临时 uploads、注入 fixture transport；网络 guard 只允许测试数据库/Redis，未继承真实凭证或配置、未调用 Amazon。最终结果见下方验证记录。

新增用例覆盖：

| 场景 | 实际证据 / 限制 |
| --- | --- |
| BullMQ 重复消息 | 两个独立 Worker 实例，同一 dispatch 并发消息；create/poll/download 各一次，单版本单事实发布 |
| 远端等待 | lease 已释放，未到期消息不发 poll |
| 暂停/恢复/取消 | 旧消息无效；阶段与预算不重置；poll 中取消后晚响应无法提交 |
| 崩溃恢复 | 注入过期 lease 和持久 poll reservation，换 fence 后恢复已知报告；不是 OS kill/restart 验收 |
| 入队失败 | 注入 enqueue 异常；下一次扫描可重投；两个 scheduler 并发不造成重复网络动作 |
| 不可重试 | create 结果未知、截止到达和撤销 Profile 均停止新请求 |
| 截止竞态 | 响应处理中到期不能推进；直接发布亦拒绝非法截止 |
| 只读重试 | poll 失败进入 RETRY_WAIT；释放 lease、保留原调用预算，到期后恢复 |
| Profile 并发 | 另一个同 Profile 任务运行时不领取、不扣 create 预算 |
| 发布后恢复 | 模拟成功任务遗留 RUNNING Attempt，扫描仅结束 Attempt |

RT01/RT04/RT05/RT06/RT09已有相应隔离证据；RT02/RT03只覆盖未知 create/过期 lease/reservation 语义，未声称完成真实进程 kill；RT07/RT08/RT10的所有组合仍须按运行设计补验，不能仅以总测试数量勾选完成。

## 上线门槛与后续

T08–T11维持未整体完成：尚缺正式报告版本/身份字段合同、审批绑定的任务初始化/增量/回补入口、优先级公平性、跨 Worker API 限流与 Retry-After、生产队列积压控制、常规启动/停止接线、完整进程故障注入、正式下载目标与多文件合同及重叠窗口裁决。

U3完整业务页面、U4分析/草稿、U5真实只读及写入验收继续按当前待优化清单推进。本次 fixture 报告冻结的时区仅是隔离合同输入，不能当作 Amazon 历史报告时区已经取得正式证据。

本次无 Prisma schema/迁移、依赖、环境配置或生产服务变动。回滚时撤销新增运行层及对应调用/测试、恢复本次采集/发布截止检查即可；不删除报告事实或文件，不修改其他聊天的任务路由/MCP改动。正式运行启用需单独提交具体环境、任务范围、预算、停止与恢复方案审批。

验证路线：报告集成测试验证数据库事务、真实 BullMQ 和 fixture 采集；相关 ESLint 与全库 TypeScript 检查验证静态兼容。未运行生产构建、全量 check、账号 E2E、迁移或部署；准备合码/上线时再按仓库规则执行对应关口。测试环境提示 pg client.query 并发弃用 warning，未导致测试失败，需在后续驱动升级前专项复核。

## 最终验证记录

- 报告隔离集成：**31/31通过**，其中新增运行层/截止竞态用例8项；两个独立 BullMQ Worker 实例在同一隔离进程内运行。
- 本次相关源文件与集成测试 ESLint：通过。全库 `npx tsc --noEmit` 曾在中间快照通过，但最终复查因并行 MCP 改动失败（`src/lib/amazon-sync/mcp.ts` 注册表循环类型推断、隐式 any/unknown，以及 `tests/integration/amazon-mcp.integration.ts` 隐式 any，共17条）；错误未指向本次报告运行层文件。当前全库静态关口未通过，不能以中间结果作为合码依据；未覆盖修改另一批代码。
- 未提交或推送 GitHub，未启动常规同步或访问真实账号；该记录只证明隔离代码能力。
