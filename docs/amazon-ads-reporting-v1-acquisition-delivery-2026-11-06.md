# Reporting v1 持久协议采集核心交付（离线）

日期：2026-11-06。基线分支 `codex/amazon-multistore-mcp`，HEAD `98e5bcf8b3422ceb0721dd210be5fe2d2d05db41`。本批为本地未提交变更，不代表 GitHub/服务器状态；其他窗口的 UI、权限、LiLi 等改动未处理。

## 实现与调用链

代码：`src/lib/amazon-ads/reporting-v1-acquisition.ts`。

`initializeIsolatedReportingV1` → 一次性测试 Task/Plan/Profile → 实时 `amazonDataAccess(sync)` → task advisory lock + task 行锁、Profile/Authorization/Plan share locks → 创建幂等 `AmazonAdsReportRequest` → AES-GCM Task checkpoint。

`processIsolatedReportingV1` → 事务复查权限/授权版本/身份 revision/店铺/计划/lease/fence/冻结合同 → 先持久化预算和唯一 reservation → 注入 V1 transport create/retrieve → 回执字段/日期/格式/filter/ID 校验 → 再次事务复查和提交。

- 复用现有 `AmazonAdsSyncTask`、`AmazonAdsReportRequest` 和加密 checkpoint，无新增模型或迁移。
- 新 trigger `isolated-reporting-v1` 被现有结构任务路由排除，不接 scheduler、BullMQ、systemd 或 HTTP API。既有 V3 fixture 执行器保持原样；这是隔离协议实验入口，不是第二套生产队列。
- 初始化只接受已有有效 lease 的显式 fixture task，不创建、激活或恢复计划。数据库权威身份包括组织/工作区、用户、计划/版本、Profile、授权及 revision、region、advertiserAccountId/revision、Seller、Marketplace、币种、时区；Client ID 用摘要固定。Token 仅本次调用参数，不持久化、不刷新。
- 完整 report/filter、签名 URL/分片信息放入 Task AES-GCM checkpoint，AAD 绑定组织/工作区/授权/task；requestOptions 仅保存证据标签和摘要。结果只返回 phase/partCount，不向 UI/MCP 暴露 URL。ReportRequest 的内部 remote ID 不代表公开查询接口。
- 先保存调用计数和 reservation，后做 HTTP；create 结果未知不重发。旧 fence 回执不能提交；替换 fence 可重试 poll，已消费计数保留。进程级自动重启和队列恢复本批未实现，也未实测杀进程。
- create 上限 1、poll 上限 10、总 deadline 15 分钟、正常轮询间隔 1 秒、HTTP 20 秒为本地 fixture 策略，不是官方配额/SLA。Retry-After 不缩短，超 deadline/预算阻断。未知 create 保留 reservation，禁止人工简单重置后重试。
- 获取 COMPLETED 回执后仅保存分片 manifest，task 固定 BLOCKED / `ADS_REPORT_V1_JSON_FRAMING_UNVERIFIED`；不下载、不解压、不解析、不写事实、不创建 ReportVersion、不更新计划成功时间。零分片不推导为零广告消耗。

## 合同与安全边界

`reporting-v1-transport.ts` 提取 `snapshotReportingV1CreateReport`、`assertReportingV1ReceiptMatches`，create 与持续 poll 共用同一合同校验；成功结果类型移除原 parts 后再声明带 URL 的内部 parts，避免类型交叉丢失 URL。通用 OAS 来源沿用 `amazon-ads-reporting-v1-transport-delivery-2026-11-06.md`，没有本批新增官方能力推断。

本批只有 `ISOLATED_FIXTURE_ONLY`，运行时要求一次性 loopback `amazon_sync_test`、local temporary storage 和显式注入 transport。guard 不代替生产网络隔离；切勿通过更改环境标志把它用于真实账号。只在离线 runner 预载 socket/TLS/DNS/fetch 拦截器下验证，runner 不继承真实凭证或 dotenv、不拉取镜像。

尚缺：具体 Campaign 字段/日期/归因与账号合同、下载来源白名单、真实权限验收、共享 Client ID 限流、Profile 冷却、分片内容/总预算、对象存储与清理、V1 facts/parser/publication、任务 attempts/审计/监控、常规 scheduler/queue dispatch、控制面暂停恢复/取消和完整 RBAC 撤销并发线性化。当前事务前后实时校验不代表 HTTP 可撤销；授权撤销后已经发出的请求仍可能在远端完成。不要在此模块添加 default fetch 或令牌刷新来绕过 gate。

