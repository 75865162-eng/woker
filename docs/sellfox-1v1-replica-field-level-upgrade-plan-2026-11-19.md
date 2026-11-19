# 赛狐落地页 1:1 复刻 · 字段级升级规划（代码核实版）

> 日期：2026-11-19 · 基线 commit：`ae2b895` · 目标：我方 `/sellfox/*` 与赛狐后台在**功能、跳转逻辑、字段聚合、筛选逻辑**四维达到 1:1。
> 本文整合三份来源：① 用户上传的《16 页字段级升级计划 + 5 项改造指导 + 全页通用族》；② 我方代码全量盘点（`Explore` 只读）；③ 主代理逐条代码核实。凡"文档自述"均标来源，凡"已核实"均给代码证据。

---

## 0. 数据来源与可信度分级（先分清，避免把"文档基线"当"实测"）

| 级别 | 含义 | 覆盖 | 本项目用法 |
|---|---|---|---|
| **A · 赛狐登录态实采** | 用户文档实采，表头/筛选项为真实值 | 销量统计、销售利润、商品列表、在线产品、全部订单（5 页） | 可直接据此改字段/筛选/列，无需再抓 |
| **B · 赛狐文档基线** | 帮助中心公开文档，非登录态 | 广告、采购、仓库、财务、经营概览等（账号无入口） | 落地前需账号权限补齐后复核，可能新增 5–10 字段差异 |
| **C · 我方代码核实** | 主代理逐条 grep/读源码确认 | 全部 16 页的状态、禁用控件、model、API | 本规划的事实基线 |

**代码核实结论**（文档引用行号有偏移，因基于稍早 commit；但文件/函数/规格全部真实存在）：

| 核实项 | 文档自述 | 当前代码实况 | 判定 |
|---|---|---|---|
| Listing model | `schema.prisma:2874/2915` | `schema.prisma:3026` | ✅ 存在，行号偏移 |
| SalesDaily / ProductDaily | `1663 / 1466` | `1813 / 1358` | ✅ 存在，行号偏移 |
| `listingNarrow` / `narrow-contracts.ts` | 存在 | `narrow-contracts.ts:25` | ✅ 属实 |
| 6 处禁用控件 | 实时统计/业务员/父体/导入导出/历史订单/生成建议 | `replica-pages.ts:47,108,133,188,226,246,281` 等逐条命中 | ✅ 属实 |
| 比率列口径 `ratio()` | 已走 grossProfitRate/acos/roas | `workbench-types.ts:80,97` | ✅ 属实 |
| `finance/receivable` 状态冲突 | data-plan 标 live / 页面标 planned | `data-plan.ts:159` live；`host-page-finance.ts` planned | ✅ 冲突属实，需统一 |
| planned 目标表未建 model | SkuMaster/PurchaseOrder/Settlement 等 | `grep model` 命中 0 | ✅ 属实，全部空壳 |
| 订单字段 | 零字段缺口 | `SellfoxOrderSnapshot` 含 sellerOrderId/payAt/refundAt/revenue/promo/itemAmount/qty/refundQty | ✅ 属实 |

---

## 1. 我方 16 个落地页盘点基线（补齐文档缺失的"我方侧全量对照"）

**A. 复刻页（6，配置驱动 `replica-pages.ts`）**

| 路由 | 页 | 现列/控件 | 数据模型 | 现状 |
|---|---|---|---|---|
| `/sellfox/sales` | 销量统计 | 22 列 / 13 控件 | `SellfoxSalesDailySnapshot` | live，4 开关禁用 |
| `/sellfox/performance` | 销售利润 | 17 列 / 9 控件 | `SellfoxProductDailySnapshot` | live，业务员+费用/指标禁用 |
| `/sellfox/listings` | 在线产品 | 17 列 / 13 控件 | `SellfoxListingSnapshot` | live，列少 23、9 控件禁用 |
| `/sellfox/orders` | 全部订单 | 16 列 / 14 控件 | `SellfoxOrderSnapshot` | live，字段齐、7 控件禁用 |
| `/sellfox/shipments` | 货件 | 12 列 / 7 控件 | `SellfoxFbaShipmentSnapshot` | live，同步禁用 |
| `/sellfox/restock` | 补货建议 | 18 列 / 16 控件 | `SellfoxFbaInventorySnapshot` | live，生成建议/同步禁用 |

