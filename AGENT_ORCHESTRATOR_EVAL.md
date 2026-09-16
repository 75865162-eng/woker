# Agent Orchestrator Evaluation

## Evaluation Cases

The Orchestrator ships with 12 evaluation cases in `src/lib/agent-platform/orchestrator.ts`.

Coverage:

- full Market to PPC chain
- Market output to Product handoff
- Product PRD to Supplier handoff
- Supplier output to Listing handoff
- Listing draft before Launch gate
- Launch approved to PPC handoff
- missing goal fallback
- non-US marketplace handling
- current SKU and ASIN context carryover
- permission boundary
- PPC blocked before Launch approval
- trace and evidence auditability

## Acceptance Criteria

- The output plan contains exactly six stages:
  `market`, `product`, `supplier`, `listing`, `launch`, `ppc`.
- Orchestrator uses only `orchestrator.*` tools.
- PPC stage is `blocked_until_launch` unless `launchApproved` is true.
- Missing inputs are represented as stage status and handoff payload gaps, not hidden assumptions.
- Trace includes decision, tool calls, recommendation, approval request, and completion/waiting state.
- Handoff payloads are structured JSON objects suitable for downstream Agent pages and APIs.

