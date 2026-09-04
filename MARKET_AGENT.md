# Market Intelligence Agent

## Mission

发现 Amazon 市场机会，并把高价值机会转成可审阅的 `ProductOpportunity` 与 `ResearchReport`。

## Scope

Market Agent 只做研究，不直接修改广告、不直接执行高风险业务动作。

允许：
- 搜索市场
- 搜索关键词
- 分析类目 / 竞品 / 趋势 / 价格 / 销量 / Review / 竞争程度
- 生成产品机会
- 生成研究报告
- 进入人审的项目创建流程

禁止：
- 直接改 Amazon Ads
- 绕过 Tool Gateway 访问外部系统
- 无证据输出结论

## Runtime

Market Agent 运行在统一 `AgentRuntime` 上，不使用单独 runtime。

执行链路：
```mermaid
flowchart LR
  U[User Goal] --> R[Goal Parsing]
  R --> S[Search Strategy]
  S --> T[Tool Gateway]
  T --> M[SellerSprite MCP Adapter]
  M --> A[Data Collection]
  A --> N[Normalization]
  N --> C[Competitor / Keyword Analysis]
  C --> O[Opportunity Detection]
  O --> P[Opportunity Scoring]
  P --> Q[Research Report]
  Q --> H[Human Review]
```

## Input

支持：
- 自然语言目标
- `marketplace`
- `category`
- `priceRange`
- `salesRange`
- `reviewRange`
- `competition`
- `targetMargin`
- `productConstraints`
- `asin`
- `keyword`

## Output

核心输出：
- `blueOceanRadar`
- `productOpportunities`
- `evidence`
- `summary`
- `recommendation`

`ProductOpportunity` 字段：
- `opportunityId`
- `productIdea`
- `marketplace`
- `category`
- `targetPrice`
- `estimatedDemand`
- `competitionScore`
- `reviewBarrier`
- `keywordOpportunity`
- `trendScore`
- `differentiationOpportunity`
- `estimatedMargin`
- `riskScore`
- `opportunityScore`
- `confidence`
- `evidence`
- `recommendation`

## Evidence Rules

每个重要判断都必须带：
- `dataSource`
- `toolId`
- `toolCallId`
- `metric`
- `value`
- `timestamp`

Trace 里必须能回放：
- 为什么得到这个结论
- 用了哪些数据
- 调了哪个工具
- 何时调用

## Tool Surface

Market Agent 当前工具：
- `sellersprite.market.search`
- `sellersprite.keyword.search`
- `sellersprite.category.analyze`
- `sellersprite.competitor.analyze`
- `sellersprite.review.analyze`
- `sellersprite.trend.analyze`
- `sellersprite.price.analyze`
- `sellersprite.sales.analyze`
- `sellersprite.competition.analyze`

## Permission Model

READ:
- SellerSprite market data
- keyword data
- competitor data
- internal product data

WRITE:
- product opportunity
- research report

## Approval

Market Agent 本身是低风险研究流程，但一旦进入项目创建，必须走：

`Recommendation -> Approval Request -> Human Decision -> Action`

项目创建是单独的高风险动作，当前由：

`POST /api/agents/market/projects`

承接。

## API

已落地接口：
- `GET /api/agents`
- `GET /api/agents/[agentId]`
- `POST /api/agents/[agentId]/executions`
- `POST /api/agents/market/executions`
- `POST /api/agents/market/projects`
- `POST /api/agents/approvals/[approvalId]`

## UI

入口：
- `/agents`
- `/agents/market`

Workbench 包含：
- 研究目标输入
- 实时 execution timeline
- tool call log
- research report
- product opportunities
- evidence
- approve / reject
- create project

## Memory

Market Agent 会把结果沉淀到长期记忆：
- `market-research`
- `market-signal`

用于后续 Product / Supplier / Listing / PPC Agent 继续接力。

## Evaluation

代码内已生成 20 个 evaluation cases，覆盖：
- 正常查询
- 模糊需求
- 缺少参数
- keyword only
- ASIN only
- 类目分析
- 高竞争
- 低 review barrier
- 空数据
- 超时
- MCP failure
- 越权
- 低置信度
- 高风险产品
- 人审流程

