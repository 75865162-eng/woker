# 三域移植验证记录

日期：2026-11-12。用户已把三阶段改为一次持续推进；以下覆盖当前本地结构和流程接入，不能作为真实 Amazon、公司账务或生产上线验收。

## 当前代码验证

| 检查 | 结果 | 验证范围 |
| --- | --- | --- |
| `tsx --test tests/fba-local-*.test.ts tests/fba-external-operation.test.ts tests/wms*.test.ts tests/finance*.test.ts tests/procurement*.test.ts` | 102 通过、0 失败 | 数量、装箱、费用分摊、来源交接、六位金额、核销、关账证据、报表/损益、辅助维度、附件文件头、导入行与来源校验、银行有符号金额、XLSX 文本精度/拒绝公式、精确报表公式与非法表达式 |
| `node scripts/test-three-core-offline.mjs --core-port` | 退出码 0 | 在空临时 PostgreSQL 执行完整迁移链；AP/AR、部分核销/账龄、并发重放、冲销/不可变证据；关账制度/独立来源声明/快照失效/撤权/期间锁；报表版本及损益草稿；FBA 未知结果人工登记/独立核实及禁止盲重发；实际 HTTP 撤权检查 |
| 同一 core-port runner 的辅助核算用例 | 通过 | 目标类型/项目/必填科目规则、凭证类别、6 路并发仅一次版本编辑、跨工作区隔离、必填审核拦截、审核后数据库不可变与红字继承 |
| 同一 core-port runner 的附件用例 | 通过 | PostgreSQL 真实事务/约束；6 路上传版本竞争、失败对象补偿、作用域/有界下载/摘要、原件不可变、附件编辑人不能审核、过账后拒绝上传、红字继承。文件字节使用本次内存存储适配器，不是线上文件服务验收 |
| 同一 core-port runner 的结构化导入用例 | 通过 | sheet/row 留存、错误批次不可改写、6 路重试、跨批同来源凭证防重、第二张凭证日期失败导致整批回滚、只生成草稿及独立审核过账 |
| `playwright test --config tests/browser/three-core-port.config.ts` | 7 通过、0 失败 | 核销 ID/revision/精确金额、8 域关账依据、版本化报表映射、辅助目录目标编码、目录/银行工作区及账套合同、multipart XLSX 暂存；HTTP mock 合同验证，不是业务事实验收 |
| `npm run typecheck` | 退出码 0 | 当前工作树全源类型；新增 BigInt 字面量不兼容现有 target 已修为 `BigInt(0)` |
| 定向 ESLint | 退出码 0 | 本轮 Finance/FBA 服务、API、UI、规则/集成/浏览器用例，以及 WMS 成本调整 |
| Prisma `validate` / `generate` | 退出码 0 | 使用显式禁用连接的临时 config，不加载根 `.env`；未对既有库执行操作 |
| `python3 scripts/wimoor/three-core-coverage.py` | 99 行、源 DDL 99/99、模型名称缺失 0 | 26 TARGET_REUSE、73 PARTIAL；所有 `fullSourceParityVerified=false`。代码映射不是字段逐项对等证明 |

上述规则运行后，仅将导入纯规则中的 `0n` 改为 `BigInt(0)` 以遵从当前 TypeScript target；对应 2 项导入规则再次通过，类型及 lint 重新通过。完整迁移链实际验证包含 `20261207010000_finance_auxiliary`、`20261208010000_finance_attachments`、`20261209010000_finance_voucher_import`。

## 本次持续工作前段已运行的回归

- `node scripts/test-wms-core-offline.mjs`：数量、冻结、库位、调拨/海外、耗材、成本/缺价、追加成本调整、不可变证据、并发和作用域通过。
- `node scripts/test-three-core-offline.mjs --events`：临时 PostgreSQL + Redis，BullMQ 真实消费失败回滚、12 并发及队列丢失重建通过。
- Amazon Inbound、Ads Reporting/同步、财务/报表副本相关规则 70 项通过；未触发真实请求。
- `node scripts/test-fba-local-offline.mjs` 与 `--browser`：本地计划/预占、双人审批、装箱、货件关联、运输/报关/费用、来源到正式总账及两会话浏览器回归通过。新增财务面板后 `--browser` 再次执行，结果以本记录最后补充为准。

