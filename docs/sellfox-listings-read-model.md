# Sellfox listings 列表延迟整改（2026-10-26）

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
