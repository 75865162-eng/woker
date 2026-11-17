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
