# Product Agent

## Mission

把 Market Agent 输出的市场机会，转成产品规划、PRD、成本目标和产品项目草案。

## Chain

`市场机会 -> 竞品痛点 -> 产品差异化 -> PRD -> 成本目标 -> 产品项目`

## Scope

Product Agent 运行在统一 `AgentRuntime` 上，只通过 Tool Gateway 调用外部能力。

允许：
- 读取 Market Agent 输出
- 读取竞品痛点和产品上下文
- 生成差异化方向
- 生成 PRD
- 生成成本目标
- 生成产品项目草案

禁止：
- 绕过 Tool Gateway
- 直接改外部系统
- 把未审批的项目草案当作已执行项目

## Runtime

Product Agent 与 Market Agent 共用同一 runtime / approval / trace / memory / event 模型。

## Input

支持：
- `naturalLanguageGoal`
- `marketplace`
- `category`
- `targetPrice`
- `targetCost`
- `targetMargin`
- `productConstraints`
- `marketOpportunity`
- `marketReport`
- `currentSkuContext`

## Output

`ProductDevelopmentReport` 包含：
- `marketOpportunitySummary`
- `competitorPainPoints`
- `differentiation`
- `prd`
- `costTarget`
- `projectDraft`
- `scores`
- `evidence`
- `summary`
- `recommendation`

## Tool Surface

当前工具：
- `product.market.opportunity.load`
- `product.competitor.painpoints.scan`
- `product.differentiation.design`
- `product.prd.compose`
- `product.cost.target.estimate`
- `product.project.draft`

## Permission Model

READ:
- Market Agent output
- 市场机会
- 竞品痛点
- 成本相关上下文
- 内部产品上下文

WRITE:
- 产品 brief
- PRD
- 成本目标
- 产品项目草案
- recommendation

## Handoff

Market Agent 结果可通过本地 session handoff 进入 Product Agent：
- 选中 Market Opportunity
- 存入 `amazon.agent-platform.product-handoff`
- 打开 `/agents/product`

Product Agent 的结果可继续 handoff 到 Supplier Agent：
- 选中 Product Report
- 存入 `amazon.agent-platform.supplier-handoff`
- 打开 `/agents/supplier`

Product Agent 的结果也可 handoff 到 Listing Agent：
- 选中 Product Report
- 存入 `amazon.agent-platform.listing-handoff`
- 打开 `/agents/listing`

## Approval

Product project creation 是高风险动作，必须：

`Recommendation -> Approval Request -> Human Decision -> Action`

## UI

入口：
- `/agents`
- `/agents/product`

Workbench 包含：
- Market handoff
- Product brief
- PRD
- Cost target
- Project draft
- Execution timeline
- Tool calls
- Evidence
- Approval panel
