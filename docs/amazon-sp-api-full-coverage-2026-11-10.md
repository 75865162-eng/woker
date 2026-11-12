# SP-API 全量覆盖盘点简报 · 2026-11-10

本轮仅检查代码与公开官方资料，交付本简报和同名 JSON 机器清单。未调用真实 Amazon 业务 API，未查询数据库、启动 Worker、改凭证、提交、推送或部署。

## 口径与总量

| 项目 | 结果 |
| --- | --- |
| 官方目录 API | 60 类；48 类 Seller 可用，12 类仅 Vendor |
| 当前 Seller 生产操作 | 290 个 HTTP 操作，289 个唯一 operationName（Shipping v2 复用一个名称） |
| 含保留旧版模型的 Seller 操作 | 345 个；模型存在不证明已弃用端点仍可调用 |
| 仓库接通的当前 API / 操作 | 11 类 / 22 个；加旧版 Pricing v0 为 23 个操作 |
| 当前操作面全部接通 | 2 类：Orders、Promotions；不代表全字段、全历史或已发布 |
| API 操作面部分接通 | 9 类；另 37 类完全无对应操作实现 |
| 当前无实现的操作 | 268 个 |
| 已完整同步并发布 API / 操作 | **未知（JSON 为 null）**：未取运行态证据，不能记为 0 或已完成 |
| Reports | 109 类型：101 Seller、8 Vendor-only；Seller 已实现 12、缺失 89 |
| Notifications | 主目录 26 + 独立 Data Kiosk 完成通知 1 = 27；事件完整实现 0 |
| Data Kiosk | Seller 3 Dataset / 7 Query，全部缺失；另 1 Vendor Dataset 不适用 |
| Marketplace | 官方 23；自动站点时区登记 18，缺 IE、BE、PL、ZA、EG |
| 注册适配器 | 冻结快照 18 个；不能作为数据覆盖率 |

另单列 3 个 sandbox-only 操作，不计生产操作分母。JSON 含 513 个资源条目、117 份官方 JSON/GraphQL Schema、逐项源码行号与 SHA256。

## 主要缺口

- **现有实现**：Catalog、Listings、Inventory、Orders、Finances、Inbound、Pricing、Reports、Promotions，以及 Notifications 订阅元数据和 Sellers 授权/站点发现。最后两项仅部分用途，不构成事件数据或周期账号数据集。22 个操作的全字段与历史覆盖未证实。
- **Reports**：已实现全量 Listing、Sales/Traffic、Settlement V2、Reimbursements、Inventory Planning、Ledger Detail、FBA Returns 和 5 种 Brand Analytics。缺失 89 种精确名称见 JSON summary.missingSellerReportTypes；包括订单/归档订单、FBA 库存及预留/滞留、发货/替换/移除、仓储费用、MFN 退货、税务/发票、绩效、促销/Coupon、B2B 机会等。通用 Reports 传输不抵扣逐类型缺口。
- **Notifications**：27 种均缺事件类型适配器、接收持久化、版本解析、租户隔离去重、实体关联及断线补偿。26 种仅能发现订阅；Data Kiosk 完成通知连类型登记也缺。名称、Payload Version 与适用限制见 resources 和 summary.missingNotificationEventTypes。不臆造订阅到期规则。
- **Data Kiosk**：缺 economics / economicsPreview / economicsSimulation、salesAndTrafficByAsin / salesAndTrafficByDate / salesAndTrafficTrends、sellerAnalyticsView。缺结果分页、JSONL 解析与入库、历史/刷新策略及统一查询。Brand Analytics 同时核对 Reports 和 sellerAnalyticsView 的 search.query/search.catalog。preview 最多未来 120 天、simulation 最多未来 90 天，不能当历史实绩；其他日期/字段资格以 Schema 为准。
- **Buy Box / Featured Offer**：Competitive Summary 与 own pricing 已接部分当前快照；缺 Competitive Pricing、Offers/批量 Offers、完整 eligible offers、Featured Offer Expected Price、ANY_OFFER_CHANGED/PRICING_HEALTH 事件链路。已有 buy_box_history 是日报 buyBoxPercentage 汇总，不是赢家/价格事件回放。采集后的快照/事件可留时间序列；Amazon 没有提供完整追溯赢家时间线，不能补造。
- **每个站点**：23 站逐站清单在 marketplaceCoverage；区分明确支持但缺失的报告、资格/支持未核实的候选项，以及官方站点列表排除项。IE/BE/PL/ZA/EG 是本仓库登记缺口，不能标作 Amazon 不支持。未查账号，不推断 BLOCKED_AUTH/ROLE/ELIGIBILITY。

## 官方不适用与差异

- 12 类 Vendor API、8 种 Vendor Report、VendorAnalytics Dataset 不纳入 Seller 分母；包括通用 Invoices v2026-06-25 和 Finance Remittance v2026-03-17。Brazil Invoices v2024-06-19 是另一个 Seller 入口，仅适用对应巴西 FBA 场景。
- 用户初始列表遗漏的 **Delivery by Amazon** 已加入；目录版本文字与模型不一致，以模型 v2022-07-01 为准。Listings Reference 指向旧版的差异也记录在 JSON。
- External Fulfillment Location 额外模型仅 sandbox。SellerAnalytics 官方说明尚未提供的 4 个 B2B 字段标为 API_NOT_PROVIDED；只针对该 Dataset 字段，不外推其他报告。
- 角色、Marketplaces、窗口及更新周期保存在完整定义/Schema。角色表未覆盖的新操作保留 null，不解释为免授权。Reports 文档保存期限与业务历史查询窗口分别记录。

## 可立即开发的顺序

1. **P0**：逐类型登记 89 个 Report 缺口，先补 FBA 库存/费用/发货/移除和 MFN 退货；补 27 种事件的接收、去重、关联与补偿；补 Data Kiosk 3 Dataset/7 Query 及 5 站点登记。
2. **P1**：Finances balances/summary、Pricing Offers/Expected Price、Inbound 剩余读取、Outbound 新版；补 Sellers account、Catalog search 与 Product Type Definitions。逐项按原件→解析→入库→校验→发布→统一查询验收。
3. **P2**：Customer Feedback、Action Items/Plans、Replenishment、Sales、AWD、Shipping/Tracking、Supply Sources、Support 等；地域/项目资格类先核角色与账号适用性。写命令与数据读取分别验收。

详细优先级见 JSON priorities；本轮未重设计同步架构。

## 证据与验证边界

官方模型锁定提交 db2936aa19f4b48185173c385c51ab115166f221；逐个读取 48 类 Seller Reference、模型、Reports、Notifications 和 Data Kiosk Explorer/Schema。官方来源 URL、定义、操作/字段 Schema 与目录差异均嵌入机器清单。

源码冻结于 2026-11-10T05:50:51.017666+00:00，基础 HEAD ae0135bf1da92ff6649a8c918a8a1c6915f8d812，包含当时未提交改动。盘点期间 Promotions 从 17 个适配器扩至 18 个；冻结后另有 10 个相关文件发生并发修改，名称见 sourceChangedAfterSnapshot。结论针对冻结内容，不混入后续代码；没有覆盖并发修改。

已做 JSON 解析、必需字段、状态枚举、唯一资源 ID、Schema/源码引用、计数与空白检查。仅新增两个审计文件，未运行应用测试、构建、数据库或真实服务验收；后续代码开发与合码再按 AGENTS.md 触发相应检查。运行态字段全部 null；codeCapabilities 仅表达代码路径存在，不能替代生产发布证据。至此停止，等待下一批开发指令。
