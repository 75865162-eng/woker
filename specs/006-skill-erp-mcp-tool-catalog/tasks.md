# Tasks: Skill ERP MCP Tool Catalog

**Input**: Design documents from `specs/006-skill-erp-mcp-tool-catalog/`

## Phase 1: User Story 1 - See and authorize the current MCP tools (P1)

- [X] T001 Update `AmazonMcpPanel` to display the API-provided tool registry and an explicit empty state.
- [X] T002 Remove the duplicate hard-coded tool catalog from `SkillErpSettingsPanel` and revise any stale pending-interface summary affected by the delivered Ads read tools.
- [X] T003 Update `tests/browser/amazon-multistore.spec.ts` to verify Ads tools are visible and selectable from the server fixture, then verify current credential lifecycle coverage remains intact.
- [X] T004 Run the targeted browser test, changed-file ESLint, and `git diff --check`; run and record the repository typecheck result.

## Dependencies

- T001 and T002 precede the UI assertions in T003.
- T004 follows all implementation and test changes.
