# 赛狐销量统计 / 销售利润 P0（本地交付）

本轮仅覆盖 `/sellfox?domain=sales` 和 `/sellfox?domain=performance`。不发布、不启用计划、不调用真实赛狐、不回填历史数据；后续部署目标是 `123.207.47.225`。

## 实现与口径

- 销量同步按店/日/MSKU 顺序请求 `productNum`、`salePrice`、`orderNum`，分别写入 `quantity`、`revenue`、可空 `orders`。同次采集才合并，换批次先清空其他指标；币种/ASIN 不一致拒绝合并。三组分页全部完成才发布当天 coverage。旧断点缺少 orderNum 时继续采集该指标；旧历史订单量保持 NULL，不拿销量代替订单量，不补零。订单量缺字段/null/空字符串也保留 NULL，非法数字拒绝。
- 浏览 `metric=orders` 支持宽表、日矩阵和导出，小计与 totals 使用订单量，日期窗有缺日时订单小计保留 NULL。近7日趋势/均值仍明确为销量；隐藏销量为0仍按 quantity 处理。
- 利润同步逐日分别请求 `onlySettle=false/true`。这表示请求的**统计口径**，不是某条 MSKU 的结算状态。唯一键增加 onlySettle，两套数不覆盖、不相加。日志 `progress.performance` / `progress.performanceSettled` 独立断点，result 记录 `onlySettleModes`。采集时间冻结；已结算口径完整采集后清理该店/日旧批次，完整空响应清空该口径，失败不清空。
- 利润勾选「只统计已结算」通过 URL/API `onlySettle=1` 读取已结算分区，列表、totals、CSV、Excel 与 Agent 导出一致；不勾选明确读取 false 分区。旧表现列表及 overview 计数仍读取 false，避免双倍计算。币种默认规则保持原状，可选全部币种。
- 主图来自同组织/工作区/店铺/MSKU 的 `sellfox_listing_current.mainImage`，不读 ProductRecord、不冒充历史图片。聚合有多个不同主图或缺图时不猜测，显示 —。复用现有图片列的安全 HTTPS CDN URL 链接，点击「图」打开；不预载原图。CSV/Excel 同列导出主图 URL。
- 表上方「关键指标汇总」只展示本次服务端筛选 totals，按币种分行；销量显示所选指标，利润显示毛利润、销售额、净销售额、订单量、销量和广告费。不使用本页行数重算，不跨币种换算；NULL 显示 —，真实0显示0。加载期间不展示上次 totals。

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
