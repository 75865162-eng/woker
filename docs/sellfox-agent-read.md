2026-10-27 Asia/Shanghai BOX 本地（Owner: Chen Jieliang；未部署）：listings Agent/CSV 窄表新增可选 `bsrRankMin` / `bsrRankMax`（安全整数）过滤；对类型列 `s."bsrRank"` 含首尾比较，设置任意一端排除 NULL；与 openDate/firstSaleDate/totalInventory 独立，不默认、不跨域、不发明 bsrCategory/AWD。配对/fee 仍锁定。无 push/deploy/真实库写入。
2026-10-27 Asia/Shanghai BOX 本地（Owner: Chen Jieliang；未部署）：ads `ratingCountMin`/`ratingCountMax` 仅 workbench 六子页对 Listing `ratingCount` 生效；显式 `agent=1` 广告英文长表导出与 brand/rating 一样 **不** 应用评论数筛选。listings/sales/performance Agent 忽略该参数。配对/fee 仍锁定。无 push/deploy/真实库写入。

2026-10-27 Asia/Shanghai BOX 本地（Owner: Chen Jieliang；未部署）：ads `ratingMin`/`ratingMax` 仅 workbench 六子页对 Listing `ratingValue` 生效；显式 `agent=1` 广告英文长表导出与 brand/fulfillment/Buy Box 一样 **不** 应用星级筛选（无 listing join）。listings/sales/performance Agent 忽略该参数。配对/fee 仍锁定。无 push/deploy/真实库写入。

# 赛狐本地读取约定
2026-10-27 Asia/Shanghai BOX 本地（Owner: Chen Jieliang；未部署）：listings Agent/CSV 窄表新增可选 `totalInventoryMin` / `totalInventoryMax`（安全整数）过滤；EXISTS 子查询对 `sellfox_inventory_current` 按 storeId+msku 汇总 totalInventory（与列「总库存」同口径）；与 openDate/firstSaleDate 独立，不默认、不跨域、不发明 AWD。配对/fee 仍锁定。无 push/deploy/真实库写入。

2026-10-27 Asia/Shanghai BOX 本地（Owner: Chen Jieliang；未部署）：listings Agent/CSV 窄表新增可选 `firstSaleFrom` / `firstSaleTo`（YYYY-MM-DD）含首尾过滤类型列 `firstSaleDate`；与 `from`/`to`→`openDate` 独立，不默认日期、不跨域。配对/fee 仍锁定。无 push/deploy/真实库写入。

2026-10-27 00:27:11 Asia/Shanghai BOX 本地 190000（Owner: Chen Jieliang；未部署）：`sellfox_profit_daily` 精确保留 180000 列序后追加 `evaluationCapital`「测评本金」、`evaluationCommission`「测评佣金」、`dealPerformanceFeeAmount`「Deal表现费」、`couponParticipationFeeAmount`「优惠券参与费」、`safetReimbursedAmount`「SAFE-T赔偿」、`affordabilityExpenseAmount`「可负担性费用」、`withheldFeeAmount`「预扣费用」、`chargebackIncomeAmount`「拒付收入」、`guaranteeClaimIncomeAmount`「A-Z索赔收入」、`promotionSalesAmount`「促销销售额」、`promotionShippingAmount`「促销运费」、`promotionTaxAmount`「促销税费」 的 nullable 类型列；Agent 英文长表同序末尾追加、可排序；performance 默认隐藏、sales 不变，明细 NULL 空/0 保留，聚合 COALESCE(sum)。evaluationCapital「测评本金」/evaluationCommission「测评佣金」分别独立于 evaluationFee「测评费」和 evaluationSaleNum（数量）；chargebackIncomeAmount「拒付收入」≠ chargebackAmount「拒付退款」，guaranteeClaimIncomeAmount「A-Z索赔收入」≠ guaranteeClaimAmount「A-Z索赔退款」；promotionSalesAmount「促销销售额」≠ promotionDiscount「促销折扣」≠ promotionTotalAmount「促销费」，亦独立于 promotionShippingAmount/promotionTaxAmount；withheldFeeAmount「预扣费用」≠ withheldTaxAmount「商城代扣税」。不映射 Listing fees。 **Fee mining wraps / pauses here**：本批为费用挖掘收尾；mfregulatory*、purchaseCost* splits 及无明确标签的 long-tail 继续锁定，等待 Sellfox web label verify 后另行授权。销售小组 / 业绩归属人 / 实时统计 / 运营 / 分类 / AWD / sales业务员 / 广告组合 / 否定 / AMC 仍锁定；sales 域不增加这些列。 仅 BOX 本地，Owner: Chen Jieliang；无 push/fetch、SSH/deploy/restart、123 迁移/真实库写入、live Sellfox API/sync 或计划启用。123 需全部前置迁移（含 180000）+ 190000，只有用户说「上」后另行评审。 离线验证与回填/回退见 [P0 文档顶部](sellfox-sales-profit-p0.md)。

2026-10-27 00:13:06 Asia/Shanghai BOX 本地 180000（Owner: Chen Jieliang；未部署）：`sellfox_profit_daily` 精确保留 170000 列序后追加 `fbaPerUnitFulfillmentFeeRefundAmount`「FBA按件履约费退款」、`fbaWeightBasedFeeRefundAmount`「FBA重量费退款」、`deferredAmount`「延期金额」、`withheldTaxAmount`「商城代扣税」、`otherPriceIncomeAmount`「其他收入」、`paymentMethodFeeAmount`「支付方式费」、`fixedClosingFeeAmount`「固定成交费」、`variableClosingFeeAmount`「可变成交费」、`imagingServicesFeeAmount`「影像服务费」、`netCoAmount`「净Co金额」、`comminglingVatAmount`「混卖VAT」、`codFeeAmount`「COD费用」 的 nullable 类型列；Agent 英文长表同序追加、可排序，performance 默认隐藏，sales 不变。明细 NULL 空、0 保留；聚合 COALESCE(sum)。FBA refund companions 不混作基础费用；Tl deferred/withheldTax 与 taxPrice 独立，otherPriceIncomeAmount ≠ otherPriceAmount ≠ orderOtherPriceAmount；Listing fees 不作别名，evaluationCapital/evaluationCommission 及灰显项仍锁定。123 需全部前置迁移 + 180000，仅用户说「上」后评审；无 push/deploy/真实库写入。离线复验及回填/回退见 [P0 文档顶部](sellfox-sales-profit-p0.md)。

2026-10-26 23:58:23 Asia/Shanghai BOX 本地增量（Owner: Chen Jieliang；未部署）：`sellfox_profit_daily` 精确保留 160000 列序后追加 `fbaInboundTransportationProgramFee`「FBA入库运输计划费」、`aglFeeAmount`「AGL费用」、`paidServicesFeeAmount`「付费服务费」、`customerReturnHrrUnitFeeAmount`「HRR退货单位费」、`amazonUpstreamStorageTransportationFeeAmount`「上游仓储运输费」、`amazonUpstreamProcessingFeeAmount`「上游处理费」、`mfnPostageFeeAmount`「MFN邮资」、`adjustmentFeeAmount`「调整费」、`otherServiceFeeAmount`「其他服务费」、`avgHeadTripPrice`「平均头程」、`purchaseRefundPrice`「订单内退款」、`revenueAmount`「清算费」 的 nullable 类型列；Agent 英文长表同序追加、可排序，performance 默认隐藏。明细 NULL 空、0 保留；实体/币种 COALESCE(sum)。avgHeadTripPrice ≠ headTripPrice，purchaseRefundPrice ≠ refundPrice，revenueAmount=清算费 ≠ saleRevenue/netRevenue；Listing fees 不作别名，sales 与锁定项不变。123 需全部前置迁移 + 170000，仅用户说「上」后评审；无 push/deploy/真实库写入。离线命令和回填/回退见 [P0 文档顶部](sellfox-sales-profit-p0.md)。

