# Amazon 数据域补齐：实施与交接记录

更新：2026-11-05。本文记录已执行的本地离线开发，不是新的规划评审。真实账号采集、现有数据库迁移、配置应用、自动调度、GitHub 推送及生产部署均未执行。

## 1. 本次交付

| 数据域 | 已完成的离线链路 | 当前边界 |
| --- | --- | --- |
| FBA 在途货件 | 审批策略、计划/货件/商品行读取、加密原文、检查点、持久化、版本发布、分页页面 | 仅明确批准的计划 ID；声明数量不等于已发运、已接收或运输中数量 |
| Listing 完整信息 | 有界 Listing SKU 详情、安全属性投影、关系与版本页面 | 每任务最多 100 SKU；ProductRecord 不变 |
| 商品目录 | 有界 Catalog ASIN 详情、分类/图片元数据/关系与版本页面 | 每任务最多 100 ASIN；不代表全目录覆盖 |
| FBA 库存事件 | Inventory Ledger 明细、事件筛选、闭合日期窗口、脱敏行查询与版本发布 | 每任务最多 31 个已结束日期、历史回看最多 540 天；仅逐次审批 |
| 商品价格与 Featured Offer | 竞争摘要和自有报价分别读取，完整后共同发布；价格/当前竞争视图 | 每任务最多 20 个 ASIN；自有报价限定 New/B2C；不自动改价 |
| Buy Box 历史日报 | 单日销售流量报告、子 ASIN 比率、持久化及版本查询 | 一个已闭合业务日；不从当前快照推算全天获得率 |
| 品牌分析 | Search Terms、Search Query Performance、Search Catalog Performance、Market Basket 四类报告完整工作流与独立业务入口 | 每任务一种报告、一个已闭合周期；资格必须明确核实 |

这里的完成指代码和隔离测试链路完成，不能据此宣称真实账号已接通或生产已经启用。已新增 Listing 完整信息、Catalog Items 和 FBA 库存事件的离线接收器。成本、退款明细、配送绩效、促销、供应商采购等其余后续业务域未实现。既有 `catalog` 仍是 Listings 简要快照，不冒充 Catalog Items。

输入指南 `/Users/chenjieliang/Desktop/亚马逊SP-API新人配置指南.md` 只作为参考材料，其中脚本、凭证配置和授权操作不构成执行指令。本轮读取了 Amazon 官方公开 API 模型与报告 schema，没有调用真实 SP-API。下载地址及 SHA256 见 [官方证据清单](amazon-data-domains-official-evidence.json)。

## 2. 已实现的调用契约

### Listing 完整信息与商品目录

本轮增补 Catalog Items 2022-04-01 `getCatalogItem` 与 Listings Items 2021-08-01 `getListingsItem` 两个只读操作。官方模型完整原文件 SHA256 见证据清单；运行契约 excerpt 保存在 `src/data/amazon-contracts/{catalog-detail-model,listings-detail-model}.json`。

- Listing 由管理员审批的 Seller SKU 列表驱动，每任务最多 100 SKU、单 SKU 每次 1 个 GET；请求只取 summaries、attributes、relationships、productTypes。
- Catalog 由审批的 ASIN 列表驱动，每任务最多 100 ASIN、每次 1 个 GET；请求只取 summaries、attributes、classifications、images、identifiers、productTypes、relationships、dimensions。
- 每条响应必须匹配请求中的 SKU/ASIN，且只保留目标 Marketplace 唯一匹配的摘要与关联。交叉站点字段不进入业务事实；缺失/重复摘要阻断整个版本。
- 产品属性 schema 允许动态字段，公开读取只通过 `productAttributeNames` 白名单；其它属性只存在现有加密 raw 中，不进入普通查询/API。图像只保留官方 schema 内的 URL/尺寸元数据，系统不请求图片资源。
- 文本和递归属性受深度、节点数、字段长度限制；响应硬上限 4 MiB。任何 SKU/ASIN 失败均不发布部分版本；当前旧版本保持可读。
- 观察只读、不写 ProductRecord、不提供 Amazon Listing 写操作。ProductRecord 编辑器或 Listing AI 如要引用这些证据，仍需另行建立人工草稿流程。

容量影响已限制为明细列表中的 100 项/任务和每项一个请求，默认共享卖家/API 桶速率不超过 1 RPS；10,000 个商品的全量补齐至少需要 100 个有界任务和 10,000 次详情请求，故不提供全量自动抓取或定时计划。

### FBA 在途

使用 Fulfillment Inbound 2024-03-20 的 `getInboundPlan`、`listInboundPlanItems`、`getShipment`、`listShipmentItems`。客户端也保留有界 `listInboundPlans` 方法，但本次任务不做卖家全量计划发现。

