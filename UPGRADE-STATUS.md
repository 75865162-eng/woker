# 版本合并与升级状态追踪（以代码为准）

> 当前 HEAD：`e4d93d4`（17f3c63 主线 + 全分支功能合并 + 本地安全加固 + d74fdfc 验收增强）
> 基线来源：GitHub `75865162-eng/woker`，完整 clone（404 commits，含真实 git 历史）
> 更新时间：2026-11-18

## 一、分支全景与拓扑

| 分支 | commit | 关系 |
|---|---|---|
| `origin/main` | `03d48e4` | 旧线：ppcsaas + CI 性能门禁（大版本前的加固线） |
| — | `883afa4` | 独立功能线：生产级加固 + 数据一致性（与 17f3c63 从 `d9949c6` 分叉） |
| `origin/tiaotiao-erp` | `17f3c63` | 新主线：tiaotiao，双池 MCP / Amazon 云执行 / workspace 围栏 |
| `origin/codex/amazon-multistore-mcp` | `26c02a8` | commit 全部已在主线（对比 33/0），无遗漏 |

**最终状态**：`ahead 225 / behind 0`，全部分支内容已纳入本地主线，拓扑完整。

## 二、本轮完成：全分支审计 + 遗漏功能合并

### 1. 全分支审计结论
- `codex/amazon-multistore-mcp`：独有 commit 全部已在主线，无遗漏
- `origin/main` 领先的 `883afa4`：是**独立功能线**（非 17f3c63 祖先），35 个文件净贡献，安全 + 数据一致性功能在当前主线确实缺失
- `03d48e4`：CI 性能门禁，脚本与当前主线文件哈希完全一致，内容已被独立实现

### 2. `883afa4` 合并（commit `a35422b`）
逐处解决 14 个冲突，**保留 17f3c63 新架构 + 叠加 883afa4 功能增强**：

| 功能域 | 合入内容 | 冲突整合策略 |
|---|---|---|
| AI 错误脱敏 | `src/lib/server/ai-error.ts`（classify/redact/safeBaseUrl）+ 7 单测 | ai-settings/route 保留日志脱敏；test-chat 因测试契约取 ours |
| 越权审计 | `src/lib/audit/access-denied.ts` + 单测 | 保留 ours 多位置 workspace 校验，在每个拒绝分支补审计记录 |
| 密钥策略 | `src/lib/auth/secret-policy.ts` + 单测 | 保留 ours `getAuthSecret` 单一事实源（全环境 fail-closed，更严格） |
| 数据一致性 | `window-config.ts`/`watermark.ts`/`reconciliation.ts`/`data-quality` API + 单测 | 接线到 ours 的 endpoint/shards 新架构；fail-closed 默认值不放大防护 |
| 配置 | `.env.example` 加 SELLFOX_*_DAYS 窗口变量 | 两边配置都保留（叠加） |

### 3. `03d48e4` 合并（commit `e1d5260`）
- 性能门禁脚本（`erp-navigation.mjs`、`performance-process-preload.mjs`）哈希与当前完全一致
- 用 `git merge -s ours` 仅记录拓扑合并，**不回退**新版 tiaotiao 配置（旧线会覆盖包名/脚本/依赖）

### 4. dev 启动逻辑修复（commit `23b921b`）
- 根因：`next-run.mjs` 把临时 tsconfig 生成在 `.next-types-XXX/` 子目录 + `baseUrl: process.cwd()` 绝对路径，Turbopack edge 编译把 `@/*` 错位解析
- 修复：临时 tsconfig 放项目根（随机后缀保并发隔离）、`baseUrl: "."`、清理逻辑同步
- 兼容：`cleanupTypeFiles` 位置调整，避免破坏 next-tracing 测试的函数切片
- 验证：`npm run dev` 标准命令 middleware 正常编译、`/login` 200

## 三、验证结果（合并后）

| 检查项 | 结果 | 说明 |
|---|---|---|
| `check:fast` | ✅ **EXIT=0 全绿** | 2331 测试 / 0 失败 + lint 0 error + typecheck + ui:guard |
| 新增 7 模块单测 | ✅ 25/25 | 数据质量/对账/水位/窗口/AI错误/密钥策略/越权审计 |
| 生产构建 `npm run build` | ✅ 通过 | middleware 正常编译，218 路由生成 |
| dev 服务（修复后） | ✅ 正常 | 临时 tsconfig 在项目根，`/`→307，`/login`→200 |
| 登录（数据库+认证） | ✅ 200 | owner 角色 + 权限快照 |
| 数据质量 API（新功能） | ✅ 200 | 返回诚实占位（`rate: null`，不伪造零值） |
| `/dashboard` | ✅ 200 | 受保护路由正常 |

