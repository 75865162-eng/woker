# Round G：TK-US Listing 窄字段扩量

权威边界仍为 [sellfox-agent-read.md](sellfox-agent-read.md)。本轮不包含 UI Round F、经营中台布局或选品改动，不创建 PR，不提交/推送已有混合工作区。

## 范围与证据

目标店铺 TK店-US，外部 shopId `124687`，Marketplace `ATVPDKIKX0DER`。2026-10-25 本地只读盘点：当前完整 Listing 523 条，payload 中非空 FNSKU 518 条、父SKU 399 条、有效 HTTPS 主图URL 503 条；主图均为 `m.media-amazon.com`。这三项已经存在于上游原始 payload，但尚未提升到窄列，不能称为此前完全没有入库。

用户已确认这三项及增量迁移。下面 SYNC 为已有读取或本轮已落地项目；本轮仅刷新 TK-US，其他店旧快照新增列仍为 NULL，不能视为字段全店覆盖。

## 域 × 字段清单

| 域 | 字段 | 本地表/列或约定 | 来源接口 / 原始字段 | 状态与边界 |
| --- | --- | --- | --- | --- |
| Listing（本轮P0） | FNSKU | SellfoxListingSnapshot：fnsku；原 payload.fnsku 已有 | `/api/order/api/product/v2/pageList.json` → fnsku | SYNC；518/523非空，不从MSKU推导 |
| Listing（本轮P0） | 父SKU | SellfoxListingSnapshot：parentSku；原 payload.parentSku 已有 | 同上 → parentSku | SYNC；399/523非空，无值保持NULL |
| Listing（本轮P0） | 主图URL | SellfoxListingSnapshot：mainImage；原 payload.mainImage 已有 | 同上 → mainImage | SYNC；503/523有效HTTPS，仅保留已验证Amazon图片域名；不下载二进制 |
| Listing（既有） | MSKU/ASIN/内部SKU/父ASIN、标题、状态、价格/币种 | SellfoxListingSnapshot：msku/asin/sku/parentAsin/title/status/price/currency | 同上 → sku/asin/commoditySku/parentAsin/title/onlineStatus/standardPrice/currency | SYNC 已有；不扩大删除记录缺MSKU例外 |
| Listing（既有） | 7/14/30天销量、销额、广告费、可售 | 同表 sales7/14/30、revenue7/14/30、adSpend7/14/30、fulfillable | 同上 → day7/14/30*、inventoryManage.available | SYNC 已有；滚动快照不能充当逐日日销或净订单 |
| Listing | 产品标签、业务员、负责人、发货方式 | payload可能保留labels/devList/switchFulfillmentTo等，未有已确认消费契约 | 上述接口存在相关原始key，但身份/字典/枚举语义尚未逐项验证 | GRAY；本轮不按key名猜映射 |
| Listing/广告 | 星级/评论数 | payload.rating/ratingCount，窄读尚无 | Listing V2有原始key，广告产品归属/读取规则未收口 | GRAY；不扩展广告域 |
| 库存（既有） | 可售、总库存、在途、入仓、预留、不可售、FNSKU、成本 | SellfoxFbaInventorySnapshot 的既有窄列 | 既有库存sync请求/verified mapping，详见权威文档 | SYNC 已有；不与Listing库存混加 |
| 库存 | 库龄/健康度/最低库存/超量预估 | payload.ageDto/invAge*/fbaInventoryLevelHealthStatus等 | 既有库存原始响应有key，单位/重叠分桶/业务口径未收口 | GRAY；不把重叠库龄相加，不扩大本轮P0 |
| 销量（既有） | 每日MSKU销量/销额/币种及完整性 | SellfoxSalesDailySnapshot + SellfoxSalesDayCoverage → sellfox_sales_daily | 既有productNum/salePrice双指标日销接口 | SYNC 已有；原冬季回填继续，缺日不补0，complete必须校验 |
| 利润（既有） | 毛利/净销售额/报表订单等 | SellfoxProductDailySnapshot既有窄列 | 既有产品表现接口 | SYNC 已有；报表orderNum不是订单明细，saleNum不替代补货日销 |
| 广告（既有） | SP产品日报曝光/点击/花费/归因转化 | SellfoxAdsProductDaily | 既有SP adProductReport | SYNC 已有；currency NULL保持未知，本轮不扩SB/SD |
| 广告 | 活动启停/服务状态/预算/Search term | 无已验收本地窄契约 | 缺本轮可执行的官方/抓包证据 | BLOCKED；保持「赛狐有、API/本地无」，禁止apply或预算建议 |
| AWD/货件/订单明细 | AWD库存/在途、货件ETA、真实订单量 | 无本轮可用同步模型/证据 | 未核验 | BLOCKED；不推导、不填0、不新增同步 |

## 验收与运行边界

