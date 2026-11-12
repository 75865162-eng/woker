# Wimoor UI 页面与 ERP 映射

更新日期：2026-11-12。本文路径与连接情况以当前工作区源码核对；它不证明生产部署或真实 Amazon 数据验收。

本次继续开发已有移植成果，保留原路由、76px 图标轨、分组、顶部工作区选择器及业务功能。新增可搜索业务菜单抽屉、系统管理与账号站点直达入口；FBA 装箱从未接入说明页升级为现有本地计划的真实查询、分页、详情和保存入口；通用费用页按真实请款源码补齐状态 Tab、筛选区和审核列。没有新增数据库、Worker、同步引擎、Vue 或 Java 运行环境。

## 源码、菜单与许可

只读参考 `/Users/chenjieliang/Documents/wimoor/wimoor-ui`，仓库 HEAD `8f894b1eccb8df5d16af19a75c6a517795bf02a5`。上游 checkout 本来含未提交改动，故采用逐文件 SHA-256 证据：[729 个 Vue 文件清单](wimoor-integration/ui/2026-11-12/page-inventory.md)、[源码与 5 个 router 文件证据](wimoor-integration/ui/2026-11-12/source-inventory.json)。扫描结果包含子组件和空模板，不代表 729 个独立业务页面或全部运行验收。

菜单在 `src/router/index.js` 请求 `/api/admin/api/v1/menus/route` 后映射 Vue 组件；`src/layout/components/Aside/AsideMenu.vue` 直接展示主菜单、子分组和菜单抽屉；辅助路由在 `router/modules/{erp,amazon,finance,sysRouter}.js`。本次读取源码，没有访问 Wimoor 授权服务，因此不宣称还原了完整动态菜单树。ERP 入口仍按自己的实时角色权限筛选，服务端保持原鉴权。

根许可证与 `public/licenses/wimoor-MIT.txt` 逐字一致：Copyright (c) 2022 深圳市万墨信息科技有限公司。布局改编组件保留来源和 MIT 声明。本次没有复制上游图片、字体、图标、TinyMCE 或其他第三方资源。发现 UI 内 `public/tinymce/license.txt`，该资源没有纳入移植，不能按根 MIT 推定它的许可。

语义复核纠正：`views/amazon/inbound/fbacenter.vue` 是配送中心 Code、国家、地址、城市、州区、邮编维护，**不是入库计划页面**，不再映射到 ERP 货件查询。`views/amazon/inventory/quantity/index.vue` 是空模板，也不作为成熟库存布局依据。

## 22 项检查与页面映射

下列 Wimoor 路径相对 `wimoor-ui/src/`。同一页面族共用 ERP 入口，不建立第二套 SKU、库存、货件或财务事实源。“沿用”表示原有能力保留，不表示本次重新移植了该模块全部子页面。

