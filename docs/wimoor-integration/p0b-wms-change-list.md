# P0-B 首个 WMS 闭环：具体修改与确认单

当前 WMS 能力映射、可执行状态转换、异常恢复及事件契约见 [WMS 能力与契约](wms-capability-contract.md)。历史设计/验证状态保留为各自时点记录；当前已实现及待接入边界以该补充和对应代码为准。

2026-11-11；适用当前工作区，未修改运行中 Schema、权限或 API，未应用迁移。
本文件是 `docs/wimoor-sp-api-port-plan.md` 的首个实施切片，不另立宏观路线。

## 已核实的源规则和 ERP 差异

源根目录 `/Users/chenjieliang/Documents/wimoor/`，完整路径、行号及 SHA-256 见 `evidence/files.json`。
以下行号均为该工作树当前源码，不是仅引用 HEAD 版本。

| ID | 源证据（源根目录相对路径） | 核实结论与移植决定 |
| --- | --- | --- |
| WMS-01 | `wimoor-erp/erp-boot/src/main/java/com/wimoor/erp/inventory/service/impl/InventoryServiceImpl.java:112` `isOkForOperate` | VERIFIED：仓库不存在、停用、盘点中拒绝操作；目标沿用仓库停用保护，盘点门禁到 P0-D 接入。 |
| WMS-02 | 同文件 `:181` `AddStockByStatus`、`:245` `SubStockByStatus`；`wimoor-erp/erp-boot/src/main/resources/mapper/inventory/InventoryMapper.xml:69` | VERIFIED：事务注解、Redis lock、按仓库/物料/公司/status 查询 `FOR UPDATE`，余额变化后保存流水和历史。目标使用 PG 事务、条件更新/行锁、数据库幂等，不移植 Redis 锁为库存正确性基础。 |
| WMS-03 | 同 Service `:198`、`:261`；`init-config/mysql/数据库结构/db_erp/t_erp_inventory.sql:18` | VERIFIED：`ishungry && fulfillable` 可绕过负库存限制；唯一身份是 warehouse/material/shop/status。目标明确不允许负可用，不引入该开关；status 数量行改为位置/批次余额的独立数量列。 |
| WMS-04 | 同 Service `:432` `inStockByReady` | VERIFIED：Ready 增待入，alReady 减待入并增可用。没有据此证明独立质检；目标新增明确的待检、待上架和拒收计数。 |
| WMS-05 | 同 Service `:453` `outStockByReady`、`:518` `outStockReadyCancel` | VERIFIED：准备出库从 fulfillable 转 outbound；取消准备转回；最终出库扣 outbound。目标表达预留/释放、拣货、最终发货，预留不减少实物。 |
| WMS-06 | `wimoor-erp/erp-boot/src/main/java/com/wimoor/erp/stock/controller/InWarehouseFormController.java:79` → `stock/service/impl/InWarehouseFormServiceImpl.java:63` → `inventory/service/impl/InventoryFormAgentServiceImpl.java:105` → `InventoryServiceImpl.inStockByDirect` → Mapper | VERIFIED：普通其他入库的整单事务入口在 Controller；保存明细时触发入库。目标整单事务放 Application Service，所有入口共用，不能只包单行事务。 |
| WMS-07 | `wimoor-erp/erp-boot/src/main/java/com/wimoor/erp/stock/controller/OutWarehouseFormController.java:400` → `stock/service/impl/OutWarehouseFormServiceImpl.java:72` | VERIFIED：其他出库有单据/明细调用链；目标保留来源单号，避免重复保存再次扣减。源码可见性不证明真实运行安全。 |
| WMS-08 | `wimoor-erp/erp-boot/src/main/java/com/wimoor/erp/warehouse/service/impl/WarehouseShelfInventoryServiceImpl.java:430`、`:462` | VERIFIED：库位 add/sub 有数量和操作记录，sub 检查不足；这两个方法自身未见事务注解/条件 revision。目标与仓库实物使用同一位置余额和流水事务，避免两套数量漂移。 |
| WMS-09 | `src/lib/products/product-record-repository.ts:73`、`prisma/schema.prisma:412` | 当前 ERP 商品是组织/工作区内唯一 SKU，保存具备 revision；WMS 只关联稳定 ProductRecord.id，不写主档、外部库存快照或商品 Outbox。 |
| WMS-10 | `src/lib/auth/api-permissions.ts:18`、`src/lib/workspace/access.ts:4`、`src/lib/accounts/permissions.ts:24` | 已有登录、模块动作、组织工作区检查；工作区 helper 仅证明该工作区属于组织，不能单独当作员工 WMS 写授权。须新增独立库存业务权限与事务内实时检查。 |

