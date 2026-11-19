-- 库存当前态预聚合表（派生读模型，纯新增 DDL，不改动任何现有表/视图）。
-- 来源：sellfox_inventory_current 视图（最近一次完整采集，按 storeId+msku 聚合）。
-- 度量沿用 NULL-preserving 口径：任一行缺值整列 null，绝不补零。
-- 金额列 DECIMAL(20,4) 与仓库存量口径一致。
-- IF NOT EXISTS 保证重复执行安全；本表为全新空表，CREATE INDEX 无锁表风险。
-- 读路径保持关闭：页面仍读实时视图，是否切换由对账门禁（reconcile 0 diff）单独决定。

CREATE TABLE IF NOT EXISTS "SellfoxInventoryAgg" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "storeId" TEXT NOT NULL,
    "msku" TEXT NOT NULL,
    "asin" TEXT,
    "quantity" INTEGER,
    "totalInventory" INTEGER,
    "inTransit" INTEGER,
    "inboundWorking" INTEGER,
    "inboundShipped" INTEGER,
    "inboundReceiving" INTEGER,
    "reservedTransfer" INTEGER,
    "reservedProcessing" INTEGER,
    "reservedCustomerorders" INTEGER,
    "unfulfillable" INTEGER,
    "avgInventoryCost" DECIMAL(20,4),
    "avgTransportCost" DECIMAL(20,4),
    "currency" TEXT,
    "warehouseCount" INTEGER,
    "sourceCapturedAt" TIMESTAMP(3),
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sellfox_inventory_agg_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sellfox_inventory_agg_identity"
  ON "SellfoxInventoryAgg" ("organizationId","workspaceId","storeId","msku");

CREATE INDEX IF NOT EXISTS "sellfox_inventory_agg_scope"
  ON "SellfoxInventoryAgg" ("organizationId","workspaceId");
