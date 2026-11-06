# Amazon Ads API 接入基线

> 当前实施状态以文末「2026-11-06：获批的本地 P0 结构闭环」为准。前文离线阶段的 adapter 关闭描述是历史基线；本轮结构 adapter 已接线，但未启用真实任务，报告阶段仍阻断。

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

Product Ad 结构已在后续批次接入常规结构 worker、查询、既有已同步数据页和 MCP，见 [Product Ad 核心交付](./amazon-ads-product-ad-delivery-2026-11-06.md)。官方 OAS SHA256 `9ce8a6b6bc8b33d34d04b7ee416fd78be787699e932075d101941176a215df2e`：`POST /sp/productAds/list` 使用 `application/vnd.spProductAd.v3+json`；`SponsoredProductsProductAd` 必需 `adId/adGroupId/campaignId/state`，`sku`（seller）与 `asin`（vendor）均可选，不要求两者同时存在。响应集合 `productAds` 上限 1000，`nextToken` 分页；请求 `maxResults` 无声明上下限，继续使用 API 默认值。未执行真实账号请求，不据此宣称实际账户可用或广告商品表现日报已实现。

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


## 2026-11-06：获批的本地 P0 结构闭环（优先于前文离线状态）

本轮批准范围为 adapter/worker/现有实体存储/查询/UI 的本地实施与隔离验证；不含真实 API、真实任务、运行配置、数据库迁移、Git 提交推送或部署。期间工作区由其他任务产生新提交及 `amazon_ads_query_foundation` schema/migration/repository/query-service；本轮未改动这些 schema/migration，Prisma Client 仅做本地 generate。

| 范围 | 状态 | 证据与限制 |
| --- | --- | --- |
| SP 八类结构 adapter | 已完成并验证；真实环境未启用 | Campaign/Ad Group/Keyword/Target 与两级各两类 Negative，区域 endpoint、Amazon 外部 Profile header、独立 ID/父级、归档状态、分页、OTHER 表达式与脱敏错误；否定阶段每次派发一次请求，以版本化组合 cursor 保存具体 collection |
| worker → 快照 → 查询 | 已完成并验证（一次性 PG/Redis + fixture HTTP） | 复用租约/fence/checkpoint/队列；Prisma advisory lock 改用 executeRaw 避免 void 反序列化错误；结构结束标记 `COMPLETED_SP_STRUCTURE`，旧 reports checkpoint 在 token refresh 前阻断；成功只表示 SP 结构 |
| 当前实体存储 | 已完成并验证；不承诺历史版本 | 唯一键 organization/workspace/internal Profile/entityType/Amazon ID；task 创建顺序及 sourceUpdatedAt 防旧写；部分页原子提交并标注来源任务状态；未返回的行不删除，不推定为 Amazon 已删除 |
| 状态覆盖 | 已完成并验证 | 请求显式包含 ENABLED/PAUSED/ARCHIVED（官方允许的 live filters）；响应可保留其他合法状态。USER_DELETED 缺席不构成删除证据；不承诺完整删除流 |
| 实体查询 API | 已完成并验证 | `kind=entities` 分支使用 data-query；服务端 count/分页/排序、店铺/授权账户/内部 Profile/实体/父级/状态/名称关键词；实时 Seller/Marketplace 授权交集，CONNECTED Ads 授权及活动店铺；内部 ID 与 Amazon ID 分字段；结构拒绝报告日期筛选 |
| freshness | 已实现但能力有界 | 返回最近已存行同步时间、计划/最新任务状态、每 Profile 的币种/时区及按计划间隔计算的时效；不是报告日期覆盖证明，不将单个成功计划推断为全部数据域已同步 |
| 真实结构 UI | 已完成并验证 | 默认进入已存数据，八类实体切换、店铺/账户/Profile/层级/状态/搜索/排序、服务端 total 与翻页、来源与任务状态；显式返回 Demo，真实页无 mock fallback；尚未替换所有旧 Demo 详情/KPI/搜索词/广告位页 |
| 报告同步及版本 | 被依赖阻塞；未启用 | 不进入报告阶段；保留其他任务报告 schema/query 工作；具体 report 合同、历史回补、版本迁移/回填、真实来源样本另验收 |
| Ads 实体 MCP 工具 | 已完成并验证（隔离环境）；真实账号未启用 | 用户已批准只读切片；`amazon.ads.entities.list` 显式工具授权与实时范围交集已实现，详见下方追加记录；既有凭证不自动扩权 |
| 真实账号验证、迁移、运行配置 | 等待审批 | 本轮无真实 Ads 请求、无真实数据库迁移或启动同步；需要单独明确测试环境、Profile 与任务范围后执行 |