## 隔离方式与未运行项

runner 不加载根 `.env`，只传白名单环境与合成身份。容器使用随机名称/标签，限定资源、仅 loopback 随机端口；preload 拒绝 dotenv 与外网/TLS/DNS。清理只针对本次创建且已核实标签的资源。附件集成使用内存文件字节；没有向现有 uploads/S3 写文件。

本轮新增共享 Prisma 模型、约束及文件证据保护触发器，已在空临时库验证迁移顺序。保留现有租户、ProductRecord、权限及业务流水。未修改公共 Layout/导航；无需套用导航性能基线。为避免将其他在途模块纳入本次业务证明，采用相关规则/隔离 PostgreSQL/HTTP/浏览器/定向 lint + 全源类型检查，未运行完整 `check:fast` / `check` 或生产构建。准备合码前须完整 `check`，生产构建沿 CI 发布流程。

未执行既有数据库迁移、历史数据导入、真实 Amazon/Ads/货代/海关请求、注册 Worker 启动、部署、备份或 Git commit/push。

## 尚未覆盖的业务能力

- Inbound 完整在线写请求/回读恢复适配器、真实标签/配额来源及正式报关模板仍未接通。外部未知结果记录仅支持人工登记与独立核实，不代表发生了远程请求或自动恢复。
- 估值、汇兑、法定报表和关账制度由目标端明确配置；未配置不补默认会计结论。成本调整已追加留痕，不宣称完整移动加权平均及跨期已售成本重算。
- 关账的 8 域证据是独立人员声明，`automaticExternalReconciliation=false`；不能证明所有外部来源完整或已经自动对账。Amazon/Ads 账单自动入账、银行自动对账未接通。
- 导入支持目标结构化 JSON 行和严格文本 XLSX；报表有受限精确四则公式；没有把所有源 Excel 样式、全部报表公式/样式或历史导入宣称为已完成。附件追加保留，不提供删除历史凭据操作。
- 每日库龄持久化快照/默认关闭的调度、FULL/SAMPLE/有依据的 ACTIVITY 和盲盘已补；销售窗口滞销/跌价准备、源全部盘点打印仍有差距。具体按 [覆盖清单](../../docs/wimoor-integration/three-core-current-coverage.md) 逐项标记。

## 最后回归结果

新增辅助/附件/导入面板后再次运行 `node scripts/test-fba-local-offline.mjs --browser`，退出码 0。实际临时库与两会话 Chromium 覆盖：采购/仓库/FBA 实物闭环、费用规则独立复核、从已复核 FBA 来源映射为正式凭证草稿、刷新后回读及总账不重复。此次不再把前轮浏览器结果代替当前代码结果。附件字节仍仅由单独的内存适配器集成测试证明，未验收生产存储。

最终 `npm run typecheck`、定向 ESLint 和 `git diff --check` 均退出码 0；未跟踪的本轮源/测试/迁移/文档另查末尾空白及本地相对链接。当前 GitHub、服务器均未同步。

最终补查验证：辅助审核保存规则/维度快照，过账按审核版本比对，后加必填规则不会使不可修改的已审核凭证搁置；临时库用例已覆盖。证据摘要按 JSON 值递归规范对象键顺序，避免 PostgreSQL JSONB 排序造成误冲突；新增纯规则覆盖键顺序等价、数组顺序差异和字符串/数字类型差异，最终 97 项通过。上述改动后的 core-port、类型、lint 和浏览器回归重新运行。


## 本次补齐后的最终验证

- 相关纯规则合计 **102 通过、0 失败**；新增银行有符号金额、严格文本 XLSX/公式拒绝、受限报表公式。公式模板持久化后重新读取的结构问题已修复，并在临时库实际创建/审核/计算通过。
- `--core-port`：目录币种/独立汇率复核、精确换算、科目分类；过账派生银行日记账、账单冲突、6 路匹配重放、独立核实、跨工作区拒绝、不可变账单和冲销保护均通过。导入测试显式按 lineNumber 排序，不依赖无排序数据库结果。
- WMS 临时库：完整迁移保留既有仓库/库位，34 张 Wms 目标表；FULL/盲盘/ACTIVITY、5 路当日快照捕获唯一结果、不可变证据、跨工作区隔离通过。默认关闭的调度、显式启用、并发领取一次、停用扫描、执行人停用后 RETRY/错误证据通过；没有启动真实 Worker。
- 界面 fixture 合同 **7 通过、0 失败**；本次 `test-fba-local-offline.mjs --browser` 退出 0，临时库+两会话浏览器覆盖已有采购/WMS/FBA/总账交接，未向 Amazon 发请求。
- 使用临时禁用连接 config 的 Prisma validate/generate 通过。此次完整临时迁移包含目录/银行/快照和库龄计划两个新增迁移；未迁移现有数据库。
- 全源 typecheck、定向 ESLint、git diff --check 与覆盖证据生成通过；GitHub/服务器未同步。完整 check 与生产构建仍留在实际准备合码/发布时执行。

