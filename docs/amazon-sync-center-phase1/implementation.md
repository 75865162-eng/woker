# Phase 1 实现与契约

## 复用边界

`/operations → sync-center API → PostgreSQL 任务意图 → 既有 BullMQ → 既有 amazon-sync-worker → 分页暂存 → 校验 → 原子切换数据源当前快照 → ERP 只读查询`。

只实现 `inventory`（FBA Inventory v1 / getInventorySummaries）和 `catalog`（Listings Items 2021-08-01 / searchListingsItems）。均明确采用完整快照，不声称可靠增量；未开发域标记规划中。官方依据为 Phase 0 官方模型与实时报告文档证据；本阶段没有新增报告类型或报告成功状态。

## 数据模型与迁移

迁移：`prisma/migrations/20261104000000_amazon_sync_center_phase1/migration.sql`。

| 模型 | 本轮变化 |
| --- | --- |
| AmazonSyncSchedule | 扩展版本、planKey、名称、修订、可配置周期／优先级／重试／保留期、nextRunAt；旧计划默认版本 1、planKey=legacy |
| AmazonSyncRun | 扩展版本、数据源、计划修订、状态、分页检查点、租约／fence、调度代次、控制、重试、计数与时间 |
| AmazonSpApiAuthorization | 新增组织／工作区内卖家凭证；加密内容绑定授权 ID，状态、修订、参与站点 |
| AmazonSyncDataSource | 新增 ERP 店铺＋站点＋域独立状态、当前成功快照、新鲜度阈值和覆盖清单 |
| AmazonSyncPlanTarget | 计划与数据源的规范化关联 |
| AmazonSyncTaskLog / AmazonSyncPage | 白名单结构日志、页序号／指纹／数量，独立于浏览器生命周期 |
| AmazonSyncApiBudget | 授权＋操作维度的持久化请求预算 |
| 现有库存／刊登 Snapshot | 新增可空 sourceUpdatedAt 和 dataVersion；沿既有 run、店铺、站点字段追溯来源 |
| SellerAccount | 增加复合唯一键与同租户数据源外键 |

复合外键防止跨租户／工作区绑定；数据库部分唯一索引限制同一数据源只存在一个活动 v2 任务。源头指针只能指向同组织／工作区／数据源的任务。旧唯一计划键改为包含 planKey，兼容应用旧 upsert 显式使用 legacy 键。迁移没有删除业务记录；生产锁表、索引耗时和磁盘占用未实测，迁移需人工审核。

没有新建 AmazonSyncReport 或完整质量问题表；报告状态机、订单／财务迟到更新、历史回填与部分补偿均为后续阶段。分页检查点封装于 Run，并非跨域共享游标。

## 任务执行

- 页面只提交任务，运行返回 202，数据库先记录意图；队列丢失后由调度器重建。
- 单任务对应店铺＋站点＋数据域；批量执行返回独立任务，没有伪造父任务“部分成功”。
- WAITING / QUEUED / RUNNING / RETRY_WAIT / PAUSED / SUCCEEDED / FAILED / CANCELLED / BLOCKED 持久化；前端按真实状态展示。
- 每片最多 5 页；每页记录与加密检查点同事务提交。默认 5 分钟租约，fence 与 dispatchVersion 防止旧 Worker 发布。
- 只有分页完成、数量一致、主体授权及配置修订仍有效时，才能发布成功快照；失败保留旧成功指针。零记录也可形成有效成功清单。
- 自动暂时性重试保留检查点；显式人工重试重新暂存完整快照，避免无限复用过期分页 Token。PURGED 历史任务只能查看摘要，不能重试。
- 暂停／取消在分页安全边界响应；暂停计划只停止后续调度，任务控制单独进行。
- 同卖家＋操作串行，跨站点共享预算；429、5xx、网络错误有界退避，读取可用限流头；缺少信息时采用保守间隔。这是本地策略，不是 Amazon 官方固定配额。
- 并发保留默认 1、上限 2；优先级可配置，超出分片让出槽位。历史回填尚未开放，不能声称其并行验收已完成。
- 每小时最多扫描 100 个历史候选、清理 10 个；按保留期清理历史快照、页与日志，保留任务摘要，保护当前快照和补货计划引用。扫描位置在进程内轮转，重启后重扫；不是严格到期即时删除保证。
- 试点限制每范围 200 个数据源、200 个计划，每计划最多 100 个目标；单任务 1000 页／50000 行安全阈值，超限失败并保留旧快照，扩容前必须评审。

