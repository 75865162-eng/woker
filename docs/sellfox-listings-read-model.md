## 2026-10-27 — listings revenue30 numeric min/max · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `e458595`，分支 `codex/operations-p0-catalog-replenishment`。交付 listings **revenue30**「30天销售额」含首尾数值筛选参数 `revenue30Min`/`revenue30Max`（有限数字；0 合法；上下限倒置拒「30天销售额上限不得小于下限」）。对类型列 `sellfox_listing_current."revenue30"`（Float?；窗口指标；workbench-types「30天销售额」）做 >= / <=；设置任意一端时排除 NULL。与 revenue7/14 同形双端浮点，不默认、不跨域。列表/计数/汇总/CSV/XLSX 与 Agent 窄表同口径。UI listings-only 双数字输入（step=any；14天销售额后 / Listing库存前）；重置清空；forRequest 仅 listings。单独出现亦进 workbench。

不改 `defaultVisible`、schema/migration；配对 / fee 保持锁定，**Fee-mining remains paused**。无 live Sellfox / 真实库写入，不 push/deploy/SSH。回滚仅还原参数、UI 与测试。

## 2026-10-27 — listings revenue14 numeric min/max · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `2946a30`，分支 `codex/operations-p0-catalog-replenishment`。交付 listings **revenue14**「14天销售额」含首尾数值筛选参数 `revenue14Min`/`revenue14Max`（有限数字；0 合法；上下限倒置拒「14天销售额上限不得小于下限」）。对类型列 `sellfox_listing_current."revenue14"`（Float?；窗口指标；workbench-types「14天销售额」）做 >= / <=；设置任意一端时排除 NULL。与 revenue7 同形双端浮点，不默认、不跨域。列表/计数/汇总/CSV/XLSX 与 Agent 窄表同口径。UI listings-only 双数字输入（step=any；7天销售额后 / Listing库存前）；重置清空；forRequest 仅 listings。单独出现亦进 workbench。

不改 `defaultVisible`、schema/migration；配对 / fee 保持锁定，**Fee-mining remains paused**。无 live Sellfox / 真实库写入，不 push/deploy/SSH。回滚仅还原参数、UI 与测试。

## 2026-10-27 — listings revenue7 numeric min/max · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `6428caa`，分支 `codex/operations-p0-catalog-replenishment`。交付 listings **revenue7**「7天销售额」含首尾数值筛选参数 `revenue7Min`/`revenue7Max`（有限数字；0 合法；上下限倒置拒「7天销售额上限不得小于下限」）。对类型列 `sellfox_listing_current."revenue7"`（Float?；窗口指标；workbench-types「7天销售额」）做 >= / <=；设置任意一端时排除 NULL。与 price / listingQuantity 同形双端浮点，不默认、不跨域。列表/计数/汇总/CSV/XLSX 与 Agent 窄表同口径。UI listings-only 双数字输入（step=any；30天销量后 / Listing库存前）；重置清空；forRequest 仅 listings。单独出现亦进 workbench。

不改 `defaultVisible`、schema/migration；配对 / fee 保持锁定，**Fee-mining remains paused**。无 live Sellfox / 真实库写入，不 push/deploy/SSH。回滚仅还原参数、UI 与测试。

## 2026-10-27 — listings sales30 numeric min/max · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `8403d9a`，分支 `codex/operations-p0-catalog-replenishment`。交付 listings **sales30**「30天销量」含首尾整数筛选参数 `sales30Min`/`sales30Max`（safe int；0 合法；上下限倒置拒「30天销量上限不得小于下限」）。对类型列 `sellfox_listing_current."sales30"`（Int?；窗口指标；workbench-types「30天销量」）做 >= / <=；设置任意一端时排除 NULL。与 sales7/sales14 同形双端整数，不默认、不跨域。列表/计数/汇总/CSV/XLSX 与 Agent 窄表同口径。UI listings-only 双数字输入（step=1；14天销量后 / Listing库存前）；重置清空；forRequest 仅 listings。单独出现亦进 workbench。

不改 `defaultVisible`、schema/migration；配对 / fee 保持锁定，**Fee-mining remains paused**。无 live Sellfox / 真实库写入，不 push/deploy/SSH。回滚仅还原参数、UI 与测试。

## 2026-10-27 — listings sales14 numeric min/max · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `6e77901`，分支 `codex/operations-p0-catalog-replenishment`。交付 listings **sales14**「14天销量」含首尾整数筛选参数 `sales14Min`/`sales14Max`（safe int；0 合法；上下限倒置拒「14天销量上限不得小于下限」）。对类型列 `sellfox_listing_current."sales14"`（Int?；窗口指标；workbench-types「14天销量」）做 >= / <=；设置任意一端时排除 NULL。与 sales7 同形双端整数，不默认、不跨域。列表/计数/汇总/CSV/XLSX 与 Agent 窄表同口径。UI listings-only 双数字输入（step=1；7天销量后 / Listing库存前）；重置清空；forRequest 仅 listings。单独出现亦进 workbench。

不改 `defaultVisible`、schema/migration；配对 / fee 保持锁定，**Fee-mining remains paused**。无 live Sellfox / 真实库写入，不 push/deploy/SSH。回滚仅还原参数、UI 与测试。

## 2026-10-27 — listings sales7 numeric min/max · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `ceb033b`，分支 `codex/operations-p0-catalog-replenishment`。交付 listings **sales7**「7天销量」含首尾整数筛选参数 `sales7Min`/`sales7Max`（safe int；0 合法；上下限倒置拒「7天销量上限不得小于下限」）。对类型列 `sellfox_listing_current."sales7"`（Int?；窗口指标；workbench-types 已有列「7天销量」作 UI 证据，不等待 Sellfox web）做 >= / <=；设置任意一端时排除 NULL。与 fulfillable / bsrRank 同形双端整数，不默认、不跨域。列表/计数/汇总/CSV/XLSX 与 Agent 窄表同口径。UI listings-only 双数字输入（step=1；价格后 / Listing库存前）；重置清空；forRequest 仅 listings。单独出现亦进 workbench。

不改 `defaultVisible`、schema/migration；配对 / fee 保持锁定，**Fee-mining remains paused**。无 live Sellfox / 真实库写入，不 push/deploy/SSH。回滚仅还原参数、UI 与测试。

## 2026-10-27 — listings fulfillable numeric min/max · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `c7c68b4`，分支 `codex/operations-p0-catalog-replenishment`。交付 listings **fulfillable**「可售」含首尾整数筛选参数 `fulfillableMin`/`fulfillableMax`（safe int；0 合法；上下限倒置拒「可售上限不得小于下限」）。对类型列 `sellfox_listing_current."fulfillable"`（Int?；inventoryManage.available 写入；**listings 不被库存补充覆盖**，与 totalInventory 库存汇总不同）做 >= / <=；设置任意一端时排除 NULL。与 bsrRank / totalInventory 同形双端整数，不默认、不跨域。列表/计数/汇总/CSV/XLSX 与 Agent 窄表同口径。UI listings-only 双数字输入（step=1）；重置清空；forRequest 仅 listings。单独出现亦进 workbench。列标签沿用 workbench「可售」（非「可履约」/「FBA可售」）。

不改 `defaultVisible`、schema/migration；配对 / fee / window metrics 等保持锁定，**Fee-mining remains paused**。无 live Sellfox / 真实库写入，不 push/deploy/SSH。回滚仅还原参数、UI 与测试。

## 2026-10-27 — listings price numeric min/max · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `20d063a`，分支 `codex/operations-p0-catalog-replenishment`。交付 listings **price**「价格」含首尾数值筛选参数 `priceMin`/`priceMax`（有限数字；0 合法；上下限倒置拒「价格上限不得小于下限」）。对类型列 `sellfox_listing_current.price`（Float?；SQL `s.price` 无引号）做 >= / <=；设置任意一端时排除 NULL。与 listingQuantity / warehousing 同形双端，不默认、不跨域。列表/计数/汇总/CSV/XLSX 与 Agent 窄表同口径。UI listings-only 双数字输入（step=any）；重置清空；forRequest 仅 listings。单独出现亦进 workbench。

不改 `defaultVisible`、schema/migration；配对 / fee / fulfillable 等保持锁定，**Fee-mining remains paused**。无 live Sellfox / 真实库写入，不 push/deploy/SSH。回滚仅还原参数、UI 与测试。

## 2026-10-27 — listings warehousing numeric min/max · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `8059277`，分支 `codex/operations-p0-catalog-replenishment`。交付 listings **warehousing**「入库中」含首尾数值筛选参数 `warehousingMin`/`warehousingMax`（有限数字；0 合法；上下限倒置拒「入库中上限不得小于下限」）。对类型列 `sellfox_listing_current."warehousing"`（Float?）做 >= / <=；设置任意一端时排除 NULL。与 unsellable / reservedQty / listingQuantity 同形。列表/计数/汇总/CSV/XLSX 与 Agent 窄表同口径。UI listings-only 双数字输入（step=any）；重置清空；forRequest 仅 listings。单独出现亦进 workbench。

不改 `defaultVisible`、schema/migration；配对 / fee 等保持锁定，**Fee-mining remains paused**。无 live Sellfox / 真实库写入，不 push/deploy/SSH。回滚仅还原参数、UI 与测试。

验证：browse-query / browse-filters / listings-read / agent-read / browse-api 定向 node:test，TypeScript、触及 ESLint、`git diff --check`；浏览器定向断言。完整 check/build、真实库与 P95 留待单独授权。

---

## 2026-10-27 — listings unsellable numeric min/max · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `336d302`，分支 `codex/operations-p0-catalog-replenishment`。交付 listings **unsellable**「不可售」含首尾数值筛选参数 `unsellableMin`/`unsellableMax`（有限数字；0 合法；上下限倒置拒「不可售上限不得小于下限」）。对类型列 `sellfox_listing_current."unsellable"`（Float?）做 >= / <=；设置任意一端时排除 NULL。与 reservedQty / listingQuantity 同形。列表/计数/汇总/CSV/XLSX 与 Agent 窄表同口径。UI listings-only 双数字输入（step=any）；重置清空；forRequest 仅 listings。单独出现亦进 workbench。

不改 `defaultVisible`、schema/migration；配对 / fee / warehousing 等保持锁定，**Fee-mining remains paused**。无 live Sellfox / 真实库写入，不 push/deploy/SSH。回滚仅还原参数、UI 与测试。

验证：browse-query / browse-filters / listings-read / agent-read / browse-api 定向 node:test，TypeScript、触及 ESLint、`git diff --check`；浏览器定向断言。完整 check/build、真实库与 P95 留待单独授权。

---

## 2026-10-27 — listings reservedQty numeric min/max · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `ae45e89`，分支 `codex/operations-p0-catalog-replenishment`。交付 listings **reservedQty**「预留」含首尾数值筛选参数 `reservedQtyMin`/`reservedQtyMax`（有限数字；0 合法；上下限倒置拒「预留上限不得小于下限」）。对类型列 `sellfox_listing_current."reservedQty"`（Float?）做 >= / <=；设置任意一端时排除 NULL。与 listingQuantity 同形。列表/计数/汇总/CSV/XLSX 与 Agent 窄表同口径。UI listings-only 双数字输入（step=any）；重置清空；forRequest 仅 listings。单独出现亦进 workbench。