**B. 承接页（7，`host-page-*.ts`）**

| 路由 | live 数据集 | planned 数据集 | 判定 |
|---|---|---|---|
| `/sellfox/profit` | product_daily（1） | profit_daily/monthly/settle（3） | 部分 |
| `/sellfox/ads` | 6 日报 + hourly（7） | ads_entity、aba（2） | 主力 |
| `/sellfox/inventory` | fba（1） | local/flow/age/bin（4） | 部分 |
| `/sellfox/products` | 0 | sku/spu/category/reviews（4） | **空壳** |
| `/sellfox/purchase` | 0 | po/receipt/plan/supplier/return（5） | **空壳** |
| `/sellfox/finance` | 0 | settlement/receivable/invoice/payment（4） | **空壳** |
| `/sellfox/stock-ops` | 0 | io/adjust/transfer/check/assemble/split（6） | **空壳** |

**C. 工具页（3）**：`/sellfox`（Hub，70 域进度 + 域内跳转）、`/sellfox/sync`（同步控制台）、`/sellfox/endpoint-data`（原始 payload 行，内部工具，不参与 1:1）。
另有 `/saihu-search-merge`（赛狐搜索词合并，独立工具页）。

**导航现状**：左侧一级菜单按 ERP 域打散（`business-navigation.ts:34-120`），页面内 `SellfoxTabs` 按赛狐模块排序（`sellfox-nav.tsx:15-24`）。两套顺序不一致；`/sellfox/listings`、`/sellfox/restock`、`/sellfox/endpoint-data` 无左侧入口。**1:1 建议以 `sellfoxNavOrder` 为准统一。**

---

## 2. 四维达标矩阵（功能 / 跳转逻辑 / 字段聚合 / 筛选逻辑）

> 用户明确要求"最少 1:1 复刻赛狐的功能、跳转逻辑、字段聚合、筛选逻辑"。此表是验收总纲，逐页细化见第 3 节与上传文档。

### 2.1 功能维度

| 功能族 | 缺失页 | 状态 | 依赖 |
|---|---|---|---|
| 4 开关（实时统计/隐藏0/测评/去换货） | sales | 禁用 | 去换货需 `exchangeQty` 新字段，不可用退款量近似 |
| 业务员维度 + 自定义费用/指标 + 按维度汇总 | performance | 禁用 | 分摊口径待拍板（见 §5） |
| 父体视图 / 配对 / 自动配对 / 分配业务员 / 同步 / 调价 / 打印 / 标签 / 导入导出 | listings | 禁用 | 父体聚合口径、写权限 |
| 订单 7 控件（历史/录费用/标记测评/上传发票/同步/导入成本/不限制时间） | orders | 禁用 | 费用表/发票表设计；"不限制时间"不单独开 |
| 生成建议 / 同步 | restock | 禁用 | 建议落库 + worker |
| 同步按钮 | shipments | 禁用 | worker 手动触发 |
| 8 个写动作 | 空壳 4 页 | 无 | 数据接入先于功能 |

### 2.2 跳转逻辑维度

| 跳转 | 赛狐 | 我方现状 | 1:1 要求 |
|---|---|---|---|
| ASIN → 亚马逊前台 | 有 | 无 | 补外链（按站点域名映射） |
| 点行 → 结构化详情抽屉 | 分区详情 + 关联单据 | `record-detail.tsx` 仅平铺 payload | 改分区抽屉 + 关联单据 |
| 指标列下钻 | 可下钻 | 无 | ASIN 一跳四（在线产品/利润/广告/库存） |
| 跨页深链 | 有 | 仅运营页→赛狐、补货面板→restock | 补齐四向深链 + 列级下钻 |
| 菜单顺序 | 赛狐模块序 | 两套并存 | 统一为 `sellfoxNavOrder` |

### 2.3 字段聚合维度

