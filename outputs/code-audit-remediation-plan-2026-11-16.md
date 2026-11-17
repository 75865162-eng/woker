# 条条 ERP 代码审计与整改计划

> 生成时间：2026-11-16　审计范围：`src/`、`prisma/`、`scripts/`、`deploy/`、相关 `docs/`
> 性质：**初始审计基线 + 持续整改记录**。下文问题证据描述初始审计时状态，行号可能随重构变化，不代表每项仍未修复。用户已授权处理全部 P1/P2，当前仍在实现及验收；未执行提交、部署或真实数据库 DDL。
>
> **2026-11-16 恢复验收核对（非全量完成声明）**：
> - 当前核对到的 HEAD 为 `600fb4e96516cb3bbcb7214d4002bb40aea00f0e`；存在已有及并行整改的未提交改动，全部保留。
> - `src/app/api/products/product-list-repository.ts` 已由占位文件填实；查询保留组织、工作区和 sourceRevision 关联。列表 service、保存边界与行为回归仍在验收，不能据此认定商品模块完成。
> - `src/app/api/operations/mcp-isolation/route.ts` 已接入共享 `src/lib/mcp/database-audit.mjs`，不再用主连接探针或 information_schema 可见子集声称隔离通过。主线程已补齐严格快照校验、构造连接异常捕获及同步清理失败保护；缺少权限布尔字段、缺失查询集合不再视为安全。独立联合执行 `node --test tests/mcp-db-isolation.test.mjs tests/mcp-isolation-route.test.mjs`：**14 tests / 14 pass / 0 fail**，涵盖本池空表、未知权限、错误身份、跨池读取、构造异常不泄密、HTTP body/context 跨作用域拒绝及缺角色健康文案；使用注入客户端，未连接真实数据库。
> - 类型检查 wrapper 静默返回不能单独作为完整验收证据。主线程改用 TypeScript 编译器 API 检查 **1901 个源码/脚本/测试文件**，取得明确 **43 条诊断、退出码 1**，已按现有文件归属修复缺失依赖、作用域类型、广告可空指标和测试夹具类型；当前全量类型检查**未通过**，须修复后重验。
> - 主线程独立联合执行 `api-permissions-workspace.test.ts`、`remediation-isolation.test.ts`、`multipart-workspace-routes.test.ts`：**61 tests / 61 pass / 0 fail**。八类上传入口覆盖 body/form、header、query 混合跨组织选择器及无副作用拒绝、合法 form 成功与作用域优先级。
> - 主线程独立执行商品空值、导出和广告库存约束三组回归：`ads-inventory-constraint.test.ts`、`system-health.test.ts`、`product-export-job.test.ts`，**38 tests / 38 pass / 0 fail**；包括真实持久化映射对缺采购价拒绝、真实零保留、历史缺价可读、XLSX 导入导出空白与零区分。新增 `ProductPurchasePriceValidationError` 实际错误类；对真实 `saveProductRecord` 注入属性访问即失败的事务 Proxy，证明 null/NaN/Infinity 在任何事务属性访问前拒绝，访问计数为 0。HTTP service 的同类错误 400 映射与事务开启前校验仍由商品接口专项补验，不以存储层通过代替接口验收。
> - `deployment-readiness.test.ts` 隔离子进程显式使用 `NODE_ENV=test`，未扩大环境白名单或放宽断言。首次整文件 **7 pass / 1 fail**（迁移完整历史正例），随后纯函数与单项通过；补充失败详情后再次运行完整文件 **8 tests / 8 pass / 0 fail**。此前失败根因尚未证明，仍须在统一全量验收观察，不能称其已证实只是抖动。
> - 前后端大文件职责拆分、商品 null 链、旧兼容与凭证来源、上传作用域合同仍有进行中项；最终 typecheck、lint、全量测试须待代码稳定后重新验收。
> - 数据库授权 SQL 仅准备和离线检查，不等于数据库隔离已实施；真实授权、双身份实库审计和部署均未执行。
> - 后续独立验收：`product-api-runtime-isolation.test.mjs` **6/6**，执行真实 list/write service，覆盖命中缓存后的实时授权、作用域、事务失败无事件/缓存副作用、提交后事件及缺采购价在事务前拒绝。
> - 工作区恢复补齐 cleanup、重初始化、恢复取消与 clear 代次围栏。新增行为测试揭示 repository 将读取异常吞为“无快照”的问题，已移除；未授权写入/删除不再假报成功，草稿历史读取失败不再冒充空历史。`workbench-state-behavior.test.ts` 最新独立 **7/7**，覆盖取消旧恢复、待保存清理、失败恢复禁止自动覆盖存储、延迟清空不能覆盖新作用域、401 拒绝，以及商品空值/UI 原语行为。全仓类型及大模块拆分仍须继续验收。
> - Returns 已按完整资源生命周期拆出 `src/lib/amazon-sync/returns-processor.ts`（230 行）；processor 从该批 2097 行降至 1904 行。共享租约、实时授权、暂停和 fence 仍由调度器注入；时间匹配函数保持唯一实现。主线程独立联合执行退货资源/解析与工作区状态三文件 **32/32、exit0**，包含创建不确定结果不重放、跨租户拒绝、暂停、分批同事务检查点和末批发布。该证据为注入边界测试，不等于真实数据库事务/真实 API 验收，processor 其余资源仍未完成拆分。
> - 本批最终 TypeScript 编译器 API 全仓验收：**1914 文件 / 0 诊断 / exit0**（禁用仅影响缓存的 incremental，不放宽 strict 等类型规则）。修复环境夹具只读类型与白名单子进程 NODE_ENV 合同；PPC 不再为必需观测字段补 0 或默认竞价 0.2，null/空白/布尔值明确拒绝，真实零与数值字符串保留，可选派生指标保持未知。主线程独立 `ads-data-truth`、`ppc-agent`、`auth-boundaries`、`release-runtime` 四文件 **26/26、exit0**。这不替代最终全量测试、性能和生产验收。
> - 全仓 ESLint 实扫 **1976 文件 / 0 错误 / 7 警告**；其中本轮拆分遗留的 5 个未使用导入/参数警告已最小清理，相关 4 文件复验 **0 错误 / 0 警告**，商品运行时行为再次 **6/6**。剩余两处 `<img>` 性能建议位于 `amazon-products-panel.tsx` 与 `replica-workbench.tsx`，本批未改其图片加载合同。`git diff --check` 已通过，未执行 commit/push/部署。
> 分级口径：P0 = 安全/数据正确性红线，须在下次发布前修完；P1 = 结构性隐患，本迭代内排期；P2 = 可维护性债务，按容量推进。

