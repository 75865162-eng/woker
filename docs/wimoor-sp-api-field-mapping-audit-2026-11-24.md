# Wimoor ↔ 本项目 ↔ SP-API 字段级映射核对表

> 版本：v1.0（静态映射层）｜取证时间：2026-11-24（Asia/Shanghai）
> 仓库：`75865162-eng/woker`，HEAD `af8f453a`；Wimoor 快照 `ec86736b`（2026-09-24 main）

## 0. 两层核对结论（先读）

### 0.1 本次已完成的层级

本表完成**静态三层映射核对**，链路为：

```
Wimoor 页面列（label + prop）  →  本项目 Prisma 模型.字段  →  SP-API 报告/API 元素
```

- Wimoor 列名与 prop：取自其 `table.vue` / `index.vue` 中 `el-table-column` 的实证声明。
- 本项目模型字段：取自 `prisma/schema.prisma` 实证字段名，未推测未声明的列。
- SP-API 侧：取自本项目同步契约（`src/data/amazon-contracts/*.json`）、报告解析器（`src/lib/amazon-sync/*`）与已登记的报告类型清单。

### 0.2 本次未完成、必须后置的层级

**取值级核对**（同一 SKU / 订单号 / 业务日期下，三端数值逐格比对：源报告值 → 落库值 → 页面展示值）**尚未执行**，原因与前置条件见 §6。

> 约束：本地库尚未完成迁移部署、未灌入业务数据；本轮未连接数据库取数。本表所有结论基于代码与模型实证，不包含任何线上取值实测。标注 `⏳` 的条目必须在库迁移完成、数据跑通后复验。

### 0.3 状态图例

| 标记 | 含义 |
|---|---|
| ✅ | 本项目模型有显式列，且 SP-API 源已接入解析链路 |
| 🟡 | 模型有列，但源字段落在 `Json` 透传列、或需主档/实体表 join、或属派生汇总尚未落库 |
| 🔴 | Wimoor 有该列，本项目模型无对应显式列（字段缺口） |
| ⚪ | Wimoor 派生指标列（由基础列计算得出，非源字段），核对重点是公式口径 |
| ⏳ | 静态映射已给出，取值一致性待迁移跑通后核验 |

---

## 1. 证据来源

| 侧 | 文件/路径 | 用途 |
|---|---|---|
| 本项目模型 | `repo/prisma/schema.prisma` | 显式列名、类型、Json 透传列识别 |
| 本项目同步契约 | `repo/src/data/amazon-contracts/*.json` | SP-API 报告/接口元素结构 |
| 本项目解析器 | `repo/src/lib/amazon-sync/`（orders / finance / settlement / inventory / returns / sales-traffic / catalog / ads 各模块） | 报告类型、元素键到模型列的写入映射 |
| Wimoor 页面 | `wimoor/wimoor-ui/src/views/amazon/**` 各 `table.vue` / `index.vue` | 列名（label）与绑定字段（prop） |
| 前序文档 | `wimoor-strategic-field-upgrade-guide.md`、`wimoor-per-page-upgrade-plan.md` | 页面覆盖矩阵与分期计划（本表不重复其内容） |

---

## 2. 报告类型 ↔ 模型总览

| 业务域 | Wimoor 页面 | SP-API 来源（报告类型 / API） | 本项目落库模型 | 接入状态 |
|---|---|---|---|---|
| 商品 Listing | `listing/products` | Catalog Items 2022-04-01；`GET_MERCHANT_LISTINGS_ALL_DATA` | `ProductListing`、`ProductMaster`、`ProductVariant`、`ProductCost`、`ProductMedia`、`AmazonCatalogSnapshot` | 🟡 主档/价格/库存已建，标题与属性部分在 Json |
| 订单 | `order/order_manager` | Orders API v0（Orders / OrderItem） | `AmazonOrderRecord`、`AmazonOrderItemRecord`、`AmazonOrderDetailWork` | 🟡 订单头与行主字段已建，税费/折扣/运费未分列 |
| 退货 | `order/refund` | `GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE`；`GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA`；`GET_FBA_MFN_RETURNS` | `AmazonReturnRecord`、`AmazonReturnReason` | 🟡 数量/原因/处置已建，留言/追踪号/退款金额/购买日期缺列 |
| 库存明细 | `inventory/fba/detail` | `GET_AFN_INVENTORY_DATA`、`GET_FBA_MYI_ALL_INVENTORY_DATA` | `AmazonInventorySnapshot` | 🟡 七项数量已建，仓中心/分站点/策略周期缺列 |
| 库存规划 | `inventory/planning` | `GET_FBA_INVENTORY_PLANNING_DATA` | （无对应规划快照模型；部分见 `AmazonInventorySnapshot`） | 🔴 周转/库龄/近 7·30·60·90 天动销/冗余/附加费指标未落库 |
| 结算分摊 | `payment/settlement_sku`、`payment/costSharing` | `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2` | `AmazonSettlementReport`、`AmazonSettlementRow`、`AmazonSettlementAllocation`、`AmazonSettlementAllocationLine` | 🟡 8 类费用池分摊已建模，SKU 级汇总与税费/关税/汇率损耗缺列 |
| 财务流水 | 财务工作台 | `GET_LEDGER_DETAIL_VIEW_DATA` | `AmazonFinanceRecord`、`AmazonFinanceQuarantine` | 🟡 金额/币种/折算/隔离已建，明细要素部分在源行 |
| 利润 | `payment/profitReport/child` | 结算 + 订单 + 库存 + 广告 + 采购成本汇总派生 | （无利润汇总模型；输入分散在上述各表） | 🔴 利润/利润率为派生层，口径待拍板后建汇总表 |
| 流量浏览 | `report/pageview` | `GET_SALES_AND_TRAFFIC_REPORT` | `AmazonSalesTrafficSnapshot`、`AmazonSalesTrafficProductSnapshot` | 🟡 会话/浏览/销量/销售额已存 Json，转化率/购物车比例未存 |
| 广告 | `advertisement/manager`（SP/SD/HSA） | Advertising API 报告（campaign/adgroup/keyword/target/query/productAds） | `AmazonAdsReportFact`、`AmazonAdsEntityRecord` | 🟡 曝光/点击/花费/订单/销售额/销量已建，分归因窗口与同 SKU/跨 SKU 转化未分列 |
| 品牌分析 | Brand Analytics 各报告 | `GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT` 等 5 类 | `AmazonSalesTrafficProductSnapshot` 之外另有品牌分析采集链路（见 `brand-*` 模块） | 🟡 契约 JSON 已就位，落库列以 `brand-*` 模块为准，本轮未逐列展开 |
| 费用/补偿/移除 | 库存费用、补偿、移除、滞留、预留、超量、费用预估 | 见 `inventory-report-contracts.ts` 9 类报告 | `AmazonSyncReportRow`（`fields` Json 保留原件） | 🟡 原件保留，多数未提升为显式列 |

