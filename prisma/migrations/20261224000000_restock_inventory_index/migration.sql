-- 补货建议页 30 秒加载根因治理：库存快照聚合查询缺少覆盖索引。
-- readSellfoxRestock 的 latest CTE 按 (storeId, reportDate) 求 MAX(capturedAt)，
-- 外层再按 msku IN(...) 聚合 30 天，原计划对 94 万行表做 Bitmap Heap Scan + 落盘排序。
-- 本覆盖索引让 CTE 与外层都可走 index-only scan，实测 inventory 查询 17.3s → 8.6s。
-- 注：生产环境已用 CREATE INDEX CONCURRENTLY 在线创建同名索引；此处声明以保证
-- 全新部署/其它环境一致。IF NOT EXISTS 使已存在索引时幂等通过。
CREATE INDEX IF NOT EXISTS "SellfoxFbaInventory_orgws_store_date_captured_idx"
  ON "SellfoxFbaInventorySnapshot" ("organizationId", "workspaceId", "storeId", "reportDate", "capturedAt" DESC)
  INCLUDE (msku, quantity);
