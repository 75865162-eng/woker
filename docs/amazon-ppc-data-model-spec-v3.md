# Amazon PPC Optimization Workspace
## Data Model Specification
### Version 3.0

---

## 1. Document Purpose

This document defines the canonical data model for Amazon PPC Optimization Workspace Version 3.0.

Its goal is to ensure that:

- product language is unified
- frontend state uses stable object contracts
- rule engine inputs are explicit
- export logic has deterministic row locator data
- future AI and SaaS layers can reuse the same model

This document should be treated as the source of truth for business entities and their relationships.

---

## 2. Modeling Principles

### 2.1 Business-First Modeling

The system must model business objects, not file layout objects.

Preferred objects:

- Campaign
- Workspace
- Keyword
- Product Target
- Rule
- Draft
- Execution

Non-primary objects:

- Workbook
- Sheet
- Row

These remain technical source objects and must not dominate product language.

### 2.2 Unified Object Language

The same object names must be reused consistently across:

- UI labels
- store state
- rule engine
- persistence layer
- export layer
- documentation

### 2.3 Immutable Source, Mutable Proposal

The model must separate:

- source records
- derived context
- execution proposals

Source data is immutable.

Drafts are mutable and selectable.

Export artifacts are generated from validated drafts.

### 2.4 AI Compatibility

All models introduced in version 3.0 should be written so that a future AI engine can consume and produce the same contracts used by the rule engine.

---

## 3. Object Hierarchy

The official hierarchy is:

```text
Workbook
  -> Campaign
    -> Workspace
      -> Optimization Entity
        -> Rule Context
          -> Draft
            -> Execution Log
```

Optimization Entity in version 3.0 includes:

- Keyword
- Product Target

This hierarchy intentionally replaces:

```text
Workbook
  -> Sheet
    -> Table
      -> Row
```

---

## 4. Domain Boundaries

### 4.1 Input Domain

Input domain objects:

- Workbook
- Workbook Sheet
- Source Row
- Header Map

These objects exist to support parsing and export patching.

### 4.2 Workspace Domain

Workspace domain objects:

- Campaign
- Workspace
- Workspace Tab
- KPI Snapshot
- Lifecycle
- Batch Archive

### 4.3 Optimization Domain

Optimization domain objects:

- Performance Row
- Recent Advertising Data Row
- Rule
- Condition Group
- Rule Action
- Rule Context
- Draft

### 4.4 Execution Domain

Execution domain objects:

- Draft Validation Result
- Patch Instruction
- Export Artifact
- Execution Log

---

## 5. Core Entities

### 5.1 Workbook

#### Design Goal

Workbook is the immutable source package from which campaign workspaces are built and to which approved patches are later applied.

#### Business Role

Workbook is an input object, not a primary product interaction object.

#### Required Fields

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| id | string | future required | unique workbook identity |
| fileName | string | required | uploaded file name |
| buffer | ArrayBuffer | required | original binary content |
| uploadedAt | ISO string | required | upload time |
| parsedSheets | string[] | required | successfully parsed sheets |
| parseStatus | enum | required | parsing state |

#### Functional Requirements

- Workbook must be preserved in original form.
- Workbook must support patch-based export.
- Workbook must not be mutated directly during optimization.

### 5.2 Campaign

#### Design Goal

Campaign is the top-level business object that users discover, open, classify, and optimize.

#### Business Role

Campaign is the primary object shown in dashboard and workspace navigation.

#### Current Implementation Mapping

Current code uses `CampaignGroup` as an intermediate object.

In version 3.0 documentation, this should evolve conceptually into `Campaign`, while allowing implementation to continue using a stable ID derived from campaign and ad group identity until the final grouping model is refined.

#### Recommended Fields

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| id | string | required | stable campaign identity |
| sourceWorkbookId | string | future required | parent workbook reference |
| sheetName | string | optional | source sheet for export tracing |
| campaignName | string | required | campaign display name |
| adGroupName | string | transitional required | current implementation scope key |
| lifecycleGroupId | LifecycleGroupId | optional | assigned lifecycle |
| keywordCount | number | required | optimization entity count |
| productTargetCount | number | future required | product target count |
| lastUpdated | ISO string | required | freshness indicator |

#### Functional Requirements

- Campaign must be searchable and filterable.
- Campaign must open a workspace.
- Campaign must preserve source locator linkage.
- Campaign must support lifecycle assignment.

### 5.3 Workspace

#### Design Goal

Workspace is the bounded operational environment for a single campaign.

#### Business Role

