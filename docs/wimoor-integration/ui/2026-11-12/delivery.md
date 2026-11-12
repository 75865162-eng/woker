# Wimoor UI 继续移植交付记录

日期：2026-11-12。目标是当前 ERP 本地代码及隔离验证；没有操作真实环境。

## 实际开发

- 核查 Wimoor AsideMenu、router、商品/订单/仓库/采购/供应商、FBA 计划/装箱/货件/物流、请款、结算、广告、报表和角色权限相关模板。全部 Vue 和辅助路由重新生成可追溯清单；区分页面入口候选、子组件、空模板与动态菜单。
- 统一导航保留原图标轨与顶栏，增加“业务菜单”按钮。抽屉按现有业务分组显示可读链接，可搜索、标记当前页、键盘关闭并恢复焦点；使用与图标轨完全相同的菜单配置及角色过滤结果。新增系统管理分组、Amazon 账号/站点和 Ads 账号入口，路由不变。
- `/operations?view=fba-boxing` 从未接入说明页升级为真实本地计划入口。列表读取原 API，展示状态、仓库/明细、计划数量、箱数、公司仓出库数量及分页。详情抽屉复用原业务控件；箱规表单的保存沿用原 API、plan revision、权限、审计与失败反馈。装箱摘要前移到计划头部；原头程页审批、费用、委托、货件关联、拣货出库入口保留。
- 通用费用页按 Wimoor paymentRequest 实际源码展示五个状态 Tab、供应商/付款方式/日期/单号筛选区及审核列。通用费用后端没有接入，筛选控件明确禁用，不展示伪总量、假单据、假审核或假付款。采购付款和头程费用提供原页面链接。
- 删除已没有业务调用的装箱/头程“全部未接入”布局分支，避免同一业务两套事实描述。更正 `fbacenter.vue` 为配送中心地址维护，及 quantity 空模板的映射。
- 没有新建 API、数据库表、Worker、同步计划或授权回退；没有引入 Vue、Java、Wimoor 静态资源和第三方组件。

## 页面、服务与缺口

[22 项源码/ERP/后端映射](../../../wimoor-ui-erp-mapping-2026-11-11.md)、[729 个 Vue 文件清单](page-inventory.md)、[逐文件哈希与路由证据](source-inventory.json)。

本次直接开发导航、装箱、商品观察/FBA 外部观察详情、结算/库龄/库存事件/赔偿报表和通用费用布局，并补齐采购审批状态筛选；沿用现有业务服务。不能将 22 项映射或 729 个源码文件扫描写成“所有 Wimoor 页面均已一比一移植并验收”。

仍缺少：Amazon 建入库计划、装箱方案生成/选择/确认、标签及实际发货写入；独立承运商/渠道目录、在线报价订舱、自动轨迹；通用费用单/报销/核销；完整凭证、总账、关账与会计报表；第三方海外仓；Wimoor 配送中心地址档案；完整在途调拨单生命周期。相关页面保留明确未接入状态或沿用当前有限业务能力，没有假成功。

## 截图

以下均为隔离测试，含 synthetic/fixture 单据和账号；不是生产数据或真人业务验收。Next 截图来自实际 App Router、数据库认证、API 和临时 PostgreSQL；component 截图使用受控 HTTP fixture，仅验证 UI 行为。

| 页面 | 截图及证据类型 |
| --- | --- |
| 业务菜单 | [Next 原图](screenshots/business-navigation-next-fixture.png)、[原图顶部视口裁剪](screenshots/business-navigation-next-fixture-viewport.png)、[component fixture](screenshots/business-navigation.png) |
| 装箱列表 | [Next 原图](screenshots/fba-packing-next-fixture.png)、[顶部视口裁剪](screenshots/fba-packing-next-fixture-viewport.png)、[component fixture](screenshots/fba-packing-list.png) |
| 装箱详情 | [Next 原图](screenshots/fba-packing-detail-next-fixture.png)、[顶部视口裁剪](screenshots/fba-packing-detail-next-fixture-viewport.png)、[component fixture](screenshots/fba-packing-detail.png) |
| 装箱表单 | [component fixture](screenshots/fba-packing-form.png) |
| 费用布局及禁用筛选 | [component fixture](screenshots/expense-management.png) |

