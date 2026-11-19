-- 修复 SellfoxOrderDetail 的 (storeId, sellerOrderId) 唯一约束。
-- 原 migration 20261119010000 误建为普通索引 SellfoxOrderDetail_store_seller_idx，
-- 但 schema 的 @@unique([storeId, sellerOrderId]) 与 upsert 的 storeId_sellerOrderId
-- 需要唯一索引 SellfoxOrderDetail_storeId_sellerOrderId_key，否则 ON CONFLICT 报 42P10。
-- 本迁移幂等：删除旧普通索引，补建 prisma 期望的唯一索引。

DROP INDEX IF EXISTS "SellfoxOrderDetail_store_seller_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "SellfoxOrderDetail_storeId_sellerOrderId_key"
  ON "SellfoxOrderDetail" ("storeId", "sellerOrderId");
