-- 观测字段必须由调用方显式提供；不修改历史值，历史伪零无法与真实零自动区分。
ALTER TABLE "SellfoxHourlyMetric"
  ALTER COLUMN "impressions" DROP DEFAULT,
  ALTER COLUMN "clicks" DROP DEFAULT,
  ALTER COLUMN "cost" DROP DEFAULT,
  ALTER COLUMN "sales" DROP DEFAULT,
  ALTER COLUMN "orders" DROP DEFAULT;

ALTER TABLE "StorePerformanceSnapshot"
  ALTER COLUMN "totalOrders" DROP DEFAULT,
  ALTER COLUMN "orderDefectRateBp" DROP DEFAULT,
  ALTER COLUMN "lateShipmentRateBp" DROP DEFAULT,
  ALTER COLUMN "cancellationRateBp" DROP DEFAULT,
  ALTER COLUMN "validTrackingRateBp" DROP DEFAULT,
  ALTER COLUMN "negativeFeedbackRateBp" DROP DEFAULT;