| 聚合 | 现状 | 规则（红线） |
|---|---|---|
| 多币种汇总行 | 已有，按币种分组 | 保留；补占比/同比；不跨币种合并 |
| 比率列 | `ratio()` 已处理毛利率/ACoS/ROAS | 分母 0 或缺失 → null，不返回 0 |
| 派生列（日均/毛利/费用/可售天数） | 缺 | `CASE WHEN 任一因子 IS NULL THEN NULL`，**禁用 COALESCE(...,0)**（会把缺成本算成 0 成本，造假毛利） |
| 父体汇总 | 无口径 | 先定父子关系来源，再开；不造父体行 |
| 业务员分摊 | 未定 | 同一 ASIN 挂 2 人按人分组会双算，见 §5 |
| 星期分布列 | 无 | `EXTRACT(DOW)` 7 列；仅 grain=day 且 ≤62 天时出现，防列爆炸 |

### 2.4 筛选逻辑维度

| 筛选能力 | 现状 | 1:1 要求 |
|---|---|---|
| 固定下拉一排 | `browse-filters.tsx` 硬编码，加筛选要改组件 | 改条件模型驱动：每个 domain 声明 `FilterField[]`，新增筛选不改组件 |
| 多条件行 + chips | 无 | 条件行可增删 + chips + 精确/模糊切换 |
| 批量粘贴 | 无 | 按 `,;\n空格` 切分、去空去重、上限 500，超限提示不静默丢 |
| 筛选模板保存 | 无 | 保存/命名/复用/删除，跨会话 |
| URL 可分享 | 部分 | 还原全部筛选与列；解码失败回落默认不 500 |
| 白名单安全 | 部分 | 前端不得传列名，服务端 `field→{column,type}` 白名单，非法 field → 400 |
| 时间粒度 | 仅按日 | 日/周/月（`grain`），周用 `IYYY-IW` 防跨年串周 |

---

## 3. 逐页字段级差距（精简版，完整字段表见上传文档 §二/三/四）

| 页 | 字段缺口 | 筛选缺口 | 功能/跳转缺口 | 优先级 |
|---|---|---|---|---|
| 在线产品 | 价格族 5 字段、大小类目排名分离、开售时间、D-1 三字段、日均列 | 配对状态/划线价类型/BuyBox资格/首单/开售/双标签/品牌/数值区间（9 项） | 9 动作解锁；父体视图 | P0 |
| 销量统计 | 星期分布列；库存列默认隐藏 | 业务员/业绩归属人/批量粘贴/精确模糊 | 4 开关；grain 粒度 | P0 |
| 销售利润 | 列已反超（186），仅口径校验 | 标签三视图（MSKU/ASIN/父ASIN） | 业务员维度+自定义费用/指标+汇总 | P0 |
| 全部订单 | 零字段缺口 | 多条件行 | 7 控件（主要工作量） | P0 |
| 商品资料 | 整页（SKU/SPU/分类/评价/品牌属性） | 全缺 | 配对状态/组合明细/采购交期/默认头程/型号/单位 | P0 |
| 采购 | 整页（采购单/入库/供应商/计划/退货） | 全缺 | 4 Tab 详情（商品/变更/到货/跟踪） | P0 |
| 财务结算 | 整页（结算/应收/发票/资金单据） | 全缺 | 结算汇总口径 | P0 |
| 出入库 | 整页（6 类单据） | 全缺 | — | P2 |
| 库存 | AWD 可售/在途（2） | — | 本地仓/流水/库龄/货架位 4 表接入 | P1 |
| 广告报表 | 有效/服务状态/广告策略（依赖 AdsEntity） | 活动/广告组/运营状态/服务状态/广告策略（5 项） | 广告组合/否定词/AMC | P1 |
| 货件 | 装箱信息/报关资料入口 | — | 同步按钮 | P1 |
| 补货建议 | 冗余分析视图 | — | 生成建议落库 + 同步 | P1 |
| 数据总览 Hub | 6 KPI + 趋势 + TOP10 排行 | — | 从卡片跳转升级为经营概览 | P1 |
| 同步控制台 | 字段级失败原因 | — | 单店铺重试、失败率看板 | P2 |

