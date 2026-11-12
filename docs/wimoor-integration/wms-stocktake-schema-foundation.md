# WMS 盘点 Schema 基础切片

在现有 11 个 WMS 模型上增加 3 个盘点模型，并接通动态盘点核心闭环：新建→开始采集基准→实盘→提交审核→独立审批→统一命令过账。继续复用余额、命令、审批和不可变流水，不按数量补表。

## 源表映射与正式边界

| 源表 | 本批目标 | 覆盖范围 |
| --- | --- | --- |
| stocktaking | WmsStocktake | 单仓盘点头、组织/工作空间、编号、状态、revision、创建人、开始/过账元数据 |
| stocktaking_shelf | WmsStocktakeLocation | 显式库位集合；零库存库位也可以纳入，不依赖盘点行反推范围 |
| stocktaking_item_shelf | WmsStocktakeLine | 库位+批次的账面基准、实盘数量及记录人/时间 |
| stocktaking_item | 后续统一查询服务派生商品汇总 | 本批不建第二套可写商品数量事实；源独立录入用途仍需复核 |
| stocktaking_warehouse | 本批由盘点头的 warehouseId 承担单仓范围 | 不支持多仓盘点，不复制冗余仓库关系表 |

SKU/商品继续经 WmsLot → ProductRecord 关联；租户继续使用 organizationId/workspaceId，操作人继续引用 User，不另建 merchant/sku/user 主数据体系。源批次身份不明时不自动分摊或迁入。

## 字段与数据库规则

- 盘点头编号在组织/工作空间内唯一；postedCommandId 在相同范围内唯一并引用既有 WmsCommand。
- 范围同时通过复合外键约束盘点头和库位属于同一组织、工作空间和仓库；盘点行引用范围及同租户批次。
- 一张单的同一库位只出现一次；同一库位/批次只出现一条盘点行。批次可在多个库位分别盘点。
- 账面基准保留 onHand、pendingQc、pendingPutaway、rejected、reserved 及余额 revision。数量为非负 Int，受限桶之和不超过 onHand，求和用 bigint 防止 SQL 整数溢出。
- baselineRevision=null 表示采集时未建立余额，所有基准桶必须为零；已有余额 revision 必须大于零。数据库不证明基准来源；开始盘点服务在事务内以一次查询读取余额及 revision。
- countedQty=null 表示尚未观察，0 表示已实盘为零；有实盘数时必须同时有 countedBy/countedAt，无实盘数时两者为空。数量不可负，revision 必须为正。
- DRAFT 不允许 startedAt；COUNTING/REVIEW/POSTED 要求 startedAt；开始时间不早于创建时间。POSTED 同时要求 postedAt 和 postedCommandId，过账不早于开始；其他状态禁止携带过账元数据。
- 外键均使用 RESTRICT，不级联删除单据、范围和盘点证据。枚举限定状态值，CHECK 仅限定行内一致性，不执行合法跳转判定。

## 核心业务入口与边界

- 公司仓库工作台新增「盘点」页签；复用 `/api/operations/wms/stocktakes`、统一 commands、approvals 和服务端 queryWms。
- DRAFT→COUNTING→REVIEW→POSTED；DRAFT/COUNTING/REVIEW 可取消。所有命令检查 revision、实时权限、组织/工作空间并记录审计；过账须由不同成员审批。
- 动态盘点不冻结库存。开始时记录全部基准桶和 revision，实盘允许明确零及账外批次；提交审核要求已存在明细全部实盘。单仓最多 100 个库位、100 个库位批次，超出须拆单。
- 审批申请、批准、执行均核验基准；过账锁定范围库位及余额，库存变化或范围内新余额出现时拒绝，须取消重盘。锁冲突返回可重试冲突，不静默覆盖。
- 实盘不得低于待检、待上架、拒收及预占合计；盘盈/盘亏经现有 move 追加 WmsMovement，零差异不生成流水，余额、盘点状态、审批消费和审计同事务提交。
- 无盲盘/复盘、冻结、金额估值或源历史导入；领域事件基础设施见下节，财务/头程业务消费尚未接入。

