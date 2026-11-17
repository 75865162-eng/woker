# 版本合并与升级状态追踪（以代码为准）

> 当前 HEAD：`cb4aaa2`（基于 `17f3c63` + 本地 AI 密钥加密改动）
> 基线来源：GitHub `75865162-eng/woker`，完整 clone（404 commits，含真实 git 历史）
> 更新时间：2026-11-18

## 一、本次完成：17f3c63 完整拉取并合并

### 版本关系（重要）
- `17f3c63`（`merge: integrate remote CI Redis fixture and readiness audit fixes`）与之前的 `03d48e4` **已分叉**：compare 显示 `ahead 220 / behind 2`，300 个文件差异
- 这是一次大版本跃迁：包名 `ppc-saas` → `tiaotiao`，Prisma schema +6296 行，migration 75 → 186，标题「PPC Pilot」→「条条 tiaotiao」
- 因此**不是线性 merge**：以完整 clone 的真实历史为底座 checkout `17f3c63`，再把本地改动重新套用

### 本地改动如何保留
- 原目录是 tarball 解压无 `.git`，先前已 `git init` 建基线；切换前把两个本地 commit 导出为 patch 备份
- 因 commit 对象不在新 `.git`，patch 无法直接 `git am`（AI 设置文件已变化），改为**逐处手动重新套用** AI 密钥加密改动
- 提交为 `cb4aaa2`，保留在 `17f3c63` 之上；`.env` 受 gitignore 保护未提交

### 环境升级（17f3c63 的硬要求）
| 项 | 变化 | 验证 |
|---|---|---|
| Node | 22.13.1 → **22.19.0**（门禁硬要求 ≥22.19，nvm 设为默认） | `node -v` ✓ |
| 依赖 | 新增 `ioredis` / `saxes`，npm install 同步 lock | ✓ |
| Prisma Client | 按新 schema 重新 generate | ✓ |
| 数据库迁移 | 增量应用 111 个新 migration（75 → 186），前 75 个名字一致无 checksum 冲突 | `All migrations applied` ✓ |
| Playwright | 安装 chromium v1243 | ✓ |
| `.env` 新增 | `ERP_RUNTIME_MODE=local`、`AUTH_PUBLIC_ORIGIN=http://localhost:3000`（生产 standalone fail-closed 必需） | ✓ |

## 二、验证结果

| 检查项 | 结果 | 说明 |
|---|---|---|
| 生产构建 `npm run build` | ✅ 通过 | middleware 35.8kB 正常编译，所有路由生成成功 |
| 测试 | ✅ 全过 | 2305 测试，0 失败（补齐 Playwright 浏览器 + tmp 目录后） |
| lint | ✅ 0 error | 4 个 warning 为上游原生 |
| 我的改动 lint | ✅ 全过 | 6 个改动文件 0 warning |
| dev 服务 | ⚠️ 见第四节 | Turbopack dev 有 `@/` 别名解析问题，改用生产模式交付 |
| 生产服务 `start:standalone` | ✅ 正常 | `/`→307 跳登录，`/login`→200，标题「条条tiaotiao」 |
| 登录（数据库+认证） | ✅ 200 | owner 角色 + 权限快照 |
| AI 密钥加密端到端 | ✅ | PUT 明文返本人；DB/版本记录**无明文**存 `aiv1.` 密文；GET 解密回显；测试 key 已清空 |

## 三、本地改动（全部已提交，未 push）

- `cb4aaa2` — 加密 AI 模型密钥落库（适配 17f3c63）
  - AES-256-GCM，复用 SP-API 主密钥 + 独立 AAD 域分离，不新增配置项
  - GET/PUT/回滚全链路加解密，兼容历史明文，缺密钥 fail-closed
  - 版本记录 payload 存密文而非明文，回滚不丢密钥
  - 新增 `ai-settings-crypto.ts`、`ai-settings-store.ts`、`ai-settings-crypto.test.ts`（7 个测试）
- 改动文件：`package-lock.json`、`src/app/api/ai-settings/route.ts`、`src/lib/server/user-ai-settings.ts` + 上述 3 个新增文件

## 四、如实留档的已知问题（非本次改动引入）

1. **dev 模式 `@/` 别名解析失败**：`scripts/next-run.mjs` 用临时 `.next-types-XXX/tsconfig.json` + `typescript.tsconfigPath` 的机制，Turbopack 编译 middleware(edge) 时把 `@/lib/auth/*` 解析到不存在的 `.next-types-XXX/workspace/woker/src/...`，导致 dev 模式 500。**生产构建与 standalone 运行完全正常**，故用生产模式交付。这是 17f3c63 上游机制问题，未擅自改其启动脚本。
2. **typecheck 3 个错误（上游原生）**：`tests/product-revision-conflict.test.ts`（`ProductEditorDraft.competitors`）、`tests/production-readiness.test.ts`（2 处 `ProcessEnv.NODE_ENV`）。已用独立 worktree 在纯净 17f3c63 上复现，**确认与本次改动无关**，未擅自修改上游测试。

## 五、运行信息

- 服务：`localhost:3000`（生产 standalone 模式，后台运行）
- 登录：`admin@local.test` / `lZa7LROlMwa7I5fbxxX3GWm`
- 数据库：docker compose `postgres:16`(healthy) + `redis:8`，186 个 migration 已应用
- 停止服务：`docker compose --env-file .env down`；停 web：按端口/进程 PID kill
- 重启：`HOSTNAME=0.0.0.0 PORT=3000 npm run start:standalone`（`HOSTNAME` 必须显式设，否则 standalone 会绑定无法解析的机器名）
- Node 版本由 nvm 管理（默认 22.19.0），任何 npm/next 命令前需 `source ~/.nvm/nvm.sh && nvm use 22.19.0`
- 未 push：改动仅在本地，无远程写操作
