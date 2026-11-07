# Closure tasks

- [x] T001 Implement source/current-build type isolation (FR-003). Source typecheck and dev verified; CI full build remains pending.
- [x] T002 Add additive lease schema and SQL draft; do not apply to existing databases (FR-002).
- [x] T003 Fence import/export and image writes and use unique attempt outputs (FR-002). Implemented; heavy-computation kill and import-specific fault injection remain separate validation gaps.
- [x] T004 Recover only expired token-owned executions with bounded attempts (FR-002).
- [x] T005 Validate mock and disposable database lifecycle and success paths (FR-004). Five execution tests and fifteen integration records passed; does not complete every FR-004 failure scenario.
- [x] T006 Update delivery and concrete approval scopes (FR-001/FR-005).
- [x] T007 Local configuration/process cutover (FR-005). A+B/3010/exact Sellfox force-stop approved and executed; four registrations online/ready/matching. Sellfox whitelist blocks business success. CI/server/backup activation remain separate deferred gates.

Scope decision: user selected local closure only; server publication/reboot and production backup activation are deferred. Daily/30-day backup retention requested; offsite location pending. T007 local cutover approval is documented in docs/erp-runtime-local-cutover-execution-approval.md; A+B, 3010 and exact lingering Sellfox SIGKILL subsequently approved and executed.

- [ ] T008 Validate import-specific stale executor plus file/export/audit rollback, and OS-kill recovery during real computation using mock data.
- [ ] T009 Run CI full build/route validation after approved Git scope synchronization. Source-only typecheck cannot replace this gate.

T002 update: exact reviewed lease SQL applied to approved local database 2026-11-07; no other migration applied.

Plan A update (current chat): unified Amazon preflight loader and 4 tests passed; 29 runtime/release tests passed; disposable integration passed 9 execution cases and 17 result records. T008 now covers product-export stale publication, final audit rollback, SIGKILL before export publication and mock image CPU recovery. Keep T008 open for native engine/Bulk parsing and in-flight database restart coverage; do not convert mock gates into proof of those scenarios. Source typecheck and targeted lint passed. See docs/erp-runtime-plan-a-delivery.md; no real config/process/server changes or Git sync in this stage.
