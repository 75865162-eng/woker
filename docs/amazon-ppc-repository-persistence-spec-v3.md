# Amazon PPC Optimization Workspace
## Repository and Persistence Specification
### Version 3.0

---

## 1. Document Purpose

This document defines the repository and persistence architecture for Amazon PPC Optimization Workspace Version 3.0.

It covers:

- repository concept
- local-first persistence model
- state domains
- IndexedDB usage
- snapshot strategy
- future cloud mapping

The goal is to make version 3.0 feel like a real SaaS foundation even while running locally in the browser.

---

## 2. Design Goals

The repository and persistence system must achieve the following:

1. Preserve workspace continuity across refresh and return sessions.
2. Separate business repositories from transient UI rendering state.
3. Support large local datasets safely.
4. Keep architecture compatible with future multi-user cloud storage.
5. Make product concepts like repository, workspace, history, and execution concrete in implementation.

---

## 3. Product Position

### 3.1 Why Repository Matters

Version 3.0 introduces true SaaS thinking into the product.

Repository is not a technical buzzword here.

It is the storage boundary for product objects such as:

- workspace state
- rules
- drafts
- execution history
- settings

### 3.2 Local-First Principle

Version 3.0 is local-first.

That means:

- the browser is the primary runtime
- IndexedDB is the primary persistence layer
- workbook and workspace continuity are preserved locally
- cloud sync is not yet required

### 3.3 Future SaaS Principle

Even though storage is local today, the internal design should map cleanly to future service-backed repositories.

---

## 4. Repository Model

### 4.1 Required Repository Domains

The product should explicitly recognize these repository domains:

- Workbook Repository
- Campaign Repository
- Workspace Repository
- Rule Repository
- Draft Repository
- Execution Repository
- Settings Repository

### 4.2 Business Roles

Repository roles:

- Workbook Repository: source file buffers and metadata
- Campaign Repository: normalized campaign objects
- Workspace Repository: persisted session state and active context
- Rule Repository: rule assets and lifecycle bindings
- Draft Repository: generated proposals and selection state
- Execution Repository: export and run history
- Settings Repository: local preferences and mappings

### 4.3 Version 3.0 Reality

Current code concentrates most of this behavior inside the workspace store and a single IndexedDB snapshot.

This is acceptable as a first implementation, but the architecture should still name the intended repository boundaries explicitly.

---

## 5. Persistence Scope

### 5.1 Required Persisted State

Version 3.0 should preserve:

- lifecycle rule assets and custom saved rules
- uploaded file metadata
- original workbook buffer
- parse status and diagnostics
- parsed campaign data
- performance rows
- active campaign
- active lifecycle
- workspace mode
- open tabs
- recent ad data
- recent data match summary
- generated drafts
- selected draft IDs

### 5.2 User Value

Persistence should allow the user to:

- refresh without losing work
- return later and continue
- trust that parsing and review effort are not wasted

---

## 6. IndexedDB Strategy

### 6.1 Design Goal

IndexedDB is the correct local persistence layer for version 3.0 because it can handle:

- structured object state
- large datasets
- binary workbook buffers
- asynchronous access

### 6.2 Current Implementation Mapping

Current code already uses:

- database name: `amazon-ppc-workspace`
- object store: `snapshots`
- snapshot key: `current`

### 6.3 Current Snapshot Shape

Current persisted payload includes:

- version
- savedAt
- snapshot

This is a strong beginning for local repository design.

### 6.4 Functional Requirements

The persistence layer must support:

- database open
- schema initialization
- snapshot read
- snapshot write
- snapshot delete

---

## 7. Workspace Snapshot Model

### 7.1 Design Goal

Workspace snapshot is the main persisted continuity artifact in version 3.0.

### 7.2 Snapshot Contents

Current workspace snapshot already captures:

- rules
- campaign groups
- campaign sheet groups
- performance rows
- active campaign group
- active lifecycle group
- workspace mode
- open tabs
- selected draft IDs
- parse state
- workbook metadata
- parsed row count
- parsed sheets
- parse diagnostics
- recent data state
- recent data match summary
- adjustment drafts

### 7.3 Snapshot Principle

The snapshot should represent:

- enough data to resume work
- the active rule repository state, including user-created and user-edited lifecycle rules
- but not accidental UI noise with no long-term value

### 7.4 Versioning Requirement

Every persisted snapshot must be versioned so migrations can be handled safely later.

---

## 8. State Domain Separation

### 8.1 Design Goal

The system should progressively separate long-lived product state from temporary UI state.

### 8.2 Domain Categories

Recommended categories:

- source repository state
- workspace session state
- optimization state
- execution state
- ephemeral UI interaction state

### 8.3 Current Mapping

Current store mixes these domains in one Zustand store.

