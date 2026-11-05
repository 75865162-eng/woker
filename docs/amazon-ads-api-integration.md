# Amazon Ads API 接入基线

本地实现采用独立于 SP-API 的 Amazon Ads OAuth、Profile、同步计划、同步任务、实体快照和日报事实模型。OAuth 与 Profile 发现由管理员主动连接触发；Profile 绑定 ERP 店铺后自动建立同步计划。自动计划默认关闭且按组织/工作区 allowlist 限定。Sponsored Products Campaign、Ad Group、Keyword、Target 及两级 Negative list 已有官方合同核验和隔离 transport readers，但未进入生产 adapter；具体 Report 类型读取仍未完成。worker 仍会在 token refresh 和广告请求前阻断，不能把凭证已配置误认为真实数据已同步。

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
| Sponsored Products v3 Campaign list | `POST /sp/campaigns/list`；`application/vnd.spCampaign.v3+json`；ClientId、Scope、Bearer 为必需身份头；响应含 `campaigns`、`nextToken`、`totalResults`；`includeExtendedDataFields=true` 返回扩展更新时间字段 | 本轮只实现隔离的只读 transport factory；翻页传回 `nextToken`，不接入 worker |
| Sponsored Products v3 Ad Group list | `POST /sp/adGroups/list`；`application/vnd.spAdGroup.v3+json`；权限 `advertiser_campaign_edit` 或 `advertiser_campaign_view`；请求支持 `campaignIdFilter`、`maxResults`、`nextToken` 等；响应含 `adGroups`、`nextToken`、`totalResults` | 隔离 reader 校验必填 adGroupId/campaignId/name/state/defaultBid，并将 campaignId 保留为 parentExternalId；使用 API 默认页大小 |
| Sponsored Products v3 Keyword/Target list | `POST /sp/keywords/list` (`application/vnd.spKeyword.v3+json`)；`POST /sp/targets/list` (`application/vnd.spTargetingClause.v3+json`)；支持 `includeExtendedDataFields`、ID/state filters、`maxResults`、`nextToken`；响应含相应 collection、`nextToken`、`totalResults` | 离线 readers 保留 keyword/target ID、Campaign 与 Ad Group 关系、原始字段和扩展更新时间；枚举/父级字段 fail-closed |
| Sponsored Products v3 Negative list | 广告组级：`POST /sp/negativeKeywords/list`、`POST /sp/negativeTargets/list`；Campaign 级：`POST /sp/campaignNegativeKeywords/list`、`POST /sp/campaignNegativeTargets/list`；各端点使用独立媒体类型和响应 collection | 隔离 readers 分开保存广告组级与 Campaign 级实体；Campaign 级 parent external ID 为 campaignId。所有 reader 未接入生产 adapter，SP 否定对象之外的广告产品范围也未覆盖 |
| Campaign list 权限与错误 | API reference 要求 `advertiser_campaign_edit` 或 `advertiser_campaign_view`；列出 400、401、403、415、429、500；429 的 `Retry-After` 为建议等待秒数 | 401/403 按终止错误处理；429 与 5xx 可重试，错误体不进入应用错误信息 |
| Reporting v1 create/retrieve | `POST /adsApi/v1/create/reports` 接受 `CreateReportRequest`；`POST /adsApi/v1/retrieve/reports` 按单个 `reportId` 查询；响应以 `success[]/error[]` 表达多状态 | 异步报告需持久化 report ID 并轮询 `PENDING` / `PROCESSING` / `COMPLETED` / `FAILED`；HTTP 成功不代表报告已完成 |
| Reporting v1 下载分片 | 完成报告可返回最多 100 个 `completedReportParts`；每个分片提供 URL、字节大小与 URL 过期时间；格式含 CSV、GZIP_JSON、PARTITIONED_CSV、PARTITIONED_GZIP_JSON | 下载 URL 是短期地址；须按已核验的 URL 安全、大小、压缩、分片完整性和格式解析规则处理，不能把 report metadata 当作事实数据 |
| Reporting v1 创建权限/周期 | OpenAPI 列出多种可创建权限；请求每次 `reports` 仅 1 项，`periods` 仅 1 项，日期周期含 start/end date | 按 Profile 授权和具体报告类型选择权限、fields/filter/日期边界；OpenAPI 通用 schema 不构成各报告的指标/维度合同 |
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
- https://d1y2lf8k3vrkfu.cloudfront.net/openapi/en-us/dest/AmazonAdsAPIALLReportsContract_prod_3p.json
- https://d1y2lf8k3vrkfu.cloudfront.net/openapi/en-us/dest/SponsoredProducts_prod_3p.json
- https://advertising.amazon.com/API/docs/en-us/sponsored-products/3-0/openapi/prod#tag/Campaigns/operation/ListSponsoredProductsCampaigns

Campaign list 核验日期：2026-11-06。使用页面提供的 OpenAPI JSON 下载 `https://d1y2lf8k3vrkfu.cloudfront.net/openapi/en-us/dest/SponsoredProducts_prod_3p.json` 核对 `/sp/campaigns/list`：`maxResults` 没有声明上下限，因此 reader 使用 API 默认分页大小，并将单页超过 1000 条视为本地超限，而不将其声明为 Amazon 配额。OpenAPI 要求每个 Campaign 具备 `budget`、`campaignId`、`name`、`startDate`、`state`、`targetingType`；reader 对这些字段 fail-closed。Campaign 响应扩展数据不完整性与特定站点可用性仍需隔离账号之外的官方证据，真实账户验收另行审批。

