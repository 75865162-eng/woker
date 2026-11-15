-- 功能补全：wimoor 有、woker 缺的 8 个业务域
-- 计算器 / 评论与差评 / 跟卖与调价 / 销售计划 / 采购协同 / 税务台账 / 多渠道 / 字典与自定义字段
-- 手工整理：仅新增表、索引、外键与 CHECK，不改动任何既有表结构。

-- CreateTable
CREATE TABLE "CalcScheme" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PROFIT',
    "marketplace" TEXT NOT NULL DEFAULT 'US',
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "inputs" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalcScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "marketplace" TEXT NOT NULL DEFAULT 'US',
    "asin" TEXT NOT NULL DEFAULT '',
    "sellerSku" TEXT NOT NULL DEFAULT '',
    "rating" INTEGER NOT NULL,
    "sentiment" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "reviewer" TEXT NOT NULL DEFAULT '',
    "reviewedAt" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "replyText" TEXT NOT NULL DEFAULT '',
    "repliedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorePerformanceSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "marketplace" TEXT NOT NULL DEFAULT 'US',
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "orderDefectRateBp" INTEGER NOT NULL DEFAULT 0,
    "lateShipmentRateBp" INTEGER NOT NULL DEFAULT 0,
    "cancellationRateBp" INTEGER NOT NULL DEFAULT 0,
    "validTrackingRateBp" INTEGER NOT NULL DEFAULT 0,
    "negativeFeedbackRateBp" INTEGER NOT NULL DEFAULT 0,
    "policyReference" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'CAPTURED',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorePerformanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepricingRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL DEFAULT 'US',
    "strategy" TEXT NOT NULL DEFAULT 'MATCH_LOWEST',
    "floorPrice" DECIMAL(20,6) NOT NULL,
    "ceilingPrice" DECIMAL(20,6) NOT NULL,
    "stepAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "minMarginBp" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorOfferWatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "marketplace" TEXT NOT NULL DEFAULT 'US',
    "asin" TEXT NOT NULL,
    "sellerSku" TEXT NOT NULL DEFAULT '',
    "myPrice" DECIMAL(20,6) NOT NULL,
    "buyBoxPrice" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "lowestCompetitorPrice" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "competitorCount" INTEGER NOT NULL DEFAULT 0,
    "buyBoxOwner" TEXT NOT NULL DEFAULT '',
    "buyBoxStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorOfferWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepricingQueueItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "marketplace" TEXT NOT NULL DEFAULT 'US',
    "asin" TEXT NOT NULL,
    "sellerSku" TEXT NOT NULL DEFAULT '',
    "ruleId" TEXT NOT NULL DEFAULT '',
    "currentPrice" DECIMAL(20,6) NOT NULL,
    "suggestedPrice" DECIMAL(20,6) NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "appliedPrice" DECIMAL(20,6),
    "decidedBy" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepricingQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL DEFAULT 'US',
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "periodType" TEXT NOT NULL DEFAULT 'MONTH',
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "forecastWindowDays" INTEGER NOT NULL DEFAULT 90,
    "seasonalityBp" INTEGER NOT NULL DEFAULT 10000,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesPlanLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "planId" TEXT NOT NULL,
    "sellerSku" TEXT NOT NULL,
    "asin" TEXT NOT NULL DEFAULT '',
    "targetQty" INTEGER NOT NULL,
    "targetRevenue" DECIMAL(20,6) NOT NULL,
    "unitCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "historyDailyAvg" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "forecastQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesPlanLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchasePaymentRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "amount" DECIMAL(20,6) NOT NULL,
    "dueDate" DATE NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT NOT NULL DEFAULT '',
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "rejectionReason" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchasePaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseExchangeOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "lines" JSONB NOT NULL,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "expectedAt" DATE,
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseExchangeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierQuotation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productRecordId" TEXT NOT NULL DEFAULT '',
    "sellerSku" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "unitPrice" DECIMAL(20,6) NOT NULL,
    "moq" INTEGER NOT NULL DEFAULT 1,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "validUntil" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "country" TEXT NOT NULL DEFAULT 'DE',
    "taxType" TEXT NOT NULL DEFAULT 'VAT',
    "invoiceNo" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "counterparty" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "taxableAmount" DECIMAL(20,6) NOT NULL,
    "taxRateBp" INTEGER NOT NULL,
    "taxAmount" DECIMAL(20,6) NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'OUTPUT',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "filingPeriod" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxFilingPeriod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "country" TEXT NOT NULL DEFAULT 'DE',
    "taxType" TEXT NOT NULL DEFAULT 'VAT',
    "period" TEXT NOT NULL,
    "taxableAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "filedAt" TIMESTAMP(3),
    "reference" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxFilingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultiChannelAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "channel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL DEFAULT '',
    "marketplace" TEXT NOT NULL DEFAULT '',
    "credentialsRef" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultiChannelAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultiChannelOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "accountId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalOrderNo" TEXT NOT NULL,
    "sellerSku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amount" DECIMAL(20,6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "buyerCountry" TEXT NOT NULL DEFAULT '',
    "trackingNo" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultiChannelOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataDictionary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataDictionary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataDictionaryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "dictionaryId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataDictionaryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "entity" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL DEFAULT 'TEXT',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalcScheme_organizationId_workspaceId_kind_createdAt_idx" ON "CalcScheme"("organizationId", "workspaceId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalcScheme_organizationId_workspaceId_id_key" ON "CalcScheme"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CalcScheme_organizationId_workspaceId_name_key" ON "CalcScheme"("organizationId", "workspaceId", "name");

-- CreateIndex
CREATE INDEX "ReviewRecord_organizationId_workspaceId_sentiment_reviewedA_idx" ON "ReviewRecord"("organizationId", "workspaceId", "sentiment", "reviewedAt");

-- CreateIndex
CREATE INDEX "ReviewRecord_organizationId_workspaceId_asin_reviewedAt_idx" ON "ReviewRecord"("organizationId", "workspaceId", "asin", "reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRecord_organizationId_workspaceId_id_key" ON "ReviewRecord"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRecord_external_key" ON "ReviewRecord"("organizationId", "workspaceId", "externalId");

-- CreateIndex
CREATE INDEX "StorePerformanceSnapshot_organizationId_workspaceId_periodS_idx" ON "StorePerformanceSnapshot"("organizationId", "workspaceId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "StorePerformanceSnapshot_organizationId_workspaceId_id_key" ON "StorePerformanceSnapshot"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StorePerformanceSnapshot_period_key" ON "StorePerformanceSnapshot"("organizationId", "workspaceId", "marketplace", "periodStart");

-- CreateIndex
CREATE INDEX "RepricingRule_organizationId_workspaceId_enabled_marketplac_idx" ON "RepricingRule"("organizationId", "workspaceId", "enabled", "marketplace");

-- CreateIndex
CREATE UNIQUE INDEX "RepricingRule_organizationId_workspaceId_id_key" ON "RepricingRule"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RepricingRule_organizationId_workspaceId_name_key" ON "RepricingRule"("organizationId", "workspaceId", "name");

-- CreateIndex
CREATE INDEX "CompetitorOfferWatch_organizationId_workspaceId_buyBoxStatu_idx" ON "CompetitorOfferWatch"("organizationId", "workspaceId", "buyBoxStatus", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorOfferWatch_organizationId_workspaceId_id_key" ON "CompetitorOfferWatch"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorOfferWatch_asin_key" ON "CompetitorOfferWatch"("organizationId", "workspaceId", "marketplace", "asin");

-- CreateIndex
CREATE INDEX "RepricingQueueItem_organizationId_workspaceId_status_create_idx" ON "RepricingQueueItem"("organizationId", "workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RepricingQueueItem_organizationId_workspaceId_asin_status_idx" ON "RepricingQueueItem"("organizationId", "workspaceId", "asin", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RepricingQueueItem_organizationId_workspaceId_id_key" ON "RepricingQueueItem"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE INDEX "SalesPlan_organizationId_workspaceId_status_periodStart_idx" ON "SalesPlan"("organizationId", "workspaceId", "status", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "SalesPlan_organizationId_workspaceId_id_key" ON "SalesPlan"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SalesPlan_organizationId_workspaceId_name_key" ON "SalesPlan"("organizationId", "workspaceId", "name");

-- CreateIndex
CREATE INDEX "SalesPlanLine_organizationId_workspaceId_planId_idx" ON "SalesPlanLine"("organizationId", "workspaceId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesPlanLine_organizationId_workspaceId_id_key" ON "SalesPlanLine"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SalesPlanLine_organizationId_workspaceId_planId_sellerSku_key" ON "SalesPlanLine"("organizationId", "workspaceId", "planId", "sellerSku");

-- CreateIndex
CREATE INDEX "PurchasePaymentRequest_organizationId_workspaceId_status_du_idx" ON "PurchasePaymentRequest"("organizationId", "workspaceId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasePaymentRequest_organizationId_workspaceId_id_key" ON "PurchasePaymentRequest"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasePaymentRequest_organizationId_workspaceId_number_key" ON "PurchasePaymentRequest"("organizationId", "workspaceId", "number");

-- CreateIndex
CREATE INDEX "PurchaseExchangeOrder_organizationId_workspaceId_status_cre_idx" ON "PurchaseExchangeOrder"("organizationId", "workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseExchangeOrder_organizationId_workspaceId_id_key" ON "PurchaseExchangeOrder"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseExchangeOrder_organizationId_workspaceId_number_key" ON "PurchaseExchangeOrder"("organizationId", "workspaceId", "number");

-- CreateIndex
CREATE INDEX "SupplierQuotation_organizationId_workspaceId_productRecordI_idx" ON "SupplierQuotation"("organizationId", "workspaceId", "productRecordId", "unitPrice");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierQuotation_organizationId_workspaceId_id_key" ON "SupplierQuotation"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierQuotation_organizationId_workspaceId_number_key" ON "SupplierQuotation"("organizationId", "workspaceId", "number");

-- CreateIndex
CREATE INDEX "TaxInvoice_organizationId_workspaceId_filingPeriod_directio_idx" ON "TaxInvoice"("organizationId", "workspaceId", "filingPeriod", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "TaxInvoice_organizationId_workspaceId_id_key" ON "TaxInvoice"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TaxInvoice_no_key" ON "TaxInvoice"("organizationId", "workspaceId", "country", "invoiceNo");

-- CreateIndex
CREATE INDEX "TaxFilingPeriod_organizationId_workspaceId_status_period_idx" ON "TaxFilingPeriod"("organizationId", "workspaceId", "status", "period");

-- CreateIndex
CREATE UNIQUE INDEX "TaxFilingPeriod_organizationId_workspaceId_id_key" ON "TaxFilingPeriod"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TaxFilingPeriod_key" ON "TaxFilingPeriod"("organizationId", "workspaceId", "country", "taxType", "period");

-- CreateIndex
CREATE INDEX "MultiChannelAccount_organizationId_workspaceId_status_chann_idx" ON "MultiChannelAccount"("organizationId", "workspaceId", "status", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "MultiChannelAccount_organizationId_workspaceId_id_key" ON "MultiChannelAccount"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MultiChannelAccount_key" ON "MultiChannelAccount"("organizationId", "workspaceId", "channel", "sellerId");

-- CreateIndex
CREATE INDEX "MultiChannelOrder_organizationId_workspaceId_status_ordered_idx" ON "MultiChannelOrder"("organizationId", "workspaceId", "status", "orderedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MultiChannelOrder_organizationId_workspaceId_id_key" ON "MultiChannelOrder"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MultiChannelOrder_key" ON "MultiChannelOrder"("organizationId", "workspaceId", "channel", "externalOrderNo", "sellerSku");

-- CreateIndex
CREATE INDEX "DataDictionary_organizationId_workspaceId_code_idx" ON "DataDictionary"("organizationId", "workspaceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DataDictionary_organizationId_workspaceId_id_key" ON "DataDictionary"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DataDictionary_organizationId_workspaceId_code_key" ON "DataDictionary"("organizationId", "workspaceId", "code");

-- CreateIndex
CREATE INDEX "DataDictionaryItem_organizationId_workspaceId_dictionaryId__idx" ON "DataDictionaryItem"("organizationId", "workspaceId", "dictionaryId", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "DataDictionaryItem_organizationId_workspaceId_id_key" ON "DataDictionaryItem"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DataDictionaryItem_key" ON "DataDictionaryItem"("organizationId", "workspaceId", "dictionaryId", "value");

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_organizationId_workspaceId_entity_sor_idx" ON "CustomFieldDefinition"("organizationId", "workspaceId", "entity", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_organizationId_workspaceId_id_key" ON "CustomFieldDefinition"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_key" ON "CustomFieldDefinition"("organizationId", "workspaceId", "entity", "code");

-- AddForeignKey
ALTER TABLE "CalcScheme" ADD CONSTRAINT "CalcScheme_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalcScheme" ADD CONSTRAINT "CalcScheme_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorePerformanceSnapshot" ADD CONSTRAINT "StorePerformanceSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorePerformanceSnapshot" ADD CONSTRAINT "StorePerformanceSnapshot_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepricingRule" ADD CONSTRAINT "RepricingRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepricingRule" ADD CONSTRAINT "RepricingRule_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorOfferWatch" ADD CONSTRAINT "CompetitorOfferWatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorOfferWatch" ADD CONSTRAINT "CompetitorOfferWatch_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepricingQueueItem" ADD CONSTRAINT "RepricingQueueItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepricingQueueItem" ADD CONSTRAINT "RepricingQueueItem_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPlan" ADD CONSTRAINT "SalesPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPlan" ADD CONSTRAINT "SalesPlan_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPlanLine" ADD CONSTRAINT "SalesPlanLine_organizationId_workspaceId_planId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "planId") REFERENCES "SalesPlan"("organizationId", "workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePaymentRequest" ADD CONSTRAINT "PurchasePaymentRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePaymentRequest" ADD CONSTRAINT "PurchasePaymentRequest_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseExchangeOrder" ADD CONSTRAINT "PurchaseExchangeOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseExchangeOrder" ADD CONSTRAINT "PurchaseExchangeOrder_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuotation" ADD CONSTRAINT "SupplierQuotation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuotation" ADD CONSTRAINT "SupplierQuotation_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxFilingPeriod" ADD CONSTRAINT "TaxFilingPeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxFilingPeriod" ADD CONSTRAINT "TaxFilingPeriod_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultiChannelAccount" ADD CONSTRAINT "MultiChannelAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultiChannelAccount" ADD CONSTRAINT "MultiChannelAccount_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultiChannelOrder" ADD CONSTRAINT "MultiChannelOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultiChannelOrder" ADD CONSTRAINT "MultiChannelOrder_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultiChannelOrder" ADD CONSTRAINT "MultiChannelOrder_organizationId_workspaceId_accountId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "accountId") REFERENCES "MultiChannelAccount"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataDictionary" ADD CONSTRAINT "DataDictionary_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataDictionary" ADD CONSTRAINT "DataDictionary_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataDictionaryItem" ADD CONSTRAINT "DataDictionaryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataDictionaryItem" ADD CONSTRAINT "DataDictionaryItem_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataDictionaryItem" ADD CONSTRAINT "DataDictionaryItem_organizationId_workspaceId_dictionaryId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "dictionaryId") REFERENCES "DataDictionary"("organizationId", "workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 业务约束：状态枚举与数值区间，放在数据库层兜底，服务层校验只是第一道 ──
ALTER TABLE "CalcScheme" ADD CONSTRAINT "CalcScheme_kind_check" CHECK ("kind" IN ('FBA_FEE', 'PROFIT')) NOT VALID;
ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_rating_check" CHECK ("rating" BETWEEN 1 AND 5) NOT VALID;
ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_sentiment_check" CHECK ("sentiment" IN ('POSITIVE', 'NEUTRAL', 'NEGATIVE')) NOT VALID;
ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_status_check" CHECK ("status" IN ('NEW', 'REPLIED', 'IGNORED')) NOT VALID;
ALTER TABLE "StorePerformanceSnapshot" ADD CONSTRAINT "StorePerformanceSnapshot_rate_check" CHECK ("orderDefectRateBp" >= 0 AND "lateShipmentRateBp" >= 0 AND "cancellationRateBp" >= 0 AND "validTrackingRateBp" BETWEEN 0 AND 10000 AND "negativeFeedbackRateBp" BETWEEN 0 AND 10000) NOT VALID;
ALTER TABLE "RepricingRule" ADD CONSTRAINT "RepricingRule_price_check" CHECK ("floorPrice" >= 0 AND "ceilingPrice" >= "floorPrice" AND "minMarginBp" BETWEEN -10000 AND 10000) NOT VALID;
ALTER TABLE "RepricingRule" ADD CONSTRAINT "RepricingRule_strategy_check" CHECK ("strategy" IN ('MATCH_LOWEST', 'BEAT_LOWEST', 'HOLD')) NOT VALID;
ALTER TABLE "CompetitorOfferWatch" ADD CONSTRAINT "CompetitorOfferWatch_price_check" CHECK ("myPrice" >= 0 AND "buyBoxPrice" >= 0 AND "lowestCompetitorPrice" >= 0 AND "competitorCount" >= 0) NOT VALID;
ALTER TABLE "CompetitorOfferWatch" ADD CONSTRAINT "CompetitorOfferWatch_buybox_check" CHECK ("buyBoxStatus" IN ('WINNING', 'LOSING', 'UNKNOWN')) NOT VALID;
ALTER TABLE "RepricingQueueItem" ADD CONSTRAINT "RepricingQueueItem_price_check" CHECK ("currentPrice" >= 0 AND "suggestedPrice" >= 0) NOT VALID;
ALTER TABLE "RepricingQueueItem" ADD CONSTRAINT "RepricingQueueItem_status_check" CHECK ("status" IN ('PENDING', 'APPLIED', 'DISMISSED')) NOT VALID;
ALTER TABLE "SalesPlan" ADD CONSTRAINT "SalesPlan_period_check" CHECK ("periodEnd" >= "periodStart" AND "forecastWindowDays" BETWEEN 7 AND 365 AND "seasonalityBp" BETWEEN 0 AND 50000) NOT VALID;
ALTER TABLE "SalesPlan" ADD CONSTRAINT "SalesPlan_status_check" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'CLOSED')) NOT VALID;
ALTER TABLE "SalesPlanLine" ADD CONSTRAINT "SalesPlanLine_qty_check" CHECK ("targetQty" >= 0 AND "targetRevenue" >= 0 AND "unitCost" >= 0 AND "forecastQty" >= 0) NOT VALID;
ALTER TABLE "PurchasePaymentRequest" ADD CONSTRAINT "PurchasePaymentRequest_amount_check" CHECK ("amount" > 0) NOT VALID;
ALTER TABLE "PurchasePaymentRequest" ADD CONSTRAINT "PurchasePaymentRequest_status_check" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID')) NOT VALID;
ALTER TABLE "PurchaseExchangeOrder" ADD CONSTRAINT "PurchaseExchangeOrder_status_check" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'SHIPPED', 'CLOSED')) NOT VALID;
ALTER TABLE "SupplierQuotation" ADD CONSTRAINT "SupplierQuotation_price_check" CHECK ("unitPrice" >= 0 AND "moq" >= 1 AND "leadTimeDays" BETWEEN 0 AND 365) NOT VALID;
ALTER TABLE "SupplierQuotation" ADD CONSTRAINT "SupplierQuotation_status_check" CHECK ("status" IN ('ACTIVE', 'EXPIRED', 'SELECTED')) NOT VALID;
ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_amount_check" CHECK ("taxableAmount" >= 0 AND "taxRateBp" BETWEEN 0 AND 10000 AND "taxAmount" >= 0) NOT VALID;
ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_status_check" CHECK ("status" IN ('DRAFT', 'FILED', 'PAID', 'VOID')) NOT VALID;
ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_direction_check" CHECK ("direction" IN ('INPUT', 'OUTPUT')) NOT VALID;
ALTER TABLE "TaxFilingPeriod" ADD CONSTRAINT "TaxFilingPeriod_status_check" CHECK ("status" IN ('OPEN', 'FILED')) NOT VALID;
ALTER TABLE "MultiChannelAccount" ADD CONSTRAINT "MultiChannelAccount_status_check" CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'CLOSED')) NOT VALID;
ALTER TABLE "MultiChannelOrder" ADD CONSTRAINT "MultiChannelOrder_qty_check" CHECK ("quantity" >= 1 AND "amount" >= 0) NOT VALID;
ALTER TABLE "MultiChannelOrder" ADD CONSTRAINT "MultiChannelOrder_status_check" CHECK ("status" IN ('PENDING', 'SHIPPED', 'DELIVERED', 'CANCELLED')) NOT VALID;
ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_type_check" CHECK ("fieldType" IN ('TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN')) NOT VALID;