## 领域事件核心增量

统一库存命令在本地事务内追加 `WmsDomainEvent`，失败整笔回滚，幂等重试不重复产生事件；数据库禁止修改和删除事件。`WmsEventDelivery` 保存每个版本化消费者的投递进度，消费业务写入与确认同事务执行，失败退避、最多 10 次。两表是基础设施，不计入 Wimoor 业务表映射；既有历史命令不自动补事件。

复用注册的 import Worker 消费 `wms-domain-events`，启动及每 15 秒扫描数据库恢复待投递任务；Redis 不保存业务事实。当前消费者仅核验命令/流水证据，确认记录不表示财务或头程已处理。新增消费者通过 `src/lib/wms/event-consumers.ts` 注册，处理器只执行传入事务中的数据库操作；外部调用须使用消费模块自身 Outbox。耗尽重试的记录保留数据库，目前无人工重放界面。迁移文件为 `20261118010000_wms_domain_events/migration.sql`，须先迁移再启用新版 Worker；未对业务库执行迁移或启动真实 Worker。

隔离验证命令：`env -i PATH="$PATH" node scripts/test-wms-schema-offline.mjs --events`，要求已有 `postgres:16-alpine`、`redis:7` 镜像；临时容器验证事务回滚、并发幂等、失败重试及队列丢失恢复，清理前核实标签。完整模式同样使用独立临时 Redis。当前模型共 14 张业务表与 2 张事件基础设施表。

## 文件、验证与回退

- Schema：prisma/schema.prisma。
- 增量迁移：prisma/migrations/20261117010000_wms_stocktake_foundation/migration.sql，仅新增枚举、3 表及其索引/外键/3 条 CHECK。
- 隔离 runner：scripts/test-wms-schema-offline.mjs。
- 核心服务：src/lib/wms/stocktake-service.ts；页面：src/components/operations/wms-stocktake-panel.tsx。
- 核心集成验证：tests/integration/wms-stocktake.integration.ts；快速模式在 runner 后加 `--stocktake`，完整模式含双会话页面盘点闭环。
- 约束验证：tests/integration/wms-stocktake-schema.mjs；复用现有第一闭环的合成夹具，在事务内测试后回滚新增夹具。
- 复现：仓库根目录执行 `env -i PATH="$PATH" node scripts/test-wms-schema-offline.mjs`。要求本机 Docker 已有 postgres:16-alpine；runner 不拉镜像、不读取根 .env，使用随机端口临时数据库，清理前核实容器标签。
- 验证项：非 WMS 基线升级→原 11 模型→本批 14 模型、数据库约束、升级后的原库存/权限/幂等/HTTP 集成、空库完整迁移链。合成隔离结果不代表真实仓库或生产验收。
- 盘点切片不修改运行配置或权限；事件增量扩展现有 import Worker 与队列注册，不迁移既有业务库。迁移前回退仅撤销本切片 patch，保留其他工作树改动；如未来已实际迁移并产生盘点或事件证据，采用前向修复，不直接删表丢弃业务记录。

Schema 基础切片历史证据见[验证记录](evidence/wms-stocktake-schema-verification.json)，不用于证明新增业务功能。本次运行结果以当前测试输出为准；隔离夹具不代表生产验收。未执行真实库迁移、完整 check、提交或部署，准备合码/上线时补齐对应检查。

库位冻结增量：复用 Wimoor `shelf.isfrozen` 语义，在现有 `WmsLocation` 增加 `frozen`，不新增数量桶或业务表。库位列表提交原因，经独立审批及版本检查执行冻结／解冻；统一库位门禁阻止收发、预占、调拨及盘点过账，保持原实物量与预占量。命令、审计与不可变领域事件同事务留痕，不生成虚假零数量流水。迁移文件 `20261119010000_wms_location_freeze/migration.sql` 尚未应用到真实环境；隔离验证：`env -i PATH="$PATH" node scripts/test-wms-schema-offline.mjs --freeze`。
