# Amazon PPC Optimization Workspace
## Workspace Interaction Specification
### Version 3.0

---

## 1. Document Purpose

This document defines the interaction model of the Campaign Workspace in Amazon PPC Optimization Workspace Version 3.0.

It focuses on:

- dashboard-to-workspace entry
- workspace layout
- campaign tab behavior
- lifecycle interaction
- bulk import interaction
- recent data interaction
- rule execution entry
- draft review entry points
- local persistence expectations

The goal is to make Workspace the true operating surface of the product, not a thin wrapper around imported table data.

---

## 2. Design Goals

The workspace experience must achieve the following:

1. Make campaign optimization feel like operating software, not browsing spreadsheets.
2. Preserve context across campaign switching, tab switching, and page refresh.
3. Keep the user oriented around Campaign, Lifecycle, Rule, Draft, and Export.
4. Allow fast movement from overview to action without losing state.
5. Support future SaaS collaboration concepts while remaining local-first in version 3.0.

---

## 3. Experience Model

### 3.1 Official Interaction Hierarchy

The interaction hierarchy is:

```text
Dashboard
  -> Campaign Card
    -> Workspace
      -> Tabs
        -> Analysis / Rules / Draft / History
```

This replaces the legacy model:

```text
Tree
  -> Table
```

### 3.2 Workspace Position in the Product

Workspace is the main place where users:

- inspect campaign state
- upload or match recent data
- confirm lifecycle grouping
- run rules
- review drafts
- prepare export

### 3.3 Workspace Mental Model

A workspace should feel like:

- a focused campaign cockpit
- a resumable operating session
- a bounded decision environment

It should not feel like:

- a generic backend detail page
- a spreadsheet viewer
- a temporary modal workflow

---

## 4. Entry Flows

### 4.1 Dashboard Entry

Primary entry flow:

```text
Open Dashboard
  -> Scan Campaign Cards
  -> Select Priority Campaign
  -> Open Workspace
```

### 4.2 Sidebar or List Entry

Secondary entry flow:

```text
Open Workspace Page
  -> Browse Campaign List
  -> Select Campaign
  -> Open Workspace Context
```

### 4.3 Lifecycle Entry

Lifecycle entry flow:

```text
Open Workspace Page
  -> Select Lifecycle Group
  -> View Scoped Campaign Set
  -> Run Rules on Lifecycle Scope
```

### 4.4 Import-First Entry

If the user has not uploaded a workbook yet:

```text
Open Workspace
  -> Upload Bulk File
  -> Parse Workbook
  -> Build Campaign Objects
  -> Unlock Workspace Operations
```

---

## 5. Workspace Layout

### 5.1 Design Goal

The workspace layout must support high-density operational tasks while keeping orientation simple.

### 5.2 Required Entry Layout

The version 3.0 workspace must preserve the campaign-entry layout defined in the earlier product outline.

This layout is not optional and must remain the first-level workspace surface:

```text
┌────────────────────────────────────────────────────────────────────┐
│ Toolbar                                                           │
│ Upload Bulk │ Search │ Lifecycle Filter │ Sort │ View             │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│ Campaign Grid                                                      │
│                                                                    │
│ ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│ │ Boat Cover   │  │ Anchor       │  │ Fishing Rod  │               │
│ │ Mature       │  │ New          │  │ Clearance    │               │
│ │ ACOS 23%     │  │ ACOS 18%     │  │ ACOS 41%     │               │
│ │ Orders 53    │  │ Orders 12    │  │ Orders 6     │               │
│ └──────────────┘  └──────────────┘  └──────────────┘               │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

This means the workspace home is a campaign-browsing surface built from:

- Toolbar
- Campaign Grid
- Campaign Card

It must not be replaced by a left-tree-plus-detail layout as the primary entry experience.

### 5.3 Layout Hierarchy

The correct interaction hierarchy is:

```text
Workspace Home
  -> Toolbar
  -> Campaign Grid
  -> Campaign Card
  -> Campaign Workspace Tab
  -> Detailed Workspace Sections
```

This clarifies an important point:

- Campaign Grid is the first layer of Workspace
- detailed tabs are the second layer of Workspace

The second layer expands from the first. It does not replace it.

### 5.4 High-Level Application Layout

Recommended structure:

```text
App Shell
  -> Workspace Home
    -> Toolbar
    -> Campaign Grid
  -> Workspace Tab Bar
  -> Active Workspace Panel
