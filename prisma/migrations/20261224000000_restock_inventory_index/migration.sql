-- 补货建议页 30 秒加载根因治理：库存快照聚合查询缺少覆盖索引。
-- readSellfoxRestock 的 latest CTE 按 (storeId, reportDate) 求 MAX(capturedAt)，
-- 外层再按 msku IN(...) 聚合 30 天，原计划对 94 万行表做 Bitmap Heap Scan + 落盘排序。
-- 本覆盖索引让 CTE 与外层都可走 index-only scan，实测 inventory 查询 17.3s → 8.6s。
-- 注：生产环境已用 CREATE INDEX CONCURRENTLY 在线创建同名索引；此处声明以保证
-- 全新部署/其它环境一致。IF NOT EXISTS 使已存在索引时幂等通过。
CREATE INDEX IF NOT EXISTS "SellfoxFbaInventory_orgws_store_date_captured_idx"
  ON "SellfoxFbaInventorySnapshot" ("organizationId", "workspaceId", "storeId", "reportDate", "capturedAt" DESC)
  INCLUDE (msku, quantity);

-- 读缓存数据版本查询对所有 workbench/restock 域执行 max(versionColumn) WHERE org+ws。
-- 库存表 94 万行若无此索引会走 Parallel Seq Scan（实测 6461ms），拖慢每一次缓存命中。
-- 该索引让 max(capturedAt) 走 Index Only Scan（实测 0.147ms），缓存命中稳定在个位数毫秒。
CREATE INDEX IF NOT EXISTS "SellfoxFbaInventory_orgws_captured_idx"
  ON "SellfoxFbaInventorySnapshot" ("organizationId", "workspaceId", "capturedAt" DESC);

-- 全站共性：所有赛狐 workbench/缓存域的数据版本查询 max(versionColumn) WHERE org+ws，
-- 缺版本列索引时走 Parallel Seq Scan（sales 1912ms / 其它域类似），拖慢每一次缓存命中。
-- 为全部版本源表补 (org, ws, versionColumn DESC) 覆盖索引，命中降至 <1ms。
CREATE INDEX IF NOT EXISTS "SellfoxSales_orgws_synced_idx" ON "SellfoxSalesDailySnapshot" ("organizationId","workspaceId","syncedAt" DESC);
CREATE INDEX IF NOT EXISTS "SellfoxProdDaily_orgws_synced_idx" ON "SellfoxProductDailySnapshot" ("organizationId","workspaceId","syncedAt" DESC);
CREATE INDEX IF NOT EXISTS "SellfoxAdsProd_orgws_synced_idx" ON "SellfoxAdsProductDaily" ("organizationId","workspaceId","syncedAt" DESC);
CREATE INDEX IF NOT EXISTS "SellfoxAdsTarget_orgws_synced_idx" ON "SellfoxAdsTargetingDaily" ("organizationId","workspaceId","syncedAt" DESC);
CREATE INDEX IF NOT EXISTS "SellfoxAdsSearchTerm_orgws_synced_idx" ON "SellfoxAdsSearchTermDaily" ("organizationId","workspaceId","syncedAt" DESC);
CREATE INDEX IF NOT EXISTS "SellfoxAdsCampaign_orgws_synced_idx" ON "SellfoxAdsCampaignDaily" ("organizationId","workspaceId","syncedAt" DESC);
CREATE INDEX IF NOT EXISTS "SellfoxAdsAdGroup_orgws_synced_idx" ON "SellfoxAdsAdGroupDaily" ("organizationId","workspaceId","syncedAt" DESC);
CREATE INDEX IF NOT EXISTS "SellfoxAdsPlacement_orgws_synced_idx" ON "SellfoxAdsPlacementDaily" ("organizationId","workspaceId","syncedAt" DESC);