Ad Group list 核验日期：2026-11-06。使用同一 OAS 3.0.1 JSON 核对 `/sp/adGroups/list`。request schema 没有声明 `maxResults` 上下限，response 的 `adGroups` 明确最多 1000 项；每行必需 `adGroupId`、`campaignId`、`defaultBid`、`name`、`state`。reader 将 campaignId 保存为父实体引用并以 `includeExtendedDataFields=true` 请求服务端更新时间。此 reader 同样只供 fixture 验证，不接入 worker readiness。

Sponsored Products v3 Keyword/Target/Negative list 核验日期：2026-11-06。使用官方 `SponsoredProducts_prod_3p.json` 检查 `/sp/keywords/list`、`/sp/targets/list`、`/sp/negativeKeywords/list`、`/sp/negativeTargets/list`、`/sp/campaignNegativeKeywords/list`、`/sp/campaignNegativeTargets/list`。各端点均使用 `nextToken` 分页并支持 `includeExtendedDataFields`；request `maxResults` 没有声明统一边界，因此 readers 使用默认页大小，通用本地页上限保持 1000。广告组级对象要求 Campaign/Ad Group 归属，Campaign 级否定对象只以 Campaign 为父级；Keyword 含 matchType/text，Target 含 expression/resolvedExpression，keyword 可选 bid。否定词要求 `NEGATIVE_*` matchType。reader 保留原始 payload 与正确父级 ID。此实现仅覆盖 SP 只读 transport fixture，不代表其他广告产品或 live adapter 已同步。

Reporting v1 通用合同核验日期：2026-11-06。使用官方 OAS JSON 核对 `POST /adsApi/v1/create/reports`、`POST /adsApi/v1/retrieve/reports` 和 schema。创建请求包含 1 个 report、1 个日期周期和至少 1 个 query field；retrieve 请求含单个 report ID。报告状态枚举为 `PENDING`、`PROCESSING`、`COMPLETED`、`FAILED`；完成结果可能包含 0 至 100 个分片、每片 URL/大小/到期时间，以及解释字段缺失/脱敏/日期覆盖的 warnings。响应外层为 `success[]` / `error[]` 多状态结构，即使 HTTP 请求成功也必须检查业务结果。OpenAPI 通用合同没有证明任何具体 Sponsored Products 日报的可用字段、维度组合、日期上限、迟到修订期限、下载地址主机白名单或压缩/分片校验规则；这些项目按报告类型逐项核实前，不实现通用 report reader，不把任何日报 stage 标成 ready。

## 已实现

- Ads 专属授权、Profile、OAuth attempt 表；组织/工作区隔离。
- OAuth attempt 使用随机 state，数据库只存 SHA-256，10 分钟过期且一次性认领。
- Refresh token 使用 Ads 专属 `AMAZON_ADS_ENCRYPTION_KEY` AES-256-GCM 加密，AAD 绑定 organization/workspace/authorization；access token 不落库。
- LwA 客户端配置只从服务端环境读取：`AMAZON_ADS_LWA_CLIENT_ID`、`AMAZON_ADS_LWA_CLIENT_SECRET`、`AMAZON_ADS_OAUTH_REDIRECT_URI`。本地未写入真实配置。
- Profile 由 `/v2/profiles` 自动发现；账户页显示服务端已保存的真实 Profile，不以 Mock 业务指标冒充已授权数据。
- 管理员可将 Profile 关联到当前组织/工作区中的活动 ERP 店铺；API 不返回任何 OAuth token。
- OAuth 与 Profile HTTP transport 支持 fetch 注入；离线测试不会联网。
- Sponsored Products Campaign 与 Ad Group list transport 使用注入 fetcher 和 OpenAPI fixture 校验请求、必填响应字段、区域分页、父子关系及错误分类；不接入生产读取 adapter。
- Sponsored Products Keyword、Target、广告组级和 Campaign 级 Negative Keyword/Target reader 已使用注入 fetcher，通过官方 OpenAPI fixture 校验媒体类型、游标、实体 ID、父子关系、核心字段和枚举；所有 reader 均不接入生产读取 adapter。
- Reporting v1 envelope 纯解析器按官方通用 OpenAPI 校验单项 success/error、报告状态/格式/周期、warnings 与分片元数据；不下载分片、不输出临时 URL/上游错误正文，也不生成日报事实。
- 账户页按数据库记录的估算 refresh token 到期时间计算 60/30/7 天提示；缺少或无效日期明确显示“到期状态未知”，不伪造期限，也不另存一张可漂移的通知表。到期状态保持同步阻断。此站内提示不证明 Amazon 已撤销旧 token。
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
- 当前生产读取 adapter 为 fail-closed scaffold。Campaign/Ad Group reader 仅是可注入 fetch 的独立 transport，覆盖地区 host、请求头、游标、必填字段、父子关系和脱敏错误分类；未挂接 `amazonAdsReadAdapter`，`adsReadAdapterReady()` 仍为 false，不能由环境变量启用。
- Campaign list 的 429 `Retry-After` 按官方 schema 的秒数处理；缺失或非法时交由任务通用退避策略处理。解析器兼容 HTTP 日期格式，但官方合同只声明秒数。
- 官方公开文档确认了每日平均容量，不等同于固定配额或 SLA；需通过 API Integration Dashboard 和隔离测试继续验证。
- 店铺 Profile 映射的运营验收与授权账户撤销/重连行为。
- Reporting v1 单个报告类型的完整合同：reportType/query schema、字段及口径、Profile/account 身份、下载 URL 安全规则、格式/分片校验、错误重试和迟到修订窗口；通用 Reports OAS 只覆盖报告任务信封。
- Reporting v1 的 envelope 解析器目前仅为隔离纯函数；未发起 create/retrieve 请求、未接入 worker/checkpoint、未下载或解压报告，也未对任何 Amazon 指标做映射。

此文档不能视为 Amazon Ads 真实授权或 API 已在当前 ERP 环境启用的证明。
