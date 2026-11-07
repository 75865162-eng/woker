-- Read-only inventory. This file does not authorize access to any target.
-- Run only after the target identity and organization/workspace are approved.
-- psql variables required: organization_id, workspace_id. No credentials in args.
\set ON_ERROR_STOP on
\if :{?organization_id}
\else
  \echo 'Missing approved organization_id'
  \quit 2
\endif
\if :{?workspace_id}
\else
  \echo 'Missing approved workspace_id'
  \quit 2
\endif

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';

-- Fingerprint is for comparison, not authentication or proof of local origin.
-- A loopback connection can still be an SSH tunnel.
SELECT now() AS observed_at,
       md5(current_database()) AS database_fingerprint,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port,
       current_setting('transaction_read_only') AS read_only;

-- Read only reviewed public constraint definitions; no migration is run.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('"AmazonDomainObservation"'::regclass,
                   '"AmazonSyncSchedule"'::regclass)
  AND conname IN ('AmazonObservation_kind_check',
                  'AmazonSchedule_supported_enabled', 'AmazonSchedule_v2_policy')
ORDER BY conname;

-- No credential, raw report, business row, customer, name or policy JSON output.
-- 201 rows indicate that the receiving UI capacity needs separate review.
SELECT md5(s.id) AS source_ref, md5(s."sellerAccountId") AS seller_ref,
       s."marketplaceId", s.resource, s.enabled, s.revision,
       s."lastSuccessAt", s."rowCount",
       md5(s."authorizationId") AS authorization_ref,
       a.status AS authorization_status, a.revision AS authorization_revision,
       a."approvedRoles", a."rolesAttestedAt", a."identityEvidence",
       a."identityVerifiedAt", a."lastValidatedAt",
       (s."domainPolicy"->'collection' IS NOT NULL) AS has_collection,
       s."domainPolicy"#>>'{collection,from}' AS collection_from,
       s."domainPolicy"#>>'{collection,to}' AS collection_to,
       s."domainPolicy"#>>'{collection,maxTasks}' AS task_budget,
       CASE WHEN jsonb_typeof(s."domainPolicy"#>'{collection,asins}') = 'array'
            THEN jsonb_array_length(s."domainPolicy"#>'{collection,asins}') END AS candidate_asins
FROM "AmazonSyncDataSource" s
JOIN "AmazonSpApiAuthorization" a
  ON (a."organizationId", a."workspaceId", a.id)
   = (s."organizationId", s."workspaceId", s."authorizationId")
WHERE s."organizationId" = :'organization_id'
  AND s."workspaceId" = :'workspace_id'
  AND s.resource IN ('brand_analytics', 'catalog')
ORDER BY s.resource, s.id LIMIT 201;

SELECT md5("sourceId") AS source_ref, status, stage, count(*) AS task_count,
       max("updatedAt") AS latest_update,
       sum("apiRequests") AS recorded_requests
FROM "AmazonSyncRun"
WHERE "organizationId" = :'organization_id' AND "workspaceId" = :'workspace_id'
  AND resource = 'brand_analytics'
GROUP BY "sourceId", status, stage ORDER BY "sourceId", status, stage;

SELECT md5(p.id) AS plan_ref, md5(t."sourceId") AS source_ref,
       p.enabled, p.revision, p.mode, p."intervalMinutes", p."nextRunAt"
FROM "AmazonSyncSchedule" p
LEFT JOIN "AmazonSyncPlanTarget" t
  ON (t."organizationId", t."workspaceId", t."scheduleId")
   = (p."organizationId", p."workspaceId", p.id)
WHERE p."organizationId" = :'organization_id'
  AND p."workspaceId" = :'workspace_id' AND p.resource = 'brand_analytics'
ORDER BY p.id, t."sourceId" LIMIT 201;

ROLLBACK;