Workspace is the primary interaction container after dashboard entry.

#### Required Fields

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| id | string | required | workspace identity |
| campaignId | string | required | linked campaign |
| tabId | string | required | UI tab identity |
| mode | enum | required | campaign mode or lifecycle mode |
| openAt | ISO string | required | open timestamp |
| lastActiveAt | ISO string | required | state freshness |
| persisted | boolean | required | local persistence marker |

#### State Domains

Workspace contains:

- overview state
- keyword state
- product target state
- recent data state
- rules state
- draft state
- history state
- settings state

#### Functional Requirements

- Workspace must restore after refresh.
- Workspace tabs must persist independently.
- Workspace must isolate state from other campaigns.

### 5.4 Keyword

#### Design Goal

Keyword is a first-class optimization entity that can be evaluated by rules and exported safely.

#### Current Implementation Mapping

Current code represents keyword-like entities through `PerformanceRow`.

#### Required Fields

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| id | string | required | unique entity identity |
| campaignGroupId | string | required | parent campaign scope |
| batchId | string | required | source batch |
| keyword | string | required | keyword text |
| matchType | string | required | exact / phrase / broad etc |
| currentBid | number | required | current bid |
| status | enum | required | enabled or paused |
| sourceRowIndex | number | optional | zero-based locator |
| sourceRowNumber | number | optional | human-readable row locator |
| sheetName | string | optional | source sheet locator |

#### Metric Fields

Keyword should carry or derive:

- impressions
- clicks
- orders
- sales
- spend
- ACOS
- ROAS
- CTR
- CPC
- CVR
- CPA

### 5.5 Product Target

#### Design Goal

Product Target should follow the same contract as Keyword whenever possible to avoid duplicate optimization logic.

#### Business Rule

If entity-specific behavior is necessary, it should be expressed through entity type and capability flags rather than a wholly separate engine contract.

#### Required Fields

Product Target should reuse most Keyword fields with:

- target expression
- target type
- optional ASIN / category extraction

### 5.6 Data Batch

#### Design Goal

Data Batch represents an imported dataset snapshot associated with a campaign scope.

#### Required Fields

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| id | string | required | batch identity |
| campaignGroupId | string | required | linked campaign scope |
| fileName | string | required | source file name |
| uploadedAt | ISO string | required | import time |
| rowCount | number | required | total rows |
| dateRange | string | required | human-readable period |
| status | enum | required | archived / processing / failed |

### 5.7 Recent Advertising Data Row

#### Design Goal

Recent Advertising Data Row provides short-window performance context for comparison and rule evaluation.

#### Business Rule

This object is reference-only and never participates directly in export patching.

#### Required Fields

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| id | string | required | row identity |
| fileId | string | required | uploaded recent data file |
| campaignGroupId | string | optional | matched campaign scope |
| keyword | string | required | keyword text |
| target | string | optional | target text |
| matchType | string | required | match type |
| impressions | number | required | recent impressions |
| clicks | number | required | recent clicks |
| orders | number | required | recent orders |
| sales | number | required | recent sales |
| spend | number | required | recent spend |
| acos | number | optional | explicit ACOS if present |
| roas | number | optional | explicit ROAS if present |
| matchStatus | enum | required | matched / unmatched / ambiguous |
| matchError | string | optional | failure explanation |

#### Derived Metrics

The system may derive:

- recent CTR
- recent CPC
- recent CVR
- recent CPA
- order share
- recent-vs-bulk deltas

### 5.8 Metric Snapshot

#### Design Goal

Metric Snapshot summarizes KPI state for campaign-level display and trend modules.

#### Required Fields

- campaignGroupId
- batchId
- sales
- spend
- ACOS
- ROAS
- CTR
- CPC
- orders
- impressions
- clicks
- CVR

### 5.9 Lifecycle

#### Design Goal

Lifecycle is a strategic classification that governs rule selection and dashboard segmentation.

#### Required Fields

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| id | enum | required | launch / mature / decline / clearance |
| name | string | required | user-facing lifecycle name |
| description | string | required | lifecycle meaning |
| tone | enum | required | UI tone token |
| ruleIds | string[] | required | bound rules |

#### Business Rule

Lifecycle is not a source-data category. It is an optimization strategy category.

### 5.10 Rule

#### Design Goal

Rule is a reusable optimization asset evaluated against a rule context.

