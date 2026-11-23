# 赛狐「销量统计」→ `/sellfox/profit` 字段级复刻 · 实施计划

> 状态：**草案 / 待审批**（未改任何业务代码，未部署，未连接线上）
> 日期：2026-11-23
> 来源：用户提供的《赛狐销量统计 → /sellfox/profit 字段级复刻实施说明》（只读调查与实施计划）
> 关联：[字段级升级规划 2026-11-19](./sellfox-1v1-replica-field-level-upgrade-plan-2026-11-19.md)、[sellfox-agent-read](./sellfox-agent-read.md)、[sellfox-round-h2](./sellfox-round-h2.md)

---

## 0. 本文档的性质与硬边界

- 本文档是**实施计划**，不是执行授权。文档原文明确：「线上行为、数据库和 API 没有由本文授权修改」。
- 任何**部署到服务器、连接生产数据库、执行真实业务写入**的动作，都必须先取得单独、明确的书面授权（见第 5 节关卡）。
- 文档第 0 节列出大量**未知项 U**：源站默认值、控件细节、请求响应、指标语义、跳转行为均未对账，且「现有资料未保存 productStat 专属 JS / HAR」。在这些补齐前，只实现可靠子集，不得用猜测结果冒充完成。
- 凭据安全：对话中曾出现一个已泄露的 GitHub PAT 与一个来源不明的 RSA 私钥（裸 IP + 明文 HTTP 下载）。两者均**不得写入本仓库、不得用于登录或部署**。PAT 必须立即撤销；私钥来源与归属未确认，禁止使用。

---

## 1. 代码事实（C）核对结果 —— 已核实，与来源文档一致

| 文档声明 | 源码证据 | 结论 |
| --- | --- | --- |
| `/sellfox/profit` → `hostPage("profit")` → `HostWorkbench` | `src/app/(erp)/sellfox/profit/page.tsx:8-12` | ✅ |
| 利润四个数据集：`product_daily`(live) + `profit_daily/monthly/settle`(planned) | `src/lib/sellfox/host-page-profit.ts:9-101` | ✅ |
| 产品日利润表 `SellfoxProductDailySnapshot` | `host-page-profit.ts:15` | ✅ |
| `/sellfox/sales` → `SalesStatsWorkbench` → `ReplicaWorkbench(replicaPage("sales"))` | `src/app/(erp)/sellfox/sales/page.tsx`、`_components/SalesStatsWorkbench.tsx:7` | ✅ |
| 销量数据源 `SellfoxSalesDailySnapshot`、endpoint `/api/sellfox/sales` | `replica-pages.ts:59-67`、`api/sellfox/sales/route.ts:19` | ✅ |
| 销量页默认维度 msku，父ASIN/ASIN 双视图，5 个开关其中实时/测评/换货禁用 | `replica-pages.ts:39-48,69-71,116-122` | ✅ |
| `/sellfox/performance` → `SalesProfitWorkbench`（销售利润） | `performance/page.tsx`、`_components/SalesProfitWorkbench.tsx` | ✅ |

**结论**：来源文档对当前工作区的代码事实描述准确，可作为规划基线。但代码事实只证明代码意图，不证明线上部署版本或数据覆盖。

---

## 2. 路由与职责冲突（文档第 1 节核心问题）

| 地址 | 当前职责 | 数据 |
| --- | --- | --- |
| `/sellfox/profit` | 利润报表（产品日利润 + 3 个待接标签） | `SellfoxProductDailySnapshot` |
| `/sellfox/sales` | 销量统计（复刻工作台） | `SellfoxSalesDailySnapshot` |
| `/sellfox/performance` | 销售利润 | `SellfoxProductDailySnapshot` |

用户指定目标为 `/sellfox/profit`，而销量工作台当前在 `/sellfox/sales`。两者是不同数据模型，不能把利润事实当销量事实。

### 设计（D）方案（待确认）

1. `/sellfox/profit` 默认呈现**与 `/sellfox/sales` 同一个销量工作台实例**（同一组件、同一查询，不维护第二套算法）。
2. `/sellfox/sales` 继续提供同一组件与查询，两个 URL 均可直接打开、刷新、带参数。
3. 保留原利润报表四数据集为明确可访问的「利润报表」视图，例如 `/sellfox/profit?view=report`，并在导航提供清晰链接。
4. **行为变更风险**：旧链接无 `view` 参数的默认含义会改变，属于路由/共享契约变更。实现前必须完成第 3 节盘点，给出迁移告知、回退路径与验证，并按 AGENTS 要求取得确认。不得静默删除原利润入口。