---

## 3. 逐页字段级映射

### 3.1 商品 Listing — `listing/products`

| Wimoor 列名 | Wimoor prop | 本项目模型.字段 | SP-API 来源（元素） | 状态 | 差距 / 核验动作 |
|---|---|---|---|---|---|
| 图片 | （槽位，image） | `ProductMedia.url/thumbUrl/originalUrl`；`AmazonCatalogImageReference` | Catalog `mainImage.link`；listings 报告 `image-url` | 🟡 ⏳ | 按 ASIN 回查主图；HEAD `af8f453a` 已接入图片源，迁移后核对空图兜底 |
| 产品信息 | name | `ProductListing.title/sku/asin`；`ProductMaster.chineseName/englishName/brand`；`AmazonCatalogSnapshot.sellerSku/asin` | `ItemSummaryByMarketplace.itemName/asin`；listings `item-name` | 🟡 ⏳ | 标题主档 join；核对多语言标题取值来源 |
| 售价 | `price` | `ProductListing.price`、`ProductListing.currency` | listings `your-price` / `price`；Catalog 报价 | ✅ ⏳ | 核对价格币种与精度（Decimal 20,4） |
| 类型 | `ptype` | `ProductVariant.attributes`(Json)；`AmazonCatalogSnapshot.listingAttributes`(Json) | `ItemSummaryByMarketplace.productType` | 🟡 🔴 | 产品类型未提升为显式列；如筛选/分组需要再提列 |
| 价格 | `landedAmount` | 无 | 派生（售价 + 税费/头程等，口径未确认） | 🔴 ⚪ | 属派生列；口径见 §6 待拍板项，确认前不得默认展示 |
| listing价格 | `listingAmount` | `ProductListing.price`（待核是否同一口径） | listings 价格类元素 | 🟡 ⏳ | 核对与 `price` 是否重复列；若为市场价/划线价需另列 |
| 运费 | `shippingAmount` | 无显式列；订单行层面亦无运费列 | Orders `ShippingPrice`；listings 运费模板 | 🔴 | 若页面需展示运费，需在订单行或主档补列；SP 元素取值待契约复核 |
| 销售数据 | （组合槽位） | 销售/广告汇总（汇总层未建） | 销售报告 + 广告报告 | 🔴 🟡 | 依赖销售日/周/月汇总层，见战略指南 §5 P0 |
| 国家 | `country` | `ProductListing.marketplaceId` → `Marketplace` | 报告 `marketplace-id` | ✅ ⏳ | 维度存在，核对站点映射表完整性 |
| 库存数量 | `quantity` | `ProductListing.inventory`；`AmazonInventorySnapshot.fulfillableQuantity` | 库存报告可售数量 | ✅ ⏳ | 两处库存口径（主档快照 vs 实时库存）需统一来源 |
| 备注 | `remark` | 无 | 本地人工备注（非 SP-API 字段） | 🔴 | 若需人工备注，建本地备注表，不进同步覆盖范围 |
| 操作 | `operate` | — | — | — | UI 动作列，非数据字段，不参与字段核对 |

### 3.2 订单 — `order/order_manager`

| Wimoor 列名 | Wimoor prop | 本项目模型.字段 | SP-API 来源（Orders API v0） | 状态 | 差距 / 核验动作 |
|---|---|---|---|---|---|
| 图片 | `image` | 按 ASIN 关联 `ProductMedia` | Catalog `mainImage.link` | 🟡 ⏳ | 同 3.1 图片核对 |
| 商品信息 | `name` | `AmazonOrderItemRecord.asin/sellerSku`；标题经主档 join | OrderItem `Title`、`ASIN`、`SellerSKU` | 🟡 ⏳ | 行标题未持久化，join 主档后核对 |
| 订单号 | `orderid` | `AmazonOrderRecord.amazonOrderId` | `AmazonOrderId` | ✅ ⏳ | 订单身份键，核对唯一性与去重 |
| 订单总金额 | `orderprice` | `AmazonOrderRecord.grandTotalAmount` / `grandTotalOriginal` / `currencyCode` | `OrderTotal.Amount` / `OrderTotal.CurrencyCode` | ✅ ⏳ | 核对订单头总额与行金额合计是否相等；原币/折算双值口径 |
| 数量/单价 | `quantity` | `AmazonOrderItemRecord.quantityOrdered`、`proceedsAmount`、`proceedsOriginal` | OrderItem `QuantityOrdered`、`ItemPrice` | ✅ 🔴 | 数量/金额已建；`ItemTax`、`ShippingTax`、`PromotionDiscount`、`ShippingPrice`、`GiftWrapPrice`、`PointsGranted`、`ConditionNote` 未分列 |
| 订购时间 | `buydate` | `AmazonOrderRecord.createdTime`（另有 `sourceUpdatedAt`） | `PurchaseDate` / `LastUpdateDate` | ✅ ⏳ | 时区：`marketplaceTimeZone` 已存，核对展示时区 |
| 发票上传 | `feedstatus` | 无 | Feed/发票回传状态（非 Orders 接口直出） | 🔴 | 需独立 Feed 状态模型；当前链路未覆盖 |
| 邀评状态 | `feedstatus` | 无 | 非 SP-API 直出 | 🔴 | 本地状态机/外部记录，当前未建模 |
| 备注 | `remark` | 无 | 本地备注 | 🔴 | 同 3.1 |
| 操作 | `operate` | — | — | — | UI 动作列 |

> 订单行已存字段实证：`orderItemId / asin / sellerSku / quantityOrdered / proceedsOriginal / proceedsAmount / currencyCode`（共 7 个业务列）。税费、折扣、运费、礼品包装、积分、商品状况均未在订单行模型落列。

