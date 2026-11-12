# WMS 源表逐项复用与 Schema 增量评审

日期：2026-11-11。范围：当前工作树、Wimoor 本地源 DDL、现有 WMS 服务。此文是 Schema 扩展依据，不是已实施模型清单或数据迁移方案。

## 核对口径

- 原交付描述的“30 表”没有附具体表名；当前 `evidence/module_membership.json` 给出 32 张 WMS 注解候选表。此次逐项覆盖 32/32，不自行删两张凑数；候选归属仍不等于独占业务归属。
- 每张表均直接读取 `init-config/mysql/数据库结构/db_erp/<表名>.sql`；来源路径、CREATE TABLE 行号及本轮文件 SHA-256 记录在 [机器映射](evidence/wms-table-reuse-review.json)。该选择不裁决其他 DDL 副本或 Entity 冲突；执行字段迁移前须按源冲突目录裁决。
- `STATIC_DDL_REVIEWED_TARGET_PROPOSED` 表示字段结构已静态核对、目标处置为设计建议；不代表所有 Service 规则已验证。原始证据 JSON 保持不变，历史 PROPOSED/验收状态不自动升级。
- 当前 11 模型均保留：`WmsWarehouse`、`WmsArea`、`WmsLocation`、`WmsLot`、`WmsReceipt`、`WmsReceiptLine`、`WmsStockBalance`、`WmsReservation`、`WmsCommand`、`WmsMovement`、`WmsApproval`。

## 逐表映射

源表统一前缀 `t_erp_`；表中目标包含“拟新增/待设计”的均未实现。