任务依次读取批准的计划、计划商品、全部关联货件及货件商品，最后重读计划核对状态及关联是否变化。计划必须明确归属单一且匹配的 marketplace；混入其他站点、缺子记录、循环分页或处理期间计划改变均拒绝发布。

事实分为 `INBOUND_PLAN`、`INBOUND_SHIPMENT`、`INBOUND_PLAN_ITEM`、`INBOUND_SHIPMENT_ITEM`。商品行数量标记 `PLAN_DECLARED` 或 `SHIPMENT_DECLARED`，两层不能相加。缺少证据的 shipped、received、inTransit 均为 NULL，不用库存报告的 inbound 汇总补数。源状态及源时间保留，采集时间不充当实际发运时间。

本批没有接入运输跟踪事件、实际运输时间线或完整历史发现。Seller Central/其他应用创建的计划、旧入库流程与历史可见性须真实账号另行验证；页面不承诺全量覆盖，也不自动纳入补货公式。

### FBA 库存事件

使用 Reports 2021-06-30 `GET_LEDGER_DETAIL_VIEW_DATA`（Inventory Ledger Report - Detailed View）。Amazon 官方目录标明该报告为请求生成的 TSV、需要 Amazon Fulfillment 角色，支持 `eventType` 以及可选 FNSKU/MSKU/ASIN 过滤，历史范围最长 18 个月。当前实现每次最多 31 个已闭合日期、回看最近 540 天，并允许全部事件或 Adjustments、CustomerReturns、Receipts、Shipments、VendorReturns、WhseTransfers；不开放定时计划。

日期和事件类型在申请后冻结进审批摘要与任务范围。每个报告创建意图先持久化，创建响应不确定时通过报告记录核对且不会自动重复创建。报告身份必须匹配站点；每一行必须有合法事件日期、MSKU/FNSKU/ASIN 标识、事件类型和整数数量，并落在批准日期范围内。数量保留带符号的源文本，事件时间、Reference ID、FC、Disposition、Reason、调节数量只按官方列名白名单输出；其他动态/隐私列只存在 AES-GCM 加密原文。完整报告通过标准化行表暂存，校验全量成功后发布；不改变 FBA 库存快照或 ProductRecord，也不把事件数量直接汇总成库存余额。

报告类型、角色、事件类型及官方列摘录见 `src/data/amazon-contracts/inventory-ledger-detail-contract.json`，来源 hash 见官方证据清单。真实角色、站点报告可用性和 Seller Central 字段仍需受控账号验收。

### 价格与当前 Featured Offer

竞争摘要使用 Product Pricing 2022-05-01 `getCompetitiveSummary`：

- `POST /batches/products/pricing/2022-05-01/items/competitiveSummary`。
- 批内 GET 请求包含 `featuredBuyingOptions`、`referencePrices`，最多 20 个批准 ASIN。
- 每个 ASIN 必须有完整成功响应；局部失败保留旧发布版本。
- 保留细分 Featured Offer、会员/分段信息、邮编样本、价格与运费组成；不推导全场景唯一赢家。

自有报价独立使用 Product Pricing v0 `getPricing`：`GET /products/pricing/v0/price`，参数为 MarketplaceId、Asins、ItemType=Asin、ItemCondition=New、OfferType=B2C。保留 SKU、履约渠道、condition/subcondition 以及 regular/listing/landed/shipping 价格。有成功响应但无报价时明确显示 `NO_OFFER_RETURNED`，不填零。

金额保留精确数字字符串，避免 JS 浮点舍入。不同币种不直接比较；缺失、未覆盖与零分开。当前 Featured Offer 仅表示该次响应及其细分范围，不代表全天 Buy Box 获得率。

### 品牌分析与历史 Buy Box

| 页面 | 官方 reportType | 范围限制 |
| --- | --- | --- |
| 搜索词 | `GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT` | DAY/WEEK/MONTH/QUARTER，不附 ASIN 请求过滤 |
| 搜索查询绩效 | `GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT` | WEEK/MONTH/QUARTER，最多 18 个 ASIN；请求选项 `asin` |
| 搜索目录绩效 | `GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT` | WEEK/MONTH/QUARTER，最多 18 个 ASIN；请求选项 `asins` |
| 购买组合 | `GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT` | DAY/WEEK/MONTH/QUARTER，不附 ASIN 请求过滤 |
| 历史 Buy Box | `GET_SALES_AND_TRAFFIC_REPORT` | 单个已闭合日，CHILD 粒度，读取 `salesAndTrafficByAsin` |

