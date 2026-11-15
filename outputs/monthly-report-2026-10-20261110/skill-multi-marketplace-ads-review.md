---
name: multi-marketplace-ads-review
description: "用比率而不是金额比较各站点广告，币种分开列。 Compare marketplaces with ratios, and keep currencies in separate columns. Use when running 粒粒lili / Codex workflows that mention this skill; call tools via MCP server lili."
metadata: {"lili":{"category":"report","brand":"粒粒"}}
---

# 多站点广告复盘 / Multi-marketplace ads review

## 这个技能做什么

用比率而不是金额比较各站点广告，币种分开列。

Compare marketplaces with ratios, and keep currencies in separate columns.

本手册是粒粒lili 离线/Codex 镜像。在线优先 `meta_load_skill`（slug=`multi-marketplace-ads-review`）拉服务端最新版；工具一律经 MCP server `lili` 调用。

## 什么时候用

处理「多站点广告复盘」或用户提到 Multi-marketplace ads review / `multi-marketplace-ads-review` 相关诉求时加载。也适用于 12 条粒粒工作流里点名本技能的步骤。

## 能力要点

- 统一口径：时间范围、币种、是否剔除异常订单
- 销售 / 流量 / 广告 / 库存 / 费用多模块对照上周或上月
- 三句话结论 + 按优先级的动作清单
- 输出 HTML 报告便于周会宣讲

## 本技能专项要点

- （按本技能摘要与步骤执行，遇缺口再查相邻技能）

## 步骤

按下面顺序执行；每一步结束先汇报再往下（写操作必须停在预览）。

1. 先统一口径：时间范围、币种、是否剔除异常订单。 建议先调 `meta_list_stores`。
2. 先给关键数字，再和上一周期对比。
3. 不同币种不要相加。
4. 收尾写下一周期的三件要事。

### 流程补充（分类手册）

- 先对齐「看哪个店、哪段时间」。
- 每个模块只留 Top 风险与 Top 机会，避免流水账。
- 动作写明负责人角色（广告/库存/定价）与本周盯的指标。

## 相关工具

- `meta_list_stores` — All stores connected to this account, with the store_scope id to pass to other tools: Amazon Ads profiles (for ads_* tools) and the Amazon store connection (for restock_* tools). Each Amazon store's label is its store name — use it when confirming with the seller which store they mean.
- `ads_list_entities` — Live Amazon Ads entities straight from the Ads API — the current bids, budgets, states and settings the daily report sync does not carry. Covers Sponsored Products, Sponsored Display AND Sponsored Brands: entity_type one of sp_campaigns, sp_ad_groups, sp_product_ads, sp_keywords, sp_targets, sp_negative_keywords, sp_campaign_negative_keywords, sp_negative_targets, sp_campaign_negative_targets, sd_
- `ads_get_data_health` — Data health for an ads profile: is the synced report data fresh, complete and trustworthy enough to act on.

## 输出格式

- HTML 报告
- 动作清单（负责人 + 指标）
- 需后台人工确认的开放问题

默认收尾：
1. 三句话结论（发生了什么 / 原因 / 这周先做什么）
2. 按优先级排序的动作清单（预估影响 + 负责人角色）
3. 需要运营去卖家后台确认的开放问题

## 护栏

- 查询可以直接看结果。改 Listing、广告或货件时先生成预览，放进审批。
- 市场调研和允许执行两个开关默认关闭。
- 多店场景先确认 NS 店 / TK 店，禁止串店改价或改广告。
- 付费市场数据调用前告知预计次数与费用风险。
- 不诱导评论、不违反品牌与广告政策。

## Steps (EN)

Compare marketplaces with ratios, and keep currencies in separate columns.

1. Lock the spec first: dates, currency, and whether odd orders are excluded.
2. Lead with the key numbers, then the comparison.
3. Do not add different currencies.
4. Close with three priorities for the next period.
## 与工作流的关系

本技能可被「周一经营例会 / 广告止血 / 销量下滑 / 新品上架到开广告 / 选品开品 / 竞品拆解 / 补货发货 / 利润体检 / 大促备战 / 老品清退 / 退货攻坚 / 月度报告」等模板引用。若当前对话来自某条工作流，保持该工作流的顺序与停顿点，不要跳步执行写操作。

## 扩展参考（同源手册：amazon-global-selling）

## Capabilities

- Compare candidate Amazon marketplaces using a consistent decision model.
- Build a directional landed-economics model with explicit assumptions.
- Map tax, customs, product, packaging, producer-responsibility, and account questions for qualified review.
- Compare cross-border fulfillment, local inventory, FBA, and 3PL operating models.
- Create a listing-localization and launch-validation brief.
- Recommend a pilot market and define go, hold, and stop gates.


## Workflow

### 1. Define the Decision and Evidence Boundary

State the target decision, evaluation date, candidate marketplaces, product scope, and evidence inspected.

Use three labels:

- **Confirmed:** supported by seller data or an inspected current source.
- **Directional:** derived from an explicit assumption or proxy.
- **Unresolved:** requires Seller Central, a current official source, a provider quote, or qualified advice.

Do not invent search volume, sales, fees, tax rates, duties, certification needs, account eligibility, or market share.

### 2. Screen for Hard Gates

Before scoring demand, check whether any candidate market has unresolved gates:

- product eligibility or restricted-product status;
- safety, labeling, language, testing, documentation, or responsible-person requirements;
- dangerous-goods, battery, chemical, cosmetic, food, medical, children's product, or radio-equipment implications;
- trademark, brand authorization, or listing-control risks;
- importer-of-record, customs, tax registration, invoicing, or producer-responsibility obligations;
- available fulfillment route and return handling;
- account, identity, banking, or payout readiness.

Do not convert an unresolved legal or compliance question into a negative conclusion. Mark the market **Hold for verification** when the answer can change feasibility.

### 3. Build the Market Comparison

Evaluate only dimensions supported by evidence:

| Dimension | Typical evidence | Decision use |
|---|---|---|
| Demand | seller search/query data, sales history, current category and competitor observations | estimate buyer interest |
| Competition | relevant listings, price bands, ratings/reviews, brand concentration, offer quality | assess entry difficulty |
| Economics | price, currency, referral/FBA fees, freight, duty, tax treatment, returns, ads | estimate contribution margin |
| Operational fit | lead time, inventory placement, returns, customer service, replenishment | assess execution burden |
| Compliance readiness | documented requirements and seller-held evidence | determine go or hold |
| Localization effort | keyword, language, images, measurements, cultural fit, support | estimate launch work |
| Strategic fit | brand objective, catalog reuse, expansion sequence, capital | prioritize the pilot |

If numerical scoring is useful, define weights before scoring, show the formula, and leave unsupported dimensions unscored rather than fabricating precision.

### 4. Model Directional Unit Economics

Use a transparent per-unit model:

```text
Net proceeds before tax treatment
= customer price and seller-paid shipping
- marketplace referral and closing fees
- fulfillment or local delivery fees
- inbound freight and handling
- duty, customs, and brokerage estimates
- storage