```

The current implementation may still use supporting navigation structures such as campaign lists or lifecycle boards, but those are implementation aids, not the primary version 3.0 experience model.

### 5.5 Current Implementation Mapping

Current workspace page already reflects this pattern with:

- `CampaignGroupList`
- `LifecycleBoard`
- `WorkspacePanel`

This means the codebase has useful underlying pieces, but the documented target experience should be adjusted so that:

- `CampaignGroupList` evolves toward or supports `Campaign Grid`
- `LifecycleBoard` becomes a strategic filter and grouping layer
- `WorkspacePanel` becomes the active campaign workspace after card entry

### 5.6 Layout Responsibilities

The layout areas are responsible for:

- Toolbar: import, search, lifecycle filtering, sorting, and view switching
- Campaign Grid: campaign discovery and prioritization
- Campaign Card: campaign summary and workspace entry
- Tab Bar: active context management after campaign opening
- Workspace Panel: actual operating surface after campaign entry

---

## 6. Campaign List Interaction

### 6.1 Design Goal

The campaign list is the fast-access navigation surface for workspace entry and switching.

### 6.2 Functional Requirements

The campaign list must support:

- campaign browsing
- search
- active state visibility
- lifecycle badge visibility
- open state visibility
- future bulk selection

### 6.3 Current Interaction Mapping

Current code already supports:

- selecting a campaign
- opening a campaign
- switching active campaign state

### 6.4 UX Requirement

The campaign list should remain lightweight and scannable, not become a secondary table.

---

## 7. Lifecycle Board Interaction

### 7.1 Design Goal

Lifecycle Board provides strategic grouping and batch scope selection.

### 7.2 Functional Requirements

Lifecycle Board must support:

- viewing lifecycle buckets
- assigning campaigns to lifecycle groups
- switching into lifecycle-scoped workspace mode
- showing campaign counts
- showing strategy context

### 7.3 Business Behavior

Lifecycle does not alter source data.

It affects:

- rule loading
- optimization scope
- segmentation

### 7.4 Current Interaction Mapping

Current workspace behavior already supports:

- single campaign mode
- lifecycle mode
- rule execution by lifecycle scope

This dual mode should become an explicit documented product behavior.

---

## 8. Workspace Tabs

### 8.1 Design Goal

Tabs let users work across multiple campaigns or a lifecycle scope without losing context.

### 8.2 Product Requirement

Opening a campaign should create or focus a workspace tab instead of sending the user through a full route reset.

### 8.3 Required Capabilities

Workspace tabs should support:

- active tab highlighting
- tab reopening
- tab persistence
- future close action
- future pin action
- future recent history

### 8.4 Current Implementation Mapping

Current workspace tab behavior is represented through:

- `openTabIds`
- `activeCampaignGroupId`
- workspace tab buttons in `WorkspacePanel`

### 8.5 Persistence Requirement

Open tabs and active tab state must survive refresh through local persistence.

---

## 9. Workspace Modes

### 9.1 Campaign Mode

Campaign mode focuses on one campaign workspace.

In this mode, the user should see:

- campaign-level summary
- campaign-specific rules
- campaign draft results
- campaign recent data scope

### 9.2 Lifecycle Mode

Lifecycle mode focuses on all campaigns within a lifecycle bucket.

In this mode, the user should see:

- lifecycle workspace title
- scoped campaign count
- aggregated keyword count
- lifecycle rule set
- batch execution behavior

### 9.3 Mode Difference

The difference between modes is not merely visual.

It changes:

- scope of recent data upload
- rule execution scope
- copywriting in the UI
- summary metrics

### 9.4 UX Requirement

The user must always know which mode is active.

The UI must make clear whether actions apply to:

- one campaign
- or a lifecycle-scoped set of campaigns

---

## 10. Workspace Information Architecture

### 10.1 Design Goal

Each workspace should organize information by decision sequence, not source-table shape.

### 10.2 Recommended Workspace Sections

Each campaign workspace should expose:

- Overview
- Keywords
- Product Targets
- Recent Data
- Rules
- Draft
- History
- Settings

### 10.3 Current Implementation Mapping

Current workspace panel already contains strong foundations for:

- KPI summary
- batch archive
- trend chart
- draft table
- rule execution controls

These should be treated as sections of the future tabbed workspace, not temporary widgets.

---

## 11. Bulk Import Interaction

### 11.1 Design Goal

Bulk import should feel like loading a workspace dataset, not uploading a raw spreadsheet for editing.

### 11.2 User Flow

```text
Click Upload Bulk File
  -> Select File
  -> Validate Type
  -> Start Parse
  -> Show Progress
  -> Build Campaign Data
  -> Activate Workspace
```

### 11.3 Current Supported Formats

Current implementation supports:

- `.xlsx`
- `.xls`
- `.xlsm`
- `.csv`

### 11.4 Interaction Requirements

The UI must show:

- file picker entry
- parsing in progress
- parse completion
- row count
- parsed sheets
- parse failure message

### 11.5 State Transitions

Bulk import state transitions:

- idle
- parsing
- completed
- failed

### 11.6 UX Requirement

Import should never freeze the workspace shell.

Parsing must feel asynchronous and recoverable.

---

## 12. Recent Data Interaction

### 12.1 Design Goal

Recent data upload adds short-term performance context to the active workspace scope.

### 12.2 User Flow

```text
Open Campaign or Lifecycle Workspace
  -> Upload Recent Advertising CSV
  -> Parse File
  -> Match Rows to Scope
  -> Show Match Summary
  -> Enable Recent-Dependent Rules
