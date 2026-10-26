# 赛狐销量统计 / 销售利润 P0（本地交付）

## 2026-10-27 — performance 默认显示其余四个广告渠道费用列 · BOX LOCAL ONLY

基线 HEAD `d3d3c4a`（`d3d3c4a9b9a916d312c454ec4e02794531ac498f`），分支 `codex/operations-p0-catalog-replenishment`。仅将以下四个既有 numeric 列移出 performance 默认隐藏 map-tail，依次插在已默认显示的 `adSpCost` 之后、`fbaStorageFeeAmount` 之前，显式设置 `defaultVisible: true`：

| key | 列名 | 原样保留的 requiresField |
| --- | --- | --- |
| adSdCost | SD广告费 | 销售利润 payload.adSdCost 类型投影 |
| adSbCost | SB广告费 | 销售利润 payload.adSbCost 类型投影 |
| adSbvCost | SBV广告费 | 销售利润 payload.adSbvCost 类型投影 |
| adSbsCost | SBS广告费 | 销售利润 payload.adSbsCost 类型投影 |

生产源码与基线加上述四列结构移动的预期结果逐字节一致：没有新增 key，没有标签、numeric 或 requiresField 变更，其他数据域及其余源码不变。七种维度的默认列和默认 CSV/XLSX 均包含五个 ad*Cost；显式选列（逐列选择、逐列隐藏、整组隐藏及空集合）继续为权威，不迁移已保存选列。退款、FBA storage extras、自定义/服务费用和身份 map-tail 保持隐藏。performance 剩余默认隐藏 **73 列**（3 个身份列、70 个 numeric 列）。**Fee-mining remains paused**。下一批为 FBA storage extras，本轮不实施。

验证通过：以下两个定向测试文件（Prisma stub，不连真实库）、TypeScript、指定文件 ESLint 和 `git diff --check`。覆盖七种维度默认顺序、五个广告渠道默认可见、默认/显式 CSV 与真实 ExcelJS XLSX 回读、非零/零/NULL 和选列权威性。浏览器用例已扩展四个中文列名，验证默认 header 顺序和勾选、手动隐藏后跨域保留以及 CSV/Excel 选列排除；尝试运行时 Chromium 在 `sandbox_host_linux.cc:41` 报 `Operation not permitted` / SIGTRAP，页面断言未执行，未绕过沙箱。需在允许启动 Chromium 的本地环境补跑。

复验命令：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
NODE_ENV=test npm run test:sellfox:browser -- --grep 'performance core cost defaults'
```

本轮仅四个仓库文件；仓库外 parity-gap 文档由父进程更新。仅 BOX 本地，无 push/fetch/deploy/SSH、live Sellfox API、schema/migration/SQL 或真实数据库写入，未加载/修改 `.env`。按本轮约定跳过完整 check/build；定向测试和类型/lint 足以覆盖本次列配置变更，未来合码/发布或查询/存储变化时另行安排高成本检查。回滚为将这四列放回原隐藏组并撤销本轮测试/文档增量，不涉及数据操作。

本地提交待父进程处理：`git add` 无法创建 `.git/index.lock`（Read-only file system），四个文件保持未暂存，HEAD 仍为基线；未 chmod/强制或绕过沙箱。父进程可用其 `GIT_INDEX_FILE` 流程提交：`feat(sellfox): default-show performance ad-channel cost columns`。

下方为历史批次。

---


## 2026-10-27 — performance 默认显示八个核心成本/费用列 · BOX LOCAL ONLY

基线 HEAD `2066f19`（`2066f19b1d42eed9dce2ec684e14e0b2cfa27fc5`），分支 `codex/operations-p0-catalog-replenishment`。仅将八个既有 numeric 列从 performance 的默认隐藏 map-tail 移出，按以下顺序放在 `adCost`「广告花费」之后、`currency`「币种」之前，显式设置 `defaultVisible: true`：

| key | 列名 | 保留的 requiresField |
| --- | --- | --- |
| commodityCost | 商品成本 | 销售利润 payload.commodityCost |
| shippingPrice | 运费 | 销售利润 payload.shippingPrice |
| taxPrice | 税费 | 销售利润 payload.taxPrice |
| headTripPrice | 头程 | 销售利润 payload.headTripPrice |
| avgPurchaseCost | 采购成本 | 销售利润 payload.avgPurchaseCost |
| amazonCommissionPrice | 亚马逊佣金 | 销售利润 payload.amazonCommissionPrice |
| adSpCost | SP广告费 | 销售利润 payload.adSpCost 类型投影 |
| fbaStorageFeeAmount | FBA仓储费 | 销售利润 payload.fbaStorageFeeAmount 类型投影 |

七种商品/汇总维度的默认列和无显式选列的 CSV/XLSX 均包含这八列。已有显式选列仍为权威，包含逐列选择、手动隐藏八列和空集合，不迁移已保存配置。逐字节重建本次预期源码并与基线比对通过：生产改动恰为八列结构移动与显式可见标记；无新 key，标签、numeric、requiresField 原样保留，performance 之外源码不变。

剩余 map-tail 仍统一 `defaultVisible: false`：77 列（3 个身份列 asin/title/marketplace，74 个 numeric 指标/费用/退款列）。可供后续另行选择的既有类型列包括 adSdCost/adSbCost/adSbvCost/adSbsCost、fbaLongTermStorageFeeAmount/fbaRemovalFeeAmount/fbaDisposalFeeAmount、customAsinFee/customShopFee/serviceFeeAmount/storageFeeAmount；refundPrice/refundNum、其他 FBA 费用和长尾费用继续隐藏。**Fee-mining remains paused**，本轮不扩展字段或挖掘费用。

验证通过：两个定向测试文件（Prisma stub，无真实库），覆盖默认顺序、七维度默认/显式选列、中文 CSV 与真实 ExcelJS XLSX 回读、非零/零/NULL，以及其他广告渠道/FBA费用/退款仍隐藏；TypeScript、指定文件 ESLint、`git diff --check`。浏览器测试已补默认八列 header/顺序/勾选、取消后切换数据域仍隐藏及 CSV/Excel 链接排除的断言；尝试运行时 Chromium 在启动阶段报 `sandbox_host_linux.cc:41` / `Operation not permitted` / SIGTRAP，页面断言未执行，未绕过沙箱。需在允许启动 Chromium 的本地环境补跑该用例。

复验命令：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
NODE_ENV=test npm run test:sellfox:browser -- --grep 'performance core cost defaults'
```

本轮仅四个仓库文件；不更新仓库外 parity-gap 文档（由父进程负责）。无 push/fetch/deploy/SSH、live Sellfox API、schema/migration/SQL、同步/计划或真实数据库读写，未加载/修改 `.env`。按本轮约定跳过完整 check/build、数据库集成及真实性能 benchmark；将来合码/发布或查询/存储变更时另行安排对应检查。回滚为把这八列放回原隐藏组并撤销本轮测试/文档增量，不涉及数据操作。

本地提交尝试受阻：`git add` 无法创建 `.git/index.lock`（Read-only file system），未暂存、未执行 commit，未 chmod/强制或绕过沙箱。四个文件保留未暂存改动，供父进程通过其 `GIT_INDEX_FILE` 流程提交：`feat(sellfox): default-show performance core cost columns`；HEAD 仍为上述基线。

下方为历史批次。

---


## 2026-10-27 02:33:37 Asia/Shanghai — sales 默认显示 totalInventory「总库存」 · Owner: Chen Jieliang · BOX LOCAL ONLY

基线 `137ab4f3fae27083f3f12dff324c9a8712a3c02e`，分支 `codex/operations-p0-catalog-replenishment`。仅将 `columns.sales.totalInventory` 移出默认隐藏组，紧跟 `average7`「均值」（相对顺序不变），保持 numeric；商品（ASIN/MSKU/SKU/父ASIN）与 store/developer/spu 默认列、未显式选列的 CSV/XLSX 均包含「总库存」。显式会话 `columnSelection`（含空集合、手动隐藏总库存）原样生效，不迁移已保存选列。

库存仍来自既有 `sellfox_inventory_current` 页内补充查询（storeId+msku 汇总）；`inventoryCapturedAt` / currency / marketplace 继续默认隐藏；AWD stubs 仍 unavailable。销量业务员 / 实时统计 / 运营 / 业绩归属人 / 分类 / AWD / 销量洞察保持锁定。performance / listings / ads 默认配置与基线逐字节一致（listings `totalInventory` 仍 `defaultVisible: false`）。**Fee-mining remains paused**。

无 schema/migration/SQL、服务端、同步或计划改动；无 push/fetch、SSH、deploy、migrate-on-123、live Sellfox API 或真实数据库读写，未加载/修改 `.env`。仅 BOX 本地。回滚为将 totalInventory 放回原默认隐藏组并撤销本轮测试/文档改动，不涉及数据操作。

验证：定向单测覆盖七种维度默认顺序、默认及显式选列 CSV/真实 ExcelJS XLSX（180/0/NULL）、显式空选列与 AWD/库存时间仍隐藏；TypeScript、touched ESLint、`git diff --check`。Prisma stub，不连真实库。未跑完整 check/build、浏览器或真实 P95（Chromium 在 BOX sandbox 常 SIGTRAP）。

验证命令：

    NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts
    npm run typecheck
    node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
    git diff --check