质检/条码/批次的公司策略不是上述源码已证明规则。下方是为本次目标明确提出的当前契约，状态为 **PROPOSED**，须与共享边界一并确认；不把设计选择标成 VERIFIED。

## 拟建模型与字段

全部新增模型使用 `id String` 稳定主键、`organizationId`、`workspaceId`、`createdAt`，可变聚合带 `revision Int`、`updatedAt`。所有跨对象关系必须验证同组织/工作区；外键默认 RESTRICT，不级联删除流水、单据或审批。数量使用 PostgreSQL Int 和严格正整数输入，单次及累计上限 2,147,483,647，溢出拒绝；不接受小数、负数、NaN、隐式字符串转数或缺省零。财务不在本次模型内。

| 拟建模型 | 主要正式字段及数据库约束 |
| --- | --- |
| `WmsWarehouse` | code/name/enabled/revision；unique(org,workspace,code)，FK WorkspaceScope。公司仓，不绑定 SellerAccount 或 Amazon 仓。 |
| `WmsArea` | warehouseId/code/name/enabled/revision；unique(scope,warehouseId,code)，复合 FK 同范围仓库。 |
| `WmsLocation` | warehouseId/areaId/code/kind(RECEIVING,STORAGE)/enabled/revision；unique(scope,warehouseId,code)，area 必须属于该仓。 |
| `WmsLot` | productRecordId/lotCode/barcode?/revision；unique(scope,productRecordId,lotCode)，unique(scope,barcode)（NULL 可重复）；productRecord 复合 FK。首期要求显式 lotCode，非批次商品由用户显式选择固定批次，禁止系统猜批次。条码是本地库存标识，不冒充 Amazon/FNSKU。 |
| `WmsReceipt` | warehouseId/receivingLocationId/number/sourceReference?/createdBy/status(DRAFT,RECEIVED,INSPECTED,PUTAWAY,CANCELLED)/revision；unique(scope,number)。草稿编辑校验 ownership，取消只限 DRAFT；入账后更正走后续反向单据，不能删除流水。 |
| `WmsReceiptLine` | receiptId/lotId/expectedQty/receivedQty/acceptedQty/rejectedQty/putawayQty/revision；unique(scope,receiptId,lotId)；0≤received≤expected，accepted+rejected≤received，putaway≤accepted。首期每单一次收货，质检/上架允许分批。 |
| `WmsStockBalance` | warehouseId/locationId/lotId/onHand/pendingQc/pendingPutaway/rejected/reserved/revision；unique(scope,locationId,lotId)；全部非负，pendingQc+pendingPutaway+rejected+reserved≤onHand。available 由服务计算，不并行存一列。 |
| `WmsReservation` | number/balanceId/createdBy/requestedQty/releasedQty/dispatchedQty/pickedQty/revision；unique(scope,number)；remaining=requested−released−dispatched≥0，0≤picked≤remaining；状态由数量确定，不同时维护可冲突的 status。 |
| `WmsCommand` | idempotencyKey/action/requestHash/aggregateId/expectedRevision/result/movementIds/actorUserId；unique(scope,idempotencyKey)；仅事务内提交成功结果，相同键不同请求 409，相同请求返回原结果（仍先验证当前权限）。不保存客户端角色、批准布尔值。 |
| `WmsMovement` | commandId/sequence/warehouseId/locationId/lotId/sourceType/sourceId/sourceLineId?/action/deltaOnHand/deltaPendingQc/deltaPendingPutaway/deltaRejected/deltaReserved/beforeRevision/afterRevision/balanceAfter/actorUserId/occurredAt；unique(scope,commandId,sequence)；append-only；上架双腿共享 commandId。 |
| `WmsApproval` | action/aggregateId/expectedRevision/requestHash/requestedBy/approvedBy?/expiresAt/status(PENDING,APPROVED,REJECTED,CONSUMED)/revision/consumedCommandId?；单次使用，绑定同范围、动作、revision 和完整请求摘要；拒绝自批，拒绝过期、撤权或重复消费。审批申请/批准/消费均追加既有 AuditLog。 |