常规 worker `process-amazon-ads-report-task` 仍被 `report-dispatch.ts` 拒绝；`PERSISTENT_V1_RUNTIME_NOT_IMPLEMENTED` 继续保留，因为该缺口指完整生产运行层，本批只实现持久 create/poll 核心。

## 验证与交接

入口：`node scripts/test-amazon-ads-offline.mjs --reporting-v1`。runner 仅追加可选测试分支；默认既有测试清单不变。使用预装 Docker PostgreSQL/Redis、一次性 schema `db push`，不是执行迁移 SQL，也不是验证生产 migration。

专项测试：`tests/integration/amazon-ads-reporting-v1.integration.ts`。覆盖幂等初始化、双分片加密回执、无事实发布、并发 create、未知创建阻断、轮询合同错配、Retry-After、scope/账户 revision/Client ID/授权 revision/用户/角色/店铺撤销、HTTP 期间 scope/fence 改变、损坏 checkpoint/deadline、替换 fence 重试读取、预算耗尽、live 拒绝、明文合同摘要篡改。

失败记录：首次类型检查发现 null narrowing 与 parts 交叉类型问题，已修复；首轮 7/8 暴露 V1 错误码数字被过滤的问题，已修复；扩展角色撤销测试错误使用不存在的 `member`，已改用 schema 中 `viewer`。中间全库类型检查曾遇并行窗口 `src/lib/lili/skill-bundle.ts` 类型错误，未改动该模块。以本批最终复验记录为准，不能把中间失败写成通过。

未运行浏览器、全量 check/build、真实请求、生产 DB 或迁移、commit/push、部署。测试范围限于新增协议与持久边界；合码/上线时需完整检查及 migration 专项审核。本批无页面功能/流转变化，ERP/MCP 查询主路径不变。

回滚：移除本批独立 acquisition 模块和集成测试、撤回 runner 可选分支及 transport helper 提取；无新迁移或配置。一次性 fixture 数据由 runner 清理，不能把真实库清理作为回滚步骤。

## 最终执行结果

- 一次性 PostgreSQL/Redis V1 集成：12/12 通过。无网络真实 API；容器由 runner 清理。
- transport + Ads sync 单元回归：31/31 通过。
- 本批 acquisition/transport/test/runner 定向 ESLint：通过。
- 全库 `tsc --noEmit` 有一轮通过；后续共享工作区新增代码后，最新执行失败于 `src/lib/selection-research/fixture.ts:16` 的 Action/ObjectJson 类型，不能称当前全库通过；此前 LiLi 类型错误也曾出现，未编辑他人代码。
- 本批相关源码和测试的临时 tsconfig 专项类型检查：通过；临时配置在系统临时目录，未改 tsconfig.json。

测试数量仅指实际执行，不说明生产可用。


## 后续批次：有界加密分片下载（fixture only，2026-11-06）

在同一 `reporting-v1-acquisition.ts` 加入 `downloadIsolatedReportingV1Part`，checkpoint 版本升为 v2。旧 v1 checkpoint 明确拒绝，不自动迁移/重置预算；无生产数据使用，因此不需要 schema migration。

### 下载流转

`ACQUIRED` → 每个 dispatch 选第一个未完成 part → 原子保存下载预算、分片 index、reservation/fence → 注入 transport GET → 校验 URL scheme/credentials/端口/hash、到期、精确 byte count → AES-GCM 加密并写 StorageDriver → storage readback + ciphertext hash → 事务复查授权、scope、身份、reservation → 创建 scoped FileObject、AmazonAdsReportDocument 和审计 → 更新 checkpoint。

