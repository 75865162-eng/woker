# Data Model: Amazon Operations Hub

## AmazonIntegrationConnection

| Field | Rules |
|---|---|
| organizationId, workspaceId | Required tenant scope; composite uniqueness with provider |
| provider | Fixed `amazon_sp_api` for this release |
| status | `NOT_CONFIGURED`, `CONFIGURED`, `DISABLED`, or `ERROR` |
| enabledDomains | JSON array of supported read domains |
| marketplaceParticipations | Non-secret Marketplace ID, country-code, display-name, and domain mappings obtained from successful connection validation |
| lastValidatedAt, lastSyncAt | Nullable operational timestamps |
| statusMessage | Non-secret operator-visible status |

Credentials, refresh tokens, authorization codes, and API secrets are not fields of this entity.

## AmazonSyncRun

| Field | Rules |
|---|---|
| organizationId, workspaceId, requestedByUserId | Required ownership and actor fields |
| resource | Requested read domain, default `readiness` |
| idempotencyKey | Optional stable caller key, unique within organization and workspace |
| status | `BLOCKED`, `QUEUED`, `RUNNING`, `SUCCEEDED`, or `FAILED` |
| summary | Structured non-secret result metadata |
| error | Sanitized operational failure reason only |
| startedAt, finishedAt | Run lifecycle timestamps |

`AmazonIntegrationConnection` has many `AmazonSyncRun` records. Neither entity is a source of truth for product, inventory, or financial business facts.

If a caller repeats a request with the same `idempotencyKey`, the system returns the original run instead of creating or executing another one. Reusing a key for a different resource is rejected.

## AmazonInventorySnapshot

| Field | Rules |
|---|---|
| organizationId, workspaceId, marketplaceId | Required read scope; never inferred across tenants |
| syncRunId | The immutable synchronization run that produced this snapshot |
| sellerSku, condition | Per-run natural key; rows without seller SKU are discarded before persistence |
| quantity fields | Non-negative integer quantities from Amazon FBA Inventory summaries |
| capturedAt | Timestamp of the source snapshot, distinct from record creation time |

Inventory snapshots are append-only observations. They do not write back to `ProductRecord`, reserve stock, or perform ERP inventory calculations in this phase.

Operations Hub reads its inventory summary only from the latest successful `AmazonSyncRun` within the active organization and workspace. It never aggregates multiple historical runs together.

## DomainFreshnessSummary

This is a read contract, not a persisted entity. It contains the resource, `NOT_SYNCED` / `FRESH` / `STALE` / `BLOCKED` / `FAILED` state, source label, latest successful and attempted timestamps, latest attempt status/error, reason, and recommended action. Ads freshness uses the existing product daily reporting table; the other Amazon domains use `AmazonSyncRun` state. Inventory continues to expose its established quantity summary separately.

## Operations daily metrics

Daily metrics are grouped from `SellfoxProductDailySnapshot` within the active organization/workspace and report date. Sales, ad spend, and TACOS are returned as nullable read values with field notes. This API does not persist a duplicate read model and does not trigger Amazon Ads synchronization.

## AmazonAgentActionAudit

| Field | Rules |
|---|---|
| organizationId, workspaceId, actorUserId | Required scope and initiating user |
| actionType, targetType, targetId | Describes a future proposed operation and target |
| status | Starts at `PREVIEW`; future transitions require explicit confirmation |
| idempotencyKey | Optional, unique within organization and workspace |
| preview, oldValues, newValues | Structured proposal and before/after data; never secrets |
| confirmedAt, expiresAt | Nullable lifecycle timestamps |

This MVP only adds the schema and migration. No code writes the audit record and no code executes Amazon changes. Future write features must enforce preview, confirmation, idempotency, and audit before enabling any Amazon mutation.


## Scheduled internal operations extension (2026-10-23)

Seven tabs in the existing /operations workbench: overview/sync/inventory/ads/orders/catalog/runs. AmazonSyncSchedule stores scoped resource, intervalMinutes, enabled, lastEnqueuedAt and actor timestamps. All schedules default disabled; inventory alone supports execution. The dedicated worker polls every 30 seconds, only enqueues runs, shares manual enqueue locks and uses session locks for cross-run execution. Unsupported domains stay NOT_SYNCED/BLOCKED. Existing PPC data lacks trustworthy daily SKU/ASIN mapping, so the daily API explicitly returns NOT_SYNCED with nullable metrics and a PPC deep link. No ProductRecord writes or Amazon mutations. See docs/amazon-operations-hub.md for contracts, rollback and acceptance.


## P0 catalog and replenishment extension (2026-10-23)

Append AmazonCatalogSnapshot, nullable sellerAccountId on historical AmazonInventorySnapshot (never infer/backfill ownership), AmazonReplenishmentPolicy and AmazonReplenishmentPlan. Composite business key is organization/workspace/SellerAccount/Amazon Marketplace/Seller SKU. Catalog/inventory still use scoped SyncRun + locks + bounded retry, stage before atomic commit. Product list preserves original read path and decorates only the current page after cache, with operations:view and no master writes. Replenishment runs in the dedicated worker, stores input snapshot/result/version/errors, daily or after policy modification, and never emits procurement. Explicit internal daily-report source additionally requires sellfox:view; no daily missing-value interpolation. Migration review and controlled real integrations are pending Seller ID binding. Rollback disables plans/policies and reverts application while retaining new tables.