2026-10-26 23:41:49 Asia/Shanghai BOX 本地增量（Owner: Chen Jieliang；未部署）：`sellfox_profit_daily` 精确保留 150000 列序后追加 `couponPaymentAmount`「优惠券支付」、`sellerDealPaymentAmount`「Deal费用」、`vineFeeAmount`「Vine费用」、`starStorageFeeAmount`「星级仓储费」、`subscriptionAmount`「订阅费」、`fbaCustomerReturnAmount`「FBA买家退货费」、`fbaInboundConvenienceFeeAmount`「FBA入库配置费」、`inboundTransportationFeeAmount`「入库运输费」、`shippingChargebackAmount`「买家运费扣除」、`giftwrapChargebackAmount`「礼品包装费扣除」、`costOfPointsGrantedAmount`「积分费用」、`orderOtherPriceAmount`「订单其他费」 的 nullable 类型列；Agent 英文长表同序追加、可排序；performance 默认隐藏。明细 NULL 空、0 保留；实体/币种汇总 COALESCE(sum)。四组相近费用独立，不用 Listing fees 补值，sales 与锁定项不变。123 需全部前置迁移 + 160000，仅用户说「上」后评审；无 push/deploy/真实库写入。离线命令与回填/回退见 [P0 文档顶部](sellfox-sales-profit-p0.md)。

2026-10-26 23:29:44 Asia/Shanghai BOX 本地增量（Owner: Chen Jieliang；未部署）：`sellfox_profit_daily` 精确保留 140000 列序后追加 `promotionTotalAmount` / `fbaOverageFeeAmount` / `chargebackAmount` / `guaranteeClaimAmount` / `digitalServicesFeeAmount` / `otherPriceAmount` / `shippingChargeAmount` / `regulatoryFeeAmount` nullable 类型列；Agent 英文长表同序追加、可排序。对应促销费/FBA超量仓储费/拒付退款/A-Z索赔退款/数字服务费/其他费用/买家运费/监管费，performance 默认隐藏；明细 NULL 空、0 保留，工作台实体/币种 totals 用 `COALESCE(sum(...),0)`。promotionTotalAmount 与 promotionDiscount 独立，Listing fees 不作别名，sales 与原锁定项不变。123 需全部前置迁移 + 150000，仅用户说「上」后评审。回填成本、回退与离线复验见 [P0 文档顶部](sellfox-sales-profit-p0.md)。

2026-10-26 23:15:55 Asia/Shanghai BOX本地增量（Owner: Chen Jieliang；未部署）：`sellfox_profit_daily` 精确保留130000列序，末尾依次追加 `customAsinFee` / `customShopFee` / `serviceFeeAmount` / `storageFeeAmount` / `compensationAmount` / `evaluationFee` nullable类型列；Agent英文长表同序追加并支持排序。分别为产品自定义费用/店铺自定义费用/服务费/仓储费/赔偿金/测评费，performance默认隐藏，明细CSV NULL空、0保留，工作台实体/币种totals沿用 `COALESCE(sum(...),0)`。storageFeeAmount不同于fbaStorageFeeAmount；evaluationFee不同于evaluationSaleNum；不映射Listing费用，evaluationCapital/evaluationCommission及原锁定业务列保持锁定，sales不变。123需全部前置迁移+140000，仅用户说「上」后评审；回填成本/回退/离线验证见 [P0文档顶部](sellfox-sales-profit-p0.md)。

2026-10-26 BOX 本地增量（Owner: Chen Jieliang；未部署）：`sellfox_profit_daily` 精确保留120000列序，末尾追加 `fbaStorageFeeAmount` / `fbaLongTermStorageFeeAmount` / `fbaRemovalFeeAmount` / `fbaDisposalFeeAmount` nullable 类型列；Agent 英文长表按相同顺序追加并允许排序。分别为FBA仓储费/长期仓储费/FBA移除费/FBA弃置费，performance默认隐藏。明细CSV NULL空、0保留，工作台实体/币种totals为 `COALESCE(sum(...),0)`。只使用同名profit payload键，不映射Listing `fbaFees` / `referralFee`或商品「月仓储费」。sales及未证实业务列继续锁定；123需全部前置迁移+130000，用户说「上」后另行评审。回填成本/回退/离线验证命令见 [P0文档顶部](sellfox-sales-profit-p0.md)。

Agent/CLI 的例行任务只读 PostgreSQL 或 `/sellfox`「给 Agent 的导出」CSV，不调用 `openapi.sellfox.com`，也不依赖赛狐网页登录。ProductRecord 仍是商品主档，以下均为可重建的只读报表层，禁止反写主档或广告。

当前 P0 增量与本地验证见 [销量/利润 P0](sellfox-sales-profit-p0.md)。历史验收记录中的“两指标”描述保留当时口径；旧 coverage 不代表订单量已采集，orders 仍为 NULL。直接查询利润 SQL 视图时必须显式过滤 `"onlySettle"=false`（全部）或 `true`（已结算），API 默认 false。

2026-10-26 BOX 本地增量（未部署）：`sellfox_profit_daily` 在110000原列序后追加 `adSpCost` / `adSdCost` / `adSbCost` / `adSbvCost` / `adSbsCost` typed nullable 数值。performance 可选列分别为 SP/SD/SB/SBV/SBS广告费，默认隐藏；Agent 英文长表末尾追加且允许排序。明细 CSV 的 NULL 空、0 保留，工作台实体/币种汇总为 `COALESCE(sum(...),0)`。仅采用同名 profit payload 键，不从 Listing 或广告总额分摊。`adTotalCost → adCost` 已覆盖「广告花费」，不另建总计列、不重投影 adCost。123 需前置迁移 +120000，用户明确说「上」后另行评审；回填成本、验证与回退见上述 P0 文档。sales 及未证实业务字段继续锁定。


广告 Phase A/B 新增投放、搜索词、活动、广告组与广告位日报；严格暂定列、独立视图/唯一键、API/CSV 与默认关闭的每日06:30计划见 [广告子页来源与缺口](sellfox-ads-subtabs-gap.md)。尚未真实 XLSX 核验，历史广告产品验收不代表这五类通过。

## 读取入口

| PostgreSQL 视图 | 底层窄表 | 业务用途 |
| --- | --- | --- |
| `sellfox_inventory_current` | SellfoxFbaInventorySnapshot + SellfoxSnapshotHead | 每店最新完整库存采集；保留旧历史 |
| `sellfox_sales_daily` | SellfoxSalesDailySnapshot + 日覆盖标记 | MSKU 主维度，ASIN/SKU 冗余；quantity、revenue、currency、complete、orders（缺失NULL） |
| `sellfox_sales_day_coverage` | SellfoxSalesDayCoverage | 每店每自然日三指标已完整采集，包括合法空结果；rowWrites 是三指标写入次数，不是独立 SKU 数 |
| `sellfox_listing_current` | SellfoxListingSnapshot + SellfoxSnapshotHead | 每店最新完整 Listing，lower(status)=active 为在售（真实返回 Active/Inactive/Incomplete/delete，保留原值，筛选忽略大小写） |
| `sellfox_profit_daily` | SellfoxProductDailySnapshot | 单日 MSKU 利润、广告花费、退款率、订单和净销售额；必须筛选 onlySettle=false/true，禁止跨口径相加 |
| `sellfox_ads_product_daily` | SellfoxAdsProductDaily | 单店/日/广告类型/活动/组/产品的花费及转化；派生 acos、roas |