```

### 12.3 Scope Rule

Recent data upload is scope-aware.

In campaign mode:

- recent data is scoped to one campaign

In lifecycle mode:

- recent data may be scoped across all campaigns in the active lifecycle

### 12.4 Current Interaction Mapping

Current implementation already enforces:

- CSV-only upload
- blocked upload when no active scope exists
- scoped campaign ID list for matching

These are important version 3.0 behaviors and should remain explicit.

### 12.5 Match Feedback

The UI must show:

- total rows
- matched rows
- unmatched rows
- ambiguous rows
- matched campaign groups
- scoped campaign groups

### 12.6 UX Requirement

Users must understand that recent data is:

- contextual
- temporary in purpose
- not the export source

---

## 13. Rule Execution Entry

### 13.1 Design Goal

Rule execution should feel like a controlled generation step, not a destructive action.

### 13.2 User Flow

```text
Confirm Workspace Scope
  -> Confirm Lifecycle Context
  -> Review Active Rules
  -> Run Rules
  -> Generate Drafts
  -> Review Draft Results
```

### 13.3 Scope Awareness

The UI must explain whether rule execution runs for:

- current campaign only
- current lifecycle campaign set

### 13.4 Rule Visibility

Before execution, the workspace should show:

- active lifecycle
- enabled rule count
- execution scope summary

### 13.5 Blocking Requirement

If no lifecycle is assigned and lifecycle binding is required, the UI should guide the user before execution.

---

## 14. Draft Review Entry in Workspace

### 14.1 Design Goal

Draft review must be a first-class phase of workspace interaction.

### 14.2 Required Behaviors

The workspace must allow users to:

- inspect generated drafts
- sort by performance and change metrics
- select or deselect drafts
- range select drafts
- invert selection
- clear selection
- export selected drafts

### 14.3 Current Interaction Mapping

Current draft review already supports:

- sortable metric columns
- single toggle
- range selection
- drag selection
- box selection
- select all
- invert selection
- clear selection

This is a strong differentiator and should be preserved in the formal interaction model.

### 14.4 UX Requirement

Draft review should feel closer to operating a decision workbench than checking rows in a form.

---

## 15. Local Persistence Interaction

### 15.1 Design Goal

Workspace continuity is a core product promise.

### 15.2 Persisted State

The system should preserve:

- parsed bulk data
- lifecycle assignments
- active campaign
- open tabs
- recent data state
- generated drafts
- selected draft IDs

### 15.3 Current Interaction Mapping

Current workspace UI already communicates persistence status such as:

- loading
- saving
- saved
- failed
- ready

### 15.4 User Controls

The user must be able to clear persisted local state deliberately.

### 15.5 UX Requirement

Persistence must be visible enough to build trust, but not so prominent that it dominates the workflow.

---

## 16. Empty, Loading, and Error States

### 16.1 Empty State

Empty state should explain what users can do next:

- upload a workbook
- select a campaign
- assign lifecycle
- upload recent data

### 16.2 Loading State

Loading states should be specific:

- parsing workbook
- restoring workspace
- parsing recent data
- running rules
- exporting workbook

### 16.3 Error State

Error states must be:

- scoped
- actionable
- recoverable

### 16.4 Current Error Themes

Current implementation already handles cases such as:

- unsupported bulk file
- worker startup failure
- recent data wrong format
- missing active scope

These should be preserved in future UI redesigns.

---

## 17. Performance Requirements

### 17.1 Core Requirement

Workspace interaction must remain smooth under large local datasets.

### 17.2 Key Requirements

The UI must support:

- large campaign lists
- large keyword counts
- large draft lists
- long-lived browser sessions

### 17.3 Recommended Direction

Recommended interaction-layer optimizations:

- virtualized entity lists
- virtualized draft table
- incremental progress updates
- non-blocking local persistence

---

## 18. Future Extension

Future workspace interaction may support:

- true tab close and pin behaviors
- multi-workspace compare mode
- split view
- simulation panel
- AI copilot side panel
- collaboration presence
- shared review states

---

## 19. Summary

Version 3.0 defines Workspace as the product's primary operating environment.

Its interaction model is centered on:

- campaign entry
- lifecycle-aware scope
- workspace tabs
- controlled rule execution
- rich draft review
- reliable local continuity

This is the key UX layer that turns the product from a bulk parser into a real optimization workspace.
