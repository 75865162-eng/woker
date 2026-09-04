# PPC Agent

## Mission

PPC Agent 是 Amazon AI Commerce OS 中连接现有 PPC 优化工作台的生产级业务 Agent。它读取 Amazon Ads / Bulk 工作区数据、SellerSprite 关键词信号、Historical PPC、Product Data，并输出：

- Diagnosis
- Opportunity
- Bid Recommendation
- Negative Recommendation
- Campaign Recommendation
- Human Approval handoff

PPC Agent 不直接修改广告。所有高风险动作必须走：

AI Recommendation -> Human Approval -> Bulk / Amazon API

## Runtime Boundary

PPC Agent 运行在统一 Agent Runtime 上：

Agent -> Tool Gateway -> PPC Analytics Adapter -> Amazon Ads / SellerSprite / Historical PPC / Product Data

当前实现中的 adapter 是本地可测试的 `PPC Analytics Adapter`，用于消费现有 workspace 快照和合成 SellerSprite 关键词信号。未来接入 Amazon Ads API、SellerSprite MCP、SP-API 时，只新增 Tool Adapter，不修改 Agent Runtime。

已新增 `Amazon Ads API Adapter` scaffold：

- `amazon.ads.recommendation.plan`：LOW risk，把 PPC recommendation bundle 转成 dry-run Amazon Ads execution plan。
- `amazon.ads.recommendation.apply`：CRITICAL risk，保留真实写操作边界；默认返回 `DRY_RUN_BLOCKED`，除非显式启用 `AMAZON_ADS_EXECUTION_ENABLED=true`，且即便启用也仍等待真实 HTTP client 阶段实现。

## Agent Definition

文件：`src/lib/agent-platform/ppc.ts`

Agent id:

```ts
ppc
```

工具：

- `ppc.workspace.load`
- `ppc.ads.snapshot`
- `ppc.keyword.signal`
- `ppc.diagnosis.analyze`
- `ppc.bid.recommend`
- `ppc.negative.recommend`
- `ppc.campaign.recommend`
- `ppc.report.compose`
- `amazon.ads.recommendation.plan`

权限：

- `ppc.read.ads`
- `ppc.read.keyword`
- `ppc.read.historical`
- `ppc.read.product`
- `ppc.write.diagnosis`
- `ppc.write.opportunity`
- `ppc.write.bidRecommendation`
- `ppc.write.negativeRecommendation`
- `ppc.write.campaignRecommendation`
- `ppc.write.report`

禁止：

- 未经审批直接修改 Amazon Ads
- 绕过 Tool Gateway 调用外部系统
- 直接写回 Bulk 或广告 API

## Input

支持：

- `naturalLanguageGoal`
- `marketplace`
- `campaignGroupId`
- `workspaceUnitId`
- `workspaceMode`
- `campaignGroups`
- `performanceRows`
- `overallAdDataRows`
- `productContext`
- `sellerSpriteKeywords`
- `historicalData`
- `targetAcos`
- `targetRoas`
- `targetMargin`

前端 `/agents/ppc` 会自动从现有 PPC workspace 读取：

- campaign groups
- Bulk performance rows
- Overall ad data rows
- pending adjustment drafts
- active campaign group / workspace unit

## Output

`PpcAnalysisReport`：

- scope
- summary
- diagnosis
- opportunities
- bidRecommendations
- negativeRecommendations
- campaignRecommendations
- actionPlan
- evidence
- recommendation
- generatedAt

同时输出可交给现有 Bulk 流程的 `adjustmentDrafts`。

## Evidence

每个重要判断都包含 evidence：

- `claim`
- `dataSource`
- `toolId`
- `metric`
- `value`
- `timestamp`

这保证用户可以追踪：

- 为什么判断 ACOS 高？
- 哪些关键词触发降价？
- 哪些数据源支撑否定词建议？
- 哪个 Tool 生成了这个判断？

## Human Approval

新增 API：

- `POST /api/agents/ppc/executions`
- `POST /api/agents/ppc/actions`

`/api/agents/ppc/actions` 只创建审批请求：

- `bulk.export.prepare` -> HIGH risk
- `amazon.ads.apply` -> CRITICAL risk

发起 `amazon.ads.apply` 审批时，系统会先通过 Tool Gateway 调用 `amazon.ads.recommendation.plan`，把 bid / negative / campaign recommendations 转成 Amazon Ads execution plan 并写入 approval payload。审批通过后，当前基础设施会记录 approval result 和 action executed trace。真正的 Bulk 写回仍应由现有导出流程执行；真实 Amazon Ads API HTTP 写入等待后续 Adapter 阶段实现。

`bulk.export.prepare` 审批通过后，`/agents/ppc` 会把 PPC Agent 生成的 `adjustmentDrafts` 推入现有 PPC 工作台 `pendingAdjustmentDrafts` 队列。用户随后进入 `/workspace`，继续使用现有 Bulk 导出能力完成写回文件下载。

## Frontend

页面：

- `/agents/ppc`

能力：

- 输入诊断目标
- 自动读取当前 PPC workspace
- 输入目标 ACOS / ROAS / Margin
- 输入 SellerSprite keyword seed
- 输入 Product Data 摘要
- 运行 PPC Agent
- 查看 Execution Timeline
- 查看 Tool Calls
- 查看 Diagnosis
- 查看 Opportunity Score
- 查看 Bid Recommendation
- 查看 Negative Recommendation
- 查看 Campaign Recommendation
- 发起 Bulk / Amazon API 审批
- Approve / Reject
- Bulk handoff 审批通过后进入 `/workspace` 待处理修改队列
- Amazon API handoff 展示 dry-run execution plan

## Reuse

复用现有：

- `src/lib/types.ts`
- `src/lib/metrics.ts`
- `src/lib/stores/workspace-store.ts`
- Agent Runtime / Tool Gateway / Approval / Trace
- Amazon Ads API Adapter scaffold
- App Shell / Card / Button / Badge UI

后续可进一步复用：

- `src/lib/rule-engine/engine.ts`
- `src/lib/workspace/workspace-drafts.ts`
- `src/lib/excel/bulk-export.ts`

## Current Limits

- Amazon Ads API 写操作尚未实现。
- Amazon Ads execution plan 已生成并进入 approval payload，但真实 HTTP apply 仍默认 blocked。
- `bulk.export.prepare` 已可进入现有待处理草稿队列，但仍需要用户在 `/workspace` 手动导出 Bulk 文件。
- 当前 PPC Adapter 使用 workspace 快照和本地分析逻辑；真实 SellerSprite adapter 后续仍应接入 Tool Gateway。

## Next Phase

建议下一阶段补真实 Amazon Ads read-only data adapter 或 SellerSprite MCP adapter，保持 Agent 核心代码不变。
