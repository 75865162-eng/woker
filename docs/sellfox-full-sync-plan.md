# 赛狐全量同步与承接页设计

> 目标：把赛狐开放平台**能读的**数据全量落到本地库，并且每个数据集都有唯一、可验收的承接页。
> 依据：`sellfox-api-docs/INDEX.md`（316 个接口条目 + 14 篇文档；本地已抓 106 个接口页、103 个唯一路径）、现有 14 个同步资源、13 张事实表。
> 边界：本方案只做**读**（同步）。赛狐的创建/修改/删除接口（SKU、采购单、发货单、入库计划等）一律不接，避免双写冲突。

---

## 0. 已落地（2026-11-14）

| 项 | 状态 | 落点 |
|---|---|---|
| 承接页骨架（页头 + 数据集 tab + 筛选 + 表格 + 汇总 + 分页） | 已实现 | `src/components/sellfox/host/host-workbench.tsx` |
| 7 个新承接页（商品/利润/广告/库存/采购/财务/出入库） | 已实现 | `hostPages` 目录 + `src/app/(erp)/sellfox/*` |
| 统一一级导航（15 个 tab，按赛狐模块顺序） | 已实现 | `src/components/sellfox/sellfox-nav.tsx` + `sellfoxNavOrder` |
| 只读数据接口 `/api/sellfox/dataset` | 已实现 | 广告 6 类 + FBA 库存 + 产品日利润（代理 performance） |
| 同步控制台 `/sellfox/sync` | 已实现（只读 + 手动触发） | 节奏 / 覆盖矩阵 / 首跑顺序 / 运行记录 / 待接入 P0 |
| 限流：全局串行 → 按接口 path | 已实现 | `client.ts`：同 path ≥1.1s、不同 path 并行、`SELLFOX_RATE_LIMIT_MODE=global` 可回退 |
| 同步节奏 / 首跑顺序 / 分片键规则 | 已实现（定义层） | `src/lib/sellfox/sync-plan.ts` |
| 分片表 `SellfoxSyncShard`、泛化覆盖表 `SellfoxCoverage` | 已实现 | `sync-shards.ts`：run 完成后写分片（资源×店铺×期间）+ 从事实表重算覆盖度；migration `20261214230000_sellfox_sync_shards` |
| 54 个待接入数据集的同步器 | 未实现 | 页面按「未接入」展示，不造假行 |

对账口径（本次实测）：广告产品 2,808 行 / 花费 1,731.45 / 曝光 355,810，与原始表逐项相等；FBA 库存 8,806 行、可售 214,514、总库存 400,364、38 个店铺，与原始表相等。

---

## 0.1 规则驱动的全自动同步（2026-11-15 升级）

目标：**后台配置一条新 API，不需要写同步器、不需要跑脚本，系统自动把历史全量拉完并每天滚动重跑。**

| 能力 | 落点 |
|---|---|
| 同步规则注册表（14 个内置域的 cadence / dateMode / chunkDays / 间隔 / 依赖 / 行数上限唯一事实源） | `src/lib/sellfox/sync-rules.ts`；`sync-plan.ts`、`schedule-time.ts` 改为从注册表派生 |
| 后台可配置 API 端点 | `SellfoxApiEndpoint` 表 + `/api/sellfox/endpoints`（新增/编辑/启停/重置游标/单端点全量） |
| 通用采集器（原始 payload 落 `SellfoxApiRecord`，不猜字段、不补零；主键缺失用整行内容哈希保证幂等） | `src/lib/sellfox/generic-endpoint-sync.ts`，按「店铺 × 日期块 × 分页」执行，断点存 `pageNo` |
| 全自动编排器 | `src/lib/sellfox/sync-orchestrator.ts`：`buildSellfoxFullSyncPlan`（纯函数展开计划）、`planSellfoxFullSync`（一键全量）、`planSellfoxEndpointAuto`（历史游标 + 每日滚动）、`handleSellfoxAdaptiveSplits`（超限自动对半拆到 1 天） |
| 接入 worker | `scripts/sellfox-sync-worker.ts` 每 30 秒 tick 调用端点自动计划 + 失败块拆分；所有 run 走既有队列/租约/断点/分片链路 |
| 控制台入口 | `/sellfox/sync` 端点配置面板；`POST /api/sellfox/full-sync` 一键全量（内置 + 已启用端点） |

新增 API 的操作路径：在控制台填 `code / 接口路径 / 日期模式 / 分块天数 / pageSize / rowsPath / 主键字段 / 参数模板 / 历史起点` → 保存 → worker 下个 tick 起自动按 `chunkDays` 逐块回填到昨天，之后每天滚动重跑最近 7 天。参数模板支持 `${shopId} ${startDate} ${endDate} ${pageNo} ${pageSize} ${today}`，未知占位符原样保留；接口路径与参数模板写入前做白名单校验。**字段含义仍需接口文档确认，配置层不会替用户猜字段。**