### 顺带修复的上游问题
- 3 个 typecheck 错误（`ProductEditorDraft.competitors`、`ProcessEnv.NODE_ENV` ×2）：仅测试类型标注层面修复（类型断言），零行为改变，使 check:fast 全绿
- `multipart` 测试补 `access-denied` mock（合并新依赖的必要适配）

## 四、本地 commits（全部已提交，未 push）

| commit | 内容 |
|---|---|
| `e1d5260` | merge 03d48e4（ours 策略，内容已覆盖） |
| `a35422b` | merge 883afa4 生产加固 + 数据一致性（14 冲突整合） |
| `23b921b` | fix(runtime) dev Turbopack `@/` 别名解析 |
| `11cbcf1` | docs 状态追踪表 |
| `cb4aaa2` | fix(security) AI 密钥加密落库 |

## 五、运行信息

- 服务：`localhost:3000`（dev 模式，Turbopack，后台运行）
- 登录：`admin@local.test` / `lZa7LROlMwa7I5fbxxX3GWm`
- 数据库：docker compose `postgres:16`(healthy) + `redis:8`，186 个 migration 已应用
- 重启 dev：`source ~/.nvm/nvm.sh && nvm use 22.19.0 && HOSTNAME=0.0.0.0 npm run dev`
- 生产模式：`HOSTNAME=0.0.0.0 PORT=3000 npm run start:standalone`（`HOSTNAME` 必须显式设）
- Node 由 nvm 管理（默认 22.19.0）
- `.env` 受 gitignore 保护，未提交；外部 API key 保持占位，未填真实凭据

## 六、如实留档

- **真实外部授权链路**（赛狐/Amazon API）、生产部署、第三方选品工具：本地无法闭环，未造假
- 所有合并均为本地操作，**未 push**（无远程写授权）
- 数据质量 API 在无同步数据时返回 `null` 比率而非伪造 0，符合"缺失数据不补造零值"原则

## 七、第二轮全分支复审（fetch 后新远程分支，2026-11-18）

用户授权 push 后重新 `git fetch --all --prune`，发现远程新增 5 个分支、`tiaotiao-erp` 前进到 `d74fdfc`。逐一审计结论：

| 分支 | 独有 commit | 复审结论 | 处理 |
|---|---|---|---|
| `codex/amazon-multistore-mcp` | 0 | 全部已在主线 | 无 |
| `cursor/rebrand-tiaotiao-aa9a` | 0 | HEAD 即 merge-base，无新增 | 无 |
| `codex/product-detail-159-20261101` | 2 | patch-id 已在 main（`-`） | 无 |
| `codex/listing-gallery-159-20261111` | 7 | gallery saves 功能已由 ssh 线吸收；main 为 11-16 ui-kit 重构版，分支为 11-12 旧版，合并会回退 | 无 |
| `codex/competitor-card-whitespace-159` | 8 | 同上 + 1 个 whitespace 微调；生产文件 main 更新或等价 | 无 |
| `codex/sp-api-mainline-20261108` | 3 | `ad86a09` 的 35 个新符号已全部在 main；`995d455` 的"精确依赖树重启"与 main 刻意的全量重启安全设计冲突 | 无 |
| `tiaotiao-erp`（`d74fdfc`，11-18 最新） | 1 | 隔离运行时验收增强 + Next path resolution | **部分合入** |

**判定方法**：三点 diff + 两点树差异 + `git cherry -v`（patch-id）+ 内容 hash + 新符号在 main 的存在性 + commit 日期演进方向，避免仅凭 patch-id 误判。

### d74fdfc 合并（commit `e4d93d4`）
- ✅ 合入：`scripts/test-runtime-integration.mjs`（五表 fixture、workspace 头、TAP reporter、FBA 路由断言）+ `tests/next-tracing.test.ts`（baseUrl 解析测试，已适配本地方案）
- 保留本地 `next-run.mjs` 方案：d74fdfc 用 mkdtemp 子目录 + 相对 baseUrl，与本地 `23b921b`（根目录 + `baseUrl:"."`）等价；遵循"不覆盖已批准改动"，冲突取 ours；新增测试改写为匹配本地实现并通过
- ❌ 排除 `outputs/` 下针对特定 CI 环境（Node24/固定镜像路径/taskId）的一次性验收产物，非可复用功能