- 单片最多 8 MiB，报告 manifest 累计最多 32 MiB，分片数最多 100，每片最多 3 次。均为本地策略，非 Amazon 官方限制。持久 attempt 即使跨进程也不清零。
- 有界每次只读/写一片，不扩展共享 StorageDriver API。对象 key 只由 scope/task hash 和 reservation UUID 构成，不含签名 URL、token 或报告数据。原文加密后在 StorageDriver，文件与 part 的 digest/大小入 DB；解密 AAD 还绑定 report request 与 part index。
- 每片单独调用和提交；重启后跳过已提交分片。transport fetch redirect 必须拒绝；当前测试 transport host allowlist 固定 `download.fixture.invalid`。生产实际 host 和 allowlist 仍无证据，不创建生产 transport。
- 0 part 会以 `ADS_REPORT_V1_EMPTY_PARTS_UNVERIFIED` 阻断，不推导为空事实。负大小、单片/总量超限、过期 URL、字节错配均在存储前阻断。
- 报告/凭证不写 file path 或日志。FileObject 标记 `local` 只因 offline guard 强制 local storage。审计记录含 fileId/hash/size 或脱敏 storage receipt，不含 URL。
- StorageDriver 与 PostgreSQL 非原子；对象写成功而 DB commit 失败会留 `storage_commit_unconfirmed` 审计证据，不自动删对象/猜测 orphan。后续需设计可重建清单和人工/受控 orphan reconciliation；现有路径只留痕。
- 所有部分完成后 Task 固定 `BLOCKED`、error `ADS_REPORT_V1_JSON_FRAMING_UNVERIFIED`，状态叫 `RAW_STORED` 而非 validated/published。ReportDocument 为 `ISOLATED_V1_ENCRYPTED_RAW`，没有 parser、行数或日报事实。不得供 ERP/MCP 查询或 AI 分析。

### 新增验证

`node scripts/test-amazon-ads-offline.mjs --reporting-v1` 最新结果 24/24。覆盖 8 MiB 文件边界、multi-part/resume、并发 reservation、旧 fence、授权撤销、URL 到期、空/超预算、存储回读篡改、DB/对象存储非原子失败留痕、下载重试和预算耗尽、加密 AAD 交换拒绝。均 fixture-only；临时 db push，非生产迁移。

定向 ESLint 通过。全库 tsc 在下载批次新增前曾通过；相关 acquisition integration 全量通过。上一批记录的 LiLi/selection-research 并行全库类型错误仍待当前全库复核，未改他人代码。无 UI、MCP、常规 scheduler/worker 接线变化；无新增模型/迁移。

### 尚存风险/下一阶段

当前下载 Buffer 解密和 GZIP/JSON 解析还未实现；总报告仍会以多个加密小对象保存，但全量事实 parser 需流式或有界解压/分批 DB 写入，并防止压缩炸弹、JSON 行超限、重复 key/重复日期和 partial publish。由于实际下载 host、Campaign 字段契约/归因、规范化 parser、版本化原子发布都未完成，live 和下游消费继续禁用。Signed URL 只能由正式 server runtime 获取，不能落 UI/MCP。还缺生产共享限流/冷却、调度/崩溃恢复服务、任务控制 API、对象保留和 reconciliation 策略。

回滚仅移除下载函数、v2 checkpoint 与测试；本批没有数据库 schema 改动。一次性 fixture runner 清理容器和临时对象目录。生产环境不允许据此清理文件。


## 最终复验及状态协调修正

最新 fixture integration `node scripts/test-amazon-ads-offline.mjs --reporting-v1`：24/24；transport + Ads sync unit regression：31/31；全库 `node node_modules/typescript/bin/tsc --noEmit`：通过；定向 ESLint：通过。一次性 DB runner 内使用 db push，不代表 migrate 验证。

最终复跑曾发现 reservation 事务更新 Task checkpoint 后未同步更新 ReportRequest status，严格状态协调校验会拒绝后续操作。现已在同一事务把 request status 更新为 `ISOLATED_V1_DOWNLOADING`；重新跑完整 24 项全部通过。此处修正说明前序中间 15/24 失败结果不作为最终通过；失败已定位并复验。

本批目前的状态名：`ACQUIRED` 表示收到远端完成 manifest；`DOWNLOADING` 表示某分片下载已 reservation/处理中；`RAW_STORED` 表示所有原始分片经加密存储和 hash 回读验证。任何状态均不表示解析、报告事实完整或发布成功。`RAW_STORED` 的 task 阻断码为 `ADS_REPORT_V1_JSON_FRAMING_UNVERIFIED`。