不改 `defaultVisible`、schema/migration；配对 / fee / unsellable / warehousing 等保持锁定，**Fee-mining remains paused**。无 live Sellfox / 真实库写入，不 push/deploy/SSH。回滚仅还原参数、UI 与测试。

验证：browse-query / browse-filters / listings-read / agent-read / browse-api 定向 node:test，TypeScript、触及 ESLint、`git diff --check`；浏览器定向断言。完整 check/build、真实库与 P95 留待单独授权。

---

## 2026-10-27 — listings listingQuantity numeric min/max · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `ef9f0e8`，分支 `codex/operations-p0-catalog-replenishment`。交付 listings **listingQuantity**「Listing库存」含首尾数值筛选参数 `listingQuantityMin`/`listingQuantityMax`（有限数字；0 合法；上下限倒置拒「Listing库存上限不得小于下限」）。对类型列 `sellfox_listing_current."listingQuantity"`（payload.quantity；Float?）做 >= / <=；设置任意一端时排除 NULL。不与库存域「可售库存」或 fulfillable 混名。列表/计数/汇总/CSV/XLSX 与 Agent 窄表同口径。UI listings-only 双数字输入（step=any）；重置清空；forRequest 仅 listings。单独出现亦进 workbench。

不改 `defaultVisible`、schema/migration；配对 / fee / reservedQty 等保持锁定，**Fee-mining remains paused**。无 live Sellfox / 真实库写入，不 push/deploy/SSH。回滚仅还原参数、UI 与测试。

验证：browse-query / browse-filters / listings-read / agent-read / browse-api 定向 node:test，TypeScript、触及 ESLint、`git diff --check`；浏览器定向断言。完整 check/build、真实库与 P95 留待单独授权。

---

## 2026-10-27 — listings bsrCategory exact facet · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `95cb0ca`，分支 `codex/operations-p0-catalog-replenishment`。本刀优先评估 ads **acos** min/max：ads 日报仅有 typed `cost`/`adSales`，ACOS 为 workbench/agent 汇总后派生（`cost/adSales`），非类型列 → **不发明** acos 筛选。回退交付 listings **bsrCategory**「BSR类目」精确筛选参数 `bsrCategory`（trim；镜像 brand/dxmPublishState）。对 `sellfox_listing_current."bsrCategory"` 精确匹配；空不加条件；NULL 仅计入「全部」。facets 新增 `bsrCategories`（scope-only DISTINCT，排除 NULL）；facet_source 同步投影 bsrCategory。列表/计数/汇总/CSV/XLSX 与 Agent 窄表同口径。UI listings-only 下拉（facets + URL 值）；重置清空；forRequest 仅 listings。单独出现亦进 workbench。

不改 `defaultVisible`、schema/migration；配对 / ads acos / fee 保持锁定，**Fee-mining remains paused**。无 live Sellfox / 真实库写入，不 push/deploy/SSH。回滚仅还原参数、facet_source/facets、UI 与测试。

验证：browse-query / browse-filters / listings-read / agent-read / browse-api 定向 node:test，TypeScript、触及 ESLint、`git diff --check`；浏览器定向断言（BSR类目序列化），Chromium SIGTRAP 历史记录。完整 check/build、真实库与 P95 留待单独授权。

---

## 2026-10-27 06:28:48 — listings bsrRank numeric min/max filter · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `f07993b`，分支 `codex/operations-p0-catalog-replenishment`。仅 listings 新增参数 `bsrRankMin` / `bsrRankMax`（安全整数，含 0；可只设一端；min>max 拒绝「BSR上限不得小于下限」）。对 `sellfox_listing_current` 类型列 `bsrRank`（Float?，按整数比较）做含首尾筛选；设置任意一端时 `bsrRank IS NOT NULL`。列表、计数、汇总、CSV/XLSX 与 Agent 窄表同口径；facets 仍 scope-only。UI「BSR」双 number 输入（step=1，下限/上限 aria），重置清空；跨域 URL 可保留，forRequest 仅 listings 序列化。单独出现亦进入 workbench（显式 `agent=1` 导出仍走 Agent 并应用同筛选）。不发明 bsrCategory 筛选/AWD。

不改 `defaultVisible`、schema/migration；配对 / 划线价 / ads acos / fee 筛选保持锁定，**Fee-mining remains paused**。无 live Sellfox API 或真实数据库写入，不 push/deploy/SSH/Mac。回滚仅还原本次参数、listings-read/agent-read 谓词与配套测试，无数据操作。

验证：browse-query / browse-filters / listings-read / agent-read / browse-api 定向 node:test，TypeScript、触及 ESLint、`git diff --check`；浏览器定向断言已更新（BSR下限/上限序列化），Chromium SIGTRAP 历史问题记录、不绕过沙箱。完整 check/build、真实库与 P95 留待单独授权。

---

## 2026-10-27 — listings totalInventory numeric min/max filter · BOX LOCAL ONLY · FILTER PIVOT

基线 HEAD `97dc1af`，分支 `codex/operations-p0-catalog-replenishment`。仅 listings 新增参数 `totalInventoryMin` / `totalInventoryMax`（安全整数，含 0；可只设一端；min>max 拒绝）。**不**读 `sellfox_listing_current` 上不存在的列，而是对 `sellfox_inventory_current` 按 storeId+msku 做与 workbench 列 enrichment 同口径的汇总：`CASE WHEN count("totalInventory")=count(*) THEN sum("totalInventory") END`；汇总为 NULL（无库存行 / 任一仓 NULL）在设置任意一端时不匹配。列表、计数、汇总、CSV/XLSX 与 Agent 窄表同口径；facets 仍 scope-only。UI「总库存」双 number 输入（下限/上限 aria），重置清空；跨域 URL 可保留，forRequest 仅 listings 序列化。单独出现亦进入 workbench（显式 `agent=1` 导出仍走 Agent）。不发明 AWD 字段。

不改 `defaultVisible`、schema/migration；配对 / 划线价 / ads rating / fee 筛选保持锁定，**Fee-mining remains paused**。无 live Sellfox API 或真实数据库写入，不 push/deploy/SSH/Mac。回滚仅还原本次参数、两条查询路径 EXISTS 子查询与配套测试，无数据操作。

验证：browse-query / browse-filters / listings-read / agent-read / browse-api 定向 node:test，TypeScript、触及 ESLint、`git diff --check`；浏览器定向断言已更新（总库存下限/上限序列化），Chromium SIGTRAP 历史问题记录、不绕过沙箱。完整 check/build、真实库与 P95 留待单独授权。

---

# Sellfox listings 列表延迟整改（2026-10-26）

## 2026-10-27 — listings 首次售出日期范围筛选 · BOX LOCAL ONLY

基线 HEAD `9adcc96`，分支 `codex/operations-p0-catalog-replenishment`。仅 listings 新增专用参数 `firstSaleFrom` / `firstSaleTo`（YYYY-MM-DD），对类型 TEXT 列 `sellfox_listing_current."firstSaleDate"` 作含首尾范围比较；**不**复用上架时间的 `from` / `to`（仍只绑定 `openDate`）。空两端不加条件；只设一端仅限制该端；设置任意范围时 NULL firstSaleDate 不匹配。触发器写入时已 COALESCE(firstSaleDate, firstOrderDate) 入列，筛选只读类型列，运行时不另写 COALESCE。列表、计数、汇总、导出及 Agent 窄表同口径；facets 仍仅受组织/工作区/店铺/站点范围限制。UI 在「上架时间」旁增加独立「首次售出」日期输入与快捷项（开始/结束 aria 标签不与 openDate 冲突）；重置清空两端。sales / performance / inventory / ads 不应用此参数；跨域 URL 可保留，但 forRequest 仅 listings 序列化。

不改 `defaultVisible`、schema/migration、openDate 语义；配对 / 划线价 / inventory min-max / ads rating / fee 筛选保持锁定，**Fee-mining remains paused**。无 live Sellfox API 或真实数据库写入，不 push/deploy/SSH/Mac。回滚仅还原本次专用参数与两条查询路径条件及配套测试，无数据操作。

验证使用隔离 Prisma stub：browse-query / browse-filters / listings-read / agent-read / browse-api 定向 node:test，TypeScript、触及 ESLint、`git diff --check`；浏览器定向断言已更新（首次售出开始序列化 `firstSaleFrom=` 且不清除 openDate），Chromium SIGTRAP 历史问题记录、不绕过沙箱。完整 check/build、真实库与 P95 留待单独授权。

---

## 2026-10-27 — listings DXM 发布状态精确筛选与 facets · BOX LOCAL ONLY

基线 HEAD `83c75ac`，分支 `codex/operations-p0-catalog-replenishment`。仅 listings 新增 `dxmPublishState=<完整原值>`：去首尾空格后，对 `sellfox_listing_current."dxmPublishState"` 类型 TEXT 列参数化 `=` 精确匹配；空参数不加条件，NULL 仅在「全部」中出现。browse、计数、汇总、CSV/XLSX 和 Agent 窄表导出同口径，参数单独出现亦进入 workbench（显式 `agent=1` 导出仍用 Agent 路径）。sales / performance / inventory / ads 均不应用此参数；跨域 URL 可保留选择，但非 listings 请求不序列化它。

`facets.dxmPublishStates` 复用现有 scope-only `facet_source`，选取非 NULL 原值 `DISTINCT` 并排序；仅受组织/工作区/店铺/站点范围限制，不受 DXM、brand、标签、状态、搜索、日期或分页行筛选影响；导出不计算 facets。UI「DXM 发布状态」紧邻 Listing 状态，选项仅来自 facets 加 URL 当前值，去重排序，重置清空；导航/切工作区沿 brand 模式清理旧 facets 并防护迟到响应。**DXM 发布状态 ≠ 配对状态**，配对状态与划线价类型原有 `missingFilter` 继续锁定。不定义状态枚举，不改 `defaultVisible`、schema/migration、同步或 worker；inventory range / firstSaleDate / fee 筛选不解锁，**Fee-mining remains paused**。无 push/deploy/SSH 或真实数据库写入；回滚本片应用提交即可，无数据操作。