## 本地验证

本次没有修改后端查询契约。按 UI 风险运行相关 Chromium 验证、类型检查、定向 lint；由于涉及公共壳，另按仓库规则运行修改前/后相同 dev 模式性能验证，并验证实际 App Router 刷新与原有 FBA 交接链。

- `npx playwright test --config tests/browser/wimoor-port.config.ts`：3/3 通过。装箱列表→抽屉→保存、409 保留输入、原 revision、查询范围及分页、刷新；只读不显示写入口、403 清除业务行、工作区切换关闭详情；菜单权限过滤、真实 href、搜索、当前页、Escape 焦点恢复。
- `npx playwright test --config tests/browser/wimoor-ui.config.ts --grep expense-management`：验证五个真实源码状态 Tab、禁用筛选、未接入说明及没有业务请求。
- `node scripts/test-fba-local-offline.mjs --browser`：通过。脚本只创建带身份标签的临时 PostgreSQL，从空库执行迁移，拒绝 dotenv 和外网。新增“业务菜单→装箱路由→刷新→已持久化装箱→详情→返回原计划页”验证；原审批、撤权、并发幂等、装箱锁定、货件关联、费用账单、部分/全部出库和人工运输闭环通过。修正旧测试未具名 checkbox 选择器，以区分新增的分层分摊选项。
- `npm run typecheck`、本次改动 TS/TSX 定向 ESLint、改动范围 `git diff --check`：通过。
- 继续开发后 `wimoor-ui.spec.ts`：40/40 通过。旧 fixture 已对齐现行提交审批操作、服务端 canCancel 标志及 returnedQty 字段；新增待审批/审批通过状态筛选验证，没有恢复旧的免审批下单操作。日志：`core-regression.log`。
- 未运行完整 `npm run check:fast` / `npm run check` 或生产构建：没有修改业务 API、依赖、Prisma、权限实现或准备合码/发布；采用相关 UI/隔离集成+类型+定向 lint。合码前运行完整合码检查。

日志与性能 JSON 位于仓库 `outputs/wimoor-ui-20261112/`：`port-ui.log`、`expense-ui.log`、`fba-integration.log`、`ui-regression.log`、`typecheck.log`、`lint.log`、`diff-check.log`、`performance-{before,after}.json`。这些是本机验证记录，没有向外部发布。

### 公共壳性能

`npm run performance:dev` 在改动前运行，随后使用原脚本 `--mode=dev --baseline=...` 对比。实际认证与业务 Layout，临时账号和临时库；保留撤权、跨组织与停用账号断言。没有读取真实配置、连接业务库或绕过服务端权限。

| 指标（ms） | 修改前 P50 / P95 | 修改后 P50 / P95 |
| --- | --- | --- |
| 登录（7 个样本） | 281.79 / 365.42 | 281.81 / 284.31 |
| 冷切页（3 个选定路由） | 1536.95 / 4475.97 | 1306.83 / 1760.10 |
| 热切页（9 个样本） | 325.35 / 855.64 | 210.86 / 820.37 |

冷切页原始值分别为 Listing AI、Logistics、Workspace；Workspace 从 1074.75 到 1270.50ms，约 +18.2%，其余两页下降。测试包含编译/调度噪声，不能据此宣称生产加速；没有超过同模式 20% 门槛。壳 DOM 保持、热切页公共请求为零，权限撤回/跨组织/停用断言通过。性能仅覆盖这些既有路由，不代表所有 22 个模块的生产 P95。

## 本次文件清单

以下仅列本次编辑或创建的文件。进入时已有大量修改/新增文件与路由分组迁移，本次没有重置、stash、覆盖或一并提交它们。

