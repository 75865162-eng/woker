# PR Draft: Orders P2 Detail and PII-Safe Persistence

**Status:** local draft only. No Git commit, GitHub PR, production migration, or deployment was created. The worktree contains earlier unrelated/unreviewed changes; do not push or package until the full changed/untracked-file set and P1/P2 split are reviewed.

## Problem and behavior

Orders P1 stored a resumable order list but had no approved path to retrieve item and proceeds details. P2 adds optional `getOrder` v2026-01-01 detail work to the existing orders job. A source remains list-only unless a reviewed detail policy is explicitly configured and included in a separate execution approval. Detail work is durable per order, survives worker failure without rescanning completed pages, and records exact decimal strings alongside NUMERIC values.

Amazon's official v2026-01-01 documentation states Orders PII does not require RDT. The implementation therefore uses the existing LWA token and configured role attestation, with explicit purpose/datasets; all raw payloads remain encrypted and no standard query/UI exposes buyer or recipient data. It does not add an Orders v0 or Tokens API path.

## Design and risk

- Existing SP-API client, Operations Hub service/processor, approval/fencing, cursor, per-operation seller/application limiter, Prisma fact storage and offline runner are extended in place.
- `AmazonOrderRecord` remains the order identity; `AmazonOrderItemRecord` is keyed by order record + `orderItemId`; pending detail versions have a unique source/order/list-update/policy key.
- List and detail completeness are distinct. PII visibility varies by role, country, fulfillment channel and status; a role attestation does not promise every field will be returned.
- NUMERIC(65,30) retains a separate original string and rejects values outside 35 integer/30 fractional digits rather than rounding silently.
- Migration is additive and rollback is feature/source disablement; production schema rollback or data deletion is not automated.
- Detail requests add up to one request per listed order, bounded by policy `maxOrders`, at 0.5 rps / burst 30. Large backlogs require time; no latency claim is made.

## Official references

- Orders API v2026-01-01 `getOrder`, rate 0.5 rps/burst 30: https://developer-docs.amazon.com/sp-api/reference/getorder-3
- Orders PII access, role and field conditions, no RDT: https://developer-docs.amazon.com/sp-api/docs/access-orders-pii
- Order information/datasets: https://developer-docs.amazon.com/sp-api/docs/get-order-information
- Migration guide: https://developer-docs.amazon.com/sp-api/docs/orders-api-migration-guide

## Validation

`npm run test:amazon-orders:offline`: 58 unit/regression + 12 disposable PostgreSQL integration + 3 browser fixture tests. `npm test`: 736 passed. TypeScript passed; lint had zero errors and five pre-existing warnings with the existing generated `.next-amazon-live` directory excluded; changed-file lint was clean. Prisma schema validation/generation and P1+P2 migrations ran only in temporary configuration/database. No live endpoint, credential, production data, sync, migration, or deployment participated. Detailed record: `docs/amazon-orders-p2-validation.md`.