实测约束（2026-11-15 真实全量联调）：广告报表单次请求**超过 5 万行会被上游拒绝**（`超过五万行，请缩小范围。`）。因此注册表给广告类预置 14 天 / 7 天分块，失败块再自动对半拆；已完成窗口并集覆盖失败窗口时跳过拆分，避免重复拉取。

端到端验证（同日）：后台配置 `/api/shop/pageList.json` → worker 自动创建 `endpoint:auto_probe_shop` run → 通用采集器写入真实原始行（39 行/期间，共 78 行）→ run 状态 done；一键全量对同一窗口返回 `created:0, skipped:1`（幂等）；旧 90 天广告失败 run 未被重复拆分。

---

## 1. 现状盘点

### 1.1 已同步（live）

| 资源 | 落地表 | 行数 | 承接页 |
|---|---|---|---|
| `stores` | `SellfoxStore` | 39 | `/sellfox`（数据总览） |
| `listings` | `SellfoxListingSnapshot` | 49,162 | `/sellfox/listings` |
| `sales` | `SellfoxSalesDailySnapshot`（视图 `sellfox_sales_daily`） | 14,226 | `/sellfox/sales` |
| `performance` | `SellfoxProductDailySnapshot` | 3,626 | `/sellfox/performance` |
| `orders` | `SellfoxOrderSnapshot` | 37,856 | `/sellfox/orders` |
| `inventory` | `SellfoxFbaInventorySnapshot`（视图 `sellfox_inventory_current`） | 52,821 | `/sellfox/restock` |
| `fba_shipments` | `SellfoxFbaShipmentSnapshot` | 27,499 | `/sellfox/shipments` |
| `ads_report` | `SellfoxAdsProductDaily` | 2,808 | 无独立页（仅在 hub 计数） |
| `ads_campaign` | `SellfoxAdsCampaignDaily` | 1,080 | 同上 |
| `ads_ad_group` | `SellfoxAdsAdGroupDaily` | — | 同上 |
| `ads_targeting` | `SellfoxAdsTargetingDaily` | 18,156 | 同上 |
| `ads_search_term` | `SellfoxAdsSearchTermDaily` | 1,460 | 同上 |
| `ads_placement` | `SellfoxAdsPlacementDaily` | — | 同上 |
| `hourly` | `SellfoxHourlyMetric` | 0 | 同上 |

同步机制：`sellfoxPost` 全局串行（1.2s/请求，Postgres advisory lock）→ 每个资源一个 sync 函数 → `SellfoxSyncRun` 记录 + checkpoint 断点 → `SellfoxSyncSchedule` 定时。

### 1.2 硬约束（决定全量方案形态）

1. **限流 1 请求/秒/接口**，超限返回 `code 40019`（`docs/限流策略说明`）。
   现状是**全局** 1.2s 串行，等于把所有接口当成一个接口用，吞吐被人为压到 1/1.2 次每秒。
2. **分页 100/页**，需要按 `totalPages` 校验完整性（已有 `nextSellfoxPage`）。
3. 广告报表是**异步下载任务**：`createTask` → `pageList` 轮询 → 解析 XLSX，按「店铺 × 日期 × 报表类型」计一次任务。
   **单次任务行数上限 5 万行**（超限报「广告报告超过五万行，请缩小范围」，2026-11-15 联调实测）。
   全量回补必须分块：实测建议 `ads_report / ads_campaign / ads_ad_group / ads_placement` 14 天/块、
   `ads_targeting / ads_search_term` 7 天/块，超限自动对半拆到 1 天（`tmp/ads-chunk-pull.ts` 即此策略，
   正式化时应并入编排层）。
4. 财务报表（结算/利润）是**按月**出数，和日快照口径不同，不能相加。

---

## 2. 赛狐全量能力地图

按赛狐后台模块分 8 组，`live` = 已同步；`P0/P1/P2` = 待做期次；`授权` = 需平台侧开权限；`文档` = 本地文档缺失，需补抓或联调核对字段。

### 2.1 基础与主数据

| 数据集 | 接口 | 状态 | 目标表 |
|---|---|---|---|
| 店铺列表 | `/api/shop/pageList.json` | live | `SellfoxStore` |
| 子账号列表 | 文档：获取子账号列表 | P1（业务员/开发员归属） | `SellfoxSubAccount` |
| 汇率列表 | 文档：汇率列表 | P0（多币种汇总前置） | `SellfoxExchangeRate` |
| 站点映射 | 文档：站点 MarketplaceId 对应关系 | live（常量） | — |