## 后续批次：有界 GZIP/JSON 语法校验器（未接发布）

新增 `src/lib/amazon-ads/reporting-v1-json.ts` 与 `tests/amazon-ads-reporting-v1-json.test.ts`。它是独立纯函数，不被下载、report worker、ERP、MCP 或发布代码调用。只在调用者提供一个 gzip buffer 时验证 GZIP 解码和 JSON 语法，不解释 Campaign 行、不规范化字段、不推导零值、不跨 part 合并。

本地硬上限：压缩 part 8 MiB、解压 part 8 MiB、report 聚合解压 32 MiB、每 part 200,000 JSON values、深度 64；调用方只能收紧，不可放宽。重复 decoded key 拒绝，数字保留 lexeme，不经 JS Number。当前为同步 zlib/parser，输入量有界但 CPU 时间没有线程级硬截止；未来生产解析需在可取消的 worker/thread 或流式 pipeline 中隔离。

此工具不能被误读为已完成报告 parser。Amazon OAS 的 generic envelope 没有提供 Campaign 报告字段/归因/日粒度兼容矩阵，也未在本仓库证实 PARTITIONED_GZIP_JSON 各 part 的语义或 schema。因此不得将它直接接进 report acquisition，直到官方字段与 part 合同、独立 fixture、跨分片重复 grain 策略及原子发布验收具备证据。现存 encrypted raw files 不变；没有 DB 状态变化。

验证：`node node_modules/tsx/dist/cli.mjs --test tests/amazon-ads-reporting-v1-json.test.ts` 4/4；与 transport/Ads sync 一起 35/35；定向 ESLint 通过；全库 tsc --noEmit 通过。没有真实 API、解压线上报告、迁移或部署。

全库类型检查最新补充：当前失败于并行工作区 Prisma Client/schema 不同步：`src/lib/amazon-sync/mcp.ts:445`、`skill-data.ts:147`、`snapshots.ts:35` 的 `listingAttributes` 不存在于当前 `AmazonCatalogSnapshotSelect`。本轮 parser/test 临时 tsconfig 专项类型检查通过；第一次临时配置因未加载 Node 类型失败，修正 `types: ["node"]` 后通过。parser/transport/Ads sync 离线测试合计 35/35。全库检查不可标为通过。


## 后续批次：SP Campaign Reporting v1 请求合同（未接采集）

新增 `src/lib/amazon-ads/campaign-reporting-v1-contract.ts` 与对应纯单测。根据 Amazon Ads Reporting v1 Quickstart、Campaign 维度页及 purchases/costs 指标文档，构造 SP 日报的最小 `GZIP_JSON` create-report 请求：`date.value`、`campaign.id/name`、`budgetCurrency.value`、impressions、clicks、totalCost、purchases、sales、unitsSold。转化归因按 SP seller 默认 7 天、vendor 默认 14 天的官方说明记录；合同不从 V3 fixture 推断。

日期只校验真实 ISO 日历日期及起止顺序；未添加未经证实的历史最大天数。此合同当前只是确定请求字段的离线构造器，没有 reportType/groupBy/profile 等额外假设，也没有 HTTP、数据库、worker 或事实发布接线。

仍未确认：下载的 GZIP_JSON 行编码与字段实际形状、具体 Profile/广告主类型验收、下载 host allowlist、完整字段/币种/时区/日期覆盖及迟到修订语义。故不得将该合同视作完整 report parser 或 live-ready；现有 RAW_STORED 阻断状态和下游不可消费边界保持有效。

### 文件级 framing 证据复核