---

## 4. 三类问题分类（避免做无用功）

| 类型 | 判定 | 页面 | 处理 |
|---|---|---|---|
| **真缺字段** | 表/ payload 都取不到 | 价格族、AWD、广告状态、开售时间 | 加列 + 核验取值，取不到→null→`—` |
| **有字段无派生** | 原始列有，缺公式列 | 日均/毛利/费用/可售天数/ACoS | 读时计算，CASE 口径 |
| **有字段无功能** | 字段齐，按钮禁用 | 订单 7 控件、导入导出、同步 | 功能实现 + 审计 |

**已核实事实**：订单页零字段缺口；FBA 库存有 9 分项但无 AWD；广告日报无状态字段；Listing 有单值 `bsrRank`/`openDate`/`firstSaleDate`，无价格族；SalesDaily 无业务员字段。

---

## 5. 需用户拍板的关键决策点（阻塞项，不拍不做）

1. **业务员分摊口径**（阻塞 performance 维度 + sales 业务员）：
   - 方案 A（推荐先用）：维度仍禁用，只保留筛选 → 零风险；
   - 方案 B：按人数均摊 `SUM(金额)/count(unnest)` → 需 `personCount` 列，汇总用摊后值。
   - **不做分摊就开维度 = 给用户错报表**。sales 侧建议写入时冗余 `salespersonList`（GIN 索引），不查询时 join。
2. **划线价 key 核验**（阻塞价格族 5→3 字段范围变更）：上线前必跑 payload 键扫描；若无 `marketPrice/strikePrice`，价格族从 5 降为 3。这是唯一可能改范围的项，建议最先做。
3. **父体聚合口径**（阻塞父体视图）：先定"父体行取哪个子体价格/库存"，父子关系来源未定不造行。
4. **赛狐账号权限**（阻塞 11 页 B 级文档基线复核）：当前账号仅开放商品/销售/订单/数据四模块，广告/采购/仓库/财务无入口；这 4 模块字段是文档基线，需权限补齐后实测复核。
5. **写操作授权范围**：订单录费用/标记测评/导入成本、`sync`、生成建议均为写操作，需明确是否在本 ERP 内落库、是否仅审批不直写。

---

## 6. 分阶段执行路线（对齐上传文档排期，按本报告核实后微调）

| 阶段 | 内容 | 页数 | 人天 | 前置 |
|---|---|---|---|---|
| 零期 | 4 个决策点拍板 + 划线价 key 核验脚本 | — | 1 | §5 |
| 一期 | 商品资料/采购/财务/出入库 4 页数据接入（15 数据集） | 4 | 24 | 决策 4/5 |
| 二期 | 在线产品字段+筛选、销量开关+grain、利润视图、订单 7 控件 | 4 | 20 | 决策 1/2/3 |
| 三期 | 筛选器条件模型 + 模板 + 详情抽屉 + 四维深链 | 全局 | 13 | — |
| 四期 | 广告 3 子域、库存 4 表、货件/补货、经营概览、同步增强 | 8 | 21 | 决策 4 |

合计约 **78 人天**。每期结束按 §7 六项逐条验收。

---

## 7. 1:1 达标定义（验收总纲，全绿才算完成）

| 项 | 判定标准 |
|---|---|
| 字段 | 赛狐该页表头字段全部存在；我方多出的字段允许，但不得替代 |
| 筛选 | 赛狐该页筛选项全部可用；禁止出现"赛狐有、我方置灰" |
| 视图 | 子体/父体、宽表/日矩阵、标签视图等切换齐全 |
| 动作 | 同步、导出、导入、配对、批量操作可用 |
| 跳转 | 点 ASIN 达亚马逊前台；点行进结构化详情；指标可下钻 |
| 数值 | 同口径同值；缺失显示 `—`，禁止 0 兜底 |