### 3.3 退货 — `order/refund`

| Wimoor 列名 | Wimoor prop | 本项目模型.字段 | SP-API 来源（退货报告元素） | 状态 | 差距 / 核验动作 |
|---|---|---|---|---|---|
| 站点 | `groupname` | `AmazonReturnRecord.marketplaceId` | `marketplace` | ✅ ⏳ | 站点映射核对 |
| 订单号 | `orderId` | `AmazonReturnRecord.amazonOrderId` | `amazon-order-id` | ✅ ⏳ | 身份键核对 |
| 图片 | `image` | 按 ASIN 关联主档图 | Catalog 主图 | 🟡 ⏳ | 同前 |
| 商品信息 | `name` | `sellerSku / asin / fnsku`；标题 join 主档 | `sku`、`asin`、`fnsku`、`product-name` | 🟡 ⏳ | 标题未持久化 |
| 购买时间 | `purchaseDate` | 无显式列（仅 `returnAt`） | `purchase-date` | 🔴 | 报告元素存在，模型缺列；需确认是否纳入订单头联查 |
| 退款时间 | `returnDate` | `AmazonReturnRecord.returnAt` | `return-date` | ✅ ⏳ | 时区口径核对 |
| 退货数量 | `quantity` | `AmazonReturnRecord.quantity` | `quantity` | ✅ ⏳ | 数值类型 Int，核对负号/退仓口径 |
| 退货金额 | `itemPrice` | 无显式列（退款金额可由财务/结算退款行回补） | `refunded-amount` | 🔴 | 模型未存行级退款金额；核对是否从 `AmazonFinanceRecord` / 结算行派生 |
| 商品状况 | `detailedDispositionName` | `AmazonReturnRecord.disposition` | `detailed-disposition-name`、`disposition` | 🟡 ⏳ | 存原始枚举码；中文译名为字典层，需补字典映射 |
| 退货原因 | `reasonname` | `AmazonReturnRecord.reasonId` → `AmazonReturnReason.code` | `reason-code`、`reason-description` | 🟡 ⏳ | 仅存原因码，描述/中文名未存；`reasonDescription` 取值待复核 |
| 退货留言 | `customerComments` | 无 | `customer-comments` | 🔴 | 模型缺列；注意 PII 可取范围（见 §6 待拍板项） |
| 追踪编号 | `licensePlateNumber` | 无 | `license-plate-number` | 🔴 | 模型缺列 |

### 3.4 库存明细 — `inventory/fba/detail`

| Wimoor 列名 | Wimoor prop | 本项目模型.字段 | SP-API 来源（库存报告元素） | 状态 | 差距 / 核验动作 |
|---|---|---|---|---|---|
| 产品信息 | `name` | `AmazonInventorySnapshot.sellerSku/asin/fnSku`；标题 join 主档 | `sku`、`fnsku`、`asin` | 🟡 ⏳ | 同前 |
| 仓库 | `warehouse` | 无仓中心列 | `fulfillment-center-id` | 🔴 | 模型缺仓中心维度 |
| 库存 | `afnWarehouseQuantity` | 无合计列（七项数量求和派生） | — | ⚪ | 派生合计；核对求和口径是否含 reserved/unfulfillable |
| 可售库存 | `afnFulfillableQuantity` | `fulfillableQuantity` | `afn-fulfillable-quantity` | ✅ ⏳ | 数值核对 |
| 预留库存 | `afnReservedQuantity` | `reservedQuantity` | `reserved_qty` / reserved 报告 | ✅ ⏳ | 数值核对 |
| 正在发货 | `afnInboundWorkingQuantity` | `inboundWorkingQuantity` | `inbound-working` 类元素 | ✅ ⏳ | 元素名以报告头为准，契约复核 |
| 待接收 | `afnInboundShippedQuantity` | `inboundShippedQuantity` | `inbound-shipped` 类元素 | ✅ ⏳ | 同上 |
| 正在接收 | `afnInboundReceivingQuantity` | `inboundReceivingQuantity` | `inbound-receiving` 类元素 | ✅ ⏳ | 同上 |
| 不可用 | `afnUnsellableQuantity` | `unfulfillableQuantity` | `unsellable` 类元素 | ✅ ⏳ | 同上 |
| 异常 | `afnResearchingQuantity` | `researchingQuantity` | `researching` 类元素 | ✅ ⏳ | 同上 |
| 安全库存周期 | `stockingCycle` | 无（本地策略见 `AmazonReplenishmentPolicy`，待核关联） | 非 SP-API 直出 | 🔴 | 本地补货策略字段；需与补货策略模型对齐 |
| 最小发货周期 | `minCycle` | 无 | 非 SP-API 直出 | 🔴 | 同上 |
| 头程运输成本 | `firstLegCharges` | 无直接列；候选 `ProductCost` / `WmsCostEntry` 关联 | 非库存报告元素 | 🔴 | 成本来源模型待确认后 join |
| 分站点（GB/DE/FR/IT/ES/PL） | 国家代码作列 | 无分站点库存维度 | `GET_AFN_INVENTORY_DATA_BY_COUNTRY`：`country`、`quantity-for-local-fulfillment` | 🔴 | 现模型为单站点快照；分站点需扩维度或建按国汇总表 |

### 3.5 库存规划 — `inventory/planning`

> 本页 Wimoor 共 53 列，除基础身份与可售量外，绝大多数为规划/周转/库龄/动销指标。本项目当前无规划快照模型，下列指标均为缺口；SP 源报告为 `GET_FBA_INVENTORY_PLANNING_DATA`，元素名以该报告表头为准，落地前需对照真实报告头复核。