验证：`NODE_ENV=test node --import tsx --test tests/sellfox-browse-query.test.ts tests/sellfox-browse-filters.test.ts tests/sellfox-listings-read.test.ts tests/sellfox-agent-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-workbench-read.test.ts` 使用隔离 Prisma stub，5 个测试文件通过；browse-filters 9/10 用例通过（含新增 DXM、原 openDate 和配对锁定），唯一失败仍为下节已记录的 HEAD 广告默认列陈旧断言（line 56），本片不修改该断言或默认值。`npx tsc --noEmit`、触及 TS/TSX 的 ESLint、`git diff --check` 通过。浏览器定向运行 `npm run test:sellfox:browser -- --grep 'listing current and advertising product daily'`：fixture 已提供 DXM facet，保留 openDate 断言并新增选择/请求序列化/跨域忽略断言；Chromium 在 `sandbox_host_linux.cc:41` 报 `Operation not permitted` / SIGTRAP，页面断言未执行，未绕过沙箱。完整 check/build、真实库执行与 P95 不在此本地 slice 范围，浏览器需在允许 Chromium 的环境补跑；额外 DISTINCT 的真实库性能留待专项验证。

---

## 2026-10-27 — listings 上架时间范围筛选 · BOX LOCAL ONLY

基线 HEAD `c952c75`，分支 `codex/operations-p0-catalog-replenishment`。仅解锁 listings「上架时间」日期输入和既有快捷项，复用 `from` / `to` 对 `sellfox_listing_current` 的类型 TEXT 列 `openDate`（YYYY-MM-DD）作含首尾的范围比较；不是 `sourceUpdatedAt`「更新时间」。未设日期时保留全部 Listing，不默认昨天；只设一端时仅限制该端，设置任意范围时 NULL openDate 不匹配。「全部历史」和重置可清空范围。列表、计数、汇总、导出及 Agent 窄表共用此口径，facets 仍仅受组织/工作区/店铺/站点范围限制。

不改 `defaultVisible`、schema/migration、其他域日期语义；stores 日期仍禁用。配对状态 / 划线价类型 / AWD / salesperson / fee 筛选保持锁定，**Fee-mining remains paused**；inventory range、firstSaleDate、bsrRank、dxmPublishState 筛选不属于本 slice，DXM 发布状态不解释为配对。无 live Sellfox API 或真实数据库写入，不 push/deploy/SSH/Mac。回滚仅还原本次 UI 与两条查询路径的 openDate 条件及配套测试，无数据操作。

验证使用隔离 Prisma stub：browse-filters、listings-read、agent-read、workbench-read、browse-api 的 node:test，TypeScript、触及文件 ESLint 与 `git diff --check`；浏览器定向运行 `npm run test:sellfox:browser -- --grep 'listing current and advertising product daily'`，若 Chromium SIGTRAP 则记录、不绕过沙箱。完整 check/build、真实库与 P95 验证留待单独授权的合码/发布或性能专项。

本轮结果：listings-read、agent-read、workbench-read、browse-api 文件通过；browse-filters 新增日期用例和其余既有用例通过，唯独旧广告默认列用例仍把标签/品牌/发货方式断言为未勾选，与 HEAD 已有默认配置不符。取 HEAD 原测试复跑同样失败，本轮不修改默认列或该无关断言。TypeScript、触及文件 ESLint、`git diff --check` 通过。浏览器启动在 `sandbox_host_linux.cc:41` 报 `Operation not permitted` / SIGTRAP，日期请求序列化页面断言未执行；未绕过沙箱，需在允许 Chromium 的环境补跑上述单项用例。

---

## 2026-10-27 — listings 默认显示 DXM 发布状态 · BOX LOCAL ONLY

基线 HEAD `e24796d`（`e24796d49ff66d22faa123c695968f3c18b516f1`），分支 `codex/operations-p0-catalog-replenishment`。生产源码仅将 listings 的 `dxmPublishState`「DXM 发布状态」`defaultVisible` 从 `false` 改为 `true`；**label 与 requiresField 不变**（`Listing 当前快照 dxmPublishState 类型投影；原值展示，非配对状态`）。status → dxmPublishState → fulfillment → image 源顺序保持不变。默认表头、初始勾选和无显式选列 CSV/XLSX 增加「DXM 发布状态」，紧接「状态」。仍只展示去首尾空格的字符串原值（如 `delete`），**不等于配对状态**；配对状态 / 划线价类型筛选继续灰显。显式单选、空选、取消 DXM 后会话保留继续优先，不迁移已有选择。

ads / sales / performance、尾部独立 msku / marketplace / capturedAt / currency、业务员 missing 本轮不改。**Fee-mining remains paused**。不新增字段、live Sellfox API、schema/migration、SQL、服务端请求或真实数据库写入。回滚仅还原该默认值及对应测试/文档，无数据操作。

验证命令（Prisma stub，不连接真实数据库，不加载 `.env`）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/sellfox-listings-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
git diff --word-diff=porcelain --unified=0 -- src/components/sellfox/workbench-types.ts
NODE_ENV=test npm run test:sellfox:browser -- --grep 'listing DXM publish state|listings default brand'
```

验证结果：指定测试文件、TypeScript、ESLint 与 `git diff --check` 通过。word-diff 生产变更恰为 listings `dxmPublishState` 一处 `-false` / `+true`。默认集合含 dxmPublishState；配对/划线价锁定入口仍禁用。浏览器定向：默认表头可见、勾选、原文 `delete`、取消后会话/导出移除；若 Chromium SIGTRAP 则记录不绕过。

全 workbench 域剩余默认隐藏（typed vs locked）见本轮 gap 扫描：performance 仅 identity；listings 余 map-false msku/marketplace/capturedAt/currency；sales 下一候选 `inventoryCapturedAt`；ads 余 identity + missing。本 slice 不做 sales。

仅 BOX 本地，不 push/fetch/deploy/SSH，不读写 `.env`。仓库外 parity-gap 由父进程更新。下方为历史批次。

---

## 2026-10-27 — listings 默认显示父SKU / FNSKU · BOX LOCAL ONLY

基线 HEAD `9ac197b`（`9ac197bd18f9935e4f17ffa7ae31529eb862a262`），分支 `codex/operations-p0-catalog-replenishment`。生产源码仅将 listings 的 `parentSku`「父SKU」、`fnsku`「FNSKU」两个 `defaultVisible` 从 `false` 改为 `true`；labels、requiresField 及 parentAsin → parentSku → fnsku → sku 源顺序保持不变。默认表头、初始勾选和无显式选列 CSV/XLSX 增加这两列；显式单选、空选、各自/成组选列与隐藏继续优先，切换数据域保留取消状态，不迁移已有会话选择。文本前导零保留，NULL/缺失为空白。

`dxmPublishState` 保持默认隐藏，只展示原文，**不等于配对状态**；配对、父体、业务员等锁定入口不解锁。salesperson、ads / sales / performance、尾部独立 msku / marketplace / capturedAt / currency 和费用 keys 不改。**Fee-mining remains paused**。不新增字段、live Sellfox API、schema/migration、SQL、服务端请求或真实数据库写入。回滚仅还原这两个默认值及对应测试/文档，无数据操作。

验证命令（Prisma stub，不连接真实数据库，不加载 `.env`）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
git diff --word-diff=porcelain --unified=0 -- src/components/sellfox/workbench-types.ts
# 单项隔离模拟浏览器；若 Chromium 在 BOX sandbox 中 SIGTRAP，记录结果，不绕过：
NODE_ENV=test npm run test:sellfox:browser -- --grep 'listings default brand, amazonBrand'
```

验证结果：三个指定测试文件全部通过（Prisma stub，零失败）；TypeScript 和指定 ESLint 通过。精确默认集合、parentAsin → parentSku → fnsku → sku 顺序、默认 CSV/XLSX、两列各自/成组选列及隐藏、显式空选、前导零文本和 NULL/缺失均已覆盖。word-diff 的全部变化 token 恰为两组 `-false` / `+true`；逐字节比对确认整个生产文件等于基线加这两处 listings 默认值替换。`git diff --check` 通过。

单项模拟浏览器已尝试，Chromium 启动在 `sandbox_host_linux.cc:41` 报 `Operation not permitted`，以 SIGTRAP 退出，页面断言未执行；未绕过沙箱。已扩展的默认表头、初始勾选、取消后会话保留及 CSV/Excel 导出移除断言，需在允许 Chromium 的本地环境补跑。

全 workbench 域默认隐藏扫描（仅统计已有类型数据且非 unavailable/missing 的列；代码/已有 stub 验证，不宣称本轮实库覆盖）：

- listings：5 列，`dxmPublishState` / `msku` / `marketplace` / `capturedAt` / `currency`。DXM 的既有 delete/空值观察不足以解释配对，仍属较弱候选；其余是此次明确冻结的尾部列，MSKU/站点还与组合列重复。
- sales：3 列，`inventoryCapturedAt` / `currency` / `marketplace`。库存快照时间来自既有 current 库存补充，是当前库存采集时间，不是销售日历史库存时间。
- performance：85 列；`asin` / `title` / `marketplace`，77 个既有可选成本/费用/赔偿/收入列（从 `commodityCost` 到 `promotionTaxAmount`，含广告费用分项），以及 `refundRate` / `refundPrice` / `refundNum` / `fbaQuantity` / `fbmQuantity`。已有类型读路径不代表获得默认展示或继续 fee-mining 授权；均保持不变。
- ads、ads_targeting、ads_search_term、ads_campaign、ads_ad_group、ads_placement：各 4 列，均为 `msku` / `title` / `name` / `marketplace`；title 与产品信息组合列重复，其他独立身份/店铺列需另评估展示价值。

下一非费用候选为 **sales.inventoryCapturedAt**：有既有类型值和 current 库存补充/导出测试，可明确现有总库存的采集时间，但属于另一个域，必须单独授权并保留“当前快照、非销售日历史”的口径。本 slice 的硬边界已到：listings 余项均为弱语义 DXM 或明确冻结的尾部列；不可用的业务员、AWD、运营/销量洞察、广告策略不计入真实类型数据候选。未访问真实库、重新采集或继续费用挖掘。

仅 BOX 本地，不 push/fetch/deploy/SSH，不读写 `.env`，不写其他主机路径。跳过完整 check/build、数据库集成与真实 P95：本轮仅两个既有列的默认标记，合码/发布或查询/性能专项再补对应验证。仓库外 parity-gap 文档留给父进程更新。下方为历史批次，以本节为当前状态。

## 2026-10-27 — listings 默认显示五列费用簇 · BOX LOCAL ONLY

基线 HEAD `88be03e`（`88be03e7d9fb3a37bbc7f9d5be76723d82584a9f`），分支 `codex/operations-p0-catalog-replenishment`。生产源码仅将 listings 的 `purchaseCost`「采购成本」、`fbaFees`「FBA费用」、`referralFee`「佣金」、`totalFee`「总费用」、`headTripCost`「头程」五个 `defaultVisible` 从 `false` 改为 `true`。labels、numeric、requiresField 和 bsrCategory → purchaseCost → fbaFees → referralFee → totalFee → headTripCost → buyBoxWinner 源顺序保持不变。复用既有类型投影，默认表头、初始勾选及无显式选列 CSV/XLSX 增加这五列；显式单选、空选、单独/成组选列与隐藏继续优先，切换数据域保留取消状态，不迁移已有会话选择。NULL/缺失保持空白，零值与原始小数保持数值。

