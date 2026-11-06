# 报告 Worker 生命周期与自动投递交付

日期：2026-11-06。U2 / T09–T11 的隔离运行子项。新增可显式启动的调度服务，**尚未接入生产常规 Worker，不代表真实账号已有数据或整体生产就绪**。

## 实现边界

`src/lib/amazon-ads/report-worker.ts` 提供 `startIsolatedReportWorker({ scope, transport })`，返回 `queueName`、`tick()`、`close()`。导入模块不启动任何网络连接或定时器；显式启动前要求原有隔离数据库/storage/transport 条件，以及标记为 disposable 的 loopback Redis。不存在默认 Amazon HTTP transport，不读取 dotenv、不修改实际运行配置。

- 每个 organization/workspace 使用稳定哈希队列名；消息仅带 taskId/dispatchVersion，消费仍经过数据库 scope/权限/fence 校验。未知 job name、无效版本直接拒绝，不落入其他同步 processor。
- 启动先设置 BullMQ 队列级并发上限 2，再启动本地消费者；多个实例共享上限，不把每实例 concurrency 相加当全局上限。该上限不等于 Amazon 的 API 限流配额。
- 默认每 30 秒扫描一次，启动时立即扫描；单实例重入复用当前扫描 Promise，跨实例通过 30 秒 Redis token 锁协调扫描。锁释放比较 token；过期或失去 token 的扫描不再投递新消息。锁失效或入队失败不会删除 PostgreSQL 到期任务，下次扫描可恢复。
- taskId + dispatchVersion 生成稳定 jobId，等待/执行中的重复投递合并。完成/失败消息移除，由数据库持久状态决定后续投递，避免已完成 jobId 阻止同代任务恢复。跨代消息仍由数据库 fence 拒绝。
- 扫描前统计 wait/active/delayed/prioritized/paused 数量，达到 100 暂停本轮入队，单轮最多使用剩余容量。正常参与扫描锁的本服务遵守该背压；**外部直接 producer、Redis 故障及锁到期与 add 之间的竞态不构成严格分布式配额保证**，正式多生产者接入需原子准入方案。背压时保留原到期记录。
- `close()` 幂等：先停止本实例定时扫描、等待当前扫描，再等待当前有界操作完成并关闭连接。保留队列与 Task/Request/文件，不取消其他实例，不清空证据。只读 Retry-After 等待在数据库持久化并释放 lease，关闭不会把 RETRY_WAIT 当作失败任务重建。
- queue/worker/scan 错误通过固定事件交给可选观察回调，回调异常不破坏任务恢复，不输出上游错误正文或凭证。生产 heartbeat、日志归集和告警接线仍需后续完成。

无需 Prisma schema、迁移、依赖、环境配置或生产启动脚本变更。现有 `scripts/amazon-sync-worker.ts` 不会隐式启动此服务；结构、Orders、导出与现有 approved-only Worker 行为不变。

## 执行验证

新增 `tests/integration/amazon-ads-report-worker.integration.ts` 和 IPC 子进程 fixture；`scripts/test-amazon-ads-offline.mjs --report-worker` 复用一次性 PostgreSQL/Redis、临时 uploads、环境变量白名单与 socket/DNS 网络 guard，不访问真实账号。

| 场景 | 证据 |
| --- | --- |
| 启动门槛 | 非 fixture、非 disposable Redis、非法扫描间隔在连接启动前拒绝 |
| 自动调度 | 两个服务实例自动推进 create/download/stage/publish，无手工逐阶段驱动，单版本单事实 |
| 全局并发 | 三个实例、三个 Profile，注入阻塞 create，实际峰值始终为 2 |
| 停止/重启 | close 等待在途 create；停止后不扫描；重新启动复用原 reportId，create 不重发 |
| 重复/坏消息 | 同代十次 enqueue 只保留一个等待 job；未知名称、非法 dispatch 不调用 transport |
| 背压 | 暂停且已有 100 个消息时拒绝新投递；容量恢复后从数据库继续，不丢任务 |
| 组织隔离 | 外组织 taskId 即使被放入队列，也无法读取或推进任务 |
| 限流等待 | 实际自动 poll 返回 429/Retry-After，RETRY_WAIT 与 nextAttemptAt 持久化；提前 tick 不重发；close 保留等待 |
| 进程崩溃 | 真实子进程在持久 create/download reservation 后进入 fixture transport，再被 SIGKILL；替代 Worker 对未知 create 阻断，对 download 有界重试，预算 download=2，create 不重复 |

SIGKILL 用例只在一次性数据库中将失效 lease 推到过去以免等待 60 秒；是真实进程终止加速租约测试，不是生产主机故障/Redis 故障/真实 Amazon 已接受请求的验收。BullMQ 遗留 active job 可等待自身 stalled 检测，数据库新 dispatch 独立恢复。

- `node scripts/test-amazon-ads-offline.mjs --report-worker`：首次交付 **9/9 通过**；上线前补充扫描公平性与 Profile 冷却回归后，**14/14 连续两次通过**。
- `node scripts/test-amazon-ads-offline.mjs --reports`：**36/36 通过**，包含并行已完成的 checkpoint/只读退避回归；此数字是当前工作区整体证据，不把其他批次代码归为本次新增。
- 本次源文件、测试、runner 的定向 ESLint、全库 `npx tsc --noEmit`：通过。

验证选择覆盖新增调度、连接生命周期、真实队列与数据库恢复边界；无页面、依赖或 schema 变化，未重复浏览器测试和生产构建。准备合码/上线时再执行仓库完整关口；当前不提交、推送、迁移或部署。报告回归仍出现 pg client.query 并发弃用 warning，测试未失败，尚未在本次修改数据库驱动。