## 2026-11-17 本轮续修与实际验收

本轮在已有未提交整改基础上继续实施，不能把原始审计证据、历史测试或文件行数当作当前完成证明。

- 数据真实性：小时广告新增必需观测字段校验，缺失拒绝写入；组装缺成本在任何业务写入前拒绝；绩效指标拒绝缺失及不安全整数；研究读取只将明确不存在映射 404，未知故障保留 500；库存聚合保留 null，缺任何在途分项不补零。
- Schema 去掉小时广告五列、绩效快照六列的不当默认值。离线迁移为 `prisma/migrations/20261217010000_remove_observation_zero_defaults/migration.sql`，仅 DROP DEFAULT，未执行；历史已写入的零不能可靠反推为缺失，未自动清洗。
- 冗余清理：商品 summary 移除纯复制包装，复用现有单一查询合同；PPC 重复数值兜底删除；研究费用仅保留当前显式审批/扩额路径，清理已无当前生产者的旧费用 gate；平台执行器无模型调用的路径不再记录虚构 tokenUsage=120，改为实际零。
- 职责拆分：Amazon 报告/快照生命周期继续拆出独立处理模块，调度器仍持有租约、授权、控制、fence 和发布边界；商品工作台拆出 `use-product-editor.ts`，编辑会话 hook 当前约194行，主文件当前约796行，未完成所有大文件拆分。中途曾汇报的552行不代表最终磁盘状态。
- 角色导入修复中文及复合角色归一化；账号行为测试补齐真实成员事务辅助函数注入和新建用户显式密码输入。成员事务辅助函数保持原有原子写入语义，不放宽新用户密码校验。

本轮主线程实际验证：

