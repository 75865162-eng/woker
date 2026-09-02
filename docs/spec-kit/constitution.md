# Constitution

## Purpose
Build an ERP system that can evolve without rewrites, with strict control over data consistency, workflow safety, and auditability.

## Core Principles

1. Draft first, not direct mutation.
2. Business rules belong in domain logic, not UI.
3. Data model comes before screens.
4. Every business action must be traceable.
5. Backward compatibility is the default.
6. Storage boundaries must stay portable.
7. Permissions must be explicit and least-privilege.
8. Imports, exports, and batch jobs must be recoverable.

## Non-Negotiables

- No silent data loss.
- No hidden state transitions.
- No amount, stock, or status updates without validation.
- No direct file-path coupling in business entities.
- No temporary workaround promoted to permanent architecture.

## System Rules

- Every important record should have a stable identifier.
- Draft and finalized records must remain separate.
- Concurrent writes must be guarded by versioning, locking, or idempotency.
- Changes that affect accounting, stock, or approvals require audit logs.
- New modules must preserve existing APIs unless a breaking change is explicitly approved.

## Quality Bar

- Code must be readable, typed, and testable.
- Domain logic should be extracted into small pure functions where possible.
- Every meaningful change should include validation steps.
- If a change touches shared workflows, add a rollback path or compatibility plan.

## Decision Rule

When in doubt, choose the option that protects data integrity, traceability, and future migration.
