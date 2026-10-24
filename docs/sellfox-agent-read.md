# 赛狐本地读取约定

Agent/CLI 的例行任务只读 PostgreSQL 或 `/sellfox`「给 Agent 的导出」CSV，不调用 `openapi.sellfox.com`，也不依赖赛狐网页登录。ProductRecord 仍是商品主档，以下均为可重建的只读报表层，禁止反写主档或广告。

## 读取入口

| PostgreSQL 视图 | 底层窄表 | 业务用途 |
| --- | --- | --- |
| `sellfox_inventory_current` | SellfoxFbaInventorySnapshot + SellfoxSnapshotHead | 每店最新完整库存采集；保留旧历史 |
| `sellfox_sales_daily` | SellfoxSalesDailySnapshot + 日覆盖标记 | MSKU 主维度，ASIN/SKU 冗余；quantity、revenue、currency、complete |
| `sellfox_sales_day_coverage` | SellfoxSalesDayCoverage | 每店每自然日两指标已完整采集，包括合法空结果；rowWrites 是两指标写入次数，不是独立 SKU 数 |
| `sellfox_listing_current` | SellfoxListingSnapshot + SellfoxSnapshotHead | 每店最新完整 Listing，lower(status)=active 为在售（真实返回 Active/Inactive/Incomplete/delete，保留原值，筛选忽略大小写） |
| `sellfox_profit_daily` | SellfoxProductDailySnapshot | 单日 MSKU 利润、广告花费、退款率、订单和净销售额 |
| `sellfox_ads_product_daily` | SellfoxAdsProductDaily | 单店/日/广告类型/活动/组/产品的花费及转化；派生 acos、roas |

视图采用窄列投影；底层业务列、店铺和日期索引负责查询，不在常规查询时解码 payload。current 只在单店全部页提交后切换，合法空快照也切换；失败采集不会发布半批 current。快照 Head 的 storeId 关联店铺的 organization/workspace，跨工作区不得关联。

库存 sourceKey 使用响应 `id`，保留 ASIN/MSKU/FNSKU；不能只按 ASIN 去重后丢弃不同 MSKU/库位。Listing 使用响应 `id`，保留 MSKU/ASIN。日销使用店铺+MSKU+reportDate；同一任务两指标只在身份、币种与采集批次一致时合并。

`NULL` 是未知，不是零。缺日不是零销量；日销只有 `complete=true` 且必要数值非空才可消费。覆盖表用于识别合法空日，但不能据空店铺日推断某个 SKU 当时在售或销量为零；补货长窗缺日/缺周期必须 NEEDS_DATA。历史旧行在重新完整采集前可能 complete=false。不要填零凑满冬季历史。

库存总库存/可售/预留/在途互有业务关系，不相加冒充总库存。币种不同不直接混算。Listing 的近7/14/30天字段是 API 的滚动窗口快照，不能再跨天求和。profitRate/refundRate 不得按日相加或简单平均。广告报告没有币种列，currency 保留 NULL，不能从店铺站点猜币种。

## 本地查询

每次必须带 organizationId + workspaceId + shopExternalIds + 日期范围；先查权限，再查询数据库，SQL 视图自身不是权限边界。使用只读事务/受控 CLI 身份，不向不可信 Agent 提供数据库写权限。

```sql
SELECT "shopExternalId", msku, asin, "reportDate", quantity, revenue, currency, complete
FROM sellfox_sales_daily
WHERE "organizationId" = $1 AND "workspaceId" = $2
  AND "shopExternalId" = ANY($3::text[])
  AND "reportDate" BETWEEN $4 AND $5
ORDER BY "shopExternalId", msku, "reportDate";
```