仅 BOX 本地：无 push/fetch、deploy、SSH、migrate-on-123、live Sellfox、schedules 或 `.env`。仓库外 /workspace/sellfox-parity-gap.md 同步，不入库。

**sales average7「均值」默认显示（2026-10-27 02:09:27 Asia/Shanghai · Owner: Chen Jieliang · BOX LOCAL ONLY）**

基线 `2e2e3af099b0f5fbd730af133dddc71cddc97730`，分支 `codex/operations-p0-catalog-replenishment`。仅将 `columns.sales.average7` 移出默认隐藏组，紧跟 `trend`「销量趋势」，保持 numeric；商品（ASIN/MSKU/SKU/父ASIN）与 store/developer/spu 默认列、未显式选列的 CSV/XLSX 均包含「均值」。显式会话 `columnSelection`（含空集合、手动隐藏均值）原样生效，不迁移已保存选列。

派生继续使用所选范围末 7 个完整 `dailyQuantity` 日，与所选 quantity/orders/revenue 指标无关；缺任一天为 NULL/空白、不补零，真实 0 保留。`average7` / `trend` 排序仍拒绝。performance / listings / ads 及六广告子页配置逐字节保持基线；销量业务员 / 实时统计 / 运营 / 业绩归属人 / 分类 / AWD / 销量洞察保持锁定，totalInventory / inventoryCapturedAt / currency / marketplace 等仍默认隐藏。**Fee-mining remains paused**。

无 schema/migration/SQL、服务端、同步或计划改动；无 push/fetch、SSH、deploy/restart、migrate-on-123、live Sellfox API 或真实数据库读写，未加载/修改 `.env`。仅 BOX 本地。回滚为将 average7 放回原默认隐藏组并撤销本轮测试/文档改动，不涉及数据操作。

验证：以下四个定向测试文件全部通过，覆盖七种维度的默认顺序、默认及显式选列 CSV/真实 ExcelJS XLSX 回读、数值均值/零/缺日空白、显式空选列与排序守卫；TypeScript 和 touched ESLint 通过。逐字节比对确认生产源码只包含本次 sales average7 lift，其余内容与基线一致。

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-browse-query.test.ts tests/sellfox-browse-filters.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
# 已尝试，Chromium 启动受 BOX sandbox 限制，页面断言未执行：
NODE_ENV=test npm run test:sellfox:browser -- --grep 'sales matrix filters'
```

浏览器用例已补默认均值列/勾选、不可排序、默认导出列序与手动隐藏后导出断言；本次 Chromium 在 `sandbox_host_linux.cc:41` 报 `Operation not permitted` / SIGTRAP，需父进程在允许浏览器的本地环境补跑。未绕过沙箱。未跑完整 check/build、Prisma/PGlite 或真实 P95：本次只改列默认显示，使用定向 fixture、类型、touched lint 和 diff 检查；合码/发布前补完整检查，SQL/schema 或性能专项才触发对应验证。仓库外 `/workspace/sellfox-parity-gap.md` 同步状态，不纳入 repo commit。

`git diff --check` 通过。本地提交在 `git add` 阶段受阻：无法创建 `.git/index.lock`（Read-only file system），未执行 commit、未强制或绕过沙箱。4 个仓库文件完整保留为未暂存改动，HEAD 仍为 `2e2e3af099b0f5fbd730af133dddc71cddc97730`；父进程需本地提交：`feat(sellfox): default-show sales average7 column`。

下方为历史批次。

---

**UI polish：performance 业务员默认显示（2026-10-27 01:07:17 Asia/Shanghai · Owner: Chen Jieliang · 仅 BOX 本地）**

`performance.salesperson`「业务员」移出默认隐藏列组，位于币种之后，使用 `column()` 的 `defaultVisible: true`；商品维度和 store/developer/spu 默认列及无显式选列的 CSV/XLSX 均包含该列。仍读取既有 `userNameList` 类型投影并以「、」连接，requiresField、筛选/facets/包含语义不变。业务员统计维度仍禁用，sales 业务员与 Listing/ads 业务员仍锁定，其余灰显不变；可选费用列继续默认隐藏，**fee-mining remains paused**。已有显式选列继续遵循用户配置。回滚仅还原本轮 UI/测试改动，无数据操作。

本轮无 schema/migration/SQL/sync 改动；无 push/fetch、SSH/deploy/restart、migrate-on-123、真实库读写、live Sellfox API 或计划启用。离线复验（预期定向测试和浏览器测试零失败，类型/lint/diff 零错误）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-query.test.ts tests/sellfox-browse-filters.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-agent-read.test.ts
NODE_ENV=test npm run test:sellfox:browser -- --grep 'salesperson|store dimension'
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts tests/browser/sellfox.spec.ts
git diff --check
```

验证通过：156 项定向 fixture 测试、3 项隔离浏览器测试、TypeScript、touched TS ESLint 和 `git diff --check`。无显式选列 CSV/XLSX 经真实 ExcelJS 生成/回读验证姓名连接与空值。仅列默认值变更，采用定向 fixture/浏览器、TypeScript 与 touched ESLint；不运行完整 check/build、PGlite 或 Prisma validate/generate（无 schema/SQL 改动），不依赖数据库隧道。下方为历史批次。

本地提交受阻：`git add` 无法创建 `.git/index.lock`（Read-only file system），已授权的 `chmod -R u+w .git` 同样失败。4 个仓库文件完整保留为未暂存改动，供父进程完成本地提交；HEAD 仍为 `03918dec796ed61ec9352597fba805b5c4b2b4da`，本轮无新 SHA。

---

**190000 fee-wrap 收尾（2026-10-27 00:27:11 Asia/Shanghai · Owner: Chen Jieliang · 仅 BOX 本地）**

`evaluationCapital`「测评本金」、`evaluationCommission`「测评佣金」、`dealPerformanceFeeAmount`「Deal表现费」、`couponParticipationFeeAmount`「优惠券参与费」、`safetReimbursedAmount`「SAFE-T赔偿」、`affordabilityExpenseAmount`「可负担性费用」、`withheldFeeAmount`「预扣费用」、`chargebackIncomeAmount`「拒付收入」、`guaranteeClaimIncomeAmount`「A-Z索赔收入」、`promotionSalesAmount`「促销销售额」、`promotionShippingAmount`「促销运费」、`promotionTaxAmount`「促销税费」。全部为 performance 默认隐藏数字列；同名 profit payload → nullable 类型投影 → typed SQL 聚合/排序/选列 CSV/XLSX；Agent 英文长表末尾追加。明细 NULL 空、0 保留，实体及币种 totals 用 `COALESCE(sum(...),0)`。

evaluationCapital「测评本金」/evaluationCommission「测评佣金」分别独立于 evaluationFee「测评费」和 evaluationSaleNum（数量）；chargebackIncomeAmount「拒付收入」≠ chargebackAmount「拒付退款」，guaranteeClaimIncomeAmount「A-Z索赔收入」≠ guaranteeClaimAmount「A-Z索赔退款」；promotionSalesAmount「促销销售额」≠ promotionDiscount「促销折扣」≠ promotionTotalAmount「促销费」，亦独立于 promotionShippingAmount/promotionTaxAmount；withheldFeeAmount「预扣费用」≠ withheldTaxAmount「商城代扣税」。不映射 Listing fees。

**Fee mining wraps / pauses here**：本批为费用挖掘收尾；mfregulatory*、purchaseCost* splits 及无明确标签的 long-tail 继续锁定，等待 Sellfox web label verify 后另行授权。销售小组 / 业绩归属人 / 实时统计 / 运营 / 分类 / AWD / sales业务员 / 广告组合 / 否定 / AMC 仍锁定；sales 域不增加这些列。

190000 为加法迁移：保留 180000 所有函数投影/trigger 和精确视图列序，末尾追加 12 列，无新索引；一次 `UPDATE payload=payload` 回填。未来应用前评估全历史锁/WAL/磁盘与维护窗口；回退应用代码并保留加法 schema，不自动删列/数据库回滚。未做真实 P95 benchmark。 仅 BOX 本地，Owner: Chen Jieliang；无 push/fetch、SSH/deploy/restart、123 迁移/真实库写入、live Sellfox API/sync 或计划启用。123 需全部前置迁移（含 180000）+ 190000，只有用户说「上」后另行评审。

验证完成：177 项定向测试通过；190000 / Listing / cross-store 三个独立 PGlite verifier 均 PASS（可选专用 PG 子测未配置，SKIP）；TypeScript、改动 TS ESLint、fake-URL Prisma validate/generate、git diff --check 通过。额外逐字审计确认 180000 函数投影与视图前缀完全保留，仅追加指定 12 列且无新索引。

本地提交受阻：`.git` 为只读文件系统，`chmod -R u+w .git` 失败，`git add -A` 无法创建 `.git/index.lock`。未暂存/提交，完整改动留在当前分支工作区供父进程完成本地提交；HEAD 仍为 `0261c18`。

离线复验（预期定向测试零失败，三个 disposable PGlite verifier 均 PASS；专用 PG 子测未配置时 SKIP，类型/lint/Prisma/diff 零错误）：