银行匹配为人工独立确认；快照是当前库存周转估计，不代表批次真实库龄、销售窗口完整性或跌价准备。新增内容不改变逐表证据的 `fullSourceParityVerified=false`。


### V2 源目录补查与方案证据

补查独立 `inboundV2/pojo/entity` 的 TableName 注解后，覆盖清单新增 21 行，合计 **99 行 / 98 个不同表名**（旧索引含跨范围重复项）。99 行均找到源 DDL，26 TARGET_REUSE、73 PARTIAL；源实体路径/哈希与 DDL 列证据可追踪。该数字不能替代原稿 38/30/46 表清单，也不能证明全部字段已移植。

新增 `20261210030000_fba_workflow_options`，保存 PACKING/PLACEMENT/TRANSPORTATION/DELIVERY_WINDOW 原方案内容与 ID、Operation 来源、观察/有效时间及独立选择。方案来源为人员提供的外部证据；没有验证成最新 API 回包，没有发送确认请求。单计划最多 10 份、单份最多 50KB；列表只读元信息，原内容按需重新授权读取，避免列表放大。

最新 core-port 临时库回归通过 6 路重放、防覆盖、自审/自造方案拒绝、工作区隔离、真实授权读取、不可变快照/选择以及实物流不变。新增界面用例验证按需读取和 plan revision 提交，界面合计 **7 通过**；相关纯规则最新合计 **102 通过**。完整 typecheck 与 FBA 定向 lint 重新检查，未使用旧覆盖数字代替本次验证。

## 合并完成后的当前验证（2026-11-12，替代上述历史数字）

当前授权为本地结构/关联/流程及隔离验证，用户不再要求分阶段停点。目标制度保持配置；根 `.env`、现有数据库、真实 Amazon/Ads 与 Worker 运行态均未被执行或改写。

本次最终验证：

- 相关 `tests/{fba*,finance*,wms*}.test.ts`：**113 通过、0 失败**。使用只含 PATH/fixture 标记/禁用端口数据库 URL 的环境和阻断 dotenv/外网的 preload；没有连接数据库。涵盖协议/映射、错货件方案、确认前后装箱、风险/报关/汇兑及既有金额与状态规则。
- 界面 fixture：`three-core-port.config.ts` **10 通过**，另 `fba-customs.config.ts` **1 通过**、`wms-risk.config.ts` **1 通过**。断言当前账套/期间/工作区、plan revision、独立选择、精确金额和仅保存草稿不自动排队/过账。
- `node scripts/test-three-core-offline.mjs --core-port`：完整空临时库迁移链、来源/凭证/往来/报表/关账及当前 FX/FBA remote 全通过。新增真实账套锁等待期间发布来源修订时拒绝旧摘要，直接调用服务的停用/撤权拒绝；远程 6 路只提交一次、异步操作相关性、过期 poll 租约恢复、未知结果不重发、同步 Void 成功、逐行标签范围及同步响应加密回读通过。标签 URL 仅合成 fixture，未下载文件。
- `node scripts/test-three-core-offline.mjs --events`：临时 PostgreSQL + 真实 BullMQ/Redis，库存与 Outbox 同事务、失败消费回滚、12 路并发、重建丢失队列及隔离收据通过。
- `node scripts/test-wms-core-offline.mjs`：完整迁移/既有仓库库位保留、35 张 WMS 目标表、库存/退回/调拨/盘点/库龄/风险/成本/海外装箱集成通过；默认关闭的调度未启动真实 Worker。
- `node scripts/test-fba-local-offline.mjs --browser`：当前全部迁移、FBA/WMS/财务 HTTP 集成、实际 Next 编译和两会话 Chromium 闭环通过。回归中纠正了新增 import 放在 `use client` 之前的问题；不能用类型检查或合成组件 fixture 替代这次真实 App Router 编译验证。
- Prisma validate 使用 `/tmp/codex-fba-wms-ledger-local/prisma.config.ts` 的禁用连接，退出 0。完整 typecheck、三域 service/相关组件及新 fixture 定向 ESLint、`git diff --check`、源表覆盖生成均通过。修复 customs declaration scoped unique migration 漏索引，当前三份新增迁移已在空临时库验证。