### 2.2 商品主数据

| 数据集 | 接口 | 状态 | 目标表 |
|---|---|---|---|
| SKU 列表（含成本、开发员、包装） | 文档：查询SKU（文档） | P0 | `SellfoxSkuMaster` |
| SPU 款名 | 文档：查询SPU（文档） | P0 | `SellfoxSpuMaster` |
| 商品分类 | 文档：查询商品分类（文档） | P1 | `SellfoxCategory` |
| 品牌 | 文档：查询品牌（文档） | P1 | `SellfoxBrand` |
| 商品属性 | 文档：获取商品属性列表（文档） | P2 | `SellfoxAttribute` |
| 辅料 / 质检模板 | 文档：查询辅料、质检模板列表（文档） | P2 | `SellfoxAuxMaterial` / `SellfoxQcTemplate` |
| 商品详情 V2 | 文档：查看商品详情V2（文档） | P2 | 复用 `SellfoxSkuMaster.detail` |
| 在线产品（Listing） | `/api/order/api/product/v2/pageList.json` | live | `SellfoxListingSnapshot` |
| Listing 操作日志 | 文档：查询Listing操作日志列表（文档） | P2 | `SellfoxListingChangeLog` |
| 多平台配对 | 文档：查询多平台配对列表（文档） | P2 | `SellfoxListingPairing` |
| 评价明细 | 文档：获取评价明细列表（文档） | P1 | `SellfoxReview` |

> 商品主数据是**唯一事实源**问题：现在 `SellfoxListingSnapshot` 里的 title/brand/developer/spu 来自 Listing 而不是商品库，SKU 成本字段为空。SKU/SPU 主数据落表后，所有页面按 `sku` join 主数据取成本，不再从 Listing 猜。

### 2.3 订单与售后

| 数据集 | 接口 | 状态 | 目标表 |
|---|---|---|---|
| 订单列表（行级） | `/api/order/pageList.json` | live | `SellfoxOrderSnapshot` |
| 订单详情 / 批量详情 | 文档：订单详情、订单详情 批量接口（文档） | P0 | `SellfoxOrderDetail` |
| FBM 订单列表 / 详情 | 文档：FBM订单列表、FBM订单详情（文档） | P1 | 复用 `SellfoxOrderDetail`（channel=fbm） |
| 订单处理列表 / 详情 | 文档：查询订单处理列表、详情（文档） | P2 | `SellfoxOrderProcess` |
| FBA / FBM 退货报告 | `/api/order/api/report/fbaReturn/pageList.json`、`/api/order/api/report/fbm/return/order/pageList.json` | P1 | `SellfoxReturnReport` |

### 2.4 广告

| 数据集 | 接口 | 状态 | 目标表 |
|---|---|---|---|
| 六类日报（SP/SB/SD 产品、活动、广告组、投放、广告位、搜索词） | `/api/cpc/download/createTask.json` + `/pageList.json` | live | 6 张 `SellfoxAds*Daily` |
| SP 小时报告 | `/api/cpc/hourData/spCampaign.json` | live（仅 campaign） | `SellfoxHourlyMetric` |
| SB/SD 小时报告（8 个） | `/api/cpc/hourData/sb*`、`/sd*` | P2 | 复用 `SellfoxHourlyMetric`（entityType 区分） |
| 管理实体 SP（活动/组/产品/关键词/商品投放/否定词/否定商品） | `/api/cpc/manageData/sp*.json` | P1 | `SellfoxAdsEntity` |
| 管理实体 SB / SD（12 个） | `/api/cpc/manageData/sb*`、`/sd*` | P1 | 同上 |
| ABA 搜索词 | `/api/cpc/searchTerms/pageList.json` | P1 | `SellfoxAbaSearchTerm` |

> 广告管理实体是「结构树」：现在只有**报表**（花了多少钱），没有**实体**（活动叫什么、预算多少、状态是否开启），所以 PPC 页面无法做「为什么花超了」的归因。

### 2.5 仓储

