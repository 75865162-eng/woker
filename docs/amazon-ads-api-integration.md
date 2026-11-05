# Amazon Ads API 接入基线

本地实现采用独立于 SP-API 的 Amazon Ads OAuth、Profile、同步计划、同步任务、实体快照和日报事实模型。OAuth 与 Profile 发现由管理员主动连接触发；Profile 绑定 ERP 店铺后自动建立同步计划。自动计划默认关闭且按组织/工作区 allowlist 限定。当前真实 Campaign/Ad Group/Keyword/Target/Report 读取 adapter 尚未完成官方契约核验，worker 会在 token refresh 和广告请求前阻断，不能把凭证已配置误认为真实数据已同步。

## 官方核验结果

核验日期：2026-11-05。来源均为 Amazon Ads API 官方文档。

| 能力 | 官方契约 | 实现影响 |
| --- | --- | --- |
| OAuth 授权 | LwA Authorization Code Grant；scope `advertising::campaign_management`；`response_type=code` | 不复用 SP-API OAuth 状态或凭证 |
| 同意域 | NA `www.amazon.com/ap/oa`；EU `eu.account.amazon.com/ap/oa`；FE `apac.account.amazon.com/ap/oa` | 授权时必须选择匹配广告账户的区域 |
| Token exchange / refresh | NA `api.amazon.com/auth/o2/token`；EU `api.amazon.co.uk/auth/o2/token`；FE `api.amazon.co.jp/auth/o2/token` | 按同意区域调用 LwA token host |
| Token 生命周期 | access token 60 分钟；2026-07-30 及以后签发的 refresh token 有效期 365 天 | 只持久化 AES-GCM 加密的 refresh token；记录 refresh token 到期日 |
| Profile 发现 | `GET /v2/profiles`；Profile 含 `profileId`、`countryCode`、币种、时区及账户信息 | 授权成功后按 NA/EU/FE 区域 host 自动发现并持久化 |
| 普通 API 身份 | Client ID、Bearer access token、`Amazon-Advertising-API-Scope`；请求一次只作用于一个 Profile | 多 Profile 同步必须按 Profile 分区 |
| API host | NA `advertising-api.amazon.com`；EU `advertising-api-eu.amazon.com`；FE `advertising-api-fe.amazon.com` | 依 Profile 区域选择 API host |
| 新 Reporting API v1 | 官方建议新接入评估 v1；提供多维、跨广告产品与跨账户报告 | 与旧版 Sponsored Ads v3 报告字段分层适配，禁止直接合并口径 |
| Reporting v1 归因 | 转化按 traffic date；SP 默认卖家 7 天、供应商 14 天 lookback；其他 campaign type 通常 14 天 | 报表事实必须保留 API 版本、广告产品、traffic date 与归因口径 |
| Reporting v1 容量 | 每个 Client ID 同时一个 report；官方估算平均每天约 100 份报告 | 历史回溯/多 Profile 调度要做全局限流，不能为每个 Profile 独立放大并发 |

官方来源：

- https://advertising.amazon.com/API/docs/en-us/reference/api-overview
- https://advertising.amazon.com/API/docs/en-us/guides/get-started/overview
- https://advertising.amazon.com/API/docs/en-us/guides/get-started/create-authorization-grant
- https://advertising.amazon.com/API/docs/en-us/guides/get-started/retrieve-access-token
- https://advertising.amazon.com/API/docs/en-us/guides/get-started/retrieve-profiles
- https://advertising.amazon.com/API/docs/en-us/guides/reporting/ads-v1/overview

## 已实现

- Ads 专属授权、Profile、OAuth attempt 表；组织/工作区隔离。
- OAuth attempt 使用随机 state，数据库只存 SHA-256，10 分钟过期且一次性认领。
- Refresh token 使用 Ads 专属 `AMAZON_ADS_ENCRYPTION_KEY` AES-256-GCM 加密，AAD 绑定 organization/workspace/authorization；access token 不落库。
- LwA 客户端配置只从服务端环境读取：`AMAZON_ADS_LWA_CLIENT_ID`、`AMAZON_ADS_LWA_CLIENT_SECRET`、`AMAZON_ADS_OAUTH_REDIRECT_URI`。本地未写入真实配置。
- Profile 由 `/v2/profiles` 自动发现；账户页显示服务端已保存的真实 Profile，不以 Mock 业务指标冒充已授权数据。
- 管理员可将 Profile 关联到当前组织/工作区中的活动 ERP 店铺；API 不返回任何 OAuth token。
- OAuth 与 Profile HTTP transport 支持 fetch 注入；离线测试不会联网。
- Ads 任务具有幂等键、派发版本、租约/围栏、重试字段、历史范围、计数、错误状态和加密分页检查点；实体使用 Profile + entity type + Amazon ID 作为 upsert key；日报事实保留 API 版本、归因窗口、维度原文和业务键。
- Ads API 请求按 Client ID SHA-256 摘要协调全局租约；不同 Profile 共享同一请求闸门，租约过期可恢复，不持久化原始 Client ID。
- Profile 授权且绑定活动 ERP 店铺后建立日计划；调度器只处理 `AMAZON_ADS_SYNC_SCOPES` 明确列出的组织/工作区，支持丢失队列任务恢复和过期租约回收。自动同步默认关闭。
- 同步错误按生命周期区分：可重试故障保留检查点并退避；达到重试上限后标记 `FAILED`；授权/店铺/计划范围等终止错误标记 `BLOCKED`；读取 adapter 尚未就绪时标记 `WAITING_FOR_ADAPTER`。无效 allowlist 会整体关闭自动同步，重复 scope 会去重。
- OAuth 重连只对 Amazon 明确成功返回的区域做 Profile 对账；旧 Profile 未再出现时保留 Profile、任务和事实历史，阻断其计划并围栏取消未完成任务。区域发现失败不会触碰该区域旧 Profile；Profile 后续重新出现时由计划对账逻辑重新评估。
- 配置入口为 `AMAZON_ADS_SYNC_ENABLED=true` 与 `AMAZON_ADS_SYNC_SCOPES=[["<organizationId>","<workspaceId>"]]`；即使设置完成，adapter 未核验前计划仍显示等待，不发起广告结构/报表请求。

## 尚未实现或需要继续核验

- OAuth 新账号首次授权与跨区域登录的人类验收；官方建议额外调用 LwA `GET /user/profile` 记录 `user_id`，诊断错误的区域账号，目前尚未接入该核验。
- SB、SD、SP Campaign Management v1 与旧 v3 的具体实体端点、字段、分页和广告产品可用性矩阵。
- Reporting v1 Search Term、Placement、Advertised Product 的具体 report query schema、维度组合、指标可用性、最小/最大日期范围、延迟窗口与保留范围。
- 旧版 v3 报表各类型回溯范围、限流、报告生成/下载状态及重试语义；当前没有实现任何报表 worker。
- 当前读取 adapter 为 fail-closed scaffold。SP/SB/SD 实体与报表 transport 完成官方契约核验、fixture 和隔离测试后，才可启用 `adsReadAdapterReady()`；不能只设置环境变量绕过。
- 官方公开文档确认了每日平均容量，不等同于固定配额或 SLA；需通过 API Integration Dashboard 和隔离测试继续验证。
- 店铺 Profile 映射的运营验收与授权账户撤销/重连行为。

此文档不能视为 Amazon Ads 真实授权或 API 已在当前 ERP 环境启用的证明。
