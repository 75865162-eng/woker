-- 差距审计 P1/P2 内核持久化表（全部 additive / 幂等，不改写既有数据）。
-- 对应本轮 8 个纯函数内核 + 上一轮 P0 内核的持久化落点。
-- 租户隔离（organizationId/workspaceId）、业务键唯一防重、查询索引齐备。

CREATE TABLE IF NOT EXISTS "FinanceBalanceProjection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "openingSigned" DECIMAL(30, 6) NOT NULL,
  "debit" DECIMAL(30, 6) NOT NULL,
  "credit" DECIMAL(30, 6) NOT NULL,
  "closingSigned" DECIMAL(30, 6) NOT NULL,
  "revision" INTEGER NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "balanced" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceBalanceProjection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FinanceBalanceProjection_key" ON "FinanceBalanceProjection" ("organizationId", "workspaceId", "bookId", "periodId", "revision", "subjectId");
CREATE INDEX IF NOT EXISTS "FinanceBalanceProjection_hash_idx" ON "FinanceBalanceProjection" ("organizationId", "workspaceId", "bookId", "periodId", "sourceHash");

CREATE TABLE IF NOT EXISTS "SalesDailyFact" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "sellerAccountId" TEXT NOT NULL,
  "marketplaceId" TEXT NOT NULL,
  "sellerSku" TEXT NOT NULL,
  "asin" TEXT,
  "businessDate" VARCHAR(10) NOT NULL,
  "period" TEXT,
  "unitsOrdered" INTEGER,
  "orderCount" INTEGER,
  "grossSales" DECIMAL(30, 6),
  "refundUnits" INTEGER,
  "refundAmount" DECIMAL(30, 6),
  "currency" VARCHAR(3) NOT NULL,
  "sourceRunId" TEXT,
  "formulaVersion" INTEGER,
  "pendingSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesDailyFact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesDailyFact_date_check" CHECK ("businessDate" ~ '^\d{4}-\d{2}-\d{2}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS "SalesDailyFact_key" ON "SalesDailyFact" ("organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "sellerSku", "businessDate", "currency");
CREATE INDEX IF NOT EXISTS "SalesDailyFact_date_idx" ON "SalesDailyFact" ("organizationId", "workspaceId", "businessDate");
CREATE INDEX IF NOT EXISTS "SalesDailyFact_sku_idx" ON "SalesDailyFact" ("organizationId", "workspaceId", "sellerSku", "businessDate");

CREATE TABLE IF NOT EXISTS "OrderFinanceEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "economicKey" TEXT NOT NULL,
  "amazonOrderId" TEXT NOT NULL,
  "orderItemId" TEXT,
  "sku" TEXT,
  "ftype" TEXT NOT NULL,
  "amount" DECIMAL(30, 6) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "postedDate" VARCHAR(10),
  "sourceRunId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderFinanceEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OrderFinanceEvent_key" ON "OrderFinanceEvent" ("organizationId", "workspaceId", "economicKey");
CREATE INDEX IF NOT EXISTS "OrderFinanceEvent_order_idx" ON "OrderFinanceEvent" ("organizationId", "workspaceId", "amazonOrderId");
CREATE INDEX IF NOT EXISTS "OrderFinanceEvent_type_date_idx" ON "OrderFinanceEvent" ("organizationId", "workspaceId", "ftype", "postedDate");

CREATE TABLE IF NOT EXISTS "BusinessLink" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "linkKey" TEXT NOT NULL,
  "downstreamKind" TEXT NOT NULL,
  "downstreamId" TEXT NOT NULL,
  "amazonOrderId" TEXT,
  "orderItemId" TEXT,
  "marketplaceId" TEXT,
  "sourceRunId" TEXT,
  "reportType" TEXT,
  "rowNumber" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BusinessLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BusinessLink_key" ON "BusinessLink" ("organizationId", "workspaceId", "linkKey");
CREATE INDEX IF NOT EXISTS "BusinessLink_downstream_idx" ON "BusinessLink" ("organizationId", "workspaceId", "downstreamKind", "downstreamId");
CREATE INDEX IF NOT EXISTS "BusinessLink_order_idx" ON "BusinessLink" ("organizationId", "workspaceId", "amazonOrderId");

CREATE TABLE IF NOT EXISTS "FinanceAccountMapping" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "mappingKind" TEXT NOT NULL,
  "feeType" TEXT NOT NULL,
  "accountId" TEXT,
  "subjectId" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "changeReference" TEXT,
  "reviewedBy" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceAccountMapping_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FinanceAccountMapping_key" ON "FinanceAccountMapping" ("organizationId", "workspaceId", "bookId", "mappingKind", "feeType", "version");
CREATE INDEX IF NOT EXISTS "FinanceAccountMapping_lookup_idx" ON "FinanceAccountMapping" ("organizationId", "workspaceId", "bookId", "mappingKind", "status");

CREATE TABLE IF NOT EXISTS "FinanceSupplierReconcile" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "reconcileMonth" VARCHAR(7) NOT NULL,
  "supplierId" TEXT NOT NULL,
  "orderCount" INTEGER,
  "totalOrderAmount" DECIMAL(30, 6),
  "totalPaid" DECIMAL(30, 6),
  "totalUnpaid" DECIMAL(30, 6),
  "totalInvoiced" DECIMAL(30, 6),
  "totalUninvoiced" DECIMAL(30, 6),
  "currency" VARCHAR(3) NOT NULL,
  "sourceHash" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceSupplierReconcile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FinanceSupplierReconcile_key" ON "FinanceSupplierReconcile" ("organizationId", "workspaceId", "bookId", "reconcileMonth", "supplierId");
CREATE INDEX IF NOT EXISTS "FinanceSupplierReconcile_month_idx" ON "FinanceSupplierReconcile" ("organizationId", "workspaceId", "reconcileMonth");

CREATE TABLE IF NOT EXISTS "FinanceCarrierReconcile" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "reconcileMonth" VARCHAR(7) NOT NULL,
  "carrierId" TEXT NOT NULL,
  "orderCount" INTEGER,
  "totalOrderAmount" DECIMAL(30, 6),
  "totalPaid" DECIMAL(30, 6),
  "totalUnpaid" DECIMAL(30, 6),
  "totalInvoiced" DECIMAL(30, 6),
  "totalUninvoiced" DECIMAL(30, 6),
  "currency" VARCHAR(3) NOT NULL,
  "sourceHash" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceCarrierReconcile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FinanceCarrierReconcile_key" ON "FinanceCarrierReconcile" ("organizationId", "workspaceId", "bookId", "reconcileMonth", "carrierId");
CREATE INDEX IF NOT EXISTS "FinanceCarrierReconcile_month_idx" ON "FinanceCarrierReconcile" ("organizationId", "workspaceId", "reconcileMonth");

CREATE TABLE IF NOT EXISTS "FeeCategoryDict" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "transactionType" TEXT NOT NULL DEFAULT '*',
  "amountType" TEXT NOT NULL DEFAULT '*',
  "amountDescription" TEXT NOT NULL DEFAULT '*',
  "feeCategory" TEXT NOT NULL,
  "targetColumn" TEXT NOT NULL,
  "feePoolKey" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeeCategoryDict_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FeeCategoryDict_key" ON "FeeCategoryDict" ("organizationId", "workspaceId", "transactionType", "amountType", "amountDescription", "version");
CREATE INDEX IF NOT EXISTS "FeeCategoryDict_lookup_idx" ON "FeeCategoryDict" ("organizationId", "workspaceId", "feeCategory", "status");

CREATE TABLE IF NOT EXISTS "ProfitConfig" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL,
  "changeReference" TEXT NOT NULL,
  "changeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfitConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProfitConfig_key" ON "ProfitConfig" ("organizationId", "workspaceId", "changeKey");
CREATE INDEX IF NOT EXISTS "ProfitConfig_shop_idx" ON "ProfitConfig" ("organizationId", "workspaceId", "shopId", "isDefault");

CREATE TABLE IF NOT EXISTS "ProfitConfigCountry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "country" VARCHAR(3) NOT NULL,
  "params" JSONB NOT NULL,
  "configuredKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "missingKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "effectiveFrom" VARCHAR(10),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfitConfigCountry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProfitConfigCountry_key" ON "ProfitConfigCountry" ("organizationId", "workspaceId", "configId", "country");
CREATE INDEX IF NOT EXISTS "ProfitConfigCountry_country_idx" ON "ProfitConfigCountry" ("organizationId", "workspaceId", "country");

CREATE TABLE IF NOT EXISTS "InventoryPlanningSnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "syncRunId" TEXT,
  "sellerAccountId" TEXT,
  "marketplaceId" TEXT NOT NULL,
  "sellerSku" TEXT NOT NULL,
  "asin" TEXT,
  "businessDate" VARCHAR(10),
  "values" JSONB NOT NULL,
  "coverage" DECIMAL(6, 5) NOT NULL,
  "missing" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "groupCoverage" JSONB NOT NULL,
  "capturedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryPlanningSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryPlanningSnapshot_key" ON "InventoryPlanningSnapshot" ("organizationId", "workspaceId", "marketplaceId", "sellerSku", "syncRunId");
CREATE INDEX IF NOT EXISTS "InventoryPlanningSnapshot_sku_idx" ON "InventoryPlanningSnapshot" ("organizationId", "workspaceId", "marketplaceId", "capturedAt");

CREATE TABLE IF NOT EXISTS "AdsAttributionCoverage" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "sellerAccountId" TEXT,
  "marketplaceId" TEXT NOT NULL,
  "profileRecordId" TEXT,
  "reportType" TEXT,
  "businessDate" VARCHAR(10) NOT NULL,
  "window" VARCHAR(4) NOT NULL,
  "totalSpend" DECIMAL(30, 6) NOT NULL,
  "coveredSpend" DECIMAL(30, 6) NOT NULL,
  "uncoveredSpend" DECIMAL(30, 6) NOT NULL,
  "coverageBp" INTEGER,
  "meetsTarget" BOOLEAN,
  "uncoveredRows" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "coveredRowCount" INTEGER NOT NULL,
  "uncoveredRowCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdsAttributionCoverage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdsAttributionCoverage_window_check" CHECK ("window" IN ('1d', '7d', '14d', '30d')),
  CONSTRAINT "AdsAttributionCoverage_date_check" CHECK ("businessDate" ~ '^\d{4}-\d{2}-\d{2}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdsAttributionCoverage_key" ON "AdsAttributionCoverage" ("organizationId", "workspaceId", "marketplaceId", "reportType", "businessDate", "window");
CREATE INDEX IF NOT EXISTS "AdsAttributionCoverage_date_idx" ON "AdsAttributionCoverage" ("organizationId", "workspaceId", "businessDate");
