---
name: profit-fee-analysis
description: "按实际费用算近 30 天每个 SKU 的利润，标出亏钱的款。 Compute 30-day profit by SKU from actual fees and flag losses. Use when running 粒粒lili / Codex workflows that mention this skill; call tools via MCP server lili."
metadata: {"lili":{"category":"profit","brand":"粒粒"}}
---

# 费用与利润拆解 / Fee and profit breakdown

## 这个技能做什么

按实际费用算近 30 天每个 SKU 的利润，标出亏钱的款。

Compute 30-day profit by SKU from actual fees and flag losses.

本手册是粒粒lili 离线/Codex 镜像。在线优先 `meta_load_skill`（slug=`profit-fee-analysis`）拉服务端最新版；工具一律经 MCP server `lili` 调用。

## 什么时候用

处理「费用与利润拆解」或用户提到 Fee and profit breakdown / `profit-fee-analysis` 相关诉求时加载。也适用于 12 条粒粒工作流里点名本技能的步骤。

## 能力要点

- 拆售价、采购、头程、佣金、FBA、广告、退货、仓储
- 按 SKU / ASIN 算毛利、贡献利润、破局 ACOS
- 标出亏损或边缘利润款及原因
- 给出调价 / 降本 / 停投 / 清货建议

## 本技能专项要点

- （按本技能摘要与步骤执行，遇缺口再查相邻技能）

## 步骤

按下面顺序执行；每一步结束先汇报再往下（写操作必须停在预览）。

1. 用售价、采购、头程、佣金、FBA 和广告费拆每个 SKU。 建议先调 `finance_get_fee_estimate`。
2. 标出亏损和费用占比异常的款，并写明不含哪些成本。
3. 能索赔或该清仓的，单独折成每月金额。
4. 动作按金额从大到小排。

### 流程补充（分类手册）

- 成本假设写进报告，避免和财务口径打架。
- 广告费按归因窗口说明，不和订单日期硬拧。
- 关税与头程波动单独标注灵敏度。

## 相关工具

- `finance_get_fee_estimate` — 费用试算（实时，Product Fees 直通）: 「这个 ASIN/SKU 按 X 价卖，亚马逊收多少费、到手多少」。传 asin 或 sku 二选一 + price；fulfillment 默认 fba。返回费用总额、明细（referral/FBA 及内嵌子费）与 net_after_fees。注意这是**事前估算**，不含仓储费/广告/退货/采购成本——事后实收查 economics_daily 的 net_proceeds_total。定价与选品决策用。
- `finance_get_balances` — 账户余额（实时，Finances v2024-06-19 直通，不经本地数据）: 各站点/账户类型的 AVAILABLE（可放款）与 RESERVED（预留/押款）余额；传 as_of_date (YYYY-MM-DD) 可查历史时点。回答「账上现在有多少钱 / 这期能放多少款 / 被预留多少」。押款明细（哪些交易、为什么、几时放）用 data_query 查 finance_transactions WHERE transaction_status='DEFERRED'。
- `data_query` — Answer any question about the seller's REAL Amazon store data — 销量、订单、广告花费、ACOS、库存、退货率、利润 — with one read-only DuckDB SQL query: the primary tool for analysis, aggregation, trends, rankings, and joins across orders/ads/inventory/returns (e.g. return rate by SKU = returns joined to orders), plus slicing the restock engine's outputs. Free and instant — prefer this over paid diagnostics for any stati

## 输出格式

- SKU 利润表
- 破局 ACOS / 目标 ACOS
- 调价或结构建议

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

Compute 30-day profit by SKU from actual fees and flag losses.

1. Split each SKU into price, cost, freight, referral, FBA, and ads.
2. Flag losses and odd fee ratios, and say which costs are excluded.
3. Turn claims and clearance into a monthly amount.
4. Sort actions by money.
## 与工作流的关系

本技能可被「周一经营例会 / 广告止血 / 销量下滑 / 新品上架到开广告 / 选品开品 / 竞品拆解 / 补货发货 / 利润体检 / 大促备战 / 老品清退 / 退货攻坚 / 月度报告」等模板引用。若当前对话来自某条工作流，保持该工作流的顺序与停顿点，不要跳步执行写操作。

