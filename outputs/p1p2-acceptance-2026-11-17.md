# 条条 ERP P1/P2 独立验收（2026-11-17）

**总体：FAIL；冻结验收：BLOCKED；生产上线：BLOCKED。** 不能声明全部整改完成。本报告只针对唯一仓库 `C:/Users/jingbao12/Desktop/条条/woker` 当前磁盘代码。HEAD 为 `55d5c51affd503e641bc9aa7a5f023d6d0118b94`，工作树含大量 staged/unstaged/untracked 改动，全部保留。

## 证据和冻结边界

首先读取 AGENTS.md、git status 和原整改清单。自动任务历史 memory.md 不存在，未取得上轮自动验收记录；未将其他会话的历史测试、日志或完成声明作为当前通过证据。

进程查询被安全校验阻止，原提示为“Spawning a non-PowerShell shell ... bypasses command validation”。未绕过该拒绝或换命令重试。无法确认所有夜间整改任务已结束，故不能声称已取得排他冻结。本轮业务源码只读，无业务修补。验证前后对 src/tests/scripts/prisma/deploy 及关键配置共 **2373 文件 SHA256** 对比，变化 0、新增 0，证明的是本轮观测窗口磁盘稳定，不证明没有潜在写入者。

状态约定：PASS=本报告标明范围内取得当前证据；FAIL=明确残留；NOT VERIFIED=未覆盖；BLOCKED=环境/权限/冻结等外部条件阻断。源码静态 PASS 和注入/fixture 测试 PASS 均不代表真实业务或生产通过。

## 当前执行命令及结果

全部检查子进程仅保留 PATH/Path、SystemRoot、ComSpec、PATHEXT、HOME/USERPROFILE、TEMP/TMP/TMPDIR 等运行所需环境；不继承业务凭据或 NODE_OPTIONS。已先检查 package.json、typecheck、ui-guard、ESLint 配置及测试 runner；未运行真实任务和生产构建。

|命令/等价实际入口|数字退出码|结果|
|---|---:|---|
|pwd && git status --short|0|确认唯一仓库及保留全部改动|
|node scripts/runtime/typecheck.mjs|0|PASS；源码类型检查，incremental=false；排除可变 Next 构建产物，非生产构建类型门禁|
|node node_modules/eslint/bin/eslint.js .（npm run lint 的全仓入口）|0|PASS；0 error / 4 warnings|
|node scripts/runtime/run-unit-tests.mjs --test-concurrency=1 --test-reporter=tap（npm test 对应入口）|0|PASS；2266 tests / 4 suites / 2266 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo；约466.9秒|
|node scripts/runtime/ui-guard.mjs|0|PASS；未更新基线；font-bold 384→376，其余指标无增长|
|git diff HEAD --check|0|PASS；含暂存和未暂存的已跟踪差异；有 LF→CRLF 提示，无空白错误；不覆盖未跟踪文件|
|当前源码缺失观测表达式隔离复现|1|FAIL；2反例均违反缺失值合同，详见下文|
|进程/活动整改确认|无数字退出码|BLOCKED；命令执行前被安全校验拒绝，不伪造为1|

lint 四处警告：`src/components/operations/amazon-products-panel.tsx:19`、`src/components/sellfox/replica/replica-workbench.tsx:135` 为 img 性能；`src/lib/accounts/roster-auth-sync.ts:88` 未用变量；`tests/sellfox-credentials.test.ts:7` 未用导入。

### MJS 覆盖及安全限制

当前 runner 明确收集 tests 顶层 `.test.ts` 和 `.test.mjs`，转发 CLI 参数并使用环境白名单，加载仅注入 fixture AUTH_SECRET 的 test-environment.mjs。本轮全量实际包含六个 MJS 文件：amazon-sync-preflight、infra-runtime、mcp-db-isolation、mcp-isolation-route、product-api-runtime-isolation、unit-test-runner。不能重复相加用例，不能再沿用“npm test 完全漏掉 MJS”的旧结论。

MJS 的迁移/权限行为使用注入执行器、VM/内存客户端或临时 fixture，infra shell 使用替身函数及 bash -n；不等于真实 DDL、角色授权、主机账号操作。tests/integration、tests/browser 和 scripts 中独立集成 runner 不在本轮默认全量收集范围，均 NOT VERIFIED。未运行会读取真实配置的 integration 脚本。环境白名单并非操作系统网络沙箱，本报告不把它描述为全面网络封锁证明。

## 原清单 §2.1：账号权限逐项

