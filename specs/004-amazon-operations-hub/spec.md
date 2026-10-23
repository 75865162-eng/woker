# Feature Specification: Amazon Operations Hub

**Feature Branch**: `004-amazon-operations-hub`

**Created**: 2026-10-22

**Status**: P0 catalog/inventory and replenishment implementation; controlled acceptance pending

**Input**: Extend the internal Amazon Operations Hub so operators can see connection health, inventory freshness, existing daily advertising/sales reports, and sync history, with only read-only Amazon inventory synchronization enabled.

## User Scenarios & Testing

### User Story 1 - See Amazon operating readiness (Priority: P1)

An authorized operator opens the existing primary navigation entry and sees the selected workspace's connection state, six-domain freshness, inventory summary, latest sync state, and the exact next setup step.

**Why this priority**: A trustworthy sync foundation must make missing credentials and stale data visible before operational decisions are made.

**Independent Test**: An authenticated authorized user can open the page without Amazon credentials and sees an explicit "not configured" state rather than fabricated metrics.

**Acceptance Scenarios**:

1. **Given** no Amazon connection exists for the active workspace, **When** the user opens Operations Hub, **Then** all six domain states are explicit and unimplemented Amazon domains are not represented as successful.
2. **Given** an inventory snapshot is older than the configured freshness threshold, **When** the user opens Operations Hub, **Then** the page shows `STALE`, its reason, and a recommended action.
3. **Given** a connection and sync runs exist, **When** the user opens Operations Hub, **Then** the page shows only records belonging to the active organization and workspace.

---

### User Story 2 - Start a safe synchronization request (Priority: P1)

An authorized operator requests an Amazon data sync and receives an auditable, deterministic result. Inventory and catalog may enter the Amazon worker only with explicit server-side SellerAccount/Seller ID/Marketplace and authorized-resource bindings. Other domains are blocked.

**Why this priority**: The UI must not imply that a sync occurred when the integration is not ready.

**Independent Test**: A sync request without configured credentials returns a blocked status and an audit-ready run record scoped to the active workspace.

**Acceptance Scenarios**:

1. **Given** no enabled Amazon connection, **When** a user requests a sync, **Then** the system records a blocked run with a non-secret reason and performs no external request.
2. **Given** a configured, authorized connection and Redis worker, **When** a user requests inventory sync, **Then** only the active workspace inventory is read and persisted as snapshots.
3. **Given** a user requests an unimplemented Amazon domain, **When** the request is handled, **Then** it is recorded as `BLOCKED` and never enters the Amazon worker.
4. **Given** the user lacks create permission, **When** they request a sync, **Then** the system rejects the request.

---

### User Story 3 - Prepare future operations work (Priority: P2)

An operator can see the intended sync domains and the read-only operating sequence, while write actions remain unavailable until separate approval and execution work is delivered.

**Why this priority**: It establishes a clear roadmap without introducing live Amazon changes prematurely.

**Independent Test**: The page presents domains and next steps while no control can change Amazon inventory, prices, listings, or advertising.

### User Story 4 - Review daily operating metrics (Priority: P1)

An authorized operator filters daily sales and ad spend by SKU or ASIN and date range alongside the current inventory snapshot, using existing reporting data without starting a second Amazon Ads integration.

**Independent Test**: Existing product daily report rows appear by date and SKU/ASIN. Missing or zero sales produce nullable sales and TACOS values with field-level explanations.

### Edge Cases

