# Amazon PPC Optimization Workspace
## Rule System Specification
### Version 3.0

---

## 1. Document Purpose

This document defines the rule system architecture for Amazon PPC Optimization Workspace Version 3.0.

It covers:

- Rule Center positioning
- Rule Repository design
- Rule Context design
- Rule Engine execution model
- Draft generation contract
- Simulation compatibility
- AI compatibility

The goal is to turn the rule system into a reusable product platform, not just an isolated engine utility.

---

## 2. Design Goals

The rule system of version 3.0 must achieve the following:

1. Separate rule storage from rule execution.
2. Separate rule context construction from UI state.
3. Produce drafts instead of direct mutations.
4. Support lifecycle-based rule loading.
5. Reuse the same condition language across dashboard filters, simulation, and future AI modules.
6. Make rule behavior explicit enough that Codex can implement features with minimal ambiguity.

---

## 3. Rule System Position in Product Architecture

### 3.1 Product-Level Positioning

The rule system is a shared platform capability used by:

- Campaign Workspace
- Rule Center
- Simulation
- Dashboard filtering reuse
- Draft generation
- Future AI copilots

### 3.2 Official Pipeline

The official pipeline is:

```text
Rule Center
  -> Rule Repository
  -> Rule Context Builder
  -> Rule Engine
  -> Draft Generator
  -> Draft Review
  -> Export Engine
```

This replaces the old mental model where the rule engine was treated as a single page action.

---

## 4. Core Principles

### 4.1 Rule as Asset

A rule is a reusable asset, not a hardcoded branch in business logic.

### 4.2 Context Before Execution

The engine must only evaluate normalized context objects.

The engine should not reach into page state directly.

### 4.3 Draft-First Safety

Rules do not directly write back to workbook data.

They generate drafts that can be reviewed, validated, selected, and exported.

### 4.4 Shared Condition Language

The condition model must be shared across:

- rule authoring
- rule execution
- rule preview
- dashboard filters
- future simulation
- future AI suggestion explanation

### 4.5 Deterministic Execution

Given the same scope, same data, and same rule set, the engine must produce the same result.

---

## 5. Rule Center

### 5.1 Design Goal

Rule Center is the control plane for all rule assets in the product.

### 5.2 Business Responsibilities

Rule Center is responsible for:

- listing rules
- creating rules
- editing rules
- enabling and disabling rules
- binding rules to lifecycle groups
- previewing rule behavior
- simulating outputs
- exposing JSON-level contracts

### 5.3 User Value

Rule Center allows operators and optimization specialists to manage logic centrally without mixing editing concerns into campaign workspace execution flows.

### 5.4 Functional Requirements

Rule Center must support:

1. rule list with search and filters
2. lifecycle filter
3. priority display
4. enabled state control
5. IF / THEN editor
6. preview statistics
7. version visibility
8. JSON contract inspection

### 5.5 Future Extension

Future Rule Center features:

- approval workflow
- rule sharing
- template import
- AI-assisted drafting
- multi-tenant rule scopes

---

## 6. Rule Repository

### 6.1 Design Goal

Rule Repository stores rule assets independently from execution flows and UI pages.

### 6.2 Business Responsibilities

Rule Repository manages:

- rule definitions
- lifecycle bindings
- status flags
- version data
- metadata
- future authorship and scope

### 6.3 Required Rule Record

Each stored rule must include:

- id
- name
- lifecycleGroupId
- enabled
- priority
- conditionGroup
- actions
- updatedAt

### 6.4 Repository Operations

Version 3.0 should support:

- load rules
- load rules by lifecycle
- save rule
- update rule
- toggle rule
- list active rules

### 6.5 Current Implementation Mapping

Current repository behavior is represented in a simplified static form by:

- `src/data/default-rules.ts`

The next implementation stage should move this into an explicit rule repository abstraction.

### 6.6 Future Extension

Later versions may support:

- versioned rules
- shared repositories
- import/export of rule packs
- cloud synchronization

---

## 7. Rule Contract

### 7.1 Canonical Structure

The canonical rule structure is:

```ts
type Rule = {
  id: string;
  name: string;
  lifecycleGroupId: LifecycleGroupId;
  enabled: boolean;
  priority: number;
  conditionGroup: ConditionGroup;
  actions: RuleAction[];
  updatedAt: string;
};
```

### 7.2 Contract Requirements

Each rule must be:

- uniquely identifiable
- human-readable
- deterministically ordered
- scope-bound
- explainable in draft output

### 7.3 Lifecycle Binding