| 源表（省略前缀） | 处置 | 目标 | 字段依据、差距与边界 |
| --- | --- | --- | --- |
| `changewh_form` | 独立业务候选 | SKU 转换单（待设计） | 同仓 material_from→material_to；不能复用 TRANSFER 语义；需产品/批次转换依据与审批。 |
| `changewh_form_entry` | 独立业务候选 | SKU 转换明细（待设计） | 保留源商品、目标商品和转换数量；不能修改 WmsLot.productRecordId 冒充转换。 |
| `dispatch_form` | 扩展候选 | WmsTransfer（拟新增） | from/to warehouse、ftype、arrivalTime；现有 TRANSFER 仅即时双腿，缺在途/接收；报废/修复/送检类型需拆业务动作。 |
| `dispatch_form_entry` | 扩展候选 | WmsTransferLine（拟新增） | materialid/amount 映射显式批次及来源/目标位置分配，支持部分发出/接收。 |
| `dispatch_form_record` | 复用并补语义 | WmsCommand + WmsApproval + AuditLog | 复用审批和操作记录基础；若需完整状态轨迹，应追加前后状态、业务原因和来源，不能宣称当前记录字段完全等价。 |
| `dispatch_oversea_box` | 跨模块候选 | 物流装箱持久化合同（待设计） | 箱号、尺寸、重量及单位；Logistics 文件处理不证明已有可替代持久化模型。 |
| `dispatch_oversea_case` | 跨模块候选 | 物流箱内商品合同（待设计） | boxid/sku/quantity；SKU 必须经卖家/站点或本地商品身份映射，不可按文本直接关联。 |
| `dispatch_oversea_form` | 跨模块候选 | 海外调拨/头程合同（待设计） | country/groupid/check_inv 与在途单据；不是普通库位转移，也不自动等同 Amazon inbound plan。 |
| `dispatch_oversea_form_entry` | 跨模块候选 | 海外调拨明细合同（待设计） | materialid/sellersku/fnsku/amount；保留本地商品与外部标识各自职责。 |
| `dispatch_oversea_trans` | 跨模块候选 | 运输/费用合同（待设计） | 承运商、渠道、单价、计费重、附加费、运单和到达时间；不把运输费用塞进库存余额。 |
| `inventory` | 合并复用 | WmsStockBalance | warehouse/material/shop/status 数量行改为 scope+location+lot 的数量列；fulfillable 不直接等于 onHand，待入/待出须逐状态核对。 |
| `inventory_his` | 派生查询候选 | 流水时点重建/必要历史快照 | modifyday/status/quantity 是历史证据；本次不导入、不删除；未来导入不可伪造为实时流水，日切口径另定。 |
| `inventory_his_day` | 派生查询候选 | 日库存读模型（待设计） | byday/inbound/fulfillable/outbound；须明确时区、截止时点及迟到事件，不能成为第二库存写入口。 |
| `inventory_month_summary` | 派生查询候选 | 月库存读模型（待设计） | startqty/endqty/分类流量/周转指标；分类与公式尚未逐项核实，不直接拷贝计算结果或当成本账。 |
| `inventory_record` | 合并复用 | WmsMovement + WmsCommand | form/source、operate、增减及余额映射现有流水；readyin/readyout 含义需对应数量桶；库存预测不冒充实物。 |
| `inwh_form` | 扩展复用 | WmsReceipt + WmsApproval | 复用收货单；源审核状态不等于 RECEIVED/INSPECTED/PUTAWAY，备注和结构化来源合同仍有差距。 |
| `inwh_form_entry` | 扩展复用 | WmsReceiptLine + WmsLot | material/amount→显式商品批次和 expected/received 数量；不自动生成虚构批次，源一次入账不等于目标质检链。 |
| `outwh_form` | 扩展候选 | WmsOutbound（拟新增）+ WmsReservation | 独立多行出库单承载 customer/address/express/ftype；现有单余额预占不能替代完整出库单。 |
| `outwh_form_consumable` | 独立业务候选 | 耗材/BOM 发料合同（待设计） | submid/mainmid/units/shipqty/subout；units 是 decimal，不能套用当前整数库存接口而丢精度。 |
| `outwh_form_entry` | 扩展候选 | WmsOutboundLine（拟新增） | 出库需求行与实际批次/库位预占分配分开；一个需求行可能多份预占，不能一行一个裸 balanceId 强行限制。 |
| `stocktaking` | 扩展候选 | WmsStocktake（拟新增） | 盘点单状态/范围/账面基准/审批过账；金额估值依赖成本来源，不能由库存数量猜成本。 |
| `stocktaking_item` | 合并设计候选 | 盘点明细/商品汇总 | 仓库商品汇总可从位置批次明细派生；是否存在独立录入用途需读 Service 后决定，不能提前删除源证据。 |
| `stocktaking_item_shelf` | 扩展候选 | WmsStocktakeLine（拟新增） | 位置/批次粒度的账面数量、实盘数量、差异、基准 revision；源只有 material+shelf，不能猜批次分摊。 |
| `stocktaking_shelf` | 合并设计候选 | 盘点位置范围（待设计） | 保留本次选择的库位集合，即使库存为零也属于范围；不能只靠非零盘点行推断范围。 |
| `stocktaking_warehouse` | 合并设计候选 | 盘点仓库范围（待设计） | 单仓可由盘点头承担；多仓须明确关联和锁顺序；现有源头 warehouseid 与此关系不能未核实就并存复制。 |
| `warehouse` | 扩展复用 | WmsWarehouse + WmsArea | 保留仓库身份；disabled→enabled 取反；parent/level 不直接推断为 area；地址、盘点门禁等缺失。ishungry 负库存开关排除。 |
| `warehouse_address` | 扩展候选 | 仓库地址合同（待设计） | 地址/邮编/联系/有效期信息，与仓库身份分离；共享地址和历史单据地址快照规则需明确。 |
| `warehouse_shelf` | 扩展复用 | WmsLocation + WmsArea | 库位基础可复用；货柜树、地址关系、容量/尺寸/isfrozen 当前未覆盖；enabled 不能替代冻结。 |
| `warehouse_shelf_inventory` | 合并复用 | WmsStockBalance | 合并位置数量事实，仓库总量由位置汇总；size 体积独立处理，不能假设等于商品当前尺寸乘数量。 |
| `warehouse_shelf_inventory_opt_record` | 合并复用 | WmsMovement + WmsCommand | 合并数量流水；保留 sourceId/type；源 balance_size/size 尚无目标字段，体积历史不声称已覆盖。 |
| `warehouse_type` | 扩展候选 | 仓库业务类型合同（待设计） | 源是带 shopid 的自定义字典；不能直接映射 RECEIVING/STORAGE（它们是库位类型），也不能盲目固定枚举。 |
| `whse_unsalable_rpt` | 派生查询候选 | 滞销/库龄读模型（待设计） | qtysum30..365、salesum、nostock 等需销售窗口/批次年龄来源和完整性；现有余额不能独立产生可靠库龄/滞销。 |

## 重要调用链证据

`stock/service/impl/ChangeWhFormServiceImpl.java:79-91`（完整前缀 `wimoor-erp/erp-boot/src/main/java/com/wimoor/erp/`）：设置 `materialFrom/materialTo` 后对源物料 `outStockByDirect`，对目标物料 `inStockByDirect`。因此 changewh 是 SKU 转换，不能按名称推断为调仓。取消路径约 133-138 行执行反向操作；这不意味着目标系统可修改/删除已记账流水。

当前 ERP `src/lib/wms/application-service.ts` 的 TRANSFER 是同一事务 source.onHand 减、target.onHand 加；没有调拨单、运输中状态或部分签收。`repository.ts` 的 move 是现有余额与流水统一写入口，后续新业务继续调用；`reconciliation.ts` 提供流水与余额、预占余额对账。

## Schema 增量次序与门槛