## 八、生产级可部署检测与优化

| 检查项 | 结果 | 说明 |
|---|---|---|
| `npm run build` | ✅ EXIT=0 | standalone 产物 + middleware 正常编译，全路由生成 |
| `check:production --gate code` | ✅ 通过 10 / 阻塞 0 | 代码、构建产物、全部加密密钥、写门禁均达标 |
| `check:production --gate deploy`（本地 .env） | ⚠️ 3 FAIL 为生产模式专属 | local 模式下 runtime_mode/node_env/execution_role 未设，属预期（本地非生产） |
| `check:deploy`（官方模板渲染后配置） | ✅ 通过 28 / 阻塞 0 | 用 `prod:env:init` 渲染 + 合法测试值填充的临时环境文件验证，部署清单/资产全齐；不写仓库、不接真实资源 |
| `check:fast` | ✅ 全绿 | 2332 测试 / 0 失败 + lint 0 error + typecheck + ui:guard |
| 生产服务 `start:standalone` | ✅ Ready 218ms | health 200；登录 200、数据质量 API 200、dashboard 200、未登录 307→login |

**优化项**：
- 补齐本地 `.env`：`AMAZON_ADS_ENCRYPTION_KEY`、`SELLFOX_CREDENTIAL_ENCRYPTION_KEY`（各随机 32 字节 Base64，本地加密密钥非外部凭据）、`AMAZON_FBA_REMOTE_EXECUTION_ENABLED=false`（写门禁加固）
- 修复 lint 健壮性缺陷：`eslint.config.mjs` 原忽略 `.next-types*/**`（目录），漏掉本地 `next-run.mjs` 生成在项目**根**的 `.next-types-*.json` / `.next-types-ambient-*.d.ts`；dev 进程存活期间这些临时文件被 eslint 扫描触发 triple-slash-reference 错误。补充根级 glob 后 lint 0 error，check:fast 在 dev 运行时也稳定全绿

**如实留档**：
- 真实外部 Amazon/Sellfox 凭据、`--gate full` 的数据库/外部接入验收：本地无真实凭据，须在目标机用生产 EnvironmentFile 完成，不造假
- `config.storage=local` 为非阻塞提示，上线须配置持久卷或 s3/r2 并做恢复演练
- 生产模板渲染验证仅证明模板结构与部署清单完整，不代表生产已就绪

## 九、git push 状态（已完成 ✅）

- 用户提供具备写权限的 GitHub fine-grained PAT 后，通过 `GIT_ASKPASS` 从临时文件注入凭据（不回显、不写入仓库/git 配置），配合 HTTP/1.1 + 大 postBuffer 重试 3 次
- 结果：`03d48e4..53f0904 main -> main` **推送成功**（前 2 次 TLS -110 波动，第 3 次成功）
- 权威确认：远程 `main` == 本地 `main` == `origin/main` == `53f0904`，工作区干净、无 ahead/behind
- 全流程闭环：全分支复审 → 遗漏功能合并 → 生产级检测全绿 → 优化 → push 到 origin/main
- 推送的主要提交：`e4d93d4`（d74fdfc 验收增强合并）、`ed17277`（生产级检测收口 + lint 健壮性）、`53f0904`（状态记录）
- 后续状态表修正 `9301ed1` 亦已 push；远程 main 权威确认 == 本地 == `9301ed1`

## 十、生产部署前代码验收（依据需求总纲 V1.0，2026-11-18）