- 全量初检 2144 项：2132 通过、12 失败；第二次全量 2175 项：2166 通过、9 失败，失败集中账号测试。后续修复后的独立账号安全/角色复验 **27/27**；未再跑第三次完整全量，因此不声明最终全量全绿。
- 最新数据真实性、冗余、同步拆分、工作区状态、供应商与平台执行器九文件联合复验 **69/69**；商品服务/同步/状态等六文件独立复验 **42/42**；MCP 双池离线审计 **14/14**。这些集合存在重叠，不相加冒充独立用例总数。
- 最新 `npm run typecheck`、`npm run ui:guard` 通过。最终全仓 lint **0错误、2个既有 img 性能警告**，拆分遗留未使用导入已清理；`git diff --check` 通过。
- `performance:dev` 新基线实际尝试因 Docker 命令 ENOENT 在镜像检查阶段失败，未创建容器；本轮无有效性能基线/对比，不以历史日志替代。

后续追加：`src/lib/sellfox/credential-store.ts` 的带作用域解析不再回退全局环境凭据；无记录状态为 none，首次保存不再继承环境 secret。主线程以不继承业务凭据的子进程联合执行 Sellfox 凭据、账号安全及角色三文件，**34/34通过、exit0**。明确无作用域调用仍须按实际调用链继续核验，不能以此声明所有凭据来源已收敛。

仍未闭环：通用 ERP 工作区成员级隔离没有落地，现有组织级工作区校验不能冒充成员隔离，Amazon seller 数据 grant 不能直接当成通用工作区 membership。双池数据库角色授权仍未在实库实施；凭据旧来源收敛和剩余大文件职责拆分须继续逐项核验。未进行真实数据库迁移、授权、任务启动、部署、commit 或 push。

## 2026-11-17 09时独立验收追加

**总体 FAIL；冻结与生产 BLOCKED。** 本轮只读业务源码；活动进程查询被安全校验拒绝，未能证明所有整改任务结束。2373个源码/关键配置文件验证前后SHA256无变化、无新增，不能替代排他冻结。当前HEAD `55d5c51affd503e641bc9aa7a5f023d6d0118b94`。

本轮白名单环境重新执行：typecheck exit0；全仓ESLint exit0（0错误/4警告）；TS/MJS完整串行单测2266/2266、0失败/跳过、exit0；ui:guard exit0；git diff HEAD --check exit0。默认runner现已纳入六个顶层MJS文件，不再沿用漏收MJS旧结论。没有生产构建、真实DB/API、DDL、部署或Git同步。

独立抽取当前源码表达式复现两项缺失观测反例，联合exit1：`src/components/operations/sync-center-workbench.tsx:393` 在途分项3/null/2返回5，应未知；`src/components/workspace/adjustment-table.tsx:806,816,826,832` 缺performanceRow仍给比率0，缺当前竞价仍补0。现有`tests/remediation-data-null.test.ts`字符串断言未覆盖这两个结果。未放宽断言、未并发改业务文件。

商品API、同步资源、store slice、ext领域等已有实际拆分；`agent-platform/orchestrator.ts`仍1107行，Logistics主hook405行且只抽31行工具不能代表完整上传/导出生命周期拆分。权限快照cookie缩为1天并加Secure条件，但仍无HttpOnly，原清单未完全满足；不将UI快照风险误报为已证实服务端鉴权绕过。原始25条/Top20完整清单缺失，其他未逐链核实项如实NOT VERIFIED。完整逐项结论及命令日志见 `outputs/p1p2-acceptance-2026-11-17.md`。实库迁移/双池角色/最小运行身份、性能、CI artifact及用户业务验收仍需独立完成。

## 0. 结论摘要

审计 5 个维度（冗余/双方案、大文件、权限隔离、账号权限、兜底/死代码），共收集 **约 100 条带行号证据**。真正的红线集中在两类：

1. **账号与凭据安全**：明文密码字段经 API 和导出文件外泄；公开注册接口首人自动成为超管；6 个生产服务全以 root 运行并共享超级数据库账号；内置弱默认密码且无强制改密。**这四条任意一条都足以否决生产发布。**
2. **数据真实性**：多处把「未观测/未同步/缺字段」的金额、广告消耗、库存补造成 `0` 或编造 sentinel（如 `acos=999`），直接违反「缺失保留 null/NEEDS_DATA，不补造零值」的硬约束；生产 `/amazon-ads` 页面无隔离地直接使用 mock 数据。

权限隔离的**租户级（organizationId）过滤实际是存在的**——`buildAdsEntityWhere` 等查询均带 organizationId + workspaceId 双过滤。真正缺口在**工作区成员级隔离**和几个鉴权契约漏洞，不应误报成"全无租户隔离"。详情见 §3。

