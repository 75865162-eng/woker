## 2026-10-27 Asia/Shanghai — ads adSales Float min/max filter · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `978431f`，分支 `codex/operations-p0-catalog-replenishment`。六广告子页新增可选参数 `adSalesMin` / `adSalesMax`（有限小数，含 0；可只设一端；min>max 拒绝「广告销售额上限不得小于下限」）。对广告日报类型列 `adSales`（Float?，六 `SellfoxAds*Daily` 均已类型化）在实体/KPI 汇总 **之前** 对成员行做含首尾比较；设置任意一端时 `s."adSales" IS NOT NULL`。与 typed `cost` 并列，互不覆盖。Agent 窄表对同类型列 `adSales` **应用**筛选。UI ads-only 双数字输入（step=any）；重置清空；forRequest 仅 ads。

不改 `defaultVisible`、schema/migration；fee / pairing / acos 等保持锁定，**Fee-mining remains paused**。无 live Sellfox / 真实库写入，不 push/deploy/SSH。回滚仅还原参数、UI 与测试。

验证：browse-query / browse-filters / workbench-read / agent-read / browse-api 定向 node:test，TypeScript、触及 ESLint、`git diff --check`；浏览器定向断言。完整 check/build、真实库与 P95 留待单独授权。

---

## 2026-10-27 Asia/Shanghai — ads cost Float min/max filter · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `6df1251`，分支 `codex/operations-p0-catalog-replenishment`。六广告子页新增可选参数 `costMin` / `costMax`（有限小数，含 0；可只设一端；min>max 拒绝「花费上限不得小于下限」）。对广告日报类型列 `cost`（Float?，六 `SellfoxAds*Daily` 均已类型化）在实体/KPI 汇总 **之前** 对成员行做含首尾比较；设置任意一端时 `s.cost IS NOT NULL`。与 listing-joined `rating`/`ratingCount` 并列，互不覆盖。Agent 窄表对同类型列 `cost` **应用**筛选（非忽略）。UI ads-only 双数字输入（step=any）；重置清空；forRequest 仅 ads。

不改 `defaultVisible`、schema/migration；adSales / fee / pairing / acos 等保持锁定，**Fee-mining remains paused**。无 live Sellfox / 真实库写入，不 push/deploy/SSH。回滚仅还原参数、UI 与测试。

验证：browse-query / browse-filters / workbench-read / agent-read / browse-api 定向 node:test，TypeScript、触及 ESLint、`git diff --check`；浏览器定向断言。完整 check/build、真实库与 P95 留待单独授权。

---

## 2026-10-27 — ads acos filter skipped (derived) · BOX LOCAL ONLY

基线 `95cb0ca`。评估 `acosMin`/`acosMax`：SellfoxAds*Daily **无** typed acos 列；workbench 排序/展示为汇总后 `cost/adSales`。在汇总前筛比值会改口径，汇总后筛需 HAVING 式发明 → **不交付**。本轮改交付 listings bsrCategory facet（见 listings-read-model / parity-gap）。

## 2026-10-27 Asia/Shanghai — ads ratingCount Int min/max filter · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `1eb6f03`，分支 `codex/operations-p0-catalog-replenishment`。六广告子页新增可选参数 `ratingCountMin` / `ratingCountMax`（安全整数，含 0；可只设一端；min>max 拒绝「评论数上限不得小于下限」）。对 Listing current 类型列 `ratingCount` 在 MSKU 优先 / ASIN 回退 LIMIT 1 lateral join **之后**、实体/KPI 汇总 **之前** 做含首尾比较；设置任意一端时 `ratingCount IS NOT NULL`。与 `ratingMin`/`ratingMax`（`ratingValue`）并列，互不覆盖。

