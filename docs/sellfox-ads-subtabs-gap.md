# Sellfox 广告子页：Phase A / B 已接入与剩余缺口

> 2026-10-27 01:21:45 Asia/Shanghai · Owner: Chen Jieliang · **BOX LOCAL ONLY**：六个广告工作台页（`ads_report` / `ads_targeting` / `ads_search_term` / `ads_campaign` / `ads_ad_group` / `ads_placement`）现已解锁 `productTag`「产品标签」筛选和 `facets.productTags`。基于本地 HEAD `0b64ec7c19710cfcc9c749f084ec5802e9cf9ad8`，无 schema / 新 migration。
>
> 复用 Listing current 的 typed `productTagNames`，请求名称 trim 后用 `@> ARRAY[tag]::text[]` 精确成员匹配，不拆分含「、」的完整标签名、不做 LIKE。沿既有 MSKU 优先 / ASIN 回退 / LIMIT 1 join **先选 Listing，再筛选成员行，最后汇总广告指标**；不从其他 ASIN 子体借标签，不放大花费。无商品身份、无匹配 Listing 或无匹配标签均排除。这是当前资料，不代表报告日历史标签。
>
> facets 沿用 sales/listings 的 **当前 Listing 组织/工作区/店铺/站点范围**，去重并排序，独立于当前 productTag/search，也不限定广告报告日期/adType/quickFilter；即使结果为空仍保留选项。ads 只返回标签 facets，不返回 brands/salespersons。UI 显示「产品标签」，支持 URL、六子页 API 参数、切页和重置；CSV/XLSX 复用同一筛选 SQL。修正仅带标签、无 layout/排序/选列时的普通浏览/导出分流，防止忽略筛选。显式 `agent=1` 导出维持既有英文长表契约及行为（不添加 Listing SELECT 字段、不应用 ads 标签筛选，Listing 属性排序仍报错提示 workbench）。
>
> 此前图片/星级/评论数/标签/品牌/发货方式/Buy Box 可选列保留；sales/performance/listings 默认列及现有标签筛选不变。`enabled` / `serviceStatus` / `adStrategy` / `salesperson`、广告组合、否定、AMC 继续锁定；**ads Buy Box/brand/fulfillment 筛选及其 facets 仍未解锁**。**Fee-mining remains paused**。
>
> 仅 BOX 本地：无 push/fetch、SSH、deploy/restart、migrate-on-123、真实数据库写入、live Sellfox API 或 schedules 变更；未加载 `.env`。回滚本次应用改动即可关闭标签筛选/facets，无数据库回退。只读 facet 查询新增为原单次 SQL 内子查询；未做真实规模/P95 benchmark，不宣称性能收益。