parentSku、fnsku、dxmPublishState 及尾部独立列维持原默认配置；openDate/库存筛选、配对、父体、业务员、AWD 等锁定入口不解锁。ads / sales / performance 及广告子页配置保持基线原样。**Fee-mining remains paused**：仅显示五个既有类型费用列，不新增费用 key、字段、live Sellfox API、SQL、schema/migration、服务端逻辑或请求/计算，不做真实数据库写入。回滚仅还原五个默认值及配套测试/文档，无数据操作。

验证命令（Prisma stub，不连接真实数据库，不加载 `.env`）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
git diff --word-diff=porcelain -- src/components/sellfox/workbench-types.ts
# 单项隔离模拟浏览器；若 Chromium 在 BOX sandbox 中 SIGTRAP，记录结果，不绕过：
NODE_ENV=test npm run test:sellfox:browser -- --grep 'listings default brand, amazonBrand'
```

验证结果：三个定向测试文件全部通过（零失败），TypeScript、指定 ESLint 与 `git diff --check` 通过。精确默认集合、bsrCategory → 五列费用簇 → buyBoxWinner 源顺序、默认 CSV/XLSX、五列各自单选/隐藏、成组选列/隐藏及空选列均有覆盖，数值、零值、NULL/缺失保持现有行为。word-diff 的变更 token 恰为五组 `-false,` / `+true,`；逐字节比对确认整个生产文件等于基线加这五处 listings 默认值替换，其他配置完全一致。单项浏览器已尝试，Chromium 在 `sandbox_host_linux.cc:41` 报 `Operation not permitted` / SIGTRAP，页面断言未执行；未绕过沙箱，需在允许 Chromium 的本地环境补跑默认表头、初始勾选、取消后会话保留及 CSV/Excel 导出移除断言。

剩余默认隐藏扫描：listings 为 dxmPublishState / parentSku / fnsku / salesperson（不可用）/ msku / marketplace / capturedAt / currency；ads 尾部为 msku / title / name / marketplace，adStrategy、salesperson 仍不可用。下一候选是 listings parentSku / fnsku 默认显示：已有类型列，且 [既有 Round G 实数记录](sellfox-agent-read.md)记载 TK-US 完整采集 523 行，FNSKU / 父SKU 非空 518 / 399；这是仓库历史实数证据，本轮未访问真实库或重新采集。dxmPublishState 只有既有 delete/空值观察，仍限原文展示；尾部独立 MSKU/站点与现有组合列有重复，ads 的 title/name/marketplace 需另评估单独显示价值。本轮不改这些候选。

仅 BOX 本地，不 push/fetch/deploy/SSH，不读写 `.env`。跳过完整 check/build、数据库集成与真实 P95：本轮仅五个既有列的 UI 默认标记，后续合码/发布或查询/性能专项再补对应验证。仓库外 parity-gap 文档留给父进程更新。下方为历史批次，以本节为当前状态。

## 2026-10-27 — listings 默认显示预留 / 运费 / 预估利润 / 利润率 · BOX LOCAL ONLY

基线 HEAD `2dd14ff`（`2dd14ff8931615893b62402309021c1211c0cd2a`），分支 `codex/operations-p0-catalog-replenishment`。生产源码仅将 listings 的 `reservedQty`「预留」、`shippingPrice`「运费」、`profitPrice`「预估利润」、`profitRate`「利润率」四个 `defaultVisible` 从 `false` 改为 `true`。labels、numeric、requiresField 与 buyBoxWinner → reservedQty → shippingPrice → profitPrice → profitRate → parentAsin 源顺序保持不变。复用既有类型投影，默认表头、初始勾选及无显式选列 CSV/XLSX 增加这四列；显式单选、空选、单独/成组选列与隐藏继续优先，切换数据域保留取消状态，不迁移已有会话选择。NULL/缺失保持空白，零值、原始小数与负利润保持数值。

费用簇（purchaseCost / fbaFees / referralFee / totalFee / headTripCost）、parentSku、fnsku、dxmPublishState 保持默认隐藏；openDate/库存筛选、配对、父体、业务员、AWD 等锁定入口不解锁。ads / sales / performance 及广告子页配置保持基线原样。**Fee-mining remains paused**。不新增字段、live Sellfox API、SQL、schema/migration、服务端逻辑或请求/计算，不做真实数据库写入。回滚仅还原四个默认值及配套测试/文档，无数据操作。

验证命令（Prisma stub，不连接真实数据库，不加载 `.env`）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
git diff --word-diff=porcelain -- src/components/sellfox/workbench-types.ts
# 单项隔离模拟浏览器；若 Chromium 在 BOX sandbox 中 SIGTRAP，记录结果，不绕过：
NODE_ENV=test npm run test:sellfox:browser -- --grep 'listings default brand, amazonBrand'
```

验证结果：三个定向测试文件全部通过（零失败），TypeScript、指定 ESLint 与 `git diff --check` 通过。精确默认集合、buyBoxWinner → reservedQty → shippingPrice → profitPrice → profitRate → parentAsin 源顺序、默认 CSV/XLSX、四列各自单选/隐藏、成组选列/隐藏及空选列均有覆盖，数值、零值、NULL/缺失与负利润保持现有行为。word-diff 的变更 token 恰为四组 `-false,` / `+true,`；逐字节比对确认整个生产文件等于基线加这四处 listings 默认值替换，其他配置完全一致。单项浏览器已尝试，Chromium 在 `sandbox_host_linux.cc:41` 报 `Operation not permitted` / SIGTRAP，页面断言未执行；未绕过沙箱，需在允许 Chromium 的本地环境补跑默认表头、初始勾选、取消后会话保留及 CSV/Excel 导出移除断言。

仅 BOX 本地，不 push/fetch/deploy/SSH，不读写 `.env`。跳过完整 check/build、数据库集成与真实 P95：本轮仅四个既有列的 UI 默认标记，后续合码/发布或查询/性能专项再补对应验证。仓库外 parity-gap 文档留给父进程更新。下方为历史批次，以本节为当前状态。

## 2026-10-27 — listings 默认显示库存扩展四列 · BOX LOCAL ONLY

基线 HEAD `4b99f25`（`4b99f25253d51196fe2925cfbc360914638da594`），分支 `codex/operations-p0-catalog-replenishment`。生产源码仅将 listings 的 `inventoryCapturedAt`「库存快照时间」、`listingQuantity`「Listing库存」、`unsellable`「不可售」、`warehousing`「入库中」四个 `defaultVisible` 从 `false` 改为 `true`。labels、numeric、requiresField 与 totalInventory → inventoryCapturedAt → listingQuantity → unsellable → warehousing → salesperson → sourceUpdatedAt 源顺序保持不变；fulfillable / totalInventory 原默认配置不变。复用既有类型投影，默认表头、初始勾选及无显式选列 CSV/XLSX 增加这四列，显式单选、空选、单独/成组隐藏继续优先，切换数据域保留取消状态，不迁移已有会话选择。NULL/缺失保持空白，库存零值保持数值。

费用、parentSku、fnsku、dxmPublishState、profitPrice / profitRate / shippingPrice / reservedQty 保持原配置；openDate/库存筛选、配对、父体、业务员、AWD 等锁定入口不解锁。ads / sales / performance 及广告子页配置保持基线原样。**Fee-mining remains paused**。不新增字段、live Sellfox API、SQL、schema/migration、服务端逻辑或请求/计算，不做真实数据库写入。回滚仅还原四个默认值及配套测试/文档，无数据操作。

验证命令（Prisma stub，不连接真实数据库，不加载 `.env`）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
git diff --word-diff=porcelain -- src/components/sellfox/workbench-types.ts
# 单项隔离模拟浏览器；若 Chromium 在 BOX sandbox 中 SIGTRAP，记录结果，不绕过：
NODE_ENV=test npm run test:sellfox:browser -- --grep 'listings default brand, amazonBrand'
```

验证结果：三个定向测试文件全部通过（零失败），TypeScript、指定 ESLint 与 `git diff --check` 通过。精确默认集合、库存簇源顺序、默认 CSV/XLSX、四列各自单选/隐藏、成组选列/隐藏及空选列均有覆盖，数值、零值、NULL/缺失保持现有行为。word-diff 的变更 token 恰为四组 `-false,` / `+true,`；逐字节比对确认整个生产文件等于基线加这四处 listings 库存扩展默认值替换，其他配置完全一致。单项浏览器已尝试，Chromium 在 `sandbox_host_linux.cc:41` 报 `Operation not permitted` / SIGTRAP，页面断言未执行；未绕过沙箱，需在允许 Chromium 的本地环境补跑默认表头、初始勾选、取消后会话保留及 CSV/Excel 导出移除断言。

仅 BOX 本地，不 push/fetch/deploy/SSH，不读写 `.env`。跳过完整 check/build、数据库集成与真实 P95：本轮仅四个既有列的 UI 默认标记，后续合码/发布或查询/性能专项再补对应验证。仓库外 `/workspace/sellfox-parity-gap.md` 留给父进程更新。下方为历史批次，以本节为当前状态。

## 2026-10-27 — listings 默认显示 BSR / BSR类目 · BOX LOCAL ONLY

基线 HEAD `da35b80`（`da35b805df58675b994886392841a83a0f401c2e`），分支 `codex/operations-p0-catalog-replenishment`。生产源码仅将 listings 的 `bsrRank` / `bsrCategory` 两个 `defaultVisible` 从 `false` 改为 `true`。保留「BSR」「BSR类目」、numeric、requiresField 与 firstSaleDate → bsrRank → bsrCategory → purchaseCost 源顺序；复用既有类型投影，rank/categoryName 取同一元素并优先 bigCategory。默认列表、初始勾选及无显式选列 CSV/XLSX 增加这组列，默认可见顺序为 firstSaleDate → bsrRank → bsrCategory → buyBoxWinner。显式单选、空选及单独/成组隐藏继续优先，切换数据域后保留取消状态，不迁移已有会话选择；NULL/缺失保持空白，BSR 的零值保持数值。

费用、dxmPublishState、parentSku、fnsku、库存扩展仍默认隐藏；openDate/库存筛选、配对、父体、业务员、AWD 等锁定入口不解锁。sales / performance / ads 及广告子页配置保持基线原样。**Fee-mining remains paused**。不新增字段、筛选、SQL、schema/migration、API、服务端逻辑或请求/计算，projection 保持原样。回滚仅还原两个默认值及配套测试/文档，无数据操作。

验证命令（Prisma stub，不连接真实数据库，不加载 `.env`）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
git diff --word-diff=porcelain -- src/components/sellfox/workbench-types.ts
# 单项隔离模拟浏览器；若 Chromium 在 BOX sandbox 中 SIGTRAP，记录结果，不绕过：
NODE_ENV=test npm run test:sellfox:browser -- --grep 'listings default brand, amazonBrand'
```