认证核心实现是扎实的（scrypt 密码哈希、fail-closed 限流与权限 catch、AES-256-GCM 凭据加密、密钥未入库），这些**不要动**。

---

## 1. P0 — 发布前必须修完（安全与数据红线）

### 1.1 明文密码外泄（最高优先级）
- `prisma/schema.prisma:314` — `TeamRosterMember.password String?` 是明文密码字段。
- `src/app/api/accounts/team-members/route.ts:44,216-219` + `src/lib/accounts/team-roster-server.ts:47` — `toAccountRecord` 把 `member.password` 直接放进 GET 响应。任何持 `accounts:view` 的账号可读全员明文密码。
- `src/lib/accounts/account-workbook.ts:13,92,103-114` + `src/components/accounts/account-workbench.tsx:514-517` — 导出 xlsx 把「密码」作为固定列批量导出。
- **整改**：移除 roster 的明文 password 列（或彻底停用其写入/读取/导出）；登录统一走 `User.passwordHash`（scrypt）。导出列删除 password。此项涉及数据迁移，需单独批准，禁止直接 reset/清库。

### 1.2 公开注册首人自动成为 owner
- `src/app/api/auth/register/route.ts:72-77` + `src/lib/auth/constants.ts:8` — `/api/auth/register` 在公开白名单；`existingMemberCount === 0 ? "owner" : "viewer"`。组织为空时首个注册者拿到全超管。
- **整改**：生产环境关闭公开注册（`AUTH_DRIVER=database` 下由运维 seed 建账号），或注册一律降为 `viewer` 并经审批提升；owner 只能由 seed/受控流程产生。

### 1.3 生产服务全员 root + 共享超级数据库账号
- `deploy/systemd/*.service`（web + 5 个 worker，如 `amazon-web.service:22`、`amazon-worker.service:20`）— 6 个单元全部 `User=root`，共用 `EnvironmentFile=/opt/amazon-ad-bulk-operation/.env`。
- `docs/architecture/upgrade-plan.md:298,459` — 文档自述 DATABASE_URL 是"能读写业务表的用户"、角色分离为待办。
- **整改**：拆分为专用非 root 运行用户；web 与 worker 按职责使用最小权限 DB 角色；MCP 只读账号覆盖不到主链路的问题一并纳入。属基础设施改造，需运维配合。

### 1.4 弱默认密码且无强制改密
- `src/lib/auth/constants.ts:28,36` + `src/lib/accounts/roster-auth-sync.ts:40-42` + `src/app/api/auth/login/route.ts:46-47,157-158` — bootstrap 默认 `"1"`、其余账号初始固定 `"12345678"`；全项目 grep 无任何 `mustChangePassword/forcePasswordChange/firstLogin` 机制。
- `src/lib/auth/ensure-user-record.ts:28-41` — 本地会话用户使用固定占位密码 `__local_session_placeholder__`。
- **整改**：首次登录强制改密；移除前端持有的默认密码常量；占位密码账号在切换到 database driver 前必须清理。

### 1.5 数据补零 / 编造指标（违反数据真实性硬约束）
严重级证据（精选，完整 25 条见附录 A）：
- `src/lib/sellfox/sync-service.ts:165-166` + `prisma/schema.prisma:1311-1315` — 小时广告指标 `cost/sales ?? 0` 落库且字段 `@default(0)`，未观测与真零不可区分。
- `src/lib/agent-platform/ppc.ts:970` — `totalAcos = adsSnapshot.metrics.acos ?? 0`，ACOS 缺失被当成"效率极优"。
- `src/lib/metrics.ts:12,22,60,93` — `acos` 在 sales=0 且 spend>0 时返回编造 sentinel `999`；聚合把缺失指标记为 0。
- `src/lib/wms/assembly-service.ts:89-91` — 注释说"避免成本为 0 让财务误判"，兜底却恰恰写入成本 0，注释与行为矛盾。
- `src/lib/ext/service.ts:355-360,43,527-528` — 绩效快照、重量、销售计划的目标额/单位成本缺失一律补 0 并通过校验。
- `src/lib/amazon-sync/compatibility.ts:14,17` + `src/lib/operations/readiness.ts:76-87` — `status: NOT_SYNCED` 却把四类库存数量全写 0。
- **整改**：金额/广告/库存/绩效字段一律改 `null` 或 `NEEDS_DATA`；schema 去掉不当 `@default(0)`；`acos=999` 改 null。参照已正确的实现：`sellfox/narrow-contracts.ts:4-9`、`amazon/inventory.ts:74-79`（缺失直接抛错）、`forecast/forecast.ts`。

