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
