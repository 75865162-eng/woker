# Sellfox listings 列表延迟整改（2026-10-26）

范围：只改本地 ERP listings 读路径；未连接生产、未发布、未推送、未启用计划，也没有新增 Sellfox API 调用。ProductRecord、销量/利润报表聚合不变。

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
