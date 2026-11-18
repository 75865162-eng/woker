-- P2 L4: pre-aggregated tables. Pure additive DDL — no existing table/view is touched.
-- Amount columns use DECIMAL(20,4) to stay consistent with the repo-wide存量口径
-- (7+ views and every workbench query use 20,4). Per-document 18,4 was not adopted to
-- avoid a type/口径 split; this deviation is recorded in the delivery report.
-- All tables are Sellfox-prefixed, org/ws-isolated, and carry NULL for missing data
-- (never padded to 0). Read paths stay OFF until the reconciliation script reports 0 diff.

CREATE TABLE "SellfoxSalesAggDaily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "storeId" TEXT NOT NULL,
    "msku" TEXT NOT NULL,
    "asin" TEXT,
    "reportDate" TEXT NOT NULL,
    "quantity" INTEGER,
    "orders" INTEGER,
    "revenueOriginal" DECIMAL(20,4),
    "currencyOriginal" TEXT,
    "fxRate" DECIMAL(20,8),
    "amountBase" DECIMAL(20,4),
    "complete" BOOLEAN,
    "sourceCapturedAt" TIMESTAMP(3),
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sellfox_sales_agg_daily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sellfox_sales_agg_daily_identity"
  ON "SellfoxSalesAggDaily" ("organizationId","workspaceId","storeId","msku","reportDate");
CREATE INDEX "sellfox_sales_agg_daily_date"
  ON "SellfoxSalesAggDaily" ("organizationId","workspaceId","reportDate");

CREATE TABLE "SellfoxSalesAggEntity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "identity" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "quantity" INTEGER,
    "orders" INTEGER,
    "revenueOriginal" DECIMAL(20,4),
    "daily" JSONB,
    "sourceVersion" TEXT,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sellfox_sales_agg_entity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sellfox_sales_agg_entity_identity"
  ON "SellfoxSalesAggEntity" ("organizationId","workspaceId","identity","currency","dimension","fromDate","toDate");
CREATE INDEX "sellfox_sales_agg_entity_range"
  ON "SellfoxSalesAggEntity" ("organizationId","workspaceId","dimension","fromDate","toDate");

CREATE TABLE "SellfoxProfitAggDaily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "storeId" TEXT NOT NULL,
    "msku" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "onlySettle" BOOLEAN NOT NULL DEFAULT false,
    "saleQuantity" INTEGER,
    "saleRevenue" DECIMAL(20,4),
    "grossProfit" DECIMAL(20,4),
    "netRevenue" DECIMAL(20,4),
    "adCost" DECIMAL(20,4),
    "currency" TEXT,
    "sourceCapturedAt" TIMESTAMP(3),
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sellfox_profit_agg_daily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sellfox_profit_agg_daily_identity"
  ON "SellfoxProfitAggDaily" ("organizationId","workspaceId","storeId","msku","reportDate","onlySettle");
CREATE INDEX "sellfox_profit_agg_daily_date"
  ON "SellfoxProfitAggDaily" ("organizationId","workspaceId","reportDate");

CREATE TABLE "SellfoxAdsAggDaily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "storeId" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "adType" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "adGroupId" TEXT,
    "targetingId" TEXT,
    "entityType" TEXT NOT NULL,
    "impressions" INTEGER,
    "clicks" INTEGER,
    "cost" DECIMAL(20,4),
    "adOrders" INTEGER,
    "adSales" DECIMAL(20,4),
    "currency" TEXT,
    "sourceCapturedAt" TIMESTAMP(3),
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sellfox_ads_agg_daily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sellfox_ads_agg_daily_identity"
  ON "SellfoxAdsAggDaily" ("organizationId","workspaceId","storeId","reportDate","adType","campaignId","adGroupId","targetingId","entityType");
CREATE INDEX "sellfox_ads_agg_daily_date"
  ON "SellfoxAdsAggDaily" ("organizationId","workspaceId","reportDate");

CREATE TABLE "SellfoxOverviewAgg" (
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "storeCount" INTEGER,
    "inventoryCount" INTEGER,
    "latestSalesDate" TEXT,
    "latestProfitDate" TEXT,
    "sourceVersion" TEXT,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sellfox_overview_agg_pkey" PRIMARY KEY ("organizationId","workspaceId")
);
