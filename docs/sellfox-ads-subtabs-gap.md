# Sellfox 广告子页：Phase A / B 已接入与剩余缺口

2026-10-26。Phase A/B 已对照本机真实 Sellfox XLSX 确认列映射并修复投放 ID；本轮仅 box 本机修改和离线解析，未部署、未迁移、未启用计划，未调用 createTask。

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

## 真实 XLSX 确认与本轮修复矩阵（2026-10-26）

证据为从 123 的 SellfoxReportTask 下载后留在本机的文件：`/workspace/sellfox-ads-xlsx-samples/`，表头记录见 `headers-exceljs.json`，文件清单见同目录 `MANIFEST.md`。本轮只离线读取已有样本，不访问服务器/API，不提交 XLSX 二进制。以下确认只覆盖列出的广告类型与空/非空样本，不代表其他类型或生产全量验收。

共用必需列 **C**：`店铺`、`日期`、`广告活动ID`、`广告曝光量`、`广告点击量`、`广告花费`、`广告订单量`、`广告销售额`。下表的 C 均指这八列。

| reportTypeCode | 真实样本确认的必需列及关键列 | 确认 / 修复 | 离线解析结果 |
| --- | --- | --- | --- |
| adProductReport | C + `广告组ID`、`广告产品ID`、`asin`/`ASIN`、`sku`/`SKU`；SP 小写，SB/SD 大写 | **确认已有映射**，大小写回退已覆盖 | SP 14 行；SB/SD 仅表头，均通过 |
| adTargeringReport | C + `广告组ID`；真实 ID 列为 **`广告投放ID`**，另有 `投放`、`匹配类型` | **本轮修复**：原来只读 `投放ID`，真实文件误走 text hash；现在读 `广告投放ID`，保留旧别名 | SP 10 行，首行 ID `120449591864118`；SB 仅表头通过 |
| adSearchTermReport | C + `广告组ID`、`用户搜索词`；真实 ID 列为 **`广告投放ID`**，另有 `投放`、`匹配类型`、`币种` | **本轮修复**：原来忽略真实 ID，空串身份导致重复拒绝；现在按真实 ID 区分行；currency 仍为 NULL | SP 空报告通过；NJ 店非空 SP **540 行通过** |
| adCampaignReport | C；名称列 `广告活动`，无 `广告组ID` | **确认已有映射**，名称回退有效，粒度为活动/日 | SP 14 行通过 |
| adGroupReport | C + `广告组ID`；名称列 `广告组`，另有 `广告活动` | **确认已有映射**，名称回退有效，粒度为活动/组/日 | SP 14 行通过 |
| adSpaceReport | C + 精确列 **`广告位`**；真实文件**没有 `广告组ID`**，广告位值包括 `商品详情页` | **确认已有映射与唯一键**，粒度为**活动 + 广告位 + 日期** | SP 41 行通过 |

身份与兼容规则：

- 投放与搜索词均先识别 `广告投放ID`，不存在时兼容 `投放ID`；两列同时存在一律按重复/歧义列拒绝，即便值一致或文件仅有表头。已选 ID 列每行必须有去首尾空格后的非空值，空值不得回退。
- 仅投放报告在**两个 ID 列都不存在**且 `投放` 非空时，保留 `text:` + SHA256(JSON([campaignId, adGroupId, targetingText, matchType])) 回退；文本/匹配类型变动会改变身份，绝不用行号造 ID。
- 搜索词唯一键为店铺/广告类型/日期/活动/广告组/用户搜索词/targetingId；两个 ID 列都不存在时仍用空串 sentinel（不改成 hash 或 NULL）。相同搜索词/活动/组但不同 `广告投放ID` 可共存，无 ID 的重复身份整文件拒绝。
- 活动唯一键 `[storeId, reportDate, adType, campaignId]`，组唯一键再加 adGroupId；名称仍兼容 `广告活动名称`/`广告活动`、`广告组名称`/`广告组`，优先前者。
- 广告位唯一键 `[storeId, reportDate, adType, campaignId, placement]` 已由真实文件确认。可选广告组ID仅保留兼容元数据、空值为 NULL，不参与身份；同一活动/广告位/日期多行仍整文件拒绝。跨日汇总仅在组ID完整且一致时展示，否则 NULL。
- 产品报告要求 ASIN/SKU 列，其他五域允许无 ASIN/SKU；可选大小写别名同时出现则拒绝。所有报告 currency 保持 NULL，搜索词的 `币种` 仍只留在 payload；指标空单元格保持 NULL。
- 共用大小/解压大小/条目数/单工作表/行数/重复列/公式/店铺/日期/唯一身份校验不变。任一行不满足契约则整文件拒绝，保留旧窗口数据；禁止静默丢行或猜列。