- 交付物：`ACCEPTANCE-REPORT.md`（需求→代码→状态追踪矩阵，按文档第 13 节状态定义）
- **P0 安全边界全部合规**（本地核验，风险低/无）：双数据池物理隔离、ProductRecord 主档不被外部覆盖、MCP 强制 Seller Account+Marketplace 服务端隔离（只读/白名单/参数化/禁任意 SQL）、AI 写 Amazon 门禁（dry_run+draft+人工审批+transport 恒 NOT_IMPLEMENTED）、SP-API 与 Ads 授权独立、登录限流/CSRF/健康探针
- **生产发布资产完整**：systemd×6、Caddy、真实备份恢复脚本（pg_dump+校验+sha256）、密钥生成、口令轮换、runbook、门禁清单齐全
- **未闭环项均为外部环境依赖**（不造假）：真实 Amazon 授权、生产 DB/Redis/域名证书、`--gate full` 真实端到端、唯一同步端切换（须部署时停本地 worker）、生产备份恢复演练、发布后冒烟
- **技术债（部署后处理）**：赛狐域 + `ProductRecord.purchasePrice` 用 Float 存金额（schema 140 个 Float 字段），违反文档 Decimal 要求；改需 schema 迁移 + 20+ 文件类型契约变更，部署窗口改动风险 > 收益，按文档 §0.2 列为技术债不在本轮改
- **本轮无代码改动**：审计未发现可安全本地闭环且不破坏现有代码的 P0/P1 缺口；不为优化而制造改动
- 复验：check:fast EXIT=0（2332 测试/0 失败、lint 0 error、ui:guard 通过）、code gate 阻塞 0、生产模板 deploy gate 阻塞 0

## 十一、金额字段 Decimal 整改 + 未覆盖能力审计（2026-11-18，用户明确要求"马上整改"）

**背景**：用户将第十章列为"部署后技术债"的 Float 金额升级为"必须淘汰的硬伤，马上整改"，并给出字段规范（采购/成本/销售价、订单金额/库存汇总/毛利 DECIMAL(20,4)；汇率 DECIMAL(12,6)；独立 currency；Decimal + decimal.js，禁 number 承接运算）。

**整改内容（已落地）**：
- Schema：140 个 Float 字段精确分类 → **122 个金额字段改 `Decimal @db.Decimal(20,4)`**，18 个非金额字段（毛利率/退款率/件数/评分/排名/限流令牌）保留 Float；补齐 `ProductRecord`/`ProductSummaryRecord`/`SellfoxHourlyMetric` 的 `currency` 字段（默认 CNY）
- 现有财务域已是 Decimal 范式（`FinanceExchangeRate.rate` 用 `Decimal(24,12)`，比规范 (12,6) 更精确，保留；采购/总账金额均 Decimal + `.toString()` 序列化），本次将赛狐域对齐该范式
- Migration：`20261118050000_money_float_to_decimal`（122 ALTER + 3 ADD COLUMN；因 10+ 视图依赖金额列，采用 DROP VIEW → ALTER → CREATE OR REPLACE VIEW 重建）
- 代码改造（运算/序列化，展示边界转 number 不改前端契约）：
  - `src/lib/sellfox/ads-proposal.ts`：ACOS/花费比较全部改 `Prisma.Decimal` 的 `div/mul/gte/lte`，缺失金额跳过不补零
  - `src/lib/products/product-detail-service.ts`：listings.price / costs.amount / summary.purchasePrice 展示序列化
  - `src/lib/sellfox/{orders-read,host-read}.ts`、`src/app/api/sellfox/[domain]/route.ts`：金额 API 输出 `moneyToNumber()` 转 number
  - `src/app/api/sellfox/performance/export/route.ts`：ExcelJS 数值单元格转 number
  - 新增 `src/lib/sellfox/money-display.ts`（展示序列化边界，null 保持 null）
- 新增 `tests/money-decimal.test.ts`（5 项不变量：序列化/主档 Decimal/赛狐金额 Decimal vs 比率 Float/广告订单金额与 currency/decimal.js 精度），防未来回退
- 修复测试断言 `tests/ext-service-modules.test.ts`（成本字段类型枚举加 Decimal 并兼容 `@db` 尾缀）

**验证**：单测 2332/0 失败；typecheck 0 error；lint 0 error（4 既有 warning）；ui:guard 通过；build EXIT=0；code gate 阻塞 0；数据库列类型 numeric(20,4) 确认、11 视图重建可查、金额精度回读 19.9999 无损；standalone 服务 health 200、登录/赛狐 hourly/数据质量 API 200

**未覆盖能力审计结论（对照需求总纲第 4/6 节）**：
- 已完整：P2P 采购到付款（状态机+审批+付款+入账）、WMS 盘点/调拨/出入库/库龄、MCP（Amazon ~40 + 赛狐 20+ 工具，账号站点围栏、只读）、财务报表（基于过账凭证）
- 部分实现：O2C 回款/对账闭环（订单同步真实，但应收/回款为 `data-plan.ts` 的 `planned` 设计占位）；通用费用单（UI 预览无后端）；AI 经营复盘编排（6.5 顺序编排未实现，现有 skill 偏单域）；统一经营分析层（无独立指标/来源标注层）
- 外部授权依赖（不可本地闭环）：FBA 写入提交（网关 `enabled:false`）、Amazon Ads 真实写入、真实端到端数据验收
- 处理决定：缺口均为需新建表/状态机的**大功能**或外部授权依赖，本窗口强行实现会引入无真实数据验证的半成品，违反"数据真实性/最小改动"。按文档 §0.2 报告现状并列为下一批任务，不为凑数制造改动

