# Tasks: Amazon Operations Hub

## Phase 1: Setup

- [X] T001 Create Operations Hub specification and design artifacts in specs/004-amazon-operations-hub/

## Phase 2: Foundational

- [X] T002 Add organization/workspace-scoped Amazon connection and sync-run Prisma models in prisma/schema.prisma
- [X] T003 Add the migration in prisma/migrations/20261022010000_add_amazon_operations_hub/migration.sql
- [X] T004 Add the `operations` permission module and route mapping in src/lib/accounts/permissions.ts

## Phase 3: User Story 1 - See Amazon operating readiness (P1)

- [X] T005 [US1] Implement tenant-scoped readiness query types and service in src/lib/operations/types.ts and src/lib/operations/readiness.ts
- [X] T006 [US1] Implement the protected readiness route in src/app/api/operations/readiness/route.ts
- [X] T007 [US1] Add the first-level Operations Hub navigation item in src/components/app-shell/app-shell-client.tsx
- [X] T008 [US1] Create the Operations Hub route in src/app/operations/page.tsx
- [X] T009 [US1] Create the loading, empty, error, and ready states in src/components/operations/operations-hub-workbench.tsx

## Phase 4: User Story 2 - Start a safe synchronization request (P1)

- [X] T010 [US2] Implement the blocked-run creator in src/lib/operations/readiness.ts
- [X] T011 [US2] Implement the protected sync-run route in src/app/api/operations/sync-runs/route.ts
- [X] T012 [US2] Connect the safe sync request control and recent-run refresh in src/components/operations/operations-hub-workbench.tsx

## Phase 5: Polish and validation

- [X] T013 Add operations readiness tests in tests/operations-readiness.test.ts
- [X] T014 Run targeted tests, lint, typecheck, and build; record outcomes in specs/004-amazon-operations-hub/quickstart.md
- [X] T015 Add server-only SP-API configuration diagnostics in src/lib/amazon/sp-api-config.ts and expose only missing variable names in the Operations Hub
- [X] T016 Add a permission-protected local environment validation action and auditable readiness record without Amazon network traffic
- [X] T017 Add organization/workspace-scoped sync idempotency keys and duplicate-request guards before any future external execution

## Phase 6: Server-side integration foundation

- [X] T018 Add a server-only SP-API client with LWA refresh-token exchange, SigV4 signing, timeout handling, and sanitized errors; do not attach it to a route or worker yet
- [X] T019 Add an organization/workspace-bound, read-only Marketplace Participations connection validation action with success and failure audit records; keep data sync blocked
- [X] T020 Persist sanitized Marketplace Participation mappings after connection validation so later domain synchronizers use real Amazon Marketplace IDs
- [X] T021 Define append-only, tenant-scoped FBA inventory snapshot storage and pure response normalization; do not attach external execution yet
- [X] T022 Add a Redis-backed inventory sync queue and dedicated worker with atomic run claiming, bounded pagination, retry/backoff, stale-run recovery, heartbeat, and all-or-nothing snapshot persistence
- [X] T023 Show active-workspace inventory freshness and totals from the latest successful snapshot run without aggregating historical runs
- [X] T024 Add bounded inventory freshness status and make inventory the default runnable domain in Operations Hub

## Phase 7: Operations read surface

- [X] T025 Extend readiness with uniform freshness summaries for all six domains while retaining inventory totals
- [X] T026 Add authenticated, workspace-scoped freshness, paginated inventory snapshot, and daily metrics APIs
- [X] T027 Rework Operations Hub into connection health, inventory, daily metrics, and sync history sections
- [X] T028 Reserve preview/confirm/idempotency/old/new fields in AmazonAgentActionAudit without adding Amazon writes
- [X] T029 Add freshness and nullable metric mapping tests; document worker and internal acceptance flow


## Phase 8: Schedules and tabbed internal workbench

- [X] T030 Add default-disabled, scoped schedules and migration; disallow enabling unsupported domains
- [X] T031 Add view/edit schedules API and nextScheduledAt freshness
- [X] T032 Integrate due-run enqueue into dedicated worker; serialize manual/scheduled scope and cross-run execution
- [X] T033 Add seven tabs, schedule controls, placeholders, run filters/details and truthful PPC missing-source state
- [X] T034 Add policy/lock regression tests, fix persisted marketplace mapping and document internal acceptance
- [ ] T035 Execute controlled PostgreSQL/Redis multi-worker, logged-in browser and Amazon acceptance (requires configured environment)