本轮离线验证已通过（五个定向测试文件；Prisma 均 stub，PGlite 为一次性内存库，不连接真实数据库）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-query.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-browse-filters.test.ts tests/sellfox-agent-read.test.ts
NODE_ENV=test node --import tsx tests/integration/sellfox-ads-phase-b.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js 'src/app/api/sellfox/[domain]/route.ts' 'src/app/api/sellfox/[domain]/export/route.ts' src/components/sellfox/browse-filters.tsx src/lib/sellfox/workbench-read.ts src/lib/sellfox/workbench-view.ts tests/sellfox-workbench-read.test.ts tests/sellfox-browse-query.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-browse-filters.test.ts tests/integration/sellfox-ads-phase-a.ts tests/integration/sellfox-ads-phase-b.ts
git diff --check
```

覆盖六页 match/no-match、trim/完整标签名精确成员匹配、组织/工作区/店铺隔离、MSKU 优先/ASIN 回退、join 不重复计算花费、筛选先于汇总、空结果 scoped facets、UI 选择/重置、URL/API 参数往返、无 layout 的普通浏览/CSV/XLSX 路由及显式 Agent 导出/排序守卫。旧列的真实 ExcelJS 生成/回读回归仍通过。按最小范围验证路线未跑完整 check/build、浏览器或真实 P95；发布前运行完整发布检查，真实规模性能验收另做 benchmark。

2026-10-26。Phase A/B 已对照本机真实 Sellfox XLSX 确认列映射并修复投放 ID；本轮仅 box 本机修改和离线解析，未部署、未迁移、未启用计划，未调用 createTask。

## 123 只读盘点：SD 投放 createTask 永久 `creating`（2026-10-26 续）

只读 SSH/SQL（未写库、未 createTask）。广告 `SellfoxReportTask` 按 reportTypeCode×adType×status：

| reportTypeCode | adType | status | n | 无 externalTaskId | 无 fileKey |
| --- | --- | --- | ---: | ---: | ---: |
| adProductReport | sp/sb/sd | done | 117/39/39 | 0 | 0 |
| adTargeringReport | sp/sb | done | 78/39 | 0 | 0 |
| **adTargeringReport** | **sd** | **creating** | **39** | **39** | **39** |
| adSearchTermReport | sp | done/downloaded | 53/25 | 0 | 0 |
| adCampaign/Group/Space | sp | done | 78 each | 0 | 0 |

唯一卡住组合是 **adTargeringReport × sd**：同属失败 run `sellfox-sync-8ed6f0e3-…`（manual，`adTypes=[sp,sb,sd]`，`executionAttempts=2`，窗口 2026-10-24～25）。summary 里 39 个 sd unit 最终 error 均为「广告任务创建结果不明…未重复创建。」（代码在已有 `creating`+空 externalTaskId 时的守卫）；**原始 createTask 失败原因已被第二次 attempt 覆盖**。创建时间约 06:52–06:58（Asia/Shanghai 墙钟对应库内 `updatedAt`），约 9s/店，**不像 30s 请求超时**，更像明确业务/响应失败后落入永久 `creating`。后续成功 run 仅同步了 sp。SB 投放与 SD 产品报告均有 done+fileKey，故不是「全广告类型都挂」。

**根因（代码）**：`createTask` 前先落库 `status=creating`；若请求得到明确失败（HTTP 业务码、响应缺 ID 等），catch 只写 run progress、**不改任务行**，行永久 `creating`+空 externalTaskId。同 run 重试与新 run 的同范围 ambiguous 检查都会 fail-closed，且**不再调用 createTask**，UI 顶栏只见「N 个店铺/广告类型报告失败」。

**本机修复（未部署）**：

1. `sellfoxCreateTaskAmbiguous`：超时/发送后传输不明 → 保持 `creating`；明确失败（含缺 ID、HTTP 业务响应、未发送）→ 标 `failed`。
2. `failed` + 空 externalTaskId 允许同 run 安全重提 createTask；`creating` 锁与「创建结果不明」守卫不变。
3. 聚合 `SellfoxStoreSyncError` 附带最多 3 条 unit 原因示例，便于 runs 错误列直接看见。

**已有 39 行不会被 `879ffe3` 自动改写**（禁止本任务写 123）。部署含该修复的 release 后，用运维 CLI `sellfox:ads-reset-stuck-creating`（默认 dry-run）把匹配的 `creating`+空 `externalTaskId`+空 `fileKey` 行标为 `failed`，再同步即可安全重提 createTask；**禁止删行**。真超时/有 upstream id 的遗留仍须人工关联，本 CLI 永不碰带 `externalTaskId` 的行。是否上游拒绝 SD×adTargeringReport 需部署后看新的明确错误码确认；本轮未调用 live createTask。

### 部署后重置卡住 creating（另行授权；本次只交付命令）

已新增 `scripts/sellfox-ads-reset-stuck-creating.ts`（npm：`sellfox:ads-reset-stuck-creating`）。只读写本地 `SellfoxReportTask`（及只读 join 店铺 / run 的 `executionAttempts`）；**不删行、不调赛狐 API、不改日报表、不碰有 `externalTaskId` 的行**。`SellfoxReportTask` 无 `lastError` 列：`--write` 仅把 `status` 改为 `failed`；备注 `ops reset stuck creating without externalTaskId` 出现在 CLI 逐任务 JSON / 摘要的 `lastError` 字段，供审计。

必填 `--organization-id` / `--workspace-id`；可选 `--report-type`、`--ad-type=sp|sb|sd`、`--task-id`、`--older-than-minutes=<非负整数>`。硬筛选恒为 `status=creating` 且 `externalTaskId`/`fileKey` 均为空；写路径 `updateMany` 再次断言这组条件，竞态下若行已获得上游 id 则不会被改。

在 123 已部署含 `879ffe3`（及本 CLI）的 current release 目录执行（替换真实组织/工作区 ID；建议维护窗口、确认无重叠广告同步）：

```bash
cd /opt/amazon-ad-bulk-current
ORG_ID='替换为实际组织ID'
WORKSPACE_ID='替换为实际工作区ID'