### 1.6 测试数据进入生产页面
- `src/components/amazon-ads/ads-workspace.tsx:4,70` + `src/lib/amazon-ads/decision-demo.ts:24,28,38-41` + `src/lib/amazon-ads/mock-provider.ts` — 生产 `/amazon-ads` 页以 `mockAdsProvider.read()`、`demoAccounts` 为数据源，固定 `spend:80/sales:240`，无 NODE_ENV 或开关隔离。
- **整改**：生产构建中隔离 mock/demo 数据；无真实数据时显示 NEEDS_DATA，不展示编造数值。

---

## 2. P1 — 结构性隐患（本迭代排期）

### 2.1 账号权限安排
| 证据 | 问题 | 整改方向 |
|---|---|---|
| `src/app/api/accounts/team-members/route.ts:137-146` + `role-definitions.ts:145-152` | `database_admin` 有 accounts:edit，缺"不可授予高于自身角色"约束，可把普通账号提升为 owner 越级提权 | 加角色上限校验，禁止授予 ≥ 自身角色 |
| `src/lib/accounts/team-roster-server.ts:62-77` + route `:87-108,161-165` | `lockDefaultSuperAccount` 硬编码锁定 bootstrap/local-admin 为 owner+active，管理员无法降级或停用 | 改为受控配置，去掉硬编码不可撤销超管 |
| `scripts/seed-admin.mjs:58-71` | upsert 每次重设 admin 密码哈希，误调度会重置为已知值 | seed 改为"仅首次创建"，重复运行不覆盖 |
| `src/lib/accounts/roster-auth-sync.ts:83-115` | roster 同步覆盖已有用户角色/状态/登录名，权限边界随数据表漂移 | 同步只增量、不覆盖手工调整 |
| `src/lib/accounts/permissions.ts:106-125` | `moduleId` 为 null 时 `return true`——"未定义即允许" | 改 fail-closed（未映射默认拒绝） |
| `src/lib/auth/session.ts:205-221` + `src/lib/auth/constants.ts:35-37` | 非生产环境回退硬编码 AUTH_SECRET / 口令；误配可直接伪造会话 | 所有环境强制要求真实密钥，取消字面量回退 |
| `src/lib/auth/session.ts:136-146,152-165` + `login/route.ts:94` | 多组织用户取 memberships 首条，两处取法不一致；登录响应下发全量权限地图 | 统一显式选择组织；登录不下发完整权限配置 |
| `src/lib/auth/session.ts:205-221` | 权限 cookie 有效期 1 年，无 HttpOnly/Secure | 缩短有效期，加 Secure，权限以服务端为准 |
| `src/lib/auth/login-rate-limit.ts:19-25,45-51` | 无账号级锁定；`count > limit` 实际放行 limit+1 次 | 加账号锁定/告警；边界改 `>=` |
| `middleware.ts:81-96` | MCP/Lili 多个高权限端点跳过统一会话校验 | 确认各 bearer/OAuth 实现完备后加统一审计 |
| `src/lib/sellfox/mcp.ts:50-54,92-103` | 共享令牌 MCP_HTTP_TOKEN 默认开启，无店铺范围、无有效期 | 生产默认禁用共享令牌，强制个人凭证 |

### 2.2 权限隔离缺口
说明：`assertWorkspaceAccess`（`src/lib/workspace/access.ts:9-11`）查询带 `organizationId_id` 复合键，**organizationId 隔离是存在的**。真实缺口如下：

- **鉴权契约漏洞（未动态验证，须 PoC 确认）**：
  - `src/lib/auth/api-permissions.ts:40,66` — 仅当 `content-type` 含 `application/json` 才读取 body 中的 workspaceId 交给校验；非 JSON content-type 时 body.workspaceId 被忽略。
  - `src/app/api/ai-settings/route.ts:204-205`、`src/app/api/listing-ai/chat-history/route.ts:69-70` 等约 25 处 — 用 `request.json()` 无条件解析后 `workspaceScopeFromRequest(request, body)`，而 `src/lib/workspace/scope.ts:47` 优先取 `body.workspaceId`。
  - 两条组合可构成跨工作区写入链。**整改**：统一 scope 来源，workspaceId 只取已校验的可信值；对非 JSON content-type 同样校验；补动态 PoC 验证后再判定是否已被利用。
