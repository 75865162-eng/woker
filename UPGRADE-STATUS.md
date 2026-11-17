# 版本合并与升级状态追踪（以代码为准）

> 当前 HEAD：`e1d5260`（17f3c63 主线 + 全分支功能合并 + 本地安全加固）
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