```ts
// 在现有认证/工作区与店铺授权校验后调用；不要 select payload。
const rows = await prisma.sellfoxSalesDailySnapshot.findMany({
  where: { organizationId, workspaceId, SellfoxStore: { externalId: { in: shopExternalIds } },
    reportDate: { gte: from, lte: to } },
  select: { storeId: true, msku: true, asin: true, reportDate: true,
    quantity: true, revenue: true, currency: true, syncedAt: true },
  orderBy: [{ reportDate: "asc" }, { id: "asc" }], take: 1000,
});
// 另查 SellfoxSalesDayCoverage 校验日期与 capturedAt=行 syncedAt；或直接使用 sales_daily 视图 complete。
```

补货输入：按同组织/工作区/店铺/MSKU，把 inventory_current、sales_daily 长窗和 listing_current（lower(status)='active'）组合；先分别汇总成目标粒度再 JOIN，防止多库存 sourceKey × 多销售日 × 多 Listing 产生扇出重复。验证身份唯一及完整性后再计算需求，缺真实货件时保留 shipments 未接入。

广告输入：ads_product_daily。示例查询明确列 `reportDate, adType, campaignId, adGroupId, productId, impressions, clicks, cost, adOrders, adSales, acos, roas`，过滤同上。ACoS 为 cost/adSales（比率，零分母 NULL）；ROAS 为 adSales/cost。缺订单/销售额/预算任一必要字段时禁止生成暂停或降预算建议；当前日报无预算列，因此不具备预算动作建议的完整输入。Search term、货件和广告预算结构属于后续范围。

CSV：`GET /api/sellfox/{inventory|sales|listings|performance|ads_report}/export?agent=1&workspaceId=...&shopExternalId=...&from=...&to=...`，沿用 sellfox:export 权限，最大10,000行，超限返回413，不截断。current 导出始终是最新完整批次，日期过滤只适用于日表；库存历史可用原普通导出。UI 日期选择回看库存历史，Listing 固定 current 并支持状态筛选。英文 CSV 表头是视图字段名，不含 payload。

## 同步与调度

复用 sellfoxPost 和全局≥1200ms串行限流、专用 sync queue、租约 fencing；失败按店继续并保留 cursor。所有计划默认关闭，由 `/sellfox` 或 schedules API 显式启用。inventory 每180分钟；sales/performance/listings/ads_report 每日06:30 Asia/Shanghai。sales/performance/ads_report 默认 T-1，库存/Listing 只能采集当前状态。

销量计划首次启用时，默认补数起点为上一完整冬季的11月1日（2026-10-25 对应2025-11-01），可通过 UI 或 POST schedules 的 backfillStart 修改。持久化 backfillNextDate，每日优先 T-1，再处理默认7天历史；只有整个 run 成功才推进游标。失败重试复用已完成的店/日/指标断点。`SELLFOX_BACKFILL_DAYS_PER_RUN` 可配置1–90，单任务历史段不超过90日；不会自动删除历史。调大批次显著增加队列耗时，39店×7天×2指标至少546次请求（不含分页），仅限流间隔已约11分钟。补数与定时开关按工作区隔离。

广告默认 SP adProductReport；POST sync 可用 `adTypes:["sp","sb","sd"]` 按需选择。SP 真报告已验证，SB/SD 在报告返回时须通过同样的完整表头、店铺、日期、身份校验，否则拒绝落库，不能宣称已验收。结构页不是本期主路径。任务创建前持久化创建意图；创建超时不自动重发。结果不明需管理员只读核对上游后，把确切 taskId 关联至原 SellfoxReportTask 再重试同一个 run；不得靠创建新 run 规避未知任务。已取得 taskId 的重试只查进度，下载文件由 storage adapter 管理。无下载URL、分片/域名/格式变化保持失败；不保存带签名的下载URL到日志。报告存储和快照不设自动清理。

## 字段映射（真实响应2026-10-25核验）

