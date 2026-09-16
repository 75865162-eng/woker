# Listing Agent

## Mission

把 Product Agent 的计划、SellerSprite 关键词和竞品信号转成可审核的 Listing Draft。

## Chain

`Product -> SellerSprite Keywords -> Competitors -> Keyword Map -> Title -> Bullets -> Description -> A+ Brief -> Listing Draft -> Human Approval`

## Scope

Listing Agent 运行在统一 `AgentRuntime` 上，只通过 Tool Gateway 调用外部能力。

允许：
- 读取 Product Agent 输出
- 读取 SellerSprite 关键词信号
- 读取竞品信息
- 生成 keyword map
- 生成 title / bullets / description
- 生成 A+ brief
- 生成 listing draft

禁止：
- 绕过 Tool Gateway
- 直接修改外部系统
- 把未审批的 listing draft 当作已发布内容

## Runtime

Listing Agent 与 Market / Product / Supplier 共用同一 runtime / approval / trace / memory / event 模型。

## Input

支持：
- `naturalLanguageGoal`
- `marketplace`
- `category`
- `productReport`
- `marketReport`
- `productOpportunity`
- `sellerSpriteKeywords`
- `competitors`
- `currentSkuContext`

## Output

`ListingAnalysisReport` 包含：
- `keywordMap`
- `titleDraft`
- `bulletDrafts`
- `descriptionDraft`
- `aplusBrief`
- `listingDraft`
- `evidence`
- `summary`
- `recommendation`

## Tool Surface

当前工具：
- `listing.product.load`
- `listing.keyword.map`
- `listing.title.draft`
- `listing.bullet.draft`
- `listing.description.draft`
- `listing.aplus.brief`
- `listing.listing.draft`

## Permission Model

READ:
- Product Agent output
- SellerSprite keyword data
- competitor data

WRITE:
- keyword map
- title
- bullets
- description
- A+ brief
- listing draft

## Handoff

Product Agent 结果可通过本地 session handoff 进入 Listing Agent：
- 选中 Product Report
- 存入 `amazon.agent-platform.listing-handoff`
- 打开 `/agents/listing`

## Approval

Listing draft publication is high-risk and must follow:

`Recommendation -> Approval Request -> Human Decision -> Action`

## UI

入口：
- `/agents`
- `/agents/listing`

Workbench 包含：
- Product handoff
- Keyword map
- Title
- Bullets
- Description
- A+ Brief
- Listing draft
- Execution timeline
- Tool calls
- Evidence
- Approval panel