需要 **11 个新模型**。只在 ProductRecord 添加 `@@unique([organizationId, workspaceId, id])` 与 WmsLot 关系反向字段，以数据库 FK 锁定跨租户关联；不更改现有 SKU 唯一键、payload、revision 保存或投影逻辑。WorkspaceScope 的关系反向字段按上述新表添加。User 的操作者/审批者采用 FK+服务端活跃成员检查，不用裸客户端 userId；既有 AuditLog 新增业务 action 字符串记录，不修改旧审计事实。

## 动作、状态与事务契约

1. 建草稿：已有同范围商品 → 显式批次/条码 → 公司仓/收货位 → receipt + lines；单据编号是事务中唯一业务号，不用全局扫描 max+1。
2. RECEIVE：DRAFT，逐行正数 received≤expected；收货位 onHand、pendingQc 同增。整单落库后 RECEIVED，尚不可用。
3. INSPECT：仅未检数量可提交；accepted 和 rejected 分开记录；pendingQc 减 inspected，pendingPutaway 增 accepted，rejected 增 rejected。全部行检完为 INSPECTED；不合格物仍占实物，不可预留；首期不支持拒收物退运，P0-D 独立动作处理。
4. PUTAWAY：仅已检合格未上架数量；同仓 STORAGE 目标位；收货位 onHand/pendingPutaway 同减，目标位 onHand 增，双腿流水和单据计数同事务；全部 accepted 上架后 PUTAWAY（零合格且质检结束也可终结，拒收实物保留）。
5. RESERVE：目标 STORAGE 位可用量≥请求量；reserved 增，实物不变；生成 reservation，禁止跨位置任意拼余额。
6. RELEASE：仅 remaining−picked 可释放；reserved 减，released 增。已拣需先 UNPICK 才能释放；UNPICK 仅更改 reservation.pickedQty 并审计，不变实物。
7. PICK：数量≤remaining−picked；picked 增，reserved/实物不变。以库存命令和审计记业务事件，不造零实物移动。
8. DISPATCH：数量≤picked；onHand/reserved/picked 同减，dispatched 增；单据与实际流水可回溯。remaining 为 0 后拒绝重复新键发货；原键重试返回成功记录。

所有影响实物/预留的动作均要求 WmsApproval；PICK/UNPICK 要求当前库存 edit 权限并审计。创建草稿及基础仓位资料用 create/edit，不自动取得批准。禁止采用 Amazon 域“单管理员自批”例外，因为该例外只授权 Amazon 同步中心；若公司需要 WMS 自批，应作为后续明确策略变更。

Application Service 每个动作一个 Prisma `$transaction`：

