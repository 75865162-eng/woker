# Wimoor（排除亚马逊页面）功能差距与移植计划

> 日期：2026-11-24
> 性质：只读调研 + 移植规划（未改业务代码、未连生产库写入）
> 基线仓库：`wimoor-erp/wimoor` → `/workspace/wimoor`，已 fetch+pull 到最新 upstream `ec86736`（2026-09-24）
> 我方仓库：`/workspace/woker` → `main`，commit `79d62f3a`（Wimoor 字段对标 P0–P2 全量升级）
> 对比口径：**排除全部亚马逊页面**——wimoor 侧 `views/amazon/**`、`wimoor-amazon`、`wimoor-amazon-adv`、以及路由 `/amazon/**`（含 11 个「路由在 /finance/* 但组件在 V/amazon/ 下」的伪财务页）；woker 侧 `/amazon/**`、`/sellfox/**` 全部只读快照资产归为「已有资产，不参与差距计算」。
> 与旧文档关系：本文**更新并取代** `docs/wimoor-vs-woker-gap-and-migration-plan.md`（2026-11-23）。旧文档的结论骨架有效，但缺少最新 upstream 核验与本次逐菜单/逐源码的实证，且未纳入 79d62f3a 的字段对标成果。

---

## 0. 结论先行（先看这 4 条）

1. **拉回状态**：wimoor 已在本地 `/workspace/wimoor`，origin = `https://github.com/wimoor-erp/wimoor.git`，已拉取到最新 upstream `ec86736`，工作区干净。用户所说「WinooR」实为「wimoor」仓库，无独立 WinooR 项目。
2. **定位差异而非单点差距**：wimoor 是**可写业务操作系统**（采购/仓储/发货/财务均有审批流、状态机、打印、导入导出）；woker 是**外部只读快照 + 本地核心主档 + 部分本地协同写**的数据洞察平台。差距的本质是「是否要在 woker 内管理这些业务」——这是产品决策，不是纯技术补齐。
3. **我方财务不弱反强**：复式记账、期末结账、禁自审/独立关账复核、乐观锁比 wimoor 更严谨；唯一标准缺口是「现金流量表 / 权益变动」模板。AI（对话/Lili/Skill/Agent）显著强于 wimoor 的 DeepSeek 单页。
4. **真正欠缺集中在 4 大块**：① 物流报价系统；② 海外仓完整体系；③ 生产制造/MRP（客户定制）；④ 供应链单据写闭环（发货单/加工单/采购入库/请款）。另外有 30 项 `planned` 数据源待接入（其中 P0/P1 的 6 项收益最高）。

---

## 1. 对比方法与口径

| 项 | 来源 |
| --- | --- |
| wimoor 功能树 | `init-config/mysql/数据/db_admin/t_sys_menu.sql`（225 菜单：162 带 component + 63 容器）+ `wimoor-ui/src/views/**` + 各后端 `*Controller`/entity |
| wimoor 路由机制 | `wimoor-ui/src/router/index.js` 动态调用 `/api/admin/api/v1/menus/route`，`component` 映射到 `views/**/*.vue`；菜单 SQL 才是页面全集 |
| 亚马逊剔除规则 | component 以 `amazon/` 开头 或 路由以 `/amazon/` 开头 或 源码在 `views/amazon/**` 或 后端属 `wimoor-amazon*`；命中任一即排除 |
| woker 功能树 | `src/components/app-shell/business-navigation.ts`（7 板块）+ `src/components/operations/operations-sections.tsx` + rewrites（`namespace-routes.ts` / `amazon-slug-routes.ts`）+ `prisma/schema.prisma` + `src/lib/**` |
| 差距判定关键证据 | `src/lib/sellfox/data-plan.ts`（30 个 `planned` 项 = woker 自认缺口，最权威）；"未发现"指当前源码/导航中不存在 |

### 统计口径

| 指标 | wimoor | 说明 |
| --- | --- | --- |
| 菜单总数 | 225 | 162 页面 + 63 容器 |
| 亚马逊菜单 | 58 | 另 10 条静态路由 |
| 非亚马逊菜单 | 104 | 其中 96 个源码实际存在，8 个 `customized/chelsea/*` 声明缺失（客户现场定制） |
| 非亚马逊静态路由页 | 55 | erp.js 41 + sysRouter 6 + 其他 8 |
| **非亚马逊可访问页面合计** | **151**（含定制声明 159） | 11 个功能域 |
| 非亚马逊后端模块 | 7 | erp(704 Java) / finance(313) / admin(367) / quote(75) / data(18) / gen(15) / gateway(4) |

---

## 2. 功能域全景对比矩阵（已排除亚马逊）

图例：✅ 相当 / 🟢 woker 更强 / 🔴 wimoor 有 woker 缺 / 🟡 部分覆盖 / ⚪ 不适用（已排除）

| 功能域 | wimoor 能力 | woker 现状 | 判定 |
| --- | --- | --- | --- |
| 产品/物料主数据 | SKU 主档+品牌/品类/标签/辅料/包材/箱子+详情 | 主档+品牌/品类/属性 live；辅料/包材/详情/配对 planned | 🟡 |
| 采购管理 | 计划/采购单/加工单/换货/请款/供应商/1688/5 类报表 | 采购单+供应商本地写+协同；加工/入库/退货/头程 planned | 🟡 |
| 仓储库存 | 仓库/库位/出入库/调库/代料/盘点/库存流水/周转/滞销/海外仓 | 完整本地 WMS（收货/出库/预占/盘点/调拨/流水/风险/货值）+ 赛狐快照；海外仓部分 | ✅/🟡 |
| 发货物流 | 发货单/货件处理/发货规划/承运商/装箱贴标/海关 | FBA 本地计划+货件快照+物流文件工作台；ERP 发货单写工作流缺 | 🟡 |
| **物流报价系统** | 独立 `wimoor-quote` 75 Java：集中询价/报价单/渠道/关联设置 | **无独立系统**（仅供应商报价单属采购域） | 🔴 大缺口 |
| 财务核算 | 凭证/科目/总账明细账/余额/报表/结账/台账/币别 | 完整且更严谨；仅缺现金流量表/权益变动模板 | 🟢/🔴 |
| 账目财务 | 采购记账/库存货值 | 采购未结/发票过账/货值/估值规则齐全 | ✅ |
| **海外仓完整体系** | 备货单/订单/库存/费用分摊/补发货规划 | 本地台账 partial，`oversea-stock` planned P2 | 🔴 大缺口 |
| **生产制造/订制** | 生产计划/MRP/人力计划/出货计划/提货付款/成本核算 | 几乎为零（客户定制源码亦缺失） | 🔴 大缺口 |
| 系统管理 | 菜单/角色/子账号/部门/字典/字段/任务/代码生成/数据迁移 | 账号权限/任务/字典完整；动态菜单/部门CRUD/代码生成/飞书/公告/客户/个人中心缺 | 🟡 |
| AI 与工具 | DeepSeek 单页问答 | AI 对话+Lili+Skill+Agent+Listing AI | 🟢 我方强 |

---

## 3. 我方功能欠缺清单（重点：按移植价值排序）

### 3.1 A 类 — 完全缺失的功能系统（需产品决策「是否在我方内管理该业务」）

| # | 功能系统 | wimoor 证据 | woker 现状 | 移植成本 | 决策点 |
| --- | --- | --- | --- | --- | --- |
| A1 | **物流报价系统**（集中询价/报价单/渠道管理/关联规则） | `wimoor-quote` 75 Java + `V/erp/shipv2/quote/*` 4 页 + 免登录报价页 | 无独立系统 | 中（4 页 CRUD + 报价计算 + 渠道规则） | 是否要做货代询价业务？ |
| A2 | **海外仓完整体系**（备货单/多渠道订单/库存/费用分摊/补货计划） | `V/erp/warehouse/overseas/*` 7+ 页 + erp 后端 | `oversea-stock` planned P2；本地三方仓台账 partial | **高**（最大单项） | 是否管理第三方海外仓业务？ |
| A3 | **生产制造/MRP**（生产计划/物料需求/人力计划/出货计划/成本核算） | `V/customized/plantool/*` + `chelsea/*` 声明（源码缺失） | 无 | **高** | 客户定制，源码不全，需现场确认需求 |
| A4 | **ERP 发货单写工作流**（审批+多步状态+打印） | `V/erp/ship{,v2}/*` + 大量静态向导页 | 本地 FBA 计划/货件快照；完整写工作流缺 | 中-高 | 是否需要我方内审批发货？ |
| A5 | **现金流量表 / 权益变动**标准报表模板 | wimoor-finance report 模块 | finance report service 无该 kind | 低（扩展 kind + 基于 POSTED_LEDGER 渲染 + 单测） | 无争议，可直接做 |
| A6 | 系统小件：动态菜单管理、独立部门 CRUD、公告发布、客户管理、代码生成、真实飞书连接、个人中心、记事本 | wimoor-admin + sys 页面 | 部分被 Skill/Agent/账号页替代；飞书无真实连接 | 低-中（逐项） | 逐项取舍 |

### 3.2 B 类 — 部分覆盖（读强写弱 / 框架已有，需补写或补读）

| 子功能 | wimoor | woker 现状 | 缺口性质 |
| --- | --- | --- | --- |
| 辅料/包材/箱子主数据 | 完整 | `aux-material` planned P2；仅有 WMS 耗材 | 读模型未接入 |
| 加工单 | 完整单据 | 本地仅 assembly；`stock-ops` 含加工 planned P2 | 读模型/写单据 |
| 请款单 / 换货单 | 完整 | `procurement-collab` 本地写已有；赛狐 `payment`/`purchase-return` planned | 写已有、读待接 |
| 采购入库单 | 完整 | `purchase-receipt` **planned P1** | 读模型 |
| 商品详情 V2 / 多平台配对 | 完整 | `product-detail` / `listing-pair` planned P2 | 读模型 |
| 库存单据（调整/调拨/盘点/加工/拆分） | 完整 | 本地 WMS 有；赛狐 `stock-ops`/`in-out` planned P2 | 读模型 |
| 货架位 / 标签列表 | 完整 | `bin` / `tags` 列表 planned P2（打标写入已有） | 读模型 |
| 头程分摊 / 成本调整 | 完整 | `first-leg` planned P2 | 读模型 |
| 付款单/收款单/请款池 | 完整 | `payment` planned P2 | 读模型 |
| 1688 账号绑定/直连采购 | 完整 | 仅作选品证据来源；无绑定/直连 | 集成 |

### 3.3 C 类 — `data-plan.ts` 中 30 项 planned 数据源（按优先级）

**P1（6 项，收益最高、风险最低，建议第一批）**

| id | 标签 | 端点状态 |
| --- | --- | --- |
| `purchase-receipt` | 采购入库单 | 文档已确认，端点待试调 |
| `fba-dispatch` | FBA 发货单 | 三个端点含 create，明显可对接 |
| `fba-shipment-products` | 货件产品明细 | 两个端点已登记 |
| `profit-report` | 利润报表 9 维×2 套 | **接口已实测调通**（shop/asin 等，200+ 字段） |
| `aba` | ABA 搜索词 | 端点 `/api/cpc/searchTerms/pageList.json` 已确认 |
| 现金流量表/权益变动 | （非数据源，A5） | 基于现有 ledger |

**P2（24 项）**：`listing-log`、`custom-report`、`aux-material`、`product-detail`、`tags`、`listing-pair`、`fbm-order`、`hourly-sb-sd`、`bin`、`in-out`、`stock-ops`、`fba-packing`、`oversea-stock`、`batch-flow`、`purchase-plan`、`purchase-return`、`purchase-meta`、`first-leg`、`invoice`、`payment`、`delay`、`amazon-report`、`amazon-fee`、`customized/plantool` 系列。

> 口径说明：赛狐 API 凭据已配置在服务器，P1 项可直接用真实数据试调——但**禁止臆造 typed 表**：响应字段无官方定义的先原样落 `SellfoxApiRecord`，金额 number 建 typed 表时转 Decimal(18,4)+三列。

---

## 4. 移植策略

### 4.1 两条红线（来自 woker 架构约束）

1. **不照搬 OPERATE 写系统**：外部快照/Projection/Read Model 不得反向覆盖核心主档；缺失数据保留 null / NEEDS_DATA，不造数；研究/建议/广告草稿不自动写入商品/上架/投放。
2. **B 类写功能必须产品拍板**：海外仓/生产/发货单写操作会引入新事实源，只有在确认「要在 woker 内管理这些业务」时才做，需独立设计状态机/审批/审计，属新业务线，不可当作「补齐功能」轻率移植。

### 4.2 功能移植分类

- **A 类（读模型移植，优先）**：把 `data-plan.ts` 的 planned 数据源按既有「通用采集器 + typed 表 + 只读工作台」模式接入。与现有架构一致、风险低、验收清晰。
- **B 类（写功能本地化，审慎）**：仅 A1–A4 涉及；需 go/no-go 决策，若 go 则单独立项。
- **A5 财务模板**：无争议，直接做。

---

## 5. 分阶段移植路线图（每阶段独立可验收）

| 阶段 | 内容 | 依赖 | 工作量估算 | 验收标准 |
| --- | --- | --- | --- | --- |
| **S0 决策** | 对 A1–A4 做 go/no-go；确认资金使用哪个平台、生产业务是否真实存在 | 产品/业务方 | 1 周（沟通） | 输出书面结论；未确认项冻结 |
| **S1 P0/P1 读模型** | 接入 P1 六项（purchase-receipt/fba-dispatch/fba-shipment-products/profit-report/aba + 财务模板） | 赛狐凭据（服务器已配） | 2–3 周 | 通用采集器实测有真实行数；typed 表字段按 payload 定型；金额 Decimal 三列；只读工作台可查；财务单测锁定借贷/合计 |
| **S2 P2 读模型补齐** | 24 项 planned 中非亚马逊的读模型（标签列表/货架位/库存单据/采购链/付款/头程等） | S1 模式复用 | 3–4 周 | 同上；不混用事实源；`data-plan.ts` planned 数显著下降 |
| **S3 财务模板** | 现金流量表 / 权益变动 | 现有 ledger service | 1 周（可与 S1 并行） | 模板 kind 扩展；基于 POSTED_LEDGER 渲染；单测 |
| **S4 B 类写功能** | 仅对 S0 go 的项：物流报价 / 海外仓 / 生产 / 发货单写工作流 | S0 决策 + 独立设计 | 各 4–12 周 | 独立项目验收：状态机/审批/审计/打印/导入导出齐全，不违反红线 |

---

## 6. 风险与未知

- **U1**：wimoor `customized/chelsea/*` 与 `amazon_follow_ui` 的 8 个页面在本仓库**源码缺失**（客户现场定制），A3 生产制造的真实需求与代码需现场确认。
- **U2**：wimoor 菜单 SQL 是历史快照，已用 clone 源码交叉验证 views 目录修正；但仍可能有 upstream 未纳入的功能（本次已 pull 到最新 `ec86736`，风险已降到最低）。
- **U3**：`data-plan.ts` 的 planned 状态是代码快照；服务器运行版本是否仍 planned 需在服务器侧复核（本次源码三方一致 `79d62f3a`）。
- **R1**：赛狐 API 未存档端点（标注「文档：接口名」）必须真实凭据试调确认字段，先落 `SellfoxApiRecord`，禁止臆造 typed 表。
- **R2**：B 类写功能引入新事实源，未获产品决策前不得启动。
- **R3**：金额字段 number→Decimal 转换若遗漏，会造成财务报表精度问题；S1/S2 必须逐表检查。

---

## 7. 下一步（需要你拍板）

1. **S0 决策**：A1 物流报价 / A2 海外仓 / A3 生产制造 / A4 发货单写工作流——哪些要在 woker 内管理？（不确认则只做读模型与财务模板）
2. 若同意，我可立即启动 **S1**：先用服务器真实凭据试调 P1 六项，按 payload 定型落表并做只读工作台，同时并行完成 S3 财务模板。
3. 全部写功能在决策前保持冻结，不做任何生产库写入。