| 范围 | 真实 Wimoor 页面 | ERP 路由 | 布局处理 / 后端连接与缺口 |
| --- | --- | --- | --- |
| 1 商品管理 | `views/erp/baseinfo/material/index.vue`、`components/header.vue` | `/dashboard` | 调整后复用，沿用商品列表、详情/编辑、筛选分页、SKU 复制；ProductRecord 主档已连接。组合商品、独立品牌/品类档案不宣称等价。 |
| 2 SKU 管理 | 上述 material、`views/amazon/listing/` | `/dashboard`、`/operations?view=listing_details` | 沿用商品和 Amazon 刊登各自上下文，不新建平行 SKU 主档。 |
| 3 Amazon 账号与站点 | `views/amazon/storeAuth/index.vue`、`components/table.vue` | `/operations?view=connections`、`/amazon-ads/accounts` | 现有店铺/站点表与展开管理区；新增全局直达入口。SP-API 和 Ads 授权保持独立，沿用已有 API。 |
| 4 订单管理 | `views/amazon/order/fbm/index.vue`、`components/{header,table,order_detail}.vue` | `/operations?view=orders`、`order-items` | 已有列表→订单详情抽屉→订单商品跳转，连接订单查询。受限买家字段不照搬上游。 |
| 5 库存管理 | `views/amazon/inventory/planning/index.vue`、`fba/{detail,daily}.vue`；`views/erp/warehouse/inventory/` | `/operations?view=inventory`、`inventory_age`、`inventory_events`；公司仓 `/logistics/warehouse?tab=balances` | 已连接相应查询；保留库存快照、库龄、流水及公司仓口径。没有复制空 quantity 模板。 |
| 6 多仓库管理 | `views/erp/warehouse/base/index.vue`、`components/{parentlist,childrenlist}.vue` | `/logistics/warehouse?tab=warehouses` | 沿用仓库/区域/库位和真实 WMS 档案。第三方海外仓连接未等价实现。 |
| 7 入库管理 | `views/erp/warehouse/inbound/index.vue`、`components/` | `/logistics/warehouse?tab=receipts` | 调整后复用既有收货列表、详情、质检与上架。建单和实际库存过账仍分开。 |
| 8 出库管理 | `views/erp/warehouse/outbound/index.vue`、`components/{table,details}.vue` | `/logistics/warehouse?tab=reservations` | 沿用现有预占、拣货和出库操作，保留详情、审批、revision；不认定与上游出库单生命周期完全等价。 |
| 9 调拨管理 | `views/erp/warehouse/transfer/index.vue`、`components/header.vue` | `/logistics/warehouse?tab=balances` 发起；`tab=transfers` 查流水 | 现有成对调入/调出流水、筛选、详情已连接；上游在途调拨单的草稿/发货/收货生命周期尚不等价。 |
| 10 采购管理 | `views/erp/purchase/orders/index.vue`、`components/` | `/operations?view=purchase-orders` | 现有状态 Tab、服务端搜索/分页、表单、详情、审批与 WMS 收货复用；不覆盖其他正在进行的采购开发。 |
| 11 供应商管理 | `views/erp/baseinfo/supplier/index.vue`、`components/table.vue` | `/operations?view=suppliers` | 现有档案搜索/分页/新增编辑、新建采购与采购记录跳转已连接；不因 UI 移植新增独立供应商副本。 |
| 12 FBA 发货管理 | `views/erp/ship/shipment_handing/list/index.vue`、`components/{header,table}.vue` | `/operations?view=fulfillment`；本地计划 `/operations?view=first-mile` | 沿用 Amazon 已发布货件查询及 ERP 本地计划。Amazon 创建、确认、面单/标签和发货执行未接入。 |
| 13 FBA 入库计划 | `views/erp/ship/ship_plan/index.vue`、`views/erp/shipv2/shipment_add/shipstep/one_pick.vue` | `/operations?view=fulfillment`、`first-mile` | Amazon 计划观察和本地库存计划分别接入；不把本地计划当成已创建的 Amazon 入库计划。fbacenter 地址页没有等价入口。 |
| 14 FBA 装箱管理 | `views/erp/shipv2/shipment_add/shipstep/two_box.vue` 及装箱组件 | `/operations?view=fba-boxing` | **本次升级**：真实本地计划表格、分页、详情抽屉、箱组/箱规表单、保存/错误反馈；复用本地计划 API。Amazon 装箱组生成、方案选择及提交未接入。 |
| 15 FBA 物流管理 | `views/erp/ship/shipment_handing/list/components/table.vue`、`views/erp/ship/transportation/` | `/operations?view=fulfillment`、`first-mile`；`/sellfox/shipments` | 现有货件观察、本地人工运输与外部快照分别保留；不把货代送达写成 Amazon 收货。 |
| 16 头程物流管理 | `views/erp/ship/transportation/{index,edit_transportation,details_transportation}.vue`、`components/{list,compare}.vue` | `/operations?view=first-mile` | 已有本地计划、委托、人工节点、费用与账单；**纠正旧文档“全部未接入”判断**。独立承运商渠道档案、在线报价/订舱、自动轨迹仍未等价接入。 |
| 17 财务管理 | `views/finance/vouchers/list/index.vue`、`views/amazon/payment/` | `/operations?view=finance`、`reimbursements` | 沿用 Amazon 交易与赔偿真实查询；没有会计凭证、总账、试算和财务报表完整后端，不能标记为 Wimoor 财务全功能移植。 |
| 18 Amazon 结算管理 | `views/amazon/payment/settlement_sku/{index,settlement,skutable}.vue` | `/operations?view=settlements` | 已有报告/行查询，保留站点归属、币种与版本隔离；SKU 账期核销、关账未等价实现。 |
| 19 费用管理 | `views/erp/finance/paymentRequest/index.vue`、`components/table.vue` | `/operations?view=expense-management` | **本次补齐布局**：源码中的全部/待审/待付/完成/驳回 Tab、供应商/付款方式/日期/单号筛选区、审核人/日期列。通用费用接口未接入，筛选禁用、无假记录或假付款按钮；采购付款与头程费用链接到已有真实页面。 |
| 20 广告管理 | `views/amazon/advertisement/manager/index.vue`、`overview/index.vue` | `/amazon-ads/*`、`/workspace`、`/operations?view=ads` | 沿用现有 Campaign/Ad Group/投放与指标，新增 Ads 授权直达；在线数据、Bulk 草稿和显式演示区各有边界，不扩展真实写权限。 |
| 21 数据报表 | `views/amazon/report/pageview/index.vue`、`views/amazon/sales/report/index.vue`、`views/dashboard/` | `/operations?view=sales-traffic`、`brand_analytics`；`/sellfox/*` | 沿用已有数据查询、日期/版本/筛选；不合并不同来源、币种和归因口径。上游所有财务/仓库报表未逐项复制。 |
| 22 系统管理 | `views/sys/ruleAuth/index.vue`、`views/sys/task/index.vue`、`views/sys/menu/` | `/accounts`、`/settings`、`/tasks`、`/versions` | 新增统一“系统管理”分组及可读抽屉入口，复用现有用户/角色/配置/审计；不引入 Wimoor Java 管理系统。 |