|原条目|结论|当前证据及限制|
|---|---|---|
|database_admin 可授 owner|PASS（原漏洞）；一般角色上限 NOT VERIFIED|`src/app/api/accounts/team-members/route.ts:254` 非owner禁止分配owner/database_admin；没有据此证明所有自定义角色权限集合均受上限约束。|
|bootstrap/local-admin 硬编码永久 owner|PASS（静态）|`src/lib/accounts/team-roster-server.ts:61` 改显式配置保护清单；route 对无成员关系保护账号降viewer/disabled，不再仅凭固定ID恢复owner。|
|seed 重复重置密码|NOT VERIFIED|`scripts/seed-admin.mjs` 已有整改差异；本轮未取得独立逐语句/重复执行证据，不沿用历史通过声明。|
|roster 同步覆盖手工权限|PASS（静态）|`src/lib/accounts/roster-auth-sync.ts:79,92,124` incremental保留登录名和状态，membership update为空；manage为显式管理员写入，区别后台同步。|
|未映射module默认允许|PASS|`src/lib/accounts/permissions.ts:109,118` 两个判定均在module缺失时false。|
|硬编码AUTH_SECRET回退|NOT VERIFIED|本轮测试使用独立fixture密钥，未把fixture设置当生产密钥证明；真实环境配置未读。|
|多组织首条与全量登录权限地图|NOT VERIFIED|涉及`src/lib/auth/session.ts`、`src/app/api/auth/login/route.ts`；单测通过不能替代本轮逐链组织选择检查。|
|权限cookie一年、无Secure/HttpOnly|FAIL（原清单未完全满足）|`src/lib/auth/session.ts:50,202` 已缩短至1天、使用secureCookie，但该UI权限快照cookie仍未设置HttpOnly；认证cookie本身有HttpOnly。UI快照不是服务端授权凭据，不能据此声称已证实鉴权绕过。|
|账号锁定/限流边界|PASS（静态+全量回归）|`src/lib/auth/login-rate-limit.ts:19,47,60,72` 账号全局桶、>=边界、哈希账号告警已存在；真实Redis并发/故障未验。|
|MCP/Lili跳过cookie的bearer/OAuth审计|NOT VERIFIED|协议入口需逐项核对当前bearer/OAuth及审计链；本轮未完成所有高权限端点覆盖，不能仅凭middleware白名单下结论。|
|Sellfox共享令牌默认开启|PASS（静态）|`src/lib/sellfox/mcp.ts:68` 按provider token查个人持久凭证，校验ACTIVE/到期，返回storeScope；原共享全局令牌分支已不在该认证函数。真实凭证撤权未联调。|

## 原清单 §2.2：隔离逐项

|原条目|结论|当前证据及限制|
|---|---|---|
|非JSON content-type绕过body scope|PASS（当前入口）|`src/lib/auth/api-permissions.ts:84` 非multipart不依赖content-type解析JSON，校验body/context/query/header全部选择器；multipart校验前缀并由上传入口在副作用前校验form。非法JSON交路由处理不等于合法JSON绕过。|
|request可选漏校验|PASS|同文件55行必传Request，运行时也拒绝缺失、已消费或锁定body。|
|请求缺workspace静默default|PASS（request入口）；URL helper调用方 NOT VERIFIED|`src/lib/workspace/scope.ts:62` request最终requireWorkspaceId=true；normalize/URL helper仍允许本地default，本轮未证明所有服务端调用方都用强制入口。|
|通用工作区成员隔离|PASS（本地实现）；实库BLOCKED|`src/lib/workspace/access.ts:8` 同时校验组织工作区、真实成员与active状态；owner例外，其他用户必须workspaceMembership。新表迁移未在本轮实库执行。|
|双池角色两套命名与审计|NOT VERIFIED（全链）；离线测试PASS|六MJS包含mcp-db-isolation和mcp-isolation-route并通过，但本轮未逐条独立检查所有SQL/部署命名；真实角色有效权限必须另验。|
|双池授权真实生效|BLOCKED|未连接实库、未执行grant/revoke；离线SQL及注入探针不证明跨池SELECT已被数据库拒绝。|
|Amazon只读池回退主连接|PASS（静态）|`src/lib/amazon-sync/local-raw-read.ts:28` 缺独立只读DSN抛503，不回退主连接。|
|权限多来源和DB故障宽松回退|PASS（当前检查边界）|`src/lib/accounts/role-catalog-server.ts:70,106` DB故障返回空授权，事务读复用organizationRosterRole；`src/lib/sellfox/credential-store.ts:25,40` 使用带scope凭据和同一角色权限读取。非生产无DATABASE_URL仍有local-default开发路径，不是实库故障回退；其所有调用方未穷尽。|
|finance文案与权限不符|PASS（静态）|`src/lib/accounts/role-definitions.ts:175` 注释与view/export对齐，不能宣称页面实际所有按钮均完成验证。|
|通知权限双轨|PASS（单一权限来源）；view动作一致性NOT VERIFIED|`src/app/api/notifications/user/route.ts:53` 复用authorization-context；仍调用roleCanAccessModule，并未统一为具体view动作，不能判完整动作合同已收口。|

