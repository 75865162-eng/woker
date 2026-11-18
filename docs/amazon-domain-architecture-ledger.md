# Amazon 数据域架构账本：SP-API / Ads API 的域、落地页与自动计划

> 更新：2026-11-19。本文回答一个问题：**在还没有任何真实 Amazon 数据的情况下，架构是否已经搭好？**
> 结论：SP-API 33 个已实现域、Ads SP 15 个已实现能力，全部具备「代码能力 + 落地页路由 + 自动同步计划」三件套；架构自检 `npm run ops:domain-audit` 全绿。
> 但「架构存在」不等于「已接通真实账号」——真实数据到位后仍须按每域的验收前置逐项确认，代码不会伪造接通结论。

## 1. 单一事实来源

三件事此前散落在多处定义，现统一收敛到 `src/lib/amazon/domain-architecture.ts`：

| 维度 | 事实来源 |
| --- | --- |
| 可同步的域 / 代码能力 | `policy.ts` 的 `syncDomains`、`amazon-ads/capabilities.ts` 的 `listAdsCapabilities` |
| 对应落地页 | 域 → `operations-sections.tsx` view / `ads-workspace.tsx` 视图的显式映射 |
| 自动同步计划 | `automatic-adapters.ts` 的 `automaticAdapters`、`tickAmazonAds` / `tickAmazonAdsReports` 调度器 |
| 验收状态 | 每域 `acceptance` 字段，来自 `policy.nextStep` / `capabilities.limitations` |

读取方式：

```bash
# 人类可读的三栏对照表 + 自检结论（只读，无需数据库/凭证）
npm run ops:domain-audit

# 机器可读（供 CI / 监控消费；rows 为完整账本，audit 为自检结果）
npm run ops:domain-audit -- --json
```

API：`GET /api/integrations/catalog` 的 `architecture` 字段返回同一份账本与自检摘要（需 `settings:view` 权限，只读）。

## 2. SP-API：33 个已实现域

全部注册了自动同步计划（`worker:amazon-sync`），按采集模式分派到 domain-report / incremental / snapshot / report-window 策略。落地页分两类：

- **专用工作台（18 域）**：有业务字段视图，可直接看已发布数据。
- **同步矩阵（15 域）**：Reports 2021-06-30 报告族与只读发现域，在 `/operations?view=amazon-sync` 查看数据源、任务与本次快照，已发布行经 `domain-reports` / `observations` 读取器查询。

| 分组 | 域 | 落地页 | 计划间隔 |
| --- | --- | --- | --- |
| 商品与库存 | catalog / inventory / inventory_age / inventory_events / fulfillment / listing_details / catalog_items / pricing | 专用工作台 | 60–1440 分 |
| 商品与库存（报告族） | fba_inventory_by_country / fba_fulfilled_inventory / fba_inventory_report / reserved_inventory / stranded_inventory / recommended_removals / storage_fees / long_term_storage_fees / fba_overage_fees / fee_preview | 同步矩阵 | 60–1440 分 |
| 订单与经营 | orders / sales_traffic / fba_customer_sales / mfn_returns / fba_shipments | 工作台 + 矩阵 | 60–1440 分 |
| 订单商品 | order_items（复用 orders，非独立源） | 工作台（order-items） | 复用 orders |
| 财务与售后 | finance / returns / settlements / reimbursements | 专用工作台 | 1440 分 |
| 价格竞争 | buy_box_history | 专用工作台 | 1440 分 |
| 经营分析 | brand_analytics / promotions | 工作台 + 读取器 | 360–1440 分 |
| 账户同步 | notifications | 读取器（同步矩阵） | 1440 分 |

## 3. Ads API（SP 产品）：15 个已实现能力

| 类别 | 域 | 落地页 | 自动计划 |
| --- | --- | --- | --- |
| 账户 | profiles | `/amazon-ads/accounts` | 授权发现（按需，无定时） |
| 结构域（9） | campaigns / ad-groups / product-ads / keywords / targets / negative-keywords / negative-targets / campaign-negative-keywords / campaign-negative-targets | `/amazon-ads` 已同步数据 | `tickAmazonAds` 每日 |
| 报表域（5） | campaign-performance / advertised-product-performance / search-term-performance / placement-performance / targeting-performance | `/amazon-ads` 已同步日报 | `tickAmazonAdsReports` 每日 |

**规划中（P1，无落地页/无计划）**：portfolios、budget-bidding、creative-brand；以及全部 SB / SD 产品能力。这些在账本里诚实标为 `implemented: false` + `surface: none`，不冒充可用。

## 4. 架构自检项（`auditDomainArchitecture`）

| 检查 | 含义 |
| --- | --- |
| `sp.implemented_has_landing` | 每个已实现 SP 域都有真实落地路由 |
| `sp.implemented_has_schedule` | 每个已实现 SP 域都注册自动计划 |
| `sp.workbench_route_format` | workbench 路由格式有效（连字符/下划线不串用） |
| `sp.implemented_domain_type` | `ImplementedDomain` 类型覆盖全部已实现域 |
| `ads.implemented_has_landing` | 每个已实现 Ads 能力都有落地路由 |
| `ads.implemented_has_schedule` | 每个已实现 Ads 能力有计划或为授权流 |

自检只核对源码级不变量，**不读取数据库、不发网络请求、不把"待真实数据"误报为失败**。测试 `tests/amazon-domain-architecture.test.ts` 锁定上述不变量。

## 5. 真实数据到位后如何逐域验收

架构已就绪，但每项能力都必须用真实账号确认（`liveAcceptance` 恒为 `NOT_VERIFIED`，直到操作员完成）：

1. **凭据与授权**：按 `deploy/PRODUCTION-CHECKLIST.md` B 节配置 SP-API LWA / Ads LWA 凭据，完成 `npm run prod:onboard-amazon` 授权链；禁止伪造凭据或造数。
2. **绑定数据源**：在 `/operations?view=connections` 完成 Seller / Marketplace 参与核实与数据源绑定；Ads 在 `/amazon-ads/accounts` 授权并发现 Profile。
3. **逐域激活**：按账本 `acceptance` 字段核对每域前置（受限角色、Brand Registry、FBA 资格、Profile 报表权限、有界 ASIN/SKU 审批等），再启用对应计划。
4. **看落地页**：从账本 `landing.route` 进入页面，确认已发布数据非空、字段口径正确、质量标记（部分覆盖/隔离晚到）符合边界说明。
5. **复查门禁**：`npm run check:production -- --env /opt/amazon-ad-bulk-operation/.env --gate full`，确认 Amazon 凭据类 FAIL 项随真实接入收口。
6. **周期性运维**：`npm run ops:credential-audit -- --env ...`（Refresh Token / Client Secret 生命周期）与 `npm run ops:domain-audit`（架构漂移自检）。

## 6. 边界声明

- 落地页存在 ≠ 已有数据；为空时页面明确显示 `NEEDS_DATA`，不补造零值或百分比。
- 自动计划已注册 ≠ 已成功采集；采集仍凭真实授权、角色核验与审批执行。
- promotions / notifications 有读能力和计划，但运营页无专用工作台，经只读读取器与 MCP 查询；账本如实归到同步矩阵，不伪造路由。
- SB / SD 与 3 个 P1 Ads 域仅为规划，任何"能同步"的表述都不包含它们。