In version 3.0, lifecycle binding is required for active rule loading.

Future versions may introduce:

- shared rules
- scope overrides
- policy inheritance

---

## 8. Condition System

### 8.1 Design Goal

The condition system provides the declarative language that drives evaluation.

### 8.2 Condition Data Sources

Supported sources in version 3.0:

- bulk
- recent
- comparison
- derived

### 8.3 Supported Metrics

Current metric families include:

- impressions
- clicks
- ctr
- orders
- sales
- spend
- acos
- roas
- cpa
- cpc
- cvr
- acots
- asots
- topOfSearchShare
- advertisedProductOrders
- otherProductOrders
- viewableImpressions
- orderShare
- isCoreKeyword

### 8.3.1 Rule Builder Metric Selector Baseline

The Rule Builder metric selector must expose a complete condition catalog instead of only the metric currently used by the loaded rule.

The current baseline should follow the advertising-data filter panel and at minimum expose these selectable fields:

| Category | Metric Key | UI Label | Notes |
| --- | --- | --- | --- |
| 广告数据 | impressions | 广告曝光量 | supports min / max style evaluation |
| 广告数据 | clicks | 广告点击量 | supports min / max style evaluation |
| 广告数据 | ctr | 广告点击率 CTR | percentage metric |
| 广告数据 | sales | 广告销售额 | monetary metric |
| 广告数据 | spend | 广告花费 | monetary metric |
| 广告数据 | acos | ACOS | percentage metric |
| 广告数据 | orders | 广告订单量 | integer metric |
| 广告数据 | cvr | 广告转化率 | percentage metric |
| 广告数据 | cpc | CPC | monetary metric |
| 广告数据 | cpa | CPA | monetary metric |
| 广告数据 | roas | ROAS | ratio metric |
| 广告数据 | acots | ACoTS | percentage metric |
| 广告数据 | asots | ASoTS | percentage metric |
| 广告数据 | viewableImpressions | 可见展示次数 | visibility metric |
| 广告数据 | topOfSearchShare | 搜索首页 Top Of Search 占比 | percentage metric |
| 广告数据 | advertisedProductOrders | 本广告产品订单量 | bulk-specific extension metric |
| 广告数据 | otherProductOrders | 其他广告产品订单量 | bulk-specific extension metric |
| 派生字段 | orderShare | 单量占比 | derived from matched Overall rows |
| 派生字段 | isCoreKeyword | 是否核心词 | executable business flag |

The source selector must also expose the full supported source list:

- `Bulk 当前数据`
- `Overall 所有日期广告数据`
- `对比指标`
- `派生指标`

### 8.4 Supported Operators

Version 3.0 operators:

- eq
- neq
- gt
- gte
- lt
- lte
- between
- increase_by
- decrease_by

### 8.5 Nested Logic

Condition groups must support nested boolean structures using:

- AND
- OR

This supports both simple rules and future advanced strategy expressions.

### 8.6 Current Implementation Behavior

Current engine behavior already supports:

- recursive condition group evaluation
- bulk metric evaluation
- recent metric evaluation
- comparison metric evaluation
- derived order share evaluation
- derived core-keyword flag evaluation

This is a strong base for the formalized system.

---

## 9. Rule Context

### 9.1 Design Goal

Rule Context is the normalized, engine-ready evaluation object built for each optimization entity.

### 9.2 Why Rule Context Matters

Without explicit context modeling, rule logic leaks into:

- UI state
- parser shape
- ad hoc helper functions
- inconsistent simulation behavior

Rule Context solves this by creating one shared evaluation contract.

### 9.3 Required Context Fields

At minimum, context should provide:

- optimization entity identity
- campaign identity
- lifecycle identity
- bulk metrics
- recent metrics if available
- comparison metrics if derivable
- derived metrics
- safety flags
- source row locator data

### 9.4 Current Implementation Mapping

The current engine builds context with:

- `bulkRow`
- `overallRow`
- `campaignOverallRows`
- `orderShare`
- `isCoreKeyword`

This should be formalized into a `RuleContext` type and a `RuleContextBuilder`.

### 9.5 Context Builder Responsibilities

The context builder should:

1. scope rows to the active campaign
2. match recent data correctly
3. derive comparison values
4. derive share metrics
5. attach lifecycle and safety metadata
6. output a stable evaluation object

### 9.6 Matching Strategy

Current matching strategy is based on:

- campaign scope
- normalized keyword text
- normalized match type

This should remain explicit in the spec so that future refactors do not silently change behavior.