| Wimoor 列名 | Wimoor prop | 本项目现状 | 状态 | 差距 / 核验动作 |
|---|---|---|---|---|
| 图片 / 商品信息 / 站点信息 | `image/name` | 同 3.1 / 3.4 主档链路 | 🟡 | 主档 join 后核对 |
| 采购成本 | `purchasecost` | `ProductCost.amount/currency`（采购类成本） | 🟡 🔴 | 需按 SKU/日期 join；成本取数源见 §6 待拍板项 |
| 可用库存 | `available` | `fulfillableQuantity` | ✅ ⏳ | 与规划报告 `available` 口径核对 |
| 持续供货 | `sellThrough` | 无 | 🔴 | 规划报告 sell-through 指标，需新快照列 |
| 库存健康状况 | `fbaInventoryLevelHealthStatus` | 无 | 🔴 | 规划报告健康状态枚举 |
| 历史供货天数 | `historicalDaysOfSupply` | 无 | 🔴 | 规划报告指标 |
| 低库存水平量 | `fbaMinimumInventoryLevel` | 无 | 🔴 | 规划报告指标 |
| 周转数量 30/90 天 | `weeksOfCoverT30` / `T90` | 无 | 🔴 | 覆盖周数指标 |
| 滞销费用 | `estimatedLtsfNextCharge` | 无 | 🔴 | 长期仓储费预估 |
| 下月仓储费 | `estimatedStorageCostNextMonth` | 无 | 🔴 | 仓储费预估 |
| 库龄数量(单位:天)-季度视角（分组表头） | — | 无 | 🔴 | 分组列，下辖下列 5 个季度桶 |
| 0-90 / ≤180 / ≤270 / ≤365 / 365+（季度桶） | `invAge0To90Days … invAge365PlusDays` | 无 | 🔴 | 5 个库龄桶 |
| 库龄数量-30(单位:天)-月度视角（分组表头） | — | 无 | 🔴 | 分组列，下辖下列 5 个月度桶 |
| 0-30 / ≤60 / ≤90 / 181-330 / ≤365（月度桶） | `invAge0To30Days … invAge331To365Days` | 无 | 🔴 | 5 个库龄桶 |
| 销售额(站点币种)（分组表头） | — | 无 | 🔴 | 分组列，下辖下列 4 个销售额周期 |
| 销售额 7天 / 30天 / 60天 / 90天 | `salesShippedLast7/30/60/90Days` | 无（销售汇总层未建） | 🔴 | 依赖销售汇总 + 规划报告双源核对 |
| 最近发货(单位:天)（分组表头） | — | 无 | 🔴 | 分组列，下辖下列 4 个发货量周期 |
| 发货量 7天 / 30天 / 60天 / 90天（7 / 30 / 60 / 90） | `unitsShippedT7/T30/T60/T90` | 无 | 🔴 | 规划报告 units shipped 指标 |
| 冗余库存 | `estimatedExcessQuantity` | 无 | 🔴 | 规划报告冗余量 |
| 龄库存附加费数量（分组：180-210 / ≤240 / ≤270 / ≤300 / ≤330 / 365+） | `quantityToBeChargedAis181T210 … 365PlusDays` | 无 | 🔴 | 6 个 AIS 数量桶 |
| 超龄库存附加费（分组：181-210 / ≤240 / ≤270 / ≤300 / ≤330 / 365+） | `estimatedAis181T210 … 365PlusDays` | 无 | 🔴 | 6 个 AIS 金额桶 |

### 3.6 结算 SKU — `payment/settlement_sku`

| Wimoor 列名 | Wimoor prop | 本项目模型.字段 | SP-API 来源（结算报告元素） | 状态 | 差距 / 核验动作 |
|---|---|---|---|---|---|
| 商品信息 | `sku` | `AmazonSettlementAllocationLine.sku/sellerSku`；源行 `AmazonSettlementRow.sellerSku/asin` | 结算行 `sku`、`asin` | ✅ ⏳ | 分摊行身份键核对 |
| 销售额 | `principal` | 分摊行本金；源行 `transactionType/amountType/amountDescription` 判为 `SKU_PRINCIPAL` | `Product Fees` 类本金行（Principal/ItemPrice） | 🟡 ⏳ | 本金口径：退款行不冲减 principal（去重规则见 `settlement-fee-classification.ts`） |
| 销量 | `salenum` | 无行级销量汇总；候选订单行派生 | 订单报告/订单 API | 🔴 | 需销售汇总层按 SKU 派生 |
| 订单量 | `ordernum` | 无 | 订单去重计数 | 🔴 | 同上；去重口径 `COUNT(DISTINCT order-id)` |
| 平均售价 | `avgprice` | 无 | 派生（principal / 销量） | ⚪ 🔴 | 派生列，公式口径待确认 |
| 退款数量 | `refundsales` | 无显式汇总；源行 `SKU_REFUND` | 退款类结算行 | 🔴 🟡 | 分类规则已实现，SKU 级计数待汇总层 |
| 退款金额 | `refund` | 无显式汇总；源行退款金额 | 退款类结算行金额 | 🔴 🟡 | 同上 |
| 退款率 | `refundrate` | 无 | 派生（退款量 / 销量） | ⚪ 🔴 | 派生列 |
| FBA费用 | `fbafee` | 费用池 `share*` 分摊；源行分类见规则表 | `FBA Inventory Reimbursement`、FBA 费类行 | 🟡 ⏳ | 核对费用池归类优先级与 8 池映射 |
| 销售佣金 | `commission` | 源行佣金类（principal 旁的佣金行） | 佣金类 amountType | 🟡 🔴 | 现 8 池未单列佣金；确认是否从 otherfee 拆出 |
| 买家运费 | `shipping` | 源行运费类 | 运费类行 | 🟡 🔴 | 同上 |
| 促销费 | `promotion` | 源行促销类 | 促销/折扣类行 | 🟡 🔴 | 同上 |
| 其它收支 | `otherfee` | `shareShopOtherFee` 兜底池 | other-transaction 兜底行 | 🟡 ⏳ | 兜底池归属核对 |
| SKU结算 | `setincome` | 无 SKU 结算净额汇总 | 派生（本金 − 退款 − 费用） | ⚪ 🔴 | 派生列 |
| 预估VAT | `profit_vat` | 无税费列 | 税费类行 / 税务台账 | 🔴 | 含税口径待拍板（§6） |
| 市场费用 | `profit_marketfee` | 无 | 市场费用类 | 🔴 | 缺列 |
| 所得税 | `profit_companytax` | 无 | 所得税类 | 🔴 | 缺列 |
| 关税 | `profit_customstax` | 无 | 关税类 | 🔴 | 缺列；候选头程/报关模型关联 |
| 汇率损耗 | `profit_exchangelost` | 无折算损耗列；`AmazonFinanceRecord.convertedAmount/conversionStatus/fxEvidence` | 折算汇率证据 | 🔴 🟡 | 折算证据在财务表；损耗派生口径待确认 |
| 固定费用 | `profit_lostrate` | 无 | 本地固定费用录入 | 🔴 | 本地费用类型表 |
| 其它费用 | `profit_otherfee` | 无 | 其它费用类 | 🔴 | 缺列 |
| 预估运费 | `profit_local_shipmentfee` | 无 | 本地/头程运费 | 🔴 | 候选 WMS/头程成本模型 |
| 采购成本 | `local_price` | `ProductCost.amount`（采购成本） | 非结算报告元素 | 🟡 🔴 | 按 SKU/生效日期 join；成本口径待拍板 |
| 自定义费用 | `local_other_cost` | 无自定义费用类型表 | 本地录入 | 🔴 | 需费用类型与录入模型 |
| 退税 | `local_return_tax` | 无 | 退税台账 | 🔴 | 缺列 |
| 毛利润 | `profit` | 无利润汇总模型 | 派生（收入 − 成本 − 费用 − 税） | ⚪ 🔴 | 派生层；口径确认前不默认展示 |
| 毛利润率 | `profitrate` | 无 | 派生（毛利 / 销售额） | ⚪ 🔴 | 派生层；分母口径待确认 |