browse / CSV / XLSX（无 layout 亦然）走 workbench；显式 `agent=1` 英文长表导出与 brand/rating 同口径 **忽略** Listing 评论数筛选。UI「评论数」双 number（step=1，下限/上限 aria），重置清空；跨域 URL 可保留，forRequest 仅 `domain=ads` 序列化。sales / performance / listings 不应用此参数。不发明 bsrRank/acos 筛选。**Fee-mining remains paused**。无 schema/migration、无 push/deploy/SSH、无 live Sellfox、无真实 DB 写入。

## 2026-10-27 Asia/Shanghai — ads rating numeric min/max filter · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `8153614`，分支 `codex/operations-p0-catalog-replenishment`。六广告子页（`ads_report` / `ads_targeting` / `ads_search_term` / `ads_campaign` / `ads_ad_group` / `ads_placement`）新增可选参数 `ratingMin` / `ratingMax`（有限小数，含 0；可只设一端；min>max 拒绝「星级上限不得小于下限」）。对 Listing current 类型列 `ratingValue`（Float，由 payload rating 解析）在 MSKU 优先 / ASIN 回退 LIMIT 1 lateral join **之后**、实体/KPI 汇总 **之前** 做含首尾比较；设置任意一端时 `ratingValue IS NOT NULL`。显示列 `rating` 仍聚合文本 `listingRating`，筛选只用 typed `ratingValue`。listing CTE 在 ads 时投影 `ratingValue`。

browse / CSV / XLSX（无 layout 亦然）走 workbench；显式 `agent=1` 英文长表导出与 brand/fulfillment/Buy Box 同口径 **忽略** Listing 星级筛选。UI「星级」双 number（step=any，下限/上限 aria），重置清空；跨域 URL 可保留，forRequest 仅 `domain=ads` 序列化。sales / performance / listings 不应用此参数。不发明 acos/bsrRank 筛选。**Fee-mining remains paused**。无 schema/migration、无 push/deploy/SSH、无 live Sellfox、无真实 DB 写入。

# Sellfox 广告子页：Phase A / B 已接入与剩余缺口

## 2026-10-27 — ads 默认显示标签 / 品牌 / 发货方式 · BOX LOCAL ONLY

基线 HEAD `cec772e41190a8c93b472e75841731827b5b6851`，分支 `codex/operations-p0-catalog-replenishment`。生产代码仅将 `columns.ads` 的 `productTags`「标签」、`brand`「品牌」、`fulfillment`「发货方式」三个 `defaultVisible: false` 改为 `true`；六页 ads / ads_targeting / ads_search_term / ads_campaign / ads_ad_group / ads_placement 沿现有共享列继承，不在 ads_* 重复定义。

labels、requiresField 和源顺序 campaignId → adGroupId → productTags → brand → fulfillment → buyBoxWinner 保持不变（活动页继续沿用既有排除 adGroupId 的规则）。现有 Listing current 类型投影、筛选与 facets 不变；默认表头与未显式选列的 CSV/XLSX 包含三列，显式选列及空选列保持权威。测试扩展三列默认勾选、隐藏后的导出参数省略、切页选择保留及默认导出表头；既有 SQL/filter/CSV 覆盖保留。

Word-diff 严格为三组 `-false,` / `+true,`；按基线仅替换三项后与整个生产文件逐字节一致，listings / sales / performance 配置分别逐字节相同。回滚只需将这三个 ads 默认标志恢复为 false，无数据库回退。**Fee-mining remains paused**；不解锁其余待接列或子页，无新增字段、schema/migration/SQL 或服务端修改。

仅 BOX 本地：无 push/fetch/deploy/SSH、live Sellfox API 或真实数据库写入，未加载/修改 `.env`；Prisma 仅使用 stub。三份定向测试文件、TypeScript、四个变更 TS 文件 ESLint 与 `git diff --check` 通过。浏览器定向用例已尝试，Chromium 启动时报 `sandbox_host_linux.cc:41` / `Operation not permitted`，SIGTRAP 退出，页面断言未执行；未绕过 sandbox，需在允许 Chromium 的本地环境补跑。

