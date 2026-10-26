# Sellfox 广告子页：Phase A 与剩余缺口

2026-10-26。仅仓库实现与隔离验证；未部署、未启用任何计划，未调用真实 createTask。

## 报告来源与同步

reportTypeCode 依据用户提供的 [sellfox-mcp `src/cli.ts` enum](https://github.com/shuolol/sellfox-mcp/blob/main/src/cli.ts)（同仓库 `src/mcp-server.ts`）。本轮未请求上游发现接口。

| 子页 | 资源 | reportTypeCode | 本地来源 |
| --- | --- | --- | --- |
| 广告产品 | ads_report | adProductReport | sellfox_ads_product_daily |
| 投放 | ads_targeting | **adTargeringReport**（上游拼写，不能改为 Targeting） | sellfox_ads_targeting_daily |
| 搜索词 | ads_search_term | adSearchTermReport | sellfox_ads_search_term_daily |

三者共用 `ads-report-sync.ts` 的 createTask → pageList → allowlisted HTTPS download → storage adapter → parse → 原子替换指定店铺/广告类型/日期窗口。task 哈希、唯一键、creating 防重及 pageList 归属核验包含 reportTypeCode；旧广告产品任务哈希仍可恢复。创建请求禁用自动重试；创建结果不明需人工关联，禁止重复创建。原 XLSX 留在 `sellfox-reports/...`，payload 保留原列；不改 ProductRecord。

新资源出现在 schedules API，默认关闭；用户通过现有权限 API 显式启用，1440 分钟、Asia/Shanghai 每日 06:30，默认同步 T-1。串行客户端 ≥1200ms 与单 Worker 并发不变；启用新资源会增加报表创建、轮询、下载和存储工作量，本轮没有开启计划或进行容量测试。

浏览接口为 `/api/sellfox/ads_targeting`、`/api/sellfox/ads_search_term`，支持 workbench、CSV、Agent 窄列导出及按需 payload；沿用组织/工作区权限、分页、10,000 条导出上限。页面 `domain=ads&adsTab=product|targeting|searchTerm`，省略 adsTab 默认 product。子页分别保留列选择，当前子页决定同步资源，支持 sp/sb/sd 筛选。

## 暂定 XLSX 列，尚未通过真实文件验证

以下列映射仅来自任务约定，不能标记为真实接口验收通过：

- 共用必需列：店铺、日期、广告活动ID、广告组ID、广告曝光量、广告点击量、广告花费、广告订单量、广告销售额。
- 投放：优先必需投放ID；**仅缺少整个投放ID列时**允许投放文本兜底，生成 `text:` + SHA256(JSON([campaignId, adGroupId, targetingText, matchType]))。存在投放ID列但单元格为空时拒绝，不按行号造 ID。文本/匹配类型变动会改变兜底身份。
- 搜索词：必需用户搜索词；唯一键为店铺/广告类型/日期/活动/广告组/用户搜索词/投放ID。缺少整个投放ID列使用空串 sentinel，防止 PostgreSQL NULL 绕过唯一键；存在该列则要求每行有值。不得把用户搜索词改名为搜索词后猜取。
- 可选窄列：投放、匹配类型、asin/ASIN、sku/SKU；搜索词另可选投放ID。同义大小写同时出现则拒绝。currency 保持 NULL，即便额外列出现“币种”也暂不映射；指标空单元格保持 NULL。
- 共用大小/解压大小/条目数/单工作表/行数/重复列/公式/店铺/日期/唯一身份校验。任一行不满足契约则整文件拒绝，保留旧窗口数据；禁止静默丢行或猜列。

真实 SP/SB/非空 SD 文件、各广告类型的 ID/匹配类型语义、下载分片及币种来源仍须在另行授权的受控联调核验。禁止为了验证枚举反复创建生产任务。

`/saihu-search-merge` 继续作为独立的人工上传合并工具，本轮没有修改、调用或替换该路径。

## 保持灰显

| 子页 | title 原因 |
| --- | --- |
| 广告活动 | adCampaignReport 本地模型未接入，留待 Phase B |
| 广告组 | adGroupReport 本地模型未接入，留待 Phase B |
| 广告位 | adSpaceReport 本地模型未接入，留待 Phase B |
| 广告组合 | 需要 portfolios 结构 API，无本地结构模型 |
| 否定 | 需要否定关键词/否定商品结构 API，无下载报告来源 |
| AMC | 暂无已知 Sellfox Open API 下载来源 |
| 日志 | 非报表下载，请使用顶部同步日志（domain=runs） |

业务员、AWD、运营、销量洞察、配对状态、划线价类型等未因本轮开放。

## 迁移、验证与回退

迁移 `20261026030000_sellfox_ads_targeting_search_term` 使用事务：为既有任务增加带 adProductReport 默认值的 reportTypeCode、替换唯一索引、新增两张日报表与只读视图。部署前需按仓库迁移审核流程执行；本轮只生成 SQL、Prisma Client 并在独立内存 PostgreSQL 验证，不访问配置数据库。

隔离验证：

```bash
npx tsx --test tests/sellfox-*.test.ts
npm run typecheck
npm run test:sellfox:browser -- --grep 'listing and ads expose|ads targeting/search-term'
# ESLint 对本轮变更的 TS/TSX 文件执行。
```

`tests/integration/sellfox-ads-phase-a.ts` 导出 `verifySellfoxAdsPhaseASql(query)`，由调用方提供全新、可丢弃的 PostgreSQL/PGlite 数据库。覆盖有数据的旧任务迁移、默认值回填、三种报告任务不冲突、日报唯一键、视图 NULL/比率及真实 SQL 聚合/搜索/快筛/权限隔离。它不读取 DATABASE_URL、不自行连接数据库；本轮用环境已安装的 PGlite 执行，无依赖或锁文件变更。

回退先停用两个新资源计划并处理运行中任务，保留新增表/列/视图与原报告文件；不做数据库 down/drop。旧代码不能恢复本轮新哈希的任务：若要回退到本轮之前的版本，应先完成活动广告产品任务，或将旧/新任务哈希兼容读取补丁一同保留。新代码能恢复迁移前旧广告产品任务。真实列不符时修契约并从缓存文件重试，避免再次 createTask。
