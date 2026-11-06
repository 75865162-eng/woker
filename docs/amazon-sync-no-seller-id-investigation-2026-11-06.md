# 不手填 Seller ID 的同步路径核查

核查日期：2026-11-06。依据用户提供的《亚马逊SP-API新人配置指南.md》、Amazon 官方文档与模型、当前源码和服务器只读查询。本记录是核查结论，不代表下列修复已实现或真实同步已开始。

## 结论

用户无需手填 Seller ID，也可以读取 Listing。现有实现将特定接口的参数要求扩大为全局前置条件，导致已经验证的 Refresh Token 无法进入业务同步。这是当前接入与初始化逻辑不足，不能解释成用户必须补充卖家编号。

两条官方路径必须区分：

1. 公共应用 OAuth 回调自动返回 `selling_partner_id`，应用保存后可使用 Listings Items 的路径参数；用户无需手输。私有应用自助授权只取得 Refresh Token，不能假定已经走过此回调。
2. Reports `createReport` 的必填业务参数为 `reportType` 和 `marketplaceIds`。`GET_MERCHANT_LISTINGS_ALL_DATA` 返回全量 Listing 报表，无 Seller ID 请求参数；每份报告仅指定一个正常销售 Marketplace。支持的列包含 seller-sku、asin1、item-name、price、quantity、fulfillment-channel、status 等。它是当前商品快照，不等同完整 Listings Items 属性，也不重建 730 天 Listing 历史。

## 已核实的本地缺口

- `src/lib/amazon/sp-api-client.ts` 的 `searchListingsItems` 与 `getListingDetail` 采用带 sellerId 的 Listings Items 路径。现有 catalog processor 使用前者，尚未接入 All Listings Report。
- `service.ts` 的保存数据源、创建任务，以及 scheduler 的自动发现，对所有资源统一要求非空 amazonSellerId。库存、Orders、Reports 等请求本身并非均需此参数。
- 自动计划发现只接受既有数据源；授权验证成功不会自动建立店铺、站点和数据源。因此任务数为 0 不只是显示问题。
- `readOverview` 的 connectedStores 从数据源推算；没有来源时，即使已有验证授权也显示 0，且没有区分“授权连接”和“业务同步绑定”的指标。
- `automaticMarketplaces` 目前仅含美国、加拿大；墨西哥、巴西未进入自动计划。
- `extractMarketplaceParticipations` 当前未保留 participation.isParticipating，并包含 Non-Amazon/影子站点；后续需依据实际参与标志和官方销售站点映射处理，不能把区域内所有返回记录当作正常销售站点。
- Orders、Finance、Returns 的业务唯一键包含 amazonSellerId。允许其为空前必须调整可靠的授权/来源归属及幂等键，避免不同授权记录串数据；不得把虚构编号写入 Amazon 身份字段。

## 服务器只读现状

- 1 条北美授权，状态 CONFIGURED，手动凭证路径，Seller ID 为空。
- 保存的返回列表包含美国、加拿大、墨西哥、巴西 4 个正常销售站点，另有 3 个 Non-Amazon 和 1 个 Invoicing Shadow Marketplace。这支持用户关于“1 个授权账号、4 个正常销售站点”的判断；旧存储未保留 isParticipating，不能据此证明每站点当前均可执行所有业务接口。
- 授权的 approvedRoles 为空。这是 ERP 内没有记录角色声明，不代表已经实测 Amazon 拒绝业务接口，也不能自动填写为已验证角色。
- 上次只读业务统计：SellerAccount、AmazonSyncDataSource、AmazonSyncSchedule、AmazonSyncRun 均为 0。

## 后续修复边界

按授权建立内部店铺身份，正常销售站点分别建立数据源；保留组织/工作区、授权 revision、访问控制、审计和幂等边界。私有 Token 连接优先用全量 Listing 报表读取商品；OAuth 已知卖家身份时保留现有 Listings Items 能力。API 权限按真实响应/既有明确证据处理，不伪造角色或“验证成功”。

历史域以 730 天为目标分段回溯，遵守各 API 的历史保留和窗口限制；当前快照域不能被展示为已经回溯 730 天。新连接、自动建源、跨站点范围、幂等键及可能需要的 migration 应一起离线验证，再按 CI artifact 链路发布。发布前说明完整改动范围；不得为了本次核查直接修改生产绑定或启动真实请求。

## 官方依据

- [All Listings Report](https://developer-docs.amazon.com/sp-api/docs/report-type-values-inventory)：报告类型、角色、单站点限制、列契约、BOM 与 locale/cache 说明。
- [Reports 官方模型](https://github.com/amzn/selling-partner-api-models/blob/main/models/reports-api-model/reports_2021-06-30.json)：CreateReportSpecification 必填字段与请求结构。
- [Website authorization workflow](https://developer-docs.amazon.com/sp-api/docs/website-authorization-workflow)：回调中的 selling_partner_id、state、spapi_oauth_code。
- [Listings Items 官方模型](https://github.com/amzn/selling-partner-api-models/blob/main/models/listings-items-api-model/listingsItems_2021-08-01.json)：指定操作 sellerId 的必填路径参数。此次下载因超时仅取得模型前段，getListingsItem 参数已可核实；本地 searchListingsItems 调用路径另由源码确认，不将不完整下载描述为完整模型核验。
- [Sellers 官方模型](https://github.com/amzn/selling-partner-api-models/blob/main/models/sellers-api-model/sellers.json)：参与站点及 getAccount 响应；getAccount 不提供可替代 OAuth 回调的 sellerId 字段，并包含额外账户信息，不能为找编号盲目读取。