- `src/lib/auth/api-permissions.ts:17,38` — `request` 参数可选，漏传即静默跳过全部 workspace 校验。改为必传。
- `src/lib/workspace/scope.ts:7-11,20,47` — 无 workspaceId 时静默回退 `"default"`，可能造成隐式数据归集。改为缺失即拒绝。
- `src/lib/mcp/isolation.ts:52,67` vs `src/app/api/operations/mcp-isolation/route.ts:44,49,101-102` vs `scripts/mcp-isolation/grant-roles.sql:15,18,43` — 只读角色两套相反命名（`mcp_amazon_ro` vs `amazon_mcp_ro`），审计 SQL 只查后者，会永远误报。统一命名。
- `scripts/mcp-isolation/grant-roles.sql:3-5` + `docs/pre-deploy-acceptance-2026-11-15.md:87` — 文档/注释自述 `sellfox_mcp_ro` 对 62 张 `Amazon*` 表仍有 SELECT，双池隔离未生效，仅靠应用层前缀清单；`audit-roles.mjs` 实跑 exit 1。属"待实施"而非已生效，须 DBA 落地。
- `src/lib/amazon-sync/local-raw-read.ts:29-30` vs `src/lib/sellfox/mcp.ts:195-196` — 同类只读池一处 fail-open（回退主连接）、一处 fail-closed。统一为 fail-closed。
- 权限多来源：`role-definitions.ts:11-194`、`role-catalog-server.ts:32-45,87`、`sellfox/credential-store.ts:51-58`（legacy + 新表合并）、`role-catalog-server.ts:108-115`（DB 不可用回退更宽默认权限）。收敛到单一 source of truth，DB 故障 fail-closed。
- `src/lib/accounts/role-definitions.ts:69-74,175-177` — finance 角色自述"物流页进页即开放全部操作"，声明权限与实际能力不符。
- `src/app/api/notifications/user/route.ts:7-8,53-56` — `roleCanAccessModule` vs `roleCanPerformAction` 双轨判定。

### 2.3 数据补零（中等级，精选）

**2026-11-17 销售数据专项收口状态（本地实现，不代表生产迁移已执行）**：
- 销售计划实际及历史查询已迁至 `src/lib/ext/sales-plans.ts`：数量和金额分别以 `COUNT(字段)=COUNT(*)` 校验 SKU 组内观测完整性，缺行/缺数量保留 null，部分金额缺失不伪装完整收入；完整观测的真实零保留。实际查询包含计划结束日。
- 列表和详情复用真实历史来源判定预测状态，不以旧 `forecastQty/historyDailyAvg` 非 null（尤其旧零）直接认定 READY；缺来源输出 null/NEEDS_DATA，有完整数量来源按真实历史重算展示，保存时重算持久化。数量完整但金额缺失时，数量预测仍有效，收入和实际完整性仍标未知。
- `SalesPlanLine.historyDailyAvg/forecastQty` 已调整为 nullable；离线迁移 `prisma/migrations/20261218020000_sales_plan_unknown_observations/migration.sql` **仅 DROP DEFAULT / DROP NOT NULL，不 UPDATE 历史零、不清洗或重置既存业务证据**。生成 Prisma 输入已确认允许两字段 null；本专项未自行并发 generate，未连接真实数据库、未执行 DDL。
- `sales-plans-workbench.tsx` 的 DTO、逐行数值和汇总 KPI 均区分 null 与真实零，待补数据不显示成 0/0.0%；空白目标/金额/成本不再转换为零。`tax-workbench.tsx` 应缴税额遗漏的 `?? 0` 同步清除。
- 回归纳入 `tests/ext-sales-data-contract.test.ts`、`tests/sales-plans-workbench.test.ts`（隔离 Chromium 真实组件渲染）、`tests/ext-service-modules.test.ts`、`tests/ext-domains.test.ts`、`tests/remediation-data-null.test.ts`；覆盖无历史、真实零、部分观测缺失、旧伪零无来源、来源重算、组织/工作区作用域及成员撤权、日期边界、只读离线迁移约束与唯一服务重导出。此项不替代最终全仓严格类型、全量测试与生产验收。

