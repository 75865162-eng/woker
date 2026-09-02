# Tasks: SKU Thumbnail Lazy Load

**Input**: Design documents from `/specs/002-sku-thumbnail-lazy-load/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare shared preview and hydration boundaries

- [x] T001 [P] Add lightweight product preview helpers in `src/components/products/product-workbench-data.ts` for list-row to shell conversion and detail merge
- [x] T002 [P] Tighten product workbench list-state typing in `src/components/products/product-workbench.tsx` so list responses are treated as lightweight previews

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core UI state needed before any story-specific work can land

- [x] T003 [P] Add explicit preview-vs-full-detail loading state handling in `src/components/products/product-workbench.tsx`
- [x] T004 [P] Align product list row rendering boundaries in `src/components/products/product-workbench-shell.tsx` with thumbnail-only presentation and fallback imagery

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Fast list scanning (Priority: P1) 🎯 MVP

**Goal**: The dashboard list stays fast and readable with thumbnail-sized images only

**Independent Test**: Open the dashboard and confirm the product list renders with thumbnail cells and stable fallback visuals without waiting for heavy detail content

### Implementation for User Story 1

- [x] T005 [US1] Update the product table image cell sizing and thumbnail presentation in `src/components/products/product-workbench-shell.tsx`
- [x] T006 [P] [US1] Ensure the list renderer uses the lightweight preview fields only in `src/components/products/product-workbench.tsx`
- [x] T007 [US1] Preserve the empty-image placeholder path for list rows in `src/components/products/product-workbench-shell.tsx`

**Checkpoint**: User Story 1 should be independently usable as the MVP

---

## Phase 4: User Story 2 - Load detail on demand (Priority: P2)

**Goal**: Opening a SKU shows a usable shell first, then fills in heavier content afterward

**Independent Test**: Open a SKU and verify the detail shell appears before large images and rich content finish loading

### Implementation for User Story 2

- [x] T008 [US2] Open the SKU editor immediately from the selected list preview in `src/components/products/product-workbench.tsx`
- [x] T009 [P] [US2] Hydrate the selected SKU with the full product payload in the background and merge it into the open shell in `src/components/products/product-workbench.tsx`
- [x] T010 [US2] Hide or skeletonize heavy image-dependent sections until detail hydration is complete in `src/components/products/product-workbench.tsx`

**Checkpoint**: User Story 1 and User Story 2 should both work independently

---

## Phase 5: User Story 3 - Preserve graceful fallback (Priority: P3)

**Goal**: Slow or failed heavy-content loads do not block dashboard work

**Independent Test**: Simulate a slow or failed detail fetch and confirm the user can still work from the list and the opened SKU shell

### Implementation for User Story 3

- [x] T011 [US3] Keep the opened SKU shell usable when full detail hydration fails in `src/components/products/product-workbench.tsx`
- [x] T012 [P] [US3] Reuse cached SKU detail and in-flight requests when reopening the same SKU in `src/components/products/product-workbench.tsx`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validate the new loading flow and clean up the feature

- [ ] T013 [P] Validate the new list-to-detail flow against `specs/002-sku-thumbnail-lazy-load/quickstart.md`
- [x] T014 [P] Run `npm run lint` for the touched product workbench files and capture any residual performance notes in `specs/002-sku-thumbnail-lazy-load/plan.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - blocks all user stories
- **User Stories (Phase 3+)**: All depend on Foundational completion
- **Polish (Final Phase)**: Depends on the story work being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational; no dependency on other stories
- **User Story 2 (P2)**: Can start after Foundational; may reuse User Story 1 preview state
- **User Story 3 (P3)**: Can start after Foundational; depends on the cached-shell pattern from User Story 2

### Parallel Opportunities

- T001 and T002 can run in parallel
- T003 and T004 can run in parallel
- T006 and T009 can run in parallel with their sibling story tasks if file changes do not overlap
- T012 and T013 can run in parallel with other non-overlapping polish work

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate the list is thumbnail-first and usable

### Incremental Delivery

1. Add the lightweight preview boundary
2. Deliver User Story 1 as the fast dashboard list
3. Add User Story 2 to open the SKU shell immediately
4. Add User Story 3 for fallback and reuse behavior

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should remain independently testable