| 数据集 | 接口 | 状态 | 目标表 |
|---|---|---|---|
| FBA 库存明细 | 文档：查询FBA库存明细 | live | `SellfoxFbaInventorySnapshot` |
| 仓库列表 | 文档：查询仓库列表（文档） | P1（本地仓前置） | `SellfoxWarehouse` |
| 本地仓库存明细 | 文档：查询库存明细（文档） | P1 | `SellfoxLocalInventory` |
| 库存流水 | 文档：获取库存流水（文档） | P1 | `SellfoxInventoryFlow` |
| 库龄报表 | 文档：库龄报表列表页（文档） | P1 | `SellfoxInventoryAge` |
| 货架位 | 文档：货架位列表分页查询（文档） | P2 | `SellfoxBin` |
| 其他出入库单 | `/api/warehouseInOut/inRecords.json`、`/outRecords.json` | P2 | `SellfoxStockIoOrder` |
| 调整单 / 调拨单 / 盘点单 / 加工单 / 拆分单 | `/api/ware/adjust/create*.json` 等（写）＋ 文档：查询调整单列表、调拨单列表、盘点单列表、加工单列表、拆分单列表 | P2 | `SellfoxStockAdjust` 等 5 张 |
| 移除入库单 | 文档：移除入库单列表查询（文档） | P2 | `SellfoxRemovalOrder` |
| 装箱任务 | 文档：查询装箱任务列表（文档） | P2 | `SellfoxPackingTask` |
| 海外仓备货单 | 文档：海外仓备货单列表页 / 详情（文档） | P2 | `SellfoxOverseaStockOrder` |

### 2.6 FBA 发货与物流

| 数据集 | 接口 | 状态 | 目标表 |
|---|---|---|---|
| FBA 货件 | 文档：获取FBA货件列表 | live | `SellfoxFbaShipmentSnapshot` |
| 货件产品明细 | `/api/fbaShipment/shipmentItemList.json`、`/batchQuery/shipmentItemList.json` | P1 | `SellfoxFbaShipmentItem` |
| FBA 发货单（列表/详情/产品） | `/api/fba/shippingOrder/*` | P1 | `SellfoxFbaShippingOrder` |
| 入库计划 / 装箱 | `/api/inbound/getInboundPlan.json`、`/api/packing/task/*` | P2 | `SellfoxInboundPlan` |
| 批次入库 / 出库 / 签收 | 文档：获取批次入库数据、批次出库数据、货件签收数据（文档） | P2 | `SellfoxBatchFlow` |

### 2.7 采购

| 数据集 | 接口 | 状态 | 目标表 |
|---|---|---|---|
| 采购单 | 文档：采购单列表（文档） | P1 | `SellfoxPurchaseOrder` |
| 采购计划 | 文档：采购计划分页查询（文档） | P2 | `SellfoxPurchasePlan` |
| 采购入库单 | 文档：查询采购入库单列表（文档） | P1 | `SellfoxPurchaseReceipt` |
| 采购退货单 | 文档：查询采购退货单列表 / 详情（文档） | P2 | `SellfoxPurchaseReturn` |
| 采购变更单 | 文档：创建采购变更单（写，不接）；列表未在文档列出 | P2（待核对） | — |
| 供应商 | 文档：获取供应商列表（文档） | P1 | `SellfoxSupplier` |
| 结算方式 / 采购方 | 文档：获取所有结算方式、采购方列表（文档） | P2 | `SellfoxSettlementMethod` / `SellfoxBuyer` |
| 头程分摊 / 成本调整单 | 文档：头程分摊列表页、查询成本调整单列表（文档） | P2 | `SellfoxFirstLegAllocation` |

### 2.8 财务

| 数据集 | 接口 | 状态 | 目标表 |
|---|---|---|---|
| 结算汇总 / 明细 | `/api/financial/selectGroupPage.json`、文档：查询结算明细-分页查询（文档） | P0 | `SellfoxSettlement` / `SellfoxSettlementLine` |
| 应收报表 | 文档：获取应收报表数据（文档） | P1 | `SellfoxReceivable` |
| 发票 / 广告发票 / 分摊 | 文档：查询发票详情、查询广告发票列表-V2、查询发票分摊详情-V2（文档） | P2 | `SellfoxInvoice` |
| 付款单 / 收款单 / 请款单 / 请款池 | 文档：查询付款单列表、查询收款单列表、查询请款单列表、请款池-*（文档） | P2 | `SellfoxPaymentOrder` 等 |
| 延迟金额 / 延迟交易 / 月末延迟 | 文档：延迟金额、延迟交易、月末延迟（文档） | P2 | `SellfoxDelayAmount` |
| FBA 仓库明细 / 汇总 | `/api/finance/fbaStockDetail/pageList.json`、`/fbaWarehouseSummary/pageList.json` | P1 | `SellfoxFbaStockDetail` |
| 按日利润（ASIN/父ASIN/MSKU/SKU/SPU/开发员/业务员/店铺 8 维） | 文档：按日利润报表-*（文档） | P1 | `SellfoxProfitDaily` |
| 月利润 / 结算利润 / 利润报表（9 维 × 3 套） | `/api/financial/v2/monthProfit/*.json`、`/api/financial/v2/*`（结算利润、利润报表） | P1 | `SellfoxProfitMonthly` |