# 只读 dry-run：列出卡住 creating 行（含 shop、attempts、updatedAt）
npm run sellfox:ads-reset-stuck-creating -- --organization-id="$ORG_ID" --workspace-id="$WORKSPACE_ID" --report-type=adTargeringReport --ad-type=sd

# 审核 JSON 后，另行授权写 failed
npm run sellfox:ads-reset-stuck-creating -- --organization-id="$ORG_ID" --workspace-id="$WORKSPACE_ID" --report-type=adTargeringReport --ad-type=sd --write
```

写完后可再开一次含 sd 的投放同步（新 createTask）；仍失败则看 runs 错误列里的明确业务码。`text:` targetingId 纠正仍依赖部署 `e791d14`+`sellfox:ads-reparse-cache`，与本重置独立。

残余风险：dry-run 与 write 之间若同步写入了 `externalTaskId`，write 会跳过该行（count 可能小于 dry-run 清单）。误把仍在飞行的 createTask 标 failed 后再同步可能重复建上游任务——仅用于盘点确认的永久卡住行；可用 `--older-than-minutes` 收紧。本 CLI 不验证上游是否真无对应任务。


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

已新增 `scripts/sellfox-ads-reparse-from-cache.ts`（npm 命令 `sellfox:ads-reparse-cache`）。它与同步入口共用 `parseSellfoxCpcReport` 和 `commitSellfoxAdsReportWindow`，沿用同一解析契约、身份哈希、500 行批次及 deleteMany → createMany → task done 事务；定时同步对 done 的跳过行为保持不变。重解析不要求 runId，不修改 run/计划，不写 ProductRecord，也不调用 Sellfox createTask / pageList / download / sellfoxPost。storage driver 只使用 getBuffer；R2/S3 场景仍需读取对象存储，但不访问赛狐报告下载 URL。

**123 部署后另行授权操作（本次只交付命令，没有执行）**：先部署含 `e791d14` 的真实 `广告投放ID` 映射以及本重解析入口，确认 Phase A/B 表已经存在、Prisma Client 匹配、数据库与 storage 环境指向同一目标，且原 XLSX 可读。不需要赛狐 API 凭据或 Redis。使用有目标库维护权限的服务器账号，明确替换下面的真实组织/工作区 ID；建议增加 `--task-id=<本地 SellfoxReportTask.id>` 先核验一个任务。执行前保留受影响窗口的可恢复数据库快照及缓存文件，并在无重叠同步/其他重解析的维护窗口执行；脚本不会自动备份或停止 worker。

在 123 已部署的 current release 目录执行（`.env` 为发布脚本链接的运行配置；保留原 STORAGE_DRIVER/UPLOAD_DIR，local storage 相对路径与 systemd worker 同样以 current release 为基准）：

```bash
cd /opt/amazon-ad-bulk-current
ORG_ID='替换为实际组织ID'
WORKSPACE_ID='替换为实际工作区ID'

# 只读 dry-run：默认 adTargeringReport + adSearchTermReport，所有已有店铺/广告类型。
npm run sellfox:ads-reparse-cache -- --organization-id="$ORG_ID" --workspace-id="$WORKSPACE_ID"

# 审核相同范围的逐任务 JSON 后，另行授权应用。
npm run sellfox:ads-reparse-cache -- --organization-id="$ORG_ID" --workspace-id="$WORKSPACE_ID" --write

