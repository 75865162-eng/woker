# WIMOOR 迁移页 → 亚马逊数据表 逐页映射决策表

> 生成日期 2026-11-26 · 覆盖全部 97 个共用工作台的主数据页 · 原则：不造数、不破坏权限隔离、语义明确才接


## 一、决策口径

- **已接（amazon）**：页面语义对应亚马逊同步表，且经生产真实 scope `readDataset` 验证可读。严格只读，复用会话/workspace/账号分配收窄/审计/只读已发布数据源。

- **保持主数据（master）**：页面是 ERP 本地业务（仓储/采购/财务凭证/系统管理/授权配置），亚马逊 API 根本不返回这些数据，强行接会错配。保持原 CRUD，数据由用户显式创建。

- **Ads 独立链路**：广告页走 Amazon Ads 独立权限与查询入口（`queryAdsEntities`），非 SP-API 同步表链路，未纳入本批通用只读工作台。

- 数据集行数来自生产库本轮实测（近 30 天窗口 + 当前站点）；`0` 表示当前授权站点暂无已发布数据，页面会显示空态说明，不代表业务不存在。


## 二、汇总

- 保持主数据CRUD：63 页
- 已接亚马逊真实数据：30 页
- Ads独立链路(未纳入)：4 页

## 三、逐页决策明细