- Missing or partially selected workspace scope must not expose another organization or workspace's connection status.
- Database-unavailable development mode must render an explicit unavailable state, not synthesized data.
- Repeated blocked requests must remain separately auditable and must never create Amazon API traffic.
- Empty sales data must stay null in the daily metrics API and must not be inferred from inventory or PPC workbook upload time.
- A failed inventory retry must delete only the failed run's partial snapshots and preserve prior successful runs.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST expose Operations Hub as a first-level navigable module protected by its own role permission.
- **FR-002**: The system MUST scope connection and sync records by organization and workspace.
- **FR-003**: The system MUST return a consistent freshness summary for ads, orders, inventory, catalog, finance, and fulfillment, including non-secret reasons and recommended actions.
- **FR-004**: The system MUST allow only configured, scope-bound, read-only inventory and catalog synchronization with explicit seller binding; unimplemented domains MUST be recorded `BLOCKED` and MUST NOT contact Amazon.
- **FR-005**: The system MUST retain a structured sync-run record for accepted or blocked requests.
- **FR-006**: The MVP MUST remain read-only toward Amazon and must not collect or persist credentials in browser state.
- **FR-007**: The system MUST continue to preserve existing Product Center, PPC, Logistics, and Agent workflows.
- **FR-008**: The system MUST expose organization/workspace-scoped read-only APIs for freshness, inventory snapshots, and daily sales/ad-spend metrics.
- **FR-009**: The system MUST read daily metrics from an existing report source and return null with an explanation when a metric is unavailable.
- **FR-010**: The system MUST reserve preview/confirm/idempotency/old/new audit fields for future Agent actions without enabling an Amazon write path.

### Key Entities

- **Amazon Connection**: Non-secret connection metadata for one organization and workspace, including enabled state and allowed data domains.
- **Amazon Sync Run**: A requested synchronization attempt, its status, timestamps, scoped resource domain, summary, and non-secret error.

## Success Criteria

### Measurable Outcomes

- **SC-001**: An authorized user reaches the Amazon readiness view in one navigation action.
- **SC-002**: A readiness request returns only data from the user's organization and active workspace.
- **SC-003**: A blocked synchronization attempt for any unimplemented domain produces no external Amazon traffic and returns a visible reason within 2 seconds under normal local conditions.
- **SC-004**: Existing primary navigation destinations remain accessible to their currently authorized roles.
- **SC-005**: The inventory and daily metrics APIs return rows only for the active organization/workspace and use bounded pagination/date ranges.

## Assumptions

- Existing session, organization, workspace, and role permission mechanisms are reused.
- Amazon SP-API credentials are supplied only through controlled server environment configuration and are never stored in browser state.
- Read-only FBA inventory synchronization is enabled; orders, catalog, finance, fulfillment, Amazon Ads synchronization, and all writeback execution remain out of scope.


## Scheduled internal operations extension (2026-10-23)

Seven tabs in the existing /operations workbench: overview/sync/inventory/ads/orders/catalog/runs. AmazonSyncSchedule stores scoped resource, intervalMinutes, enabled, lastEnqueuedAt and actor timestamps. All schedules default disabled; inventory alone supports execution. The dedicated worker polls every 30 seconds, only enqueues runs, shares manual enqueue locks and uses session locks for cross-run execution. Unsupported domains stay NOT_SYNCED/BLOCKED. Existing PPC data lacks trustworthy daily SKU/ASIN mapping, so the daily API explicitly returns NOT_SYNCED with nullable metrics and a PPC deep link. No ProductRecord writes or Amazon mutations. See docs/amazon-operations-hub.md for contracts, rollback and acceptance.


## P0 extension — approved 2026-10-23

User authorized implementation while Seller ID/accountKey mapping will be supplied separately. No inferred seller identity or real Amazon configuration changes. Add independent AmazonCatalogSnapshot and store-scoped inventory, and attach page-bounded DB snapshots to Product Center without changing its source of truth. Add daily/changed-policy read-only replenishment plans, with explicit store/market/SKU identity, source annotations, complete dated sales, new/mature separation, known-ETA receipts, production/domestic/ocean lead times and optional documented seasonality/profit/ACOS. Unknown required inputs => NEEDS_DATA, never fake units. Manual reference maintenance lives outside ProductRecord. Existing ERP daily history is opt-in with sellfox:view and exact original-field presence validation. P1 profit/Ads writes and P2 notifications remain out of scope. See current docs/amazon-operations-hub.md, which supersedes the historical inventory-only sections above.