视图采用窄列投影；底层业务列、店铺和日期索引负责查询，不在常规查询时解码 payload。current 只在单店全部页提交后切换，合法空快照也切换；失败采集不会发布半批 current。快照 Head 的 storeId 关联店铺的 organization/workspace，跨工作区不得关联。

库存 sourceKey 使用响应 `id`，保留 ASIN/MSKU/FNSKU；不能只按 ASIN 去重后丢弃不同 MSKU/库位。Listing 使用响应 `id`，保留 MSKU/ASIN。日销使用店铺+MSKU+reportDate；同一任务三指标只在身份、币种与采集批次一致时合并。

历史MSKU日销真实响应允许 `skus:null`（未配对内部SKU），此时窄列sku保留空串、payload保留null，不从MSKU/ASIN推导SKU；shopIds、mskus仍必须是有效唯一身份，其他非法SKU数组仍拒绝。补货按精确MSKU关联，不按内部SKU缺失丢弃真实销量。

多店真实V2响应另验证：`delete`状态可有稳定id/ASIN而sku为空，Listing窄表msku允许NULL，payload保留原空值；这类记录不能参与在售MSKU补货JOIN。仅此已验证例外允许缺MSKU，在售/其他状态缺MSKU、任意记录缺id/ASIN或店铺不匹配仍拒绝整店发布。迁移 `20261025030000_allow_deleted_sellfox_listing_without_msku` 只DROP该快照列的NOT NULL，不改主档、不填造MSKU。回退应用前须处理旧版本对NULL的兼容，保留列与原数据，不自动恢复NOT NULL。

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

广告默认 SP adProductReport；POST sync 可用 `adTypes:["sp","sb","sd"]` 按需选择。SP/SB 真数据报告已验证；SD 已验证真实空报告表头，尚未验收非空数据。SP 的 asin/sku 与 SB/SD 的 ASIN/SKU 映射到同一窄列，payload 保留原始表头；同一报告出现大小写两套身份列时拒绝。所有报告仍须通过完整表头、店铺、日期、身份校验，否则拒绝落库。结构页不是本期主路径。任务创建前持久化创建意图；创建超时不自动重发。结果不明需管理员只读核对上游后，把确切 taskId 关联至原 SellfoxReportTask 再重试同一个 run；不得靠创建新 run 规避未知任务。已取得 taskId 的重试只查进度，下载文件由 storage adapter 管理。无下载URL、分片/域名/格式变化保持失败；不保存带签名的下载URL到日志。报告存储和快照不设自动清理。

## 一次性历史回填

维护命令默认只盘点本地覆盖，不请求赛狐或修改计划。必须显式绑定组织、工作区和仍有 sellfox:create 权限的操作者：

```bash
npm run sellfox:backfill-sales -- --organization-id=ORG --workspace-id=WORKSPACE --actor-user-id=USER --start-date=2025-11-01 --end-date=2026-10-24 --chunk-days=30
# 核对缺口和耗时后，追加 --apply 入队；不要省略日期后用跨天变化的默认值恢复批次。
```

默认分段7天，可指定1–90天；按单店连续缺日拆分，完整覆盖日不重复采集。同组织/工作区/起止日复用原批次，即使改了分段大小也不会另建任务。每段是现有SellfoxSyncRun，沿用分页检查点、执行租约、权限复核、失败按店/日继续和最多4次执行限制；重复同参数 `--apply` 只恢复queued任务入队，失败或已达上限的任务不自动重建。Redis不可用时入队可能部分完成，但DB任务保留，恢复命令及Worker检查可继续。

历史队列任务priority=10，普通手动/定时任务无priority（BullMQ优先处理），concurrency仍为1；正在执行的一段不被抢占。回填期间日销计划仍拉T-1，暂停额外计划历史段；批次结束后，计划从coverage查首个缺日，只越过已验证完整的日期，避免再次拉取整段冬季。

本机启动：`node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/sellfox-sync-worker.ts`。本轮后台进程PID记录在被Git忽略的 `tmp/sellfox-backfill-worker.pid`，日志在 `tmp/sellfox-backfill-worker.log`；只对该记录中的进程发送SIGTERM可暂停采集，数据库/Redis任务保留，重新启动同一Worker恢复。不要清空队列、删除SyncRun、重置重试次数或重复建批次。当前本机后台进程不是开机自启服务，关机/休眠/进程退出会暂停计划；恢复电脑后须重启Worker。启用本地计划不会更新生产systemd或服务器。

进度从数据库读取，无需调用Open API：

```sql
SELECT status, count(*) FROM "SellfoxSyncRun"
WHERE "organizationId" = $1 AND "workspaceId" = $2
  AND summary->>'backfillBatchKey' = $3
GROUP BY status;
-- 必须另查sales_day_coverage确认目标店/日完整；任务入队/运行中不等于回填完成。
```

## Round E：TK 覆盖监控与补货验收

TK 是店铺名，不是土耳其站；外部 shopId：US `124687`（ATVPDKIKX0DER）、CA `124688`（A2EUQ1WTGCTBG2）、MX `426997`（A1AM78C64UM0Y8）、BR `245097`（A2Q3Y263D00KWC）。策略绑定使用当前组织/工作区的本地 SellfoxStore.id，不能把 shopId 或 ProductRecord SKU 猜成绑定。ProductRecord 数量、空 Amazon*Snapshot 或任务 done 不证明单 MSKU 销量完整。

2026-10-25 本机抽样窗口 2025-11-01～2026-10-24：US/CA/BR 约完整61天、缺297天，MX约缺327天，原回填批次约61 done / 406 queued（动态采样，不是完成承诺）。继续使用上文原 batch key，不重建/reset 批次。只读查看批次状态和以下覆盖缺口；保存每次采样时间及 missing_days，随原队列完成应下降。失败段须核对原 run/断点，不靠新批次掩盖。

以下在已授权的本地 PostgreSQL **只读** psql 会话执行，替换 org/ws。改 shops 的 VALUES 可同时查看四店；目标 MSKU 完整性另查 daily，店铺 coverage 完整不能替代它。

```sql
\set org 'YOUR_ORGANIZATION_ID'
\set ws 'YOUR_WORKSPACE_ID'
BEGIN READ ONLY;
WITH shops(shop) AS (VALUES ('124687'), ('124688'), ('426997'), ('245097')),
expected AS (
  SELECT shop, to_char(d, 'YYYY-MM-DD') AS day
  FROM shops CROSS JOIN generate_series(DATE '2025-11-01', DATE '2026-10-24', INTERVAL '1 day') d
), missing AS (
  SELECT e.* FROM expected e
  WHERE NOT EXISTS (
    SELECT 1 FROM sellfox_sales_day_coverage c
    WHERE c."organizationId" = :'org' AND c."workspaceId" = :'ws'
      AND c."shopExternalId" = e.shop AND c."reportDate" = e.day
  )
)
SELECT shop, count(*) AS missing_days, min(day) AS first_missing,
       array_agg(day ORDER BY day) AS missing_dates
FROM missing GROUP BY shop ORDER BY shop;
-- 无行表示四店此窗口均覆盖；合法空店铺日也有 coverage，但不能推导 SKU 的零销量。
COMMIT;
```

补货真正使用的窗口是上海日期的 T-28～T-1，以下查询 TK-US 指定 MSKU 的缺日（内部 sku 空不应过滤）：