### 3.6.1 费用分摊明细 — `payment/costSharing`

| Wimoor 列名 | Wimoor prop | 本项目模型.字段 | SP-API / 内部来源 | 状态 | 差距 / 核验动作 |
|---|---|---|---|---|---|
| 分摊产品 | `sku` | `AmazonSettlementAllocationLine.sku / sellerSku` | 结算分摊行 | ✅ ⏳ | 分摊行身份核对 |
| 金额 | `amount` | `AmazonSettlementAllocationLine.basisAmount / share*`；`AmazonSettlementAllocation.currency` | 分摊算法输出 | 🟡 ⏳ | 核对分摊基数与 8 池金额 |
| 日期 | `byday` | `AmazonSettlementAllocationLine.businessDate` | 结算业务日期 | 🟡 ⏳ | 日期口径核对 |
| 单据号 | `code` | `AmazonSettlementAllocation.settlementId / settlementRef` | 结算/分摊单据号 | 🟡 ⏳ | 单据号映射核对 |
| 分摊日期 | `date` | `AmazonSettlementAllocation.createdAt` | 分摊生成时间 | 🟡 ⏳ | 时区核对 |
| 店铺 | `groupname` | `AmazonSettlementAllocation.settlementReportId` → 报告站点 | 报告站点绑定 | 🟡 ⏳ | 店铺名经主档/站点表 join |
| 国家 | `marketname` | `AmazonSettlementRow.marketplaceId` | 结算行站点 | 🟡 ⏳ | 站点映射核对 |
| 费用类型 | `itemname` | 费用池类别（`shareStorageFee` 等 8 池）；分类规则见 `settlement-fee-classification.ts` | 结算行分类 | 🟡 🔴 | 费用类型未存名称字典；池键到中文/类型名需字典层 |
| 货币 | `currency` | `AmazonSettlementAllocation.currency` / 行 `currency` | 结算币种 | ✅ ⏳ | 币种核对 |
| 创建人 | `operator` | `AmazonSettlementAllocation.createdBy` | 内部操作人/系统账号 | 🟡 ⏳ | 系统自动分摊与人工操作标识区分 |
| 创建日期 | `createDate` | `AmazonSettlementAllocation.createdAt` | 内部生成时间 | 🟡 ⏳ | 时区核对 |
| 操作 | — | — | UI 动作列 | — | 非数据字段 |

### 3.7 利润报表 — `payment/profitReport/child`

在 3.6 基础上额外列；标注 ✅ 的为本项目分摊行已建字段。

| Wimoor 列名 | Wimoor prop | 本项目模型.字段 | 状态 | 差距 / 核验动作 |
|---|---|---|---|---|
| 广告销售额 | `rpt_adv_sales` | `AmazonAdsReportFact.sales`（按 SKU/日期汇总） | 🟡 🔴 | 广告与自然销售是否混算见 §6 待拍板项 |
| 广告销量 | `rpt_adv_units` | `AmazonAdsReportFact.units` | 🟡 🔴 | 同上 |
| 店铺分摊-仓储 | `share_storage_fee` | `AmazonSettlementAllocationLine.shareStorageFee` | ✅ ⏳ | 分摊金额核对 |
| 店铺分摊-长期仓储 | `share_long_storage_fee` | `shareLongStorageFee` | ✅ ⏳ | 同上 |
| 店铺分摊-广告花费 | `share_adv_spend_fee` | `shareAdvSpendFee` | ✅ ⏳ | 同上 |
| 店铺分摊-优惠券 | `share_coupon_redemption_fee` | `shareCouponRedemptionFee` | ✅ ⏳ | 同上 |
| 店铺分摊-预留金 | `share_reserve_fee` | `shareReserveFee` | ✅ ⏳ | 同上 |
| 店铺分摊-补偿 | `share_reimbursement_fee` | `shareReimbursementFee` | ✅ ⏳ | 同上 |
| 店铺分摊-弃置 | `share_disposal_fee` | `shareDisposalFee` | ✅ ⏳ | 同上 |
| 店铺分摊-其它 | `share_shop_other_fee` | `shareShopOtherFee` | ✅ ⏳ | 同上 |
| 店铺结算 | `income` | 无店铺级结算汇总 | 🔴 | 店铺层汇总待建 |
| SKU报表（分组表头：仓储/长期仓储/广告花费/补偿/弃置/费用合计） | `rpt_*` | 费用类报告行（`AmazonSyncReportRow.fields` Json） | 🟡 🔴 | 报告原件保留，未提升显式列 |
| SKU报表-仓储费 | `rpt_storage_fee` | 费用类报告行 Json | 🟡 🔴 | 同上 |
| SKU报表-长期仓储 | `rpt_long_storage_fee` | 同上 | 🟡 🔴 | 同上 |
| SKU报表-广告花费 | `rpt_adv_spend_fee` | 广告花费 fact | 🟡 🔴 | 与广告汇总对齐 |
| SKU报表-补偿 | `rpt_reimbursements_fee` | 补偿报告行 Json | 🟡 🔴 | 同上 |
| SKU报表-弃置费/弃置量 | `rpt_disposal_fee` / `rpt_disposal_units` | 弃置报告行 Json | 🟡 🔴 | 同上 |
| SKU报表-费用合计 | `fin_sum_fee` | 无 | 🔴 | 派生合计 |
| VAT税费 | `profit_vat` | 同 3.6「预估VAT」 | 税费类行 / 税务台账 | 🔴 | 含税口径待拍板（§6） |
| FBA费用 | `fbafee` | 同 3.6「FBA费用」 | FBA 费类行 | 🟡 ⏳ | 同上 |
| SKU结算 | `setincome` | 同 3.6「SKU结算」 | 派生净额 | ⚪ 🔴 | 同上 |
| 其它采购成本 | `local_other_cost` | 无 | 🔴 | 自定义成本类型 |
| 其余税费/成本/毛利列 | 同 3.6 | 同 3.6 | 同 3.6 | — |