**硬约束（贯穿全程，不可违反）**：
1. 取不到就 `NULL`→`—`，禁止 0 兜底、禁止近似字段顶替（退款量≠换货量、预估利润≠毛利）。
2. 金额 `Decimal(20,4)`、汇率 `Decimal(12,6)`，计算用 `decimal.js`；派生列 CASE 口径，不用 `COALESCE(...,0)`。
3. 不推倒重做、不 `reset/clean`、不覆盖用户改动；`ProductRecord` 事实源不受影响。
4. 双池隔离、租户/workspace 边界、服务端白名单防注入；写操作走审批+审计+回读。
5. 6 处置灰控件必须真实打通，不允许把置灰改成 0 值展示。
6. 不猜测字段——新增字段映射前必跑 payload 核验；真实执行与 Fixture 明确区分。

---

## 8. 关于赛狐实采（加速 1:1 的可选协作）

- **登录态实测更新（2026-11-19）**：账号密码正确、可成功登录赛狐后台框架，顶部可见商品/销售/订单/广告/数据 5 个模块；但点击任一模块均被服务端挡回 `permissionNot.html`（"没有权限访问此页面"）。图形验证码经放大识别后可正确填写，**真正的阻塞是账号模块权限，不是验证码**。因此无法实采各落地页真实表头/筛选。
- **当前文档已提供 5 页 A 级实采数据**，规划层面无需重复抓取。
- **要提升 B 级 11 页到 A 级**，需账号权限补齐 + 登录后逐页抓表头/筛选，两种协作方式任选：
  1. 用户在本地登录赛狐后导出 cookie（JSON）提供，用会话态免登录抓取；
  2. 用户逐页截图（表头 + 筛选区 + 详情抽屉）发来，按图精确对齐。
- 无论哪种，都严格遵守"不猜测字段、取不到标 `—`"红线。

---

## 9. 五项改造执行记录（2026-11-19 · 代码核实后）

> 依据用户"参考文档升级"指令实际执行。执行前先核实当前代码（文档为 AI 生成，行号偏移、部分假设与代码不符），并按"不猜字段、取不到标 `—`、未覆盖如实报告"红线分层落地。
>
> **决定性约束**：本地库 5 张赛狐快照表全部 **0 行**（已只读查询确认）。任何依赖真实数据的映射/派生验证/反查都无法用实数据完成。

### 9.1 已完成并验证

| 改造 | 落地内容 | 代码证据 | 验证 |
|---|---|---|---|
| **改造2 毛利/毛利率/预计费用拆列** | 新建纯函数 `src/lib/sellfox/listing-derived.ts`（预计费用=FBA费+佣金+运费；毛利润=售价−(采购成本+头程+预计费用)；毛利率=毛利润/售价；任一因子 null→null，禁 COALESCE 0）；listings 列加 `estimatedFee/grossProfit/grossProfitRate`（默认隐藏，可自定义勾选）；后端 `loadWorkbench` listings 分支读时计算；`profitPrice/profitRate`（我方口径）保留并存不覆盖；毛利率为比率列不参与求和 | `listing-derived.ts`、`workbench-types.ts:listings`、`workbench-read.ts:loadWorkbench` | typecheck 通过；`sellfox-listing-derived.test.ts` 7 项 + 相关回归 113/113 通过；全量测试除环境 Node 门禁外全绿 |
| **改造1 前置：价格键核验脚本** | 新建 `scripts/verify-sellfox-listing-price-keys.ts`（只读扫 payload 价格语义键，支持 scope 过滤，0 行如实输出 NO_DATA、禁止写死映射） | `scripts/verify-sellfox-listing-price-keys.ts` | 实跑输出 `status=NO_DATA, rowCount=0`，行为符合预期 |
| **改造3 grain 时间粒度 + 星期分布列** | 新建纯函数 `src/lib/sellfox/browse-grain.ts`：grain=day/week/month 解析；week 以「ISO 周一」为桶 key（跨年天然不串周，且是合法日期前端零改动）、month 以月初；分桶聚合沿用 trend/average7「缺日不补零」口径（桶内任一业务日缺值→null，禁 COALESCE 0）；星期列 dow1-7 仅 grain=day 且 ≤62 天生成。接入 `browse-query`/`workbench-view` 参数与 URL 往返；后端 `loadWorkbench` 在读层重分桶（**SQL 逐日矩阵零改动**，trend/average7 仍按逐日固定口径）；sales 页加「按日/按周/按月」切换控件；星期列默认隐藏可勾选 | `browse-grain.ts`、`browse-query.ts`、`workbench-view.ts`、`workbench-read.ts`、`replica-workbench.tsx`、`workbench-types.ts` | typecheck 通过；`sellfox-browse-grain.test.ts` 10 项（ISO 跨年周、桶聚合缺日、summary entities、星期列范围、URL 往返）+ 相关回归 162/116 全绿 |
| **改造5 筛选条件模型（增量基础设施）** | 新建 `src/lib/sellfox/sellfox-filter-model.ts`：FilterCondition 模型、field→{column,type,ops} 服务端白名单（非法 field/op 400、前端不得传裸列名）、批量粘贴切分（逗号/分号/换行/空格，去空去重保序，上限 500 超限抛错不静默丢）。接入 `browse-query` 的 `filter.*` 参数（既有筛选完全保留，不推翻组件） | `sellfox-filter-model.ts`、`browse-query.ts` | typecheck 通过；`sellfox-filter-model.test.ts` 6 项 + 相关回归 62/62 全绿 |

