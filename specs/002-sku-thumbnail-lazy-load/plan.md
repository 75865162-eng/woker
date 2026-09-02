# Implementation Plan: SKU Thumbnail Lazy Load

**Branch**: `[002-sku-thumbnail-lazy-load]` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-sku-thumbnail-lazy-load/spec.md`

## Summary

Make the dashboard list render with lightweight thumbnails first, then defer heavier
SKU imagery and rich record content until the user opens a SKU detail view. The
change is focused on perceived speed and interaction flow, while preserving the
existing product data, edit behavior, and saved state.

## Technical Context

**Language/Version**: TypeScript with React 19 / Next.js 15

**Primary Dependencies**: Next App Router, Prisma, PostgreSQL, lucide-react, Tailwind CSS 4

**Storage**: PostgreSQL for product records; browser cache only for transient UI state

**Testing**: Targeted UI and API validation via existing lint/build checks and manual dashboard walkthrough

**Target Platform**: Web app

**Project Type**: Next.js frontend + API application

**Performance Goals**: List view should become usable before heavy SKU content is fetched; detail shell should appear before rich content finishes loading

**Constraints**: Preserve list semantics, SKU edit flow, saved filters, and existing product data model; avoid new global state or data migration

**Scale/Scope**: Single dashboard/workbench surface and its SKU detail modal/view

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Draft-first behavior is preserved because product edits still happen in the existing detail flow.
- Backward compatibility is preserved because product records and existing filters remain unchanged.
- Module isolation is preserved by keeping the change within product dashboard components and product API routes.
- Production readiness is preserved because the change targets perceived load order rather than changing business logic or storage boundaries.

## Project Structure

### Documentation (this feature)

```text
specs/002-sku-thumbnail-lazy-load/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── spec.md
├── tasks.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/components/products/product-workbench.tsx
src/components/products/product-workbench-shell.tsx
src/components/products/product-image-copy-gallery-modal.tsx
src/components/products/product-video-plan-modal.tsx
src/app/api/products/[sku]/route.ts
src/app/api/products/route.ts
src/lib/products/types.ts
src/lib/products/product-list-cache.ts
src/lib/products/product-list-summary.ts
```

**Structure Decision**: Keep the scope inside the existing product dashboard and SKU detail flow. No new routes, no new shared store, and no storage migration are required for this feature.

## Complexity Tracking

No constitution exceptions are needed.