| 文件 | 改动 |
| --- | --- |
| `src/components/app-shell/app-shell-client.tsx` | 复用统一配置、系统入口、业务菜单按钮和当前页状态 |
| `src/components/app-shell/business-navigation.ts` | 原菜单配置单一来源，增加系统与账号入口 |
| `src/components/app-shell/business-navigation-drawer.tsx` | 可搜索、有焦点管理的分组抽屉 |
| `src/components/operations/sync-center-workbench.tsx` | 装箱路由接现有 FBA 工作台、来源选择和范围切换 |
| `src/components/operations/fba-local-plans-workbench.tsx` | plans/packing 视图复用、详情抽屉、装箱摘要位置 |
| `src/components/operations/fba-plan-table.tsx` | 真实本地计划装箱列表 |
| `src/components/operations/operations-sections.tsx` | 修正装箱接入状态和物流边界 |
| `src/components/operations/unconnected-business-workbench.tsx` | 按源码补齐通用请款布局，删除过时分支 |
| `scripts/wimoor/ui-inventory.py` | 地址页优先语义分类，输出动态计数 |
| `tests/browser/wimoor-port-{harness.tsx,config.ts,spec.ts}` | 新增定向 UI 验证 |
| `tests/browser/wimoor-ui.spec.ts` | 保留费用未接入验证，增加真实状态和禁用筛选断言 |
| `tests/integration/fba-local-browser.integration.ts` | 增加真实导航/装箱路由刷新与持久化验证，具名费用 checkbox |
| `docs/wimoor-ui-erp-mapping-2026-11-11.md` | 更新 22 项映射、接入状态和剩余缺口 |
| `docs/wimoor-integration/ui/2026-11-12/` | 本记录、清单/哈希和截图 |

## 影响、回退与同步状态

路由和业务服务不变，数据库没有本次新增迁移，后台任务和已有数据无需处理。若需回退本次 UI，应逐项撤销上述导航、装箱分流、费用布局及文档/测试改动，并保留同文件内其他既有/并行开发；不可对当前脏工作区执行整体 checkout/reset。UI 回退不需要回滚数据库。

GitHub 未提交/未推送，服务器未部署。真实店铺、Amazon 调用、真实 API 联调和生产验收均未执行；后续须按相应授权与环境边界独立安排。

## 核心页面继续开发（同日）

- FBA 外部观察按真实计划/货件/商品字段分列，计划→货件→商品使用原 observations 查询与原版本/来源范围；详情抽屉、筛选重置、返回计划入口可用。商品 Listing/Catalog 共用完整属性详情组件，不写回主档。
- 结算报告支持选报告→分页明细→原始行详情→来源任务；库龄改为可用库存和实际返回的库龄桶，事件改为事件/仓库/正负数量/对账数量，赔偿区分现金与库存赔偿数量。原始金额、数量保持字符串，未返回不补零，重叠分桶不合计。报表查询撤权/失败清空旧行及详情。
- 新增 `src/components/operations/business-record-fields.tsx`；升级 `observations-workbench.tsx`、`domain-reports-workbench.tsx`、`procurement-workbench.tsx`；扩展 `tests/browser/wimoor-port-{harness.tsx,spec.ts}`、`wimoor-ui.spec.ts`。`sync-center.spec.ts` 的独立浏览器构建补齐 Next navigation mock 与 process.env，供既有入口回归。
- `core-ui.log`：9/9 隔离浏览器用例通过；`core-regression.log`：40/40 通过；`core-sync-ui.log`：5/5 原同步中心定向回归通过；`core-typecheck.log`、`core-lint.log`：通过。无新增 API/模型/迁移/Worker，未执行真实业务调用。
- 新截图（均明确标识 fixture）：[FBA 观察详情](screenshots/fba-observation-detail.png)、[Listing 属性](screenshots/listing-observation-detail.png)、[结算原始行](screenshots/settlement-row-detail.png)、[库龄](screenshots/inventory-age.png)、[赔偿](screenshots/reimbursements.png)。

## 财务、订单商品与库存继续移植

