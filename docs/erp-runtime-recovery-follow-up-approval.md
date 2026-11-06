# 导入/图片运行中任务恢复：后续审批范围

状态：待审批，未修改 Prisma schema，未编写或执行正式 migration。

现有 `ImportJob` 和 `ImageUpscaleJob` 只有状态/时间，缺少持久化执行所有权。直接把超时 running 改 queued 会让旧执行器与新执行器同时发布输出。统一进程管理不能替代数据库 fencing。

建议最小扩展：两表增加 `executionToken`（可空字符串）、`leaseExpiresAt`（可空时间）、`executionAttempts`（默认 0）、`maxAttempts`（默认有界值，建议 3），并增加 status/leaseExpiresAt 索引。确切 SQL、索引建立方式及历史行处理需在 schema 审阅时再次提供，不使用本工作区已有业务 migration 顺带发布。

实现范围：

1. 两类 processor 用 CAS 领取 queued/允许重试任务，生成 token 并原子递增尝试次数；租约续期验证 token。
2. 文件先写入每次执行独立的临时 Storage key；发布 resultKey/outputKey、WorkspaceDataset、ExportRecord、FileObject 状态及审计时，在数据库事务内再次验证 token。盘点导入 processor 的所有副作用，不能只保护最后一条 update。
3. 过期租约按 CAS 恢复 queued，超出次数明确 failed；旧 token 不得提交。孤立文件先记录供审阅，不自动清理真实文件。
4. 对外部计费型 AI 任务不能承诺 exactly-once：需先确认 provider 幂等/查询能力；当前图片放大本地处理流程不扩成其他 AI 业务。
5. 在隔离库验证处理过程中杀 Worker、清空 Redis、断开数据库、旧执行器恢复、重复消息和最终发布次数。原有队列/API 字段保持兼容。

影响：两张共享任务表、processor、恢复轮询、索引、测试与发布文档；续租增加少量数据库写入。迁移失败停止发布，旧 queued/completed 行不改业务结果。旧 running 行不得未经审阅批量恢复。

回滚：应用关闭新增恢复扫描；数据库仅保留新增可空/默认字段，不自动删列或回滚业务数据。旧代码不具备 token 校验，回退旧 processor 前必须先受控停止新执行器并确认无重叠运行。

该项不授予真实 migration、运行中任务重放、进程停止或部署权限。批准代码/schema 草案后，真实目标环境、任务数量、历史 running 清单和具体迁移 SQL 仍须单独审批。