验证结果：三个定向测试文件全部通过（零失败），TypeScript、指定 ESLint 与 `git diff --check` 通过。精确默认集合、firstSaleDate → bsrRank → bsrCategory → purchaseCost 源顺序、默认 CSV/XLSX、显式单选/成组选列/单独隐藏/成组隐藏/空选列均有覆盖；数值、零值、NULL/缺失及类目前导零文本保持现有行为。word-diff 的变更 token 恰为两组 `-false,` / `+true,`；逐字节比对确认整个生产文件等于基线加这两处 listings BSR 默认值替换，其他配置完全一致。单项浏览器已尝试，Chromium 在 `sandbox_host_linux.cc:41` 报 `Operation not permitted` / SIGTRAP，页面断言未执行；未绕过沙箱，需在允许 Chromium 的本地环境补跑默认表头、初始勾选、取消后会话保留及 CSV/Excel 导出移除断言。

仅 BOX 本地，不 push/fetch/deploy/SSH，不调用 live Sellfox API，不做真实数据库写入或 `.env` 操作。跳过完整 check/build、数据库集成与真实 P95：本轮仅两个 UI 默认标记，后续合码/发布或 SQL/schema/性能专项才补对应验证。仓库外 `/workspace/sellfox-parity-gap.md` 留给父进程更新。下方为历史批次，以本节为当前状态。

## 2026-10-27 — listings 默认显示 firstSaleDate「首次售出」 · BOX LOCAL ONLY

基线 HEAD `f0592a3`（`f0592a3dc373802c89d63ff7aafb23fb20a0c83d`），分支 `codex/operations-p0-catalog-replenishment`。生产源码仅将 `columns.listings.firstSaleDate.defaultVisible` 从 `false` 改为 `true`，保留「首次售出」、`requiresField: "Listing 当前快照 payload.firstSaleDate（空则 firstOrderDate；123 上 firstSaleDate 常空）"` 和 openDate → firstSaleDate → bsrRank 源顺序。现有类型投影与 firstOrderDate fallback 保持原样。默认表头、列选择器初始勾选及无显式选列 CSV/XLSX 增加「首次售出」；显式选列（含空集合、单独 firstSaleDate、隐藏 firstSaleDate）继续优先，切换数据域后保留取消状态，不迁移已有会话选择。

bsrRank / bsrCategory / 费用 / dxmPublishState / 库存扩展保持原默认隐藏状态；openDate/库存筛选、配对、父体、业务员、AWD 等锁定入口不解锁。sales / performance / ads 及广告子页配置逐字节不变，ads.brand / ads.productTags / ads.fulfillment 仍默认隐藏。**Fee-mining remains paused**。无新增字段、筛选、SQL、schema/migration、API、服务端逻辑或请求/计算。回滚仅还原本次默认值及配套测试/文档，无数据操作。

验证命令（Prisma stub，不连接真实数据库，不加载 `.env`）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
git diff --word-diff=porcelain -- src/components/sellfox/workbench-types.ts
# 单项隔离模拟浏览器；若 Chromium 在 BOX sandbox 中 SIGTRAP，记录结果，不绕过：
NODE_ENV=test npm run test:sellfox:browser -- --grep 'listings default brand, amazonBrand'
```

验证结果：三个定向测试文件全部通过（零失败），TypeScript、指定 ESLint 与 `git diff --check` 通过。精确默认集合、openDate → firstSaleDate → bsrRank 源顺序、默认 CSV/XLSX 及显式单选/隐藏/空选列均有覆盖，日期文本与 NULL/缺失保持现有行为。word-diff 的变更 token 仅 `-false,` / `+true,`；逐字节比对确认整个生产文件等于基线加这一处 listings.firstSaleDate 默认值替换，其他配置完全一致。单项浏览器已尝试，但 Chromium 启动在 `sandbox_host_linux.cc:41` 报 `Operation not permitted` / SIGTRAP，页面断言未执行；未绕过沙箱，需在允许 Chromium 的本地环境补跑默认表头、初始勾选、取消后会话保留及 CSV/Excel 导出移除断言。

仅 BOX 本地，不 push/fetch/deploy/SSH，不调用 live Sellfox API，不做真实数据库写入或 `.env` 操作。跳过完整 check/build、数据库集成与真实 P95：本轮仅一个 UI 默认标记，后续合码/发布或 SQL/schema/性能专项才补对应验证。仓库外 `/workspace/sellfox-parity-gap.md` 留给父进程更新。下方为历史批次，以本节为当前状态。

## 2026-10-27 — listings 默认显示 productTags「产品标签」 · BOX LOCAL ONLY

基线 HEAD `b005c19`（`b005c19f42e652701f45afdc8dcd14353b2d2276`），分支 `codex/operations-p0-catalog-replenishment`。生产源码仅将 `columns.listings.productTags.defaultVisible` 从 `false` 改为 `true`，保留「产品标签」、`requiresField: "Listing 当前快照 payload.productLabelList[].labelDetailList[].labelName"` 与 ratingCount → productTags → openDate 源顺序。复用已有 current Listing 类型投影，projection / facets / filter 保持原样；默认表头、列选择器初始勾选及无显式选列 CSV/XLSX 增加「产品标签」。显式选列（含空集合、单独 productTags、隐藏 productTags）继续优先，切换数据域后保留取消状态，不迁移已有会话选择。测试覆盖文本、NULL/缺失及前导零字符串。

firstSaleDate / bsrRank / bsrCategory / 费用 / dxmPublishState / 库存扩展保持原默认隐藏状态；openDate/库存筛选、配对、父体、业务员、AWD 等锁定入口不解锁。sales / performance / ads 及广告子页配置保持逐字节一致，ads.productTags / ads.brand / ads.fulfillment 仍默认隐藏。**Fee-mining remains paused**。无新增字段、SQL、schema/migration、API、服务端逻辑或请求/计算。回滚仅还原本次默认值及配套测试/文档，无数据操作。

验证命令（Prisma stub，不连接真实数据库，不加载 `.env`）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
git diff --word-diff=porcelain -- src/components/sellfox/workbench-types.ts
# 单项隔离模拟浏览器；若 Chromium 在 BOX sandbox 中 SIGTRAP，记录结果，不绕过：
NODE_ENV=test npm run test:sellfox:browser -- --grep 'listings default brand, amazonBrand'
```

验证结果：三个定向测试文件全部通过（零失败），TypeScript、touched ESLint 与 `git diff --check` 通过。精确默认集合、ratingCount → productTags → openDate 源顺序、默认 CSV/XLSX、显式单选/隐藏/空选列均有覆盖，ads.productTags 可选断言保留。word-diff 的变更 token 仅 `-false,` / `+true,`；逐字节比对确认整个生产文件等于基线加这一处 listings.productTags 默认值替换，其他配置完全一致。单项浏览器已尝试，Chromium 在 `sandbox_host_linux.cc:41` 报 `Operation not permitted` / SIGTRAP，页面断言未执行；未绕过沙箱，需在允许 Chromium 的本地环境补跑默认表头、初始勾选、取消后会话保留及 CSV/Excel 导出移除断言。

仅 BOX 本地：不 push/fetch/deploy/SSH，不调用 live Sellfox API，不做真实数据库读写或 `.env` 操作。跳过完整 check/build、数据库集成与真实 P95：本轮仅一个 UI 默认标记，后续合码/发布或 SQL/schema/性能专项才补对应验证。仓库外 `/workspace/sellfox-parity-gap.md` 留给父进程更新。下方为历史批次，以本节为当前状态。


## 2026-10-27 — listings 默认显示 amazonBrand「亚马逊品牌」 · BOX LOCAL ONLY

基线 HEAD `6072ac6`（`6072ac631cbe0acfc82c8ea71d21d4240da5b11f`），分支 `codex/operations-p0-catalog-replenishment`。生产源码仅将 `columns.listings.amazonBrand.defaultVisible` 从 `false` 改为 `true`，保留「亚马逊品牌」、`requiresField: "Listing 当前快照 payload.amazonBrand"` 和 brand → amazonBrand → rating → ratingCount 源顺序。复用已有 current Listing 类型投影及文本列，无显式选列的列表/CSV/XLSX 默认包含「亚马逊品牌」；列选择器初始勾选。显式选列（含空集合、单独选择 amazonBrand、隐藏 amazonBrand）继续优先，切换数据域后保留取消状态，不迁移已有会话选择。

productTags / firstSaleDate / bsrRank / bsrCategory / 费用 / dxmPublishState / 业务员 / 库存扩展保持原默认隐藏或不可用状态；openDate/库存筛选、配对、父体、业务员、AWD 等原锁定入口不解锁。sales / performance / ads 及子页配置逐字节不变，ads.brand / ads.productTags / ads.fulfillment 保持原配置。**Fee-mining remains paused**。不新增字段、SQL、schema/migration、API、服务端逻辑或请求/计算。回滚仅还原该默认值及配套测试/文档，无数据操作。

验证命令（Prisma stub，不连接真实数据库，不加载 `.env`）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
git diff --word-diff=porcelain -- src/components/sellfox/workbench-types.ts
# 单项隔离模拟浏览器；若 Chromium 在 BOX sandbox 中 SIGTRAP，记录结果，不绕过：
NODE_ENV=test npm run test:sellfox:browser -- --grep 'listings default brand, amazonBrand'
```

验证结果：三个定向测试文件全部通过（零失败），TypeScript、touched ESLint 通过。精确默认集合/源顺序及默认 CSV/XLSX 已覆盖 amazonBrand，显式单选、隐藏与空选列继续优先；文本、NULL/缺失、前导零字符串保持原值。生产文件 word-diff 的变更 token 仅 `-false,` / `+true,`，逐字节比对确认整个文件等于基线加这一个 listings amazonBrand 默认值替换，其他域配置完全一致。单项浏览器已尝试，但 Chromium 启动在 `sandbox_host_linux.cc:41` 报 `Operation not permitted` / SIGTRAP，页面断言未执行；未绕过沙箱，需在允许 Chromium 的本地环境补跑默认表头、初始勾选、取消后会话保留及导出移除断言。

仅 BOX 本地，不 push/fetch/deploy/SSH，不调用 live Sellfox API，不做真实数据库读写或 `.env` 操作。跳过完整 check/build、数据库集成与真实 P95：本轮仅一个 UI 默认标记，后续合码/发布或 SQL/schema/性能专项才补对应验证。仓库外 `/workspace/sellfox-parity-gap.md` 留给父进程更新。下方为历史批次，以本节为当前状态。


## 2026-10-27 — listings 默认显示 fulfillment「发货方式」 · BOX LOCAL ONLY

基线 HEAD `87db3b6`（`87db3b6991e44829c83553dc8820d8fc27d93c03`），分支 `codex/operations-p0-catalog-replenishment`。仅将 `columns.listings.fulfillment.defaultVisible` 从 `false` 改为 `true`，保留「发货方式」、requiresField 与 status → dxmPublishState → fulfillment → image 源顺序。默认列表、列选择器初始勾选及无显式选列 CSV/XLSX 增加「发货方式」，紧接「状态」。复用现有 current Listing `switchFulfillmentTo` 类型投影（AFN / MFN / 未知）及已解锁的 fulfillment 筛选；NULL/缺失在导出中保持空白。显式会话选列（含空集合、只选 fulfillment、取消 fulfillment）继续优先，切换数据域保留取消状态，不迁移已有选择。

amazonBrand / dxmPublishState / productTags / firstSaleDate / BSR / 费用 / inventoryCapturedAt 等仍默认隐藏；openDate/库存筛选、配对、父体、业务员、AWD 保持锁定。sales / performance / ads / ads_* 配置逐字节不变，ads.fulfillment 仍默认隐藏。**Fee-mining remains paused**。无新增字段、SQL、schema/migration、API、服务端或新增请求/计算。回滚仅还原本次默认值及配套测试/文档，无数据操作。

验证命令（Prisma stub，不连接真实数据库，不加载 `.env`）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
git diff --word-diff=porcelain -- src/components/sellfox/workbench-types.ts
# 单项模拟浏览器回归；若 Chromium 在 BOX sandbox 中 SIGTRAP，记录结果，不绕过：
NODE_ENV=test npm run test:sellfox:browser -- --grep 'listings default brand'
```

