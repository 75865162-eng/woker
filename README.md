This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Project Definitions

- Advertising data file definitions: [docs/amazon-ppc-advertising-data-definitions.md](docs/amazon-ppc-advertising-data-definitions.md)

## Amazon Orders P1/P2

Orders v2026-01-01 `searchOrders` supports approval-bound update windows and encrypted resumable cursors. Optional `getOrder` detail runs within the same durable job, with per-order recovery, exact decimal money and PII restricted to encrypted raw envelopes. The official v2026-01-01 contract does not require Orders RDT; restricted roles and explicit business purpose are required for configured PII datasets. Finances P3 and FBA warehouse-received Returns P4 are implemented locally.

- Configuration, required-role attestation, rate budgets, migration/rollback and manual decisions: [Orders P1](docs/amazon-orders-p1.md).
- Detail contract, PII handling and P2 validation: [Orders P2](docs/amazon-orders-p2-plan.md).
- Offline tests (local HTTP fixtures and disposable Docker PostgreSQL/Redis): `npm run test:amazon-orders:offline`.
- Detail policy is opt-in. Configure only necessary datasets; for datasets that may return PII, attest a PII-capable restricted role and non-sensitive purpose code. Amazon visibility still depends on fulfillment channel, country, and order status; role attestation does not guarantee every PII field is returned. Raw payloads remain encrypted and are not exposed by the standard UI.
- Expanded existing sync regression: `npm run test:amazon-sync:offline`.
- Operations policy: rotate client secrets every 180 days and handle refresh tokens with annual reauthorization; no rotation, live sync or production migration is triggered by tests.
- [Validation and remaining gates](docs/amazon-orders-p1-validation.md); [local PR draft](docs/amazon-orders-p1-pr.md).

## Amazon Finances P3

Finances v2024-06-19 `listTransactions` reuses the existing approval/service/processor/client path. Each request requires the attested **Finance and Accounting** role and an explicit seller-wide policy covering every verified participating site. The selected source site is an administrative anchor; records use actual returned attribution. Missing/conflicting attribution is encrypted and excluded from ordinary financial facts; outside-scope sellers/sites reject the entire page. This phase exposes finance only to live organization owner/database_admin, and never through site-only MCP grants.

- [Plan, official contract and manual decisions](docs/amazon-finance-p3-plan.md), [validation](docs/amazon-finance-p3-validation.md), [local PR description](docs/amazon-finance-p3-pr.md).
- `npm run test:amazon-finance:offline`: local fixture fetch, disposable PostgreSQL/Redis, unit/integration/browser regression. `npm run test:amazon-sync:offline` covers all six implemented resources. Requires preinstalled fixture images; never downloads images or loads dotenv.
- Configure bounded posted windows, overlap, safety lag and seller/app operation budget (at most 0.5 rps / burst 10). Persisted tokens, raw and unknown-attribution data are encrypted. Pages commit atomically; retries preserve the failed-page cursor. 403 stops and marks authorization unavailable until explicitly revalidated.
- JSON number amounts retain their original text and NUMERIC(65,30) precision. FX source/version/validity/rounding is explicit approved configuration; missing rates produce UNCONVERTED, with no implicit parity or cross-currency totals.
- Window completion is transport progress, **not final settlement completeness**. Recent events may be delayed and deferred statuses outside the configured overlap need a separately reviewed reconciliation plan. No automatic full-history scan or schedule.
- Migration `20261105050000_amazon_finance_transactions` is additive and tested only against disposable data. Production review must assess DDL locks, row/raw retention and page transaction capacity; no real migration, task, credential rotation or deployment was performed. Client secret rotation remains 180 days and refresh tokens use conservative annual reauthorization.

## Getting Started

For a local database restore, create the bootstrap super account after migrations:

```bash
npm run db:seed-admin
```

The development bootstrap account is configured through `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` in `.env`. Use a strong password before any shared or production-like environment.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Amazon FBA returns P4

Returns reuses **Reports v2021-06-30**, the existing client, approval, processor and encrypted archive. Only FBA warehouse-received returns are supported via the allowlisted `returnReportTypes.FBA_RECEIVED`; the type is not scheduled. Required attested role: **Pricing OR Amazon Fulfillment**, plus actual FBA seller eligibility. This report has no documented restricted-role requirement; no RDT is requested, and other/restricted report types are rejected.

- [Approved plan and official URLs](docs/amazon-returns-p4-plan.md), [validation and manual decisions](docs/amazon-returns-p4-validation.md), [local PR description](docs/amazon-returns-p4-pr.md).
- `npm run test:amazon-returns:offline` runs local fixture units, disposable PG/Redis integration and Orders/Finance/Returns browser regressions. `npm run test:amazon-sync:offline` also verifies the original Listings, FBA inventory and sales reports. No dotenv, live credentials or real Amazon requests.
- Configure `returnsPolicy` explicitly: report type, initial UTC window, overlap, safety delay (at least one day for daily-updated content), marketplace timezone, application ID, parser batch/row limits, bounded polling and operation quotas. Official default budgets are createReport **0.0167 rps / burst 15**, getReport **2 rps / burst 15**, getReportDocument **0.0167 rps / burst 15**. Shared seller/application token buckets honor lower rate headers; persisted delays release the worker.
- Lifecycle: create → bounded backoff poll (404 means pending) → metadata → bounded plain/GZIP download → encrypted original → transactional row batches. Persisted encrypted state resumes the same report and batch under a new approved run. An uncertain create response requires manual investigation; never auto-create another report. No recurring returns jobs are enabled.
- Query one published source/report at a time, with server paging, UTC dates, raw reasons/status and scoped order/ASIN association. Idempotency is tenant/seller/site/reportId/rowHash; identical rows collapse. Different reports can overlap and must not be totaled as distinct events. Unmatched orders remain external identifiers. No inventory, refund, finance or order-status mutation.
- Original report text may contain customer comments: encrypt it at rest, with no plaintext temporary file, free-text fact fields or normal UI download. Dates require explicit offset; ambiguous formats fail closed pending an approved parser policy. No inferred reason mapping.
- Migration `20261105060000_amazon_returns_reports` is additive and tested only on disposable data. Review production DDL locks, retention/access policy, file bounds and batch/P95 capacity before activation. Rollback disables returns sources/jobs and preserves evidence; never automatically drop tables. Client secrets rotate every **180 days**; refresh tokens use **annual reauthorization**. No production change, rotation or deployment is implied.
