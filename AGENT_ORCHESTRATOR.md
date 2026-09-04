# Agent Orchestrator

## Positioning

Agent Orchestrator is the workflow control layer for the Amazon AI Commerce OS.

It connects:

```text
User -> Orchestrator -> Market Agent -> Product Agent -> Supplier Agent -> Listing Agent -> Launch -> PPC Agent
```

It does not replace business Agents and does not call their tools directly. Market, Product, Supplier, Listing, and PPC keep their own definitions, Tool Gateway permissions, execution traces, recommendations, approvals, and memory.

## Runtime Boundary

Agent Orchestrator runs on the same `AgentRuntime` as every other Agent.

Implemented abstractions:

- `orchestratorAgentDefinition`
- `orchestratorToolDefinitions`
- `createOrchestratorInternalAdapter`
- `createOrchestratorExecutionExecutor`
- `OrchestratorPlan`
- `OrchestratorStage`
- `OrchestratorHandoff`
- `OrchestratorExecutionOutput`

## Tool Surface

Orchestrator only owns internal workflow tools:

- `orchestrator.context.collect`
- `orchestrator.plan.build`
- `orchestrator.handoff.prepare`
- `orchestrator.launch.gate`
- `orchestrator.ppc.handoff`

It does not have SellerSprite, Amazon Ads, Product, Supplier, Listing, or PPC tool permissions.

## Stage Contract

The plan always uses this ordered stage chain:

1. Market
2. Product
3. Supplier
4. Listing
5. Launch
6. PPC

Launch is modeled as an approval gate, not as a separate business Agent. PPC is marked `blocked_until_launch` until launch approval is present.

## Human-in-the-loop

When `launchApproved` is not true, Orchestrator requests a `HIGH` risk approval through the shared Runtime approval API:

```text
Recommendation -> Approval Request -> Human Decision -> PPC handoff
```

The Orchestrator itself still only prepares a plan and handoff payload. It never modifies ads, listings, supplier records, or product records.

## API

- `GET /api/agents/orchestrator`
- `POST /api/agents/orchestrator/executions`

The specialized routes proxy into the existing generic Agent routes.

## UI

- `/agents/orchestrator`

The UI shows:

- orchestration goal input
- marketplace/category/SKU/ASIN context
- launch approval toggle
- six-stage commerce chain
- handoff payloads
- execution trace
- tool calls
- links to downstream Agent pages

## Security

Orchestrator is intentionally denied direct downstream business tools. Tool access is still enforced by:

```text
AgentDefinition.tools + AgentDefinition.permissions + AgentToolDefinition.permission
```

This prevents the Orchestrator from bypassing the Tool Gateway and calling SellerSprite MCP, Amazon Ads API, or business Agent adapters directly.