## 十二、租户边界 + 统一管理中心 + 多源接入整改（2026-11-18，依据两份参考文档，用户选"全量按文档推进"）

**依据**：两份功能蓝图（多源数据接入回补 / 统一管理中心整合）。开工前先出差距清单（见会话），三阶段串行实施，全部沿用现有架构、最小改动。

### 阶段一：租户边界硬伤（安全边界，最高优先）
- **Amazon view/export 读取路径并入角色级 grant**（`src/lib/amazon-sync/data-access.ts`）：成员授权 ∪ 角色授权；角色 grant 里的店铺再经 `sellerAccount.status=active` 过滤，停用店铺不因角色授权泄漏；write/sync 路径原本已并，本次对齐读路径
- **赛狐新增成员级 + 角色级店铺授权**（本轮最大新增能力）：
  - 新表 `SellfoxDataAccessGrant` / `SellfoxRoleDataAccessGrant`（迁移 `20261219000000_sellfox_store_access_grants`，纯新增、可回滚）
  - `src/lib/sellfox/store-access.ts`：`resolveSellfoxVisibleStoreIds`（渐进启用——工作区无任何授权记录时维持旧行为有 view 即全可见；一旦配置则可见店铺=成员∪角色授权，owner/database_admin 全量豁免）+ `saveSellfoxStoreGrant`（带审计、乐观锁、范围校验）
  - `browse-store-scope.ts` 收窄 query 店铺到授权集合（越界 403），8 个赛狐只读 API 全部注入 actor；修复 `performance/export` 的 agent 分支绕过点
  - `src/lib/sellfox/mcp.ts`：创建/轮换 MCP 凭证时校验 storeIds 不超出目标成员的 ERP 授权范围
  - 管理接口 `src/app/api/sellfox/store-grants`
- 遗留字段 `amazonStorePermissions`/`multiPlatformStorePermissions` 维持只读展示、不参与鉴权（未在花名册外扩散）
- 回归测试：`tests/amazon-account-access.test.ts`（新增角色授权生效用例）、`tests/workspace-membership.test.ts`、`tests/sellfox-store-access.test.ts`（渐进启用/并集/越界/豁免）、`tests/operations-replenishment-service.test.ts`（补 role grant mock，修复本轮引入的异步挂起回归）

### 阶段二：统一管理中心（原地升级，不新建路由）
- `/accounts` 工作台从 2 Tab 扩为 **members / roles / points / mcp 四 Tab**，`?tab=` 与选中态双向同步；points/mcp 复用现有自包含面板，mcp Tab 内嵌 Lili 设备面板
- 新增**成员详情抽屉** `account-detail-drawer.tsx`（点击成员名打开，聚合基础资料/角色与页面权限/积分/赛狐数据范围/MCP 凭证；`onOpenDetail` 为可选 prop，不破坏现有成员表契约）
- `/settings` 的积分/MCP Tab 改为**跳转占位卡**（跳 `/accounts?tab=points|mcp`），其他 Tab 不动
- 15 模块×5 动作权限矩阵、成员/角色/积分/凭证接口、UI 组件均沿用，无契约变更

### 阶段三：多源接入与能力补齐（不臆造采集/不接线真实网络）
- 新增统一只读目录 `/api/integrations/catalog` + `src/lib/integration-catalog.ts`：聚合三源既有静态契约，如实标注"可同步 / 未实现 / 需角色 / 平台阻断"+ 官方窗口 + 原因；`getMcpDatasetCatalog()` 给赛狐数据集补 `available` 标志与"金额按行返回、保留原币种、禁止跨币种汇总"警告，对齐 Amazon 域注释范式
- Ads SB/SD 报告、SP-API 订单明细照既有契约标 `not_implemented` + blockers（capabilities/policy 已登记，符合"先登记再实现、未接入如实标注"），**不臆造采集实现**
- 真实连通性校验（发外部最小只读请求）：赛狐已有 token-only 校验端点、Amazon Ads 有纯决策 probe 待接线；当前隔离环境无真实外部 API，不接线跑不通的端点，按数据真实性如实留档