## 原清单 §2.3：真实性逐项

|原条目|结论|证据|
|---|---|---|
|销售计划完整性与null链|NOT VERIFIED（完整专项）|`src/lib/ext/sales-plans.ts`、nullable迁移及组件已存在，全量包含对应测试；本轮未独立核对所有SQL完整性条件，不用历史专项目录声明替代。|
|采购发票缺金额补字符串0|PASS（静态+当前回归）|`src/lib/procurement/invoice-service.ts` 缺amount及无invoicedRow保留null；`remediation-data-null.test.ts:13` 对应断言本轮通过。|
|商品采购价/重量/尺寸缺失|NOT VERIFIED（完整UI链）|`src/components/products/product-workbench-data.ts`、`product-workbench-fields.tsx` 为本项核对入口；商品服务MJS回归通过不替代所有字段到UI链验收。|
|sync-center在途总量|FAIL|`src/components/operations/sync-center-workbench.tsx:393` 过滤缺分项后求和。当前源码抽取函数在VM执行输入working=3/shipped=null/receiving=2，输出'5'，应未知'—'。反例退出1。|
|adjustment-table指标/竞价|FAIL|`src/components/workspace/adjustment-table.tsx:806,816,826,832` 无performanceRow时CTR/CPC/ACOS传0，缺当前竞价仍??0。抽取现行CTR表达式、performanceRow=null实际0，期望null，反例退出1。|
|税务汇总缺失补0|PASS（当前断言范围）|`tax-workbench.tsx` 缺值显示无数据，当前五类summary补0禁用断言通过。|
|研究未知错误被吞为404|PASS（当前断言范围）|`src/lib/selection-research/server.ts` 仅RESEARCH_NOT_FOUND映射404，其他cause重新抛出；对应当前测试通过。|
|广告库存缺日均花费推导上限|NOT VERIFIED（独立业务链）|`src/lib/ads-inventory/constraint.ts` 回归包含在全量，但本轮未独立复核全部推导输入与UI合同。|

**测试盲点**：`tests/remediation-data-null.test.ts:27` 仅排除部分字段的`??0`，未覆盖比率的三元表达式；34行用源码字符串断言接受“只对存在的在途值求和”，没有验证部分缺失时总量必须未知。全量2266通过并不能推翻两个反例。未放宽断言，未以Mock数据作为真实业务数据。

## 原清单 §3.1：冗余/双方案逐项

|原条目|结论|证据及边界|
|---|---|---|
|readiness/compatibility freshness双实现|NOT VERIFIED|`src/lib/amazon-sync/compatibility.ts:4,30` 仍保留兼容聚合，但复用emptyDomainFreshnessSummaries；独立用途与可删除性须按实际调用链核完，不能凭Legacy注释判冗余已清完。|
|退役同步函数仅throw|PASS（搜索）|当前src内无requestAmazonSync/validateAmazonConnection匹配。|
|同一账号重复校验|NOT VERIFIED|compatibility.ts:32先amazonAccountReadAccess，后listSources/publishedSnapshotScopes传actor；须检查下游是否再次相同鉴权及其必要性。|
|积分汇总复制|PASS|`src/lib/points/summary.ts` 单一computePointsPeriodQuotaFields供两处调用，当前冗余行为测试通过。|
|token hash复制|PASS|`src/lib/mcp/token.ts` 唯一mcpTokenHash，Amazon/Sellfox引用/重导出同一函数。|
|workspace历史双键|PASS（当前回归）|`tests/remediation-redundancy.test.ts:35` 旧键无回退，新键不受旧键干扰，当前全量通过。|
|隔离panel共享令牌与个人凭证并存|NOT VERIFIED|服务端个人认证已检查，但本轮未完整核对panel输入/调用链。|
|Card/Section双底层|PASS（静态职责）|`src/components/ui/card.tsx:3`与section.tsx共同复用surface；保留有调用方UI组件不等于两份底层实现。|
|旧研究费用gate|NOT VERIFIED|须核对`src/lib/lili/research-tools.ts`及research-workbench生产者/消费者，未用无匹配词搜索当完全删除证明。|
|结算字段优先级双口径|NOT VERIFIED|`src/lib/amazon-sync/settlement-allocation-mapping.ts` 当前调用链未独立复核。|
|PPC双重兜底|PASS（当前测试范围）|`ppc-normalization.ts` 数值函数和活动组正规化回归本轮通过；不代表所有广告缺失值均安全。|
|商品summary未用source/纯复制包装|NOT VERIFIED（原条目全量）|当前`product-list-summary.ts:103`仍有有业务source选择用途的映射，不能仅见字段复制即判死代码；原包装调用者应再逐个对照。|
|chain-handoff旧交接分支|NOT VERIFIED|`src/components/agents/chain-handoff.tsx` 本轮未完成分支来源/依赖核对。|