- `src/lib/procurement/invoice-service.ts:357,373` — 无发票行时金额 `?? '0'`，与真实 0 元票不可区分。
- `src/components/products/product-workbench-data.ts:81,94-99,133` — 未采价/未测量变成 0 成本/重量/尺寸。
- `src/components/operations/sync-center-workbench.tsx:400`、`components/workspace/adjustment-table.tsx:799-822`、`components/operations/ext/tax-workbench.tsx:46-47` — 各类汇总缺失显示 0。
- `src/lib/selection-research/server.ts:56-61` — catch 无差别吞掉任何异常（含 DB 不可用、权限错误）统一返回 404，掩盖真实 500。
- `src/lib/ads-inventory/constraint.ts:244,282` — 未观测的日均花费按 0 推导加投上限。

---

## 3. P2 — 可维护性债务（按容量推进）

### 3.1 冗余与双方案（17 条，精选）
- `src/lib/operations/readiness.ts:76-161` vs `src/lib/amazon-sync/compatibility.ts:18-24` — 同一份 domain freshness 状态机两套实现；compatibility.ts:9 自注 "Legacy consumers"。
- `src/lib/operations/readiness.ts:182-183` — `requestAmazonSync`/`validateAmazonConnection` 导出仅 `throw new Error("旧同步入口已退役")`，纯占位死代码。
- `src/lib/amazon-sync/compatibility.ts:11,26-27` — 同一账号范围校验调用两次，第二次入参是第一次算出的唯一账号，无意义重复 DB 访问。
- `src/lib/points/summary.ts:91-102` vs `196-212` — 积分汇总整段复制粘贴两遍。
- `src/lib/sellfox/mcp.ts:48` vs `src/lib/amazon-sync/mcp.ts:38` — 两份逐字相同的 token hash 实现。
- `src/lib/workspace/workspace-scope-store.ts:6-14,41` — 注释即承认历史双键，legacy 键仍保留回退。
- `src/components/operations/mcp-isolation-panel.tsx:89,93` — 个人凭证与共享令牌两套鉴权并存。
- `src/components/ui/card.tsx:3-9` — 注释标注"旧版容器，请优先用 Section"，但仍被大量引用。
- `src/lib/lili/research-tools.ts:85`、`components/selection-research/research-workbench.tsx:183,188` — 旧版费用门槛 gate 分支残留。
- `src/lib/amazon-sync/settlement-allocation-mapping.ts:8` — 注释自证曾存在两套结算字段优先级口径。
- 死代码/无意义封装：`src/lib/agent-platform/ppc.ts:1577-1585`（双重兜底 `?? 0` 永不触发）、`src/lib/products/product-list-summary.ts:99-109`（source 参数未使用）、`:126-142`（纯字段复制 wrapper）、`components/agents/chain-handoff.tsx:94`（旧版交接兼容分支）。

### 3.2 文件过大与职责过载
Top 5（完整 Top 20 见附录 B）：
| 文件 | 行数 | 混杂职责 |
|---|---|---|
| `src/components/listing-ai/listing-ai-workbench.tsx` | 3014 | 数据归一化 + 876 行主组件 + 服务端保存 + 5 个 Section |
| `src/components/products/product-workbench.tsx` | 2582 | 缓存层 + 672 行主组件 + 1063 行 ProductEditor + API |
| `src/lib/amazon-sync/processor.ts` | 2106 | 7 类同步资源 slice + 校验 + 错误分类 + 持久化 + 发布 |
| `src/lib/agent-platform/ppc.ts` | 1682 | 定义 + 工具 + 评测 + adapter + executor + 数十个 builder |
| `src/lib/agent-platform/market.ts` | 1589 | 同上模式（6 个 agent 文件同构复制） |

其他重点：`src/lib/stores/workspace-store.ts:1407`（单个 store 1113 行）、`src/lib/ext/service.ts:1015`（约 30 个无关领域操作）、`src/app/api/products/handler.ts:866`（路由+原生 SQL+业务+计时）、`src/app/api/agents/[agentId]/executions/route.ts:611`（单个 POST 511 行）。

**建议阈值**：route/handler >500 审视、>800 必拆；前端组件 >400 拆、单文件 >600 审视；lib 领域 >800 审视、>1000 必拆；单函数/组件 >200 重构；单文件 ≥3 类职责无论行数都拆。

**拆分优先级**：先拆 `api/products/handler.ts`（鉴权与 SQL 边界最敏感）→ `processor.ts`（同步逻辑容错面）→ 6 个 agent-platform 文件（抽 shared）→ 前端巨型组件（纯展示风险最低）。