---

## 10. Rule Engine

### 10.1 Design Goal

Rule Engine evaluates applicable rules against scoped context objects and produces draft proposals.

### 10.2 Input Contract

Current input contract:

```ts
type OptimizationInput = {
  campaignGroup: CampaignGroup;
  rows: PerformanceRow[];
  overallAdDataRows?: OverallAdDataRow[];
  rules: Rule[];
};
```

### 10.3 Recommended Future Input Contract

Recommended next-stage contract:

```ts
type RuleEngineInput = {
  campaign: Campaign;
  contexts: RuleContext[];
  rules: Rule[];
  enginePolicy?: RuleEnginePolicy;
};
```

### 10.4 Execution Flow

The execution flow should be:

```text
Receive Engine Input
  -> Scope Contexts to Campaign
  -> Load Active Rules for Lifecycle
  -> Sort by Priority
  -> Evaluate Conditions
  -> Resolve Conflicts
  -> Generate Actions
  -> Convert Actions to Drafts
  -> Return Draft Set
```

### 10.5 Rule Loading Behavior

The engine must load only:

- enabled rules
- rules bound to the active lifecycle
- rules applicable to the current entity type if entity scoping exists

### 10.6 Priority Model

Rules are executed in ascending priority order.

The rule system must define whether:

- first hit wins
- multi-hit accumulation is allowed
- same-field overrides are allowed

Current implementation behavior is effectively:

- first actionable hit wins per row for bid actions
- `no_change` can also terminate evaluation for the matched row without creating a draft

Because a touched row is skipped after a bid draft is created, and rows marked by a matched `no_change` rule are also blocked from lower-priority rules.

This behavior should be documented clearly rather than left implicit.

### 10.7 Conflict Model

Conflicts may occur when:

- multiple rules target the same row
- multiple actions target the same field
- action types are incompatible
- rule priority and safety rules disagree

Version 3.0 should enforce deterministic conflict handling.

Recommended behavior:

1. safety rule blocks highest risk outputs first
2. priority resolves same-field action conflicts
3. conflicting drafts remain explainable

### 10.8 Current Action Support

Current codebase supports multiple action types at the data level, but active draft generation is mainly implemented for bid actions.

This is important:

- the rule contract is broader than current draft generation behavior
- the spec should preserve the broader contract
- implementation can expand incrementally

### 10.9 Safety Constraints

Minimum safety constraints should include:

- minimum bid floor
- no invalid negative bids
- no export without row locator
- no ambiguous recent-data match dependence
- no direct mutation of source rows

### 10.10 Determinism Requirement

For the same inputs, the engine must return identical outputs.

No hidden UI state should influence rule results.

---

## 10A. Official Lifecycle Rule Pack

### 10A.1 Source Semantics

In the current product rule pack:

- `Bulk` means Amazon Bulk Operations data
- `Overall` means all-date advertising data imported from `所有日期广告数据.csv`
- `Bulk无订单` means `Bulk Orders = 0`
- `Core Keyword` is an executable derived flag, not display-only text

### 10A.2 Launch / 新品组

| Priority | IF | THEN |
| --- | --- | --- |
| 1 | Orders >= 2 AND ACOS < 25% | Bid +15% |
| 2 | Orders >= 2 AND 25% <= ACOS < 45% | Bid +10% |
| 3 | Orders >= 2 AND 45% <= ACOS < 60% | Bid -10% |
| 4 | Orders >= 2 AND ACOS >= 60% | Bid -35% |
| 5 | Orders = 0 AND Clicks >= 18 | Bid -20% |
| 6 | Orders = 0 AND Clicks < 5 AND Impressions < 100 | Bid +10% |

### 10A.3 Mature / 成熟组

| Priority | IF | THEN |
| --- | --- | --- |
| 1 | Bulk Orders >= 2 AND Bulk ACOS < 25% AND Overall Impressions < 100 | Bid +20% |
| 2 | Bulk Orders >= 2 AND 25% <= Bulk ACOS < 35% AND Overall Impressions < 100 | Bid +10% |
| 3 | Bulk Orders >= 2 AND Bulk ACOS < 20% | Bid +10% |
| 4 | Bulk Orders >= 2 AND Bulk ACOS >= 40% | Bid -10% |
| 5 | Orders = 0 AND Clicks >= 15 | Bid -20% |
| 6 | Orders = 0 AND Clicks < 5 AND Bulk Impressions < 100 | Bid +10% |
| 7 | Bulk无订单 AND Overall ACOS 10% <= ACOS < 30% | Bid +15% |
| 8 | Bulk无订单 AND Overall ACOS 30% <= ACOS < 40% | Bid +10% |
| 9 | Bulk无订单 AND Overall ACOS 40% <= ACOS < 50% | Bid -10% |
| 10 | Bulk无订单 AND Overall ACOS >= 50% | Bid -15% |