复现：`node scripts/test-amazon-ads-offline.mjs`（一次性预装 PG/Redis，显式环境白名单，禁止 dotenv、真实凭证、外网及镜像拉取；当前 schema db push 仅在临时数据库，不证明新 migration 已验收）。7 项覆盖八类持久化、Profile/站点隔离、total/筛选、429、重复派发、租约、旧写保护、API session、实际 BullMQ 消费、scheduler 恢复和暂停。Ads 页面隔离 Playwright 13 项通过。定向 reader 测试与最终静态检查见本轮交付结果。

回滚：撤销本轮代码切片恢复旧 adapter 阻断与显式 Demo 入口；环境停用/计划暂停须另按审批执行。保留所有已存快照与来源任务，不删数据、不回滚其他任务的 schema/migration。已观察的当前快照不具备多页全域原子发布或任意历史恢复能力。


### 本切片最终验证记录

- 已完成并验证：SP reader 16/16、一次性 PG/Redis 同步集成 7/7、隔离浏览器 13/13；TypeScript、修改文件定向 ESLint、`git diff --check` 通过。
- `npm run check:fast` 的核心测试 852/852 通过；全局 lint 被已有未跟踪 `.next-amazon-live/` 生成文件扫描阻断，本轮未删除产物或改全局 lint 配置。完整 `npm run check` / 生产构建未运行，合码前须先处理该门禁并重跑。
- 扩展 Amazon sync 离线集成 166/167 通过；未通过项为 returns fixture 的 application ID 冲突（`amazon-returns.integration.ts:82`），不作为 Ads 切片已通过的证据，也未扩范围修改该域。
- 本轮验证全部使用隔离 fixture 与临时数据库；没有真实 Amazon API/Profile 验证，没有启动真实同步、应用真实迁移或提交、推送、部署。临时库 schema 验证不替代并发任务新增 migration 的独立审阅与验收。


## 2026-11-06：获批的只读 Ads MCP 切片

**已完成并验证（隔离环境）；真实账号未启用。** `/api/mcp/amazon` 新增 `amazon.ads.entities.list`，读取 `AmazonAdsEntityRecord`，支持八类 SP 实体。没有 schema/migration、写工具、外部 API 或运行配置改动。

- 凭证必须显式包含新工具；旧凭证及其轮换不自动扩权。现有“允许工具”列表自动展示新工具，由用户创建新凭证时选择。本轮未创建或修改任何真实凭证。
- 复用 `withAmazonMcpBoundary` 与 `queryAdsEntities`：凭证范围、实时 ERP 个人/角色 Seller/Marketplace 授权、已有 verified SP source 范围、Ads CONNECTED 授权及绑定活动店铺的 Profile 求交集。SP source 只作额外范围前置条件，不代替 Ads 授权。没有已验证 SP source 的 Ads-only 范围暂不开放 MCP。
- 服务端分页（默认 50、最多 100）、真实 total、白名单排序；支持店铺/站点、授权账户、内部 Profile、实体/父级 ID、状态和搜索。不支持结构日期筛选；日期属于后续报告能力。
- 返回内部与 Amazon Profile ID、父级、白名单结构字段、来源任务、同步/上游更新时间、Profile freshness、字段说明及能力限制。原始 payload、accountInfo、凭证、checkpoint 均不返回；嵌套 budget/expression 同样使用字段白名单。
- 查询结束后再次检查 Ads Profile 绑定与 CONNECTED 状态，并复用 MCP 原有实时权限/数据源复查；在实际 SQL 等待期间解绑时阻断响应，不释放旧授权结果。