```bash
NODE_ENV=test node --import tsx --test --test-concurrency=1 tests/sellfox-{sync-recovery,workbench-read,browse-query,agent-read,listing-identity,browse-api,browse-filters}.test.ts
SELLFOX_P0_TEST_DATABASE_URL= SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-sales-profit-p0.ts
SELLFOX_P0_TEST_DATABASE_URL= SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-listings-read-model.ts
SELLFOX_P0_TEST_DATABASE_URL= SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-cross-store.ts
npm run typecheck
# 对本轮变更的 TS/TSX 执行 ESLint（包含 src 和 tests）。
git diff --name-only -- '*.ts' '*.tsx' | xargs node_modules/.bin/eslint
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node_modules/.bin/prisma validate
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node_modules/.bin/prisma generate
git diff --check
```

共享 `performance-fee-wrap.json` 覆盖非零/0/null/非法；SQL 验证 180000 后历史回填、INSERT、payload=payload、UPDATE 清空、COALESCE、精确视图追加列序、旧字段/索引、结算/币种隔离及 Agent 排序。完整 check/build/浏览器/真实 P95 留待明确合码、发布或真实性能验收。下方为历史批次记录，其锁定/提交状态以本节与当前 Git 状态为准。

---

**180000 增量（2026-10-27 00:13:06 Asia/Shanghai · Owner: Chen Jieliang · 仅 BOX 本地）**

全部 12 个 service/refund/Tl 列已接入，performance 默认隐藏；完整键/中文标签见 `performance-service-fees.json` 与 workbench captions。两项 FBA 退款不是基础费用；otherPriceIncomeAmount「其他收入」≠ otherPriceAmount「其他费用」≠ orderOtherPriceAmount「订单其他费」，Tl deferred/withheldTax 与 taxPrice 独立。Agent 长表末尾追加 12 列，选列 CSV/XLSX 保留 0/空 NULL；sales、Listing aliases、evaluationCapital/evaluationCommission 与灰显项不变。

180000 必须接在全部前置迁移（含 170000）后；精确保留旧投影/视图列序，无新索引，一次 payload=payload 回填。未来执行先评估全历史锁/WAL/磁盘，回退应用保留加法 schema；123 仅用户说「上」后另行评审。本轮无 push/deploy/SSH/真实库写入/线上 API/计划启用。

验证：173 项定向测试全绿；180000 / Listing / cross-store 独立 PGlite 均 PASS（专用 PG 子测未配置而 SKIP）；TypeScript、touched ESLint、fake-URL Prisma validate/generate、git diff --check 均通过。

本地提交受阻：git add 无法创建 `.git/index.lock`（Read-only file system），`chmod -R u+w .git` 同样失败；未暂存/提交，完整改动保留工作区供父进程完成本地提交，基线 HEAD `ab1595b`。离线复验：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-{sync-recovery,workbench-read,browse-query,agent-read,listing-identity,browse-api,browse-filters}.test.ts
SELLFOX_P0_TEST_DATABASE_URL= SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-sales-profit-p0.ts
npm run typecheck
# touched ESLint / fake-URL Prisma / Listing 与 cross-store 命令沿用下方验证块。
git diff --check
```

预期 173 passed、180000 + PASS、类型与 diff 检查零错误。共享 service fixture 覆盖非零/0/null/非法，SQL 验证 INSERT、170000 后回填、payload=payload、UPDATE 清空、COALESCE、旧字段/列序/索引、结算/币种隔离及 Agent 排序。采用定向测试及隔离 SQL 专项验证；完整 check/build/浏览器/真实 P95 留待明确合码、发布或真实性能验收。

---


**状态更新（2026-10-26 23:58:23 Asia/Shanghai · Owner: Chen Jieliang · 仅 BOX 本地，未部署）**

- **验证完成**：169 项定向测试全绿；170000 / Listing / cross-store 独立 PGlite 均 PASS（专用 PG 子测未配置而 SKIP，不影响独立 verifier）；TypeScript、改动 TS ESLint、fake-URL Prisma validate/generate、git diff --check 通过。额外核对 160000 全部函数投影逐字保留、视图前缀完全一致、恰好新增 12 列及无新索引。跨店 fixture 现可用同样的 standalone PGlite 命令离线复验。
- **本地提交受阻**：`.git/index.lock` 创建失败（Read-only file system），`chmod u+w .git .git/index` 同样被只读文件系统拒绝。未生成新 commit、未能暂存；完整改动已留在当前分支工作区供父进程提交，基线 HEAD 为 `db68622`，未 push/fetch。

- 本轮 performance 解锁 12 个默认隐藏数字列：`fbaInboundTransportationProgramFee`「FBA入库运输计划费」、`aglFeeAmount`「AGL费用」、`paidServicesFeeAmount`「付费服务费」、`customerReturnHrrUnitFeeAmount`「HRR退货单位费」、`amazonUpstreamStorageTransportationFeeAmount`「上游仓储运输费」、`amazonUpstreamProcessingFeeAmount`「上游处理费」、`mfnPostageFeeAmount`「MFN邮资」、`adjustmentFeeAmount`「调整费」、`otherServiceFeeAmount`「其他服务费」、`avgHeadTripPrice`「平均头程」、`purchaseRefundPrice`「订单内退款」、`revenueAmount`「清算费」。同名 profit payload → nullable typed product-daily → 实体/币种 `COALESCE(sum(...),0)`、排序、选列 CSV/XLSX；Agent 英文长表末尾同序追加。明细 NULL 空、0 保留，hot path 不解析 payload，sales 不增加这些列。
- `avgHeadTripPrice`「平均头程」≠ `headTripPrice`「头程」；`purchaseRefundPrice`「订单内退款」≠ `refundPrice`「退款金额」；`revenueAmount` =「清算费」，≠ `saleRevenue` / `netRevenue`，不得解释为销售额。Listing fees 不作别名或缺值补充。
- 加法迁移 `20261026170000_sellfox_product_daily_next_fees` 接在 160000 后，保留全部旧投影及 `userNameList` / payload 写入 trigger、精确视图列序后追加 12 列；无新索引，一次 `payload=payload` 历史回填。**123 需全部前置迁移（含 160000）+ 170000，仅用户说「上」后另行评审。** 真实执行前评估全历史回填的锁、WAL、磁盘和维护窗口；回退应用代码并保留加法 schema/trigger，不自动回滚数据库。
- `evaluationCapital` / `evaluationCommission`、*Percent、purchaseCost* 补充/channel splits、headTripPrice* FBA/FBM splits、两项 FBA refund companions 未接入；销售小组 / 业绩归属人 / 实时统计 / 运营 / 分类 / AWD / sales业务员 / 广告组合 / 否定 / AMC 仍锁定。
- 本轮 no push / no fetch / no deploy / no SSH / no migrate-on-123 / no live DB writes / no live Sellfox API / 未启用计划。仅 fixtures/PGlite 和 fake DATABASE_URL 验证；真实费用数据及 P95 待另行验收。

离线复验（预期定向测试全绿、PGlite 含 `170000` 与 `PASS`；专用 PG 未配置时子测 SKIP，独立 PGlite 必须 PASS）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-{sync-recovery,workbench-read,browse-query,agent-read,listing-identity,browse-api,browse-filters}.test.ts
SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-sales-profit-p0.ts
SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-listings-read-model.ts
SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-cross-store.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts src/lib/sellfox/{product-performance,workbench-read,sort-columns,agent-read}.ts tests/sellfox-{sync-recovery,workbench-read,browse-query,agent-read,browse-api}.test.ts tests/integration/sellfox-{sales-profit-p0,cross-store,listings-read-model}.ts
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node node_modules/prisma/build/index.js validate
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node node_modules/prisma/build/index.js generate
git diff --check
```

共享 `performance-next-fees.json` 覆盖非零/0/null/非法，验证 INSERT、160000 后历史回填、UPDATE 清空、COALESCE、币种/结算隔离、无新索引、精确列序及既有字段保留；Listing/跨店 fixtures 追加相同类型列。采用定向测试 + PGlite + TypeScript/touched lint/Prisma；完整 check/build/浏览器/真实 P95 留待明确合码、发布或真实性能验收。

---

**状态更新（2026-10-26 23:41:49 Asia/Shanghai · Owner: Chen Jieliang · 仅 BOX 本地，未部署）**

- 本轮 performance 解锁 12 个默认隐藏数字列：`couponPaymentAmount`「优惠券支付」、`sellerDealPaymentAmount`「Deal费用」、`vineFeeAmount`「Vine费用」、`starStorageFeeAmount`「星级仓储费」、`subscriptionAmount`「订阅费」、`fbaCustomerReturnAmount`「FBA买家退货费」、`fbaInboundConvenienceFeeAmount`「FBA入库配置费」、`inboundTransportationFeeAmount`「入库运输费」、`shippingChargebackAmount`「买家运费扣除」、`giftwrapChargebackAmount`「礼品包装费扣除」、`costOfPointsGrantedAmount`「积分费用」、`orderOtherPriceAmount`「订单其他费」。同名 profit payload → nullable typed product-daily → 实体/币种 `COALESCE(sum(...),0)`、排序、选列 CSV/XLSX；Agent 英文长表同序追加。明细 NULL 空、0 保留，hot path 不解析 payload，sales 不变。
- 独立字段：starStorageFeeAmount ≠ storageFeeAmount / fbaStorageFeeAmount / fbaLongTermStorageFeeAmount / fbaOverageFeeAmount；shippingChargebackAmount ≠ shippingChargeAmount；giftwrapChargebackAmount ≠ giftWrapFee；orderOtherPriceAmount ≠ otherPriceAmount。Listing fees 不作别名。
- 160000 接在 150000 后，保留全部旧投影/trigger 和精确视图列序后追加 12 列；无新索引，一次 payload=payload 回填。**123 需全部前置迁移 + 160000，仅用户说「上」后评审。** 执行前评估全历史回填锁/WAL/磁盘及维护窗口；回退应用代码，保留加法 schema/trigger，不自动回滚数据库。
- evaluationCapital/evaluationCommission、*Percent、销售小组/业绩归属人/实时统计/运营/分类/AWD/sales业务员/广告组合/否定/AMC 仍锁定；fbaInboundTransportationProgramFee / aglFee* / paidServicesFee* 未接入。
- 本轮 no push / no fetch / no deploy / no SSH / no migrate-on-123 / no live DB writes / no live Sellfox API；未启用计划。验证使用 fixtures/PGlite 和 fake DATABASE_URL；线上真实费用/P95 未验收。