#### Required Fields

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| id | string | required | rule identity |
| name | string | required | display name |
| lifecycleGroupId | LifecycleGroupId | required in v3 | lifecycle binding |
| enabled | boolean | required | active state |
| priority | number | required | evaluation order |
| conditionGroup | ConditionGroup | required | rule logic |
| actions | RuleAction[] | required | outputs |
| updatedAt | ISO string | required | last modified |

#### Future Fields

Future rule metadata may include:

- repository scope
- version
- author
- safety profile
- simulation baseline

### 5.11 Condition

#### Design Goal

Condition is the smallest evaluable rule expression.

#### Required Fields

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| id | string | required | condition identity |
| dataSource | enum | optional | bulk / overall / comparison / derived |
| metric | ConditionMetricKey | required | metric to evaluate |
| compareMetric | MetricKey | optional | comparison baseline metric |
| operator | enum | required | comparison operator |
| value | number | optional | scalar target |
| min | number | optional | between lower bound |
| max | number | optional | between upper bound |

#### Version 3.0 Derived Metrics

The current implementation formally supports these derived metrics:

- `orderShare`: current keyword/order contribution share inside the scoped campaign group, based on matched Overall all-date advertising data
- `isCoreKeyword`: executable business flag used by lifecycle rules; currently resolves to true when campaign or ad group naming indicates core traffic, or when the row is an Exact keyword and not an ASIN product target

#### Rule Builder Baseline Metric Catalog

To stay consistent with the advertising-data filter panel, the current Rule Builder should expose this baseline metric catalog for condition authoring:

- `impressions`
- `clicks`
- `ctr`
- `sales`
- `spend`
- `acos`
- `orders`
- `cvr`
- `cpc`
- `cpa`
- `roas`
- `acots`
- `asots`
- `viewableImpressions`
- `topOfSearchShare`
- `advertisedProductOrders`
- `otherProductOrders`
- `orderShare`
- `isCoreKeyword`

The current condition source catalog is:

- `bulk`
- `overall`
- `comparison`
- `derived`

### 5.12 Condition Group

#### Design Goal

Condition Group allows nested boolean logic.

#### Required Fields

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| id | string | required | group identity |
| logic | enum | required | AND / OR |
| conditions | Condition[] \| ConditionGroup[] | required | nested members |

### 5.13 Rule Action

#### Design Goal

Rule Action expresses the optimization output before it becomes a draft.

#### Supported Version 3.0 Action Types

- increase_bid_percent
- decrease_bid_percent
- increase_bid_fixed
- decrease_bid_fixed
- set_bid
- pause_keyword
- enable_keyword
- add_negative_keyword
- add_label
- mark_pending
- no_change

#### Required Fields

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| id | string | required | action identity |
| type | enum | required | action type |
| value | number | optional | numeric payload |
| label | string | optional | string payload |

### 5.14 Rule Context

#### Design Goal

Rule Context is the normalized evaluation object passed into the engine.

#### Required Inputs

At minimum, Rule Context should provide:

- current optimization entity
- scoped bulk metrics
- matched recent row if available
- campaign-scoped recent rows
- derived metrics
- lifecycle
- safety constraints

#### Current Implementation Mapping

Current engine builds a transient evaluation context containing:

- bulkRow
- overallRow
- campaignOverallRows
- orderShare
- isCoreKeyword

In the next implementation stage, this should be formalized into an explicit exported type.

### 5.15 Adjustment Draft

#### Design Goal

Adjustment Draft is the only approved proposal contract between optimization logic and export logic.

#### Required Fields

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| id | string | required | draft identity |
| batchId | string | optional | source batch |
| sheetName | string | optional | export locator |
| sourceRowIndex | number | optional | zero-based row locator |
| sourceRowNumber | number | optional | user-facing row number |
| campaignGroupId | string | required | owning campaign |
| rowId | string | required | source optimization entity |
| field | enum | optional | target field such as bid or state |
| headerName | string | optional | workbook header to patch |
| oldValue | primitive | optional | current value |
| newValue | primitive | optional | proposed value |
| keyword | string | required | display context |
| target | string | optional | display context |
| currentBid | number | required | old bid snapshot |
| suggestedBid | number | required | proposed bid |
| deltaPercent | number | required | percentage delta |
| reason | string | required | human-readable explanation |
| matchedRule | string | required | source rule |
| selected | boolean | required | export selection state |

#### Business Requirements

- Draft must be traceable.
- Draft must be reviewable.
- Draft must not mutate source data directly.
- Draft must be validatable before export.

### 5.16 Draft Validation Result

#### Design Goal

Draft Validation Result determines whether a draft can enter export.

#### Required Fields

