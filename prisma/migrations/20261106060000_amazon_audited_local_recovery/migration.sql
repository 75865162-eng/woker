-- Add audited recovery operations only; existing requests, facts and cursors stay unchanged.
-- Existing application releases continue to use the original operation values.
ALTER TABLE "AmazonDataCenterChangeRequest"
  DROP CONSTRAINT "AmazonDataCenterChangeRequest_operation_check";
ALTER TABLE "AmazonDataCenterChangeRequest"
  ADD CONSTRAINT "AmazonDataCenterChangeRequest_operation_check"
  CHECK ("operation" IN ('save-authorization','disable-authorization','save-source','save-plan','run','control-task','validate-authorization','save-access-grant','adopt-identity','recover-finance-window','recover-report'));
