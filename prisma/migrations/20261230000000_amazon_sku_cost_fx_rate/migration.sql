-- 亚马逊 SKU 成本录入（对标 Wimoor SKU 成本分摊），纯亚马逊模块，不接赛狐
CREATE TABLE "AmazonSkuCost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "sku" TEXT NOT NULL,
    "asin" TEXT NOT NULL DEFAULT '',
    "costCurrency" TEXT NOT NULL DEFAULT 'CNY',
    "purchaseCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "freightCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "otherCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "effectiveAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonSkuCost_pkey" PRIMARY KEY ("id")
);

-- 汇率配置（用户显式录入，保守口径不自动抓汇率）
CREATE TABLE "AmazonFxRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DECIMAL(20,8) NOT NULL,
    "effectiveAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonFxRate_pkey" PRIMARY KEY ("id")
);

-- 唯一约束与索引
CREATE UNIQUE INDEX "AmazonSkuCost_scope_sku_ccy_key" ON "AmazonSkuCost"("organizationId", "workspaceId", "sku", "costCurrency");
CREATE INDEX "AmazonSkuCost_organizationId_workspaceId_sku_idx" ON "AmazonSkuCost"("organizationId", "workspaceId", "sku");
CREATE INDEX "AmazonSkuCost_organizationId_workspaceId_updatedAt_idx" ON "AmazonSkuCost"("organizationId", "workspaceId", "updatedAt");

CREATE UNIQUE INDEX "AmazonFxRate_scope_pair_key" ON "AmazonFxRate"("organizationId", "workspaceId", "fromCurrency", "toCurrency");
CREATE INDEX "AmazonFxRate_organizationId_workspaceId_updatedAt_idx" ON "AmazonFxRate"("organizationId", "workspaceId", "updatedAt");