独立复核：财务与 FBA/WMS 互审指出的锁后来源版本、事务内 live permission、reviewer roster 锁、货件/方案对应及 packing/placement 阶段限制均已修复，并加入回归。没有遗留已确认的本轮 P0/P1；这不代表完整源字段 parity、生产安全审计或真人验收。

验证日志保存在本机 `/tmp/codex-fba-wms-ledger-local/continuation-{rules,ui,customs-ui,risk-ui,core,events,wms,fba-browser,types,lint,prisma}-final.log`（UI 汇总为 `continuation-ui.log`）。临时容器仅按本次身份标签清理；无真实迁移、Amazon 请求、Worker 启动、提交、推送或部署。完整 `npm run check`/生产 CI 构建在准备合码发布时执行，本次采用覆盖三域相关风险的类型/规则/临时库/HTTP/UI/事件/权限专项验证，不运行无关全仓检查。

仍待外部验收：真实授权/线上合同/配额来源；目标会计口径、货币项目和 Ads/结算重叠的完整性证据；正式国家/货代 XSD；真实银行/标签文件下载；源全部字段与历史资料迁入。99 行/98 不同候选表仍全部 fullSourceParityVerified=false，不把映射数或测试通过冒充全部源等价。

## 再次源代码核对与剩余结构验证

本节为上述113项/12项之后的追加结果，不将历史数据当当前验证。新增迁移040000、FBA读取投影、WMS日/月及海外费用、财务目录/月报/字段模板已经贯通现有入口。

- 当前三域纯规则 **121通过、0失败**，包括新增API合同混合拒绝、GET失败分类、源响应精度/分页、日/月边界/数量、海外箱行分摊。
- 最新完整 `--core-port` 通过；财务补充的最终独立core也通过。包括已有类别三级树迁移回填/四级显式阻断、目录/项目/账户生命周期与默认唯一、源字段凭证模板缺数/负数方向/独审/六路草稿去重、FBA只读失败及租约结束不阻塞新独审批动作、读取快照不可变/精确值/分页/库存不变。
- 完整WMS临时库迁移与集成通过，目标Wms表现为36张；新增海外费用六路创建、双人审核、原币层级分摊、预估差额、审核人撤权、HTTP、统一总账草稿六路去重，并断言库存和原成本不变。
- 三域界面合同 **11通过**（项目月报/来源凭证模板新增1项）；海外费用独立界面1项通过。既有风险/报关用例保持原独立证据，不重复算成本轮新增数。
- 完整typecheck、三域定向ESLint、Prisma validate与diff检查通过。源字段覆盖生成99行/98不同表名，无缺失模型；34 TARGET_REUSE、65 PARTIAL，仍不宣称全部源规则逐项等价。
- 库存来源的商品/批次/仓/数量/单价与正式分录行号已在不可变来源audit保存；本轮未新增独立库存辅助详情UI读回用例，不把其他凭证详情验收冒称这项覆盖。

FBA/WMS/财务新增结构经交叉只读复核未见可确认P0/P1；GET异常永久阻塞和Ads多API合同混合问题已实际修复并回归。日志前缀为 `/tmp/codex-fba-wms-ledger-local/remaining-`，财务最终core为 `/tmp/codex-fba-wms-ledger-local/finance-structure-core.log`，WMS为 `/tmp/codex-wms-period-integration.log`。具体真实浏览器最终结果见下一记录。

本轮没有启动真实Worker、迁移既有库、请求Amazon/Ads、提交推送或部署；目标会计/法定报关参数、源全部历史格式/公式、第三方真实执行与完整源parity仍不由本轮验证证明。