### 3.8 流量浏览 — `report/pageview`

| Wimoor 列名 | Wimoor prop | 本项目模型.字段 | SP-API 来源（Sales & Traffic） | 状态 | 差距 / 核验动作 |
|---|---|---|---|---|---|
| 图片 | `image` | 主档图 | Catalog 主图 | 🟡 ⏳ | 同前 |
| SKU | `sku` | `AmazonSalesTrafficProductSnapshot.sellerSku` | 请求维度 sellerSku | ✅ ⏳ | 维度核对 |
| 日期 | `byday` | `businessDate` | 报告日期维度 | ✅ ⏳ | 日期格式 `YYYY-MM-DD` 核对 |
| 访问次数 | `sessions` | `metrics.sessions`(Json) | `sessions` | ✅ ⏳ | 空值识别（`quality=MISSING_FIELDS`） |
| 访问转化率 | `sessionPercentage` | 无 | `sessionPercentage` | 🔴 | 模型未存比率字段 |
| 浏览次数 | `pageViews` | `metrics.pageViews`(Json) | `pageViews` | ✅ ⏳ | 同 sessions 核对 |
| 浏览转化率 | `pageViewsPercentage` | 无 | `pageViewsPercentage` | 🔴 | 缺列 |
| 购物车比例 | `buyBoxPercentage` | 无 | `buyBoxPercentage` | 🔴 | 缺列 |
| 销量 | `unitsOrdered` | `metrics.unitsOrdered`(Json) | `unitsOrdered` | ✅ ⏳ | 核对 |
| 商品转化率 | `unitSessionPercentage` | 无 | `unitSessionPercentage` | 🔴 | 缺列 |
| 销售额 | `orderedProductSales` | `metrics.orderedProductSales`(Json，含 amount/currencyCode) | `orderedProductSales.amount/currencyCode` | ✅ ⏳ | 金额对象结构核对 |
| 订单 | `totalOrderItems` | `metrics.totalOrderItems`(Json) | `totalOrderItems` | ✅ ⏳ | 核对 |

> 商品级快照另含 `childAsin / parentAsin / sellerSku / granularity`；站点级快照为聚合行。B2B 指标（`unitsOrderedB2B`、`orderedProductSalesB2B`）当前未在 metrics 结构中出现，需确认是否纳入。

### 3.9 广告 — `advertisement/manager`（SP / SD / HSA 通用列表）

| Wimoor 列名 | Wimoor prop | 本项目模型.字段 | Advertising API 来源 | 状态 | 差距 / 核验动作 |
|---|---|---|---|---|---|
| 广告活动/广告组/关键词/投放（名称） | `name/keywordText` 等 | `AmazonAdsEntityRecord.name / keywordText / matchType / targetingExpression`；`AmazonAdsReportFact.campaignId/adGroupId/targetingId` | 实体实体名与层级外键 | 🟡 ⏳ | 事实表按 ID 聚合，实体表补名称；核对 join 完整性 |
| 状态 | `state` | `AmazonAdsEntityRecord.state` | 实体状态 | 🟡 ⏳ | 枚举映射核对 |
| 预算 | `budget` | `AmazonAdsEntityRecord.budgetAmount / budgetType` | 预算实体 | 🟡 ⏳ | 预算币种待核 |
| 开始/结束日期 | `start/end` | `AmazonAdsEntityRecord.startDate / endDate` | 日期实体 | 🟡 ⏳ | 日期类型核对 |
| 竞价/建议竞价 | `bid/sugBid` | `AmazonAdsEntityRecord.bid`；建议竞价未存 | 竞价实体 / 建议竞价接口 | 🟡 🔴 | 建议竞价未落库 |
| 曝光量 | `impressions` | `AmazonAdsReportFact.impressions` | `impressions` | ✅ ⏳ | 核对 |
| 点击次数 | `clicks` | `clicks` | `clicks` | ✅ ⏳ | 核对 |
| 点击率 | `CTR` | 无（派生 clicks / impressions） | — | ⚪ | 前端/汇总层派生 |
| 每次点击费用 | `avgcost` | 无（派生 spend / clicks） | — | ⚪ | 派生 |
| 广告费 | `cost` | `spend` | `cost` / `spend` | ✅ ⏳ | 币种 `currencyCode` 核对 |
| 广告销售额 | `sumSales` | `sales` | `attributedSales` | ✅ 🔴 | 现未区分同 SKU / 跨 SKU（见下两行） |
| 销量 | `sumUnits` | `units` | `attributedUnits` | ✅ 🔴 | 同上 |
| 订单量 | `attributedUnitsOrdered` | `orders` | `attributedOrders` | ✅ ⏳ | 核对 |
| ACOS | `ACOS` | 无（派生 spend / sales） | — | ⚪ | 派生；分母为广告销售额 |
| ROAS | `ROAS` | 无（派生 sales / spend） | — | ⚪ | 派生 |
| 转化率 | `CSRT` | 无（派生 orders / clicks） | — | ⚪ | 派生 |
| 目标商品-销售额 | `attributedSalesSameSKU` | 未分列；`rawDimensions`(Json) 待核是否留存 | 同 SKU 归因销售额 | 🔴 | 事实表未拆同/跨 SKU |
| 其它商品-销售额 | `attributedSales` | 未分列 | 跨 SKU 归因销售额 | 🔴 | 同上 |
| 目标商品-转化量 | `attributedConversionsSameSKU` | 未分列 | 同 SKU 转化量 | 🔴 | 同上 |
| 其它商品-转化量 | `attributedConversions` | 未分列 | 跨 SKU 转化量 | 🔴 | 同上 |
| 分归因窗口指标（1/7/14/30 天） | `sales1d…30d` 等 | 仅有 `attributionWindow` 维度字段，分窗口数值未分列 | 各窗口归因指标 | 🔴 | 需按窗口扩列或建窗口子表 |
| 新品牌 / 品牌效应 / 心愿单 / 借阅 / Kindle 指标 | `newToBrand*`、`conversionsBrandHalo*`、`addToList*` 等 | 无 | NB/品牌效应专属指标 | 🔴 | 当前链路未接入，按业务需要排期 |
| 否定关键词 / 否定投放 | `keywordText/targetingText` | 实体表 `targetingType/matchType`；否定态待核 | 否定实体 | 🟡 🔴 | 否定标记未落显式列 |
| Search Terms | `query` | `AmazonAdsReportFact.searchTerm` | 查询词维度 | ✅ ⏳ | 核对 |