验证命令：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
# 默认 CSV/XLSX 循环同样补充三列表头，额外检查该测试文件：
node node_modules/eslint/bin/eslint.js tests/sellfox-browse-api.test.ts
git diff --check
npm run test:sellfox:browser -- --grep 'ads default image'
git diff --word-diff=porcelain --unified=0 -- src/components/sellfox/workbench-types.ts
```

本次仅默认列配置，采用定向回归与类型/lint 验证；按范围跳过完整 check/build、真实库与性能测试。后续合码/发布或 SQL/schema/性能任务再按对应门槛验证。下一候选为 listings bsrRank + bsrCategory，本轮未修改；仓库外 parity gap 由父进程更新。

---

## 2026-10-27 — ads 默认显示星级 / 评论数 / Buy Box · BOX LOCAL ONLY

> 基线 HEAD `f2ca9792653e2d6f06fa10eed08fac45082a062d`；完成状态见当前 HEAD / gap。生产代码仅将 `columns.ads` 的 `rating`「星级」、`ratingCount`「评论数」、`buyBoxWinner`「Buy Box」三个 `defaultVisible: false` 改为 `true`。六个广告页通过现有共享列继承生效，不重复定义；默认勾选及未显式选列的 CSV/XLSX 均包含三列。
>
> 保留源顺序 fulfillable → price → rating → ratingCount → campaignId → … → brand → fulfillment → buyBoxWinner → …，标签、numeric、requiresField 和现有 Listing current 类型投影、join、排序、筛选不变。image → asin → enabled → serviceStatus 邻接不变；productTags / brand / fulfillment 及尾部 MSKU / 标题 / 店铺 / 站点仍默认隐藏。显式选列与空选列保持权威，手动隐藏三列和图片后切换子页仍保留该页选择。sales / performance / listings 配置逐字节不变。
>
> enabled / serviceStatus / adStrategy / salesperson、广告组合 / 否定 / AMC 继续锁定。**Fee-mining remains paused**。无 schema / migration / SQL / 服务端改动，无新增字段、join 或 payload 解析；只复用已查询属性，未做真实 P95 benchmark。回滚仅恢复这三个默认隐藏标志，无数据库回退。
>
> 仅 BOX 本地；无 push/fetch、SSH、deploy、live Sellfox API、真实数据库写入或计划变更，未加载/修改 `.env`。验证使用 Prisma stub，不连接真实数据库。

验证结果：五个定向测试文件全部通过（Prisma stub）；TypeScript、全部 touched ESLint 和 `git diff --check` 通过。另同步 `tests/sellfox-browse-filters.test.ts` 的旧默认隐藏断言，保留显式选列覆盖。Word-diff 严格为三组 `-false,` / `+true,`，整文件按基线替换这三项后逐字节一致，其他配置未改。

浏览器定向用例已尝试，Chromium 启动时报 `sandbox_host_linux.cc:41` / `Operation not permitted`，以 SIGTRAP 退出，页面断言未执行；未绕过 sandbox，需在允许 Chromium 的本地环境补跑。

验证命令：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-browse-filters.test.ts tests/sellfox-browse-query.test.ts tests/sellfox-agent-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/browser/sellfox.spec.ts tests/sellfox-browse-filters.test.ts
git diff --check
npm run test:sellfox:browser -- --grep 'ads default image'
git diff --word-diff=porcelain --unified=0 -- src/components/sellfox/workbench-types.ts
```

定向回归保留六页 SQL join / sort / filter、显式选列、CSV/XLSX 及 null / 0 / 128 / 是 / 否语义；新增默认列及源顺序断言。完整 check/build、PGlite 集成和真实库检查不在本轮范围；后续合码/发布或 SQL/schema 变更时另按相应门槛验证。

---

## 2026-10-27 02:02:45 Asia/Shanghai — ads 默认显示 image「图片」 · Owner: Chen Jieliang · BOX LOCAL ONLY