离线复验（预期定向测试全绿，PGlite 含 `160000` / `PASS`；未配置专用 PG 时 PG 子测 SKIP，独立 PGlite 必须 PASS）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-{sync-recovery,workbench-read,browse-query,agent-read,listing-identity,browse-api,browse-filters}.test.ts
SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-sales-profit-p0.ts
SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-listings-read-model.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts src/lib/sellfox/{product-performance,workbench-read,sort-columns,agent-read}.ts tests/sellfox-{sync-recovery,workbench-read,browse-query,agent-read,browse-api}.test.ts tests/integration/sellfox-{sales-profit-p0,cross-store,listings-read-model}.ts
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node node_modules/prisma/build/index.js validate
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node node_modules/prisma/build/index.js generate
git diff --check
```

本轮已执行：165 项定向测试全绿；强化 fixture 区分后相关 14 项重跑通过；sales-profit 160000 / Listing / cross-store PGlite 均 PASS，typecheck、touched lint、fake-URL Prisma validate/generate、diff 检查通过。专用 PG 子测因未配置而 SKIP；PGlite 独立 verifier 已执行。

共享 `performance-contig-fees.json` 覆盖非零/0/null/非法、INSERT、150000 后历史回填、UPDATE 清空、聚合、币种/结算隔离、列序、无新索引及旧字段保留；Listing/跨店 fixtures 同步追加类型列。定向测试 + PGlite + TypeScript/lint/Prisma 覆盖本次边界；完整 check/build/浏览器/真实 P95 留待明确发布或真实性能验收。

---

> 2026-10-26 23:29:44 Asia/Shanghai · Owner: Chen Jieliang · **仅 BOX 本地，未上线**：performance 新增八个默认隐藏数字列 `promotionTotalAmount`「促销费」、`fbaOverageFeeAmount`「FBA超量仓储费」、`chargebackAmount`「拒付退款」、`guaranteeClaimAmount`「A-Z索赔退款」、`digitalServicesFeeAmount`「数字服务费」、`otherPriceAmount`「其他费用」、`shippingChargeAmount`「买家运费」、`regulatoryFeeAmount`「监管费」。同名 profit payload → typed product-daily → 实体/币种 `COALESCE(sum(...),0)`、排序及选列 CSV/XLSX；Agent 英文长表末尾同序追加八列。明细 NULL 空、0 保留；hot path 不解析 payload。`promotionTotalAmount` ≠ `promotionDiscount`「促销折扣」，均保留；Listing fees 不作别名，sales 不变，不增加 *Percent。
>
> 加法迁移 `20261026150000_sellfox_product_daily_optional_fees` 在 140000 后执行，保留所有旧投影/trigger/视图列序，无新索引，一次 `payload=payload` 回填。**123 需全部前置迁移 + 150000，仅用户说「上」后另行评审。** 真实执行前评估全历史回填锁、WAL/磁盘及维护窗口；回退应用代码并保留加法 schema/trigger，不自动回滚数据库。evaluationCapital/evaluationCommission、销售小组/业绩归属人/实时统计/运营/分类/AWD/sales业务员/广告组合/否定/AMC 继续锁定。本轮无 push/fetch、SSH/部署/迁移到123/重启、live Sellfox API、真实库写入或计划启用。

本轮离线复验（预期测试/类型/lint/Prisma/diff 检查通过；PGlite 输出含 `150000` 与 `PASS`，专用 PG 入口无配置时 SKIP）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-{sync-recovery,workbench-read,browse-query,agent-read,listing-identity,browse-api,browse-filters}.test.ts
# 当前 BOX Node 20 的 --test 只展示文件级结果；直接入口可核对每条断言：
for suite in sync-recovery workbench-read browse-query agent-read listing-identity browse-api browse-filters; do
  NODE_ENV=test node --import tsx "tests/sellfox-$suite.test.ts" || break
done
SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-sales-profit-p0.ts
SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-listings-read-model.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts src/lib/sellfox/{product-performance,workbench-read,sort-columns,agent-read}.ts tests/sellfox-{sync-recovery,workbench-read,browse-query,agent-read,browse-api}.test.ts tests/integration/sellfox-{sales-profit-p0,cross-store,listings-read-model}.ts
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node node_modules/prisma/build/index.js validate
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node node_modules/prisma/build/index.js generate
git diff --check
```

共享 `performance-optional-fees.json` 在同步及实际 150000 迁移 PGlite 中共用，覆盖非零/0/null/非法、INSERT、历史回填、UPDATE 清空、COALESCE、列序、无新索引、旧投影保留、币种/结算隔离、排序及 Agent。Listing/跨店 product-daily fixtures 同步追加类型列。采用定向测试及专项验证；完整 check、生产 build、浏览器和真实 P95 留待明确发布/真实性能验收，不以 fixture 通过代替线上费用验收。

---

> 2026-10-26 23:15:55 Asia/Shanghai · Owner: Chen Jieliang · **仅 BOX 本地，未上线**：performance 解锁默认隐藏数字列 customAsinFee「产品自定义费用」、customShopFee「店铺自定义费用」、serviceFeeAmount「服务费」、storageFeeAmount「仓储费」、compensationAmount「赔偿金」、evaluationFee「测评费」。同名profit payload→typed product-daily→聚合/排序/选列CSV/XLSX，Agent英文长表末尾追加六列；明细NULL空、0保留，实体及币种汇总 `COALESCE(sum(...),0)`。storageFeeAmount 与 fbaStorageFeeAmount「FBA仓储费」独立；evaluationFee 是金额，evaluationSaleNum 仍为数量。evaluationCapital / evaluationCommission 继续锁定；不映射 Listing fbaFees / referralFee 或商品试算「月仓储费」，不增加 *Percent 或 sales 域列。销售小组/业绩归属人/实时统计/运营/分类/AWD/sales业务员/广告组合/否定/AMC 仍锁定。
>
> 加法迁移 `20261026140000_sellfox_product_daily_misc_fees` 接在130000之后，保留全部旧投影/trigger/视图列序后追加六列，无新索引，一次 `payload=payload` 回填。**123需全部前置迁移+140000，仅用户说「上」后另行评审。** 真实回填会产生全历史更新、锁及WAL/磁盘成本，执行前评估行数与维护窗口；回退应用提交，保留加法列/trigger，不自动回退数据库。本轮不连接真实库、不调live API、不启用计划、不push/SSH/部署/远程迁移/重启。

本轮复验命令（预期定向测试、PGlite、typecheck、lint、Prisma validate/generate和diff检查通过；PG入口未配置专用库时SKIP，但独立PGlite verifier必须输出PASS）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-{sync-recovery,workbench-read,browse-query,agent-read,listing-identity,browse-api,browse-filters}.test.ts
SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-sales-profit-p0.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts src/lib/sellfox/{product-performance,workbench-read,sort-columns,agent-read}.ts tests/sellfox-{sync-recovery,workbench-read,browse-query,agent-read,browse-api}.test.ts tests/integration/sellfox-{sales-profit-p0,cross-store,listings-read-model}.ts
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node node_modules/prisma/build/index.js validate
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node node_modules/prisma/build/index.js generate
git diff --check
```

共享 `performance-misc-fees.json` 在同步与实际140000迁移PGlite中共用，覆盖非零/0/null/非法；包括回填、INSERT/UPDATE清空、COALESCE、列序、无新索引、全部旧投影、币种/结算/组织/工作区隔离和Agent排序。Listing/跨店fixture同步追加类型列。范围内采用定向测试和专项验证；未跑完整check、生产build、浏览器或真实P95，发布/真实性能验收时再由CI和受控benchmark补齐。fixture通过不代表真实费用线上验收。

---

> 2026-10-26 · Owner: Chen Jieliang · **仅 BOX 本地**：performance 追加默认隐藏 numeric 列 `fbaStorageFeeAmount`「FBA仓储费」、`fbaLongTermStorageFeeAmount`「长期仓储费」、`fbaRemovalFeeAmount`「FBA移除费」、`fbaDisposalFeeAmount`「FBA弃置费」。同名 profit payload → nullable Float 类型投影 → 实体/币种 `COALESCE(sum(...),0)` → 排序及选列 CSV/XLSX；Agent 英文长表末尾追加四列。明细 NULL 空、0 保留。Listing `fbaFees` / `referralFee`、商品试算「月仓储费」与这些利润键不同，不作别名或补数；sales 列不变。销售小组/业绩归属人/实时统计/运营/分类/AWD/sales业务员继续锁定。
>
> 加法迁移 `20261026130000_sellfox_product_daily_storage_fees` 接在120000后，保留全部旧投影与 trigger、视图旧列序后追加四列，无新索引；一次 `payload=payload` 回填保留 payload/adCost。**123 需要全部前置迁移（含50000 helper及80000～120000）+130000，只有用户说「上」后另行评审。** 实际回填前评估行数、锁、WAL/磁盘与维护窗口；代码回退本地提交，保留加法 schema/trigger，不自动回退数据库。本轮未连接真实库、未调用 live API/启用计划、未 push/fetch/SSH/部署/迁移/重启。

本批离线复验（预期七个定向测试文件及 PGlite verifier PASS；普通 PG 入口因未配置独立库而 SKIP）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-sync-recovery.test.ts tests/sellfox-workbench-read.test.ts tests/sellfox-browse-query.test.ts tests/sellfox-agent-read.test.ts tests/sellfox-listing-identity.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-browse-filters.test.ts
SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-sales-profit-p0.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts src/lib/sellfox/{product-performance,workbench-read,sort-columns,agent-read}.ts tests/sellfox-{sync-recovery,workbench-read,browse-query,agent-read,browse-api}.test.ts tests/integration/sellfox-{sales-profit-p0,cross-store,listings-read-model}.ts
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node node_modules/prisma/build/index.js validate
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node node_modules/prisma/build/index.js generate
git diff --check
```