- 由登录用户取组织和有效成员：先对 Organization 取共享锁，再锁/校验用户、成员及角色目录记录，验证工作区及 ownership。已有 `role-catalog-server.ts:137` 的角色目录保存会锁 Organization `FOR UPDATE`，可复用该协议，避免“权限行尚未存在”竞态。WMS 直接在事务内读取 OrganizationRosterRole，角色/权限缺失、目录未初始化或 DB 错误一律拒绝，不复用可能 seed 或 fallback 的 getOrganizationRoleCatalogSnapshot。撤权先提交则写入失败，写入先持锁则可序列化地先于撤权完成。不能仅复用事务外的页面 guard。
- 读取/锁 WmsCommand 幂等身份，核对 requestHash；并发初次请求靠 unique 保证一个提交，冲突回读必须重新授权；不吞掉其他唯一键错误。
- 锁定聚合、审批、仓库/位置/批次/商品关系，验证 expectedRevision、enabled、审批范围/摘要/时效和审批者当前权限。多余额行按稳定 id 排序取锁；新建目标余额用 unique + upsert/冲突重试，不靠“先查不存在再插”。
- 条件更新数量与 revision，受影响行数非 1 则抛冲突；写 WmsMovement/WmsCommand/AuditLog，消费审批，同一事务提交。任一步失败全部回滚。
- 无网络请求，不启动 Worker/队列，不新增 Redis 库存事实。该同步事务切片不需要新 Outbox；将来对外事件另行扩展。

## 具体拟改文件与 API

| 文件/目录（均为 ERP 根目录相对路径） | 修改内容/影响 |
| --- | --- |
| `prisma/schema.prisma` | 上述 11 模型及 ProductRecord/WorkspaceScope/User 必要反向关系、复合唯一键；本文件已有用户修改，实施时仅追加本批内容。 |
| `prisma/migrations/<新时间戳>_wms_first_loop/migration.sql` | 只增表、FK、unique/check/index；不回填、不删改既有事实，不改既有 migration。确认后分配时间戳，避免与现有未提交迁移冲突。 |
| `src/lib/wms/contracts.ts`、`rules.ts` | 正式请求/响应、数量校验、状态与动作规则、hash 规范化；纯函数不依赖 DB 或 Amazon。 |
| `src/lib/wms/repository.ts` | 带 scope 的事务、锁、条件更新、幂等与流水写入，禁止通用任意 SQL 工具。 |
| `src/lib/wms/access.ts`、`approvals.ts` | 实时业务权限/范围与单次审批消费；复用登录/成员与审计模型，库存审批独立于 Amazon 授权。 |
| `src/lib/wms/application-service.ts`、`query-service.ts` | 唯一收发写服务与统一查询服务；API、将来 MCP 均调用这里，不各自查库。 |
| `src/lib/accounts/permissions.ts`、`role-definitions.ts`、`src/lib/auth/api-permissions.ts`（仅如必须） | 新增独立 `wms` 业务权限 id，归属 Logistics 工作台；默认普通员工/现有物流文件角色不获库存写权限。管理员全权限生成逻辑须定向核对；库存禁止自批。既有 view/create/edit/approve/export 动作类型不新增。 |
| `src/app/api/operations/wms/warehouses/route.ts`、`lots/route.ts`、`receipts/route.ts` | GET 有界列表，POST 基础资料/草稿。区域/库位作为 warehouses 下明确子资源（不把层级塞入任意 JSON）。 |
| `src/app/api/operations/wms/commands/route.ts` | POST 统一动作入口 `{workspaceId,action,aggregateId,expectedRevision,idempotencyKey,approvalId?,payload}`；组织/actor 从会话取。payload 为 action 判别联合；未知字段拒绝。审批 id 只有服务端验证后有效。 |
| `src/app/api/operations/wms/approvals/route.ts` | POST request/approve/reject，均有 revision；申请的规范 payload/hash 由服务端生成/验证。批准不执行库存变化。 |
| `src/app/api/operations/wms/balances/route.ts`、`movements/route.ts` | GET 同一 query-service，有界游标按 createdAt/id，过滤 warehouse/location/lot/source；游标绑定组织、工作区、筛选。 |
| `src/app/logistics/warehouse/page.tsx`、`src/components/logistics/warehouse-workbench.tsx`、既有 Logistics 入口 | 在现有 Logistics 下提供公司仓子页；收货→质检→上架→预留/释放→拣货/出库和审批、流水回读；不改 Amazon 库存页含义。 |
| `tests/wms-rules.test.ts`、`tests/integration/wms-first-loop.integration.ts`、`tests/browser/wms-first-loop.spec.ts`、`scripts/test-wms-offline.mjs` | 纯规则、真实临时 PG 事务/权限并发、真实登录 HTTP/API 和必要页面流程；runner 在创建隔离资源前验证不继承真实配置。 |
| `docs/wimoor-integration/p0b-verification.md`、本文件 | 记录实际完成/未完成状态与复现命令，不冒充已有验收。 |