# 单任务缩小范围示例（默认只读；需要写入时在同一命令末尾加 --write）。
npm run sellfox:ads-reparse-cache -- --organization-id="$ORG_ID" --workspace-id="$WORKSPACE_ID" --report-type=adTargeringReport --task-id='替换为本地任务ID' --ad-type=sp
```

R2/S3 按原 storage 配置读取对象，UPLOAD_DIR 不参与对象读取。所有命令均需本次及映射修复的部署完成；不要在旧 release 上重解析。上面的 ID 占位值须替换为真实值后再运行。

筛选支持 `--report-type`（一个精确代码，另可选 adProductReport/adCampaignReport/adGroupReport/adSpaceReport）、`--store-id`、`--shop-external-id`、`--ad-type=sp|sb|sd`、`--task-id`、`--start-date`、`--end-date`。组织和工作区必填；同时提供的筛选取交集。日期只选择 startDate ≥ 起日、endDate ≤ 止日的**完整任务**，绝不截断原始替换窗口。只选 `status=done|downloaded` 且 fileKey 非 NULL 的任务；显式 task-id 不满足筛选时拒绝；没有 fileKey、pending/creating 或已失败但未保留 downloaded 状态的任务不在自动修复范围。fileKey 必须精确对应该任务的 `sellfox-reports/{org}/{workspace}/{taskId}.xlsx`，任务和店铺租户不符整批拒绝。脚本不会跨租户查找目标。

每任务 JSON 包含 taskId/fileKey/reportType/storeId/shopExternalId/adType/日期、beforeCount/afterCount、`legacyIdentityCount`（`text:` 或空串 ID 的合计）及 before/legacy/after 各最多三条身份样本，不读取旧行 payload。status 为 `would_write` / `written` / `skipped_missing` / `parse_failed` / `write_failed`；缺失、空字节或不可读文件记 skipped_missing，整份解析或事务失败保留原窗口，继续其余任务。最终摘要含 selectedTasks/failedTasks；全部成功退出 0，部分失败退出 2，参数/任务范围或查询失败退出 1。before/after 是当前数据库与该缓存解析结果的对照，不代表全量店铺完成覆盖。未知异常不回显数据库连接串、上游响应或原始行。

残余风险与回退：

- 只纠正选中的已有完整缓存窗口；部分店铺、缺 fileKey、SD targeting 缺文件仍需单独盘点，不会自动 createTask/补下载。旧文件没有真实 ID 列时，现有 text hash/空串兼容规则仍会保留；本次不改变列映射或币种 NULL 规则。
- **合法的仅表头空报告会解析为 0 行，`--write` 会清空整个原窗口**；零字节文件则拒绝。必须审核 dry-run 的行数与身份，空报告通过不能当作非空 SB/SD 验收。
- 多个任务可能覆盖同一窗口；按固定 startDate/endDate/id 升序处理，后处理缓存覆盖之前结果，不保证其内容更新。建议用 task-id 选择已核验缓存，避免旧缓存覆盖较新数据；不要与同步 worker 或另一重解析并发。前置计数不是写事务内的快照。单任务事务原子，不是整批事务；已成功任务不会因后续失败回滚。
- 串行逐文件完整解析与窗口删除/重写会消耗内存、SQL/WAL/锁时间；按店铺、广告类型、任务或日期缩小范围，现有事务超时与 XLSX 大小/行数限制不变，本次未做生产容量/P95 测试。
- 重复运行相同缓存与映射的身份和行数幂等，但 syncedAt/任务 updatedAt 会刷新。执行后再次 dry-run 核验 beforeCount/身份；需要恢复旧数据时使用事先保留的窗口快照，回退代码不会恢复已替换身份，不做数据库 down/drop。

本入口本机验证：指定生命周期、缓存重解析、Phase A/B 四份测试，TypeScript、变更 TS ESLint 和 `git diff --check`；测试使用生成的 ExcelJS 内存夹具与 mock DB/storage，覆盖零写入、旧身份清除、租户边界、缺文件无 HTTP、幂等、事务回滚、500 行批次与空报告。未运行全量 check/生产构建/浏览器 E2E/真实库 apply；生产实际覆盖与性能需受控执行后验收。

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