- 财务交易新增原始状态筛选、重置、详情抽屉、汇率依据与来源任务；关联订单携带店铺/站点/订单范围。订单入口读取 URL 中订单筛选，订单→商品明细保留范围；刷新可继续读取同一订单。
- 订单商品新增详情、来源任务、在线商品/订单链接；刷新、筛选和读取失败清空旧明细，取消过时请求。列全部隐藏时仍保留详情操作。
- 库存新增详情抽屉，分别显示待发货/已发货/接收中、可售/预留/不可售与来源批次。列表原合计改称“入库合计”，不将三个阶段全当作实际在途；读取失败、翻页和工作区切换清空旧行与详情。
- 文件：`finance-workbench.tsx`、`orders-workbench.tsx`、`order-items-workbench.tsx`、`operations-hub-workbench.tsx`、`sync-center-workbench.tsx`，及 `wimoor-port-harness.tsx`、`wimoor-port.spec.ts`、`wimoor-ui.spec.ts`、`operations.spec.ts`。旧经营中台订单占位页改为实际订单管理入口。另修复 `transfer-order-rules.ts` 已有 payload 返回值的字面量类型推断（仅 as const）。未修改 API/Service/模型/数据库/Worker。
- 验证：`transactions-ui.log` 13/13，`transactions-regression.log` 40/40，`transactions-sync.log` 6/6，定向 ESLint 和 diff-check 通过。均为隔离 HTTP fixture；不是实际店铺/生产验收。`transactions-operations.log` 最终 15/15：3 项过时用例改为验证统一计划、配置跳转和现有订单入口，没有恢复旧同步或绕过审批。
- 全仓 typecheck 最终通过：期间工作区其他业务文件和模型持续更新，最初遭遇退款 Prisma 关联及调拨类型错误；相关文件随后更新，重新执行纯代码生成成功，`transactions-typecheck.log` 最终退出 0。本次未修改模型、未执行迁移。`transactions-wms-rules.log` 9/9 通过。
- 截图：[财务交易](screenshots/finance-transaction-detail.png)、[订单商品](screenshots/order-item-detail.png)、[库存详情](screenshots/inventory-snapshot-detail.png)，均标注 fixture。GitHub 未提交/推送，服务器未部署。

## 采购明细与 WMS 入库详情补齐

- 对照真实 `arrival_record.vue`、`skuTable.vue` 和 `warehouse/inbound/components/details.vue` 后，沿现有采购查询、WMS 收货查询和 ProductRecord 字段组织适配，不引入 Wimoor API/数据模型。采购单页已经展示采购商品明细、精确金额、备注、审批与实际收货进度；WMS 收货单新增独立详情抽屉，展示 ERP 返回的单号、仓库/库位、来源、状态、revision、批次与实收/质检/拒收/上架数量，并链接既有采购回查。
- 入库动作仍由现有 WMS 收货/审批流程处理；没有移植 Wimoor 直接撤销库存、打印、1688 订单状态、可用库存推算或商品图片占位。工作区/筛选切换、读取失败会清除旧选中详情。
- 修复 `WorkbenchDialog` Escape 取消事件被双层原生 dialog 同时处理的问题；供应商选择内层弹窗关闭时不再误关闭采购单外层弹窗。
- 当前 fixture 截图：[WMS 收货详情抽屉](screenshots/receipt-detail-drawer-fixture.png)、[采购到货详情](screenshots/purchase-arrival-detail-fixture.png)。截图使用显式隔离 fixture，不是实际业务数据。WMS 详情布局改编保留 Wimoor MIT 声明，未复制其图片或第三方组件。
- 定向浏览器验证：`npx playwright test --config tests/browser/wimoor-continue.config.ts` 6/6；`npx playwright test --config tests/browser/wimoor-ui.config.ts` 42/42（包含采购 SKU 金额/备注/详情、WMS 深链接和采购到货详情）；全仓 `npm run typecheck`、本次 TS/TSX 定向 ESLint、`git diff --check` 和迁移矩阵不变量/原清单哈希校验通过。
- `node scripts/test-wms-core-offline.mjs --browser` 尚未进入应用集成测试：临时数据库在应用测试启动前执行现有 `20261130010000_finance_ledger` 脚本时失败，PostgreSQL 报 `function "finance_voucher_line_guard" already exists with same argument types`（该 migration 文件重复声明同名函数）。这是本工作区并行财务迁移问题，本轮未改该 migration；因此新增详情已通过隔离浏览器 fixture，未标记临时 PostgreSQL/Next 端到端验证。
- 更新 729 行矩阵新增 3 项确切文件映射：总适配文件 25（其中 23 项连接 ERP 数据，16 项有业务操作），12 项适配范围有隔离 UI fixture 证据；666 项仍未移植、38 项明确不移植。未将 UI 或历史记录升级为临时库测试、完整源码对等或用户验收。原始 `source-inventory.json` 和 `page-inventory.md` 哈希保持不变。