POST 成功返回 `{commandId,aggregateId,revision,movementIds,result}`；400 格式错误、401 未登录、403 撤权/跨范围、404 同范围不存在（不泄漏跨租户对象）、409 revision/幂等内容/状态冲突、422 数量不合法/不足；分页返回 `{items,nextCursor}`。查询不返回审批原始敏感载荷、会话或凭据。草稿与余额的准确字段在 contracts.ts 判别类型中固定，不增加别名副本。

本批授权粒度复用 ERP 现有组织角色的模块动作：显式授予 wms 权限后可操作本组织所选工作区（必须存在），不借 Seller 读取授权推断库存操作资格。首期不新增仓库级员工分配；若需按仓限制人员，须另增明确合同，不能在实现中暗用 Amazon grant 充当仓库授权。草稿 ownership 与审批人权限独立检查；主管跨人审批仅授予 approve 者允许，不能靠角色名称猜测。角色目录、团队成员撤权路径列为验证依赖（`src/lib/accounts/role-catalog-server.ts`、`src/app/api/accounts/team-members/route.ts`），优先只复用其锁协议；发现需要修改这些共享路径时先补具体 diff 与影响，再扩大本次确认范围。

## 隔离验证和回退范围（待本次确认后实施）

- 空库/升级库：新建明确命名的临时 PG 数据库，先应用当前全部 migration 到临时库，再验证本批增量；升级种子仅合成，含 ProductRecord/组织/成员，不读取业务库。检查复合 FK、CHECK、unique、索引和限制删除。临时资源只清理本 runner 创建且核实身份的对象。
- 核心链：收 10→合格 8/拒收 2→上架 8→预留 6→拣 4→出 4→释放剩余 2，最终 storage onHand=4/reserved=0、receiving onHand=2/rejected=2；逐位置/批次流水和余额一致；另测部分质检/上架、零合格、停仓、错批次/错位。
- 并发：同可用 10 两请求各预留 7，最多一个成功；同键 20 并发仅一份流水；同键异内容 409；审批双消费仅一次；首次目标余额并发上架不丢数；整单第二行故障回滚第一行。
- 权限：未登录、跨组织/工作区/商品/仓位、成员停用、审批过期/自批/不同 payload/旧 revision、批准后撤权、事务并发撤权都拒绝；失败请求零库存流水。保留安全时序说明，不承诺取消已先提交的合法写事务。
- HTTP：临时 Next 实例使用隔离配置与合成登录会话，真实 Route Handler 发起/批准/执行/查询；重试、首末页、审计和来源一致。不能以直接 service 调用替代 HTTP。无需 Amazon transport 或 Redis Worker。
- 验证命令：定向 tests + `npm run check:fast`，schema validate/generate 和隔离迁移；只有准备合码/上线才完整 `npm run check`。现有工作区基线失败单独记录，不修改无关代码。
- 回退：尚未接入时只撤销本批新增文件/patch；不能整文件恢复 schema/权限。接入后关闭新入口及权限，保留新增表、已提交事实与审计；用前向修复解决错误，不降级删表、不反向覆盖 ProductRecord，不自动撤销实物发货。没有生产迁移、启动、部署授权。