本批以上验证通过，另通过 Listing 与跨店 PGlite fixture。共享 `performance-storage-fees.json` 覆盖非零/0/null/非法值；实际130000 DDL覆盖回填、INSERT/UPDATE触发器、视图列序、无新索引、既有费用/userNameList/数量/广告投影保留、币种/结算隔离与Agent排序。复用选列导出测试覆盖双路由、有无layout、CSV/XLSX。按本批范围使用定向验证；未跑浏览器、完整check、生产build或真实P95，发布/性能验收时再补CI与受控benchmark。fixture通过不代表真实费用已线上验收。


## 2026-10-26 销售利润广告渠道费用（Owner: Chen Jieliang；仅 BOX 本地）

- performance 新增可选数字列：adSpCost「SP广告费」、adSdCost「SD广告费」、adSbCost「SB广告费」、adSbvCost「SBV广告费」、adSbsCost「SBS广告费」，均 `defaultVisible: false`。沿用 typed product-daily → 聚合/排序 → 可见列 CSV/XLSX；Agent 英文长表末尾追加五列。明细 NULL 导出空、0 保留，工作台实体/币种 totals 沿用费用 `COALESCE(sum(...),0)`；币种、结算分区和组织/工作区隔离不变。
- **adTotalCost 已映射 adCost「广告花费」，跳过重复总计列**；既有 adCost 的映射与默认可见保持不变，不从 adCost 或 Listing 拆造渠道费用。五键依据任务提供的前期 mining，`tests/fixtures/sellfox/performance-ad-channel-costs.json` 在同步/PGlite 中共用；SBV/SBS 中文标签沿用任务指定，本轮未做 live/网页核验。sales 域不增加这些列；销售小组/业绩归属人/实时统计/运营/分类/AWD 继续锁定。
- 本地加法迁移 `20261026120000_sellfox_product_daily_ad_channel_costs`：保留110000所有费用、userNameList、测评/多渠道数量投影和 trigger，视图精确保留旧列序后追加五列，无新索引。一次 `UPDATE ... SET payload=payload` 回填只改派生列，保留 payload/adCost；实际应用前须评估全表行数、锁/WAL/磁盘与维护窗口。123 需全部前置迁移（含50000 helper、80000、90000、100000、110000）+120000；只有用户明确说「上」才另行评审发布。代码可回退本地提交，保留加法数据库字段/trigger，不自动 down migration。
- 本轮无 push/fetch、SSH、部署、重启、真实库连接/写入或 live Sellfox API/sync，不启用 schedules。Prisma validate/generate 仅用假 URL；迁移只在临时 PGlite 执行。

离线复验（预期业务测试、PGlite verifier、类型/lint/Prisma/diff 全通过；普通 PostgreSQL 测试入口因未配置独立测试库而 SKIP）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-sync-recovery.test.ts tests/sellfox-workbench-read.test.ts tests/sellfox-browse-query.test.ts tests/sellfox-agent-read.test.ts tests/sellfox-listing-identity.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-browse-filters.test.ts
SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-sales-profit-p0.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts src/lib/sellfox/{product-performance,workbench-read,sort-columns,agent-read}.ts tests/sellfox-{sync-recovery,workbench-read,browse-query,agent-read,browse-api}.test.ts tests/integration/sellfox-{sales-profit-p0,cross-store,listings-read-model}.ts
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node node_modules/prisma/build/index.js validate
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node node_modules/prisma/build/index.js generate
git diff --check
```

本轮验证：7个定向业务文件147/147通过；补充双路由CSV/XLSX选列后API文件9/9复验通过。PGlite利润增量迁移、Listing与跨店SQL fixture均通过；TypeScript、改动TS ESLint、假地址Prisma validate/generate、diff检查通过。

按本轮验收选择定向业务/导出测试 + 实际增量 DDL 的 PGlite + 类型/lint/Prisma；未跑浏览器、完整 check、生产构建或真实 P95。发布或真实性能验收时再补 CI 与受控 benchmark；fixture 通过不代表已部署或真实渠道金额已线上验收。

## 2026-10-26 销量商品品牌 / 产品标签 / 售价默认显示（Owner: Chen Jieliang；仅 BOX 本地）

- 仅 sales 的 `brand`「商品品牌」、`productTags`「产品标签」、`price`「售价」改为默认显示，保留原 requiresField；售价保留 numeric，位于产品标签之后，身份列顺序不变。商品及店铺/开发员/SPU 汇总维度均生效，继续沿用现有可见列 CSV/XLSX，0 保留、缺值空白。
- `trend` 仍默认显示；average7/总库存/库存时间/币种/站点仍默认隐藏。销量业务员、实时统计、运营、业绩归属人、分类、AWD、销量洞察继续锁定。performance/listings/ads 默认列不变，无 API/SQL/schema/migration 或导出逻辑变更。
- 仅 BOX 本地；不 push/fetch、不 SSH/部署/重启、不连接或写入真实数据库、不向123迁移、不调用 live Sellfox API、不启用计划。回滚本地提交即可恢复旧默认列。

离线复验（不加载 `.env`，测试使用 Prisma fixture；预期全部通过）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-query.test.ts tests/sellfox-browse-filters.test.ts tests/sellfox-browse-api.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts
git diff --check
```

本轮结果：四个定向文件111/111通过，TypeScript、改动文件 ESLint 和 diff 检查通过。覆盖各维度默认三列与趋势、隐藏/不可用列边界、默认及显式 CSV/XLSX 表头与数值/空值。配置改动按要求不跑 PGlite、浏览器、生产构建或完整 check；后续涉及 SQL/路由/存储或发布时补相应专项验证与 CI。

## 2026-10-26 销售利润默认列对齐赛狐截图（Owner: Chen Jieliang；仅 BOX 本地）

- performance 默认可见列打开：`parentAsin`「父ASIN」、`sku`「品名/SKU」、`netProfitRate`「净销售额毛利率」、`netRevenue`「净销售额」、`evaluationSaleNum`「测评销量」、`channelSaleNum`「多渠道销量」。列序贴近赛狐：图片/标题ASIN → 父ASIN → 品名SKU → 毛利/毛利率/净销售额毛利率 → 销售额/净销售额 → 订单/FBA可售/销量 → 测评/多渠道 → 促销折扣/礼品包装费 → 广告花费/币种。
- 费用与退款等重列（commodityCost/shipping/tax/headTrip/avgPurchase/amazonCommission/refund*）及业务员/ASIN/标题/站点仍默认隐藏；店铺/开发员/SPU 汇总视图继续隐藏 name/parentAsin/sku，避免产品字段噪音。销量域默认列本轮不变。
- 无 schema/migration/API/SQL 变更；仅 workbench-types 默认可见与汇总隐藏名单。CSV/XLSX 跟随默认可见列。仅本地提交，不 push、不部署、不连真实库、不向123迁移、不调用 live Sellfox API。回滚本地提交即可恢复旧默认列。

离线复验（不加载 `.env`，测试使用 Prisma fixture）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-query.test.ts tests/sellfox-browse-filters.test.ts tests/sellfox-browse-api.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts
git diff --check
```

本轮结果：四个定向文件共111例通过，覆盖利润默认列含父ASIN/品名/净销售额毛利率/净销售额/测评/多渠道、汇总隐藏产品字段、费用列仍默认隐藏、CSV/XLSX 显式选列；类型、改动文件 lint 和 diff 检查通过。复验预期全部通过。本轮未改 SQL/路由/存储，按要求跳过 PGlite、浏览器、生产构建和完整 check。

## 2026-10-26 销量趋势默认显示（Owner: Chen Jieliang；仅 BOX 本地）

- sales 的 `trend`「销量趋势」移出默认隐藏列组，商品及店铺/开发员/SPU 汇总视图均默认显示，继续使用现有 Sparkline；`average7`「均值」仍为可选隐藏列。显式选列保持用户选择；CSV/XLSX 沿用可见列导出，趋势为文本，缺日为空。
- 口径不变：只使用所选范围末七日完整的 `dailyQuantity`，与当前 quantity/orders/revenue 指标选择无关；缺任一天不补零、不派生趋势或均值。`trend` / `average7` 排序仍拒绝。不新增 API、SQL、Prisma/schema 或 migration；利润默认列及 AWD/业务员/售价/库存时间/币种/站点/总库存行为不变。销量业务员、实时统计、运营、业绩归属人、销售小组、分类、AWD、销量洞察继续锁定。
- 仅本地提交，不 push、不部署、不连接或写入真实库、不向123迁移、不调用 live Sellfox API、不启用计划。回滚本地提交即可恢复旧默认列；本轮未改路由/计算/存储，按要求跳过 PGlite、浏览器、生产构建和完整 check。

离线复验（不加载 `.env`，测试使用 Prisma fixture）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-query.test.ts tests/sellfox-browse-filters.test.ts tests/sellfox-browse-api.test.ts
npm run typecheck
node node_modules/eslint/bin/eslint.js src/components/sellfox/workbench-types.ts tests/sellfox-workbench-read.test.ts
git diff --check
```

