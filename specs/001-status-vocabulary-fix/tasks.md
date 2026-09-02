# Tasks: Product Status Vocabulary Cleanup

**Input**: Design documents from `/specs/001-status-vocabulary-fix/`

## Phase 1: Setup

- [x] T001 Confirm feature scope and impacted files in `specs/001-status-vocabulary-fix/spec.md` and `specs/001-status-vocabulary-fix/plan.md`

## Phase 2: Foundational

- [x] T002 Verify no data model or API changes are required for this wording-only feature in `src/app/api/products/route.ts` and `src/lib/products/types.ts`

## Phase 3: User Story 1 - Distinguish summary cards (Priority: P1)

**Goal**: Top summary cards clearly read as separate concepts.

**Independent Test**: Open the product workbench and confirm the summary cards do not reuse a generic status label.

- [x] T003 Update top summary card labels and helper copy in `src/components/products/product-workbench.tsx`

## Phase 4: User Story 2 - Distinguish filters (Priority: P2)

**Goal**: Filter labels make it clear which concept each control narrows.

**Independent Test**: Inspect the filter bar and confirm the status-related controls use distinct vocabulary.

- [x] T004 Update filter labels for status-related controls in `src/components/products/product-workbench-shell.tsx`

## Phase 5: User Story 3 - Distinguish table headers (Priority: P3)

**Goal**: Table headers separate main status from workflow or exception information.

**Independent Test**: Inspect the table header row and confirm the status-related column is named explicitly.

- [x] T005 Rename the table status column and supporting copy in `src/components/products/product-workbench-shell.tsx`

## Phase 6: Polish

- [x] T006 Validate the updated workbench wording with `npx eslint src/components/products/product-workbench.tsx src/components/products/product-workbench-shell.tsx`