性能：新增查询均按 scope+仓位/批次或 scope+createdAt/id 建索引，有界分页/命令行数（首期每单最多 100 行）。先以 30 并发、1 万 SKU、10 万流水合成基线测锁等待/P50/P95，再决定是否优化；未测前不承诺数值，不新增队列/缓存/读副本。

## 当前门禁

2026-11-11：用户已批准本地共享边界修改及隔离验证，P0-B 核心代码已实现。11 模型迁移、收货至出库数量链、流水对账、并发/幂等/撤权/回滚、真实本地 HTTP 和临时 Next/Chrome 页面验证通过，详见 `verification.json` 的 `p0b`。现有数据库未应用迁移，不代表真人仓库、真实 Amazon 或生产验收。复现：`env -i PATH="$PATH" node scripts/test-wms-schema-offline.mjs`。性能容量合成基线已通过，见本文件末尾本轮收尾；真人双人仓库验收仍未覆盖。

## 本次继续完善（2026-11-11）

- 库存余额、库存流水与预占/调拨表单复用统一 WMS 查询，显示仓库、库位、批次及条码；仅补当前页，不读取 ProductRecord。可用量由服务端复用库存动作的规则计算；流水补齐待质检、待上架及拒收变化。
- 当前隔离迁移、HTTP、双会话 Next/Chromium 收发链及新增身份核对断言通过；类型检查、六个修改文件定向 ESLint 通过。全量快检测试 1498 项，1495 通过、3 项 Amazon 同步测试失败，后续 lint/typecheck 阶段未执行；独立类型与定向 lint 已执行，详见 verification.json 的 p0b_stock_readability。
- 按本清单范围，核心业务链本轮已跑通；预计还 1 轮做容量验证及验收收尾。真人仓库验收和实际环境迁移/部署另需授权，不能作为本地隔离验证完成项。完整 Wimoor 功能不在此轮数范围。
- 本次未改 Schema/权限，未向现有库应用迁移，未提交、推送或部署。

## 本轮收尾（2026-11-11）

- 新增 `tests/integration/wms-capacity.integration.ts`，现有 runner 支持 `--capacity`：临时 PG 16（1 CPU/512 MiB），1 万 SKU、10 万流水、30 并发，查询/预占成功，同余额竞争只提交一次，未超卖、流水核对一致。P95：余额 253ms、流水 57ms、核对 68ms、独立预占 64ms；仅本地服务基线，非生产 SLA。报告：`../../outputs/wms-p0b-local/capacity.json`。
- 三个 Amazon 断言按已有实现修正；最终单测 **1498/1498**、类型检查、隔离迁移/HTTP/双会话真实页面回归通过。保留工作区同时进行的短收修改，并按当前版本复验，不将其计为本容量收尾新增功能。
- 标准快检未完整全绿：lint 扫描 `.next-process-*` 生成包后中止；排除此目录仍发现 `outputs` 下执行脚本 9 项 require-import 错误。额外排除 `outputs/**` 后全量源码 lint 为 0 错误/7 警告；没有改 lint 配置或清理这些产物。复现命令见 `verification.json` 的 `p0b_capacity_closeout`。
- P0-B 本地核心开发、自动化功能和容量验证已收尾，无需再预留核心开发轮次；剩真人仓库验收及实际环境迁移/上线，不计为本地完成。未运行生产构建（本次不准备合码/上线），未 commit/push/迁移现有库/部署。

### 收货作业筛选补齐（2026-11-11）

新增待质检、待上架、存在拒收、存在短收四类筛选；允许部分处理单据同时属于多个作业队列，草稿/取消不计入拒收或短收。统一查询在分页前按真实明细数量筛选，复用现有权限，使用同一事务快照读取命中单据及明细。实际临时 PG/HTTP/双会话 Next 页面回归、跨页/组合筛选/游标/权限验证、12 项相关单测、类型检查及定向 lint 通过。修复短收集成断言依赖未定义明细顺序的问题，按 lotId 核对。未新增模型或库存动作，未重跑容量/完整快检/生产构建（局部查询变更使用相关集成、单测、类型及 lint 验证）；未迁移现有库、提交、推送或部署。