> 现有 `SellfoxProductDailySnapshot`（performance 资源）是「产品维度日利润」，与赛狐「按日利润报表」8 维同源不同粒度；月利润是**结算后口径**，三套口径必须分表存，不能互相覆盖。

### 2.9 报表与多平台

| 数据集 | 接口 | 状态 | 目标表 |
|---|---|---|---|
| 报表中心 / Amazon 原表 | `/api/report/center/*`、`/api/amazon/*` | P2 | `SellfoxReportTask`（已有） |
| Amazon 赔偿 / 盘库 / 长期仓储 / 月仓储 / 移除货件 | 文档：获取Amazon赔偿报告 等 5 个（文档） | P2 | `SellfoxAmazonFeeReport` |
| 多平台（Temu/TikTok/SHEIN/Walmart/AliExpress） | `/api/financial/cross/temu*`、各平台在线产品接口 | 授权 | — |

---

## 3. 承接页设计

### 3.1 三条原则

1. **一个数据集一个承接页**，不做「一个大页面塞所有数据」。同一业务域的多个数据集用 **tab** 承载（沿用 `/sellfox/sales` 已有 tab 形态）。
2. **页面即口径声明**。每页顶部固定三行：数据来源（赛狐 SaaS 快照 / 赛狐结算口径）、时间口径、最近成功同步 + 覆盖率（`x/39 店铺`、`日覆盖率 n/m`）。缺数据一律 `-`，不补 0、不补前值。
3. **不与 Amazon 官方数据混算**。`/operations?view=inventory|inventory_age|settlements` 读的是 Amazon SP-API 报表，`/sellfox/*` 读的是赛狐快照。两套数据**同页可对照，但不同列相加**。需要对照时给「来源对照」tab，两侧各自带来源徽标。

### 3.2 页面清单

| # | 路由 | tab（数据集） | 承接表 | 期次 |
|---|---|---|---|---|
| 1 | `/sellfox/products`（新） | 商品主数据 / 分类品牌 / 评价 | `SellfoxSkuMaster`、`SellfoxSpuMaster`、`SellfoxCategory`、`SellfoxBrand`、`SellfoxReview` | P0 |
| 2 | `/sellfox/listings`（已有） | 在线产品 / 操作日志 / 多平台配对 | `SellfoxListingSnapshot` + 新 2 表 | 增量 |
| 3 | `/sellfox/sales`（已有） | 销量统计 | `sellfox_sales_daily` | 已交付 |
| 4 | `/sellfox/performance`（已有） | 产品日利润 | `SellfoxProductDailySnapshot` | 已交付 |
| 5 | `/sellfox/profit`（新） | 按日利润（8 维）/ 月利润（9 维）/ 结算利润 | `SellfoxProfitDaily`、`SellfoxProfitMonthly` | P1 |
| 6 | `/sellfox/orders`（已有） | 订单列表 / 订单明细 / 退货 | `SellfoxOrderSnapshot` + `SellfoxOrderDetail`、`SellfoxReturnReport` | P0 |
| 7 | `/sellfox/ads`（新） | 六类日报 / 管理实体树 / 小时曲线 / ABA | 6 张 `SellfoxAds*Daily` + `SellfoxAdsEntity` + `SellfoxHourlyMetric` + `SellfoxAbaSearchTerm` | P1 |
| 8 | `/sellfox/inventory`（新） | FBA 库存 / 本地仓 / 流水 / 库龄 | `SellfoxFbaInventorySnapshot`、`SellfoxLocalInventory`、`SellfoxInventoryFlow`、`SellfoxInventoryAge` | P1 |
| 9 | `/sellfox/purchase`（新） | 采购单 / 入库单 / 计划 / 供应商 | `SellfoxPurchaseOrder`、`SellfoxPurchaseReceipt`、`SellfoxPurchasePlan`、`SellfoxSupplier` | P1 |
| 10 | `/sellfox/shipments`（已有） | 货件 / 货件产品 / 发货单 | `SellfoxFbaShipmentSnapshot` + `SellfoxFbaShipmentItem`、`SellfoxFbaShippingOrder` | P1 |
| 11 | `/sellfox/finance`（新） | 结算 / 应收 / 发票 / 资金单据 | `SellfoxSettlement*`、`SellfoxReceivable`、`SellfoxInvoice`、`SellfoxPaymentOrder` | P0（结算）/ P1（其余） |
| 12 | `/sellfox/stock-ops`（新） | 出入库 / 调整 / 调拨 / 盘点 / 加工 / 拆分 | `SellfoxStockIoOrder` 等 | P2 |
| 13 | `/sellfox/sync`（新） | 同步编排：资源 × 店铺 × 期间、断点、错误重试、覆盖率 | `SellfoxSyncRun`、`SellfoxSyncShard`、`SellfoxCoverage` | P0 |
| 14 | `/sellfox`（已有） | 数据总览 + 全量规划表 | `data-plan.ts` | 维护 |