- 本轮只提升Listing三项字段；不新增数据域、计划、全店采集或冬季批次，不删除/reset原有run。
- current只在原Listing分页/身份/事务检查全部通过后发布，失败保留原current；NULL不是0。合法空Listing结果不构造商品行或字段覆盖，消费侧仍为缺数据，不因此宣布补货READY。
- Listing是当前快照，没有历史自然日完整性；行数/字段非空数/捕获时间与日销coverage天数分别查询，不伪装成历史覆盖。
- 已验证解析/缺失值、原处理器保存/重试/失败保留current、Agent/可见列CSV一致性、临时schema增量迁移与事务回滚。新增浏览器用例验证字段取消灰态、NULL/NEEDS_DATA、其余灰列及无图片预加载。
- 本地已原子执行且登记 `20261025040000_sellfox_listing_identity_image` 的精确 SHA256；仅本迁移，无 reset/db push。旧应用回滚时保留可空列和快照，不自动drop或恢复数据库。生产部署未执行；将来按正常迁移链先加列再运行新应用/Listing worker。


## 本地执行结果（2026-10-25）

- 原处理器单次 run：`sellfox-sync-round-g-listing-tk-us-20261025`，done，executionAttempts=1，仅 `shopExternalIds=["124687"]`。复核有效权限后沿用 scope 锁、lease、分页断点与全局限流；新代码单次调用 `processSellfoxSyncRun`，未启动第二个常驻worker，未重启正在回填的旧worker。
- 新 current 捕获时间 `2026-10-25T15:38:57.848Z`（UTC）：523行，FNSKU非空518、父SKU非空399、有效主图503；其余分别5/124/20行保持NULL。没有下载图片二进制，列表以「图」链接按需打开。
- 前后原销量回填run总数均468，排序ID集合MD5均 `5d412ab5a50e2560bc2defbcc55007cf`；其他店Listing current时间/行数/新增列计数均未改变。计划未修改；旧回填worker继续运行。该旧进程未加载新字段代码，其他店字段覆盖须在后续获准更新worker后逐店正常刷新，不能声称本轮已全店扩量。
- 禁用fetch后，真实本地Agent/workbench均读523行并复核518/399/503；两种CSV含真实字段，跨workspace为0行。仅读取窄列，不从payload临时拼出界面值。

### 查询条数与字段覆盖（只读）

将参数绑定为当前组织、工作区及124687；不要省略租户范围：

```sql
SELECT "shopExternalId", count(*) AS rows,
       count(fnsku) AS fnsku_rows, count("parentSku") AS parent_sku_rows,
       count("mainImage") AS image_rows, max("capturedAt") AS captured_at
FROM sellfox_listing_current
WHERE "organizationId"=$1 AND "workspaceId"=$2 AND "shopExternalId"=$3
GROUP BY "shopExternalId";

SELECT id,status,"executionAttempts","startedAt","finishedAt"
FROM "SellfoxSyncRun"
WHERE "organizationId"=$1 AND "workspaceId"=$2
  AND id='sellfox-sync-round-g-listing-tk-us-20261025';
```

Listing没有逐日覆盖天数；销量目标窗缺日继续按权威文档「Round E」的 `sellfox_sales_day_coverage` 查询，缺日不填0。本轮不重建回填或开启日程。已有普通/Agent导出路径均可加 `workspaceId=default&shopExternalId=124687`；界面父SKU/FNSKU沿原默认隐藏位置，通过自定义列启用，主图只在有效URL时提供链接。

### 验证与变更范围

数据库无关测试：`npx tsx --test tests/sellfox-listing-identity.test.ts tests/sellfox-agent-read.test.ts`。
临时库迁移：`node --env-file=.env node_modules/tsx/dist/cli.mjs tests/integration/sellfox-listing-identity-migration.ts`（事务内建临时schema，结束ROLLBACK）。
本轮浏览器：`npx playwright test --config tests/browser/sellfox-listing-identity.config.ts`。

本轮变更仅：Prisma schema及040000增量迁移；`src/lib/sellfox/{listing-identity-fields,narrow-contracts,agent-read}.ts`；`src/components/sellfox/{workbench-types,resource-table}.tsx/ts` 的Listing三字段映射/展示；上述单测、迁移测试与独立浏览器测试；本页与权威文档短节。共享文件内并行UI改动不归本轮，不提交或推送混合工作区。

实现初次 `check:fast` 269测试/lint/TypeScript通过（已有商品hook warning）；随后并行UI任务修改四域布局和矩阵默认值，既有workbench-read两项断言及Sellfox浏览器布局断言出现不一致。本轮不回退或改写并行UI；最终本轮专项12项单测、1项浏览器、临时库迁移、真实窄读及TypeScript通过；既有Sellfox浏览器回归为7通过/7失败，workbench-read为4通过/2失败。完整回归尚不能据初次结果宣称最终工作区全绿。未运行生产构建/全仓E2E，需在独立合码或发布前补完整检查。