## 页面到后端与权限

| 业务 | 真实调用链 | 模型、异步与隔离 |
| --- | --- | --- |
| 商品 | `/api/products` 与既有商品详情 API → Product 查询/详情服务 → 现有 Repository | ProductRecord 主档及现有派生读层；原权限、revision、审计/Outbox 保留。 |
| 账号与站点 | `/api/operations/amazon-stores` → `listAmazonStores` / `renameAmazonStore`；SP-API OAuth、同步中心；Ads 使用原 Profile API | SellerAccount / AmazonSellerIdentity / AmazonSpApiAuthorization；工作区、组织和实时授权不变。 |
| 采购/供应商 | `/api/operations/procurement`、`approvals` → `src/lib/procurement/{query-service,order-service,receipt-service}.ts` 等 | Supplier、PurchaseOrder/Line、PurchaseOrderApproval、PurchasePayment/Approval；组织/工作区、审批与版本检查沿现有实现。旧文档“无独立 Service”已过时。 |
| WMS | `/api/operations/wms/[kind]`、commands、approvals → `src/lib/wms/{query-service,catalog-service,receipt-service,stock-service,application-service}.ts` 与 Repository | 原 Wms* 模型、审批、库存账及幂等边界；旧说明路由继续重定向到原 WMS 路由。 |
| 本地 FBA 计划/装箱/头程 | `/api/operations/fba-local-plans` GET/POST → `src/lib/fba-local/service.ts` 及 packing、transport-service、fee-ledger、shipment-service | FbaLocalPlan/Line、ForwarderOrder、Tracking、Fee、ForwarderBill 等；`SAVE_PACKING` 仍用原 plan revision；实时 WMS 权限和账号站点授权。没有 Amazon 写入。 |
| 订单/财务/货件/结算/报表 | `/api/operations/sync-center` → 现有 orders-query、finance-query、observations-query、settlements 等服务 | 已发布业务记录、版本和范围；原注册 Worker 负责采集。本次 UI 不启动真实同步。 |
| 通用费用 | 页面仅展示明确未接入布局及链接 | 缺通用费用单 API、审批/核销 Service、Expense/报销聚合模型；不以 PurchasePayment、FbaLocalFee 冒充。 |

## 交付与验证

[本次开发、文件清单、截图及本地验证](wimoor-integration/ui/2026-11-12/delivery.md)。[上一轮交付记录](wimoor-integration/ui/delivery-2026-11-11.md)保留为历史，不作为本轮验收。

当前仍不具备 Wimoor 所有业务能力；729 文件清单、22 项入口映射、布局改编和真实查询接入分别记录。没有访问真实业务数据库、调用 Amazon/Wimoor 在线接口、执行生产迁移、commit、push 或部署。
