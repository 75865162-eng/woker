# Sellfox 广告子页：Phase A / B 已接入与剩余缺口

2026-10-26。仅仓库实现与隔离验证；未部署、未启用任何计划，未调用真实 createTask。

## 报告来源与同步

reportTypeCode 依据用户提供的 [sellfox-mcp `src/cli.ts` enum](https://github.com/shuolol/sellfox-mcp/blob/main/src/cli.ts)（同仓库 `src/mcp-server.ts`）。本轮未请求上游发现接口。

| 子页 | 资源 | reportTypeCode | 本地来源 |
| --- | --- | --- | --- |
| 广告产品 | ads_report | adProductReport | sellfox_ads_product_daily |
| 广告活动 | ads_campaign | adCampaignReport | sellfox_ads_campaign_daily |
| 广告组 | ads_ad_group | adGroupReport | sellfox_ads_ad_group_daily |
| 广告位 | ads_placement | adSpaceReport | sellfox_ads_placement_daily |
| 投放 | ads_targeting | **adTargeringReport**（上游拼写，不能改为 Targeting） | sellfox_ads_targeting_daily |
| 搜索词 | ads_search_term | adSearchTermReport | sellfox_ads_search_term_daily |

六者共用 `ads-report-sync.ts` 的 createTask → pageList → allowlisted HTTPS download → storage adapter → parse → 原子替换指定店铺/广告类型/日期窗口。task 哈希、唯一键、creating 防重及 pageList 归属核验包含 reportTypeCode；旧广告产品任务哈希仍可恢复。创建请求禁用自动重试；创建结果不明需人工关联，禁止重复创建。原 XLSX 留在 `sellfox-reports/...`，payload 保留原列；不改 ProductRecord。

新资源出现在 schedules API，默认关闭；用户通过现有权限 API 显式启用，1440 分钟、Asia/Shanghai 每日 06:30，默认同步 T-1。串行客户端 ≥1200ms 与单 Worker 并发不变；启用新资源会增加报表创建、轮询、下载和存储工作量，本轮没有开启计划或进行容量测试。

新增浏览接口为 `/api/sellfox/ads_targeting`、`/api/sellfox/ads_search_term`、`/api/sellfox/ads_campaign`、`/api/sellfox/ads_ad_group`、`/api/sellfox/ads_placement`，支持 workbench、CSV、Agent 窄列导出及按需 payload；沿用组织/工作区权限、分页、10,000 条导出上限。页面 `domain=ads&adsTab=product|targeting|searchTerm|campaign|adGroup|placement`，省略 adsTab 默认 product。子页分别保留列选择，当前子页决定同步资源，支持 sp/sb/sd 筛选。

## 暂定 XLSX 列，尚未通过真实文件验证

以下列映射仅来自任务约定，不能标记为真实接口验收通过：

- 共用必需列：店铺、日期、广告活动ID、广告曝光量、广告点击量、广告花费、广告订单量、广告销售额。投放、搜索词和广告组另外必需广告组ID。
- 广告活动（adCampaignReport）：唯一键 `[storeId, reportDate, adType, campaignId]`；不要求、不按广告组ID划分。可选广告活动名称/广告活动，优先前者。
- 广告组（adGroupReport）：唯一键 `[storeId, reportDate, adType, campaignId, adGroupId]`；可选广告组名称/广告组，优先前者；投放/匹配类型仅元数据。
- 广告位（adSpaceReport）：**暂定精确必需列「广告位」**，不猜 placement/广告位置等其他名字。采用常见 CPC 活动级 placement 日报粒度，唯一键 `[storeId, reportDate, adType, campaignId, placement]`。广告组ID可选、空值存 NULL，仅作元数据，不进唯一键或 ID 哈希。相同活动/广告位/日期出现多广告组行时整份拒绝，禁止静默合并或覆盖；若真实报告证明是组级粒度，须先修改契约和新增迁移再接收。跨日汇总仅在广告组ID完整且一致时显示，否则 NULL。
- 新三域均允许无 ASIN/SKU 的行；可选 asin/ASIN、sku/SKU，currency 仍为 NULL，不从“币种”猜取。所有新身份只用稳定字段，绝不用行号。
- 投放：优先必需投放ID；**仅缺少整个投放ID列时**允许投放文本兜底，生成 `text:` + SHA256(JSON([campaignId, adGroupId, targetingText, matchType]))。存在投放ID列但单元格为空时拒绝，不按行号造 ID。文本/匹配类型变动会改变兜底身份。
- 搜索词：必需用户搜索词；唯一键为店铺/广告类型/日期/活动/广告组/用户搜索词/投放ID。缺少整个投放ID列使用空串 sentinel，防止 PostgreSQL NULL 绕过唯一键；存在该列则要求每行有值。不得把用户搜索词改名为搜索词后猜取。
- 可选窄列：投放、匹配类型、asin/ASIN、sku/SKU；搜索词另可选投放ID。同义大小写同时出现则拒绝。currency 保持 NULL，即便额外列出现“币种”也暂不映射；指标空单元格保持 NULL。
- 共用大小/解压大小/条目数/单工作表/行数/重复列/公式/店铺/日期/唯一身份校验。任一行不满足契约则整文件拒绝，保留旧窗口数据；禁止静默丢行或猜列。

真实 SP/SB/非空 SD 文件、各广告类型的 ID/匹配类型语义、下载分片及币种来源仍须在另行授权的受控联调核验。禁止为了验证枚举反复创建生产任务。

`/saihu-search-merge` 继续作为独立的人工上传合并工具，本轮没有修改、调用或替换该路径。

## 保持灰显

| 子页 | title 原因 |
| --- | --- |
| 广告组合 | 需要 portfolios 结构 API，无本地结构模型 |
| 否定 | 需要否定关键词/否定商品结构 API，无下载报告来源 |
| AMC | 暂无已知 Sellfox Open API 下载来源 |
| 日志 | 非报表下载，请使用顶部同步日志（domain=runs） |

业务员、AWD、运营、销量洞察、配对状态、划线价类型等未因本轮开放。

## 迁移、验证与回退

Phase A 迁移 `20261026030000_sellfox_ads_targeting_search_term` 保持不变，使用事务：为既有任务增加带 adProductReport 默认值的 reportTypeCode、替换唯一索引、新增两张日报表与只读视图。Phase B 新增独立事务迁移 `20261026040000_sellfox_ads_campaign_group_placement`，仅新增三张日报表、索引、SellfoxStore 外键和只读视图；不修改 SellfoxReportTask 或 Phase A 迁移。模型/SQL 视图均保留 org/workspace/store 维度，ACoS/ROAS 分母为零时 NULL。

未来部署前需按仓库迁移审核流程执行；本轮只做 schema-to-schema diff、生成 SQL/Prisma Client，并在独立内存 PostgreSQL 验证，不连接任何配置数据库，不执行生产迁移。所有五个新增计划均默认关闭，开启前需另行评估串行队列容量。

隔离验证：

```bash
npx tsx --test tests/sellfox-*.test.ts
npm run typecheck
npm run test:sellfox:browser -- --grep 'listing and ads expose|ads targeting/search-term|ads campaign|广告活动'
# ESLint 对本轮变更的 TS/TSX 文件执行。
```

`tests/integration/sellfox-ads-phase-a.ts` 导出 `verifySellfoxAdsPhaseASql(query)`，由调用方提供全新、可丢弃的 PostgreSQL/PGlite 数据库。覆盖有数据的旧任务迁移、默认值回填、三种报告任务不冲突、日报唯一键、视图 NULL/比率及真实 SQL 聚合/搜索/快筛/权限隔离。它不读取 DATABASE_URL、不自行连接数据库；本轮用环境已安装的 PGlite 执行，无依赖或锁文件变更。

`tests/integration/sellfox-ads-phase-b.ts` 导出 `verifySellfoxAdsPhaseBSql(query)`；同样由调用方注入全新临时库，无数据库连接或环境变量读取。先复验 Phase A，再验证 Phase B 迁移、六种任务共存、三个唯一键（广告位不因可空组ID绕过）、三个视图窄列/比率/NULL、实际 SQL 聚合/搜索/快筛/分页/组织及工作区隔离、广告组元数据跨日一致性。本轮用已安装 PGlite 运行，未新增依赖。

Phase B 验证结果：Sellfox 单元/API/契约/生命周期/计划回归通过；TypeScript、变更 TS/TSX 的 ESLint、上述隔离 SQL 和三条浏览器验收通过。浏览器模拟下载后的数据与同步 API，不替代真实 XLSX 验收；新增测试验证同步后进入同步日志并可返回原广告子页。未跑完整生产构建或真实接口/账号 E2E；后续发布需按 CI 完整校验。

Phase B 回退到 Phase A 时，先停用活动/组/位三个计划并处理运行中任务；保留新增表、视图、任务和原报告文件，不做数据库 down/drop。既有产品/投放/搜索词任务哈希保持不变；Phase A 代码不能执行三个新增资源。若连 Phase A 也回退，须停用五个新增计划，并先完成活动广告产品任务，或保留旧/新任务哈希兼容读取补丁。当前代码仍能恢复 Phase A 迁移前旧广告产品任务。真实列不符时修契约并从缓存文件重试，避免再次 createTask。