## WMS 出库、收货与盘点继续开发

- WMS 出库需求页复用既有 `/api/operations/wms/outbounds` 和 `/api/products`：列表筛选/分页、详情抽屉、出库需求草稿新建及真实 ProductRecord 选择。详情展示请求、已分配、已出库数量；草稿明确不影响库存。实际预占、拣货、出库继续通过既有 WMS 状态机/审批操作，未在需求表单中假装发货。Wimoor 日期筛选、Excel 导入导出、批量删除和打印未移植。
- 收货页新增表单隔离流验证：仓库工作区、收货库位、批次、计划数量与来源单号形成 ERP 收货草稿 POST；保留实收、质检、上架分阶段的既有 WMS 业务流程。没有移植 Wimoor 库存/采购成本展示、Excel 导入或直接库存撤销。
- 盘点列表/作业适配当前 ERP 仓库库位和批次范围；验证了工作区下建档、读取盘点详情、按 revision 提交实盘命令。过账仍需既有独立审批；仅 ERP 自有仓能力，不扩写为 Wimoor 海外仓盘点，也未移植导入和打印。
- 逐文件追踪补入采购订单真实表单/详情/列表三项映射，并以隔离浏览器复核公司仓库目录列表和建档；Wimoor 采购变更、操作历史、1688 状态和仓库分组/第三方仓库仍未映射为完成。
- 精确文件映射进入 `scripts/wimoor/build-migration-matrix.py`，逐文件重生成 JSON/Markdown/Gaps：移植适配范围从 25 增至 40 个 Vue 文件（其中 38 个明确连到 ERP 真实数据服务，29 个映射到既有业务操作）；本次浏览器 fixture 验证累计 28 个文件。729 文件中 651 项仍未移植、38 项明确不移植。状态只表示所列范围，不是全文件对等或验收。
- 新增/扩展定向浏览器验证：收货列表/详情、收货草稿、出库列表/详情/草稿及商品选择、盘点列表/建档/实盘命令。截图：[仓库目录](screenshots/warehouse-catalog-fixture.png)、[收货草稿](screenshots/receipt-draft-form-fixture.png)、[出库详情](screenshots/outbound-detail-drawer-fixture.png)、[出库草稿](screenshots/outbound-draft-form-fixture.png)、[盘点实盘](screenshots/stocktake-counting-fixture.png)。所有截图均为隔离 HTTP fixture。
- 浏览器 fixture 检查当前 UI 到 ERP API 的方法、路径、workspace header 和 payload；它不执行真实 ERP API 或数据库，不等同临时 PostgreSQL、生产数据或用户验收。此前隔离数据库路径因并行 finance migration 重复声明函数 `finance_voucher_line_guard` 阻断；没有修改该迁移。
- 本轮验证命令与结果：`npx playwright test --config tests/browser/wimoor-continue.config.ts` 9/9；`npx playwright test --config tests/browser/wimoor-ui.config.ts` 42/42；`npm run typecheck`、`npx eslint src/components/operations/wms-workbench.tsx tests/browser/wimoor-continue.spec.ts`、`git diff --check`、`python3 scripts/wimoor/build-migration-matrix.py` 均通过。两组浏览器都是隔离 HTTP fixture，不是实际数据库操作验证。
- 盘点作业截图：[盘点实盘 fixture](screenshots/stocktake-counting-fixture.png)。矩阵统计为：独立路由确认 60（其中业务模块 53；另 143 个动态菜单候选未确认）；729 项里 40 项有明确适配，38 项接 ERP 数据、29 项连接真实业务操作，28 项有 UI fixture 证据，651 项仍未移植，38 项明确不移植。完整源代码对等与用户验收均为 0。

## 商品主档、Amazon 报告继续映射

