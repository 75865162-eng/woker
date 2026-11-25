-- 差距审计报告 1-3 阶段 P0 字段补齐（全部 additive / 幂等，不改写既有数据）。
-- 报告2 P0-3：订单行费用显式列（源报告未提供则保持 NULL，不补 0）。
ALTER TABLE "AmazonOrderItemRecord"
  ADD COLUMN IF NOT EXISTS "itemTax" DECIMAL(65, 30),
  ADD COLUMN IF NOT EXISTS "shippingPrice" DECIMAL(65, 30),
  ADD COLUMN IF NOT EXISTS "shippingTax" DECIMAL(65, 30),
  ADD COLUMN IF NOT EXISTS "promotionDiscount" DECIMAL(65, 30),
  ADD COLUMN IF NOT EXISTS "giftWrapPrice" DECIMAL(65, 30),
  ADD COLUMN IF NOT EXISTS "pointsGranted" INTEGER,
  ADD COLUMN IF NOT EXISTS "conditionNote" TEXT;

-- 报告3 P0-1：外币分录三栏（NULL = 本位币分录，兼容存量）。
ALTER TABLE "FinanceVoucherLine"
  ADD COLUMN IF NOT EXISTS "currency" TEXT,
  ADD COLUMN IF NOT EXISTS "originalAmount" DECIMAL(30, 6),
  ADD COLUMN IF NOT EXISTS "exchangeRate" DECIMAL(24, 12);

-- 报告3 P0-5：数量金额式辅助核算。
ALTER TABLE "FinanceVoucherLine"
  ADD COLUMN IF NOT EXISTS "quantity" DECIMAL(30, 6),
  ADD COLUMN IF NOT EXISTS "unitPrice" DECIMAL(30, 6);
ALTER TABLE "FinanceSubject"
  ADD COLUMN IF NOT EXISTS "isQuantity" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "unitOfMeasure" TEXT;

-- 报告3 P0-3：发票增强（票种/电子票号/买卖方税号 + 商品明细税目）。
ALTER TABLE "PurchaseInvoice"
  ADD COLUMN IF NOT EXISTS "invoiceType" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "digitalInvoiceNo" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "sellerTaxNo" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "buyerTaxNo" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PurchaseInvoiceLine"
  ADD COLUMN IF NOT EXISTS "goodsName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "specModel" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "taxRateBp" INTEGER,
  ADD COLUMN IF NOT EXISTS "taxCategoryCode" TEXT;
