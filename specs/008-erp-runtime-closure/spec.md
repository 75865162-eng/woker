# ERP runtime production closure

2026-11-06. Extends existing runtime deliverables; no unrelated refactor.

- FR-001: Root local environment and injected server environment remain the intended single source. Real config cutover requires reviewed targets and explicit approval.
- FR-002: Import/product export and image execution use durable ownership, bounded retry, expiry recovery and stale executor fencing across every final database publication. Attempt output keys cannot overwrite another attempt.
- FR-003: Source typecheck excludes historical generated build artifacts; Next build still validates its own generated routes. No skipping type errors.
- FR-004: Mock/isolation tests demonstrate success, duplicate claims, expiry, stale publication, Redis loss and database reconnect.
- FR-005: Deployment, real tasks, migrations, backups, Git synchronization require separate concrete approvals; never mark them complete based on fixture evidence.

Acceptance: standard source checks green; migration SQL reviewed but not applied to existing data; durable recovery tested in disposable PostgreSQL; production checks tracked individually.