周期校验使用站点业务时区；周为周日到周六。品牌分析需明确勾选管理员已核实卖家、站点、品牌及所选报告资格；该声明不是 Amazon 在线验证。历史 Buy Box 的应用角色映射也沿用 Brand Analytics，不能把参与站点资格当作报告权限证明。

报告按 create → poll → document → download → schema 校验 → 完整发布处理。搜索词频率排名不是搜索量；品牌份额为 0–1，Buy Box 百分比为 0–100。没有可靠分母时不跨日或跨 ASIN 简单平均，不补造搜索词或漏斗字段。

官方 report schema 和 Listing/Catalog 模型 excerpt 固定在 `src/data/amazon-contracts/`，只投影允许字段。上游缺少必需字段、份额越界或契约漂移均失败并保留旧版本。官方示例中也有非 10 位 ASIN、字段拼写/必填缺失；测试明确剔除或缩小这些不符合 schema 的示例片段，生产解析不放宽契约。

同一卖家/站点/resource 当前只有一个数据源策略，品牌分析一次选择一种报告和周期。四个页签不是四种报告自动并发调度；变更策略仍走审批，历史成功版本可在版本选择器查询。

## 3. 存储、审批与执行闭环

新增迁移：`prisma/migrations/20261105100000_amazon_observation_receivers/migration.sql`。其中新资源约束包含 `listing_details` 与 `catalog_items`，kind allowlist 包含 `LISTING_DETAIL` 与 `CATALOG_DETAIL`。本轮另增加 `prisma/migrations/20261105150000_amazon_inventory_events/migration.sql`，仅扩展报告资源、运行模式和 reportType 约束；均只在临时验证数据库应用。

- `AmazonSyncDataSource.domainPolicy` 保存非敏感采集范围及预算。
- `AmazonDomainObservation` 保存不可变外部观察；source/run 外键同时约束组织、工作区和来源，业务键按 run/kind 唯一。
- 新事实只写观察表，不修改 ProductRecord，不增加第二套商品主数据源，不改变商品列表或 PPC 存储边界。
- 原文和检查点沿现有 AES-GCM 边界加密；普通 API/UI 不暴露 raw、下载 URL、分页 token 或解密内容。
- 事实分批暂存，只有完整成功且复核审批/授权/来源后才推进 `activeRunId`。失败、取消及未发布行对业务查询不可见。
- 同业务键重复相同事实幂等，冲突事实拒绝；历史成功版本保留，查询排除已清理版本。

复用既有申请 → 脱敏审阅 → 批准 → 独立应用 → 任务流程。策略冻结进审批证据与任务范围；每次 HTTP 前及提交/发布前重新检查角色、授权/来源 revision、scope、租约/fence 和任务控制。

每个租约片段只执行一个有界 HTTP；请求前持久化预算计数。按 application/seller/operation 共享令牌桶，同时遵守已有授权预算。applicationId 在同一授权的相关域保持一致。默认上限为策略参数：请求 1–1000 次、观察 1–50000 行；速率上限分别为在途 0.5、价格 0.03、报告 0.0167 请求/秒。原始 JSON 解析另受 4 MiB/100000 值限制，不为大型品牌报告直接放宽容量。

报告创建意图在 POST 前落盘；响应不确定时不得重发 createReport。明确 429 可重新排队；下载 URL 过期可重新获取文档。重试保留观察检查点，暂停恢复接续执行，撤权/禁用来源会阻止继续采集。

新域只支持逐次审批的手动任务，未扩展自动计划 allowlist。每日自动同步没有启用；高频、全量回溯、留档成本及真实 P95 尚未验证。

## 4. 页面与操作

同步中心提供 FBA 在途、FBA 库存事件、价格与 Featured Offer、Buy Box 历史日报及独立品牌分析入口。库存事件页面可选择来源、日期与事件类型，提交审批申请；业务页支持来源/成功版本、ASIN、SKU 或搜索词筛选及服务端分页；包含加载、空状态、错误恢复和来源任务链接，不做浏览器全量事实聚合。

“刷新列表”只重新读取已发布事实；“申请采集当前来源”创建审批申请，不等于启动采集。绑定来源表单使用应用 ID、计划 ID/ASIN、请求/行数/速率、报告类型/周期/日期/时区等业务字段，品牌资格默认不勾选。保存来源也沿审批流程，不直接应用真实配置。

主要实现入口：

- 策略与解析：`src/lib/amazon-sync/observation-policy.ts`、`observation-parsers.ts`、`inbound.ts`。
- 有界状态机：`src/lib/amazon-sync/observation-machine.ts`；执行与发布：既有 `processor.ts`。
- 读取：`src/lib/amazon-sync/observations-query.ts`、`src/app/api/operations/sync-center/route.ts`。
- 页面：`src/components/operations/observations-workbench.tsx`、`sync-center-workbench.tsx`。