---

## 3. 实现前必须完成的只读盘点

- [x] 核对三条路由声明与源码（第 1 节，已完成）
- [x] 盘点站内指向 `/sellfox/profit` 的引用：`business-navigation.ts:58-59`、`host-pages.ts:29`、`host-page-profit.ts:5`
- [x] 盘点测试引用：`tests/e2e/tab-navigation-repro.spec.ts`、`tab-click-decisive.spec.ts`、`persistent-app-shell-views.test.ts`、`navigation-7-sections.test.ts`
- [ ] 盘点收藏/外部调用方/文档中对 `/sellfox/profit` 默认含义的依赖（需团队提供）
- [ ] 与源站对账，补齐未知项 U（见第 4 节）
- [ ] 确认 `?view=report` 参数不会被现有权限/CSRF/缓存逻辑破坏

---

## 4. 未知项 U（必须由源站对账补齐，禁止猜测）

| 项 | 当前状态 | 补齐方式 |
| --- | --- | --- |
| 首屏默认视图（父ASIN / ASIN）与默认日期、币种、粒度 | 观察态不可外推 | 登录态实采 + 记录初始状态 |
| 父ASIN / ASIN 切换的汇总语义与「按父ASIN汇总 / 按ASIN汇总」开关 | 部分观察 | 抓包响应 + UI 对照 |
| 指标列（销量/订单量/销售额/小计）口径与汇总边界 | 未捕获请求响应 | productStat 专属 JS / HAR |
| 「分析」趋势弹窗的字段与数据来源 | 未捕获 | 抓包 |
| FBA/FBM、自定义列、销量洞察的行为 | 部分观察 | 实采 |
| 跳转与参数契约 | 未知 | 实采 |

REA 仅分析主导航语言脚本，明确「不包含销量页程序，不可据此推断销量公式或请求」；本次无 CDP、未捕获网络响应。以上未知项不补齐，不得声称 1:1 复刻完成。

---

## 5. 授权关卡（Gate）—— 未通过不得进入下一阶段

| Gate | 前置条件 | 允许的动作 | 当前状态 |
| --- | --- | --- | --- |
| G0 只读调查 | 无 | 读源码、被动端口/TLS 探测、写本计划文件 | ✅ 已通过 |
| G1 代码实施 | 团队确认第 2 节路由方案与行为变更、补齐 U 项关键部分 | 仅改本地代码，本地测试 | ⛔ 未通过 |
| G2 部署测试环境 | 明确的目标环境、授权人、回滚方案 | 部署到**测试**环境 | ⛔ 未通过 |
| G3 部署生产 | 生产变更审批、专属授权、维护窗口 | 部署到生产 | ⛔ 未通过 |
| G4 真实业务执行 | G3 + 数据写入范围书面确认 | 生产数据读写 | ⛔ 未通过 |

> 用户提出的「开发升级 → 部署服务器 → 真实业务执行 → 充分等待 → 服务器端验收」闭环，对应 G1→G4。当前仅到 G0。反复提供凭据不构成 G2/G3/G4 的授权。

---

## 6. 阶段一实施步骤（仅 G1，待授权后执行）

1. 在 `replica-pages.ts` 复用 `sales` 页配置，新增 `profit` 视图映射，不复制算法。
2. `profit/page.tsx` 依据 `?view` 参数在销量工作台与利润报表间切换；默认行为按第 2 节确认结果决定。
3. 更新 `business-navigation.ts` 与 `host-pages.ts` 的导航/契约，保留原利润入口链接。
4. 更新 4 个测试文件对新默认行为的断言，并补充 `?view=report` 回归测试。
5. 本地跑 `npm run test`、`npm run lint`、`npm run typecheck`、`npm run ui:guard`，全部通过后再申请 G2。

---

## 7. 验收标准（供后续循环验证使用，非本次执行项）

- 两个 URL 均可直接打开、刷新、带参数；四种视图切换正常。
- 销量事实来自 `SellfoxSalesDailySnapshot`，利润事实来自 `SellfoxProductDailySnapshot`，无混用。
- 金额按币种分列，缺失保持空白不补 0；禁用控件原因与源站一致。
- 原利润报表可通过 `?view=report` 完整访问，旧链接迁移有告知与回退。
- 本地测试/lint/typecheck/ui:guard 全绿；测试环境验收通过后才允许申请生产。
