# Feature Specification: Product Status Vocabulary Cleanup

**Feature Branch**: `[001-status-vocabulary-fix]`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "Fix the product workbench status mismatch so the top summary cards, filter labels, and table headers use distinct, accurate status vocabulary."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Understand the summary cards (Priority: P1)

As a product workbench user, I can read the top summary cards and immediately tell what each card represents without confusing them with the table status or the filter choices.

**Why this priority**: The summary cards are the first status-like signals users see, so they need to be unambiguous before any filtering or row review happens.

**Independent Test**: Open the product workbench and ask a reviewer to explain each summary card’s meaning without referring to other controls.

**Acceptance Scenarios**:

1. **Given** the product workbench is open, **When** the user looks at the top summary cards, **Then** each card uses wording that clearly distinguishes its metric from the others.
2. **Given** the user clicks a summary card, **When** the filtered view updates, **Then** the card label still matches the category being shown.

---

### User Story 2 - Choose filters with precise labels (Priority: P2)

As a product workbench user, I can use the filter area without guessing whether a control applies to a main product status, a workflow stage, or an exception state.

**Why this priority**: Filters are where users narrow work, so vague status wording creates the most expensive confusion after the overview cards.

**Independent Test**: Review the filter area and confirm each status-related control clearly names the category it filters.

**Acceptance Scenarios**:

1. **Given** a user wants to narrow results by product state, **When** they inspect the filter labels, **Then** the label tells them whether they are filtering by product status, workflow progress, or exception status.
2. **Given** a user changes a status-related filter, **When** the table refreshes, **Then** the new results correspond to the selected meaning.

---

### User Story 3 - Read table headers without ambiguity (Priority: P3)

As a product workbench user, I can scan the table headers and understand which column shows the main product status versus other operational information.

**Why this priority**: The table is the detailed review surface, and the header language should reinforce the distinction made by the cards and filters.

**Independent Test**: Inspect the table header row and confirm the status-related columns are named in a way that does not reuse one generic label for multiple meanings.

**Acceptance Scenarios**:

1. **Given** the product table is visible, **When** the user reads the header row, **Then** each status-related column name is specific to its own meaning.
2. **Given** the user compares a summary card, a filter label, and a table header, **When** they read them together, **Then** the three surfaces use distinct vocabulary for distinct concepts.

### Edge Cases

- Existing saved filter selections must keep working even if the displayed wording changes.
- Empty and filtered-empty states must still use the same distinct vocabulary as the populated view.
- Narrow screens must keep labels readable, even when a line break is needed.
- A single product may contribute to more than one summary card, but the labels must not imply that all cards describe the same status field.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product workbench MUST use distinct wording for the top summary cards so each card represents one clearly named concept.
- **FR-002**: The filter area MUST label each status-related control according to the meaning it filters, rather than using one generic status term for all controls.
- **FR-003**: The table header row MUST use specific column names that distinguish main product status from workflow or exception information.
- **FR-004**: The same concept MUST be described with the same wording everywhere it appears on the product workbench.
- **FR-005**: The screen MUST avoid presenting different concepts as interchangeable status labels.
- **FR-006**: Existing saved selections and default views MUST continue to map to the same underlying categories after the wording update.
- **FR-007**: Loading, empty, and filtered-empty states MUST preserve the same distinct vocabulary used in the populated view.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a quick review, at least 9 of 10 internal users can correctly explain the difference between the summary cards, the filter labels, and the table headers after one glance.
- **SC-002**: A manual inspection of the product workbench shows zero reused generic status labels for different concepts on the same screen.
- **SC-003**: At least 95% of acceptance walkthroughs allow the reviewer to select the intended status-related filter without asking for clarification.
- **SC-004**: The product workbench remains understandable on standard and narrow desktop widths, with no label wording that changes meaning when wrapped.

## Assumptions

- The scope is limited to product workbench wording and labels.
- The underlying product lifecycle, counts, and filter behavior stay the same.
- No changes are required to stored product data or exported output.
- Existing saved filters and default views continue to work after the label refresh.
