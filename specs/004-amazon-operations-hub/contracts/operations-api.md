# Operations API Contract

All endpoints require the existing authenticated session and derive `organizationId` from that user. The active `workspaceId` comes from the scoped request header/query following `workspaceScopeFromRequest`. Read responses use `Cache-Control: no-store` and never include Amazon credentials.

## GET /api/operations/freshness

Requires `operations:view`. The ads source metadata is omitted when the user lacks `sellfox:view`.

Returns `{ connection, runs, scope, inventory, domains, generatedAt }`. `domains` contains `ads`, `orders`, `inventory`, `catalog`, `finance`, and `fulfillment`; each value is a `DomainFreshnessSummary` with `status`, `source`, run timestamps/status, a non-secret reason, and a recommended action. Status values are `NOT_SYNCED`, `FRESH`, `STALE`, `BLOCKED`, or `FAILED`.

Ads freshness reads the existing `SellfoxProductDailySnapshot` reporting data, not Amazon Ads API. Its latest report date older than three days is `STALE`. Inventory retains the existing summary and configured freshness threshold. Unimplemented Amazon domains are `BLOCKED` unless a recorded run shows a failure.

## GET /api/operations/readiness

Backward-compatible alias for the readiness response. Requires `operations:view`.

## GET /api/operations/inventory/snapshots

Requires `operations:view`. Accepts `page` (default 1), `pageSize` (default 50, max 200), and optional case-insensitive `sku` substring. Results are restricted to the latest successful inventory run for the active organization/workspace.

Returns `{ rows, pagination: { page, pageSize, total, pageCount }, snapshot: { status, syncRunId, capturedAt } }`. No successful inventory run returns an empty result with `NOT_SYNCED`.

## GET /api/operations/metrics/daily

Requires both `operations:view` and `sellfox:view`. Accepts optional `from`, `to` (ISO date, default the last seven days), `sku`, `asin`, `page`, and `pageSize` (max 200). The date range is inclusive and limited to 90 days. Rows group by report date, SKU, ASIN, and currency from the existing `SellfoxProductDailySnapshot` table. PPC `PerformanceRow` has no report date or SKU, so the service does not infer daily product metrics from it.

Returns `{ rows, pagination, source, sourceStatus, sourceNote, emptyReason }`. Each row has `sales`, `adSpend`, and `tacos`. A non-positive or missing sales total becomes `sales: null`; TACOS is `adSpend / sales * 100` and becomes null when either input is unavailable. `fieldNotes` explains null values. This read API does not invoke an Amazon Ads synchronizer.

## POST /api/operations/sync-runs

Requires `operations:create`. Accepts `{ resource?: "readiness" | "ads" | "orders" | "inventory" | "catalog" | "finance" | "fulfillment", idempotencyKey?: string }` and uses the request workspace scope. The optional idempotency key may contain only letters, numbers, `.`, `_`, `:`, and `-`, with a maximum length of 160.

Without a configured connection, returns HTTP 409 with `{ run, error }`; the run is `BLOCKED` and no Amazon request is attempted. Only `inventory` can be queued when connection, allowed tenant scope, Marketplace mapping, and Redis worker configuration are ready. Other domains are recorded as `BLOCKED`. An unsupported resource that reaches the worker is recorded `FAILED` and never reported as successful.

## POST /api/operations/connection/validate

Requires `operations:edit`. The process must have the required SP-API variables plus `AMAZON_SP_API_ALLOWED_ORGANIZATION_ID` and `AMAZON_SP_API_ALLOWED_WORKSPACE_ID` matching the active tenant scope. It performs one read-only Marketplace Participations request and stores a `SUCCEEDED` or `FAILED` readiness audit run. Responses never include credential values, raw authorization headers, raw upstream error bodies, orders, inventory, advertising data, or any Amazon write action.

## AmazonAgentActionAudit

The database model reserves organization/workspace-scoped preview and confirm records with idempotency key and old/new values. No MVP route can create a confirm or execute a write to Amazon.