本轮结果：四个定向文件共111例通过，覆盖销量默认列含 trend、不含 average7，完整七日派生、拒绝趋势/均值排序、默认及显式可见列 CSV/XLSX 文本与缺日空值；类型、改动文件 lint 和 diff 检查通过。复验预期全部通过。后续若改 SQL、路由或发布范围，再补相应集成/浏览器/CI 验证。

## 2026-10-26 测评销量 / 多渠道销量（Owner: Chen Jieliang；仅 BOX 本地）

- performance 新增默认隐藏数字列 `evaluationSaleNum`「测评销量」、`channelSaleNum`「多渠道销量」。截图 `/tmp/sellfox-compare/sellfox-sales-profit.png` 确认是**测评销量，不是测评销售额**；交接的只读证据表明两键均存在，0 是有效数量，未发现 `evaluationSalePrice` / `evaluationSaleAmount` / `evaluationSale`，不得发明金额映射。本轮不重新连接真实库。
- `20261026110000_sellfox_product_daily_eval_channel_qty` 必须在 100000 后：追加两个 nullable DOUBLE PRECISION，保留原八项费用及 userNameList 的函数/trigger，`UPDATE SET payload=payload` 回填派生列，原 payload 不变；视图严格保持 100000 列序后追加两列，无新索引。同步沿用 `sellfoxNumber`，缺值NULL、非法输入拒绝同步；数据库 safe-number 投影对缺/空/非法/溢出返回NULL，保留0。
- browse、排序、可见列CSV/Excel及footer/totals读取类型列，实体与币种聚合使用 `COALESCE(sum(...),0)`；热路径不解析这两项 payload。两个利润导出入口的显式选列即使没有 layout 也进入 workbench。Agent英文日级长表末尾追加两项并支持排序，事实NULL仍为空、0仍为0，不从Listing补数。默认可见列、结算/币种/姓名隔离不变。
- `evaluationCapital` / `evaluationFee` / `evaluationCommission`、channel成本键、销量域对应字段、销售小组、业绩归属人、实时统计、运营及禁用维度均未解锁。123需要全部前置迁移（含50000 helper、80000、90000、100000）+110000，只有用户明确说「上」才另行评审发布。本轮没有 push、SSH、部署、真实库迁移/写入、Sellfox API/sync或计划启用。未来应用前评估全表回填锁/WAL/磁盘/维护窗口；未做真实P95 benchmark。应用回退保留加法schema和trigger，不自动删列或回滚数据库。

离线复验（不加载运行时 `.env`；Prisma仅用假地址，不执行 migrate deploy）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-{sync-recovery,workbench-read,agent-read,browse-query,browse-filters,browse-api,listing-identity,snapshot-sync}.test.ts
# 按文件直接运行也会打印每个测试用例的统计。
for test_file in tests/sellfox-{sync-recovery,workbench-read,agent-read,browse-query,browse-filters,browse-api,listing-identity,snapshot-sync}.test.ts; do NODE_ENV=test node --import tsx "$test_file" || exit 1; done
SELLFOX_P0_TEST_DATABASE_URL= SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-sales-profit-p0.ts
SELLFOX_P0_TEST_DATABASE_URL= SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-listings-read-model.ts
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node node_modules/prisma/build/index.js validate
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node node_modules/prisma/build/index.js generate
npm run typecheck
git diff --name-only HEAD -- '*.ts' '*.tsx' | xargs node node_modules/eslint/bin/eslint.js
git diff --check
```

预期：8个定向文件共152例通过；PGlite实际执行80000→90000→100000→110000，验证视图列序、回填、旧费用/姓名、INSERT/UPDATE/缺失/非法/0/非零channel=1、COALESCE、币种/结算隔离、排序及Agent空值；Listing及跨店一次性SQL夹具通过（补全它们跳过迁移时缺少的原三项费用和新数量列）。普通PostgreSQL入口未配置会SKIP，离线verifier独立PASS；TypeScript、改动TS ESLint、假地址Prisma validate/generate与diff check通过。未跑浏览器/生产构建/完整check/真实P95；本轮复用列与导出组件、无布局/依赖变更，以相关API/SQL和实际CSV/XLSX读写回归验收，发布前由CI及受控容量验收补齐。

本轮仅覆盖 `/sellfox?domain=sales` 和 `/sellfox?domain=performance`。不发布、不启用计划、不调用真实赛狐、不回填历史数据；后续部署目标是 `123.207.47.225`。

## 2026-10-26 销量品牌 / 产品标签 / 售价（仅 BOX 本地）

- 销量宽表新增默认隐藏的 `brand`「商品品牌」、`productTags`「产品标签」，位于标题之后；原默认隐藏 `price`「售价」保留位置并补充来源说明。三项均来自现有 `sellfox_listing_current` 类型投影，非销售日历史属性。`productTags` 直接复用已按名称排序、去重并以「、」连接的类型字符串，不解析 payload、不猜上游字段。
- 复用既有同组织/工作区/店铺的 MSKU 优先、ASIN 回退 Listing 选择。品牌/标签在日级与跨日实体级均要求所有成员非NULL且一致，否则显示空；售价沿用相同规则，不计入 footer/totals 求和。销量新增品牌/标签排序，保留售价排序；CSV/XLSX 跟随勾选列，无 layout 的显式选列导出也进入相同宽表路径。Agent 保留英文日级长表与原列序，末尾追加 brand/productTags/price，同样支持排序；仅 Agent 销量行查询补充一次 LATERAL Listing 查询，不扩展利润 UI。
- 趋势/均值保留原有默认隐藏列：仅取所选日期窗末尾7个完整销量日（dailyQuantity），有缺日/NULL则为空；不引入实时趋势 API，不使用 Listing sales7 冒充日趋势。继续灰显：销量业务员维度/筛选/列、实时统计、运营、业绩归属人、分类、销量洞察与 AWD；销量日快照只有 orderNum/productNum/salePrice，没有 userNameList。
- 无 schema/migration/依赖改动，不连接真实数据库、不调用 Sellfox API/同步、不推送或部署。依赖已有 Listing 类型投影；回退仅撤销本代码提交，无数据库回退。额外聚合和 Agent Listing 补充查询尚无真实容量/P95 benchmark，不宣称性能改善；后续发布另行授权并按真实规模验收。

验证通过：6个定向单测文件共125例（列/默认值、URL/排序、browse/API、CSV/XLSX、Agent、趋势缺日）；隔离 PGlite 实际执行生成 SQL，验证同值/冲突/缺值、跨日与日内聚合、售价0、排序分页/totals、租户及 MSKU 优先隔离、Agent 日级粒度。普通 PostgreSQL 测试未配置专用地址 SKIP，离线 verifier 独立 PASS；未连接持久库。TypeScript、全部改动 TS 的 ESLint 和 diff check 通过。

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-browse-query.test.ts tests/sellfox-agent-read.test.ts tests/sellfox-browse-filters.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listings-read.test.ts
NODE_ENV=test SELLFOX_P0_TEST_DATABASE_URL= SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-sales-profit-p0.ts
npm run typecheck
git diff --name-only -- '*.ts' '*.tsx' | xargs node node_modules/eslint/bin/eslint.js
git diff --check
```

本轮无新布局/构建链改动，按任务指定最小验证路线执行；未跑浏览器、全量check/生产构建或真实P95，后续发布前由CI及受控容量验收补齐。本轮未运行任何迁移到真实库；PGlite仅用既有迁移建立一次性测试夹具。

## 2026-10-26 利润可选费用补充（仅 BOX 本地）

- 销售利润追加三个默认隐藏的数字列：`headTripPrice`「头程」、`avgPurchaseCost`「采购成本」、`amazonCommissionPrice`「亚马逊佣金」。只读 performance payload 同名键的事实类型列；不取 Listing `headTripCost` / `purchaseCost` / `referralFee`。默认可见列、80000 五项费用和 90000 `userNameList`/业务员筛选保持原状。销售小组、业绩归属人、实时统计、利润 SPU 及销量业务员继续灰显。
- 加法迁移 `20261026100000_sellfox_product_daily_typed_fee_extras` 在 90000 后增加三个 nullable DOUBLE PRECISION；复用 `sellfox_listing_number(text)`，缺失/空/非法/溢出→NULL，保留0；替换原投影函数并保留 INSERT / UPDATE OF payload trigger 和姓名处理。一次 `UPDATE SET payload=payload` 回填派生列，原 payload 不变；`sellfox_profit_daily` 严格保留 90000 列序，末尾追加这三列。
- 同步提取沿用 `sellfoxNumber`（非法输入拒绝同步，缺值NULL）；browse、排序、CSV、利润 Excel、页脚和 Agent 读类型列。实体及按币种 totals 沿用其他费用的 `COALESCE(sum(...),0)`，全NULL显示0；`avgPurchaseCost` 同样沿用费用求和口径，不另做平均。Agent 英文长表末尾追加三项，不改既有列序。币种、onlySettle、业务员筛选均保留现有隔离语义。
- 本轮只在隔离 PGlite 执行迁移；无真实库、API、计划或服务器操作。未来发布前必须先审核/应用全部前置迁移（含50000 helper、80000、90000）；评估全表回填的锁、WAL、磁盘和维护窗口，未经真实 benchmark 不宣称 P95 改善。应用回退可保留加法 schema、原费用/姓名 trigger；不自动删列或回滚数据库。

