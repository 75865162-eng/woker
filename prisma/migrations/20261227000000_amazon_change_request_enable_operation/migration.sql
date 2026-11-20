-- The change-approval allow-list added the "enable-authorization" operation,
-- but the CHECK constraint on AmazonDataCenterChangeRequest was never extended
-- to include it. As a result, requesting a "re-enable authorization" approval
-- fails with SQLSTATE 23514 (check_violation), surfaced by Prisma as P2039.
-- Align the database constraint with the authoritative operation allow-list in
-- src/lib/amazon-sync/approval-policy.ts (operationTypes).
ALTER TABLE "AmazonDataCenterChangeRequest"
  DROP CONSTRAINT "AmazonDataCenterChangeRequest_operation_check";
ALTER TABLE "AmazonDataCenterChangeRequest"
  ADD CONSTRAINT "AmazonDataCenterChangeRequest_operation_check"
  CHECK ("operation" IN ('save-authorization','disable-authorization','enable-authorization','save-source','save-plan','run','control-task','validate-authorization','save-access-grant','adopt-identity','recover-finance-window','recover-report'));
