# 方案 A：CLI 配置入口盘点与 Listing AI 后台化草案

状态：仅审阅草案；未修改 Prisma/schema、业务 API、注册表、真实配置或部署。后续实现须按下述具体范围确认，本文不是运行授权。

后续实施更新：ops-cli 的下述最小 diff 已应用，并通过帮助命令/拒绝旧配置、业务权限及 runtime 回归。其余工具入口与 AI 草案保持未实施。

## CLI 配置入口

本次按 package.json、runtime 目录及显式 dotenv/Next env 引用盘点，不执行维护命令。

| 入口 | 当前行为 | 建议精确后续范围 |
| --- | --- | --- |
| dev/build/start、standalone、四类 Worker | runtime/environment.mjs；构建另有 build 校验语义 | 保持现有边界 |
| amazon-sync-live-preflight.mjs | 本轮改为 runtimeEnvironment，固定脱敏错误报告 | 已实施；无网络、无数据库连接 |
| scripts/ops-cli.ts | @next/env loadEnvConfig，可能读取 Next 额外 env | 移除 loadEnvConfig import，导入 applyRuntimeEnvironment；main 中原加载位置调用统一 loader。保留 --help 不加载配置及只读事务/审计/权限。为冲突和额外 env 增加无真实库测试 |
| prisma.config.ts | import dotenv/config；直接 env(DATABASE_URL) | 不直接切换：Prisma generate 与 schema 校验可能不需要 Redis，不能无差别调用 runtimeEnvironment 非 build 分支。先提供统一 loader 的数据库工具校验模式（仍拒绝第二来源和连接冲突，生成可无连接），再审阅 config、generate/migrate/fixture 三类测试的精确 diff。不得让 fixture 加载根 .env |
| scripts/benchmark-product-domain.ts | import dotenv/config，package 命令还带 --env-file=.env | 后续移除重复 dotenv，改用统一工具加载入口并去掉 package 的 --env-file。真实 benchmark 仍须具体目标授权，不据此运行 |
| db seed、roster、商品 refresh/repair/scan/backfill、Sellfox backfill/fixture/reparse/reset | package scripts 使用 node --env-file=.env，不经过冲突/loopback 校验 | 后续新增一个工具 bootstrap 并逐个替换这些精确命令；不改变各脚本的 dry-run、--apply/--write、角色和范围校验。先确认工具所需变量，不强迫所有数据库维护依赖 Redis 可用 |
| erp、selection CLI | 已读入口未见 runtime loader；使用显式进程环境，selection 还使用研究配置文件 | 区分离线文件研究与 ERP 读写命令：只在访问业务库/上传前进入统一工具入口；不把研究参数文件误当成运行凭据文件删除。需另审阅对应 write/get/upload 分支及 fixture runner |
| 各 test:*:integration runner | 新建临时服务，白名单环境及独立 Prisma config；部分旧 fixture 使用 DOTENV_CONFIG_PATH=/dev/null | 保留隔离例外；不改成读取真实根 .env。fixture 专用环境标志不能作为正常应用第二配置来源 |
| preflight-amazon-four-domains/identity-recovery/product-details | 显式进程环境、声明无 dotenv 的只读工具 | 不执行。统一入口改动应保持输出脱敏及只读，不自动继承真实凭据或扩展范围 |

必要修改分组：先独立处理 ops-cli 的单点差异，再处理 Prisma/维护 CLI 的工具校验模式。方案 A 不顺带修改这些业务入口；后续审阅需给出完整 diff，避免将应用启动所需 Redis 变量强加到纯代码生成命令上。

ops-cli 最小 diff 供后续审阅，本轮不应用、不执行命令：

```diff
--- a/scripts/ops-cli.ts
+++ b/scripts/ops-cli.ts
@@
-import { loadEnvConfig } from "@next/env";
+import { applyRuntimeEnvironment } from "./runtime/environment.mjs";
@@
-  // Same server-side env loading as Next; never prints configuration or credentials.
-  loadEnvConfig(process.cwd());
+  // Reuse the same configuration and conflict checks as web and Workers.
+  applyRuntimeEnvironment();
```

## Listing AI 的现有调用方与兼容边界

- 页面：`src/components/listing-ai/listing-ai-workbench.tsx` 的优化操作 POST `/api/listing-ai/optimize`，等待 `{ result }`，随后更新输出面板、保存页面工作记录并切到 analysis 标签。
- API：`src/app/api/listing-ai/optimize/route.ts` 校验 listingAi:create 与四个必填字段后，直接 await optimizeListing；结果由 `src/lib/listing-ai/types.ts` 约束。
- 模型配置：请求可携带 aiSettings（包括 apiKey）；`src/lib/server/ai-runtime.ts` 可合并请求覆盖和服务端环境配置。不能把请求对象原样存入任务表或 BullMQ。
- 现有 AgentTask 是 agent execution 体系的一部分，已读模型未包含 Listing AI 所需 workspace/user/lease/provider dispatch 生命周期；不能仅复用其名字就宣称具备安全恢复。现有 ImageUpscaleJob 仅用于图片放大，不能混存 Listing 优化任务。
- 本草案仅覆盖 optimize；chat、generate-title、generate-description、generate-images 保持各自契约，不能把本轮结果描述为全部 AI 已后台化。