### 10A.4 Decline / 衰退组

| Priority | IF | THEN |
| --- | --- | --- |
| 1 | Orders = 0 AND Clicks >= 10 | Bid -40% |
| 2 | Orders >= 1 AND ACOS >= 45% | Bid -30% |
| 3 | Orders >= 1 AND ACOS < 30% | No Change |
| 4 | Bulk无订单 AND Overall ACOS 10% <= ACOS < 30% | Bid +5% |
| 5 | Bulk无订单 AND Overall ACOS 30% <= ACOS < 40% | Bid +2% |
| 6 | Bulk无订单 AND Overall ACOS 40% <= ACOS < 50% | Bid -20% |
| 7 | Bulk无订单 AND Overall ACOS >= 50% | Bid -35% |

### 10A.5 Clearance / 清库存组

| Priority | IF | THEN |
| --- | --- | --- |
| 1 | Orders >= 1 AND ACOS < 35% | Bid +5% |
| 2 | Orders >= 1 AND ACOS >= 35% | Bid -15% |
| 3 | Orders = 0 AND Clicks >= 5 | Bid -35% |
| 4 | Core Keyword AND Order Share >= 10% AND Overall Impressions < 100 | Bid -25% |

## 10A.5 Bid Validation Rules（Bid 安全校验）

### Purpose

Bid Validation Rules 用于在 Lifecycle Rule 计算完成后，对 Draft Bid 进行合理性校验。

该规则不会替代 Lifecycle Rule，而是在 Final Draft 生成前进行最后一次 Bid 修正。

执行顺序：

Lifecycle Rule
↓
Generate Draft Bid
↓
Bid Validation Rule
↓
Generate Final Draft

Applicable Lifecycle：

- Launch
- Mature

Not Applicable：

- Decline
- Clearance

---

### Rule BV-01：Bid Floor Protection

| Priority | IF | THEN |
| --- | --- | --- |
| BV-01 | Overall Orders >= 2 AND Overall ACOS < 25% AND Current CPC exists AND Draft Bid < (Current CPC × 50%) | Set Draft Bid = Current CPC × 51% |

Explanation：

当整体广告表现优秀（Overall ACOS <25%，且已有稳定订单）时，如果 Lifecycle Rule 输出的 Draft Bid 已明显低于 CPC，说明竞价可能不足，容易限制后续流量。

因此直接将 Draft Bid 调整至 CPC 的 51%。如果 Draft Bid 已经高于或等于 CPC 的 51%，则不处理。

注意：

这是直接赋值（Set Draft Bid），不是增加百分比。

Example：

Current CPC = 1.00

Draft Bid = 0.42

Final Bid = 0.51

---

### Rule BV-02：Low Impression Boost

| Priority | IF | THEN |
| --- | --- | --- |
| BV-02 | Overall Orders >= 2 AND Overall ACOS < 25% AND Current CPC exists AND Draft Bid > (Current CPC × 55%) AND Draft Bid < Current CPC AND Bulk Impressions < 100 | Increase Draft Bid +15%, capped at Current CPC |

Explanation：

整体广告长期表现优秀，但 Bulk 曝光仍然不足，说明关键词仍有进一步获取流量的空间。

因此在已有 Draft Bid 基础上继续增加 15%。如果 Draft Bid 已经高于或等于 CPC，则不处理；加价后的 Final Bid 不得超过 Current CPC。

Example：

Draft Bid = 1.20

Current CPC = 1.50

Final Bid = 1.38

---

### Execution Rules

Bid Validation Rules 必须在 Lifecycle Rule 完成之后执行。

Bid Validation Rules 可以覆盖 Lifecycle Rule 输出的 Draft Bid。

Bid Validation Rules 不修改原始 Bulk 数据，仅修改 Draft。

Bid Validation Rules 不影响 Rule Hit Statistics，仅在 Draft Explanation 中追加命中记录。

Draft Example：

Lifecycle Rule：
Mature Rule #2
Bid +10%

↓

Draft Bid
0.88

↓

BV-01 Hit

↓

Final Bid
1.02
---

## 11. Draft Generation

### 11.1 Design Goal

Draft generation translates abstract rule actions into concrete, reviewable proposals.

