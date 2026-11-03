# 数据域 / Amazon 官方 API 对照

核对日期：2026-11-04。`official-model-evidence.json` 保存本次官方模型获取结果与哈希。以下是候选接入依据，不是全部已实现；具体区域、卖家资格、应用角色、历史可查范围须对试点授权实际核验。**本地 authorizedResources 不授予 Amazon 权限，Marketplace Participations 成功也不证明某数据域可用。**

## 1. 官方来源与版本

- [Amazon 官方 API models](https://github.com/amzn/selling-partner-api-models)：本次直接下载对应JSON并核对operationId、path、parameters，未执行其中任何业务请求。
- [报告类型实时文档](https://developer-docs.amazon.com/sp-api/docs/report-type-values)、[角色文档](https://developer-docs.amazon.com/sp-api/docs/roles-in-the-selling-partner-api)：HTTP初访曾403，随后经官方页面WebMCP只读工具成功读取Analytics/FBA/Settlement及角色说明。当前摘录见 `official-live-doc-evidence.json`，不以历史材料替代当前定义。
- [历史官方报告说明](https://github.com/amzn/selling-partner-api-docs/blob/83b77eefccf6909c4638ea3456a652e44b68e409/references/reports-api/reporttype-values.md)：2022-01-04快照，仅证明部分报告类型历史存在；不证明2026年仍适用所有店铺。
- [Sales and Traffic 官方schema](https://github.com/amzn/selling-partner-api-models/blob/main/schemas/reports/sellerSalesAndTrafficReport.json)和[Search Terms schema](https://github.com/amzn/selling-partner-api-models/blob/main/schemas/reports/sellingPartnerSearchTermsReport.json)：本次已读取，示例直接包含下表reportType。不照抄示例ASIN、日期或数字作为业务数据。

不将Amazon官方QPS、burst、授权角色或报表生成SLA写死为未经验证的运行时常量；每个operation的usage plan、实际响应可用限流信息与当前文档核验后才配置。试点频率是业务建议，不是Amazon承诺。

## 2. 数据域映射

| 数据域/内部代码草案 | 官方读取候选 | 模式与关键限制 | 授权/站点核验 | 现状/阶段 |
| --- | --- | --- | --- | --- |
| 店铺参与站点 | Sellers v1 `getMarketplaceParticipations`，`GET /sellers/v1/marketplaceParticipations` | 连接探测；不证明其他域角色 | 对照响应及卖家实际站点 | 已实现；P1扩多凭证 |
| 在线商品 `listings`（兼容catalog） | Listings Items 2021-08-01 `searchListingsItems`，`GET /listings/2021-08-01/items/{sellerId}` | `pageToken`；官方有lastUpdatedAfter/Before；当前全量，增量不等于可靠删除检测，仍需全量校准；注意搜索结果范围/数量限制 | 按应用该操作角色和每卖家每站点验证，不称为Catalog Items API | 已实现部分字段；P1 |
| FBA库存 `fba_inventory`（兼容inventory） | FBA Inventory v1 `getInventorySummaries`，`GET /fba/inventory/v1/summaries` | `nextToken`、`startDateTime`存在；当前快照全量；增量语义及缺失/清零/删除须验证，先维持快照 | 核对FBA资格、操作角色及实际marketplace响应 | 已实现；P1 |
| FBM库存 `fbm_inventory` | Listings `searchListingsItems/getListingsItem` 的fulfillmentAvailability，必要时以官方刊登报告校准 | 与FBA域独立；当前只提取fulfillmentChannelCode，**没有FBM数量落库**；Amazon展示量不等同公司仓可承诺库存 | 明确履约渠道、quantity可用性与站点，报告候选需另核验 | 未实现；P2候选小任务，未通过前规划中 |
| 订单 `orders` | Orders **2026-01-01** `searchOrders` / `getOrder`；`GET /orders/2026-01-01/orders`及`/{orderId}` | lowerCamelCase `lastUpdatedAfter/Before`、`paginationToken`、`includedData`；须先选择版本与最小字段。旧v0 `getOrders`使用大写LastUpdatedAfter、NextToken，不能混用 | 核验新版本区域、角色、includedData与PII限制；不请求买家身份/地址 | 未实现；P2 |
| 订单商品 `order_items` | 优先评估2026版订单响应可选数据；旧v0 `getOrderItems`仅作为明确版本适配候选 | 不虚构2026版独立getOrderItems；订单＋必要商品子数据完整后才完成任务/推进水位 | 最小字段白名单；父订单及行键按冻结版本定义 | 未实现；P2 |
| 销售流量日报 `sales_traffic` | Reports 2021-06-30；`GET_SALES_AND_TRAFFIC_REPORT`（当前文档/schema核实） | 可申请/安排生成；DAY/WEEK/MONTH，PARENT/CHILD/SKU；开始日期不超2年；7天回查不能把跨日ASIN总量硬拆逐日SKU | Brand Analytics、Sellers；实际店铺/站点/延迟仍须试点 | 未实现；P2 |
| FBA在途货件 `inbound_shipments` | 官方 Fulfillment Inbound v0 `getShipments`、`getShipmentItemsByShipmentId` / `getShipmentItems` | LastUpdatedAfter/Before、QueryType、NextToken存在；未完成货件回查。不要把2024版入库创建计划流程当所有历史货件查询；v0生命周期需核验 | 核验卖家/区域/历史能力、状态与数量含义；没有ETA就保持未知 | 未实现；P2 |
| 财务交易 `financial_transactions` | Finances 2024-06-19 `listTransactions`，`GET /finances/2024-06-19/transactions` | postedAfter/Before、marketplaceId、transactionStatus、nextToken；postedAt不是可靠updatedAt，30天补偿仍需去重/状态重查 | Finance相关角色及区域当前可用性待核验；未知币种/归属隔离待处理 | 未实现；P3 |
| 结算报告 `settlements` | Reports getReports/getReport/getReportDocument；`GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2`（当前核实） | **不能申请或安排生成**，Amazon自动生成后getReports发现；TSV，金额支持地区格式如95,00；按结算批次对账 | Finance and Accounting；Seller Central sellers；实际授权/站点联调 | 未实现；P3 |
| 退货 `returns` | Reports；`GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA`（当前核实） | 仅可申请，TSV，内容日更新；FBA仓收到的退货，非全部FBM；customer-comments不默认采集/留raw | 当前文档列Pricing、Amazon Fulfillment；FBA sellers；角色组合语义及实际授权须验证 | 未实现；P3 |
| 赔偿 `reimbursements` | Reports；`GET_FBA_REIMBURSEMENTS_DATA`（当前核实） | 仅可申请、TSV、内容日更新；与财务入账不能直接相加，保留关联键 | 当前文档列Pricing、Amazon Fulfillment；FBA sellers；实际授权验证 | 未实现；P3 |
| 库龄 `inventory_age` | Reports；优先当前 `GET_FBA_INVENTORY_PLANNING_DATA` | 仅可申请，TSV，snapshot-date及库龄分桶；历史AGED类型不在本次当前目录，不能默认继续使用 | Amazon Fulfillment、FBA sellers；当前不支持NL/PL/SE/BE，BR字段较少；试点按站点验证 | 未实现；P3 |
| 商品价格 `pricing` | Product Pricing v0 `getPricing`，`GET /products/pricing/v0/price` | 重点ASIN/SKU有界轮询；不是全市场价格抓取；请求批量上限按文档 | 当前版本与Pricing角色/区域待核验 | 未实现；P4 |
| Featured Offer `featured_offer` | Product Pricing v0 `getListingOffers/getItemOffers`及相关当前版本操作待选 | 报价层Featured Offer信号与业务报表Buy Box百分比口径不同；不使用旧名推导新字段 | 官方响应字段/卖家身份/地区实际验证 | 未实现；P4 |
| 品牌搜索词 `brand_analytics` | Reports；`GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT`（当前文档/schema核实） | 仅可申请，JSON；DAY/WEEK/MONTH/QUARTER，不跨周期；非自家搜索转化全量 | Brand Analytics＋Brand Registry＋brand representative；实际站点/资格验证 | 未实现；P4 |
| 通知（扩展机制） | Notifications v1 subscription/destination操作 | 通知幂等、乱序、重投、签名/来源校验；仅作增量提示，仍需周期校准 | 每notificationType支持情况单独核验，订阅是外部写操作 | 未实现；P4 |
| Amazon Ads | 独立Ads API，非SP-API | 复用PPC读模型/审计边界，后续独立授权、限流与口径 | 不复用SP-API token或将其称SP-API数据域 | 当前主要PPC读入口；另立后续范围 |

## 3. 初始计划建议（待评审）

| 域 | 业务频率 | 模式/窗口 | 优先级 |
| --- | --- | --- | --- |
| FBA库存 | 60分钟 | 全量快照；增量验证通过后才开放 | P0 |
| 在线商品 | 每24小时 | 全量校准；增量另设独立计划/水位 | P0 |
| 订单/商品 | 15分钟/随父订单 | 更新时间窗＋重叠回查，重叠时长经试点配置；商品不单独抢占队列 | P0 |
| 销售流量 | 每天 | 报告日期按站点业务日；最近7个完整日回查 | P1 |
| FBA货件 | 2小时 | 未完成货件回查＋历史校准 | P1 |
| 财务 | 6小时 | posted窗口＋最近30天补偿；不能用“最大posted时间”模拟updated游标 | P1 |
| 结算 | 每天 | 发现新报告＋补查缺批次，不固定轮询未生成文档 | P1 |
| 退货/赔偿/库龄 | 每天 | 分别报告回查/对账/快照 | P2 |
| 重点商品价格 | 30–60分钟 | 明确ASIN集合＋容量预算 | P3 |
| 品牌分析 | 报告周期 | 仅已完成且可用周期 | P3 |

该表不变成运行时代码常量。DB保存计划版本及策略，调度器记录有效限流/延后原因。每店铺站点域独立状态；未实现/授权未知域默认停用，不自动为既有组织创建启用计划。

## 4. 实现前的API冻结门槛

每个适配器登记：官方文档与model版本/哈希、operation/reportType、当前角色和区域、允许字段、时间边界和站点时区、分页终止语义、删除/空结果规则、最长历史范围、限流信息、报告生成方式、业务键与样本fixture。无法核实即保持规划中/阻断，不能填造字段或限流参数推进开发。

## 5. 当前报告文档补充（2026-11-04核验）

当前Analytics文档更新于2026-10-28，Settlement文档更新于2026-10-14。Sales and Traffic说明每5分钟最多请求3次，429建议等待1分钟后倍增；这是该报告的当前约束，不替代Reports operation及seller预算，也不能套给所有数据域。试点策略须同时遵守报告级与API级限制。跨日报告的salesAndTrafficByAsin不是日期×SKU矩阵，逐日SKU事实须验证逐日报告成本或选择真正支持该粒度的官方数据来源；不可均摊7天总数。

结算报告不能请求/安排生成，V2 TSV金额需处理地区小数格式。退货/赔偿仅可请求且内容日更新；库龄使用当前Inventory Planning候选并明确站点例外。角色列表原样保留，未核实组合语义前不声称全部角色必须同时具备。官方文档存在不等于某试点卖家已获授权。