本轮验证命令（业务测试不加载运行时 `.env`；Prisma 显式假地址覆盖配置）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-workbench-read.test.ts tests/sellfox-sync-recovery.test.ts tests/sellfox-agent-read.test.ts tests/sellfox-browse-query.test.ts tests/sellfox-browse-filters.test.ts tests/sellfox-browse-api.test.ts tests/sellfox-listing-identity.test.ts tests/sellfox-snapshot-sync.test.ts
SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-sales-profit-p0.ts
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node node_modules/prisma/build/index.js validate
DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture node node_modules/prisma/build/index.js generate
npm run typecheck
git diff --name-only -- '*.ts' '*.tsx' | xargs node node_modules/eslint/bin/eslint.js
git diff --check
```

定向回归覆盖列配置/默认列不变、URL/排序、数字CSV/XLSX、同步提取及写入、Agent；PGlite实际执行80000→90000→100000，验证视图列序、回填、payload不变、INSERT/UPDATE/清空、NULL/0/非法值、币种/结算/姓名筛选和聚合。普通 PostgreSQL 入口未配置时仍SKIP，离线 verifier 独立执行。未跑生产构建、完整 check、浏览器或全站E2E；本轮无布局/构建链改动，已有模拟browse/filter/API回归覆盖入口，发布前再由CI与受控真实容量验收补齐。

## 2026-10-26 业务员列与筛选（Owner: Chen Jieliang；仅 BOX 本地）

- 仅销售利润启用「业务员」单选筛选与默认隐藏的列。URL/API：`salesperson=温见清`（正常 URL 编码）。来源是利润 payload 的 `userNameList` 字符串数组，经 `SellfoxProductDailySnapshot.userNameList TEXT[]` 类型投影；不是 Listing `developer` / 开发员。缺键、非数组、空数组返回 `[]`；只保留去空格、非空、去重的字符串，不猜测人员身份。
- browse、Agent 与导出都在汇总前用 `s."userNameList" @> ARRAY[姓名]::text[]` 精确包含筛选；同一事实行多人命中时仍完整计入一次，不按姓名拆分或分摊。不同姓名分别查询的结果可能重叠，不能相加作为全员总计。不筛选时金额口径不变。姓名单独聚合去重，以「、」连接供表格/CSV/Excel 使用，不展开金额行。
- 业务员 facets 从当前组织/工作区/店铺/站点/日期/币种/结算口径内的利润事实行 `unnest(userNameList)` 去重；忽略当前姓名、品牌、标签和搜索选择，零结果时仍能切换其他姓名。无需新增同步表或调用 API。
- 「业务员」分组维度继续灰显：多人数组无独立业务员主键。销量快照没有该键，销量筛选/列继续灰显，提示「销量日快照无 userNameList；不从 Listing developer 伪造」。Listing/广告及销售小组保持原边界。
- 本地迁移 `20261026090000_sellfox_product_daily_user_name_list` 在 80000 后追加数组列、GIN 索引，替换现有投影函数并保留五项费用和同名 trigger；`UPDATE SET payload=payload` 只回填派生列，视图严格保留 80000 列序后追加 `userNameList`。未向任何真实库应用。123 仍需先补齐已有前置迁移（含 50000 的数字 helper 与 80000），仅在用户明确说「上」后另行评审/发布，不能仅发布代码。正式应用前评估全表回填/DDL 的锁、WAL、磁盘与运行窗口；无真实 P95 验证结论。
- 回滚应用到先前版本并保留加法 schema/索引/触发器；旧费用投影仍生效，不自动删列、回退数据库或重同步。未新增依赖/计划/worker/外部请求。

离线验证（不加载 `.env`、不使用 `DATABASE_URL`）：

```bash
NODE_ENV=test node --import tsx --test tests/sellfox-browse-api.test.ts tests/sellfox-browse-filters.test.ts tests/sellfox-browse-query.test.ts tests/sellfox-workbench-read.test.ts tests/sellfox-listing-identity.test.ts tests/sellfox-sync-recovery.test.ts tests/sellfox-agent-read.test.ts
SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-sales-profit-p0.ts
SELLFOX_TEST_PGLITE_MODULE=/tmp/sellfox-p0-tools/node_modules/@electric-sql/pglite/dist/index.js node --import tsx tests/integration/sellfox-listings-read-model.ts
npm run test:sellfox:browser -- --grep 'salesperson|store dimension'
npm run typecheck
git diff --name-only -- '*.ts' '*.tsx' | xargs node node_modules/eslint/bin/eslint.js
git diff --check
```

测试显式设置 `NODE_ENV=test`，避免 BOX 的 production 环境阻止本地模拟认证。API 回归同时覆盖带/不带 `layout` 的 browse、CSV、Excel、Agent；修正了原有四处要求 payload 解析的陈旧断言，继续断言类型投影。业务员筛选也会将不带 `layout` 的利润导出路由送入相同 workbench 路径，避免旧导出忽略筛选。

预期：单测通过；PGlite 打印 `PASS (disposable PGlite)`，验证实际 80000→90000 迁移、列序/原 payload/费用/GIN/触发器、包含筛选、facets、空数组、隔离与汇总；普通 PostgreSQL 测试未配置专用地址会显示 SKIP，但离线 verifier 已执行。浏览器 3 个用例通过，覆盖灰显维度/销量、姓名展示、URL/刷新/导出/重置；所有 API/图片由 fixture 拦截。Prisma validate/generate 使用 `postgresql://fixture:fixture@127.0.0.1:1/fixture` 假地址，仅校验/生成客户端，不执行迁移。未运行完整 check/生产构建/全站 E2E；发布前由 CI 补齐构建和生产容量验收。

## 2026-10-26 显示与日期稳定性修补（本地，覆盖下方历史显示说明）

- 两页的有效 `https://m.media-amazon.com` 主图渲染为可点击的28px缩略图；保留查询参数，点击打开原链接。复用原有严格 URL 校验，不放宽主机或协议。图片懒加载、异步解码、低优先级请求；缺图/非法 URL 显示 —，加载失败显示 — 并保留原图链接。销量来源仍为 Listing current，利润仍优先 Listing current、其次已有利润 imageUrl；不改变聚合中的缺图/冲突处理，不改 Listing/广告页显示。
- 仅利润的 `promotionDiscount` / `giftWrapFee` 在实体聚合和筛选 totals 使用 `COALESCE(sum(...),0)`：混有 null 仍累加已知费用，全 null 为0。其他指标与缺日继续保留 null，不跨币种或结算口径相加。真实0在行、KPI和导出显示0。
- 销量/利润首次空日期响应的有效 `dates` 回填到日期框和 URL（replaceState），随后仅复查一次明确日期，不循环。显式/单边日期、全部历史、其他域及迟到的旧工作区响应不触发回填。之后刷新、分页和导出使用固定业务日期；清空/重置日期才重新解析最近有数据日。
- 利润直接深链未指定币种时仍默认 USD；域间切换保留当前币种（含全部币种），不再强制改成 USD。URL 保存空币种，刷新口径一致。同步资源及空态统一称「销售利润」，页面 metadata 使用「销量统计 / 销售利润」。

验证：4个相关单测文件（图片校验、日期幂等/URL、费用 SQL、原 browse/date 回归）；隔离 PGlite 执行生成 SQL，覆盖混合/全 null 费用、分页 totals、币种及结算分区；5个隔离 Chrome 用例覆盖真实 img 加载、0/非0显示、缺图、日期回填次数、刷新及币种。类型检查与改动文件 ESLint 通过。Chrome 需沙箱外本地 socket，API/图片全部 fixture 拦截，不访问生产或真实赛狐。没有新增 migration、依赖、同步/worker变更；未运行生产构建、全站 E2E 或生产对账，后续发布由父任务验收。回滚只需撤销此代码提交，已部署数据库无需回滚；运行中的同步/队列不在本轮操作范围。

## 实现与口径