**验证（Node 22.19.0，本地根 .env）**：build EXIT=0；check:fast EXIT=0（**2349 测试 / 0 失败 / 0 cancelled**、lint 0 error、typecheck 通过、ui:guard 0 回退）；code gate 阻塞 0；deploy gate 其余 FAIL 均为部署时注入项（ERP_RUNTIME_MODE/NODE_ENV/EXECUTION_ROLE）属预期；本地 Docker DB 新迁移已应用、两表结构与 schema 一致
**Verification**: check:fast EXIT=0 under Node 22.19.0 — 2349 tests pass (0 fail, 0 cancelled), lint 0 error, ui:guard 0 regression. Build EXIT=0. code gate 0 blockers. NOTE: one real regression (operations-replenishment mock missing role-grant) was found via clean-HEAD worktree diff and fixed before this result.
**本地环境修正**：当前 shell 原用 Node 22.13.1（低于门禁 22.19），已切到系统已装的 22.19.0；production-readiness 测试随之 11/11 通过
**未闭环（外部环境依赖，不造假）**：真实连通性校验端点接线（需真实外部 API）、Ads SB/SD 与订单明细真实采集、生产 EnvironmentFile 下的 full gate 端到端

## 十三、P2 性能整改 + DB/Redis 连接池（2026-11-18，依据两份新文档）

**依据**：《P2 性能整改方案 — woker（基线 bac8a3a）》（Y1–Y4）+《真实环境 PostgreSQL/Redis 测试整改方案》（B1–B8；该文档明确"只做规划、不改业务代码、落地另行排期"，本轮仅落地其中唯一明确可落地的代码项 B1）。动手前以当前 HEAD `36945e6` 复核所有行号（基线已偏移），逐项以代码现状为准。

### Y2 统一轮询可见性 Hook（文档建议顺序第 1）
- 新增 `src/lib/hooks/use-visible-polling.ts`：可见性暂停/恢复（hidden 清 timer、visible 重建并可选补刷一次）、busy 跳过、enabled 关闭不建 timer；onPoll 走 ref 保持稳定引用无需重建 timer；卸载清理 timer + visibilitychange 监听
- 迁移文档列出的 8 处（sync-center-workbench 已是参照实现，保留对照）：wms、sync-console、sellfox-hub、sellfox-workbench（overview+runs 两路，用 ref 中转保留原 epoch/abort/inFlight 语义）、task-center、operations-hub、sellfox-health-panel（load 提取为 useCallback + ref 管理 controller/generation）、sales-traffic（终态自动停）
- 额外纳入审计发现的 3 处客户端后台轮询：user-notification-center、wecom-notification-runner、image-upscale-workbench

### Y1 角色权限快照缓存（鉴权热路径）
- 新增 `src/lib/accounts/role-permission-cache.ts`：进程内 LRU（≤32、45s TTL）+ 可选 Redis（REDIS_URL 未配置则仅进程内，复用 login-rate-limit 的惰性单例/短超时/静默错误/测试注入模式）；`getOrganizationRolePermissionsCached`/`invalidateOrganizationRolePermissions`/`setRolePermissionCacheRedisForTest`；任何缓存异常回源 onMiss，鉴权判断本身 fail-closed
- 收口"角色行合并进默认 Map"纯函数 `mergeRolePermissions`（`role-permissions-utils.ts`），消除 data-access/authorization 等处重复合并
- 接入非事务热路径 `assertAmazonAction`（data-access.ts）、`assertAdsSettingsManager`（authorization.ts）：**仅当 db === 全局 prisma 走缓存**，传入 tx 时直查；成员状态始终实时查、不缓存
- 写后失效：`saveOrganizationRoleCatalog` 事务**提交后**调用失效（不在事务内删键，避免回滚误删）；生产 src 直接写 `organizationRosterRole` 的唯一入口已覆盖
- 事务内路径（change-approval、processor 及传 tx 的 assert 调用）保持直查，不缓存

### Y4 sellfox hub 概览计数缓存
- 新增 `src/lib/sellfox/hub-overview-cache.ts`：按 org+workspace 缓存 12 条数据集 count/max/distinct 统计（45s TTL、≤64 条 LRU）；**仅缓存纯统计**，lastRun/href/plan 等实时字段每次重建；任一表读取失败则整批不缓存（下次全量重试，不冻结失败结果）
- hub route 用 `getHubDatasetStats` 包装聚合查询；失效挂 `sync-service.ts` 的 done（事务提交后）/failed 分支
- SQL 表名/列名仍只取 data-plan.ts 白名单、值参数化，单表不可用仍不空白