### 审批到执行待办补齐（2026-11-11）

新增待我审批、本人已批待执行、我的申请、已过期筛选，服务端分页前匹配且游标绑定当前用户；按钮资格复用事务内当前权限与有效期检查，移除 route 平行规则。过期的已批申请显示已过期；实际批准/执行仍独立复核成员、范围、版本及库存，待办不保证目标仍可执行。1499 项单测、类型检查、8 文件定向 lint、临时 PG/HTTP/双账号 Next 页面完整流程通过（首次商品搜索超时，独立复跑全链通过）。未重跑标准快检/生产构建/容量，使用全量单测及相关集成/类型/lint 覆盖局部查询变更；未迁移现有库、提交、推送或部署。

### 收货审批核对补齐（2026-11-11）

统一审批查询按当前页批量补充收货单号、来源、收货库位及申请行批次/条码、上架目标库位；页面区分当前资料与申请数量，不读取商品主档。7 项相关单测、类型检查、六文件定向 lint、临时 PG/HTTP/双账号 Next 页面全链通过（新增 HTTP 断言查询修正后完整复跑）。未重跑完整快检、容量或生产构建；未修改模型/库存写入规则，未迁移现有库、提交、推送或部署。P0-B 本地核心无剩余开发轮次，真人仓库验收与实际上线另计。

### 单据关联审批补齐（2026-11-11）

收货单、库存余额、预占单增加“查看审批”，审批列表支持精确业务单据 ID 筛选；统一查询在分页前组合状态/待办条件，游标绑定目标，沿用实时权限与范围检查。临时 PG/HTTP/双账号 Next 页面全链、三类跳转、手动输入/清除、分页/组合筛选/游标/跨工作区/长度验证、类型检查及四文件定向 lint 通过。未修改模型或库存写入规则，未重跑完整快检/容量/生产构建，未迁移现有库、提交、推送或部署。

### 收货作业批次核对补齐（2026-11-11）

收货详情、收货/质检/上架作业表和草稿编辑显示批次编码、条码，详情补充仓库与收货库位。统一查询仅按当前页批量补充同范围 WMS 资料，不读取商品主档；保留 ID、数量和原写入规则。临时 PG/HTTP/双账号 Next 页面全链、无 products.view 的主管查询、四类作业队列资料核对、7 项单测、类型检查及九文件定向 lint 通过。未重跑完整快检/容量/生产构建，未迁移现有库、提交、推送或部署。

### 收货扫码定位补齐（2026-11-11）

收货页支持条码/批次编码精确查询及 Enter 提交，可组合单号、来源、仓库、状态和四类作业队列；队列必须由同一明细同时满足批次和作业数量条件，返回保留整单明细。统一服务在分页前筛选，复用范围/权限及游标约束。临时 PG/HTTP/双账号 Next 全链、分页/同明细/前导零/大小写/跨范围验证、7 项单测、类型检查和五文件 lint 通过（页面场景清除上页筛选后完整复跑）。未重跑完整快检/容量/生产构建，未迁移现有库、提交、推送或部署。

### 出库审批预占单核对补齐（2026-11-11）

统一审批查询在原有当前页批量查询中补齐出库/释放的预占单号、当前版本和数量；页面显示当前与申请版本、剩余预占/已拣/待拣及累计释放/出库，版本变化明确提示重新申请。未新增查询链、模型或库存写规则。临时 PG 升级/空库迁移、HTTP、双账号 Next/Chromium 全链、7 项单测、类型检查、六文件定向 lint 和 diff 检查通过；详见 verification.json 的 p0b_reservation_approval_review。未重跑完整快检、容量和生产构建；未迁移现有库、提交、推送或部署。按本清单，P0-B 本地核心剩余 0 轮；实际上线前仍需环境迁移、双人仓库验收和发布，完整 Wimoor 功能不在此轮数范围。
