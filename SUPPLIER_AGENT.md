# Supplier Agent

## Mission

把 Product Agent 输出的产品规划，转成供应商推荐、报价分析、RFQ 草稿和 sourcing project draft。

## Chain

`Product Opportunity -> Product Plan -> Supplier Shortlist -> Quotation Analysis -> RFQ -> Sourcing Project`

## Scope

Supplier Agent 运行在统一 `AgentRuntime` 上，只通过 Tool Gateway 调用外部能力。

允许：
- 读取 Product Agent 输出
- 读取 PRD、产品计划和供应链上下文
- 生成供应商推荐
- 生成报价分析
- 生成 RFQ 草稿
- 生成 sourcing project draft

禁止：
- 绕过 Tool Gateway
- 直接修改外部系统
- 把未审批的 project draft 当作已执行项目

## Runtime

Supplier Agent 与 Market / Product 共用同一 runtime / approval / trace / memory / event 模型。

## Input

支持：
- `naturalLanguageGoal`
- `marketplace`
- `category`
- `prd`
- `productReport`
- `productHandoff`
- `currentSkuContext`

## Output

`SupplierAnalysisReport` 包含：
- `supplierRecommendations`
- `quotationAnalysis`
- `rfqDraft`
- `supplierProjectDraft`
- `evidence`
- `summary`
- `recommendation`

## Tool Surface

当前工具：
- `supplier.product.load`
- `supplier.database.search`
- `supplier.quotation.analyze`
- `supplier.recommendation.compose`
- `supplier.rfq.draft`
- `supplier.project.draft`

## Permission Model

READ:
- Product Agent output
- PRD
- supplier database
- historical quotation

WRITE:
- supplier recommendation
- RFQ draft
- quotation analysis
- sourcing project draft

## Handoff

Product Agent 的结果可通过本地 session handoff 进入 Supplier Agent：
- 选中 Product Report
- 存入 `amazon.agent-platform.supplier-handoff`
- 打开 `/agents/supplier`

## Approval

Supplier project creation 是高风险动作，必须：

`Recommendation -> Approval Request -> Human Decision -> Action`

## UI

入口：
- `/agents`
- `/agents/supplier`

Workbench 包含：
- Product handoff
- Supplier recommendations
- RFQ draft
- Quotation analysis
- Project draft
- Execution timeline
- Tool calls
- Evidence
- Approval panel
