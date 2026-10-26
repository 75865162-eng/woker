# 赛狐销量统计 / 销售利润 P0（本地交付）

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