That is acceptable for version 3.0, but documentation should make the next refactor direction explicit.

### 8.4 Recommended Refactor Direction

Later implementation should separate:

- repository-facing data state
- interaction-layer UI state
- engine execution state

---

## 9. Persistence Lifecycle

### 9.1 Restore Flow

```text
Open App
  -> Open IndexedDB
  -> Read Current Snapshot
  -> Validate Snapshot Version
  -> Hydrate Workspace Store
  -> Resume Previous Session
```

### 9.2 Save Flow

```text
State Changes
  -> Build Workspace Snapshot
  -> Write to IndexedDB
  -> Update Persistence Status
```

### 9.3 Clear Flow

```text
User Confirms Reset
  -> Delete Persisted Snapshot
  -> Reset Workspace State
  -> Load Default or Empty State
```

### 9.4 Current Implementation Mapping

Current UI already exposes local persistence status and a clear-persisted-state action.

This is an important user-trust feature and should be retained.

---

## 10. Persistence Status UX

### 10.1 Design Goal

Persistence should be visible enough to build trust without overwhelming the user.

### 10.2 Required States

Version 3.0 should explicitly model:

- loading
- ready
- saving
- saved
- failed

### 10.3 Current Implementation Mapping

Current workspace UI already communicates these states.

### 10.4 UX Requirement

Users should understand whether:

- prior work is being restored
- current work is being saved
- save failed and may require action

---

## 11. Repository Contracts

### 11.1 Near-Term Repository Interfaces

The next implementation layer should move toward explicit repository contracts such as:

- `WorkbookRepository`
- `WorkspaceRepository`
- `RuleRepository`
- `DraftRepository`
- `ExecutionRepository`

### 11.2 Responsibility Boundaries

Repository contracts should focus on:

- data load and save
- object retrieval
- object persistence
- snapshot version migration

They should not contain view-specific rendering logic.

---

## 12. Binary Asset Handling

### 12.1 Design Goal

The original workbook buffer is a critical asset because export depends on it.

### 12.2 Required Rules

The system must:

- preserve original workbook buffer
- avoid mutating source buffer directly
- store enough metadata to relate drafts back to the source workbook

### 12.3 Future Direction

Future versions may store:

- multiple workbook versions
- export artifact history
- source checksum

---

## 13. Rule and Draft Persistence

### 13.1 Design Goal

Rules and drafts should be treated as repository objects, not just in-memory lists.

### 13.2 Rule Persistence

Version 3.0 may still bootstrap from static default rules, but the architecture should evolve toward repository-backed rule loading and saving.

### 13.3 Draft Persistence

Draft persistence should preserve:

- draft objects
- selection state
- generation source
- future validation results

### 13.4 Execution History

Execution history is not fully implemented yet, but the repository model should reserve space for it from the start.

---

## 14. Migration and Versioning

### 14.1 Design Goal

Persisted data must survive product evolution safely.

### 14.2 Required Strategy

The system should use:

- persisted payload version
- migration functions
- compatibility checks

### 14.3 Current Implementation Mapping

Current persisted snapshot already includes a version field.

This should remain mandatory for every future persisted format.

---

## 15. Future Cloud Mapping

### 15.1 Design Goal

The local repository model should map cleanly to future cloud SaaS architecture.

### 15.2 Mapping Table

| Version 3.0 Local Concept | Future Cloud Concept |
| --- | --- |
| IndexedDB snapshot | tenant workspace record |
| local rule data | shared rule registry |
| local draft list | server draft repository |
| local execution summary | audited execution log |
| local settings | user preference profile |

### 15.3 SaaS Evolution Path

Likely future evolution:

1. local-first only
2. optional cloud backup
3. account-bound sync
4. shared workspaces
5. approval and audit workflows

---

## 16. Error Handling

### 16.1 Persistence Errors

The system must handle:

- IndexedDB open failure
- read failure
- write failure
- delete failure
- incompatible snapshot version

### 16.2 User-Facing Behavior

Errors should be:

- explicit
- recoverable
- non-destructive where possible

### 16.3 Fallback Principle

If persistence fails, the runtime workspace should continue operating when possible, even if continuity is degraded.

---

## 17. Performance Requirements

### 17.1 Core Requirement

Persistence should not block core interactions.

### 17.2 Required Capabilities

The system should support:

- async save
- async restore
- large state payloads
- efficient binary storage

### 17.3 Recommended Direction

Future improvements may include:

- segmented repositories
- differential persistence
- compression strategies where justified

---

## 18. Summary

Version 3.0 defines repository and persistence as a local-first SaaS foundation built on:

- explicit repository concepts
- IndexedDB continuity
- versioned workspace snapshots
- persisted drafts and campaign state
- future cloud-compatible boundaries

This is the storage layer that makes the product feel durable and software-like rather than disposable.