### Y3 前端请求缓存与并发去重
- 在 `workspace-api-cache.ts` 泛化 `cachedApiGet`（TTL 默认 5s + inflight 去重 + retries + force + scope/generation 前缀失效），复用现有 queryCache，不新建第二套缓存、不引入新依赖；失败不写缓存
- 第一批接入：`host-workbench.tsx` 的 sellfox overview stores 只读加载（mount 一次性、无轮询竞态）；强实时任务/进度/导出状态与写操作明确不进缓存

### B1 PG 连接池显式配置
- `src/lib/db/prisma.ts`：`buildPgPoolConfig()` 给 `PrismaPg` 透传 PoolConfig（max/idleTimeoutMillis/connectionTimeoutMillis），env `PG_POOL_MAX`（默认10，等同原 pg 隐式行为）/ `PG_POOL_IDLE_TIMEOUT_MS` / `PG_POOL_CONNECTION_TIMEOUT_MS`，缺省回退现状；`.env.example` 补示例

**测试**（新增 18 项）：`tests/role-permission-cache.test.ts`（合并口径/命中/失效/失败不缓存/鉴权判定一致，5项）、`tests/hub-overview-cache.test.ts`（命中/失效/失败不缓存/scope隔离，4项）、`tests/workspace-api-cache.test.ts`（TTL/inflight去重/force/retries/失效，6项）、`tests/pg-pool-config.test.ts`（默认值/正整数覆盖/非法值回退，3项）
**改动边界**：金额字段未新增 Float；权限"成员∪角色并集"与 owner/database_admin 豁免口径不变；事务内鉴权保持直查；不新增未评估的重型前端依赖
**未闭环（规划文档 B2–B8 属复核/实测项，非本轮代码改动）**：慢查询日志与告警、索引随数据量的 EXPLAIN 复核、Redis8 下队列/锁/心跳专项、PG16 复跑迁移与压测——需在有真实数据量 + Docker/浏览器 + 生产版本环境执行，本机空库无法定论，如实留档

**验证（Node 22.19.0）**：check:fast EXIT=0（**2367 测试 / 0 失败 / 0 cancelled**、lint 0 error、typecheck 通过、ui:guard 零回退；首次 2364 + B1 连接池 3 项）；build 单独跑 EXIT=0（首次与 check:fast 并行因内存竞争被 SIGKILL，非代码问题，重跑通过）；code gate 阻塞 0。P0 安全边界回归 26/26 通过（amazon-account-access/account-roles/amazon-ads-authorization/operations-replenishment/workspace-membership）。

---

## 十四、生产级部署形态 + 全功能 mock 数据验收（2026-11-18）

目标：按生产构建产物与生产运行形态拉起系统，用隔离 mock/fixture 数据把所有功能域跑一遍，确认可用。**未加载任何真实 Amazon 凭据、未写入真实业务数据**；本地 Postgres/Redis Docker 容器仅作隔离数据环境。

### 14.1 部署形态
- 生产门禁 `code` 通过（10 项/阻塞 0）；`deploy` 门禁 3 项 FAIL 均为本地 mock 环境的**预期值**（`ERP_RUNTIME_MODE=local`、`NODE_ENV` 空、`AMAZON_API_EXECUTION_ROLE` 空），需生产 EnvironmentFile 注入，非代码缺陷，如实留档。
- 用 `.next-build/standalone` 生产产物 + Next 15.5.25 以 `start:standalone` 拉起；启动时 shell 陈旧 `HOSTNAME=VM-...` 导致 ENOTFOUND，显式 `HOSTNAME=0.0.0.0` 后 Ready in 706ms；`GET /api/health` 返回 `{"status":"ok"}`（HTTP 200），全程无错误日志（仅 SQLite 实验特性无害警告）。

