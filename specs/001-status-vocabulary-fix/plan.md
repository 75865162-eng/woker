# Implementation Plan: Product Status Vocabulary Cleanup

**Branch**: `[001-status-vocabulary-fix]` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-status-vocabulary-fix/spec.md`

## Summary

Align the product workbench vocabulary so the top cards, filter controls, and table
headers use distinct labels for distinct concepts. This is a frontend-only copy and
label cleanup; the underlying status values, counts, filters, and saved selections
stay unchanged.

## Technical Context

**Language/Version**: TypeScript with React 19 / Next.js 15

**Primary Dependencies**: Next App Router, lucide-react, zustand, Tailwind CSS 4

**Storage**: N/A for this feature; existing product state and saved filters remain as-is

**Testing**: Targeted ESLint on product workbench components

**Target Platform**: Web app

**Project Type**: Next.js frontend application

**Performance Goals**: No measurable runtime change; copy updates must not add render cost

**Constraints**: Preserve current filter semantics and product list behavior; no API or data-model changes

**Scale/Scope**: Single workbench surface in `src/components/products/`

## Constitution Check

*GATE: Must pass before implementation and remain true after design.*

- Draft-first and backward compatibility are preserved because this change does not alter stored data or business flow.
- Business logic stays outside the UI because only presentation labels change.
- No silent data loss, hidden transitions, or storage boundary changes are introduced.
- Traceability is preserved through feature docs and targeted UI edits.

## Project Structure

### Documentation (this feature)

```text
specs/001-status-vocabulary-fix/
├── plan.md
├── spec.md
├── tasks.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/components/products/product-workbench.tsx
src/components/products/product-workbench-shell.tsx
src/components/products/product-workbench-model.ts
src/data/products.ts
```

**Structure Decision**: Keep the scope in the existing product workbench client
components. No new modules, routes, or shared state layers are required.

## Complexity Tracking

No constitution exceptions are needed.