### 11.2 Draft Contract

Each generated draft must include:

- source identity
- old value
- new value
- delta if relevant
- reason
- matched rule
- selection state
- export locator

### 11.3 Current Bid Draft Behavior

Current bid draft generation already:

- applies bid math
- rounds suggested bid
- enforces a minimum floor
- computes delta percent
- preserves rule reason text
- marks drafts selected by default

This behavior should be preserved and made configurable later if needed.

### 11.4 Reason Construction

Reasons should remain human-readable and traceable to the originating rule and action.

This is essential for:

- review confidence
- simulation explanation
- AI explanation parity

### 11.5 Validation Dependency

Draft generation does not guarantee exportability.

Export readiness must be decided later by draft validation.

---

## 12. Simulation

### 12.1 Design Goal

Simulation allows the product to preview what a rule or rule set would generate before the user commits to execution.

### 12.2 Shared Contracts

Simulation must reuse:

- Rule Repository
- Rule Context Builder
- Rule Engine
- Draft Generator

It should not use a special one-off logic path.

### 12.3 Simulation Outputs

Simulation may show:

- matched entity count
- matched campaign count
- estimated change count
- estimated spend impact
- blocked output count

### 12.4 Current Implementation Mapping

The current codebase already defines a `RulePreview` shape with:

- matchedKeywords
- matchedAdGroups
- estimatedChanges
- estimatedSpendImpact

This should become part of the formal simulation contract.

---

## 13. Dashboard Filter Reuse

### 13.1 Design Goal

The same condition language used by rules should also power advanced dashboard filtering where appropriate.

### 13.2 Shared Layer

Shared between rules and filters:

- metric selection
- operator selection
- nested condition groups
- source selection

### 13.3 Behavior Difference

The key difference is:

- filter evaluation returns inclusion or exclusion
- rule evaluation returns actions that become drafts

This distinction should be architectural, not vocabulary-level.

---

## 14. AI Compatibility

### 14.1 Design Goal

The rule system must prepare the product for future AI optimization without rewriting the core pipeline.

### 14.2 Shared AI Contracts

AI should reuse:

- repository access patterns
- context model
- draft output contract
- validation and export pipeline

### 14.3 AI Modes

Future AI may support:

- AI-authored rule suggestions
- AI-generated drafts
- AI explanation of rule outcomes
- AI copilot inside Rule Center

### 14.4 Non-Goal for Version 3.0

Version 3.0 does not require AI to execute optimizations in production.

It only requires the architecture to be AI-ready.

---

## 15. Error Handling

### 15.1 Rule Definition Errors

The system must detect:

- missing condition fields
- unsupported operator usage
- invalid action payloads
- duplicate IDs where prohibited

### 15.2 Context Errors

The system must handle:

- missing recent data
- unmatched recent rows
- ambiguous matches
- missing derived metric dependencies

### 15.3 Execution Errors

The engine must surface:

- invalid numeric outputs
- blocked actions
- unsupported entity-action combinations

### 15.4 User-Facing Behavior

Errors should be:

- explainable
- scoped
- non-destructive
- reviewable later

---

## 16. Performance Requirements

### 16.1 Core Requirement

Rule execution must feel responsive within a campaign workspace.

### 16.2 Efficiency Goals

The engine should minimize:

- repeated campaign filtering
- repeated recent-row matching
- duplicated derived metric computation

### 16.3 Recommended Optimization Direction

Recommended future improvements:

- pre-index recent rows by scoped match key
- formal context builder caching
- separate preview and execution statistics paths only where safe

---

## 17. Implementation Guidance

### 17.1 Near-Term Refactor Direction

The next implementation layer should introduce:

1. `RuleRepository`
2. `RuleContext`
3. `RuleContextBuilder`
4. `DraftGenerator`
5. `RuleEnginePolicy`

### 17.2 Non-Breaking Strategy

The refactor should be incremental:

- keep current rule contract stable
- extract repository abstraction from static default data
- formalize transient context
- separate action-to-draft conversion

### 17.3 Why This Matters for Codex

Once these abstractions are explicit, Codex can generate:

- new rule features
- simulation modules
- AI adapters
- validation layers

with much less guessing and fewer architectural mistakes.

---

## 18. Summary

Version 3.0 defines the rule system as a reusable platform built on:

- Rule Center
- Rule Repository
- Rule Context
- Rule Engine
- Draft Generator

This design turns rules into a true product capability shared by workspace optimization, simulation, filtering, and future AI workflows.