> **BOX LOCAL ONLY**：基线 `6cb590b3358fea8059d5565224d7a50bed00542c`；只把 `columns.ads.image` 从可选尾部移到共享广告列首位、紧邻 `asin`「产品信息」之前，恢复 `defaultVisible: true`。六域 `ads` / `ads_targeting` / `ads_search_term` / `ads_campaign` / `ads_ad_group` / `ads_placement` 的默认列与未显式选列的工作台 CSV/XLSX 均包含图片；各子页原有身份列前缀不变。
>
> 广告列选择器的默认勾选集合来自 `defaultVisibleColumnKeys`，图片默认勾选；现有广告 UI 没有独立「精简」按钮（该按钮仅利润页有），本轮不新增交互。显式 `columnSelection`（包括空集合、手动隐藏图片）继续原样生效，无保存选列迁移。图片仍不可排序，继续使用既有 Listing `mainImage` join 和渲染，不新增图片预载、网络请求、SQL 或 payload 解析。
>
> `enabled` / `serviceStatus` 的位置和待接状态不变；`rating` / `ratingCount` / `productTags` / `brand` / `fulfillment` / `buyBoxWinner` 仍可选，`msku` / `title` / `name` / `marketplace` 仍在可选尾部。已交付的 productTag / fulfillment / brand / Buy Box 筛选、facets、Agent ads 英文长表与排序守卫均未改；sales / performance / listings 配置逐字节保持基线。adStrategy / salesperson、广告组合 / 否定 / AMC 继续锁定。**Fee-mining remains paused**。
>
> 无 schema / migration / SQL / 服务端代码变更；无 push/fetch、SSH、deploy/restart、migrate-on-123、真实数据库写入、live Sellfox API 或 schedules 变更，未加载/修改 `.env`。回滚仅需将 `columns.ads.image` 放回基线可选尾部并恢复默认隐藏，无数据库回退。