### 9.2 阻塞项（未落地，非遗漏；附解锁条件）

| 改造 | 阻塞原因 | 解锁条件 | 现状说明 |
|---|---|---|---|
| **改造1 价格族 5 字段写入** | payload 无数据，划线价/B2B/优惠价 key 无法核验；文档 §7 明确"核验发现无键则 5 字段降 3" | 同步真实 Listing 数据后跑 9.1 核验脚本，据候选键人工抽样确认语义 | 核验脚本已就绪；写死未核验的 key = 猜测字段，违反红线 |
| **改造4 业务员打通** | **结构性缺失**：sales 数据源 `/api/productSale/page.json` 原始行只有 shopIds/mskus/asins/skus + productSaleDayOpenVo(day/指标/currency)，**根本没有业务员键**；performance 才有真实 `userNameList`（API payload 投影）。且分摊口径（§5 决策1）未拍板 | 拍板分摊方案（A 仅筛选 / B 均摊）；若要在 sales 侧显示业务员，需上游 API 提供该字段或写入链路按 storeId+msku 从 performance 反查并验证 | 当前代码已是方案A的正确实现：sales 侧业务员筛选置灰（title 明示"不从 Listing 伪造"），performance 用真实 userNameList 做筛选+facet。不开维度=避免错报表；不伪造=守红线 |

### 9.3 本轮执行诚实说明

- 5 项中 **改造2、改造3、改造5 已完整落地并单测验证**；改造1 前置核验脚本已就绪、写入因 payload 无键未做；改造4 为结构性字段缺失，当前方案A实现正确，未开维度/未伪造。
- 与上一版相比，本轮依据「代码里真实存在的 ERP 数据处理流程」重新评估：grain 分桶和星期列是**确定性日期计算**（`reportDate` 为真实 YYYY-MM-DD 字段），可脱离 0 行数据用构造日期完整验证，故从"阻塞"改为"已落地"；筛选白名单/批量粘贴同理。
- 全量测试：基线 2470/2471，本轮以最终全量回归为准。唯一固有失败是环境 Node v22.13.1 < 门禁要求的 22.19，与本改动无关。

---

## 10. 生产真实数据核验与改造1/4落地（2026-11-19 · 123服务器）

> 用户告知「123 服务器已配置好」，本轮通过 PEM 免密 SSH 登录 `ubuntu@123.207.47.225`，只读查询生产库
> （`amazon-ad-bulk-operation-postgres-1` / `amazon_bulk_ad`），用真实数据解锁此前因「本地 0 行」阻塞的改造1/4。
> **全程只读核验 + 代码层改造；生产库未执行写操作（migration 已在本地空库验证，生产执行需单独授权排期）。**

### 10.1 生产真实数据核验结论