---

## 4. 字段缺口汇总（🔴 清单，按优先级）

### P0 — 经营主干页面直接受阻

| 缺口域 | 缺失字段/能力 | 影响页面 | 建议落库位置 |
|---|---|---|---|
| 订单行税费/折扣/运费 | `ItemTax / ShippingTax / PromotionDiscount / ShippingPrice / GiftWrapPrice / PointsGranted / ConditionNote` | 订单、利润、结算复核 | `AmazonOrderItemRecord` 扩列或保留 Json 提升显式列 |
| 销售/订单汇总 | 按 SKU·日·周·月的销量、订单量、平均售价、退款量/额/率 | 商品、结算 SKU、利润、库存规划 | 新建销售日汇总模型（前置：主档 resolver） |
| 退款行金额与购买日期 | `refunded-amount`、`purchase-date` | 退货、利润 | `AmazonReturnRecord` 扩列，或明确从财务/结算行派生 |
| 规划快照 | 周转、库龄桶、近 7/30/60/90 天动销、冗余、仓储/滞销/附加费预估 | 库存规划 | 新建 `GET_FBA_INVENTORY_PLANNING_DATA` 快照模型 |
| 利润派生层 | 净额、毛利、毛利率、税费、关税、汇率损耗、固定/自定义费用 | 结算 SKU、利润报表 | 利润汇总模型 + 费用类型字典；口径先拍板（§6） |

### P1 — 页面列补齐

| 缺口域 | 缺失字段/能力 | 影响页面 |
|---|---|---|
| 退货留言/追踪号/状况译名/原因描述 | `customerComments / licensePlateNumber / detailedDispositionName 译文 / reason-description` | 退货 |
| 仓中心与分站点库存 | `fulfillment-center-id`、按国库存维度 | 库存明细、分站点视图 |
| 广告同/跨 SKU 转化拆分、分窗口归因 | `attributedSalesSameSKU`、跨 SKU 转化、1/7/14/30 天窗口数值 | 广告报表 |
| 流量比率字段 | `sessionPercentage / pageViewsPercentage / buyBoxPercentage / unitSessionPercentage` | 流量浏览 |
| 产品类型、市场价/划线价、运费模板 | 主档属性提升显式列 | 商品 Listing |

### P2 — 本地录入与扩展能力

| 缺口域 | 说明 |
|---|---|
| 人工备注 | 订单/商品本地备注表（非 SP-API 字段） |
| 本地费用类型 | 自定义费用、退税、固定费用、头程运费录入与关联 |
| 补货策略周期 | 安全库存周期、最小发货周期与本地补货策略模型对齐 |
| 品牌分析扩展 | NB/品牌效应/心愿单/借阅/Kindle 等专属指标按业务需要排期 |
| 发票/邀评状态 | Feed 回传与邀评状态模型，当前链路未覆盖 |

---

## 5. 通用底座依赖（字段落地前置）

1. **主档 resolver**：SKU ↔ ASIN ↔ 标题 ↔ 主图 ↔ 站点统一解析，避免各页各自 join。
2. **销售汇总层**：日/周/月 × SKU 的销量、订单量、销售额、退款派生表；商品/结算/利润/规划页共用。
3. **费用分类字典**：结算 8 类费用池 + 税费/关税/运费/自定义费用的分类映射表，支撑 SKU 级透视。
4. **字段注册表**：项目已有 `AmazonFieldRegistry / AmazonFieldMappingVersion / AmazonFieldObservation` 体系；新增显式列应在注册表登记 `targetTable / targetColumn / transformRule`，并标注映射版本。
5. **原始行保留**：未提升显式列的报告要素继续保留在 `fields` Json，不得丢弃原始表头与空值。

---

## 6. 迁移跑通后的取值级核对规程（后置执行）

### 6.1 前置门禁（全部满足才开始取值核对）

- [ ] 数据库迁移部署完成：`_prisma_migrations` 记录与 `prisma/migrations/` 目录一致；迁移内含 `CREATE EXTENSION`，须由超管预建（应用账号直跑会 P3009）。
- [ ] 授权与连接可用：卖家账号、广告授权绑定完成，测试站点可拉取报告。
- [ ] 至少灌入一个完整业务周期的样例数据：覆盖 ≥1 个站点、≥1 个 SKU、若干订单/退货/结算/库存/广告行。
- [ ] 样例取数键已固定：抽样订单号、SKU、ASIN、业务日期、广告活动/关键词 ID，三端可按同一键定位。
- [ ] 运行时健康：PG / Redis / dev 三项状态正常（`watchdog.sh status` 复核）。

> 阻塞提示：容器回收后 `/var/lib` 清空，PG 数据不持久；在数据目录迁入持久分区之前，灌入的数据可能在下次回收后丢失。取值核对建议在持久化方案落地后集中执行。

### 6.2 逐域核对步骤