### 14.2 服务端验收（独立组织/合成数据）
| 项目 | 结果 |
| --- | --- |
| 采购全链路（主数据→计划→采购单→收货质检上架→计价→发票三单匹配→付款→总账凭证→应付核销） | 通过 41 项断言，金额 Decimal 精确（1000.000000 / 1130.000000） |
| 装配冒烟 | 通过 7 项（事务回滚未落库） |
| 发票入账冒烟 | 通过 3 组（回滚） |
| 积分账务 | 通过 14/14（存量/预占/释放/跨月结转/上限） |
| 积分消耗 | 通过 7/7（不足不阻断业务） |
| 运营扩展（承运商/三方仓/滞销快照） | 通过 8 项 |
| 扩展域（定价/评价/绩效/调价/销售计划/请款/换货） | 通过 12 项 |
| Ads 五类报表（种子授权 + 假传输 + 回读，已清理种子） | 通过（campaign/advertised-product/search-term/placement/targeting） |

### 14.3 浏览器 E2E（Playwright harness + mock，27 个 config）
- 全部 27 个配置通过。代表性：amazon-ads 61、sellfox 44、sync-center 60、wimoor-ui 42、operations 19、product-edit 18、selection-research 14、agent-chain 6、three-core-port 11、wimoor-port 14、wms-risk 1 等。
- `product-edit` 4 项失败经基线对照确认为 **main2 合并引入的回归**：编辑器外壳由自绘 div 改为原生 `<dialog>`（bare，`aria-label="对话框"`），使 `getByRole('dialog')` 恒匹配到外壳；测试改用 `dialog[aria-labelledby]` 精确定位子模态后 18/18 通过。
- `notifications` / `operations` 各 1 项失败同为 main2 UI 重构后断言过时（浮层底座改原生 dialog、图片改 ImageThumb 固定尺寸容器）：更新选择器/尺寸断言后分别 2/2、19/19 通过。
- `wimoor-ui`（42 用例）最初全挂，深入定位为**两个独立问题**，均已修复至 42/42 通过：
  1. **测试基础设施缺陷**：该 spec 的 esbuild `define` 只替换 `process.env.NODE_ENV`，harness 经 `purchase-payment-records → next/link → has-base-path` 间接引入的模块在初始化时读 `process.env.__NEXT_ROUTER_BASEPATH`，残留裸 `process` 访问导致 bundle 运行时崩溃（整页白屏，0 行 0 按钮）。改为与其他同类 spec 一致的整体替换 `define: {'process.env': '{"NODE_ENV":"development"}'}` 后 41/42 通过。
  2. **main2 合并引入的真实回归**（基线 5ae9fa2 对照通过、当前失败）：统一浮层底座 `Dialog`/`Drawer` 的 `onCancel` 相比原 `WorkbenchDialog` 丢了 `event.stopPropagation()`，导致嵌套浮层（采购单详情抽屉内再开"到货记录详情"抽屉）按 Escape 时 cancel 穿透到外层、连带关掉外层详情，进度区域随之消失。给两处 `onCancel` 补回 `stopPropagation()` 后 42/42 通过。

### 14.4 本轮修改
- `scripts/acceptance-run.ts`：独立验收组织为非 owner 复核账号补建 workspaceMembership（匹配正确的 assertWorkspaceAccess 校验）。
- `scripts/smoke-ops-extensions.ts`、`scripts/smoke-ext-domains.ts`：账号/组织解析改为从真实 owner 成员获取，不再拼接 id 假设。
- `tests/browser/notifications.spec.ts`、`tests/browser/operations.spec.ts`、`tests/browser/product-edit.spec.ts`：适配 main2 统一浮层底座与 ImageThumb 的 DOM/选择器。
- `tests/browser/wimoor-ui.spec.ts`：esbuild define 改为整体替换 `process.env`（修复白屏）。
- `src/components/ui/overlays.tsx`（**业务代码**）：`Dialog` / `Drawer` 的 `onCancel` 补回 `event.stopPropagation()`，修复 main2 合并丢失的嵌套浮层 Escape 隔离（恢复原 WorkbenchDialog 的正确行为）。

### 14.5 最终验证
- 服务生产形态常驻，`/api/health` 200；最终 `check:fast` EXIT=0（2367 测试 / 0 失败 / 0 cancelled、lint 0 error、typecheck 通过、ui:guard 零回退）；E2E 全部 27 个配置通过，所有修复项重跑确认。
- 未闭环（如实、均为外部环境依赖，非本轮代码可定论项）：`--gate full`（需真实 Amazon 凭据/授权/远程拓扑）、生产 EnvironmentFile 3 项注入值（`ERP_RUNTIME_MODE`/`NODE_ENV`/`AMAZON_API_EXECUTION_ROLE`）。