### 3.3 统一页面骨架（所有新页面复用）

```
┌ 标题 + 来源徽标（赛狐快照｜结算口径）+ 最近同步时间 + 覆盖率 x/39 店铺
├ 工具条：维度/指标 · 站点 · 店铺 · 日期区间 · 搜索（ASIN/MSKU/SKU/单号）· 筛选 chips
├ 右侧动作：自定义列 · 刷新 · 导出 CSV（当前页）· 同步（需 sellfox:sync 权限）
├ 表格：服务端分页 20/50/100 · sticky 首列与表头 · 数字右对齐 tabular-nums · 缺失 = "-"
├ tfoot 汇总（仅可加总的指标；金额按币种分列）
└ 行点击 → 右侧抽屉：关键字段 + 原始 payload（折叠）+ runId / capturedAt
```

实现路径（沿用现有基建，不新造轮子）：
- 列表页：`ReplicaWorkbench` + `replica-pages.ts` 定义（`query: "workbench"` 或 `"snapshot"`）。
- 读取：`/api/sellfox/[domain]` 增加 domain + `readSellfoxWorkbench` 或 `agent-read` 的只读分支。
- 权限：统一 `requireApiPermission("sellfox", "view")`；同步动作另加 `sellfox:sync`。
- 空态区分「未同步」与「已同步无数据」，前者直接给同步入口。

### 3.4 导航挂载（`business-navigation.ts`）

| 分组 | 新增条目 |
|---|---|
| 商品管理 | `Sellfox 商品主数据` → `/sellfox/products` |
| 销售管理 | `Sellfox 销量统计` → `/sellfox/sales`、`Sellfox 利润报表` → `/sellfox/profit` |
| 广告管理 | `Sellfox 广告` → `/sellfox/ads` |
| 采购管理 | `Sellfox 采购` → `/sellfox/purchase` |
| 仓库管理 | `Sellfox 库存` → `/sellfox/inventory`、`Sellfox 出入库` → `/sellfox/stock-ops` |
| 物流发货 | （已有货件快照） |
| 财务管理 | `Sellfox 结算` → `/sellfox/finance` |
| 数据中心 | `Sellfox 数据` → `/sellfox`（已有）、`Sellfox 同步` → `/sellfox/sync` |

全部沿用 `moduleId: "sellfox"`，权限过滤自动生效。

### 3.5 与现有 `/operations` 模块的重叠处理

`/operations?view=*` 读的是 Amazon SP-API 报表与 WMS 本地台账，和赛狐快照是**不同来源**。重叠数据集按下表处理，绝不合并成一列：

| 数据集 | 现有承接方（来源） | 赛狐承接方（来源） | 决策 |
|---|---|---|---|
| FBA 库存 | `/operations?view=inventory`（Amazon 库存快照） | `/sellfox/inventory`（赛狐快照） | 各自独立页；差异用「来源对照」tab 并列，不相减 |
| 库龄 | `/operations?view=inventory_age`（Amazon 库龄报告） | `/sellfox/inventory`（赛狐库龄） | 同上；赛狐库龄只做参考，不覆盖 Amazon 口径 |
| 结算 | `/operations?view=settlements`（Amazon 结算报告） | `/sellfox/finance`（赛狐结算） | 赛狐侧用于对齐赛狐后台，Amazon 侧用于财务入账 |
| 退货 | `/operations?view=returns`（Amazon 退货报告） | `/sellfox/orders`（赛狐退货 tab） | 赛狐含 FBM，Amazon 侧没有；两边都保留 |
| 订单 | `/operations?view=orders`（Amazon 订单） | `/sellfox/orders`（赛狐订单快照） | 赛狐订单是行级 + 费用项，用于利润复算 |
| 商品主数据 | `/dashboard`（ProductRecord 主档） | `/sellfox/products`（赛狐 SKU/SPU） | **ProductRecord 仍是唯一主档**；赛狐只提供成本/开发员等字段的来源证据 |
| 采购/供应商 | `/operations?view=purchase-orders|suppliers`（本地 ERP） | `/sellfox/purchase`（赛狐采购单） | 本地为主，赛狐为辅；只读对照，不回写本地单 |

一句话：**赛狐数据是「对账与复算」的证据链，不是新的主档**。任何页面都不允许把赛狐数值直接写回 `ProductRecord`、WMS 库存或财务台账。

---

## 4. 全量同步编排

### 4.1 限流：从全局串行改为按接口桶

赛狐限的是**每个接口 1 req/s**，不是全局。原实现 `pg_advisory_lock('sellfox-open-api-global-rate-limit') + 1.2s` 把并发压成 1。

