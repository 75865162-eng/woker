-- 赛狐订单详情批量接口原始行（字段契约：docs/sellfox-api-docs/API.md#api-476895394）。
-- 一行一个订单；金额 DECIMAL(20,4) 与 SellfoxOrderSnapshot 一致；完整响应原样存 payload，
-- 缺失字段保留 NULL 不补零。只读承接，不与日利润快照/结算口径相加。
CREATE TABLE "SellfoxOrderDetail" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "storeId" TEXT NOT NULL,
    "shopExternalId" TEXT NOT NULL,
    "sellerOrderId" TEXT NOT NULL,
    "amazonOrderId" TEXT,
    "orderStatus" TEXT,
    "orderTotalCurrency" TEXT,
    "orderTotalAmount" DECIMAL(20,4),
    "marketplaceId" TEXT,
    "orderType" TEXT,
    "purchaseDate" TEXT,
    "paymentsDate" TEXT,
    "refundDate" TEXT,
    "fulfillmentChannel" TEXT,
    "settlementStatus" TEXT,
    "refundStatus" TEXT,
    "productAmount" DECIMAL(20,4),
    "refundPrice" DECIMAL(20,4),
    "fbaPerUnitFulfillmentFee" DECIMAL(20,4),
    "commission" DECIMAL(20,4),
    "otherAmount" DECIMAL(20,4),
    "purchaseCost" DECIMAL(20,4),
    "headTripCost" DECIMAL(20,4),
    "fbmShipCost" DECIMAL(20,4),
    "orderProfit" DECIMAL(20,4),
    "totalCost" DECIMAL(20,4),
    "totalRevenue" DECIMAL(20,4),
    "shippingCharge" DECIMAL(20,4),
    "promotionDiscount" DECIMAL(20,4),
    "taxAmount" DECIMAL(20,4),
    "isBusinessOrder" TEXT,
    "isReturnOrder" TEXT,
    "payload" JSONB NOT NULL,
    "latestCapturedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellfoxOrderDetail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SellfoxOrderDetail_store_seller_idx"
  ON "SellfoxOrderDetail" ("storeId","sellerOrderId");
CREATE INDEX "SellfoxOrderDetail_org_ws_seller_idx"
  ON "SellfoxOrderDetail" ("organizationId","workspaceId","sellerOrderId");
CREATE INDEX "SellfoxOrderDetail_org_ws_amazon_idx"
  ON "SellfoxOrderDetail" ("organizationId","workspaceId","amazonOrderId");
CREATE INDEX "SellfoxOrderDetail_org_ws_purchase_idx"
  ON "SellfoxOrderDetail" ("organizationId","workspaceId","purchaseDate");

ALTER TABLE "SellfoxOrderDetail" ADD CONSTRAINT "SellfoxOrderDetail_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