验证结果：三个定向测试文件全部通过（零失败），TypeScript 与 touched ESLint 通过；默认 CSV/XLSX 覆盖 AFN/MFN/NULL/缺失，保留既有 fulfillment 筛选与 CSV 断言，补齐单独选列、空选列和显式隐藏。与基线逐字节比对确认整个生产文件仅 listings fulfillment 默认标记变化；word-diff 的变更 token 仅 `-false,` / `+true,`。单项浏览器已尝试，Chromium 启动在 `sandbox_host_linux.cc:41` 报 `Operation not permitted` / SIGTRAP，页面断言未执行，未绕过沙箱；默认表头、初始勾选、取消后切页保留及 CSV/Excel 链接移除断言需在允许 Chromium 的本地环境补跑。

仅 BOX 本地：无 push/fetch、deploy、SSH、live Sellfox API、真实数据库读写或 `.env` 操作。跳过完整 check/build、数据库集成与真实 P95：本轮只有一个 UI 默认标记，合码/上线或 SQL/schema/性能专项才补对应验证。仓库外 `/workspace/sellfox-parity-gap.md` 留给父进程更新。下方为历史批次，以本节为当前状态。


## 2026-10-27 — listings 默认显示 totalInventory「总库存」 · BOX LOCAL ONLY

基线 `75409170576a7a825aa6e176054c766df7a454f0`，分支 `codex/operations-p0-catalog-replenishment`。对齐 sales 已交付的 `ad559c8`，仅将 `columns.listings.totalInventory.defaultVisible` 从 `false` 改为 `true`，保留 numeric、requiresField 与 fulfillable → totalInventory → inventoryCapturedAt 源顺序。默认列表、列选择器初始勾选及无显式选列 CSV/XLSX 增加「总库存」，紧接「可售」。复用既有最新完整库存快照补充，非销售日库存；NULL 保持空白，0/180 保持数值。显式会话 `columnSelection`（含空集合、隐藏 totalInventory、只选 title）继续优先，不迁移保存选择。

inventoryCapturedAt / listingQuantity / unsellable / warehousing / fulfillment 等仍默认隐藏；库存筛选、openDate 筛选、配对、父体、业务员、AWD 保持锁定。sales / performance / ads / ads_* 配置逐字节不变。**Fee-mining remains paused**。无新增字段、SQL、schema/migration、API、服务端或新请求/计算。回滚仅还原这个默认值及配套测试/文档，无数据操作。

验证命令（Prisma stub，不连接真实数据库，不加载 `.env`）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
# 单项模拟浏览器回归；如 Chromium 被 BOX sandbox 拒绝，记录结果，不绕过：
NODE_ENV=test npm run test:sellfox:browser -- --grep 'listings default brand'
```

验证结果：上述三个定向测试文件全部通过（零失败），TypeScript、touched ESLint、`git diff --check` 通过。测试覆盖精确默认集合/源顺序、默认及显式 CSV/XLSX、隐藏/空选列，以及库存补充的 NULL/0/180 数值语义。生产源码与基线逐字节比对通过，`git diff --word-diff=porcelain` 唯一变化为 listings totalInventory 的 `false → true`。单项浏览器已尝试，Chromium 启动在 `sandbox_host_linux.cc:41` 报 `Operation not permitted` / SIGTRAP，页面断言未执行；未绕过沙箱。已补默认表头、初始勾选、显式取消、切页保留及导出移除断言，需允许 Chromium 的本地环境补跑。

仅 BOX 本地：无 push/fetch、deploy、SSH、live Sellfox API、真实数据库读写或 `.env` 操作。跳过完整 check/build、数据库集成和真实 P95：本轮只有一个 UI 默认标记，合码/上线或 SQL/schema/性能专项才补对应验证。仓库外 `/workspace/sellfox-parity-gap.md` 留给父进程更新。提交状态及精确 SHA 见当前 HEAD / gap；不在本节嵌入自身最终 SHA。下方为历史批次。


## 2026-10-27 — listings 默认显示 openDate「上架时间」 · BOX LOCAL ONLY

基线 `ad559c8fdb710ddf1b2ba13cf84c3db1cd838d14`，分支 `codex/operations-p0-catalog-replenishment`。仅将 `columns.listings.openDate.defaultVisible` 从 `false` 改为 `true`，保留标签、requiresField 与 productTags → openDate → firstSaleDate 源顺序；默认列表、初始勾选与无显式选列 CSV/XLSX 的表头为「评论数」「上架时间」「Buy Box」。复用已有文本投影，NULL/缺失保持空白。显式会话 `columnSelection`（含空集合、只选 title、手动隐藏 openDate）继续优先，不迁移保存选择。

firstSaleDate / amazonBrand / fulfillment / totalInventory / productTags / 费用等仍默认隐藏；openDate 筛选、库存筛选、配对、父体 tab、业务员、AWD 保持锁定。sales / performance / ads / ads_* 配置逐字节不变。**Fee-mining remains paused**。无 SQL、schema/migration、API、服务端或新增请求/计算。回滚仅还原本次默认值及测试/文档，无数据操作。

验证命令（Prisma stub，不连真实数据库）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
# 单项模拟浏览器回归；BOX sandbox 若拒绝 Chromium，保留断言并在允许的本地环境补跑：
NODE_ENV=test npm run test:sellfox:browser -- --grep 'listings default brand'
```

验证结果：上述三个定向测试文件全部通过（零失败），TypeScript、touched ESLint 通过；覆盖精确默认集合/源顺序、默认 CSV/XLSX 表头、文本/NULL/缺失及显式/空/隐藏选列。`git diff --word-diff=porcelain` 仅显示 `false → true`，逐字节比对确认生产源码除该标记外与基线完全一致。单项浏览器已尝试，Chromium 在 `sandbox_host_linux.cc:41` 报 `Operation not permitted` / SIGTRAP，页面断言未执行；未绕过沙箱，需允许浏览器的本地环境补跑。

仅 BOX 本地：无 push/fetch、deploy、SSH、live Sellfox API、真实数据库读写或 `.env` 操作。跳过完整 check/build、数据库集成与真实 P95：本次只改一个 UI 默认标记；合码/发布或 SQL/schema/性能专项才补对应验证。仓库外 `/workspace/sellfox-parity-gap.md` 不在可写根目录内，留给父进程更新。下方为历史批次。


本地提交完成（父进程 · 2026-10-27 03:09:26 Asia/Shanghai）：Codex 因 sandbox 无法写 `.git/index.lock`；父进程在 BOX 用临时 `GIT_INDEX_FILE` 完成本地提交 `feat(sellfox): default-show listings openDate column`（见当前 HEAD）。未 push/fetch。精确 SHA 以 `git rev-parse HEAD` / 仓库外 gap 为准。


## 2026-10-27 02:32:00 Asia/Shanghai — listings unlock buyBoxWinner「Buy Box」filter · Owner: Chen Jieliang · BOX LOCAL ONLY

基线 `9b632506905c2f5ea02de3025522d0e6de352f28`，分支 `codex/operations-p0-catalog-replenishment`。在线商品 Buy Box 筛选（UI「全部 / 是 / 否」，参数 `"" / "yes" / "no"`）与 sales/performance/ads 同口径：对 Listing current typed `buyBoxWinner` 文本精确匹配「是」/「否」；NULL/空/非布尔/未知参数只计入「全部」。本轮补齐 browse 路由：仅带 `buyBox=`、无 layout/排序/选列时也进入 workbench/`listingsReadSql`（与既有 `brand=` 单独入 workbench 对称），保留 facets.brands/productTags 与库存补充；CSV/XLSX 原本已走 workbench。显式 `agent=1` 导出仍在 listings Agent 窄表上应用同一 typed 谓词。

品牌筛选此前已交付，本轮不重复；不解锁 openDate/库存筛选；业务员 / AWD 等缺失入口继续锁定。sales / performance / ads 默认与筛选行为未改（ads Buy Box 筛选保持 `6cb590b`）。**Fee-mining remains paused**。无 schema / Prisma migration / SQL 结构变更，无 live API、真实 DB 写入。回滚仅还原 browse 路由条件及配套测试/文档。

验证：定向单测（含 listings Buy Box alone → workbench、是/否精确匹配、非法值当全部、联合 brand/productTag/fulfillment、Agent 导出仍过滤）、listings-read / workbench-read、TypeScript、touched ESLint、`git diff --check`。Prisma stub，不连真实库。未跑完整 check/build、浏览器或真实 P95。

验证命令：

    NODE_ENV=test node --import tsx --test tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts tests/sellfox-workbench-read.test.ts tests/sellfox-browse-filters.test.ts tests/sellfox-browse-query.test.ts
    npm run typecheck
    node node_modules/eslint/bin/eslint.js 'src/app/api/sellfox/[domain]/route.ts' tests/sellfox-browse-api.test.ts
    git diff --check

仅 BOX 本地：无 push/fetch、deploy、SSH、migrate-on-123、live Sellfox、schedules 或 .env。仓库外 /workspace/sellfox-parity-gap.md 同步，不入库。


## 2026-10-27 02:27:31 Asia/Shanghai — listings 默认显示 ratingCount「评论数」+ buyBoxWinner「Buy Box」 · Owner: Chen Jieliang · BOX LOCAL ONLY

基线 `6090d99990f935307aeab756d93d50ec49141d7a`，分支 `codex/operations-p0-catalog-replenishment`。仅将 `columns.listings.ratingCount` / `buyBoxWinner` 的 `defaultVisible` 从 `false` 改为 `true`；brand / rating 继续默认显示。源顺序保持 rating → ratingCount、headTripCost → buyBoxWinner → reservedQty，不重排。默认列表、列选择器初始勾选及无显式选列的 CSV/XLSX 增加「评论数」「Buy Box」；显式会话 `columnSelection`（含空集合、只选旧列、隐藏新默认列）仍优先，不迁移保存选择。

