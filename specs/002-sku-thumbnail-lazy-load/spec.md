# Feature Specification: SKU Thumbnail Lazy Load

**Feature Branch**: `[002-sku-thumbnail-lazy-load]`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "先展示缩略图，点进 SKU 里再开始加载大图和重内容"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Fast list scanning (Priority: P1)

As a dashboard user, I can scan the product list quickly because each row shows only a lightweight thumbnail and other summary information, without waiting for large images or full record content.

**Why this priority**: The list is the first thing users see, so it must stay responsive even when individual product detail content is heavy.

**Independent Test**: Open the dashboard list with multiple products and confirm the list becomes usable before any full-size detail content is needed.

**Acceptance Scenarios**:

1. **Given** the dashboard list is visible, **When** the rows render, **Then** each product shows a thumbnail-sized image in the list.
2. **Given** the dashboard list is visible, **When** the user scans rows, **Then** the page does not wait for full-size product images before showing the list.

---

### User Story 2 - Load detail on demand (Priority: P2)

As a dashboard user, I can open a SKU and have the product detail view load the heavier content only after I enter that SKU.

**Why this priority**: The list should stay fast, while the detail experience can spend more time loading richer content because it is only needed for a single product at a time.

**Independent Test**: Open a SKU from the list and verify that the detail view appears first, then expands with larger images and richer content.

**Acceptance Scenarios**:

1. **Given** the user selects a SKU from the list, **When** the detail view opens, **Then** the SKU page becomes visible before the larger images finish loading.
2. **Given** the detail view is open, **When** the larger images and heavy content finish loading, **Then** they appear in the SKU view without blocking the initial entry.

---

### User Story 3 - Preserve graceful fallback (Priority: P3)

As a dashboard user, I can still work with a SKU even when the larger content is slow or unavailable, because the lightweight list and basic product entry remain usable.

**Why this priority**: A slow or failed heavy-content load should not block normal review and navigation work.

**Independent Test**: Simulate a slow or failed detail load and confirm the list and SKU entry remain usable with a sensible fallback state.

**Acceptance Scenarios**:

1. **Given** the larger images are still loading, **When** the user stays on the list or detail shell, **Then** the interface remains usable.
2. **Given** the heavier content cannot be loaded, **When** the user opens a SKU, **Then** the user still sees the basic product shell and can continue working.

### Edge Cases

- Products without images still need a consistent thumbnail placeholder in the list.
- A SKU opened twice should not reload the same heavy content unnecessarily during the same session.
- Slow image sources should not block the list from appearing.
- The detail view should remain coherent if only part of the heavy content arrives.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product list MUST render using thumbnail-sized images instead of waiting for large image content.
- **FR-002**: The dashboard MUST show the product list before full-size product detail content is required.
- **FR-003**: Opening a SKU MUST load heavier product content only after the user enters the SKU detail view.
- **FR-004**: The SKU detail view MUST present a usable shell before large images and other heavy content finish loading.
- **FR-005**: The interface MUST keep the list usable even when detail content is slow, unavailable, or still loading.
- **FR-006**: Reopening the same SKU during a session SHOULD reuse already loaded heavy content when available.
- **FR-007**: Products without images MUST still display a consistent fallback thumbnail in the list.

### Key Entities *(include if feature involves data)*

- **Product List Row**: A lightweight dashboard row that includes SKU, summary fields, and thumbnail-sized image presentation.
- **SKU Detail View**: The single-product view that can load richer product content after the user opens a SKU.
- **Image Content Tier**: The split between lightweight thumbnail presentation and heavier detail imagery.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can see the product list without waiting for full-size images to load.
- **SC-002**: Opening a SKU shows the detail shell first, then fills in heavier content afterward.
- **SC-003**: A slow heavy-content load does not block access to the list or the opened SKU shell.
- **SC-004**: Reopening a SKU during the same session feels immediate when its heavy content is already available.
- **SC-005**: Empty-image products still display a stable visual placeholder in the list.

## Assumptions

- The change is limited to dashboard product browsing and SKU detail entry.
- Existing product data stays the same; only the loading order and presentation tier change.
- The list view only needs lightweight visual coverage, not full-resolution imagery.
- Users still expect the detailed SKU view to contain the richer images once they open it.
