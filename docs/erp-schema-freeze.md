# Skill / ERP 数据接入：Schema 冻结记录

更新：2026-11-06。范围：依据本地代码和《Skill接口与亚马逊字段映射.xlsx》做静态核实；未连接数据库、未调用 MCP、未请求 Amazon 或其他外部服务。

## 结论

本系统已经实现面向 Amazon 已同步数据的 MCP 服务，入口为 `/api/mcp/amazon`，管理入口为 `/api/operations/amazon-mcp`。当前 MCP 暴露 15 个工具，包括只读 Ads 结构工具 `amazon.ads.entities.list`、只读 Ads 报表工具 `amazon.ads.reports.list` 和通用 Skill 的 `data_list_tables`、`data_describe_table`、`data_query`、`data_sync_status`、`data_sync_start`。凭证工具范围与当前 ERP 店铺授权取交集，不能扩大授权。报表工具必须单独显式授予；旧凭证不会自动获得此权限，通用 `data_query(ads_report_daily)` 也要求该授权。

通用 Skill 查询支持 4 张逻辑表：库存、刊登、店铺日销售流量，以及 Ads 日报 `ads_report_daily`。Ads 日报只在当前授权 Seller/Marketplace 有成功任务发布的版本时出现在表目录中；修订版本按事实键取最近发布值，失败/暂存版本和旧版无版本数据不可查询。接口按当前凭证及实时 ERP 店铺授权过滤，禁止任意表、字段和排序透传，单页最多 1,000 行。`data_sync_start` 只创建既有数据处理中心的审批申请，审批并应用前不创建或执行同步任务。真实 Amazon Ads adapter 仍关闭，当前工作区没有真实 Ads 样本，因此该表的来源字段状态仍为 `application_schema_confirmed_source_sample_pending`，不代表已同步或真实口径已验收。

Skill 读取表当前只支持库存、刊登和销售流量三个同步域的申请；订单、财务、退货和其他数据域不通过 Skill 触发同步。新工具是明确加入新建凭证时的授权选项，既有凭证范围不会自动扩大；创建新的 Skill 凭证后再在 Codex MCP 客户端配置使用。

## 已能从代码确认的数据模型

| 数据域 | 已有事实数据边界 | 已确认粒度 / 限制 | Skill MCP 状态 |
| --- | --- | --- | --- |
| 库存 | `AmazonInventorySnapshot` + `AmazonSyncDataSource` + 成功发布的 `AmazonSyncRun` | 店铺、站点、SKU、condition、同步快照；只能读成功发布版本 | `amazon.inventory.list`、`amazon.inventory.summary`、`amazon.history.read` |
| 刊登 | `AmazonCatalogSnapshot` + 数据源和成功发布任务 | 店铺、站点、SKU、同步快照；当前 MCP 字段为 SKU、ASIN、刊登状态和履约类型 | `amazon.catalog.list`、`amazon.history.read` |
| 销售与流量 | `AmazonSalesTrafficSnapshot` + 已发布报告版本 | 店铺逐日汇总；不支持 SKU、ASIN 或订单粒度查询。金额保留原币种 | `amazon.sales.list`、`amazon.sales.export` |
| 店铺/站点与同步状态 | `SellerAccount`、Amazon 身份/授权、数据源及同步任务 | 仅暴露当前用户授权且身份验证通过的数据源 | `amazon.stores.list`、`amazon.sync.status` |
| 订单、财务、退货及其他报告域 | 有同步服务/模型和独立读取边界 | 有实现不代表当前范围已有成功发布数据；须从当前数据源状态逐店铺核对 | 尚未由现有 MCP 工具暴露 |
| Ads | 独立 `AmazonAdsProfile`、结构快照和日报事实；Skill 可查询已发布 Ads 日报版本 | 结构查询限已绑定且授权的 Profile；指标保留空值、币种和版本；目前无真实来源样本 | `amazon.ads.entities.list`、`amazon.ads.reports.list`、`data_query(ads_report_daily)` |

Skill 通用表目录目前公布当前授权范围内有成功发布数据的表：`inventory`、`listings`、`sales_traffic_daily`、`ads_report_daily`。字段说明反映应用规范化快照模型，不代表 Amazon 原始 Ads 报表字段映射已经通过真实样本复核。描述接口返回 `application_schema_confirmed_source_sample_pending`，待样本验收后再收紧状态。

设置页「Skill / ERP」的可用性面板按当前登录用户的授权动态显示逻辑表是否有成功发布数据、来源数、同步记录行数、最近同步时间和新鲜度；可授权工具目录与凭证创建选项使用同一服务端注册表。无权限时不会返回店铺或表来源明细；该面板只读元数据，不执行同步或创建凭证。Ads 报表版本查询仍不启用真实报告 adapter；真实数据库迁移、真实 Ads 请求和样本验收不属于本轮。

## 工作簿接口决策

工作簿列出的 17 个未暴露接口按用户确认的目标分类如下：

| 类别 | 数量 | 决策 |
| --- | ---: | --- |
| Ads 专题只读（ad group/ASIN/campaign 结构、趋势、贡献度） | 7 | 先核对现有 Ads 报告数据与 Schema；无真实来源时保持未启用 |
| Ads 执行 | 2 | 只产调整草稿；后续复用既有审批及 Agent Gateway，不直写 Amazon |
| Listing 执行 | 1 | 只产 Listing 变更草稿 |
| Restock 执行 | 5 | 只产补货操作草稿，不直接创建、取消或提交外部订单 |
| ASIN 关键词信号 | 1 | 仅在发现已验证的数据来源后接只读查询 |
| 市场访问范围 | 1 | 返回系统已验证的 Seller/Marketplace 授权范围；不宣称其证明 Amazon 项目资格 |

## 实施门槛

1. 首批店铺、站点和数据域从当前同步中心中已存在且身份验证通过的数据源动态读取；MCP 仍按当前用户授权过滤。
2. 先按真实来源和粒度建立逻辑表映射。`ProductRecord` 继续是商品主数据事实源；Amazon 快照仅代表外部观察数据，不覆盖商品主档。
3. 数据域、字段映射和指标必须分别记录来源、粒度、币种/归因窗口、空值规则及证据状态。未验证项保持 blocked/unverified，不能用占位字段补齐。
4. 扩大多人数据隔离和组织/用户级映射配置需要另行设计；当前改动复用现有组织、工作区和店铺授权检查。
