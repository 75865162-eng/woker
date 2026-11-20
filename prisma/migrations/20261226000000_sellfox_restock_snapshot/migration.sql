-- 补货建议物化结果表（派生读模型，纯新增 DDL，不改动任何现有表/视图/算法）。
-- 以赛狐 buildRestockRows 算法为权威，按 (org,ws,dimension,inputDate) 存全量建议快照。
-- 与 operations.AmazonReplenishmentPlan 是两套独立算法，本表不与它共用或互相覆盖。
-- IF NOT EXISTS 保证重复执行安全；读路径默认不走本表，切换由对账门禁 + source 开关决定。

CREATE TABLE IF NOT EXISTS "SellfoxRestockSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "dimension" TEXT NOT NULL,
    "inputDate" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "suggestTotal" DECIMAL(20,4),
    "rows" JSONB NOT NULL,
    "inputVersion" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sellfox_restock_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sellfox_restock_snapshot_identity"
  ON "SellfoxRestockSnapshot" ("organizationId","workspaceId","dimension","inputDate");

CREATE INDEX IF NOT EXISTS "sellfox_restock_snapshot_lookup"
  ON "SellfoxRestockSnapshot" ("organizationId","workspaceId","dimension");