## 原清单 §3.2：职责拆分

下列行数是当前磁盘split换行统计，含末尾空行。行数下降本身不是通过标准。

|对象|本地结论|当前状态|
|---|---|---|
|商品API handler|PASS（边界拆分）|142行；独立product-list-service/query-builders/repository和product-write-service，MJS真实service注入回归纳入全量。|
|Amazon processor|PASS（资源拆分）；内部函数尺寸NOT VERIFIED|359行；returns/orders/order-detail/finance/settlement/reports/domain-reports/snapshot/observation等独立资源模块。调度器保留统一授权、租约、控制与发布；不是只抽小工具。资源内部超长函数仍需单独审视。|
|PPC/Market/Listing/Supplier Agent|PASS（模块边界初步）|当前主文件182/316/186/187行；已分出catalog/contracts/tools/evaluations/normalization/reporting等；全部业务分支是否等价仅限当前回归覆盖。|
|六个Agent全部拆完|FAIL|`src/lib/agent-platform/orchestrator.ts`仍1107行；没有证据证明原“六个同构文件”逐个全部完成，不能拿四个已拆文件代替六个。|
|Listing AI|PASS（工作台主职责迁移）；完整内部拆分NOT VERIFIED|主文件150行、主hook266行，独立文本生成、持久化、图库导入导出和视觉section；不是仅缩短入口文件。|
|Product Workbench|PASS（已分出工作台/编辑器等）；组件阈值仍需审视|主文件153行、编辑器395行，独立list/export/revision-conflict/附件/工作流hooks与form；不按主文件行数声称所有子模块已完成。|
|workspace store|PASS（slice边界）|入口20行，独立bulk-import/campaign/overall-ad-data/persistence/rules-drafts/state；不是把原store整体改名搬走。|
|ext service|PASS（领域拆分）|入口11行，独立sales-plans/tax/channel/dictionary/procurement/repricing/review-performance等模块重导出。|
|Agent execution route|PASS（职责拆分）|130行，独立context/runtime/platform-executor/persistence。|
|Logistics补充整改|FAIL（完整拆分未完成）|`src/components/logistics/use-logistics-workbench.tsx`405行，另有31行tables helper；摘要/筛选等小工具抽取不等于上传解析与多个导出完整生命周期拆分。|
|原Top20完整明细|NOT VERIFIED|原清单附录B确认缺失原始明细；未编造其余排名与覆盖率。|

原清单附录A的25条原始明细及“约100条证据”原始输出也不可追溯，本报告仅覆盖正文可识别条目，未称全部原始证据已经逐项验完。

## 生产外部阻断

1. 冻结：活动整改进程检查受阻；SHA窗口稳定不替代任务结束/候选冻结确认。
2. 数据库：WorkspaceMembership迁移、观测字段DROP DEFAULT、销售计划nullable等仅离线文件；真实数据库版本、迁移历史、数据兼容、恢复、双池角色有效权限均未验，未执行DDL。
3. 基础设施：专用非root账号、web/worker最小DB角色、迁移身份、systemd/ACL必须实机核验；fixture脚本通过不能代替上线。此轮未重新检测Docker，不把历史缺失日志当当前探测。
4. 性能与业务：本轮没有新fixture性能基线/P50/P95对比、真实Redis并发、故障恢复、双会话/完整E2E或用户本人业务验收。
5. 构建发布：未启动本机生产构建；生产构建、打包、artifact校验只能走CI流程，尚无当前候选CI证据。未提交、push、stash、reset、部署、重启或启动真实任务；GitHub/服务器未同步。

本地代码验收表示指定代码与隔离用例取得证据；生产可上线还必须消除明确FAIL、补齐未覆盖、冻结候选、完成隔离数据库/性能及用户验收，并经批准执行CI artifact发布。当前两者均不能宣称全部通过。

## 交付证据

- `outputs/p1p2-acceptance-20261117-unit.tap`：当前完整单测TAP。
- `outputs/p1p2-acceptance-20261117-{typecheck,lint,ui-guard,diff-check}.log`：门禁日志。
- `outputs/p1p2-acceptance-20261117-missing-observations.log`：两个现行代码反例及失败值。
- `outputs/p1p2-acceptance-20261117-source-snapshot.json`、`outputs/p1p2-acceptance-20261117-stability.json`：代码指纹与稳定性对照。