## 后续与回滚

### 上线前本地复查补充

- 到期扫描跳过 inactive plan 的等待任务；缺失 lease 视为待恢复，生成新 fence；损坏 checkpoint、超截止、未知 create reservation 在投递前阻断。每行锁等待和事务有界，单个锁住的任务不阻塞其他任务；扫描总时间受限。
- 同 Profile 的在途操作或已持久化限流冷却会推迟后续任务，其他 Profile 可继续；这不是跨授权的正式共享限流实现。
- 初次 14 项运行中，Profile 冷却回归在最终 cancel 时收到 `ADS_REPORT_TASK_TERMINAL`。增加取消前 WAITING 状态及固定错误码断言后，完整 14 项连续两次通过；首次异常根因未证实，不将诊断断言描述为运行逻辑修复。后续再次出现应依据新增断言定位，禁止放宽 terminal 保护。
- 本次复查报表集成 36/36、checkpoint/退避单测 7/7、全库类型检查通过；全库 lint 排除本地 `.next-amazon-live/**` 生成物后 0 errors、5 个既有 warnings。CI 对实际提交执行完整测试、lint、构建和 artifact 校验；本机不重复生产构建。

T09–T11保持整体未完成。尚缺正式报告合同/transport、审批绑定的初始化/增量/回补入口、任务优先级和公平性、跨 Profile/授权的正式共享限流、重叠窗口版本裁决、正式下载合同、完整容量/资源与故障矩阵、生产常规启动和运维接线、真实账号只读验收。不得通过删除 fixture 门槛来冒充正式接入。

回滚仅移除本次 service、测试 helper/集成测试与 runner 新选项，并恢复相应文档索引；无数据库回滚或队列/文件清理。生产接入必须另行审阅具体目标、范围、预算、配置 diff、停止/恢复与验收方案后启用。

## 续批：扫描故障隔离与 Profile 延后

本段为后续实现，更新上文首批运行状态，仍仅限隔离服务，不启用常规生产 Worker。

- 等待任务在查询和事务重查时均要求计划 ACTIVE，暂停计划不占用等待队列的前 100 个候选。暂停计划已有过期 RUNNING 仍回收 lease/fence 并结束旧 Attempt，但不投递下一步；原任务、预算与证据保留。
- RUNNING 的 leaseExpiresAt 缺失也视为租约不可用，换代恢复，不再无限卡住。存在 create reservation 时进入 CREATE_RESULT_UNKNOWN，保留 reservation，不入队重发。
- 扫描逐条事务隔离；事务内设置仅本事务生效的 100ms lock_timeout、最大 500ms 连接获取等待和 2s 事务预算。单条锁/事务失败计入 rowFailures 并继续后续候选，任务保持原到期状态，解锁后可重试。每轮最多 100 条，在 5 秒循环预算到达后不再开始下一条；该预算不等于初始 SQL、enqueue 或故障连接的端到端硬超时。
- 入队前只读校验持久 checkpoint/总截止/未完成任务的阶段；缺失/损坏记录、已过期任务、未知 create 及 COMPLETE 与未成功 Task 不一致分别进入明确 BLOCKED。返回 blocked 计数，下一轮不反复投递这些任务。暂停计划未被隐式恢复或重新签署范围。
- 同 Profile 有活跃操作时，将候选 nextAttemptAt 至少延后 1 秒，不领取、不新建 Attempt、不扣 API 预算。已知有限的 ADS_REPORT_THROTTLED/nextAttemptAt 也作为同 Profile 跨任务冷却证据，后来的任务持久化等候该时间；不同 Profile 不受影响。冷却不重置 budget/deadline，不扩大 grant。
- 这只是当前隔离报告任务可见范围的同 Profile 冷却，**不是授权/区域级完整 API 配额，也不覆盖超总截止、未知 create 错误等未保留 THROTTLED 原因的情况**。不得将其当作正式 Amazon 限流作用域已经确认。多租户公平、优先级、长期多锁阻塞时的扫描公平仍待专项方案。
- Worker 的 tick 结果增加 rowFailures/blocked；行处理失败触发固定 scan_failed 观察事件，不输出数据库或上游原始错误。修正“阶段操作成功但收尾判断 BLOCKED”时 Attempt 被误记成功的边界。

新增加的五组集成验证：102 个暂停计划任务不阻挡活跃计划；缺失 lease 的恢复与未知 create 阻断；真实持有 advisory lock 时其他任务继续、释放后原任务可重投；坏 checkpoint/过期任务不影响健康任务且不反复入队；同 Profile 冷却持久化、不同 Profile 不串扰、冷却结束可继续。

最新验证：

- `node scripts/test-amazon-ads-offline.mjs --report-worker`：**14/14 通过**。
- `node scripts/test-amazon-ads-offline.mjs --reports`：**36/36 通过**。
- 定向 ESLint、全库 `npx tsc --noEmit`：通过。

沿用一次性 PG/Redis、网络 guard 与 fixture transport，没有操作真实配置/数据或账号。无 schema/依赖/页面变动，继续采用运行层专项集成与静态验证，未运行生产构建、账号 E2E、迁移、提交/推送或部署；正式合码/启用再执行相应关口。

资源与回滚：每个可投递候选多一次按幂等键查询 Request，领取时增加同 Profile 冷却查询；复用现有模型/索引，不增加表或缓存，真实容量与 P95 尚未实测。回滚只恢复本续批 runtime/worker/测试差异和文档，保留当前等待/冷却时间、blocked 原因与旧 Attempt；不批量清除错误或重置预算。原有 nextAttemptAt 字段保持兼容。