```sql
\set msku 'EXACT_MSKU'
BEGIN READ ONLY;
WITH expected AS (
  SELECT to_char(d, 'YYYY-MM-DD') AS day
  FROM generate_series((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date - 28,
                       (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date - 1, INTERVAL '1 day') d
)
SELECT e.day AS missing_or_invalid_day FROM expected e
WHERE (SELECT count(*) FROM sellfox_sales_daily s
       WHERE s."organizationId" = :'org' AND s."workspaceId" = :'ws'
         AND s."shopExternalId" = '124687' AND s.msku = :'msku'
         AND s."reportDate" = e.day AND s.complete = true
         AND s.quantity IS NOT NULL AND s.quantity >= 0) <> 1
ORDER BY e.day;
COMMIT;
```

有缺日则成熟品必须 NEEDS_DATA，不补0、不用利润 saleNum；无缺日且正日需求、周期完整、current 库存新鲜才可 READY。补货已绑定 Sellfox 的策略只读同店 `sellfox_inventory_current`，独立汇总精确 MSKU，避免与销量 JOIN 扇出；未知数值保持 NULL，空库存不回退 Amazon。结果及输入快照有 inventorySource，输入另有 storeId/shopExternalId/MSKU/capturedAt；无绑定的策略保留显式 Amazon 来源，详见经营中台补货短节。

本轮验证：上述两段 SQL 已在本地 `BEGIN READ ONLY` 事务执行并回滚；四店长窗缺日分别 US/CA/BR=297、MX=327，抽取的一个 TK-US 精确 MSKU 最近28日仍全部缺失，不能 READY。单测覆盖完整28日 READY、缺日/未完成日 NEEDS_DATA、空内部SKU、空MSKU与精确匹配、空current不回退Amazon；`check:fast` 261项测试及TypeScript通过，lint无错误（2条非本轮文件警告）。未修改批次、队列、计划或生产服务。

保持原 Worker 醒着：先用 `cat tmp/sellfox-backfill-worker.pid`、`ps -p <PID> -o pid,etime,command` 核对是本工作区的 sellfox-sync-worker，再用 `tail -n 50 tmp/sellfox-backfill-worker.log` 检查进展。已运行时不要再启第二个 Worker；macOS 可前台执行 `caffeinate -i -p <已核对的PID>` 防空闲休眠直至该进程退出（需接电，合盖/关机仍可能暂停）。仅确认原进程退出后，按上文相同 .env/Redis 启动同一 Worker 并记录新 PID，原数据库/Redis任务继续；恢复后先查原批次和 coverage，不重复 --apply、不清队列、不 reset。此轮只提供操作说明，不自动启用计划或改生产服务；406 段不要求本轮跑完。

## UI Round F

`/sellfox` 继续为只读镜像，不与经营中台合页；补货策略入口仍在 `/operations?tab=replenishment`。概览和补货深链使用 `workspaceId`、`domain=sales|inventory`、`shopExternalId`，选中MSKU时附 `dimension=msku&searchType=msku&exactMatch=1&search=...`。本工作区TK四店chip只更改筛选，未同步店铺禁用，不改列映射、计划或上游数据。

经营中台通过既有店铺/Listing current窄API选择本地SellfoxStore及MSKU；内部sku空不影响选择，空MSKU不提供为候选。下拉分页搜索，每页50条，不预载全量商品/payload；工作区或店铺切换会清除旧MSKU和覆盖预览，旧请求取消。销量预览只使用sales workbench的完整日dailyQuantity，缺日/NULL显示NEEDS_DATA和缺失日期；不引用利润saleNum，不以Listing滚动销量代替逐日完整性。完整日也不在前端宣布补货READY。最终建议展示worker记录的库存来源与missingInputs。

订单/未接广告仍禁用，tooltip统一「赛狐有、API/本地无」。经营中台策略归属店铺必须显式选真实active SellerAccount，不能用SellfoxStore.id代替；本轮只对补货GET增加已授权的窄店铺选项，保存及同步契约不变。浏览器回归使用真实Tailwind样式，核对TK筛选/深链、禁用tooltip及现有列/导出/紧凑布局；无服务器操作、无批次重建。

## 字段映射（真实响应2026-10-25核验）

| 赛狐列 | API key/报告表头 | 窄字段 |
| --- | --- | --- |
| FBA可售/总库存/在途 | available / totalInventory / inTransit | quantity / totalInventory / inTransit |
| 入仓/预留/不可售 | inboundWorking/Shipped/Receiving、reservedTransfer/Processing/Customerorders、unfulfillable | 同名；Customerorders 的实际 key 为 reservedCustomerorders |
| 仓库/品名/成本 | warehouseName / commodityName / avgInventoryCost / avgTransportCost | 同名，缺失NULL |
| 销量/销售额/订单量 | productSaleDayOpenVo[].day + productNum/salePrice/orderNum | reportDate + quantity/revenue/orders |
| Listing MSKU/内部SKU/状态 | sku / commoditySku / onlineStatus | msku / sku / status |
| Listing售价/可售 | standardPrice / inventoryManage.available | price / fulfillable（不使用quantity冒充FBA库存） |
| Listing DXM 发布状态（默认显示） | dxmPublishState | 类型投影 dxmPublishState，默认显示；仅展示去首尾空格的字符串原值，缺失/空串/非字符串为 NULL。用户提供的现存 payload 观察为 delete/空值，不解释为配对状态，不据此建立配对枚举 |
| 7/14/30天销量、销额、广告费 | day7/14/30SaleNum、day7/14/30SalePrice、day7/14/30AdTotalCost | sales7/14/30、revenue7/14/30、adSpend7/14/30 |
| 利润/毛利率/订单/净销售额 | profit / profitRate / orderNum / salesPriceNet | grossProfit / grossProfitRate / orderNum / netRevenue |
| 利润销量、销售额、广告费、退款率 | saleNum / salePrice / adTotalCost / refundPercent | saleQuantity / saleRevenue / adCost / refundRate |
| 广告日期及实体ID | 日期、广告活动ID、广告组ID、广告产品ID | reportDate、campaignId、adGroupId、productId |
| 广告ASIN/MSKU | SP: asin/sku；SB/SD: ASIN/SKU | asin/msku；空值保留NULL |
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

### 全改动区后续复核

本轮 Agent Round C 收尾已重新完成 `npm run check`（232项核心测试、ESLint、生产构建）、TypeScript、6项赛狐浏览器、3项Agent浏览器及Round B 9项fixture/7项临时库创建集成测试。新增附件测试另行2/2通过。`tmp/`已按Git忽略边界排除ESLint；目前仅保留商品工作台既有hook dependency warning。两条新增迁移在独立临时库执行成功，schema漂移与原基线相同；未修复历史漂移或操作生产。此记录更新上面的暂态全局检查阻碍；详细证据见 `specs/005-agent-chain-handoffs/validation.md`。

### SB/SD 追加验收（2026-10-25）

- 同一已验收店铺、2026-10-24 日报：SB 21行；SD 仅表头、0行。真实表头使用大写 ASIN/SKU，新增精确映射并拒绝大小写重复列；不放宽其他校验。SB 核心窄列与原始 payload 对账差异0，MSKU 缺失仍为NULL。
- 首次严格解析拒绝后，复用同一 run 的持久化原文件重试成功，没有重复创建任务。禁用 fetch 后，本地广告视图/CSV读取成功，共SP418行、SB21行；SD空报告完成记录保存在任务表，不伪造日报行。SD非空数据仍待验收。
- 窄列映射变更通过 `check:fast`（234项核心测试、lint、TypeScript）；本次无Prisma变更，不重复迁移/生产构建。
- 39店从2025-11-01至2026-10-24共有13,961个店/日缺完整覆盖，至少27,922次指标请求，按1200ms间隔至少9.3小时，另有响应、分页及重试时间。未启动全店补数，计划尚未配置，未发布服务器。
- 随后完成单店2025-11-01～11-07七天历史试采：14个指标请求、888次指标写入合并为444条店/MSKU/日记录，七日完整覆盖均已发布。证明上一冬季数据可读取，不代表已补齐全店长窗；试采后缺口为13,954个店/日。