### 既有数据纠正（部署后另行授权执行）

修复不会自动改写已入库数据。根据任务提供的生产盘点，修复前约 4.8 万投放行可能带 `text:` targetingId；搜索词可能保留空串 targetingId，或在重复检查时整文件失败。此数量本轮未连接数据库复核。

后续部署修复后，应从现有 storage 缓存 **`sellfox-reports/...`** 文件重新解析，并沿既有组织/工作区/店铺/广告类型/日期窗口的原子替换边界纠正身份；不能仅按新 ID upsert 而留下旧 hash/空串行。先盘点受影响窗口、保留原文件和可恢复快照、验证新 ID/行数/重复身份及租户边界，再执行受控替换；**不创建新 createTask、不重复下载**。缓存文件缺失时先报告缺口，不自动重建上游任务。本轮没有执行重解析入库或数据库写入。

仍待证据：非空 SB/SD 投放与搜索词、非空 SD 产品，以及活动/组/位的 SB/SD 文件、全量 ID/匹配类型语义、下载分片与币种业务口径；不得将表头/空报告通过写成非空数据验收。

`/saihu-search-merge` 继续作为独立的人工上传合并工具，本轮没有修改、调用或替换该路径。

## 保持灰显

| 子页 | title 原因 |
| --- | --- |
| 广告组合 | 需要 portfolios 结构 API，无本地结构模型 |
| 否定 | 需要否定关键词/否定商品结构 API，无下载报告来源 |
| AMC | 暂无已知 Sellfox Open API 下载来源 |

日志导航已接通：点击广告「日志」复用 `onChange({ domain: "runs", page: 1 })` 打开现有同步任务日志，移除「· 待接」。tooltip 明示 `domain=runs`，非广告专属日志 API；不创建同步任务、不引入日志下载资源。域切换沿用工作台已有状态处理。

业务员、AWD、运营、销量洞察、配对状态、划线价类型等未因本轮开放。

## 迁移、验证与回退

Phase A 迁移 `20261026030000_sellfox_ads_targeting_search_term` 保持不变，使用事务：为既有任务增加带 adProductReport 默认值的 reportTypeCode、替换唯一索引、新增两张日报表与只读视图。Phase B 新增独立事务迁移 `20261026040000_sellfox_ads_campaign_group_placement`，仅新增三张日报表、索引、SellfoxStore 外键和只读视图；不修改 SellfoxReportTask 或 Phase A 迁移。模型/SQL 视图均保留 org/workspace/store 维度，ACoS/ROAS 分母为零时 NULL。

Phase A/B 初始实现曾做 schema-to-schema diff、SQL/Prisma Client 生成及独立内存 PostgreSQL 验证；本轮列映射修复不改 schema、不生成或执行迁移。未来部署仍需按仓库迁移审核流程执行。所有五个新增计划均默认关闭，开启前需另行评估串行队列容量。

本轮列映射修复验证：两份 Phase A/B 契约测试（含真实 ID/旧别名、空值、双列歧义、搜索词身份碰撞）、TypeScript、变更 TS 的 ESLint、离线读取上述十份样本及 `git diff --check`。临时解析脚本验证后删除；未跑全量 check、构建、浏览器 E2E 或真实数据库测试，发布时再走 CI 完整校验。

Phase A/B 初始实现的较广验证路线（本轮不重复）：

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