| Field | Type | Requirement | Description |
| --- | --- | --- | --- |
| draftId | string | required | linked draft |
| valid | boolean | required | validation result |
| status | enum | required | valid / blocked / conflict |
| message | string | required | validation explanation |
| sheetName | string | optional | locator echo |
| sourceRowIndex | number | optional | locator echo |
| headerName | string | optional | target column echo |

### 5.17 Header Map

#### Design Goal

Header Map connects business field changes to workbook columns during export.

#### Required Fields

- headerName
- columnIndex
- excelColumn

### 5.18 Execution Log

#### Design Goal

Execution Log is the audit object for optimization runs and export actions.

#### Recommended Fields

- id
- workspaceId
- campaignId
- engineId
- ruleSetVersion
- generatedDraftCount
- selectedDraftCount
- exportedDraftCount
- createdAt
- completedAt
- status
- errorMessage

---

## 6. Enumerations and Shared Type Systems

### 6.1 LifecycleGroupId

Version 3.0 lifecycle IDs:

- launch
- mature
- decline
- clearance

### 6.2 Condition Data Sources

Supported sources:

- bulk
- recent
- comparison
- derived

### 6.3 Condition Operators

Supported operators:

- eq
- neq
- gt
- gte
- lt
- lte
- between
- increase_by
- decrease_by

### 6.4 Batch Granularity

Supported reporting granularities:

- Daily
- Weekly
- Monthly

### 6.5 Parse and Persistence Status

System status enums should remain explicit for:

- parse job
- recent data parse
- persistence
- export
- simulation

---

## 7. Relationship Model

### 7.1 Main Relationships

Relationship summary:

```text
Workbook 1 -> N Campaign
Campaign 1 -> 1 Workspace
Campaign 1 -> N PerformanceRow
Campaign 1 -> N DataBatch
Campaign N -> 1 Lifecycle
Lifecycle 1 -> N Rule
Rule 1 -> N Condition / Action
Campaign 1 -> N Draft
Draft N -> 1 Export Event
```

### 7.2 Row Locator Chain

To support safe export, the row locator chain must remain intact:

```text
Draft
  -> rowId
  -> sourceRowIndex
  -> sheetName
  -> headerName
```

If any required link is missing, export must block.

---

## 8. State Management Mapping

### 8.1 Local Store Domains

Current local workspace state already includes:

- campaignGroups
- campaignSheetGroups
- performanceRows
- activeCampaignGroupId
- activeLifecycleGroupId
- openTabIds
- parse state
- recent data state
- adjustmentDrafts
- persistence state

### 8.2 Recommended Evolution

The next state-modeling step should separate:

- source repository state
- workspace UI state
- optimization state
- execution state

This will make later SaaS migration much cleaner.

---

## 9. Validation Rules

### 9.1 Source Integrity Rules

The system must validate:

- required headers exist
- row locators remain stable
- campaign scope IDs are deterministic

### 9.2 Draft Integrity Rules

The system must validate:

- a draft has a source row
- a draft has a target field
- a draft has a target header
- a draft value is legal
- no conflicting patch exists for the same field unless resolved

### 9.3 Rule Integrity Rules

The system must validate:

- rule IDs are unique
- priorities are deterministic
- conditions are complete
- actions are compatible with entity type

---

## 10. Migration Direction

### 10.1 From Existing Code

Current code already contains strong foundations for this model through:

- `CampaignGroup`
- `PerformanceRow`
- `OverallAdDataRow`
- `Rule`
- `AdjustmentDraft`
- `DraftValidationResult`

### 10.2 Recommended Naming Transition

Recommended conceptual transition:

- `CampaignGroup` -> `Campaign`
- `workspace-store` -> `workspace repository + ui workspace state`
- transient engine context -> explicit `RuleContext`

### 10.3 Non-Breaking Strategy

The migration should be documentation-first and adapter-based.

That means:

- keep current runtime types where useful
- add new canonical names in docs and architecture
- introduce adapter functions instead of mass renaming too early

---

## 11. Future Extension

Future entities likely to be added:

- Repository
- Tenant
- User
- Role
- Approval Request
- Simulation Run
- AI Recommendation
- Opportunity Score
- Export Artifact

These should extend the same core object model instead of creating a parallel system.

---

## 12. Summary

Version 3.0 data modeling establishes a unified object system centered on:

- Campaign
- Workspace
- Optimization Entity
- Rule Context
- Draft
- Execution

This model is the foundation that allows product design, code architecture, export safety, and future AI capabilities to evolve without rethinking the entire system each time.