### 全店回填与计划启动（2026-10-25，仍在执行）

用户随后明确授权“完成本地验收、冬季回填，并开启定时计划”。本地39店2025-11-01～2026-10-24缺口按30天分成468个持久化任务，批次key为 `5f39aa239993b36b531b41299987b5a4a775be1f79540d57013f0e450d8922b9`，已全部入队；重复同参运行未增加批次任务数。至少27,908次指标请求、9.3小时限流时间，实际还需响应/分页、定时采集和重试时间。尚不能标记全店回填完成。

已开启当前本地工作区inventory（180分钟）、sales/performance/listings/ads_report（每日06:30 Asia/Shanghai）5项计划；过点首次启动已生成各域补跑任务。广告计划默认SP，未擅自扩为所有广告类型。本机专用Worker在线，实测仅1任务active，日常任务在waiting，历史任务在prioritized；销售定时任务不带重复历史窗口。未启动stores/hourly计划，未修改生产服务器。

启动后首个单店2025-11-01～11-30分段已完成（1,682次指标写入），缺口从13,954降至13,924个店/日；随后执行库存定时任务，验证日常任务优先接续。该时点批次1段done、467段queued，属于进行中结果。回填规划、优先级识别、计划不重复补数及已覆盖游标测试通过；`check:fast`共250项测试、lint、TypeScript通过，仅保留原有商品工作台hook warning。无Prisma变更，未重复迁移或生产构建。

### 全店首轮定时采集闭环与契约修正（2026-10-25）

- 库存、日销、利润、Listing、SP广告日报5个定时run均完成39店。库存current共8,618行、39个完整Head（含一家合法空结果）；日销T-1覆盖39店、两指标共834次写入；利润T-1共2,045行；Listing完整采集12,094行；SP广告日报2,835行，另保留已验证的SB21行。
- Listing初次两店失败：一家上游业务码500，受控重读恢复；一家delete记录缺MSKU。只放宽已验证删除记录并将msku存NULL，增量迁移在临时表回滚验证后仅本地应用/登记，无生产操作。正常结束当前广告任务后重启单一Worker，原Listing run保留capture及已完成37店检查点，第二次执行成功，不另建全量任务。
- 库存可售/总库存、利润核心字段、Listing MSKU/售价/可售、广告花费/订单/销售额与各自payload SQL对账差异0；禁用网络后五域窄列/CSV单店读取成功，跨workspace查询0行。实际全店Listing超过10,000行时返回413，无截断CSV；请按店分段导出。日销保留一条旧批次complete=false记录，未伪造为完整。
- `check:fast` 251项测试、lint和TypeScript通过；Prisma validate/generate、隔离迁移与真实续跑成功。未运行新的全套构建/E2E。全店冬季回填仍在原468段批次继续，不能把首轮定时采集完成等同于长窗历史已补齐。

### 历史日销缺内部SKU与休眠恢复（2026-10-25）

- 真实历史单日日销两指标均返回一条有效MSKU/ASIN、`skus:null`记录；原严格数组校验拒绝整页。仅接受已验证null缺失，主键、日期、币种、数值检查不放宽；新增回归验证null主键、非法数组和跨店仍拒绝。
- 复用原失败run、capture和29个已完成日期；保留executionAttempts上限，从失败日期重试后第二次执行成功。SQL确认该行quantity=1、revenue=11.99 USD、sku空串、payload.skus为null、complete=true。没有另建批次或重置次数。
- macOS电源日志显示11:16～11:27反复数分钟休眠，与BullMQ续锁失败相符。两个受影响run在原断点第二次完成；一个Redis job仍显示stalled失败但对应数据库run已done，这是队列历史状态，不能据此重建已完成业务任务。当前单Worker继续串行回填，五项计划保持开启。
- 此次采样历史批次5段done、462段queued、1段running、0段failed；完整覆盖205个店/日（含先前试采及T-1），长窗仍未补齐。`check:fast` 252项测试、lint、TypeScript通过；无schema变更，不重复迁移、构建或E2E。后台进程未设置防休眠或开机自启，持续回填需电脑保持唤醒；定时计划仅在Worker运行时执行。

## /sellfox 只读排版与列映射（截图对齐）

四域复用连接顶栏 → 域Tab → 筛选区 → 结果表。维度/指标/日期/店铺/站点/搜索进入URL，列表请求300ms debounce；默认每页50实体。表头与左侧图片/身份列固定，指标和日列横向滚动。`workbench-types.ts` 的 `columns` 定义中文表头、赛狐列名、默认显隐与字段依赖；列设置按域保存在当前页面会话，CSV和销售利润Excel复用当前可见列及相同筛选，不受当前页限制，超过10,000实体明确拒绝。

浏览通过现有路由的 `layout=workbench` 只读分支；旧接口和 Agent窄表导出不变。`workbench-read.ts` 在本地PostgreSQL先按实体聚合再分页/透视，不读全量payload、不发Open API、不修改schema/同步Worker/ProductRecord。库存补充按当前页成员MSKU批量查询，不引入浏览器请求瀑布。普通CSV列名中文化；Agent CSV仍保持稳定英文窄字段及原始长表语义，不继承矩阵列/维度/快筛，不作为当前可见列导出的替代。

