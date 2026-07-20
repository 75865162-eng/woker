# Amazon PPC Optimization Workspace
## Draft and Export Specification
### Version 3.0

---

## 1. Document Purpose

This document defines the draft review, validation, and export system for Amazon PPC Optimization Workspace Version 3.0.

It covers:

- draft positioning
- draft generation expectations
- draft review interaction
- validation rules
- workbook patching
- export artifact generation
- rollback and history direction

The goal is to guarantee that optimization execution remains safe, reviewable, and traceable.

---

## 2. Design Goals

The draft and export system must achieve the following:

1. Ensure that no optimization result directly mutates source workbook data.
2. Convert optimization outputs into reviewable drafts first.
3. Validate every selected draft before write-back.
4. Apply approved changes to a workbook copy rather than the original source file.
5. Preserve enough traceability to explain every exported change.

---

## 3. Core Principles

### 3.1 Draft-First Execution

All optimization output must flow through:

```text
Rule / AI / Manual Action
  -> Draft
  -> Validation
  -> Patch
  -> Export Artifact
```

### 3.2 Immutable Source

The original workbook is the source reference.

It must remain unchanged throughout analysis and optimization.

### 3.3 Explicit Write-Back

Every exported change must identify:

- which sheet to write
- which row to write
- which field to write
- what old value is expected
- what new value should be written

### 3.4 Human Review

The product must preserve a deliberate user review step before export.

---

## 4. Draft Position in the Product

### 4.1 Business Role

Draft is the product's execution proposal object.

It acts as the bridge between:

- optimization logic
- human review
- export execution

### 4.2 Draft Sources

Drafts may originate from:

- Rule Engine
- future AI Engine
- future manual edit operations
- future simulation adoption

### 4.3 Draft Responsibilities

Draft must carry:

- proposal content
- source traceability
- human-readable reason
- export locator data
- selection state

---

## 5. Draft Data Contract

### 5.1 Required Fields

Version 3.0 draft contract requires:

- id
- batchId
- sheetName
- sourceRowIndex
- sourceRowNumber
- campaignGroupId
- rowId
- field
- headerName
- oldValue
- newValue
- keyword
- target
- currentBid
- suggestedBid
- deltaPercent
- reason
- matchedRule
- selected

### 5.2 Contract Requirements

Each draft must be:

- reviewable
- traceable
- selectable
- validatable
- exportable if valid

### 5.3 Current Implementation Mapping

Current code already builds rich bid drafts with:

- old and new value
- delta percent
- rule reason
- matched rule name
- row locator fields
- selected by default

This is already aligned with the intended product direction.

---

## 6. Draft Generation

### 6.1 Design Goal

Draft generation converts rule or AI outputs into a concrete proposal layer that users can inspect safely.

### 6.2 Generation Flow

```text
Run Optimization
  -> Evaluate Context
  -> Produce Rule Actions
  -> Convert Actions to Drafts
  -> Add Reason and Locator Data
  -> Save in Workspace Draft State
```

### 6.3 Generation Rules

Draft generation must:

- preserve source scope
- preserve row locator information
- preserve originating rule identity
- compute readable delta information
- enforce baseline safety transformations such as bid floor handling

### 6.4 Current Implementation Behavior

Current bid draft generation already:

- applies percent or fixed bid changes
- rounds values
- enforces a minimum bid floor
- computes delta percent
- constructs readable reason text

This should be formalized, not treated as incidental helper behavior.

---

## 7. Draft Review Experience

### 7.1 Design Goal

Draft review must help users decide which proposals are safe and worth exporting.

### 7.2 Review Surface

The main review surface in version 3.0 is the workspace draft table.

### 7.3 Review Requirements

The user must be able to:

- inspect each draft
- compare current and recent metrics
- sort drafts by performance and change dimensions
- toggle selection
- select ranges
- drag select
- box select
- select all
- invert selection
- clear selection

### 7.4 Current Interaction Mapping

Current draft table already supports all of the above behaviors.

This is a strong foundation and should remain central to the product.

### 7.5 Review Metrics

The review surface should expose metrics that help evaluate the proposal, such as:

- impressions
- clicks
- CTR
- spend
- sales
- ACOS
- old value
- new value
- delta percent

### 7.6 UX Requirement

Draft review must emphasize decision confidence, not raw row editing.

---

## 8. Selection Model

### 8.1 Design Goal

Selection determines which drafts are eligible for export.

### 8.2 Business Rule

Only selected drafts proceed to validation and potential write-back.

### 8.3 Required Behaviors

Selection model must support:

- default selected drafts on generation
- explicit deselection
- bulk selection operations
- persistent selection state

### 8.4 Current Implementation Mapping

Current local store already preserves:

- `selectedDraftIds`
- per-draft `selected` state

This dual model should remain synchronized.

---

## 9. Draft Validation

### 9.1 Design Goal

Validation ensures that an approved-looking draft is actually safe to write back into the workbook copy.

### 9.2 Validation Flow