离线验证：五个定向测试文件、TypeScript、touched ESLint 通过；覆盖六域默认图片/紧邻产品信息、列选择器勾选、显式/空选列、CSV 与真实 ExcelJS 生成回读、可选列、筛选和 Agent 守卫。`git diff --check` 通过。Prisma 为 stub，不连接真实数据库。另核对 `workbench-types.ts` 除 `columns.ads` 行以外内容与 HEAD 完全一致，确认其他域默认配置未变。

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-filters.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-browse-query.test.ts tests/sellfox-agent-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-browse-filters.test.ts tests/browser/sellfox.spec.ts
git diff --check
# 已尝试；3 个用例在 Chromium 启动时受 BOX sandbox 限制，页面断言未执行：
npm run test:sellfox:browser -- --grep 'ads default image|reference layout keeps|changing domains or ad subtabs'
```

> 本轮本地提交受阻：`git add` 无法创建 `.git/index.lock`（Read-only file system），未执行 commit、未强制或绕过沙箱。6 个仓库文件保留为未暂存改动，父进程需提交：`feat(sellfox): default-show ads listing image column`。HEAD 仍为 `6cb590b3358fea8059d5565224d7a50bed00542c`；仓库外状态文件另行保留。

浏览器限制：`sandbox_host_linux.cc:41` / `Operation not permitted`（SIGTRAP），没有绕过沙箱；需父进程在允许 Chromium 的本地环境补跑上述 3 项。完整 check/build、PGlite/Prisma、真实 P95 未运行：本轮仅默认列配置，发布前按仓库要求补完整检查，SQL/schema 变化或专项性能验收时再运行相应验证。仓库外 `/workspace/sellfox-parity-gap.md` 已同步本状态，但不纳入 repo commit。

---

### 上轮 Buy Box 筛选状态（历史记录）

> 2026-10-27 01:52:01 Asia/Shanghai · Owner: Chen Jieliang · **BOX LOCAL ONLY**：六个广告工作台页（`ads_report` / `ads_targeting` / `ads_search_term` / `ads_campaign` / `ads_ad_group` / `ads_placement`）已解锁 `buyBox`「Buy Box」静态筛选，UI「全部 / 是 / 否」，参数 `"" / "yes" / "no"`。基线 `b6d3250e657bf03a4da22a6b3355d4fc161394ae` 的 productTag / fulfillment / brand 筛选及 productTags / brands facets 保留；无新 facets、schema 或 Prisma migration。
>
> 与 sales/performance/listings 同口径：SQL 对 Listing current typed `buyBoxWinner` 文本精确匹配「是」/「否」，复用既有 MSKU 优先 / ASIN 回退 / LIMIT 1 lateral join；**先选 Listing，再筛成员，最后汇总实体/KPI**。NULL、空值、非布尔/未知文本、缺身份、无匹配和来源已归 NULL 的冲突只计入「全部」，不借其他 ASIN 子体答案、不放大花费。广告实体的未筛选成员答案冲突时列仍为 NULL；选择是/否后仅汇总匹配成员（fixture 的 cost 5 → 是 2 / 否 3），不拿汇总列做事后筛选。
>
> UI/URL/请求、六子页切换、重置及 CSV/XLSX 贯通；仅带 `buyBox=`、无 layout/排序/选列也进入 workbench。支持 Buy Box + brand + productTag + fulfillment 联合筛选。显式 `agent=1` 导出保持原英文长表 SELECT/契约，不应用 ads Buy Box/品牌/标签/发货方式，Listing 属性排序守卫不变。sales/performance/listings 行为未改；enabled / serviceStatus / adStrategy / salesperson、广告组合 / 否定 / AMC 继续锁定。**Fee-mining remains paused**。
>
> 没有新增 join/网络请求或 payload 解析；真实规模/P95 未 benchmark。仅 BOX 本地：无 push/fetch、SSH、deploy/restart、migrate-on-123、真实库写入、live Sellfox API 或 schedules 变更；未加载/修改 `.env`。回滚本轮应用改动至上述基线即可关闭 ads Buy Box 筛选，保留已有品牌/标签/发货方式，无数据库回退。

> 本地提交受阻：`git add` 无法创建 `.git/index.lock`（Read-only file system），因此未执行 commit，未强制或绕过沙箱。11 个仓库文件保留为未暂存改动；父进程需提交：`feat(sellfox): unlock ads buyBoxWinner filter`。HEAD 仍为 `b6d3250e657bf03a4da22a6b3355d4fc161394ae`；仓库外状态文件已更新。

本轮离线验证全部通过（五个定向测试文件、六页内存 PGlite、TypeScript、touched ESLint、`git diff --check`）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-query.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-browse-filters.test.ts tests/sellfox-agent-read.test.ts
NODE_ENV=test node --import tsx tests/integration/sellfox-ads-phase-b.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js 'src/app/api/sellfox/[domain]/route.ts' 'src/app/api/sellfox/[domain]/export/route.ts' src/components/sellfox/browse-filters.tsx src/lib/sellfox/workbench-read.ts src/lib/sellfox/workbench-view.ts tests/sellfox-workbench-read.test.ts tests/sellfox-browse-query.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-browse-filters.test.ts tests/integration/sellfox-ads-phase-b.ts
git diff --check
```

覆盖六页是/否 match/no-match、NULL/缺失/未知/非布尔仅全部、组织/工作区/店铺/站点隔离、MSKU 优先/ASIN 回退、join 花费不放大、筛选先于实体/KPI/分页与导出、四筛选组合、productTags/brands facets 保留、UI 选择/重置/切页与参数往返、无 layout 普通浏览/CSV/XLSX、Agent 英文长表及排序守卫，既有 ExcelJS 生成/回读回归保留。按最小范围路线运行定向单测、一次性内存 PGlite、类型检查、touched ESLint 和 diff 检查；Prisma stub，不连真实数据库。未跑完整 check/build、浏览器或真实 P95；合码/发布前补完整检查，性能验收另做 benchmark。

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