| 域 / 赛狐UI列 | 本地窄字段 / 计算 | 来源及限制 |
| --- | --- | --- |
| 销量：ASIN / 父ASIN / MSKU / SKU | identity；日表asin/msku/sku，父ASIN按store+MSKU关联Listing current | 以MSKU日表本地汇总；父体为当前Listing关系，不是历史父体报表；缺映射保留原MSKU，不造父ASIN。SPU/店铺/人员维度未同步而灰显 |
| 销量：日列 / 小计 | quantity或revenue → day:YYYY-MM-DD / subtotal | 日期升序，最多90天；complete=false或指标缺失的日单元格留空；缺日不补0。小计是存在记录的已知日合计，存在无效记录时整体未知，不能作完整长窗。全部历史仍用Agent长表导出 |
| 销量：订单量 / 实时统计 | 无 | 订单指标灰显；实时只在赛狐网页 |
| 销量：店铺站点 / MSKU售价 / 品名SKU / 标题 | name/marketplace、msku、Listing.price、sku、Listing.title | 多MSKU实体不展示任意成员MSKU；价格/父体/标题有歧义时留空，不取最便宜商品冒充整组 |
| 销量：FBA可售 / 总库存 / 快照时间 | inventory_current.quantity / totalInventory / capturedAt | 按成员MSKU汇总最新完整快照，不代表销售日库存；成员缺库存时未知。底栏库存/7日均明确为本页，销量/金额为筛选合计 |
| 销量：近7天趋势 / 均值 | 窗口末7个业务日quantity / sum÷7 | 必须7日均有有效日销量才显示；不将缺日补零 |
| 利润：毛利润 / 毛利率 / 净销售额毛利率 | grossProfit / sum(grossProfit)÷sum(saleRevenue) / sum(grossProfit)÷sum(netRevenue) | 按店铺+维度+币种汇总；分母≤0或金额缺失留空，日利率不平均 |
| 利润：销售额 / 净销售额 / 订单量 / 销量 / 广告花费 | saleRevenue / netRevenue / orderNum / saleQuantity / adCost | 保留API原金额正负号；默认USD，可选全部并分别合计；完整档另有fbaQuantity/fbmQuantity |
| 利润：退款率 / 父ASIN | refundRate / parentAsin | 单条已同步记录保留退款率；跨日/多条聚合无可靠分母时留空。只统计已结算、自定义费用/加权灰显 |
| Listing：状态 / ASIN / MSKU / 父ASIN / 品名SKU / 价格 | status / asin / msku / parentAsin / sku / price | 只读最新完整current；Active/Inactive/delete/incomplete忽略大小写。父体资源未验证而灰显 |
| Listing：7/14/30销量 / 销售额 / 广告花费 | sales7/14/30、revenue7/14/30、adSpend7/14/30 | API滚动快照原值，缺失不填零，不跨日相加 |
| Listing：可售 / 更新时间 | fulfillable / sourceUpdatedAt，另列capturedAt | 可售保留Listing自身已验证inventoryManage.available，不被补充库存覆盖。发货方式见下方 AFN/MFN 口径；调价、打印、标签、配对仍灰显 |
| 广告产品：曝光 / 点击 / 花费 / 订单 / 销售额 | impressions / clicks / cost / adOrders / adSales | 按店铺+币种+SP/SB/SD+campaign/adGroup/product聚合日期窗；活动/组只有ID，不伪造名称 |
| 广告：ACoS / ROAS | sum(cost)÷sum(adSales) / sum(adSales)÷sum(cost) | 行及底栏均重算；无有效分母留空。报告没有币种时仍标未知，禁止推断USD |
| 广告：有效 / 服务状态 / 投放中 / 已暂停 | 无广告结构状态 | 未知灰态，不能把未知当关闭；仅广告产品Tab有数据，其他Tab标待接；有花费/有点击无订单按本地汇总筛选 |
| 非Listing图片 / AWD库存与在途 / 业务员 / 标签 / 星级评论 / 促销与礼品等费用 | 当前浏览窄字段无相应映射 | 图片占位；其他默认隐藏或灰列，tooltip「赛狐有、API/本地无」，不猜payload字段或抓网页补值；Listing图片/FNSKU/父SKU见Round G |

汇总详情抽屉保留既有按需展开原始摘要入口，原始摘要取代表行的原快照，并不是区间聚合payload。库存与元信息来自current，不能解释为历史快照；表底金额/广告指标为整个筛选结果，分币种。缺失任一成员指标时不以其余成员拼造完整合计。只读UI没有新增广告/商品写接口。

验证：4项新增无数据库回归覆盖查询参数白名单、日期窗、绑定参数/租户边界和可见列CSV安全；浏览器覆盖维度/指标/隐藏零、状态与广告快筛、列设置、未知字段和灰态操作、汇总比率、工作区迟到响应及窄屏固定列。另在本机独立事务临时表内验证多MSKU透视、null与真实0、跨币种和跨workspace，ROLLBACK清理；禁用fetch后四域真实本地读取成功，不以模拟浏览器替代真实API字段校验。此UI变更无迁移、无生产发布，不默认运行全套构建/E2E。

本轮结果（2026-10-25）：`check:fast` 258项核心测试、lint、TypeScript通过（保留已有商品编辑器hook warning）；10项Sellfox浏览器通过，另对最终四域1440px截图与760px横向滚动做定向复验。真实单店离线查询验证销量/利润各4维度；当前可见列CSV导出59实体成功，跨workspace为0行。未执行新的生产构建、全仓E2E、迁移或服务器发布。

### 截图读法补齐（2026-10-25）

- 搜索类型为白名单：ASIN/MSKU/SKU/父ASIN/标题；广告另支持活动/组ID。精确匹配忽略大小写但按字面相等（%/_不是通配）；模糊匹配保持原contains口径。切域清除搜索类型，重置清除筛选并回第一页，保留列选择。
- 每页20/50/100/200条，带页码与跳转；筛选仍300ms debounce。日矩阵在表内按列汇总、分币种；任一筛选实体缺该日/该值则该日合计为未知，库存及7日均仅为本页合计并明示。
- 广告「有花费无点击」=区间cost>0且clicks=0；「无点击」=区间clicks=0，未知clicks不算0；不伪造筛选数量。投放/暂停仍无结构数据而灰显。
- Listing在售绿色、其他状态灰色；负毛利润绿色。AWD悬停列出可售/预留/小计，当前均未知，不填零。
- Listing工具条只启用现有受权限限制的同步；广告批量工具与其它网页操作全部disabled。网页才有的筛选明确标注未同步字段。

验证补充：`check:fast` 259项测试、lint与TypeScript通过（仅已有商品组件hook warning），11项Sellfox浏览器通过；最终筛选位置调整后定向3项浏览器及TypeScript再次通过。禁用fetch的四域真实本地查询、事务临时表的逐日合计/缺日/分币种/精确搜索验证通过并ROLLBACK。

### 四图布局收口

- 沿用工作台顶栏和域Tab；业务维度改为下划线Tab，销量/利润默认ASIN（显式URL维度保留）。主筛按紧凑横排自动换行，店铺多选折叠为弹出列表；日期快捷集中在日期区间旁。指标使用销量/订单量/销售额分段按钮，订单量无本地字段而禁用。
- 结果紧接工具条；读取口径折叠到表后，来源说明仍可展开。无数据的筛选为灰态下拉，与灰态网页操作分开；Listing状态与同步保留，广告结构树缺数据则不显示。
- 销量默认列：图片、维度身份、店铺/站点、总库存、灰态AWD库存/在途、7日趋势、均值、小计、升序业务日矩阵（含星期）。父体/MSKU/售价/SKU/标题/FBA可售/库存时间等通过自定义列保留。
- 利润标题/维度身份合并；Listing ASIN/MSKU合并；广告缩略占位/标题/ASIN合并。其余身份字段可在列设置单独打开；中文表头和英文field key分离。复合单元格的CSV/XLSX使用相同可见字段，以换行组合，不额外导出隐藏字段或payload。
- 固定身份列、表头与底部汇总；分页保持表外固定。金额合计显示币种，禁止跨币种相加；库存/均值标明仅本页。Listing/广告勾选为纯本页UI选择，筛选/翻页/工作区刷新后清空，没有批量写入路径。
- 截图回归使用每域20行模拟样本与7日日矩阵，验证默认列顺序、紧凑筛选高度、720px固定身份列和页面无横向溢出；模拟数据仅供布局验证，不能解释为真实经营数值。

布局收口验证：`check:fast` 260项测试、lint和TypeScript通过（保留已有商品组件hook warning）；12项Sellfox浏览器测试通过，涵盖四域20行/7日样本与720px布局。禁用fetch后真实本地四域CSV与利润XLSX导出通过，复合字段和默认可见列一致；没有运行生产构建、全仓E2E、迁移或服务器发布。

操作区补齐：四域在≥640px视口固定右侧操作列（表头/行/汇总一致），横滑后仍可打开详情；更窄视口保留左侧身份固定，操作列随表滚动以避免两侧重叠。实时统计/只统计已结算为未勾选的disabled复选框并说明缺失来源；Listing工具顺序为配对、自动配对、同步、调价等，仅既有同步可用。浏览器断言覆盖操作列位置、横滑后详情可达、灰态复选框与工具顺序，四域360px页面无横向溢出定向验证通过；260核心测试、lint、TypeScript和12项浏览器测试通过。