| 核验项 | 真实结果 | 依据 |
|---|---|---|
| 快照表行数 | Listing 195930 / Sales 278689 / ProductDaily 112686 / FBA 911965 / 订单 112193 | `SELECT count(*)` 五表 |
| 价格族真实键 | payload 有 `standardPrice`(195930)、`listingPrice`、`listingPricing`(有效值 17935)、`salePrices`(非空 28035)；**无** `marketPrice`/`strikePrice`/`b2bPrice`/`businessPrice`/`promoPrice` | `jsonb_object_keys(payload)` 全量扫描 |
| 价格字段官方语义 | 赛狐 API 文档定义：`standardPrice`=价格、`listingPricing`=优惠价；`salePrices`/划线价/B2B 价**无官方定义** | `sellfox-api-合并.md` 指标表 |
| 业务员真实字段 | ProductDaily `userNameList` 物理列 112686 行全有（如 `["刘丹","姚晓凡"]`）；SalesDaily payload 仅 `orderNum/productNum/salePrice` 三键，**无业务员** | `SELECT payload ? 'userNameList'` + `jsonb_object_keys` |
| sales↔业务员关联 | 按 `storeId+msku`（不带日期，业务员是商品级属性）匹配率 **85.4%**；按 `storeId+msku+reportDate` 仅 8.7%（日期关联错误，已排除）；一个 msku 平均 2.09 业务员 | 多组 LEFT JOIN 匹配率对比 |

### 10.2 改造1 落地：优惠价列（真实字段，不猜键）

- 按官方定义只落地 **`promoPrice`=listingPricing（优惠价）**；`standardPrice` 已是 `price` 保留不动。
- 划线价 / List Price / B2B 价在真实 payload 与官方 API 均无键 → **不建列、不映射、UI 显示 `—`**，符合文档 §5「5→3 降级」预期，未写死未核验的猜测键。
- 改动：`schema.prisma`（Snapshot+Profile 两表加列）、新 migration `20261221000000_sellfox_listing_promo_price`（加列 + 重建 trigger 投影 + 重建视图末尾透出列 + `payload=payload` 真实数据回填 + Profile 镜像回填）、`listings-read.ts` 投影列、`listing-profile-refresh.ts` 列清单、`workbench-types.ts` 列定义（默认可见数值列「优惠价」）。
- **缺值语义**：无 listingPricing 的行 `promoPrice=NULL`，禁止补 0 或复制 price；migration 在本地空库 `prisma migrate deploy` 实跑通过（视图末尾追加列规避 42P16 报错）。

### 10.3 改造4 落地：sales 业务员筛选（真实 userNameList 关联）

- sales 页启用业务员**筛选**（方案A，不开维度）：workbench-read 与 agent-read 均按 `storeId+msku` 用 **EXISTS 半连接**关联 ProductDaily.userNameList，绝不展开数组（避免一行多业务员导致事实行膨胀），关联不到则排除、不伪造开发员为业务员。
- 业务员的 salespersons facet 按 scope+store/site 独立抓取（不套 sales 日期过滤，因业务员是商品级属性）。
- URL 往返、sales 页筛选控件开关、CSV/XLSX/Agent 导出路径全部打通；维度仍禁用（一行可能多业务员，开维度=错报表）。
- 性能：EXISTS 走 `sellfox_sales_agent_lookup`（storeId+msku+reportDate）与 product daily 的 storeId+msku 索引，生产 27.9 万行 sales / 11.3 万行 product daily 需实测响应时间（待生产执行后验证）。

### 10.4 本轮验证

- typecheck 通过；相关测试：listings 107/107、agent 51/51、browse-api 42/42、grain/query/workbench 163/163。
- 全量测试以最终回归为准；唯一固有失败为环境 Node v22.13.1 < 门禁 22.19（基线固有，与改动无关）。

### 10.5 生产执行待办（需授权排期，本轮未做）

1. 生产库执行 `20261221000000_sellfox_listing_promo_price` migration（含 195930 行 `payload=payload` 回填，注意 WAL 与维护窗口）。
2. 部署新版本到 123 服务器后，实测 sales 业务员筛选在 27.9 万行的响应时间，必要时给 ProductDaily 加 `(storeId,msku)` 覆盖索引。
3. 优惠价列在在线产品页抽样核对：内容 = 真实 listingPricing，无值行显示 `—`。