**已实现（2026-11-14）**：`client.ts` 改为按 path 的进程内队列 + `pg_try_advisory_lock(sellfox-rate:<path>)`，同一 path 严格 ≥1.1s，不同 path 并行；`SELLFOX_RATE_LIMIT_MODE=global` 可退回旧的全局串行。下表的分桶表方案作为「跨进程精确记账」的后续优化，暂不需要。

改造：`sellfox_api_bucket(path)` 表存 `last_at`，发送前
`SELECT pg_advisory_xact_lock(hashtextextended(path,0))` → 计算 `wait = last_at + 1100ms - now()` → `pg_sleep(wait)` → 更新 `last_at`。
不同 path 互不阻塞，理论吞吐 = 接口数 × 0.9 rps；同接口仍严格 ≥1.1s。

同时保留：`40019 / 40012 / HTTP 429/5xx` 重试（已有），每次重试重新排队。

### 4.2 四类节奏

| 类型 | 数据集 | 触发 | 窗口 |
|---|---|---|---|
| 主数据 | 店铺、子账号、汇率、SKU、SPU、分类、品牌、属性、仓库、货架位、供应商、结算方式 | 每日 03:00 全量 | 全表 upsert，按 `updatedAt` 优先 |
| 日事实 | 销量、利润、FBA 库存、广告六类、小时 | 每日 06:00 | T-7 ~ T-1 滚动重跑（覆盖迟到数据） |
| 单据 | 订单、订单明细、退货、货件、货件产品、发货单、采购单、入库单、出入库、调整、调拨 | 每 15 分钟 | 增量：按 `updateTime` 往前 2 小时，重叠 1 小时幂等 |
| 月财务 | 结算、应收、发票、资金单据、月利润、按日利润 | 每日 07:00 + 月结后补跑 | 当月 + 上月，结算数据按 `settleTime` |

首跑（冷启动）顺序固定：**店铺 → 汇率/子账号 → 分类/品牌/属性 → SKU/SPU → Listing → 订单 → 订单明细 → 退货 → FBA 库存 → 仓库 → 本地库存/流水/库龄 → 货件/货件产品/发货单 → 采购/供应商/入库 → 结算/应收 → 日利润 → 月利润 → 广告报表 → 广告实体 → ABA**。

理由：后置数据集的外键（storeId、sku、orderId）必须先存在，否则只能存裸串，后续补 join 要全表回刷。

### 4.3 分片、断点、幂等、覆盖度

- **分片**：`SellfoxSyncShard(resource, scopeKey, period, cursor, status, attempts, nextRetryAt)`。
  `scopeKey` 规则：店铺维度 `store:<externalId>`；日事实 `store:<externalId>|<date>`；月财务 `store:<externalId>|<yyyy-mm>`；主数据 `all`。
- **断点**：沿用 `OrderCheckpoint` 模式，把 checkpoint 从 run.summary 提到 shard 表，进程重启从 `cursor` 续跑。
- **幂等**：业务键 hash（现有 `lineId()` 模式）作主键，`upsert`；同一天重复跑必须零新增。
- **覆盖度**：把 `SellfoxSalesDayCoverage` 泛化为 `SellfoxCoverage(resource, storeId, period, rowCount, complete, runId)`。
  页面顶部覆盖率 = `count(complete=true) / count(*)`，缺格直接显示在 `/sellfox/sync`。
- **失败隔离**：单店失败不影响其他店（现有 `sellfoxStoreFailure` 模式），失败进重试队列，指数退避 1m/5m/30m，3 次后标红。

### 4.4 请求预算（按当前库量级估算，1.1s/请求/接口）

| 数据集 | 请求数估算 | 单接口串行耗时 |
|---|---|---|
| 订单全量（37,856 行 ÷ 100） | ~380 | ~7 分钟 |
| 订单明细（按订单数，1 单 1 次批量 100 单） | ~380 | ~7 分钟 |
| FBA 库存（39 店 × 每日 1 页） | 39/天 | ~1 分钟/天 |
| Listing（49,162 ÷ 100） | ~492 | ~9 分钟 |
| 广告六类（39 店 × 天数 × 6） | 234/天 | 4.3 分钟/天（6 接口并行 ≈ 1 分钟） |
| 结算明细（月，按店铺） | 39/月 | ~1 分钟/月 |

结论：**全量首跑按接口并行后是「小时级」，全局串行会变成「天级」**，这是 4.1 必须改的原因。

---

## 5. 新增数据模型（命名与主键约定）

统一字段：`id`（hash 主键）、`organizationId`、`workspaceId`、`storeId`、`capturedAt`、`reportDate|periodMonth`（按需）、`raw`（jsonb 原始行）、唯一键 `(organizationId, workspaceId, storeId, <业务键>)`。