2026-11-06 重新读取 Amazon 官方 [Quickstart](https://advertising.amazon.com/API/docs/en-us/guides/reporting/ads-v1/quickstart)、[Helpful concepts](https://advertising.amazon.com/API/docs/en-us/guides/reporting/ads-v1/helpful-concepts) 与 [New features](https://advertising.amazon.com/API/docs/en-us/guides/reporting/ads-v1/new-features)：Quickstart 说明完成报告通过 `completedReportParts` 提供一个或多个预签名分片；New features 说明 `PARTITIONED_GZIP_JSON` 可分多个文件、每块最多 1GB 未压缩；Helpful concepts 给出单个 JSON 行对象示例、点号字段键及空值规则。这些官方说明没有定义每个 `GZIP_JSON` part 解压后的顶层 framing（单对象、JSON 数组、NDJSON 或其他形式），也没有证明非 partitioned `GZIP_JSON` 的文件包装方式。不得从单行示例推断整份下载文件结构，因此当前任务明确阻断为 `ADS_REPORT_V1_JSON_FRAMING_UNVERIFIED`。

已批准的隔离范围内仅收紧阻断诊断及测试；没有把报告接入普通 scheduler/Worker，没有创建或发布 ReportVersion/Fact。恢复发布前置条件：取得官方文件级 framing 证据后，为每个 part 做有界解压/分帧、跨 part grain 去重，再通过现有 `stageAdsReportBatch` / `publishAdsReportVersion` 路径事务化发布；不能用本地 fixture 格式替代合同证据。

验证：`node node_modules/tsx/dist/cli.mjs --test tests/amazon-ads-reporting-v1-campaign-contract.test.ts` 2/2；新增文件定向 ESLint、全库 `npm run typecheck` 和 `git diff --check` 均通过。未调用 Amazon API、未读取或写入凭证、未执行数据库或 worker 操作。


## 后续批次：SP Campaign 合同至 transport 的 fixture 闭环

扩展 `tests/amazon-ads-reporting-v1-transport.test.ts`：将已核实字段的 Campaign 请求合同直接交给 Reporting v1 transport，并通过注入 fetch fixture 验证请求 envelope、账户身份字段和 create receipt 的完整字段匹配；篡改回执字段时必须以 `ADS_REPORT_V1_RECEIPT_MISMATCH` 失败。这个测试证明两段离线代码组合工作，不代表 Amazon 接受该合同，注入 fetch 不发起网络请求，dispatch readiness 仍关闭。

验证：Campaign 合同 2/2、Reporting v1 transport 16/16、相关 ESLint、全仓 `npm run typecheck` 和 `git diff --check` 通过。没有真实 API、凭证、数据库、worker、发布或部署操作。仍待解决的下载行编码和规范化事实映射没有因本测试而变更。


## 后续批次：Campaign Reporting v1 行映射（纯函数，未接 raw 分片）

Amazon 官方 [Helpful concepts: Empty and null values](https://advertising.amazon.com/API/docs/en-us/guides/reporting/ads-v1/helpful-concepts) 明确给出 JSON 行对象示例，字段以 `campaign.id`、`metric.impressions` 等点号键平铺；无值为 JSON `null`，数值零仍为 `0`。新增 `campaign-reporting-v1-parser.ts` 据此将已解析的行对象映射到 Campaign 日期事实，保留语法器中的数字词法，不经 JS `Number`，并校验请求字段集合、必需维度、ISO 日期范围、币种格式和数值边界。它拒绝未知/缺失字段和同一报告内重复的 `(date, campaign.id)` grain。

行映射输出 `campaignName`、`currencyCode` 与 `impressions/clicks/spend/orders/sales/units`，匹配现有 Ads report staging fact 的语义，但当前没有将 v1 结果写入现有 staging/publish 表，也没有跨多个加密 raw part 读取、原子发布或下游消费。

后续纯函数适配 `campaignReportingV1RowsToStaging` 将已解析事实转换为现有 `AdsStagingFact` grain（`campaignId + reportDate`），保留 null/零及原始数值字符串；单批多币种明确阻断，不汇总或重算指标。此适配尚未连接 raw part 或 staging 写入，不代表报告已发布。

证据仍未覆盖 GZIP_JSON 文件整体 framing：文档示例证明单行对象的字段编码，不足以证明下载内容是 JSON 数组、NDJSON 或其他容器。因此入口刻意接收调用方已分帧的 JSON 行值，不自行拆文件，不接 acquisition。part 之间的重复 grain 也只能在未来的全报告发布批次统一检查。

验证：新增 Campaign 行映射与 staging 适配共 4/4；Campaign 合同 + 行映射本次运行 6/6；此前 Campaign 合同、行映射、通用 GZIP/JSON 与 transport 组合回归 24/24 保留为历史结果。定向 ESLint、全仓 `npm run typecheck` 与 `git diff --check` 通过。测试均使用本地构造 fixture；未调用 Amazon API、凭证、数据库、worker、迁移或部署。