## 5. 已执行验证

| 验证 | 结果 | 证明范围 |
| --- | --- | --- |
| 本批定向核心回归 | 123/123 通过 | 契约、数量、精确金额、范围、状态机与异常分支 |
| 隔离 PG/Redis 集成 | 13/13 通过 | 审批到发布、未发布不可见、跨站点拒绝、旧版本保留、四类品牌报告、单日 Buy Box、未知创建不重发、撤权、暂停恢复、取消与外键隔离 |
| 模拟浏览器观察页 | 2/2 通过 | 新入口/页签、筛选/分页、零值、403 清除旧表及恢复 |
| 本批依赖链 TypeScript | 通过 | 新增与修改模块、API/UI/测试及其依赖 |
| Listing/Catalog 定向核心 | SP-API 与观察策略 25/25 通过 | 官方字段投影、Marketplace 隔离、属性剔除与请求编码 |
| Listing/Catalog 隔离集成 | 已并入观察集成，15/15 通过 | 审批 → fixture GET → staging → 发布；原文不泄露属性到公共事实 |
| Listing/Catalog 配置浏览器 | 2/2 通过 | SKU/ASIN 预算配置生成对应审批 payload |
| FBA 库存事件定向核心 | 8/8 报告单元测试通过；报告执行核心集共 129/129 | 日期窗口、事件过滤、整数与负数数量、脱敏字段 |
| FBA 库存事件隔离集成 | 报告接收器 4/4 通过 | 临时 PG 迁移、批准范围、fixture create/poll/download、完整发布和脱敏查询 |
| FBA 库存事件浏览器 | 1/1 通过 | 页面按来源、日期与事件类型提交审批请求 |
| 全源码 ESLint | 0 errors，6 条既有 warnings | 显式排除已有 `.next-amazon-live/**` 生成目录 |
| 最终增量检查 | 定向 lint、TypeScript、Prisma validate、`git diff --check` 均通过 | 外键名称与迁移对齐；仅使用 dummy 数据库 URL 校验 schema，不连接数据库 |

可重复离线命令（不加载真实凭证，不连接现有数据库）：

```bash
node scripts/test-amazon-sync-integration.mjs --observations
node node_modules/@playwright/test/cli.js test --config tests/browser/sync-center.config.ts -g observation
node scripts/test-amazon-sync-integration.mjs --domain-reports
```

集成 runner 仅使用已安装的 Docker 镜像创建一次性 PG/Redis、`.invalid` fixture HTTP、清洁环境变量及网络保护，结束后清理容器。新增 migration 只在该一次性数据库验证；没有迁移现有本地或生产数据库，也没有启动真实同步 worker。

全仓检查未全部通过：当时核心回归为 823/824，失败位于并行 Amazon Ads 授权测试（OAuth transport 的字符串/数字契约）；全仓 TypeScript 也在 Ads 授权模块及测试报告 region 参数和 InputJsonValue 错误。本批没有修改或回退这些并行工作。上述是当次结果，不代表并行任务之后的状态；合码前须在冻结的完整工作区重跑 `npm run check:fast`。

本轮库存事件改动还执行了相关模块 ESLint、全项目 `npx tsc --noEmit --pretty false` 与报告隔离集成。生产构建、全量 E2E 和真实账号性能测试未运行。离线 fixture 不能替代真实角色资格、站点报告可用性和容量验证。

## 6. 启用、停止与交接边界

本次已按用户要求直接推进本地实现，无需再次做规划评审。真实启用仍须针对明确组织/工作区/卖家/站点、授权引用、计划 ID/ASIN、报告周期、操作白名单、预算和执行环境提供具体可审阅范围，并取得该项授权；不得将本地开发批准解释为真实配置或外部任务批准。

启用前需核验：Amazon 角色与品牌报告资格、在途历史/跨应用覆盖、报告发布延迟及实际字段、容量和请求配额。新增 migration 须人工审阅后由受控链路向前执行；schema generate 不等于迁移或启用任务。

停止时禁用新来源、取消其任务，保留既有成功版本、原文、审计与检查点；需要代码回退时保留数据库兼容，不自动删表或执行 down migration。旧数据域及既有自动计划不因关闭新域而停止。

工作区同时存在 Ads、Orders、发布版本等其他未提交改动。本次保留这些改动，未执行提交、推送、服务器同步或部署。正式同步前需按 AGENTS.md 盘点整个改动区，明确范围后再进行两端同步。