## API

新增 `/api/operations/sync-center`，Node runtime、no-store。原库存、商品、readiness 与 schedule API 保留；试点范围旧配置／触发写接口会提示使用新中心，避免双调度。

| 请求 | 用途 |
| --- | --- |
| GET section=overview / sources / plans | 指标、趋势、健康、源及计划 |
| GET section=tasks | 服务端店铺／站点／域／触发类型／状态／时间筛选及分页 |
| GET section=task&id=…&after=… | 安全任务 DTO、每页 100 条日志 |
| GET section=connections / settings | 授权元数据、绑定及 Worker 心跳 |
| POST action=save-authorization / validate-authorization / disable-authorization | 加密凭证、参与站点验证、修订保护 |
| POST action=save-source / save-plan | 配置绑定、计划；不直接执行耗时同步 |
| POST action=run | sourceIds、idempotencyKey，可选 planId；返回 202 和任务数组 |
| POST action=control-task | id 与 control=pause/resume/cancel/retry；返回 202 |

读取要求 operations:view，计划／任务管理要求 operations:edit，触发及启用／恢复执行要求 operations:create，授权和绑定要求 settings:edit。复用现有工作区访问控制。执行与发布时重新校验任务操作者有效成员身份和执行权限。未启用返回 409/SYNC_CENTER_DISABLED；数据库未配置 503；输入、冲突、权限、目标不存在按对应状态返回。

凭证不经查询响应返回；日志不保存 Token、密钥、买家信息或原始错误体。v1 加密兼容，v2 绑定授权 ID；分页 Token 单独 AES-GCM 加密，绑定组织／工作区／任务。Seller ID 是管理员声明，参与站点验证不证明 Seller ID 身份或全部数据域权限，真实调用成功才能证明对应能力。

## UI 与业务读路径

七页导航：数据总览、同步计划、同步任务、数据域管理、数据质量、店铺与授权、同步设置。复用当前 SaaS 语义色和 Button/Badge；30 秒刷新只在可见空闲页面读取状态。权限失败清除旧内容，工作区切换取消旧响应对当前 UI 的影响。

- 总览：真实 KPI、按域健康及覆盖、24 小时聚合趋势和可定位的异常。
- 计划：创建／编辑／复制、可读频率和自定义分钟、目标／优先级／重试／保留期、暂停／恢复、执行、历史。
- 任务：筛选分页、处理计数、分页进度、错误及日志、重试／暂停／恢复／取消。快照 insertedCount 为写入本次暂存快照的记录数，updatedCount 当前为 0，不是对历史商品主资料的新增／更新判断。
- 域：15 域目录，只有两域已实现，展示对应 API、绑定、最近成功、数量与覆盖。
- 质量：本阶段仅展示派生的过期／失败／授权阻断等基础健康提示；没有问题指派、关闭、对账、字段规则库或完整历史问题生命周期。
- 授权：多凭证、显式导入旧凭证、验证站点、绑定／停用数据源。授权失效仍允许停用原数据源及暂停计划。
- 设置：真实心跳及并发、队列配置和策略；无心跳不会显示在线。

旧业务页面由兼容入口 `?legacy=1&tab=…` 保留。库存／商品／readiness 查询使用已发布的各数据源 head，避免一个站点的新任务遮蔽其他站点；按配置阈值计算新鲜度，未发布暂存记录不进入业务读路径。Amazon 只读关联 SKU，不更新 ProductRecord，不混加赛狐指标。MCP 新工具、补货新的 Amazon 销量服务均不在本阶段。