1. 保持现有 11 模型及 scope+location+lot 唯一余额不变，不建立平行 warehouse/shelf 余额。不从源 shopid 直接推导 organization/workspace，不把 materialid 当稳定 ProductRecord.id。
2. 第一业务切片候选：盘点单、位置/批次盘点明细及显式范围。先确定静态冻结或动态盘点、零库存/未建余额商品处理、盲盘/复盘、差异审批与过账策略，再落字段和 migration；现有库存动作也必须接入盘点门禁。盘点过账复用统一命令、审批及 append-only 流水。
3. 冻结为独立规则：源 shelf.isfrozen 证明存在冻结字段，不证明按数量冻结/解冻的全部规则；先明确库位操作冻结与库存数量冻结的关系、与预占重叠策略，再决定 Location 字段或冻结聚合及数量桶。当前 available 公式与数据库 CHECK 必须同批更新，不能只追加 frozen 列。
4. 后续分别补 WmsTransfer/Line 的在途链、WmsOutbound/Line 的多行分配；收货继续复用 WmsReceipt/Line，不另建同义入库表。现有 sourceReference 是文本，不代替受范围约束的结构化业务关联。
5. SKU 转换、耗材/BOM、海外装箱/运输、地址类型、历史汇总分别按具体需求切片。派生报表不作为库存写事实，源历史证据不删除；没有当前数据迁入授权，不生成虚构 opening balance。
6. 领域 Outbox 是目标可靠事件需求，并非这 32 张源表的机械映射；与 BullMQ 交付项另行设计，复用注册 Worker 和既有基础设施。

每个切片的完整 schema 交付必须包含：正式字段/枚举或 CHECK、scope 复合外键、业务编号及幂等唯一键、查询索引、revision、审计和不可变流水约束、升级迁移及隔离验证；Prisma 不表达的 CHECK/trigger 留在 SQL migration 中。高精度计量/金额使用 Decimal 并以字符串跨 API，不把所有数量一概改成小数或字符串。

## 共享边界、验证与回退

本轮只增加本评审和机器映射，并在 Wimoor 索引加入链接；不改 schema、权限、运行态、数据库或 Worker。实际 Schema 修改还需按 AGENTS.md 对共享模型及迁移的规则，先给出所选切片的文件/字段级影响、回退和验证范围再确认，不能把本表的目标候选当成已批准迁移。

实现时在明确临时 PostgreSQL 中验证 scope FK、CHECK、唯一键、非法状态、并发/幂等、审批撤权、整单回滚及流水对账；有新事件则补投递失败/重复消费恢复测试。确认 runner 不读取根 .env 或真实凭据后再运行。本轮只验证 32 表覆盖、源文件及 hash、11 模型存在、链接和 patch 格式，不运行应用测试/构建。

迁移前回退只撤销本切片 patch，保留已有用户修改；迁移后通过关闭入口和前向修复保留单据/流水，不删业务表或反写商品主档。未连接真实服务，未提交、推送或部署。

## 后续实施记录

用户确认开始修改后，第一批落实[盘点 Schema 基础切片](wms-stocktake-schema-foundation.md)：增加 WmsStocktake、WmsStocktakeLocation、WmsStocktakeLine 及状态枚举、范围外键和数量/元数据约束。上文映射为评审时基线，已有 11 模型不重建；本批目标为 14 模型。盘点业务入口、审批过账、冻结门禁及可靠事件仍未启用，不能将此基础切片标为完整 WMS 交付。未执行现有业务库迁移。


## 出库需求 Schema 增量（2026-11-12）

`outwh_form` → `WmsOutbound`：number、warehouseid、creator、customer、toaddress、express、expressno、remark 分别对应编号、仓库、创建人、客户、送货地址、承运商、运单号及备注。shopid 不直接映射租户；auditstatus 不映射执行状态，ftype 的废品/送检/海外语义本批不启用。

`outwh_form_entry` → `WmsOutboundLine`：formid 关联单头，materialid 经正式 ProductRecord 身份关联，amount 为正整数需求数量。需求按商品记录，不预设单一批次/库位；预占继续属于 WmsReservation。两张表包含 scope 复合外键、编号/商品唯一键、revision 和工作队列索引。当前仅 Schema 基础，未提供释放/完成状态机、分配、审批或页面入口，不声称完整出库闭环。

本批迁移 `20261120010000_wms_outbound_foundation` 仅做隔离验证，未应用真实库。现有 16 个 WMS 模型扩展为 18 个（16 业务 + 2 事件基础设施），不以目标表数裁剪或补齐源表。新增表不改变库存数量；应用回退不删新表。迁移验证命令：`env -i PATH="$PATH" node scripts/test-wms-schema-offline.mjs --transfer`。


2026-11-12 核心业务与本机迁移的实际进展见 [WMS 核心移植落地记录](wms-core-port.md)。逐表评审仍保留原始基线状态，不能把候选项或合并映射视为字段全部等价移植。