amazonBrand / openDate / firstSaleDate / 库存扩展（totalInventory、inventoryCapturedAt、listingQuantity、unsellable、warehousing）/ productTags / BSR / 费用 / fulfillment / dxmPublishState 等继续可选；业务员 / AWD 等缺失入口不解锁。sales / performance / ads 及广告子页默认配置与基线逐字节一致；ads 的 ratingCount / buyBoxWinner 仍为 `defaultVisible: false`。**Fee-mining remains paused**。无 SQL、schema、migration、API、服务端或数据边界改动，无新请求或计算。回滚仅还原这两处默认值及配套测试/文档，无数据回退。

验证已通过：三个定向单测文件（Prisma stub，无真实数据库）、TypeScript、touched ESLint；源码比对确认除这两个 listings 标记外与 HEAD 完全一致。单测覆盖精确默认列集合/源顺序、显式及空选列、无选列 CSV/XLSX、评论数 NULL/缺失/0/128、Buy Box 是/否/空值，保留 brand/rating 默认、可选列排除及 ads 可选断言。浏览器用例同步扩展默认表头/初始勾选/显式隐藏/会话切页保留；尝试单个用例时 Chromium 启动被 BOX sandbox 拒绝（`sandbox_host_linux.cc:41` / `Operation not permitted` / SIGTRAP），页面断言未执行，未绕过沙箱。

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
# 需允许 Chromium 的本地环境补跑：
NODE_ENV=test npm run test:sellfox:browser -- --grep 'listings default brand'
```

仅 BOX 本地：无 push/fetch、deploy、SSH、migrate-on-123、真实数据库写入、live Sellfox API、schedules 或 `.env` 操作。未跑完整 check/build、数据库集成或真实 P95；本次按两处 UI 默认配置变更采用定向验证，准备合码/上线或变更 SQL/schema 时再补相应完整/专项检查。仓库外 `/workspace/sellfox-parity-gap.md` 同步状态，不纳入 repo commit。下方旧状态保留为历史记录，本节为当前状态。

本地提交受阻：`git add` 无法创建 `.git/index.lock`（Read-only file system），因此 commit 未执行；未强制或绕过沙箱。4 个仓库文件保留为未暂存 diff，`git diff --check` 已通过，HEAD 保持 `6090d99990f935307aeab756d93d50ec49141d7a`。父进程需提交：`feat(sellfox): default-show listings ratingCount/buyBoxWinner columns`。仓库外状态文件不进入提交。


## 2026-10-27 02:21:51 Asia/Shanghai — listings 默认显示 brand「品牌」+ rating「星级」 · Owner: Chen Jieliang · BOX LOCAL ONLY

基线 `c7b818ee2ffc86830f56b33cc9f628ac7b7e51c5`，分支 `codex/operations-p0-catalog-replenishment`。仅将 `columns.listings.brand` / `rating` 的 `defaultVisible` 改为 `true`，保留 `requiresField` 与源顺序 brand → amazonBrand → rating → ratingCount。默认列表、列选择器初始勾选及无显式选列 CSV/XLSX 包含「品牌」「星级」；显式会话 `columnSelection`（含空集合或隐藏其中一列）仍优先，不迁移保存选择。

amazonBrand / ratingCount / buyBoxWinner / fulfillment / 库存扩展 / productTags / 日期 / BSR / 费用等保持可选；业务员 / AWD 等缺失入口继续锁定。sales（含已交付 average7）/ performance / ads 及子页默认配置与基线逐字节一致。**Fee-mining remains paused**。只复用已有字段，无 SQL、schema、migration、API 或服务端改动，无新请求或计算。回滚仅还原这两处默认显示值及配套测试/文档，无数据回退。

验证：三个定向测试文件全部通过；TypeScript、touched ESLint、`git diff --check` 已通过，源码比对确认除两处 listings 默认值外与 HEAD 完全一致。新增测试覆盖默认列集合/源顺序、显式/空选列、默认及显式 CSV/XLSX、NULL/零文本/品牌前导零；现有可选列断言保留。浏览器回归已补默认表头/列选择器勾选、显式隐藏及会话切页保留；Chromium 启动被 BOX sandbox 拒绝（`sandbox_host_linux.cc:41` / `Operation not permitted` / SIGTRAP），页面断言未执行，未绕过沙箱。

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
# 本轮已尝试，需允许 Chromium 的本地环境补跑：
NODE_ENV=test npm run test:sellfox:browser -- --grep 'listings default brand and rating'
```

仅 BOX 本地：无 push/fetch、SSH、deploy/restart、migrate-on-123、真实数据库写入、live Sellfox API、schedules 或 `.env` 操作；单测使用 Prisma stub，不连接真实数据库。未跑完整 check/build、Prisma/PGlite 或真实 P95：本次仅两处默认显示配置，合码/发布前按仓库规则补完整检查；SQL/schema 或性能验收才触发专项。仓库外 `/workspace/sellfox-parity-gap.md` 同步状态，不纳入 repo commit。

本地提交受阻：`git add` 无法创建 `.git/index.lock`（Read-only file system），因此未执行 commit，未强制或绕过沙箱。4 个仓库文件保留为未暂存 diff；HEAD 保持 `c7b818ee2ffc86830f56b33cc9f628ac7b7e51c5`，父进程需提交：`feat(sellfox): default-show listings brand/rating columns`。仓库外状态文件不进入提交。

## Performance fact 费用类型投影（2026-10-26，本地完成，未部署）

- 增量迁移 `20261026080000_sellfox_product_daily_typed_fees` 在 `70000` 之后给现有 `SellfoxProductDailySnapshot` 添加 nullable DOUBLE PRECISION：`refundPrice`、`refundNum`、`commodityCost`、`shippingPrice`、`taxPrice`。复用 `50000` 的 `sellfox_listing_number(text)`：空/缺失/非法/溢出为 NULL，保留 0；没有新表或索引。
- `sellfox_product_daily_project_write` 在 INSERT / UPDATE OF payload 时原子维护这五列；`extractPerformanceFields` 同时用既有 `sellfoxNumber` 在同步写侧提取（非法值沿用同步校验失败规则）。一次性 `UPDATE payload=payload` 回填全部历史事实，payload 内容不变。已存在的 `promotionDiscount` / `giftWrapFee` / `imageUrl` 不重新投影；profit view 保留 `20000` 的完整列序，再在末尾追加五列。
- performance browse/导出只读类型列；实体和币种页脚仍用 `COALESCE(sum(...),0)`，refundRate、销售域、结算分区和灰显入口不变。workbench / Agent / listings 读 SQL 已无这五个费用键的 payload 解析。剩余 payload 接触包括写侧（Listing 与 product-daily trigger、同步保留/合并原始 payload）及既有 `/api/sellfox/[domain]/[id]` 按需详情预览（`payload-preview.ts`）；预览保持原始资料用途，不参与费用聚合。`product-tags-sql.ts` 的旧 JSON helper 仍保留，当前 browse/Agent/listings 不调用；本轮不清理无关代码。
- 验证：指定六文件单测 **104/104**；TypeScript、改动 TS ESLint、dummy URL 的 Prisma validate、`git diff --check`；隔离 PGlite 的 listings-read-model / cross-store / sales-profit-p0 全部通过，涵盖旧行回填、view 旧列序、INSERT/UPDATE、NULL/0/非法值、促销/礼品包装保持、分页/币种/结算与汇总。后两者无 standalone main，通过导出的 `verifySellfoxCrossStoreSql` / `verifySellfoxP0Sql` 传入独立 PGlite query/exec 执行；未配置真实数据库 URL，默认 PostgreSQL node:test 包装用例跳过不影响实际 PGlite 验证。
- 仅本地：未 push、SSH、部署、真实库迁移或请求 Sellfox API。123 仍待 `60000` + `70000` + `80000`，等待用户「上」后才进入发布流程。真实 apply 前审核历史行数、WAL/磁盘和 DDL/行锁窗口，先迁移并 generate 再启动新代码；回退应用时保留新增列/trigger/view，不做数据库 down/drop。本次未跑全量 check、生产构建、浏览器 E2E 或真实 P95；合码/上线及性能验收时再执行。

范围：只改本地 ERP listings 读路径；未连接生产、未发布、未推送、未启用计划，也没有新增 Sellfox API 调用。ProductRecord、销量/利润报表聚合不变。

## 销量/表现复用类型投影（2026-10-26）

- `workbench-read.ts` 的共享 Listing CTE 直接读 current view 的 brand/rating/Buy Box/fulfillment，标签过滤用 `productTagNames @> ARRAY[...]::text[]`，不再连接快照解析 payload。品牌 facets 用 DISTINCT brand，标签 facets 展开类型数组；范围仍由 organization/workspace/shop/store/site 限制，并独立于品牌/标签/搜索等行筛选。
- Agent sales/performance 的四种共享筛选同样读取所选 current 候选的类型列。仍先按 MSKU 优先、ASIN 回退及原稳定排序选一行，再判断字段，不能预筛候选而换成同 ASIN 的其他商品。列表响应、灰显入口、报表聚合和币种/结算分区口径保持原样。
- 新迁移 `20261026070000_sellfox_listing_developer_spu` 在 `20261026060000` 后添加两个 nullable TEXT，扩展原 trigger，在 current view 末尾追加列。developer 保留旧 SQL 的精确规则：第一个 devId 匹配的 devName 非空则用它，否则第一个非空 devName；重复匹配不跳到第二个匹配项，空字符串与空格不同，不额外 trim。SPU 优先非空 commodityName，再 commoditySku。缺失存 NULL，读 CTE 用 COALESCE 显示「未分配开发员」/「未分配SPU」。performance 的 SPU 仍按原行为回退 ASIN。
- 一次性 `UPDATE payload=payload` 触发全历史/半成品回填，不改变 payload 内容、Head 或 ProductRecord；其余已投影字段按原函数重算。真实库应用前须审核保留行数、WAL/磁盘及 DDL/行锁窗口，先迁移并 generate，再启动新代码。本轮仅在内存 PGlite 执行。回滚应用保留新增列/函数/view，不做数据库回滚；旧应用写 payload 仍会维护投影。
- 后续 `80000` 已将 performance fact 的 refundPrice/refundNum/commodityCost/shippingPrice/taxPrice 改为类型列读取；Listing 与 product-daily 写入 trigger 仍负责解析原始 payload，browse 读取路径不解析这些字段。
- 定向验证：下列 94 项测试、TypeScript、改动 TS 文件 ESLint、Prisma validate、`git diff --check`；隔离 PGlite 另覆盖新增迁移/backfill/view 旧列顺序、插入/更新与 NULL/重复 devId/空格、报表 MSKU/ASIN 选择、筛选/空页 facets/导出/分页/totals/结算分区，以及跨店 developer/SPU 与共享广告查询。未运行生产构建、浏览器 E2E 或真实并发/P95 benchmark；合码/上线或性能验收时再执行，不能把隔离 fixture 当作生产性能承诺。