| 赛狐列 | API key/报告表头 | 窄字段 |
| --- | --- | --- |
| FBA可售/总库存/在途 | available / totalInventory / inTransit | quantity / totalInventory / inTransit |
| 入仓/预留/不可售 | inboundWorking/Shipped/Receiving、reservedTransfer/Processing/Customerorders、unfulfillable | 同名；Customerorders 的实际 key 为 reservedCustomerorders |
| 仓库/品名/成本 | warehouseName / commodityName / avgInventoryCost / avgTransportCost | 同名，缺失NULL |
| 销量/销售额 | productSaleDayOpenVo[].day + productNum/salePrice | reportDate + quantity/revenue |
| Listing MSKU/内部SKU/状态 | sku / commoditySku / onlineStatus | msku / sku / status |
| Listing售价/可售 | standardPrice / inventoryManage.available | price / fulfillable（不使用quantity冒充FBA库存） |
| 7/14/30天销量、销额、广告费 | day7/14/30SaleNum、day7/14/30SalePrice、day7/14/30AdTotalCost | sales7/14/30、revenue7/14/30、adSpend7/14/30 |
| 利润/毛利率/订单/净销售额 | profit / profitRate / orderNum / salesPriceNet | grossProfit / grossProfitRate / orderNum / netRevenue |
| 利润销量、销售额、广告费、退款率 | saleNum / salePrice / adTotalCost / refundPercent | saleQuantity / saleRevenue / adCost / refundRate |
| 广告日期及实体ID | 日期、广告活动ID、广告组ID、广告产品ID | reportDate、campaignId、adGroupId、productId |
| 曝光/点击/花费/转化 | 广告曝光量、广告点击量、广告花费、广告订单量、广告销售额 | impressions、clicks、cost、adOrders、adSales |

## 迁移与回滚

迁移 `20261025020000_sellfox_agent_read_models` 增量新增窄列、快照Head、Listing、广告日报/任务、日销覆盖及6个SQL视图；利润缺失值改为NULL，并从既有payload回填已验证列，修正历史对象型ASIN/SKU。不会修改ProductRecord。当前工作区已有租约迁移 `20261025010000_add_sellfox_run_lease` 是同步入口前置。新计划不自动启用，服务器部署不在本任务范围。

回滚先关闭计划并停止赛狐Worker，回退应用；保留新增表/视图和报告原文件，不 down migration、不回滚数据库或清理主档。旧应用对利润NULL的兼容需核验后回退；本轮已确保当前展示和导出支持NULL。服务器以后须走既有CI artifact流程并审核迁移，不重复执行本地源码构建。

## 本轮验收记录（2026-10-25）

- 单店真实采集并落库：库存 current 790行、MSKU 日销43行、Listing current 861行、单日利润173行、SP广告产品日报418行。广告报告复用了探测时创建的 taskId，不重复创建。未对赛狐做广告/商品业务写回。
- 将网络 fetch 禁用后，以上5类SQL读取和CSV生成均成功；库存/Listing/广告核心窄列与原始响应逐行核对差异0。已有其他店历史日销未伪造覆盖标记，仍可明确看到 complete=false。
- 53项赛狐相关测试、6项隔离浏览器回归通过；Prisma validate/generate与隔离schema迁移通过。本机仅应用并登记租约前置和本轮窄表迁移，未执行其他历史分支迁移、未reset数据库。
- check:fast 的232项测试通过；全局lint因已忽略的本地 `tmp/create-kayak-sku.ts:75` 原有any错误停止。另行完成TypeScript及本轮文件ESLint；生产构建/完整check未运行。补货长窗全店补数、SB/SD真实报告和真实浏览器登录后的网页逐项对账未执行。
- 所有计划仍关闭；未改服务器、未发布、不自动回填全店冬季历史。本机旧Amazon分支迁移历史差异不属于此次任务，未做重置或自动修复。
- 全改动区GitHub同步盘点期间，本机node_modules出现pnpm安装树变化；随后附加的全局ESLint因依赖配置加载失败，选品额外测试因当前Playwright浏览器缺失而失败。此环境变化发生在上述成功验证之后；不据此宣称当前运行环境全套校验通过。未为本任务改写依赖版本或全局lint配置。