- 销量同步按店/日/MSKU 顺序请求 `productNum`、`salePrice`、`orderNum`，分别写入 `quantity`、`revenue`、可空 `orders`。同次采集才合并，换批次先清空其他指标；币种/ASIN 不一致拒绝合并。三组分页全部完成才发布当天 coverage。旧断点缺少 orderNum 时继续采集该指标；旧历史订单量保持 NULL，不拿销量代替订单量，不补零。订单量缺字段/null/空字符串也保留 NULL，非法数字拒绝。
- 浏览 `metric=orders` 支持宽表、日矩阵和导出，小计与 totals 使用订单量，日期窗有缺日时订单小计保留 NULL。近7日趋势/均值仍明确为销量；隐藏销量为0仍按 quantity 处理。
- 利润同步逐日分别请求 `onlySettle=false/true`。这表示请求的**统计口径**，不是某条 MSKU 的结算状态。唯一键增加 onlySettle，两套数不覆盖、不相加。日志 `progress.performance` / `progress.performanceSettled` 独立断点，result 记录 `onlySettleModes`。采集时间冻结；已结算口径完整采集后清理该店/日旧批次，完整空响应清空该口径，失败不清空。
- 利润勾选「只统计已结算」通过 URL/API `onlySettle=1` 读取已结算分区，列表、totals、CSV、Excel 与 Agent 导出一致；不勾选明确读取 false 分区。旧表现列表及 overview 计数仍读取 false，避免双倍计算。币种默认规则保持原状，可选全部币种。
- 主图来自同组织/工作区/店铺/MSKU 的 `sellfox_listing_current.mainImage`，不读 ProductRecord、不冒充历史图片。聚合有多个不同主图或缺图时不猜测，显示 —。复用现有图片列的安全 HTTPS CDN URL 链接，点击「图」打开；不预载原图。CSV/Excel 同列导出主图 URL。
- 表上方「关键指标汇总」只展示本次服务端筛选 totals，按币种分行；销量显示所选指标，利润显示毛利润、销售额、净销售额、订单量、销量和广告费。不使用本页行数重算，不跨币种换算；NULL 显示 —，真实0显示0。加载期间不展示上次 totals。

## 本地修补：身份解析与默认业务日

产品表现同步的 `text()` 按字段优先提取单对象或数组里的 ASIN/SKU/MSKU/父ASIN，空值及无法识别的嵌套对象返回空串，不再将对象写成 `[object Object]`。本次只修复后续同步；未添加或执行历史坏数据 SQL 修复脚本，已有坏行需另行审查 payload、sourceKey 和唯一键后维护。

销量/利润 UI 请求不再发送隐式 `reportDate=昨天`。浏览及对应导出由服务端在同组织/工作区、所选店铺/站点/币种（利润另按 onlySettle 分区）查找不晚于昨天的最近有数据的一天，使用一次仅选择日期的索引查询；昨天有数据时仍选昨天，整个范围无数据时保留昨天的空结果。搜索/隐藏零值不影响选日。显式 `from`、`to`、`reportDate` 和 `allDates=1` 均不回退，响应 `dates` 返回有效单日；库存默认今天及 Agent 长表读取口径保持原状。销量工作台的全部历史仍需显式选择最多90天的矩阵窗口。

本修补不改 schema、不运行迁移，不访问持久数据库。验证入口是 `tests/sellfox-report-date.test.ts`、`tests/sellfox-sync-recovery.test.ts` 及原有 browse/workbench/snapshot 单测，并执行类型检查和改动文件 ESLint。未实测真实 PostgreSQL 的查询 P95；后续发布前用实际数据确认日期索引查询耗时。回退可撤销本次代码提交，无数据库回滚步骤；已有坏数据不会被本次代码自动恢复。

本次修补验证：6 个相关测试文件共 36 个用例通过，TypeScript、改动文件 ESLint 和 `git diff --check` 通过。沙箱禁止 `tsx` CLI 的 IPC socket，改用逐文件 `node --import tsx tests/<文件>.test.ts` 执行；未运行生产构建、浏览器/全站 E2E 或真实数据库性能验收，准备合码/发布或做真实数据验收时再执行。

## 增量 migration 与后续发布注意

`prisma/migrations/20261026010000_sellfox_sales_profit_p0/migration.sql`：

1. 新增 `SellfoxSalesDailySnapshot.orders INTEGER NULL`；没有历史回填。
2. 新增 `SellfoxProductDailySnapshot.onlySettle BOOLEAN NOT NULL DEFAULT false`，历史行保持原口径。
3. 将利润唯一索引替换为 `(storeId, reportDate, sourceKey, onlySettle)`。
4. 在 sales/profit SQL 视图末尾追加新列，保留原列序。

未来发布需人工审核 migration、执行 migrate deploy 和 Prisma generate，并按 CI deployment-plan 更新 web / sellfox worker；本轮未对任何持久数据库执行迁移。迁移涉及索引重建，生产锁等待和索引耗时尚未实测，应在维护窗口按真实表规模审核。同步请求数：销量约为原来的1.5倍，利润约为原来的2倍；保留全局≥1200ms串行限速和≤90日任务窗口，计划不开启、不自动全量补数。

回退优先保留本版本分区过滤，撤回入口/停止新采集，数据库只向前修复。若必须回退到不认识 onlySettle 的旧应用，旧读代码会把两种口径混读；必须先停 worker，另行授权备份并隔离已结算分区，再评估旧唯一键兼容性。不能只换旧应用就宣称安全回滚，也不自动删列、删数据或回滚数据库。

## 可复现验证

使用与项目依赖兼容的 Node（本次使用临时 Node 24），先 `npm ci`、`npm run db:generate`。生成 client 需要 DATABASE_URL 字符串但不连接数据库。

```bash
# 本次选择相关域全部单测、全仓类型及lint；无生产访问。
node --import tsx --test tests/sellfox-*.test.ts
npm run typecheck
npm run lint
npx prisma validate
npm run test:sellfox:browser

# 可选：显式指定隔离的本地 PostgreSQL，临时 schema 全部回滚。
SELLFOX_P0_TEST_DATABASE_URL=postgresql://... node --import tsx --test tests/integration/sellfox-sales-profit-p0.ts
```

浏览器回归是独立模拟接口、真实 Tailwind，无账号、无外部网络。若缺 Playwright Chromium，可在本机安装后运行；本次使用 `/tmp` 的临时 Playwright 配置指定已有 `/opt/google/chrome/chrome`，产品/仓库配置未改。

本轮验证结果：16 个赛狐单测文件通过；16 个隔离浏览器用例通过。类型检查、lint（0错误，商品模块1条既有 hook warning）、Prisma validate/client generate 及临时 PGlite PostgreSQL 中实际 migration + 生成 SQL 回归通过（执行同一 `verifySellfoxP0Sql`，不连接项目 DATABASE_URL）。SQL 验证覆盖旧行 NULL/default、唯一键两口径共存、订单0/NULL/缺日、分页不影响 totals、多币种、精确搜索及主图的组织隔离。普通 PostgreSQL 集成入口未配置时明确 skip；PGlite 验证不能替代生产 PostgreSQL 的锁/并发/性能验收。

未运行生产构建和全站 E2E：本轮没有构建链/依赖版本变动，也不准备上线；准备合码/发布时再执行完整 `npm run check` 和部署验收。

## 手动验收与已知剩余差距

在已应用 migration 的**本地测试库**，配置本地测试凭据与 worker 后：

1. 对单店单日手动同步销量，检查日志三指标完成；打开 `?domain=sales&metric=orders&from=YYYY-MM-DD&to=YYYY-MM-DD`，切换指标、矩阵、分页、搜索，核对小计/KPI/CSV。旧未补采日期的订单量应为 —。
2. 对同范围同步利润，检查两种口径各自断点；打开 `?domain=performance&onlySettle=1&currency=&from=YYYY-MM-DD&to=YYYY-MM-DD`，切换复选框、币种，刷新URL，核对 KPI、CSV/Excel。没有采过已结算口径时是空结果，不回落全部利润。
3. 先同步完整 Listing current，在两页检查「图」链接、缺图 —、导出 URL。图片来自当前 Listing，与历史日期无关。

尚未做真实赛狐网页 vs 单店单日 API 数值对账、真实非空 orderNum/onlySettle 响应验收、生产数据迁移、123覆盖/Worker检查、P95 benchmark；这些需要后续显式运行授权。促销折扣、礼品包装费、实时统计、AWD、业务员/标签等继续灰态，属于后续P1/P2。本轮未改广告或选品业务。

## 本轮改动文件清单

- `AGENTS.md`
- `docs/sellfox-agent-read.md`
- `docs/sellfox-sales-profit-p0.md`
- `prisma/migrations/20261026010000_sellfox_sales_profit_p0/migration.sql`
- `prisma/schema.prisma`
- `src/app/api/sellfox/overview/route.ts`
- `src/components/sellfox/browse-filters.tsx`
- `src/components/sellfox/resource-table.tsx`
- `src/components/sellfox/sellfox-workbench.tsx`
- `src/components/sellfox/workbench-types.ts`
- `src/lib/sellfox/agent-read.ts`
- `src/lib/sellfox/browse-query.ts`
- `src/lib/sellfox/product-performance.ts`
- `src/lib/sellfox/snapshot-contracts.ts`
- `src/lib/sellfox/snapshot-sync.ts`
- `src/lib/sellfox/sync-requests.ts`
- `src/lib/sellfox/sync-service.ts`
- `src/lib/sellfox/workbench-read.ts`
- `src/lib/sellfox/workbench-view.ts`
- `tests/browser/sellfox.spec.ts`
- `tests/integration/sellfox-sales-profit-p0.ts`
- `tests/sellfox-browse-query.test.ts`
- `tests/sellfox-listing-identity.test.ts`
- `tests/sellfox-snapshot-sync.test.ts`
- `tests/sellfox-sync-recovery.test.ts`
- `tests/sellfox-sync-run.test.ts`
- `tests/sellfox-workbench-read.test.ts`
