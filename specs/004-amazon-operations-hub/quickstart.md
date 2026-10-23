# Quickstart Validation: Amazon Operations Hub

1. Authenticate as a role with `operations:view` and open `/operations`.
2. Verify the page renders the active workspace and a visible `未配置` readiness state.
3. Select a read domain and request synchronization.
4. Verify the result says it was blocked because the connection is not configured; verify it appears in recent runs.
5. Authenticate as a role without the module permission and verify navigation and API access are denied.
6. Run `npm run test -- --test-name-pattern='Amazon sync|unsupported'`, `npm run lint`, `npm run typecheck`, and `npm run build`.

## Current Validation

- `npm run db:generate`: passed; this regenerated only the local Prisma Client and did not run a database migration.
- `npm run test -- --test-name-pattern='Amazon sync|unsupported'`: passed (102 tests in the repository test glob, including the two Operations Hub tests).
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; `/operations`, `/api/operations/readiness`, and `/api/operations/sync-runs` are present in the production route manifest.
- SP-API environment diagnostics: passed. The test verifies configuration status exposes only missing variable names and never secret values.
- Server-side configuration confirmation: covered by lint, typecheck, production build, and the Operations Hub configuration diagnostics test. This operation was not executed against a database because the migration remains intentionally unapplied.
- Sync idempotency: covered by the Operations Hub unit test; duplicate requests with a stable key are guarded at the database uniqueness boundary. The migration remains intentionally unapplied.
- SP-API client foundation: `npm run test` passed (112 tests), including a mock LWA token exchange, a signed Marketplace Participations request, 429 retry classification, invalid endpoint rejection, exact tenant-scope binding, sanitized Marketplace mapping extraction, FBA inventory response normalization, and inventory freshness classification. No Amazon request was made.
- Connection validation: implementation is bound to `AMAZON_SP_API_ALLOWED_ORGANIZATION_ID` and `AMAZON_SP_API_ALLOWED_WORKSPACE_ID`; the unit test covers exact-scope acceptance, cross-organization rejection, and missing-binding rejection. It was not run against Amazon because no controlled server configuration has been deployed.
- Marketplace mappings: successful connection validation persists only Marketplace ID, country code, display name, and domain name on the tenant-scoped connection record. This enables future synchronizers to resolve a real Marketplace ID without treating a UI marketplace code as an API identifier.
- Inventory snapshot boundary: the unapplied Operations Hub migration adds append-only `AmazonInventorySnapshot` storage. It is not yet populated because the dedicated worker has not been enabled.
- Inventory worker: `npm run worker:amazon-sync` is the dedicated Redis worker. It starts only after deployment; queue operations were validated through TypeScript, lint, and production build, but no local Redis or Amazon integration run was performed.
- Inventory visibility: Operations Hub summarizes only the latest successful inventory run in the active organization/workspace, reporting snapshot SKU count and key quantity totals without combining historical runs.
- `npm run typecheck`: passed after the SP-API client addition.
- Targeted `npm run lint -- src/lib/amazon/sp-api-client.ts src/lib/amazon/sp-api-config.ts tests/amazon-sp-api-client.test.ts`: passed.
- `npm run build`: passed after the read-only connection-validation route was enabled.
- Database migration and Amazon connectivity were not run. Migration requires the normal reviewed deployment path; Amazon connectivity requires user-provided SP-API authorization in a later phase.

## 2026-10-23 P0 catalog/inventory + replenishment validation

Implemented store-scoped Amazon catalog/inventory snapshots, explicit server seller/resource binding, page-bounded Product Center snapshot decoration, daily/changed-policy replenishment persistence and UI, and opt-in existing ERP historical sales mapping. No Amazon mutations or ProductRecord sync writes.

Validation:

- `npm run db:generate`: passed (client generation only).
- `npx prisma validate`: passed.
- `prisma migrate diff --from-schema <HEAD schema> --to-schema prisma/schema.prisma --script`: reviewed additive tables/columns/indexes. Migration handles both original SQL and Prisma index-name truncation variants; catalog schedule CHECK explicitly extended.
- `npm run test`: 137 passed, including official inventory envelope/nested totals, read-only catalog request shape, explicit seller mappings, schedule policy, full/partial history, new/mature demand, ETA shortage and source-presence validation.
- `npm run lint`, `npm run typecheck`, `git diff --check`: passed.
- `npm run build`: passed again on the final implementation (2026-10-23).

Not run: migration against a real PostgreSQL instance; authenticated browser/403/workspace switching with current new screens; Redis multi-process and Amazon calls; representative P95 dataset benchmarks. Prior browser inspection reached login and no credentials were provided. Seller ID binding is explicitly pending the user; no inference from accountKey, no fake successful runs. Actual rate-limit behavior and authorized catalog role acceptance must be verified in the seller's controlled environment. No production config/migration/deployment.

## Final correctness hardening (2026-10-23)

- Inventory quantities must be explicit nonnegative safe integers; missing/invalid quantities fail the run instead of being converted to zero. Valid zero and an explicit empty response remain supported.
- Plans retain the exact inventory run from the rows used, without a second latest-run query. Under the scoped transaction lock, older calculations cannot overwrite newer results for the same policy version. Failed calculations clear the inventory-run reference and preserve NEW lifecycle.
- Added exhaustive invalid/missing quantity regression and a stubbed service concurrency/provenance/failure regression; no external services or credentials used. The existing 137-test suite plus these two new tests pass (139 total).
- Typecheck and lint pass. Production build already passed on the P0 implementation; this follow-up changes only server validation/provenance and tests, with no schema, dependency, route or UI build changes, so it does not repeat that build. Live database lock behavior still requires the controlled multi-worker acceptance listed above.

## Isolated Operations browser regression (2026-10-23)

`npm run test:operations:browser` passes all 9 scenarios in Chromium using the real Operations component bundled by esbuild and test-only intercepted API responses. Coverage: six-domain freshness and STALE action; unknown inventory/catalog fields; PPC/orders placeholders; schedule read/edit controls; scoped manual idempotency; simulated 403; late inventory, metrics, readiness and manual-sync failures after a workspace switch. This exposed and fixed zero placeholders for unsynced quantities and stale error/loading feedback from a previous workspace. Late mutation responses also cannot set the new workspace's notice or busy state.

The harness does not run the Next auth middleware or route handlers. This is UI regression evidence only, not completed real-login/403/isolation or DB/Redis/Amazon acceptance. No credentials or network requests to external services. T035/T044/T045 remain open.