```bash
npx tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-listings-read.test.ts tests/sellfox-browse-filters.test.ts tests/sellfox-listing-identity.test.ts tests/sellfox-agent-read.test.ts
npm run typecheck
npx eslint src/lib/sellfox/{workbench-read,agent-read}.ts tests/sellfox-{workbench-read,agent-read}.test.ts tests/integration/sellfox-{listings-read-model,cross-store,ads-phase-a}.ts
DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused npx prisma validate
SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js npx tsx tests/integration/sellfox-listings-read-model.ts
git diff --check
```

PGlite 沿用本机已有工具，不修改应用依赖。跨店和广告额外验证分别调用 `verifySellfoxCrossStoreSql` 与 `verifySellfoxAdsPhaseBSql`（后者包含 Phase A），调用方传入独立 PGlite 的 query/exec，完成后 close；不设置任何数据库 URL，不访问真实数据库。

## 可选发布状态补充（2026-10-26）

- 本地字段盘点：`narrow-contracts.ts`、Agent 字段表及 `listing-page.json` 一致将 `standardPrice` 映射为既有 `price`（价格）；fixture 没有 `dxmPublishState` / `listingPrice` / `listingPricing` 的枚举或中文业务定义。用户提供的现存 payload 观察是 `dxmPublishState` 有 `delete`/空值，不能据此认定为配对状态。`listingPrice` / `listingPricing` 仅有非空数量，无独立用途证据，不新增重复或猜义的价格列。
- 新增默认隐藏的「DXM 发布状态」，只展示 `dxmPublishState` 文本原值，不翻译 `delete` 为配对结果。配对状态、划线价类型筛选仍灰显，tooltip 分别指出缺少配对字段/稳定枚举及价格字段语义/类型枚举。没有新建 facets、排序、JSONB WHERE 或 API。
- 增量迁移 `20261026060000_sellfox_listing_publish_state`（在 `20261026050000` 之后）只加可空 TEXT，扩展既有 `sellfox_listing_project()`，仍由原 `sellfox_listing_project_write` 原子维护。current view 末尾追加一列，旧列顺序保留；新 browse/可见列 CSV 读取类型列，Agent 窄列不扩张。字符串去首尾空格，空/缺失/非字符串为 NULL，未知非空字符串照常显示。
- 回填覆盖全部保留和半成品快照，仅更新新列，不重写 payload、不切 Head、不请求赛狐。没有新索引。应用到真实库前须审核历史行数、WAL/磁盘及 DDL 锁窗口，先迁移并 generate 再启动新代码；本轮仅在隔离 PGlite 执行。回滚应用可保留新增列/扩展函数/view，不做 migrate down。
- 同轮广告「日志」复用工作台 `onChange({ domain: "runs", page: 1 })`；导航层已有域切换时清理 searchType/sort 的逻辑，运行请求不携带广告专属参数（地址栏沿用既有行为保留非活动域选择）。tooltip 明示同步任务日志，未新增广告日志 API；广告组合/否定/AMC 仍待接。
- 定向验收：browse-filters/listings-read/workbench-read/listing-identity 单测、TypeScript、改动文件 ESLint、Prisma validate、隔离 PGlite 及四项模拟浏览器回归（两项原广告导航、一项日志跳转/后退、一项可选列/灰态原因）。生产构建、全量 E2E 和真实环境 benchmark 不属于此次本地切片；合码/上线或真实性能验收时再运行。

## 证据与根因

`4ab7a42` 的 `workbenchReadSql("listings")` 把普通 `sellfox_listing_current` 视图再连接回快照 payload，计算品牌、评分、费用、标签、BSR 等；`filtered` 被 count/totals/page 多次引用，因此宽行先物化全部匹配记录再分页。facets 又独立读取 payload。库存补充已是分页后一次批量读取，并非逐行网络 N+1。

隔离 PGlite（PostgreSQL）fixture：10 店、10,000 条 current + 20,000 条历史快照，每条约 3KB padding 加嵌套 JSON；`dimension=asin&pageSize=20`。用基线提交生成的旧 SQL 与新 SQL，在**同一迁移后数据库/新索引**上比较（旧 SQL 也享有新索引，避免把索引收益误算为查询改写收益）。非生产数据，单次温缓存 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`，不是生产 P95。

| 查询 | Execution Time | Shared hit blocks | Temp written blocks |
| --- | ---: | ---: | ---: |
| 旧默认 SQL | 1,102.911ms | 120,268 | 314 |
| 新默认 SQL | 93.395ms | 5,148 | 0 |
| 新 brand + AFN + Buy Box | 71.450ms | 5,319 | 0 |
| 新 sales7 DESC | 136.694ms | 7,512 | 0 |

旧计划：宽行 `CTE filtered` 物化 10,000 行（估计 8,403），两个 BSR 子查询及标签展开均执行 10,000 次；存在额外快照探测。新计划：没有 payload、JSON 数组展开、快照主键补读；默认 page 经 `sellfox_listing_scope_id` 扫描 58 条候选，Head/Store 校验后 `LIMIT 20`（约 0.3ms），历史与未完整采集批次不返回。count/facet 的 current 输入 10,000 行，估计约 9,167。brand 使用 `sellfox_listing_brand`（6,000 含历史候选，2,000 current）。sales7 DESC 当前仍选 typed top-N sort，未强迫优化器使用索引。

在该量级 DB 核心查询低于 0.15s，有充分余量争取 API 1–2s；无法据此保证 123 的完整 API/UI 延迟，仍需未来受控生产测量。

## 方案与一致性

- 复用现有 Snapshot + 完整 Head + current view，不引入第二张同步表、Redis 或新 API。
- 增量迁移 `20261026050000_sellfox_listing_typed_read_model` 添加品牌、评分、标签、日期文本、BSR、费用、利润、Listing 库存、配送与 Buy Box 等类型列；view 只追加列，保留已有顺序与旧 Agent 列。
- 数据库 `sellfox_listing_project_write` 在 INSERT / UPDATE OF payload 时计算列，复用已有同步 upsert 事务，包括旧应用、断点重试。读取不解析 JSON。原始 payload 保留。
- 迁移一次性回填**全部已保存快照**，涵盖可能续跑并成为 Head 的半成品批次；不改变 Head，不请求赛狐，不等待下次采集才可读。
- 数值缺失/非法/溢出为 NULL；0 不丢失；布尔字符串不冒充真布尔；标签去重、精确匹配，包含 `、` 的完整标签不拆分；BSR 同一元素提供 rank/category，先 bigCategory，精确 sentinel 9999999 为 NULL。日期文本保留源格式及 firstOrderDate fallback。
- `rating` 保持旧显示字符串，排序用数值列 `ratingValue`；后者不加入响应字段。旧、新 fixture 的所有 page 字段、facets、totals 完全相等。
- listings 单独查询模块：`filtered NOT MATERIALIZED` 让 count/totals 裁剪显示列，让分页独立取索引；count 按币种一次聚合，facets 从单独的窄类型列集合生成、忽略 brand/tag/search/status 行筛选，仍受 org/workspace/shop/store/site 隔离。Agent listings 的四种筛选也直接用投影列。
- 索引覆盖 scope/id、Head 批次探测、brand、fulfillment/Buy Box、常见 sales7/price 排序与 GIN 标签匹配。保留原排序 allowlist、稳定 id 次序、NULLS LAST、OFFSET 和完整导出限额；没有为全部可选列堆叠索引。

## 本地验证与复现

```bash
npx tsx --test tests/sellfox-*.test.ts
npm run typecheck
npx eslint src/lib/sellfox/{listings-read,workbench-read,agent-read}.ts tests/sellfox-{listings-read,workbench-read,agent-read,browse-api}.test.ts tests/integration/sellfox-listings-read-model.ts
DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused npx prisma validate
npx playwright test --config tests/browser/sellfox.config.ts --grep 'listing|Listing|在线商品'
git diff --check
```

迁移/回填/触发器/真实查询回归使用独立内存 PGlite，无数据库 URL，不读 `.env`，无网络/API。PGlite 只是可选测试工具，不新增应用依赖；如未安装可装至 `/tmp`，不改仓库 lockfile：

```bash
npm install --prefix /tmp/sellfox-listing-tools @electric-sql/pglite
SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-listing-tools/node_modules/@electric-sql/pglite/dist/index.js \
  npx tsx tests/integration/sellfox-listings-read-model.ts > /tmp/listings-plans.log
```

有现成工具时直接 `npx tsx tests/integration/sellfox-listings-read-model.ts`。输出完整 EXPLAIN JSON。集成验证包含真实旧视图增量迁移、已存在及半成品快照回填、正常插入/更新、NULL/0/坏数值、BSR/category、真假布尔、标签、删除无 MSKU、组织与店铺隔离、空页 facets、分页排序、Agent/导出与分页后库存补充。

可选 before/after 对照：先将基线的 SQL 构造器临时放入同目录，以复用其相对导入，然后生成参数化 SQL fixture（完成即删除临时源文件）：

```bash
git show 4ab7a42:src/lib/sellfox/workbench-read.ts > src/lib/sellfox/.listings-before.ts
npx tsx -e '
import { workbenchReadSql } from "./src/lib/sellfox/.listings-before";
import { sellfoxBrowseQuery } from "./src/lib/sellfox/browse-query";
import { writeFileSync } from "node:fs";
const sql = workbenchReadSql("listings", sellfoxBrowseQuery(new URL("http://localhost/?dimension=asin&pageSize=20")), {organizationId:"org",workspaceId:"ws"});
writeFileSync("/tmp/listings-before.json", JSON.stringify({text:sql.text,values:sql.values}));
'
rm src/lib/sellfox/.listings-before.ts
npx tsx tests/integration/sellfox-listings-read-model.ts --before-sql=/tmp/listings-before.json > /tmp/listings-plans.log
```

本次：Sellfox 测试 206/206、隔离 SQL 集成、TypeScript、改动文件 ESLint、Prisma validate、listings 浏览器 4/4 通过。没有跑生产构建/完整 E2E：本次无构建链/UI 改动且不合码/上线，验证按读路径与迁移风险选择。

## 发布前缺口、成本与回滚

本次只提交，尚未应用到任何真实数据库。未来发布必须先审核并应用迁移、Prisma generate，再启动新应用；新代码不能配旧 schema。迁移包含全表回填、索引构建与 ANALYZE，需提前确认历史行数、磁盘/WAL/备份和维护窗口；DDL 会阻塞并发同步。新增写入会多做一次投影与索引维护，真实大批次同步耗时尚待测量。

应用回滚可保留新增列、索引、函数、触发器及原 view 列，旧写入仍会维护新投影；不做 migrate down/删列/数据库恢复。迁移事务失败整体回滚，应用不应启动。

剩余风险：精确 count 和 facets 仍是 O(current rows)，只是窄列扫描；本 fixture facets 成本可接受，暂不加缓存。可选排序、ILIKE contains、深页 OFFSET、历史批次数极多、真实库存 view 的批量补充、并发和冷缓存未作生产 benchmark。仅在实际测量超预算后，才分别考虑 facets TTL/预聚合、更多有证据的索引或 cursor；不得把其他域的旧 JSON 报表路径误标为此次已整改。