调用示例（需用户另行在目标环境创建明确授权的个人凭证；示例不含 token）：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "amazon.ads.entities.list",
    "arguments": {
      "internalProfileId": "<ERP内部Profile主键>",
      "entityType": "SP:campaign",
      "page": 1,
      "pageSize": 50,
      "sort": "syncedAt",
      "direction": "desc"
    }
  }
}
```

验证：`node scripts/test-amazon-ads-offline.mjs --mcp` 6/6 通过（一次性 PG/Redis、网络 guard、fixture 行），涵盖旧凭证缺工具、八类查询、分页、跨店铺/站点/Profile、字段脱敏、断连/解绑、查询中途解绑及撤权。既有 `node scripts/test-amazon-sync-integration.mjs --mcp` 31/31 通过。本轮核心测试 `npm run test` 856/856、TypeScript、修改文件定向 ESLint、`git diff --check` 均通过。沿用已记录的全局 lint 产物扫描阻断，本切片未重复执行全局 lint/完整生产构建；合码前需处理门禁后运行完整检查。临时数据库按当前 schema 建库，不代表并发任务 migration 已在真实环境应用或完成验收。

回滚：移除新工具注册/调用分支和专用 schema，恢复查询函数原签名；保留既有工具与全部实体数据。现有新工具凭证会收到拒绝，禁用真实凭证须另按目标环境审批操作。真实 Profile/API 验收、报告同步、写入/自动优化仍未完成；本轮未提交、推送或部署。

## 2026-11-06：已发布 Ads 日报事实 MCP 只读查询

`/api/mcp/amazon` 增加 `amazon.ads.reports.list`，Skill 通用目录可在授权范围内展示 `ads_report_daily`；`data_query(ads_report_daily)` 与专用工具都要求凭证显式包含该工具，既有凭证不会自动扩权。目录只展示当前 ERP Seller/Marketplace 范围内已连接且有成功发布版本的数据源；查询按事实键选取最新成功发布版本后再执行业务筛选，空指标保持 `null`，币种按行返回。

该能力只读取本地已发布事实，不会创建 Amazon 报告、启动同步或调用 Amazon API。当前字段合同和来源样本仍待核验，描述状态保持 `application_schema_confirmed_source_sample_pending`。隔离验证：`node scripts/test-amazon-ads-offline.mjs --reports` 11/11、`node scripts/test-amazon-sync-integration.mjs --mcp` 31/31。未运行真实迁移、真实账号请求或生产任务。


## 2026-11-06：获批的报表发布/查询收口与真实页面详情

此段优先于前文“兼容 version-less 成功事实”“通用 data_query 可读取 Ads”的历史状态。完整保留并行任务的 schema、migration、Client、worker 和 Bulk Operations 改动；本轮没有提交、推送、部署或真实请求。

| 范围 | 状态 | 实际能力与限制 |
| --- | --- | --- |
| 实体 MCP | 已完成并验证 | `amazon.ads.entities.list`，显式工具授权，读取八类 SP 当前结构；6项隔离验证仍通过 |
| 报表统一读取 | 已完成并验证（fixture 数据） | `report-query.ts` 成为 API/MCP 报表统一边界；仅最新 PUBLISHED+SUCCEEDED 事实；先选版本后筛维度；排除 legacy/staging/failed/canceled；保留 null；同一事务 count/分页/分口径汇总/freshness；不返回 rawDimensions |
| 报表显式权限 | 已完成并验证 | 新 `amazon.ads.reports.list` 需明确授予；旧 data_query/describe 访问 Ads 表也需该新工具，目录不向旧凭证自动开放；实时 ERP Seller/Marketplace 与 CONNECTED Ads Profile/活动店铺求交集，返回前再复查；旧库存/刊登/销售工具保留 |
| 读取边界与成本 | 已实现并验证有界行为；生产容量未验证 | 日期最多367天，单页100，Profile最多500；SQL单条8秒、读取事务20秒；MCP报表凭证每进程每分钟60次、最多10000个预算键。进程预算不是全实例共享限流；尚无真实 P95/容量 benchmark |
| 报表 staging/发布 | 已实现但未启用 | `report-publication.ts` 只在 `AMAZON_SYNC_OFFLINE_FIXTURE=1` 下可调用，manifest明确 ISOLATED_FIXTURE_ONLY；无 API/MCP 写入口，未接 report worker。字段/粒度/日期/币种/时区/归因/API校验，围栏和租约，去重事实键，实际去重rowCount，任务成功与发布同事务；坏页不部分入库 |
| 历史与撤回恢复 | 已完成并验证（隔离函数） | 保留版本/事实，WITHDRAWN隐藏，恢复保留原发布时间；事务失败保留STAGING并回滚任务成功；零行报告保持阻断，不推断清空历史。仅保证已观察事实键修订，不宣称整报告替换或任意历史恢复 |
| 结构详情/层级 | 已完成并验证 | 当前已存实体ID打开只读详情；显示内部/外部Profile、直接父级、状态、来源任务及时间；Campaign/Ad Group下属跳转保留Profile，Campaign否定与广告组否定分开 |
| 日报事实页 | 已完成并验证查询/UI接线；无真实报告采集 | 店铺/授权账户/Profile/父级/日期/报告类型/产品/搜索/排序/服务器分页；显示发布版本、发布时间和null占位；无原始维度泄漏，无虚构KPI；实际是否有数据由已发布事实决定 |
| 读取审计 | 已实现并验证 | 记录工具、调用者、范围、日期/白名单参数摘要、matchedCount/returnedCount、当前页来源版本和来源；不写入token/raw或搜索自由文本；不是全量跨页版本清单 |
| Skill/ERP | 已实现现有目录承接 | 复用既有动态工具和逻辑表配置，报表已连接检查纳入可用性；未重写任何 Skill 正文。完整逐报告覆盖/版本列表与Skill调用看板尚未实现 |
| 第一个真实日报/其他产品 | 被依赖阻塞 | 未核实具体Campaign Performance合同及真实Profile样本；SP真实report adapter仍关闭。SB/SD/TV不以SP字段冒充 |
| 真实测试Profile | 等待目标信息与独立审批 | 准备文件 `docs/amazon-ads-test-profile-readiness-2026-11-06.md` 明确缺口：未选目标环境/Profile，持久化测试请求预算/截止保护尚未实现，不具备可直接启动的真实验收方案 |

验证（本轮最终）：

- `node scripts/test-amazon-ads-offline.mjs --reports`：11/11，真实临时 PG/Redis，覆盖旧版本/legacy、null、显式授权、断连、staging/去重/发布/撤回恢复、坏行/取消/失败/围栏、事务失败回滚、SQL等待中撤权、API登录和API/MCP一致性。无TODO或跳过项。
- `node scripts/test-amazon-ads-offline.mjs`：结构同步7/7与实体MCP6/6；并行任务新增租约恢复行为按最新代码验证，无worker实现覆盖。
- 原有 MCP 集成31/31、核心测试857/857；Ads隔离浏览器16/16，包括真实实体详情、日报版本/null/筛选，以及真实浏览器DOM下Bulk导出不可变原文件、实体ID保留、勾选边界与旧值冲突保护。需账号的完整PPC登录/上传/恢复E2E未运行，不冒充已覆盖。
- TypeScript、修改文件定向ESLint、`git diff --check`通过。完整 `npm run check`/生产构建未运行，沿用已记录的`.next-amazon-live/`全局lint扫描门禁；未清理目录或改全局配置。

汇总按币种、报告类型、广告产品、API版本和归因窗口分组，不跨口径计算ACOS/ROAS；未知归因或币种不能作经营绩效结论。freshness仅表示已发布观察数据的日期/发布时间，不表示全量覆盖、最终归因或已做时效SLA判定。查询中不同口径分区不会互相替换。

回滚为撤销本轮代码恢复前一实现，保留全部数据；不自动恢复不安全的legacy读取。关闭真实工具/凭证或计划、执行真实迁移/发布需重新按目标审批。没有广告写调用、自动优化或AI建议执行。

最终只读核对：通过 `@prisma/client` 实际模块解析路径检查运行时生成 schema，按 model/enum 块比较字段与约束（忽略格式、字段顺序和等价属性顺序）与当前工作区一致；根 node_modules/.prisma 下另有旧副本，不是当前实际 Client，本轮未覆盖或清理。此检查与TypeScript通过均不证明 migration 链或真实数据库一致，真实迁移仍待独立审批与验收。


### 2026-11-06：报表发布合同与撤回恢复并发校验补强

- **已完成并验证**：发布及恢复先重建全部存储指标，再校验 manifest 白名单。impressions、clicks、orders、units、spend、sales 任一列出现合同外非 null 值（包括零）均拒绝，失败事务保留 STAGING / WITHDRAWN，任务不会误报成功。
- **已完成并验证**：撤回／恢复在取得任务级 advisory lock 后重新读取版本和来源任务；等待期间来源任务变为 FAILED 时拒绝恢复，避免使用锁前的成功状态。
- 验证：`node scripts/test-amazon-ads-offline.mjs --reports` 13/13（本轮新增六类存储指标污染及锁等待期间任务失效回归）；TypeScript、两处修改文件定向 ESLint 与 `git diff --check` 通过。临时 PG/Redis 使用 fixture，未继承真实凭证或访问 Amazon。隔离 db push 不代表 migration 链验收。
- 本轮只改 report-publication 服务和对应集成测试；UI、结构 worker 和 MCP 契约沿用上一轮验证，不重复运行浏览器或全套核心测试。完整 check/生产构建未运行，仍受已记录的全局 lint 扫描产物门禁影响。
- **已实现但未启用**：报表发布服务仍仅限离线 fixture，无写 API 或 worker 接线。
- **被依赖阻塞／尚未实现**：真实报表合同与下载 adapter、指定测试 Profile 的真实采集验收仍未完成。实体／报表只读 API 和 MCP 已接本地存储，但尚无本任务真实 Amazon 同步验收数据；AI 广告写入与自动执行保持关闭。
- 未改 schema、migration、生成 Client、配置或真实任务；未提交、推送或部署。回滚仅恢复本轮服务与测试代码，不删除事实或版本。


### 2026-11-06：日报汇总精度与合同分区回归

- **已完成并验证**：修复报表查询将 SUM(bigint) 强制转回 bigint 导致溢出的问题。保留 PostgreSQL numeric 汇总，Decimal 以完整十进制字符串输出，避免科学计数法和 JavaScript Number 精度损失；null 仍表示未提供。
- 隔离 PG 先复现 `22003 bigint out of range`，再验证 110 行最大合法 bigint 的 impressions/clicks/orders/units 汇总、六位小数金额累加、空 sales，以及 API/MCP 单页1条仍返回真实 total=110，不受汇总失败阻断。MCP 仍按既有契约返回 items/total，不新增汇总字段。
- **已完成并验证**：相同旧 factKey 在不同币种、API版本、归因窗口中保留独立版本与汇总；同口径旧行被替代后，Campaign 筛选不会使其重新出现。
- 广告账户页仅增量修复重试按钮配置空值保护：配置数据未就绪时禁用按钮，保留已有同步任务中心改动。未调用真实重试接口。
- 本轮验证：报表隔离 PG/Redis 集成15/15，Ads隔离浏览器16/16，TypeScript、三处代码文件定向ESLint、git diff --check通过。浏览器使用既有模拟API，不代表真实账户/真实数据验收，也未新增账户重试的浏览器用例。
- 完整 check/build 未运行；本轮采用相关集成、类型、lint和已有浏览器回归，无 schema/依赖/构建链修改。既有全局 lint 扫描 .next-amazon-live 产物问题未处理。
- **已实现但未启用**：报表发布仍为离线fixture服务。**被依赖阻塞／尚未实现**：真实报表读取合同、adapter及指定授权测试Profile的采集验收；实体和报表API/MCP已接本地存储，但未据此宣称真实Amazon数据同步成功。AI写入继续关闭。
- 未改schema/migration/Client或配置，未执行真实外部请求、任务、提交、推送或部署。回滚可恢复本轮查询、空值保护及测试代码，保留数据。


### 2026-11-06：真实实体页面标准字段接线

- **已完成并验证**：列表和详情优先使用 API 标准字段 name/keywordText/bid/budgetAmount/matchType/campaignId/adGroupId，旧快照字段缺失时兼容原始 payload；零竞价不会被空值替代。原始字段折叠区仍单独保留来源值，不与当前标准值混淆。
- **已完成并验证**：只读详情增加 Campaign/AdGroup ID、预算类型、投放类型、表达式类型与投放表达式、起止日期；Ad Group 下钻携带标准 Campaign ID、Ad Group ID及内部 Profile，避免过期 payload 破坏筛选隔离。
- **已完成并验证**：页面开放现有 API 白名单的 name/budgetAmount/bid 服务端排序；更换筛选或数据域开始加载时清除前次结果与来源元数据，防止日报显示结构总量或旧范围同步时间。
- 本轮代码范围仅 ads-synced-data.tsx 和对应浏览器回归，未修改共享API/worker/schema。Ads隔离浏览器18/18，TypeScript、定向ESLint、git diff --check通过；新增覆盖标准字段覆盖旧payload、空payload、零竞价、下钻请求与加载期间旧总量/来源清除。测试使用模拟API，不代表真实Amazon采集验收。
- 验证按UI级别执行，未重复数据库/核心全套、check或生产构建；API/MCP行为沿用上轮隔离验证。文档/API接入记录与下载目录原规划同步追加。
- **已实现但未启用**：报表发布服务仅离线fixture；**被依赖阻塞／尚未实现**：真实报表合同与adapter、明确授权测试Profile的真实数据采集验收。八类SP结构和已发布日报的页面/API/MCP接本地存储，尚未宣称本任务已采集真实经营数据；AI写入关闭。
- 无真实外部请求、配置、任务、迁移、提交推送或部署；未覆盖其他任务已有改动。回滚本轮UI和测试代码即可，不影响数据库记录。


### 2026-11-06：结构查询返回前授权复核与父级筛选修正

- **已完成并验证**：结构API在实体行/count/freshness读取后，重新读取实时ERP权限和当前Profile；CONNECTED、活动店铺及授权/外部Profile/店铺/站点/币种/时区绑定变化均拒绝整次结果，403不携带行、总量或来源元数据。使用既有repository边界，每次读取增加一次实时授权与最多1000个Profile的有界复查；不新增缓存、模型或接口字段。
- **已完成并验证**：Campaign筛选仅将Ad Group和Campaign级否定项的直接父级当作Campaign。Keyword/Target等广告组子项的父级ID即使与另一Campaign ID相同也不会误入；其归属继续按标准campaignId或兼容payload判断。旧Ad Group与Campaign否定项仍保留直接父级兼容路径。
- 本轮隔离PG/Redis回归：结构同步/查询12/12、实体MCP6/6；覆盖实际SQL锁等待期间撤权、授权断连、Profile解绑、店铺停用、管理员仍可见范围内店铺/站点重绑、相同数字父级ID碰撞及真实服务端分页。API测试成员fixture显式授予workspace:view，未放宽生产权限。
- 核心测试857/857、TypeScript、两处修改代码定向ESLint和git diff --check通过。UI无改动，沿用上轮浏览器18/18；未重复报表PG测试。完整check/build未运行，既有全局lint扫描产物问题不在本轮范围。
- 复核用于避免释放查询期间已失效的权限快照，不宣称跨数据库事务与HTTP发送绝对原子，也未在本切片改造结构count/rows的事务一致性；生产P95仍待真实规模benchmark。
- **已实现但未启用**：报表发布仅离线fixture；**被依赖阻塞／尚未实现**：真实报表合同/adapter和授权Profile采集验收。当前实体/日报API与只读MCP接本地存储，不表示已完成本任务真实Amazon采集；写入及自动执行关闭。
- 未修改schema/migration/Client/配置、未调用真实API或启动真实任务，未提交推送部署。回滚仅恢复query-service与对应测试，保留数据；不覆盖其他任务改动。


### 2026-11-06：结构域状态真实性收口

- **已完成并验证**：修复Worker的SYNCING状态被查询汇总误判为CURRENT。未知/取消/未识别状态不再默认成功；授权Profile中部分缺少状态或部分未知时，只能PARTIAL或UNKNOWN，失败和运行中状态保持优先。
- **已完成并验证**：结构页选择Keyword/Target等类型仍查询结构域状态（reportType为空）；不再把entityType作为reportType绕过域记录，从而用旧成功快照盖住当前失败/运行中状态。该状态代表八类SP结构域，不宣称每实体独立完成证据。
- **已完成并验证**：meta Profile freshness取数据域状态，计划ACTIVE单独保留在syncPlans中；最近结构成功时间仅取数据域成功，不从计划成功时间制造数据成功。无域记录时，仅来源任务SUCCEEDED且stage=COMPLETED_SP_STRUCTURE可作为成功兜底；其他成功旧阶段为UNKNOWN，附ENTITY_FRESHNESS_FROM_SNAPSHOT警告。此CURRENT仍不证明缺失行删除或达到时效SLA。
- **已完成并验证**：实体页面展示结构域状态、最近结构成功与来源警告；未知、部分和运行中均不会被计划ACTIVE掩盖。保持Amazon式布局和只读交互，无新增外部调用或自动行为。
- 验证：结构同步/查询隔离PG14/14、实体MCP6/6、查询单测4/4（含12组状态/缺失Profile组合）、Ads模拟API浏览器19/19、TypeScript、定向ESLint及git diff --check通过。fixture数据库db push不代表迁移链验收。未重复完整核心857项、报表PG或check/build；前轮核心通过，且本轮仅查询状态/兜底及显示变化。
- 本轮文件边界：query-service、repository的读取兜底、ads-synced-data及对应测试；未修改Worker、schema/migration/Client、MCP契约或配置。无新增数据库查询，只扩展既有select与内存状态归并。
- **已实现但未启用**：报表发布仍离线fixture；**被依赖阻塞／尚未实现**：真实报表合同/adapter及明确授权Profile真实采集验收。实体/日报只读API和MCP承接本地存储，尚无本任务真实Amazon采集验收结论；广告写入和自动执行关闭。
- 未执行真实API、配置、任务、迁移、提交推送或部署。回滚恢复本轮读取/显示与测试代码，保留数据和其他任务工作。


### 2026-11-06：结构API单次查询快照一致性

- **已完成并验证**：生产结构查询将初始ERP授权、Profile/计划元数据、行、真实total及freshness纳入同一PostgreSQL只读RepeatableRead事务。同步在读取过程中提交新记录或状态时，本次响应保留一致快照，下一次请求再读到新数据。
- 返回前授权/Profile绑定复核及读取审计仍在事务外执行；未用旧事务快照替代实时撤权复核。既有真实SQL锁等待中撤权、断连/解绑/店铺变更测试保持通过。
- 事务沿用报表读取保护：statement_timeout=8秒、事务timeout=20秒；repository接受既有Prisma TransactionClient，不新增数据库模型、缓存或API字段。事务占用连接和MVCC快照的生产P95仍待规模验证；不宣称零成本或跨多次翻页保留同一快照。
- 本轮隔离PG/Redis：结构同步/查询15/15、实体MCP6/6。新增确定性并发回归：先读8行，另一连接原子提交第9行和FAILED域状态，再执行count/freshness；本次仍8条/旧状态，后续生产查询为9条/FAILED。
- 查询单测4/4（状态矩阵按并行任务现有CANCELLED=PARTIAL及WAITING_FOR_CONFIG=SYNCING更新，不回滚其实现）、TypeScript、定向ESLint和git diff --check通过。UI及返回契约未改，沿用上轮浏览器19/19；未重复核心/报表全套、check或生产构建。
- 本轮仅query-service只读事务、repository Client类型及对应测试；未改worker/schema/migration/生成Client/配置。隔离db push不等于真实迁移验收。
- **已实现但未启用**：报表发布离线fixture；**被依赖阻塞／尚未实现**：真实报表合同/adapter、明确授权Profile真实数据采集验收。页面与实体/报表只读MCP继续承接本地存储，尚未据此宣称本任务已同步真实Amazon经营数据；广告写入及自动执行保持关闭。
- 未执行真实外部请求、任务、配置、迁移、提交推送部署。回滚本轮查询事务与类型/测试即可，数据保留；其他任务修改保持不动。


### 2026-11-06：只读实体MCP标准字段与查询语义对齐

- **已完成并验证**：MCP实体查询复用页面buildAdsEntityWhere和freshnessEnvelope；支持标准name/keywordText的大小写不敏感搜索，以及标准Campaign/AdGroup归属。标准字段已存在时，过期payload的同字段不再参与筛选；旧空标准字段仍保留payload兼容。页面查询同样获得该标准字段优先修正。
- **已完成并验证**：MCP fields优先返回标准字段、零竞价、精确十进制预算和标准表达式，继续执行嵌套budget/expression白名单；不会泄露payload私有字段、token或非白名单表达式字段。字段名和既有items/total结构保留；规范化Decimal返回十进制字符串，兼容旧payload的字符串/数字值。
- **已完成并验证**：MCP结构freshness读取已有结构域状态，不再以计划成功时间推断完成；meta.coverage提供CURRENT/SYNCING/FAILED/PARTIAL/UNKNOWN，Profile级状态同一口径。lastSyncAt仍为筛选行最近保存时间，不能当作全域成功时间。无额外实时Amazon请求。
- 只读RepeatableRead事务增加8秒statement_timeout/20秒事务timeout。Profile超过500时明确拒绝并要求缩小范围，不静默截断元数据；显式工具授权、ERP/站点/Profile交集及返回前绑定/凭证复核保持。
- 验证：结构同步/查询隔离PG15/15、实体MCP最终9/9（新增标准字段与空/旧payload、字段脱敏、域状态和501个Profile边界）、原有MCP集成31/31；浏览器19/19、TypeScript、定向ESLint和git diff --check通过。测试全为隔离fixture，无真实API或经营数据。
- 浏览器fixture与并行任务当前账户页对齐：移除一份完全相同的重复plans属性，将旧“同步任务中心”断言定位到现有“任务历史”。未回滚其账户页实现。未重复完整核心、报表PG或check/build。
- 本轮范围data-query/query-service/mcp与对应测试；新增域状态读取沿用既有有界Profile/repository路径，没有新增模型/缓存/写入口。生产P95及多实例查询容量仍待真实规模验证。
- **已实现但未启用**：报表发布离线fixture；**被依赖阻塞／尚未实现**：真实报告合同/adapter和明确授权测试Profile真实采集验收。页面/API/只读MCP已接本地存储，不等于本任务完成真实Amazon采集；广告写入和自动执行保持关闭。
- 无schema/migration/Client/配置修改、真实请求/任务/迁移、提交推送部署。回滚本轮查询与MCP序列化及测试即可，保留全部数据和其他任务修改。


### 2026-11-06：查询参数歧义保护

- **已完成并验证**：API解析前拒绝同一参数重复但值不同、三种Profile别名值不同、两组排序字段/方向别名冲突。明确返回400，不静默选择第一个/优先别名；值相同的重复参数及Profile别名保持兼容。Profile仍指ERP内部主键，不把外部Amazon ID自动转换为内部ID。
- 结构与日报API共用校验，离线结构reader也复用冲突保护并保留SyncInputError错误协议。校验仅遍历请求参数，不新增数据库查询、模型或外部调用。未新增MCP参数别名，也未扩展原有工具授权。
- **已完成并验证**：当前并行编辑将adsEntityFields调用误传payload，定向回归复现标准字段回退与类型错误后，仅恢复传入完整row；保留同文件其他任务新增工具和实现。
- 验证：参数/查询单测5/5；隔离PG结构同步/查询16/16，含已登录结构与日报API冲突参数400、响应不含数据/total/meta及相同Profile别名200；实体MCP最终9/9，TypeScript、定向ESLint及git diff --check通过。最初整组运行捕获上述MCP回归，修复后单独重跑实体MCP验证。全部隔离fixture，不使用真实凭证或API。
- 本轮无UI改动，沿用前轮浏览器19/19，未重复全套核心、报表发布PG、check/build。回滚仅恢复参数校验/测试；MCP调用修复保留既有标准字段契约，数据不受影响。
- **已实现但未启用**：报表发布仍离线fixture；**被依赖阻塞／尚未实现**：真实报表合同/adapter及指定授权Profile真实采集验收。页面、只读实体和报表MCP承接本地存储，不宣称本任务真实Amazon同步成功；广告写入和自动执行关闭。
- 未修改schema/migration/生成Client/配置，未执行真实任务、外部请求、迁移、提交推送或部署；其他任务修改保留。


### 2026-11-06：日报筛选范围汇总页面接线

- **已完成并验证**：日报页面消费既有API totals，展示当前筛选范围跨全部分页的服务端汇总，注明真实total与返回的日期范围；不在前端累加当前页、不硬编码总量。
- 按报告类型/广告产品/币种/归因窗口/API版本逐组展示曝光、点击、花费、订单、销售额和件数；不合并跨口径分组，不新增客户端ACOS/ROAS计算。未知币种、未知归因明确标注；数值以来源十进制字符串显示，零保留为0，null显示—。聚合仍仅代表已观察的已发布事实，不证明全域覆盖或最终归因。
- 加载/错误/切换实体域不展示旧汇总，筛选返回空totals时隐藏汇总；详情分页和只读入口保持。没有新增请求、数据库查询、外部调用、schema或API契约。
- 验证：Ads模拟API浏览器20/20，新增跨分页服务端total=101而当前页仅1行、三口径独立分组、超安全整数/六位金额精度、零/null、未知口径及空筛选隐藏；组件限定TypeScript和两处修改文件定向ESLint、git diff --check通过。
- **验证阻塞**：全仓TypeScript因其他任务正在修改的src/lib/amazon-sync/mcp.ts:279语法错误失败，本轮未覆盖其新增状态工具。组件限定检查使用临时tsconfig extends仓库配置、incremental=false，检查后临时目录自动移除；不将限定检查冒充全仓通过。本轮UI切片未重复PG/核心全套或check/build。
- 本轮仅ads-synced-data.tsx、浏览器回归及规划/API文档。**已实现但未启用**：报表发布仍为离线fixture；**被依赖阻塞／尚未实现**：真实报表合同/adapter、明确授权Profile真实采集验收。汇总接本地存储API，不代表已采集真实Amazon经营数据，测试未访问真实API。
- 未执行真实请求、配置、任务、migration/Client生成、提交推送或部署；广告写入关闭。回滚本轮UI与测试即可，保留数据和并行任务修改。


### 2026-11-06：U1 报表采集与 Skill MCP 监控交付更新

- **已完成并验证（隔离环境）**：Campaign 日报 acquisition 状态机完成 CREATE → POLL → DOWNLOAD → STORAGE → PARSE → STAGING → PUBLISH；请求阶段、预算、deadline、远端 request id、证据文件和下载文档均持久化。未知 create 结果不会自动重复创建；失败、取消、合同/存储校验失败或 fence 失效不会污染当前已发布版本。
- **已完成并验证（隔离环境）**：报表查询、API、`amazon.ads.reports.list` 和 Skill `ads_report_daily` 共用已发布版本边界，按事实口径选择最新成功版本后再筛选；响应包含来源任务、发布版本、店铺/站点、日期、粒度、币种、归因、同步时间和完整性状态。MCP 与 Skill 不能读取 staging、failed、canceled 或 legacy 事实。
- **已完成并验证**：同步任务详情 API/账户页显示 Attempt、请求/文档、发布版本、freshness 和错误摘要；Skill/ERP MCP 设置页支持调用记录服务端分页及成功/拒绝、工具筛选。现有 Skill 正文未重写，未新增数据库直读路径。
- **迁移链验证通过**：`node scripts/test-amazon-ads-migrations.mjs` 在一次性 PostgreSQL 中覆盖空库安装、旧行升级、nullable metrics、Profile/task 约束、事实幂等和历史 Profile 错配阻断；没有对持久数据库执行迁移。
- 本次回归：`npm test` 867/867、`node scripts/test-amazon-ads-offline.mjs --reports` 22/22、`node scripts/test-amazon-ads-offline.mjs --mcp` 10/10、`npm run typecheck`、相关文件定向 ESLint 和 `git diff --check` 均通过。
- **仍未启用**：当前合同实现明确 `ISOLATED_FIXTURE_ONLY`/`liveEnabled=false`，无默认 live HTTP transport、正常 worker/scheduler 或真实测试 Profile。没有真实 Amazon API/凭证/生产数据验收，不宣称真实数据已同步。
- **边界保持**：优化建议第一阶段只允许读取、分析和生成草稿；竞价、预算、状态、关键词、否定词和商品投放写操作仍须 Agent Gateway 审批，未开放 Ads 写 transport 或自动执行。