1. **取源报告原件**：导出同一报告的 SP-API 原始行（表头 + 单元格值），作为比对基准。
2. **查落库值**：按身份键查本项目模型行，记录显式列与 `fields` Json 中的原始值。
3. **查页面展示值**：工作台/页面渲染结果与落库值比对。
4. **逐格比对**：按本表 §3 各行的"本项目模型.字段"逐格核对，记录：源值 → 落库值 → 展示值 → 一致/不一致/空值。
5. **派生列复核**：⚪ 派生列按确认后的公式重算，比对页面结果；记录公式版本。
6. **留痕**：核对结果写入核对记录（日期、取数键、域、列名、三端值、判定、经办人）；不一致项挂缺陷单并标注阻塞页面。

### 6.3 比对口径（不一致判定标准）

| 口径项 | 核对要点 |
|---|---|
| 金额精度 | 落库 Decimal 精度与源报告字符串一致；四舍五入不得改变业务量级；原币与折算值分列核对 |
| 币种 | 原币种与展示币种区分；折算汇率来源、折算时间点已记录 |
| 时区 | 日期按站点时区展示；`businessDate` 与报告日期一致，不得按 UTC 截断错位 |
| 空值 | 源空值不得落 0；`quality=MISSING_FIELDS` 的行需标注缺失字段，不得补默认值 |
| 正负号 | 退款/冲减/费用行的正负号方向与结算报告一致 |
| 去重 | 订单量、退款量按 `DISTINCT order-id` 口径；重复快照行按身份键去重 |
| 汇总边界 | 汇总层日期范围、站点范围、SKU 归属与页面筛选条件一致 |

### 6.4 必须先拍板的口径（未确认前相关派生列不得默认上线）

1. **汇率来源与折算口径**：汇率取数源、折算时点、原币/展示币种。
2. **含税/未税口径**：VAT、所得税、关税在利润表中的计入方式。
3. **采购成本取数源**：采购发票、本地录入或头程台账；生效日期与版本。
4. **PII 可取范围**：买家留言、姓名、地址等个人信息的留存与展示边界。
5. **广告与自然销售是否混算**：利润/销量列是否剥离广告归因。
6. **派生公式定义**：平均售价、退款率、毛利率、ACOS/ROAS/转化率的分子分母口径。

### 6.5 失败路径与回退

| 失败路径 | 表现 | 缓解 / 回退 |
|---|---|---|
| 迁移被权限阻断 | P3009 扩展创建失败，表结构未建全 | 超管预建扩展后再部署；不以应用账号强跑迁移 |
| 样例数据为空/被回收清空 | 三端比对无样本可对 | 先落持久分区再灌数据；核对记录标注"无样本"而非判定通过 |
| 源报告结构与契约不符 | 表头缺必填列、行数异常 | 解析器拦截并保留原件；更新契约后重跑，不放宽校验 |
| 派生口径与业务预期不符 | 毛利/转化率与 Wimoor 或财务台账不一致 | 冻结该列上线，回到 6.4 拍板；已展示版本标注口径说明 |
| 广告归因窗口口径不一致 | 同/跨 SKU 转化与 Wimoor 对不上 | 核对归因窗口与报告类型；未拆分前页面标注口径范围 |
| 主档关联断裂 | 标题/主图按 ASIN 匹配为空 | 先修主档 resolver 与映射表，再复核对 |

---

## 7. 附：本项目 Amazon 侧关键模型清单（取证自 `schema.prisma`）

| 模型 | 用途 | 关键身份/度量列 |
|---|---|---|
| `AmazonOrderRecord` | 订单头 | `amazonOrderId / marketplaceId / grandTotalAmount / currencyCode / fulfilledBy / rawStatus / normalizedStatus` |
| `AmazonOrderItemRecord` | 订单行 | `orderItemId / asin / sellerSku / quantityOrdered / proceedsAmount / currencyCode` |
| `AmazonFinanceRecord` | 财务流水 | `transactionId / transactionType / classification / amount / currency / convertedAmount / conversionStatus / fxEvidence / attributionStatus / quarantineReason` |
| `AmazonInventorySnapshot` | 库存快照 | `sellerSku / asin / fnSku / condition / fulfillable / inboundWorking / inboundShipped / inboundReceiving / reserved / unfulfillable / researching` 七项数量 |
| `AmazonCatalogSnapshot` | Listing 快照 | `sellerSku / asin / listingStatus / fulfillmentType / listingAttributes(Json) / fieldSources(Json)` |
| `AmazonSalesTrafficSnapshot` | 站点级流量 | `businessDate / metrics(Json) / quality` |
| `AmazonSalesTrafficProductSnapshot` | 商品级流量 | `businessDate / granularity / childAsin / parentAsin / sellerSku / metrics(Json) / quality` |
| `AmazonReturnRecord` / `AmazonReturnReason` | 退货 | `amazonOrderId / sellerSku / asin / fnsku / quantity / disposition / reasonId / rawStatus` |
| `AmazonSettlementReport` / `AmazonSettlementRow` | 结算报告/行 | `reportType / status`；行 `businessDate / orderId / sellerSku / asin / transactionType / amountType / amountDescription / amountOriginal / currencyCode / fields(Json)` |
| `AmazonSettlementAllocation` / `AmazonSettlementAllocationLine` | 分摊单/行 | 行 `sku / basisAmount / shareStorageFee / shareLongStorageFee / shareAdvSpendFee / shareCouponRedemptionFee / shareReserveFee / shareReimbursementFee / shareDisposalFee / shareShopOtherFee / classification` |
| `AmazonAdsReportFact` | 广告事实 | `reportType / adProduct / reportDate / campaignId / adGroupId / targetingId / advertisedAsin / searchTerm / placement / impressions / clicks / spend / orders / sales / units / attributionWindow / rawDimensions(Json)` |
| `AmazonAdsEntityRecord` | 广告实体 | `entityType / externalId / parentExternalId / state / name / startDate / endDate / targetingType / budgetAmount / budgetType / bid / keywordText / matchType / targetingExpression / payload(Json)` |
| `AmazonSyncReportRow` | 通用报告行原件 | `businessDate / orderId / sellerSku / asin / transactionType / amountType / amountDescription / amountOriginal / currencyCode / quantityOriginal / fields(Json)` |
| `AmazonFieldRegistry` / `AmazonFieldMappingVersion` / `AmazonFieldObservation` | 字段注册与映射版本 | `fieldId / layer / verificationStatus / mappingStatus / targetTable / targetColumn / transformRule / status` |

---

*本表为静态映射核对基线；取值级一致性以 §6 规程在迁移跑通后产出的核对记录为准。*