---

## 4. 执行顺序与验收口径

1. **第一批（P0，阻断发布）**：§1.1 明文密码 → §1.2 公开注册 owner → §1.4 默认密码 → §1.5/1.6 数据补零与 mock → §1.3 服务账号（需运维窗口）。改完后 `npm run check:production --gate full` 与专项测试必须留可读日志。
2. **第二批（P1）**：§2.1 账号权限 → §2.2 隔离契约（先做 PoC 验证跨工作区写入是否真实可利用）→ 双池角色落地。
3. **第三批（P2）**：按 §3 阈值和拆分优先级推进，每次拆分前后跑 typecheck/lint/测试。

**验收原则**：
- 所有权限/数据修复必须有前后对比测试；安全项要 PoC 复现 → 修复 → 复测失败。
- 数据补零项以"缺失返回 null/NEEDS_DATA"为通过标准，禁止用 0/999/default-* 冒充。
- 不因整改放宽现有 fail-closed 闸门（Ads 未实现整批 fail-closed、SellerSprite 模拟数据抛错、live 模式禁 mock 预算等保持不变）。
- 本次审计结论基于静态代码；标注"[理论风险]"的项未经动态验证，不得当作已发生的安全事件对外陈述。

---

## 附录 A — 兜底/死代码完整 25 条

见本次审计 agent 原始输出；严重 10 条 / 中等 12 条 / 低 3 条，核心条目已在 §1.5、§2.3、§3.1 收录。确认正确的实现（勿改）：`src/lib/sellfox/narrow-contracts.ts:4-9`、`src/lib/amazon/inventory.ts:74-79`、`src/lib/forecast/forecast.ts`、`src/lib/accounts/permissions.ts:158`、`src/lib/auth/api-permissions.ts:46`、`src/lib/auth/session.ts:85`、`src/lib/auth/csrf.ts:42`（均 fail-closed）。

## 附录 B — Top 20 大文件完整表

当前可追溯的审计材料未包含原始 Top20 明细，仅保留 Top 5 和 §3.2 的重点文件摘要。原始 agent 输出未在工作区找到，故不补造排名或逐项覆盖结论。后续若需逐项验收，应先提供原始清单；本轮仅按当前源码复核实际整改对象。

---

**当前状态（2026-11-17 续修后）**：本地实现继续推进，累计完成工作区成员授权、组织选择登录、权限单一来源、Sellfox scoped credential、缺失值真实性处理及多处大文件职责拆分。历史验收记录包含串行全量 2245/2245、TypeScript 编译器 API 1999 文件 / 0 诊断、lint 0 错误 / 4 警告及 ui:guard 通过；这些结果来自此前代码状态，不能替代本次后续改动后的全量回归。本轮 ProductEditor 冲突流程改用可渲染 active state，文件 394 行；`product-revision-conflict` 与 `product-editor-session` 联合 10/10，项目 `npm run typecheck` 通过，全量 `npm test -- --test-reporter=dot` 通过，相关 ESLint 为 0 错误 / 4 警告（两处图片性能建议、两处未使用标识符），`ui:guard` 与 `git diff --check` 通过。首次默认 reporter 全量命令退出 1，紧凑 reporter 全量复跑退出 0；未读取完整失败详情，故不推断首次失败根因，也不报告未核实的准确总数。本轮将 SellerSprite 独立配置读取/保存/连接测试抽至 `use-sellersprite-settings.ts`，settings 主 hook 降至 432 行、子 hook 108 行；新增隔离 hook 行为测试覆盖公开配置不回显密钥、保存后清空明文、连接错误和 busy 收尾。Logistics 的摘要/可见 SKU 筛选/日志色调抽至 `logistics-workbench-tables.ts`（31 行），主 hook 降至 404 行；新增纯模型测试 2 项。logistics 主 hook 仍略高于 400 行且仍负责上传解析与多种导出流程；没有足够的真实异步回归前不继续搬迁。原始审计附录 B Top20 明细未包含在可追溯材料中，已明确记录缺项，不推断排名或声称逐项覆盖。并行全量测试曾出现 1 项共享状态竞争失败，根因未确证。性能基线因 Docker CLI 缺失未获得。真实数据库迁移与双池授权、生产 systemd/ACL 实机验收及部署未执行；未提交、未推送。工作区来源不明文件保持不动。