悬停明细补齐：AWD库存通过独立只读提示卡展示AWD可售/预留/小计；当前全部为未知，不使用同名payload键或将缺失填0。提示卡在表格滚动容器外定位，支持悬停、键盘聚焦、触屏点击、Escape及滚动/窗口变化关闭，点击卡片不打开记录详情。业务日表头和缺失日单元格补日期提示。自定义列在<640px使用视口内底部面板，并支持Escape关闭、焦点回到入口；桌面保留右侧下拉。`check:fast` 260项测试、lint和TypeScript通过（仅保留已有商品组件warning），13项浏览器测试通过，新增未知AWD明细、键盘/滚动关闭和360px列面板边界断言；仍无API/模型/写入改动。

## 生产启用检查（独立主机与数据库）

生产计划必须在目标主机自己的组织/工作区启用。本地计划、其他服务器的 Worker 与数据库不作为生产验收。发布前核对当前 RELEASE.json commit；通过 CI/CD 的 target_host 显式选择旧主机 159.75.203.221 或新主机 123.207.47.225，base_sha 必须属于该主机。已有发布不使用 initial_deployment，不运行管理员 seed。涉及迁移/部署须审核并设置 deployment_reviewed；锁文件变更才授权 install_dependencies。

旧主机升级 Compose 前检查 POSTGRES_DB/POSTGRES_USER/POSTGRES_PASSWORD 是否存在；缺失时只能从当前运行的 PostgreSQL 容器配置补入相同值，验证与 DATABASE_URL 一致，不重置密码、不输出值。Caddy 保留 aecob.com 和两个 IP 入口，不修改 DNS。生产 Worker 使用发布内的 systemd 单元与服务器 .env：systemctl enable --now amazon-sellfox-sync-worker。

验收 schedules API 的 configured、queueEnabled、worker.online，以及 inventory/sales/performance/listings/ads_report 的 enabled/nextRunAt；stores/hourly 不启用，广告保留 SP。等原有30秒调度 tick，记录 trigger=schedule 的成功 run。销量默认从上一完整冬季11月1日起每天补7天，串行限流可能持续十几分钟以上。回滚先关闭五项计划，必要时停专用 Worker；应用失败沿 release 回滚，不 down migration、不清快照。

### aecob.com 生产启用验收 · 2026-10-25

- 目标为旧主机 `159.75.203.221`，组织 `cmu16envk0000h8va9y84ukev` / 工作区 `default`；不涉及新主机数据库。CI run `40163449096` 成功，应用 commit `11f4f4dd4a89565b7fac03e221ad60f27a8ae723`，artifact SHA256 `7275a8bbeba92961b530d08e9209edf64d6e670417196a628eb6129e8a6767c8`。RELEASE-RESULT 显示 health/migration passed，服务 active，数据库未回滚。
- 专用 Worker enabled/active，NRestarts=0；GET schedules 的 configured/queueEnabled/worker.online 均 true，设置→运维页面确认在线。五项计划通过正式 API 开启；stores/hourly 未启用，广告维持默认 SP，销量 backfillStart=2025-11-01。
- 初始工作区无店铺，先通过正式 sync API 手动只读采集39店，run `sellfox-sync-99bcbb44-c553-4277-a722-ef8e42402168` done。五项 schedule 于北京时间13:04:51 自动入队。
- 库存 run `sellfox-sync-4537345d-812d-4cd7-909e-807070be5473`，summary.trigger=schedule，status=done，error=null，完成时间北京时间13:08:20；39店、8621条快照。验收时销量running，performance/listings/ads_report queued，尚不代表其已完成。库存下次为当日16:04:51，其余次日06:30。
- 本地 check:fast 260项测试、lint和类型检查通过（既有商品Hook警告保留）；最新布局的13项浏览器测试见前述记录。CI 完成测试/lint/build/产物验证与受控迁移，不在本机或服务器构建。全流程未输出.env值、未对赛狐商品/广告写回；日志无持续报错。


### 同步 Round G：TK-US Listing 三字段

已确认并本地应用增量迁移 `20261025040000_sellfox_listing_identity_image`：Listing V2 `fnsku`、`parentSku`、`mainImage` 提升至同名可空窄列及 `sellfox_listing_current`，沿用原worker分页/完整current发布契约。只取消Listing对应灰列；主图仅提供已验证HTTPS域名的按需链接，不预加载图片；其余域图片及未接字段仍为「赛狐有、API/本地无」。空值为NULL，不推导身份或补0。

TK-US单次run `sellfox-sync-round-g-listing-tk-us-20261025` 已done；UTC捕获 `2026-10-25T15:38:57.848Z`，523行，FNSKU/父SKU/有效主图非空518/399/503。原468条销量回填run的ID集合未变，其他店current未变，计划未开启/修改。Listing是current字段覆盖，不能代替日销complete或自然日覆盖。完整域×字段×接口状态矩阵、只读SQL、验证限制和回滚说明见 [Round G记录](sellfox-round-g.md)。本轮仅本地修改，无提交/推送/服务器发布；生产需先迁移再加载新worker代码，旧常驻worker不会自动获得新字段映射。


### 发货方式筛选（2026-10-26，本地待部署）

销量、销售利润及在线商品支持 `fulfillment=AFN|MFN`，省略表示全部；UI 选项为「全部 / AFN / MFN」，重置会清空。来源仅为最新完整 `sellfox_listing_current` 所指向的 `SellfoxListingSnapshot.payload.switchFulfillmentTo`，不读取或推测日销 payload 的发货字段。空值、未知值和未匹配 Listing 的事实行仅留在全部，不计入 AFN/MFN 子集；在线商品可选「发货方式」列默认隐藏，未知显示空值。

Listing 按同组织/工作区/店铺的快照 ID 精确关联。销量/利润沿用主图的同组织/工作区/店铺 Listing 匹配：优先精确 MSKU，再回退 ASIN；按 MSKU、ASIN、快照 ID 稳定选一条，再判断发货方式，禁止先筛候选造成兄弟 Listing 替代。筛选在成员行进入日/实体/店铺/开发员/SPU 汇总前应用，分页总数、KPI 和导出使用相同子集；销售利润未新增 SPU。此属性是当前状态，不代表历史销售日的配送方式。

普通 CSV/XLSX 使用 workbench 导出路径；显式传 fulfillment 而未传 layout 的请求也使用此路径。`agent=1` 保留原英文窄列长表与 10,000 行上限，按相同 Listing 匹配筛选，分页 count 与读取复用谓词；不新增 fulfillment 窄表字段或修改 SQL view。未选筛选时不新增 Agent 关联；workbench 复用已有 Listing 关联。真实库 P95 尚未测量，部署后需在 123 验证筛选/汇总/空结果/导出一致性及查询耗时。本地验证为查询参数、SQL 结构和模拟 API 回归，不替代真实数据库执行或 UI 验收。

本次不修改 schema、migration、sync 或 worker；回滚撤销本次应用代码即可，无数据回滚。业务员及其他未验证能力继续灰显；产品标签筛选见下节。


### Buy Box 筛选（2026-10-26，本地待部署）

销量、销售利润和在线商品支持 `buyBox=yes|no`，省略或空值表示全部，其他参数值按全部处理；UI 与发货方式并列，选项「全部 / 是 / 否」，重置会清空。只匹配 current Listing 快照 `payload.buyBoxWinner` 的 JSONB boolean true/false；字符串、null、缺失字段和未匹配 Listing 仅保留在全部。现有 Buy Box 列及 CSV 的「是/否」显示保持不变。