```text
Take Selected Drafts
  -> Verify Selection State
  -> Verify Sheet Exists
  -> Verify Row Exists
  -> Verify Target Column Exists
  -> Verify Current Cell Value Matches Expected Old Value
  -> Mark Draft as Valid / Blocked / Conflict
```

### 9.3 Required Validation Checks

Each selected draft must validate:

1. draft is selected
2. sheet name exists
3. source row index exists
4. target field exists
5. target sheet exists
6. target row exists
7. target column exists
8. current workbook value matches expected old value

### 9.4 Current Implementation Mapping

Current export logic already validates:

- selected state
- sheet presence
- row presence
- field presence
- target column presence through header map
- value conflict

### 9.5 Validation Result States

Version 3.0 uses:

- valid
- blocked
- conflict

### 9.6 User Meaning

State meaning:

- `valid`: safe to write
- `blocked`: missing prerequisite or invalid locator
- `conflict`: workbook value no longer matches draft expectation

---

## 10. Header Mapping and Row Targeting

### 10.1 Design Goal

The system must translate product-level fields into workbook cell addresses safely.

### 10.2 Header Mapping Role

Header mapping connects:

- business field names
- actual workbook column headers
- column indices
- Excel column letters

### 10.3 Current Supported Fields

Current export logic explicitly supports:

- bid
- state
- operation

### 10.4 Mapping Requirement

Header mapping must tolerate header variants through normalized matching.

### 10.5 Row Targeting Requirement

The export engine must derive target cell addresses from:

- source row index
- mapped column index

This is safer than relying on visible table ordering in the UI.

---

## 11. Patch Generation

### 11.1 Design Goal

Export should be treated as patch application, not table rewriting.

### 11.2 Patch Unit

Each valid draft effectively becomes a patch instruction with:

- target sheet
- target cell
- old value
- new value
- operation flag update if needed

### 11.3 Current Implementation Mapping

Current code directly applies valid drafts to workbook cells and also writes `Update` into the operation column when present.

This is already a patch-based behavior even if the explicit patch object is not yet formalized.

### 11.4 Recommended Next Step

The next architecture step should introduce an explicit `WorkbookPatch` type before application.

---

## 12. Export Execution

### 12.1 Design Goal

Export execution writes valid selected drafts into a workbook copy and generates a downloadable artifact.

### 12.2 Export Flow

```text
Load Original Workbook Buffer
  -> Read Workbook
  -> Validate Selected Drafts
  -> Apply Valid Draft Patches
  -> Write Workbook Copy
  -> Generate Downloadable File
  -> Return Validation Summary
```

### 12.3 Current Implementation Mapping

Current code already:

- reads workbook from `originalWorkbookBuffer`
- filters selected drafts
- validates each selected draft
- applies valid changes
- writes a new workbook array buffer
- returns counts for writable, blocked, and conflict results

### 12.4 Export Output

Export should return:

- file data
- output file name
- validations
- writable count
- blocked count
- conflict count

### 12.5 File Naming

Version 3.0 may use a default export name when no explicit naming policy exists.

Future versions may use richer naming conventions with:

- campaign scope
- export timestamp
- workspace identifier

---

## 13. Error Handling

### 13.1 Blocking Errors

Blocking errors include:

- draft not selected
- missing sheet
- missing row
- missing target field
- missing target column

### 13.2 Conflict Errors

Conflict errors include:

- workbook current cell value differs from draft old value

### 13.3 User Requirement

The export result must make clear:

- how many drafts were writable
- how many were blocked
- how many were in conflict
- which draft failed and why

---

## 14. History and Audit Direction

### 14.1 Design Goal

Even in local-first mode, the product should preserve enough export history to support trust and later auditing.

### 14.2 Minimum Future History Fields

History should eventually record:

- export time
- source workbook
- selected draft count
- writable draft count
- blocked count
- conflict count
- output file name
- rule context summary

### 14.3 Current State

Current code returns export summaries but does not yet define a full execution-history repository.

That should be added in a later implementation stage.

---

## 15. Rollback Direction

### 15.1 Version 3.0 Practical Rollback

Because export works on a workbook copy, the simplest rollback model is:

- original workbook remains unchanged
- exported artifact can be discarded
- drafts remain reviewable in workspace state

### 15.2 Future Rollback Extension

Future rollback may support:

- export session history
- patch reversal preview
- execution snapshots

---

## 16. Performance Requirements

### 16.1 Core Requirement

Validation and export must remain fast enough to feel interactive for realistic draft volumes.

### 16.2 Optimization Direction

Recommended future improvements:

- pre-build header maps per sheet once per export session
- formal patch batching
- separate validation and application passes

---

## 17. Future Extension

Future draft and export capabilities may include:

- multi-field draft support
- manual inline draft editing
- export package history
- batch approval flows
- cloud execution logs
- AI explanation overlays

---

## 18. Summary

Version 3.0 defines Draft and Export as a safety-critical subsystem built on:

- draft-first review
- explicit validation
- patch-style write-back
- workbook-copy export
- traceable outcomes

This subsystem is what makes optimization trustworthy and operationally usable.
