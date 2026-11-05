-- Remove unused tables from the retired Amazon Data Hub implementation.
-- The original migration remains in history for reproducible fresh installs.
DROP TABLE IF EXISTS "AmazonPpcWriteIntent";
DROP TABLE IF EXISTS "AmazonSkuOpsDailyFact";
DROP TABLE IF EXISTS "AmazonDataHubFreshness";
DROP TABLE IF EXISTS "AmazonDataHubConnection";
