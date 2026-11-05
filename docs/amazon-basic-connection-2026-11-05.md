# Amazon 基础连接配置与请求边界

日期：2026-11-05。按用户提供的《亚马逊SP-API新人配置指南.md》基础流程收敛手动连接验证。

## 配置与外部请求

- 基础配置：自定义授权名称、LWA Client ID、Client Secret、Refresh Token 和目标区域。endpoint 由区域选择，不允许任意主机。
- 名称仅是本系统标签，不向 Amazon 发送，也不替代真实 Seller ID。
- Seller ID 与管理员角色声明放在可选的“业务同步配置”折叠区，不再阻止基础连接保存。更新空 Seller ID 可以补入真实编号；已有非空身份仍不可原地替换。
- 验证请求只有两步：POST `https://api.amazon.com/auth/o2/token`（grant_type、refresh_token、client_id、client_secret），GET 官方区域端点 `/sellers/v1/marketplaceParticipations`。GET 无 body，无 Seller ID 或店铺名称查询参数。
- 已移除手动验证中逐站点 searchListingsItems 请求；不读取商品、库存、订单或其他业务数据，不自动启动同步。
- 连接验证通过仅说明本次令牌与参与站点接口可用，不代表 Seller 身份、商品/订单/库存权限已验证，也不更新为 OAuth 身份证据。
- 现有审批、密文存储、错误脱敏保留。OAuth 为独立主动授权入口，不由手动基础连接调用；既有业务同步不因本次改动自动执行。

## 兼容与数据边界

本次不改 schema 或执行 migration。既有必填字符串列用空字符串表达“未提供 Seller ID”，绝不生成或发送假编号。现有唯一键使一个组织/工作区/区域最多有一条尚未补身份的基础连接；再次新增时提示更新已有连接。正式绑定数据源或创建同步任务前检查非空真实编号；名称不能作为编号。已存在授权与绑定不自动删除、改写或重新验证。

影响范围：手动授权编辑、保存审批、验证 service 与数据源/任务前置校验。回滚：撤回相应代码和测试；保留凭证、审计和授权记录。旧版强制 Seller ID 的 UI 无法直接编辑空身份连接，回滚后需人工补真实编号，不能自动用昵称回填。

## 验证

- 27 项授权/审批/同步策略测试通过，包含无 Seller ID 的申请→批准→保存（禁止外部 HTTP），以及精确验证两个请求和 LWA 参数集合。
- 10 项授权相关浏览器测试通过，覆盖不展开业务区、Seller ID 留空、三项凭证提交、失败保留表单、批准/应用独立操作。
- TypeScript、8 个修改文件定向 ESLint、定向 `git diff --check` 通过。
- `check:fast` 的 737 项单元测试通过；全仓 lint 被现有生成目录与其他既有问题阻断，未使用自动修复；类型检查另行通过。
- 全浏览器测试 28/29 通过，失败是现有订单域说明从 P1 更新后旧断言未更新，与本次基础连接无关。
- disposable integration 无法完成：fixture schema 缺少当前 Prisma client 所需 `AmazonSyncDataSource.financePolicy`，16 项因前置初始化失败，不能记为通过。本次不为解决该问题修改财务 schema 或测试 runner。
- 未运行生产 build、真实 API/凭证验证、真实库 migration、worker、重启或部署；未提交或推送。工作区同时存在其他订单/财务等改动，本次验收仅覆盖上述基础连接范围。