## 最小后台化设计（未实施）

新增单用途 ListingOptimizationJob，复用现有 Prisma/Storage/BullMQ/Worker manager；不建立新调度框架。新队列 `listing-optimization-jobs`，独立 registration `listing-optimization`，低并发起步；CPU、内存和供应商并发成本须在实施前确认。

建议模型字段草案（不是可执行 migration）：

```prisma
model ListingOptimizationJob {
  id                  String   @id @default(cuid())
  organizationId      String
  workspaceId         String
  userId              String
  clientRequestId     String
  status              String   @default("queued")
  input               Json
  result              Json?
  modelConfigRef      String
  modelConfigRevision Int
  executionToken      String?
  leaseExpiresAt      DateTime?
  executionAttempts   Int      @default(0)
  dispatchState       String   @default("not_started")
  providerRequestId   String?
  errorCode           String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@unique([organizationId, workspaceId, userId, clientRequestId])
  @@index([status, leaseExpiresAt])
  @@index([organizationId, workspaceId, userId, createdAt])
}
```

正式 schema 应补全与 Organization/User/Workspace 的关系/约束、状态枚举、输入大小/结果校验与审计；草案字符串不代表允许任意状态。input 仅含允许的商品/关键词文案，不含 aiSettings.apiKey、授权头、完整连接串或密钥。记录只供当前组织/工作区内授权用户读取；默认本人任务，管理员扩展可见范围须有明确权限，不只依赖前端入口隐藏。

凭据前置条件：modelConfigRef 必须引用服务端可授权、可按 revision 读取的配置；现有请求临时 apiKey 没有持久化凭据引用时，不允许静默落库或丢弃覆盖。本阶段应先设计复用现有 AiModelSetting/密钥管理的授权和加密边界；未确认前，新后台端点拒绝仅带临时密钥的任务并返回固定错误。旧同步端点继续保持旧行为，不能以“兼容”为由双投递同一次请求。

已核对 AiModelSetting 当前只有 settings/profiles JSON 与 updatedAt，没有专用 revision 或凭据引用字段；modelConfigRevision 是建议契约，不是现有能力。正式方案须明确配置快照版本、加密及生命周期，不把 updatedAt 当成已具备可靠密钥版本管理的证明。

新增 API 草案：

| API | 请求与返回 | 服务端约束 |
| --- | --- | --- |
| POST /api/listing-ai/jobs | 允许的优化 input、clientRequestId、服务端配置引用；202 `{jobId,status,dispatchDeferred}` | listingAi:create、有效成员与 workspace；租户内幂等；数据库事务保存任务/审计后投递 jobId；Redis 故障保留 queued |
| GET /api/listing-ai/jobs/:id | `{jobId,status,result?,errorCode?}` | 授权与租户/本人过滤；result 保持 ListingOptimizationResult；无 token/密钥/raw 上游错误 |

客户端在后台功能启用时切换提交/轮询，未启用时保留旧 POST `{result}` 路径；每次用户提交只选择一条路径，轮询失败不得自动重新创建任务。成功后复用现有 setResult/saveRecord/标签流转。旧 optimize 不改变响应类型；通过显式开关回滚页面路径，新任务仍保留查询，不自动重放。

恢复规则：queued 可从 PostgreSQL 重建队列；执行前实时复核角色、工作区和模型配置 revision。CAS 领取与事务发布校验复用租约模式，但外部请求前必须先持久化 dispatchState。发出请求后超时或进程失联属于 outcome_unknown，禁止直接按过期 running 自动再调用计费 API；只有供应商提供已核验的幂等键或结果查询能力才能自动恢复，否则标为 needs_review，用户审阅后另建请求。即使供应商无法保证幂等，旧 token 仍不得覆盖已确认结果。仅允许尚未发出外部请求的过期任务自动重排。

验证与发布：mock provider 覆盖角色撤销、跨 workspace/用户访问、重复提交、Redis 丢失、DB 中断、请求前/后强杀、未知外部结果、旧执行器发布；浏览器验证等待、失败、恢复查询及结果面板。无真实计费调用。实施涉及 schema/API/UI/注册与 systemd，须另批准精确迁移、资源预算及 CI 发布范围；不在本轮执行。
