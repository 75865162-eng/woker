# Implementation Plan: Amazon Operations Hub

**Branch**: `004-amazon-operations-hub` | **Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)

## Summary

Add a role-protected Operations Hub page and a server-side readiness API. Persist only non-secret connection metadata and sync-run audit records. The initial sync endpoint records a blocked request when no enabled connection exists; it never calls Amazon.

## Technical Context

**Language/Version**: TypeScript, React 19, Next.js 15 App Router

**Primary Dependencies**: Prisma 7, PostgreSQL, Tailwind 4, lucide-react

**Storage**: PostgreSQL for connection metadata and sync-run history; no browser persistence for credentials

**Testing**: Node TypeScript tests, ESLint, TypeScript, production build

**Target Platform**: Next.js web application and Node.js route handlers

**Performance Goals**: readiness page and API p95 below 500ms for the most recent 20 sync runs

**Constraints**: tenant/workspace isolation; no credential persistence; no outbound Amazon request; no modification of ProductRecord or existing PPC state

**Scale/Scope**: one connection per organization/workspace/provider, first release supports readiness and blocked runs only

## Constitution Check

The project constitution contains placeholders only. Repository governance in AGENTS.md applies: use minimal changes, PostgreSQL facts with derived views, explicit permissions, no secrets, and no Amazon writes without approval and a real adapter.

## Research

See [research.md](research.md). The selected design reuses the existing permission and workspace scope contracts rather than creating a parallel auth mechanism.

## Project Structure

```text
prisma/
├── schema.prisma
└── migrations/20261022010000_add_amazon_operations_hub/
src/
├── app/operations/page.tsx
├── app/api/operations/readiness/route.ts
├── app/api/operations/sync-runs/route.ts
├── components/operations/operations-hub-workbench.tsx
└── lib/operations/
    ├── readiness.ts
    └── types.ts
```

**Structure Decision**: Keep operational facts and readiness queries in `src/lib/operations`; routes enforce existing permissions; the client workbench contains only presentation and safe sync-request interaction.

## Complexity Tracking

No justified violation. The feature adds two small data entities instead of changing existing product or PPC fact models.


## Scheduled internal operations extension (2026-10-23)

Seven tabs in the existing /operations workbench: overview/sync/inventory/ads/orders/catalog/runs. AmazonSyncSchedule stores scoped resource, intervalMinutes, enabled, lastEnqueuedAt and actor timestamps. All schedules default disabled; inventory alone supports execution. The dedicated worker polls every 30 seconds, only enqueues runs, shares manual enqueue locks and uses session locks for cross-run execution. Unsupported domains stay NOT_SYNCED/BLOCKED. Existing PPC data lacks trustworthy daily SKU/ASIN mapping, so the daily API explicitly returns NOT_SYNCED with nullable metrics and a PPC deep link. No ProductRecord writes or Amazon mutations. See docs/amazon-operations-hub.md for contracts, rollback and acceptance.