| 表 | 业务键 |
|---|---|
| `SellfoxSkuMaster` | `sku` |
| `SellfoxSpuMaster` | `spu` |
| `SellfoxCategory` / `SellfoxBrand` / `SellfoxAttribute` | `externalId` |
| `SellfoxReview` | `reviewId` |
| `SellfoxOrderDetail` | `sellerOrderId + lineKey` |
| `SellfoxReturnReport` | `returnId + lineKey` |
| `SellfoxAdsEntity` | `adType + level + entityId` |
| `SellfoxAbaSearchTerm` | `reportDate + searchTerm + asin` |
| `SellfoxWarehouse` / `SellfoxBin` | `externalId`（bin 含 warehouseId） |
| `SellfoxLocalInventory` | `warehouseId + sku` |
| `SellfoxInventoryFlow` / `SellfoxInventoryAge` | `flowId` / `reportDate + sku + warehouseId` |
| `SellfoxStockIoOrder` 等 6 张 | 单据号 + 行号 |
| `SellfoxFbaShipmentItem` | `shipmentId + sellerSku + fnsku` |
| `SellfoxFbaShippingOrder` | `shipSn` |
| `SellfoxPurchaseOrder` / `SellfoxPurchaseReceipt` | 采购单号 / 入库单号 + 行号 |
| `SellfoxSupplier` | `supplierId` |
| `SellfoxSettlement` / `SellfoxSettlementLine` | `settlementId` / `settlementId + lineId` |
| `SellfoxReceivable` / `SellfoxInvoice` / `SellfoxPaymentOrder` | 单据号 |
| `SellfoxProfitDaily` / `SellfoxProfitMonthly` | `period + dimension + dimensionKey + currency` |
| `SellfoxExchangeRate` | `currency + rateDate` |
| `SellfoxCoverage` / `SellfoxSyncShard` | `(resource, storeId, period)` / `(resource, scopeKey, period)` |

估算：约 30 张新表。按域分批迁移，不一次性上。

---

## 6. 分期与验收

### P0（把「能算账」的底座补齐）

已完成：限流按接口 path 改造、`/sellfox/sync` 编排页、7 个承接页骨架。

剩余 P0：
已完成：`SellfoxSyncShard` 分片表 + `SellfoxCoverage` 覆盖表（migration 已应用，历史 run 已回填；覆盖度按事实表重算，13 个资源对账一致）。

剩余 P0：
1. 汇率（多币种汇总前置）。
2. SKU / SPU 主数据同步器（`/sellfox/products` 已就位，等数据）。
3. 订单详情（批量）+ 退货报告 + `/sellfox/orders` 增 tab。
4. 结算汇总/明细 + `/sellfox/finance` 结算 tab。

验收：每个数据集抽 3 个店铺 × 3 天/月，页面合计 = 接口原始合计（逐字段比对），重复跑零新增，覆盖率 100%，页面无 pageerror。

### P1

广告管理实体（SP/SB/SD）+ `/sellfox/ads`；本地仓库存/流水/库龄 + `/sellfox/inventory`；货件产品 + 发货单；采购单/入库单/供应商 + `/sellfox/purchase`；应收/发票 + `/sellfox/finance` 增 tab；按日利润 8 维 + 月利润 9 维 + `/sellfox/profit`；评价明细；ABA。

### P2

出入库/调整/调拨/盘点/加工/拆分、货架位、装箱任务、海外仓备货、批次收发、采购计划/退货/变更、资金单据、延迟金额、Amazon 各类费用报告、报表中心。多平台（Temu/TikTok/SHEIN/Walmart/AliExpress）标记 `授权`，无店铺授权前不做。

---

## 7. 风险与明确不做

| 风险 | 处理 |
|---|---|
| 本地文档只有 103/316 个接口 | P0/P1 涉及但缺文档的接口（查询SKU、订单列表、销量数据、结算明细等）需补抓或联调核对字段后再写解析器，**不猜字段** |
| 赛狐接口字段随版本变动 | 解析器一律「未知字段进 `raw`，已知字段强类型」，解析失败该行进失败表，不静默丢 |
| 广告 XLSX 解析口径 | 沿用现有 provisional 契约，报表类型新增时先小样本对账再全量 |
| 与 Amazon 官方数据重复 | 同一指标双源并存时，页面加来源徽标，禁止同列相加；以「赛狐口径」或「Amazon 口径」显式标注 |
| 全量历史回补量大 | 默认最近 2 年；更早数据只在用户显式指定区间时回补，不默认全历史 |
| 写接口 | 不接。赛狐侧增删改仍需在赛狐后台操作，ERP 只读 |