匹配边界与发货方式一致：同组织/工作区/店铺，在线商品按快照 ID；销量/利润先按 MSKU 优先、ASIN 回退稳定选定一条 Listing，再判断 Buy Box。成员筛选在日/实体/KPI 汇总前应用，分页和 CSV/XLSX/Agent 导出保持同一子集，未带 layout 的显式筛选同样生效。Workbench 复用已有 Listing 关联和 boolean→是/否 CASE，Agent 用同一候选的 boolean→yes/no 标量子查询；不先过滤候选，不改销售利润 shippingPrice 等费用口径。

无需 schema、migration 或 worker 变更；回滚撤销应用代码即可，不涉及数据回滚。验证按 `tests/sellfox-{browse-query,browse-filters,workbench-read,agent-read,browse-api}.test.ts` 展开文件，逐个运行 `node --import tsx <测试文件>`（避免 tsx CLI 在沙箱创建 IPC），共 85 项通过；`npm run typecheck`、改动文件 ESLint 和 `git diff --check` 通过。未运行 Chromium、生产构建或真实数据库/P95 验证。业务员、AWD、运营及销量洞察继续保持原有不可用状态。

### 产品标签筛选（2026-10-26，本地待部署）

在线商品、销量、销售利润支持 `productTag=<标签完整名称>`；参数去首尾空格，空值表示全部，无固定标签白名单，重置会清空。来源仅为同组织/工作区/店铺的 current Listing payload `productLabelList[].labelDetailList[].labelName`，不是历史报表日标签；缺失或非数组按空列表处理。Workbench 仅在选择标签时用嵌套 JSON 数组上的 `EXISTS` 对 `btrim(labelName)` 做参数化等值匹配，不构建标签数组、不拆分展示用「、」、不做子串 LIKE；Agent 窄表导出保留原精确数组成员匹配。原在线商品 productTags 列直接用 `string_agg(DISTINCT ... ORDER BY ...)` 按「、」连接非空名称，空列表仍显示空值。

销量/利润沿用发货方式和主图的 Listing 稳定匹配：先选精确 MSKU、再回退 ASIN 的一条候选，之后匹配标签，禁止先过滤候选而改选兄弟 Listing。成员行在日/实体/KPI 汇总前筛选，分页、总数和 CSV/XLSX/Agent 导出使用同一口径；未带 layout 的显式 productTag 请求也应用筛选。广告、业务员、AWD、运营等能力不在本次范围。

browse 同一 SQL 响应附带 `facets.productTags`：独立子查询从 scoped `sellfox_listing_current` 和 `SellfoxListingSnapshot` 提取非空 `btrim(labelName)`，按当前组织/工作区及店铺/站点范围去重并排序，不引用主 Listing CTE、不构建每行标签数组，不受分页、所选标签、搜索或 Listing 状态影响。未选择标签的销量/利润主 Listing CTE 不解析标签列表；在线商品仍保留展示字符串。UI 使用动态选项与「全部」，并保留 URL 当前标签以便显示空结果和重置；切换工作区清空旧选项，迟到响应沿用已有取消/epoch 防护。无新增逐行请求；导出不计算 facets，未选标签的销量/利润导出不解析标签列表。

无 schema、migration、sync、worker 或数据写入；回滚本次应用代码即可。验证选用相关单元/模拟 API/组件元素树测试、TypeScript、相关 ESLint 与 diff 检查；未运行 Chromium、生产构建或真实数据库查询/P95。动态 facets 会在 browse 查询中读取当前范围 Listing 标签，真实库查询耗时及页面交互应在后续明确部署验收时验证。本次仅本地交付，不推送或发布。


### 品牌筛选（2026-10-26，本地待部署）

在线商品、销量、销售利润支持 `brand=<品牌完整名称>`，与产品标签并列。参数仅去首尾空格；按当前 Listing `btrim(payload.brand)` 参数化等值匹配，空/null 品牌只计入「全部」，不使用其他品牌字段。销量/利润先按原有 MSKU 优先、ASIN 回退选定当前 Listing，再于成员行汇总前筛选；分页、KPI 与 CSV/XLSX/Agent 导出使用相同口径，带或不带 layout 均生效。在线商品品牌列同步去首尾空格，空字符串仍为 null。

browse 保留 `facets.productTags`，并在同一 SQL 响应新增 `facets.brands`：独立子查询从当前组织/工作区及店铺/站点范围 Listing 提取去空、去重、排序后的品牌，不受已选品牌、标签、搜索或状态影响；导出不计算 facets。UI 动态选项保留 URL 当前品牌，重置清空品牌，切工作区/导航时清空旧选项，复用已有迟到响应防护。广告和其他未接入控件保持原状。

无 schema、migration、同步或 worker 改动；回滚应用代码即可。验证使用 browse-query、browse-filters、workbench-read、agent-read、browse-api 及 Listing 身份测试，另运行 TypeScript、相关 ESLint 与 `git diff --check`；不运行 Chromium、生产构建或真实库查询。品牌 facets 增加一次同 SQL 内 scoped Listing 扫描，真实库 P95 留待明确部署验收时评估。本次仅本地交付，不推送或发布。

`/sellfox` 表格共用表头排序：点击带双向箭头的列按升序/降序切换，活动列显示方向及 `aria-sort`，换列回到升序并重置第 1 页；`sortBy` / `sortOrder=asc|desc` 保存在 URL，筛选、翻页、刷新及导出沿用。API 按域白名单校验，非法列/方向返回 400；SQL/Prisma 在完整筛选结果（工作台先聚合）上排序后再分页，同值按 ID 稳定排序，未指定排序时维持旧顺序。店铺、库存 current/历史、销量、利润、Listing 和六类广告日报均复用此路径；小时报表 API 也支持排序，页面不新增小时数据入口。图片、分析、缺失/未接列、日矩阵列、趋势/均值、进度以及分页后才补充的库存字段不提供排序，避免把当前页排序冒充全量排序。SQL 的空值排末；Prisma 保持数据库默认空值次序。回滚此功能可撤销对应提交，不涉及数据迁移；本地验证用 `npx tsx --test tests/sellfox-*.test.ts`、`npm run typecheck` 和 `npm run test:sellfox:browser`（隔离模拟接口，不访问生产）。Agent 窄列导出链接保留原始长表默认次序，不携带工作台聚合排序。尚未进行真实数据库大数据量排序性能 benchmark。


### DXM 发布状态精确筛选（2026-10-27，BOX LOCAL ONLY）

仅 listings 支持 `dxmPublishState=<完整原值>`，沿 brand 的 trim/精确匹配模式，对 current view 类型列 `s."dxmPublishState"` 参数化 `=`；列表行、count、workbench CSV/XLSX 和 `agent=1` 窄表导出同口径。空参数不加谓词，NULL 仅属于「全部」；sales / performance / inventory / ads 忽略该参数。listings browse 的 `facets.dxmPublishStates` 为 scope-only 非 NULL DISTINCT 排序值，不随行筛选缩小；UI 仅用 facets 加 URL 当前值，无固定枚举。**DXM 发布状态 ≠ 配对状态**，配对状态 `missingFilter` 继续锁定。

无 schema/migration、默认列、数据写入、sync/worker 或生产改动；Fee-mining 仍暂停，不 push/deploy/SSH，回滚本片应用代码即可。定向单元/SQL/模拟 API 新增用例、TypeScript、相关 ESLint 和 diff 检查通过；browse-filters 仍有既有广告默认列陈旧断言失败，Chromium 启动 SIGTRAP，未绕过；命令、范围及浏览器补验见 [listings 本地交付记录](sellfox-listings-read-model.md#2026-10-27--listings-dxm-发布状态精确筛选与-facets--box-local-only)。