| 页面 | 模块 | 决策 | 数据集 | 生产行数 | 依据 |
|---|---|---|---|---|---|
| account/account（采购记账）| 账目/本地账目 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| account/inventory-value（库存货值）| 账目/本地账目 | ✅ 已接 | `inventory` | 201 | FBA库存快照，含fulfillable/reserved/inbound |
| account/job-costing（批次成本）| 账目/本地账目 | ✅ 已接 | `fba_shipments` | 3507 | 批次成本——FBA入库货件(成本为本地数据) |
| account/open（账期未结算）| 账目/平台账目 | ✅ 已接 | `finance_transactions` | 137 | 账期未结算——财务交易流水 |
| account/other-expenses（其它费用）| 账目/本地账目 | ⭕ 保持CRUD | — | — | 非同步数据表（授权/配置/手工录入） |
| account/performance（业绩报告）| 账目/平台账目 | ✅ 已接 | `finance_transactions` | 137 | Finances API 交易流水（近30天），原币金额不跨币种汇总 |
| account/profit-report（利润报表）| 账目/平台账目 | ✅ 已接 | `settlements_v2` | 87 | 利润报表收入侧——结算报告行(成本为本地数据，利润需本地计算) |
| account/reimbursements（赔偿费用）| 账目/平台账目 | ✅ 已接 | `reimbursements` | 0 | 已发布赔付报告，当前站点可能暂无数据 |
| account/settlement-sku（账期SKU）| 账目/平台账目 | ✅ 已接 | `settlements_v2` | 87 | 按结算报告行的 SKU 展示，金额原币种 |
| account/settlements（结算记录）| 账目/平台账目 | ✅ 已接 | `settlements_v2` | 87 | 已发布且站点归属验证通过的结算报告行 |
| account/shop-profit（店铺利润）| 账目/平台账目 | ✅ 已接 | `settlements_v2` | 87 | 店铺利润收入侧——结算报告行 |
| account/storage-fees（FBA仓储费）| 账目/平台账目 | ✅ 已接 | `storage_fees` | 0 | 已发布仓储费报告行，当前站点可能暂无数据 |
| ads/download（广告报表下载）| 广告/广告报表 | ⚙️ Ads独立链路 | ads_entities/report | — | Amazon Ads 独立权限入口，非 SP-API 同步表 |
| ads/manager（广告管理）| 广告/分类广告 | ⚙️ Ads独立链路 | ads_entities/report | — | Amazon Ads 独立权限入口，非 SP-API 同步表 |
| ads/operation-record（广告操作记录）| 广告/分类广告 | ⚙️ Ads独立链路 | ads_entities/report | — | Amazon Ads 独立权限入口，非 SP-API 同步表 |
| ads/rules（广告规则）| 广告/广告报表 | ⚙️ Ads独立链路 | ads_entities/report | — | Amazon Ads 独立权限入口，非 SP-API 同步表 |
| finance/currency（财务币别）| 财务/配置 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（finance本地域） |
| finance/report-item（报表项目）| 财务/财务报表 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（finance本地域） |
| finance/report-template（报表模板）| 财务/财务报表 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（finance本地域） |
| finance/subjects（科目管理）| 财务/配置 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（finance本地域） |
| finance/voucher（查凭证）| 财务/凭证管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（finance本地域） |
| finance/voucher-type（凭证字管理）| 财务/配置 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（finance本地域） |
| product/brand（品牌管理）| 产品/产品属性 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| product/category（品类管理）| 产品/产品属性 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| product/consumable（辅料管理）| 产品/辅料包材 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| product/file-resources（文件资源）| 产品/工具 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| product/master（产品管理）| 产品/基础产品 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| product/notices（团队公告）| 产品/工具 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| product/package（箱子管理）| 产品/辅料包材 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| product/sku-relation（SKU配对）| 产品/平台配对 | ✅ 已接 | `listings` | 165 | SKU配对——Listing快照(MSKU关系为本地数据) |
| product/tags（标签管理）| 产品/基础产品 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| purchase/change（采购换货单）| 采购/采购管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| purchase/consumable（发货准备）| 采购/采购管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| purchase/orders（采购单）| 采购/采购管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| purchase/payment-request（请款单）| 采购/采购管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| purchase/process（加工单）| 采购/采购管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| purchase/quote（采购报价单）| 采购/供应协同 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| purchase/supplier（供应商）| 采购/供应协同 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| sales/chapin-guanli（差评管理）| 销售/评论&绩效 | ✅ 已接 | `customer_feedback` | 0 | 差评管理——客户反馈观察 |
| sales/cuxiao-baogao（促销报告）| 销售/listing | ✅ 已接 | `promotions` | 0 | 促销报告——促销观察 |
| sales/dianpu-jixiao（店铺绩效）| 销售/评论&绩效 | ✅ 已接 | `sales_traffic_daily` | 5 | 店铺绩效——销售流量快照 |
| sales/dingdan-liebiao（订单列表）| 销售/订单管理 | ✅ 已接 | `orders` | 136 | SP-API 已入库订单当前事实（近30天） |
| sales/fba-feiyong（FBA费用）| 销售/FBA报表 | ✅ 已接 | `fee_preview` | 0 | FBA费用——费用预览快照 |
| sales/fba-zhixiao（FBA滞销）| 销售/FBA报表 | ✅ 已接 | `recommended_removals` | 0 | FBA滞销——推荐移除报告 |
| sales/jinri-dingdan（今日订单）| 销售/订单管理 | ✅ 已接 | `orders` | 136 | 最近1天已入库订单 |
| sales/liuliang-baobiao（流量报表）| 销售/FBA报表 | ✅ 已接 | `sales_traffic_daily` | 5 | 店铺逐日流量快照（近7天） |
| sales/qushi-fenxi（趋势分析）| 销售/listing | ✅ 已接 | `sales_traffic_daily` | 5 | 店铺逐日趋势（近7天） |
| sales/shangpin-fenxi（商品分析）| 销售/listing | ✅ 已接 | `listings` | 165 | 最近成功发布的 Listing 快照 |
| sales/shangpin-sousuo（商品搜索）| 销售/listing | ✅ 已接 | `listings` | 165 | 从最近已发布 Listing 快照搜索 |
| sales/shoudong-dingdan（手动订单）| 销售/订单管理 | ⭕ 保持CRUD | — | — | 非同步数据表（授权/配置/手工录入） |
| sales/tuihuo-dingdan（退货订单）| 销售/订单管理 | ✅ 已接 | `returns` | 9 | 单份已发布 FBA 退货报告 |
| sales/xiaoliang-xiangqing（销量详情）| 销售/listing | ✅ 已接 | `order_items` | 0 | 订单商品行粒度，当前站点明细可能未采集 |
| sales/xiaoshou-baobiao（销售报表）| 销售/listing | ✅ 已接 | `sales_traffic_daily` | 5 | 店铺逐日销售流量（近7天） |
| sales/xiaoshou-jihua（销售计划）| 销售/listing | ✅ 已接 | `sales_traffic_daily` | 5 | 销售计划——销售流量趋势参考 |
| sales/yichu-dingdan（移除订单）| 销售/订单管理 | ✅ 已接 | `removal_order_report` | 0 | 移除订单——移除订单报告 |
| settings/ali1688-bind（1688绑定）| 设置/授权管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| settings/departments（部门管理）| 设置/授权管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| settings/feishu（飞书绑定）| 设置/授权管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| settings/logistics-bind（物流绑定）| 设置/授权管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| settings/roles（?）| - | ⭕ 保持CRUD | — | — | 无对应亚马逊同步表 |
| settings/stores（店铺管理）| 设置/授权管理 | ⭕ 保持CRUD | — | — | 非同步数据表（授权/配置/手工录入） |
| settings/transparency（透明计划授权）| 设置/授权管理 | ⭕ 保持CRUD | — | — | 非同步数据表（授权/配置/手工录入） |
| settings/users（?）| - | ⭕ 保持CRUD | — | — | 无对应亚马逊同步表 |
| shipment/address（发货地址）| 发货/物流海关 | ⭕ 保持CRUD | — | — | 非同步数据表（授权/配置/手工录入） |
| shipment/channel（渠道管理）| 发货/物流报价 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| shipment/customs（海关报价）| 发货/物流海关 | ⭕ 保持CRUD | — | — | 非同步数据表（授权/配置/手工录入） |
| shipment/handling（货件处理）| 发货/发货管理 | ✅ 已接 | `fba_shipments` | 3507 | 货件处理——FBA入库货件报告 |
| shipment/quote（集中询价）| 发货/物流报价 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| shipment/quote-order（报价单）| 发货/物流报价 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| shipment/quote-setting（关联设置）| 发货/物流报价 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| shipment/ship-plan（FBA发货规划）| 发货/发货管理 | ✅ 已接 | `fba_shipments` | 3507 | FBA发货规划——FBA入库货件报告 |
| shipment/shipment（发货单）| 发货/发货管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| shipment/track（货件跟踪）| 发货/发货管理 | ✅ 已接 | `fba_shipments` | 3507 | 货件跟踪——FBA入库货件报告 |
| shipment/transportation（物流公司）| 发货/物流海关 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| system/admins（管理员号）| 系统/用户管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| system/announcements（公告发布）| 系统/系统管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| system/client-orders（客户订单）| 系统/用户管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| system/clients（客户管理）| 系统/用户管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| system/codegen（代码生成）| 系统/开发管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| system/dictionaries（数据字典）| 系统/系统管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| system/docs（文档API）| 系统/开发管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| system/fba-centers（FBA中心配置）| 系统/系统管理 | ⭕ 保持CRUD | — | — | 非同步数据表（授权/配置/手工录入） |
| system/fba-fees（FBA费设置）| 系统/系统管理 | ⭕ 保持CRUD | — | — | 非同步数据表（授权/配置/手工录入） |
| system/menus（管理菜单）| 系统/系统管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| system/migration（数据迁移）| 系统/开发管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| system/online（在线客户）| 系统/用户管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| system/packages（套餐管理）| 系统/用户管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| system/roles（系统角色）| 系统/用户管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| system/tasks（系统任务）| 系统/系统管理 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（sys本地域） |
| warehouse/address（仓库地址）| 仓库/基础信息 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| warehouse/base（仓库列表）| 仓库/基础信息 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| warehouse/exchange（代料单）| 仓库/出入库 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| warehouse/inbound（入库单）| 仓库/出入库 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| warehouse/outbound（出库单）| 仓库/出入库 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| warehouse/shelf（库位列表）| 仓库/基础信息 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| warehouse/stocktake（库存盘点）| 仓库/出入库 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |
| warehouse/transfer（调库单）| 仓库/出入库 | ⭕ 保持CRUD | — | — | 亚马逊API无对应数据（erp本地域） |

## 四、诚实边界

- 利润类页（利润报表/店铺利润/批次成本/库存货值）只接亚马逊返回的**收入侧/库存数量侧**真实数据；采购成本、头程费、本地分摊是 ERP 本地数据，亚马逊 API 不返回，完整利润需本地计算，页面不造利润数。

- 5 个语义对应页（差评/促销/FBA费用/FBA滞销/移除订单）数据集当前站点为 0 行，页面已显示空态说明；一旦同步覆盖即自动显示真实数据。

- 4 个广告页需独立 Ads 链路，本批未纳入通用只读工作台，未虚报完成。

- 55 个 ERP 本地业务页（仓储/采购/财务凭证/系统/授权）亚马逊 API 无对应数据，保持主数据 CRUD 是正确映射，不是遗漏。