- 按 Product Center 专项架构和实际页面结构，把 Wimoor 商品列表、详情、编辑基础/采购/规格、图片上传入口与 ERP `/dashboard` ProductWorkbench 精确关联。服务仍是 ProductRecord 列表/详情/聚合保存，图片走 FileObject 与现有上传接口；不把 Amazon Listing observation 写入主档，也不伪造上游库存数、图片、阶梯采购报价或税率。价格阶梯弹窗保持未移植，因为当前正式模型/API没有相同事实结构。
- Amazon 结算 SKU 两个 Tab 的源页面映射到 ERP 真实 settlement 原件/行查询；当前 ERP 提供站点归属核验后的源行和明细抽屉，不移植上游 SKU 汇总、结账锁汇、重算或跨币种合计。赔偿页映射至已实现赔偿报告，保留现金/库存赔偿数量、原币金额和来源报告意义。
- 对照 `amazon/order/order_manager` 源码确认主列表/表格与详情所含的 Amazon 订单数据适配到 ERP 订单查询/详情；发票模板、退款或订单发货写操作未纳入映射。实际订单回归验证由既有订单详情用例覆盖，不声称发票、退款操作完成。
- 新增矩阵精确文件映射后共 58 项明确适配：56 项接 ERP 数据，36 项映射既有业务操作；47 项有 fixture 浏览器证据。729 项中 633 项未移植，38 项明确不移植，完整源代码对等和用户验收均为 0。原始清单与哈希校验通过。
- 订单列表/详情源组件补充到 ERP 订单查询映射；详情边界仅展示当前 API 字段，不接入上游买家邮箱/地址、发票、退款或备注写入。既有订单详情 fixture 覆盖缺失字段提示与跳转订单商品。
- 本轮相关验证：`npx playwright test --config tests/browser/playwright.config.ts` 17/17（Product Center 隔离编辑/图片/版本流）；`npx playwright test --config tests/browser/wimoor-port.config.ts` 14/14（含结算、赔偿、库龄、库存事件、订单、FBA 观察）；前述 `wimoor-continue` 10/10 与 `wimoor-ui` 42/42。浏览器均为本地组件/HTTP fixture，不是生产数据验收。

## FBA 货件与运输/报关结构续接

- 读取并逐项对照 Wimoor `shipv2/shipment_handing/list`、详情 Tab、运输、报关声明/清关页面。Amazon 货件列表移到 ERP `/operations?view=fulfillment` 的真实观察查询：保留计划→货件→商品下钻、来源版本/站点、筛选、详情、分页和 Amazon 原始状态；状态以标签显示，未知状态保持中性样式。没有造出假状态或虚构数量。
- 运输、报关结构对应既有 FBA 本地计划工作台的货代委托、人工轨迹、报关草稿、主管复核、清关回执与独立费用记录。上游的承运商 API、Amazon 写入、接收数量、标签、费率公式、HS/税率/材质全字段、真实海关模板及发票模板没有等价后端，仍标为缺口；本地人工业务不冒充外部完成状态。
- 追踪矩阵共 65 个文件明确适配，63 个连接现有真实 ERP 数据，41 个对应现有业务操作；48 个适配范围有隔离 UI fixture 证据。729 个源文件中 626 项未移植、38 项明确不移植，完整源文件对等与用户验收为 0。页面分类统计：203 个静态独立页、143 个动态入口候选，198 个弹窗、311 个子组件、13 个公共组件、4 个空模板。原始清单哈希保持不变。
- 本轮验证：`npx playwright test --config tests/browser/wimoor-port.config.ts` 14/14；`npx playwright test --config tests/browser/wimoor-continue.config.ts` 10/10；定向 ESLint、`git diff --check`、`python3 scripts/wimoor/build-migration-matrix.py` 通过。最新 `npm run typecheck` 被工作区新增的未跟踪 `src/lib/finance/voucher-import-rules.ts` 报 TS2737（BigInt literal target < ES2020）阻断；未改该并行文件。浏览器为本地隔离 fixture；不是数据库链或生产验收。截图：[FBA 观察列表](screenshots/fba-observation-list-fixture.png)、[FBA 观察详情](screenshots/fba-observation-detail.png) 和 [FBA 货代列表](screenshots/fba-shipping-list-fixture.png)。
- 本轮仅更新 FBA 状态展示和精确映射证据；未改数据库模型、API/Service 契约、权限、Worker、运行配置，未触碰其他并行修改。未提交、未推送、未部署。
