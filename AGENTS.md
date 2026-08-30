# AGENTS.md

这份文件给 Codex、Claude Code 和其他代码 agent 使用。进入本仓库后先读这里，再改代码。
系统要做“可迁移设计”。
也就是继续开发功能，同时慢慢把业务逻辑、数据模型、文件处理边界理清楚。等要多人使用时，再把存储层从浏览器 IndexedDB 换成后端数据库，而不是把整个系统重写。

## 最高优先级操作原则：两端对齐、同步闭环、生产级交付

每接到一个任务，都要默认按“本地 + GitHub 两端对齐、同步闭环、生产级”的标准执行；服务器备份、发布和恢复只在你明确要求时纳入任务范围：

- 两端对齐：本地开发工作区与 GitHub 仓库的代码、配置、文档和脚本保持一致；涉及发布、配置、数据库、存储、worker、定时任务或外部服务时，只在任务明确要求时再考虑服务器影响。
- 同步闭环：任务不能只停留在代码修改；要同步必要的文档、脚本、配置、验证步骤和部署注意事项，确保下一个 agent 或人工接手时能继续执行。
- 生产级交付：改动必须考虑构建、lint、兼容性、回滚、日志、错误处理、安全和数据保护；不能把临时方案当作最终生产方案。
- 结果确认：每个任务结束前，要说明已完成什么、验证了什么、还剩什么风险或需要用户确认的事项。

## 最小化处理和验证路线

为了提高处理效率，每个任务默认走最小化处理和分级验证路线：

- 先界定最小处理范围：只读取、分析和修改与当前任务直接相关的文件、模块、脚本和文档；不要展开无关重构、全局清理或大范围代码扫描。
- 先找现有边界：优先复用当前模块、类型、store、repository、route、脚本和 UI 组件的既有模式；只有现有边界不足以完成任务时，才新增抽象。
- 验证按风险分级：小改动优先运行最贴近改动的检查；涉及共享逻辑、构建链路、数据模型、导入导出、权限、安全、AI 请求或生产部署时，再升级到 `npm run lint`、`npm run build`、页面手动验证或服务器检查。
- 避免重复验证：同一类验证不要机械重复；如果已有等价验证结果，要说明依据，把时间留给未覆盖风险。
- 结尾给出验证路线：最终回复中简要说明本次选择了哪些验证、为什么足够、哪些更高成本验证未运行以及触发条件。

## 更新分流

- 代码量小、单点修补、纯逻辑改动：优先走 `ssh patch`，即通过 SSH 直接做小范围补丁。
- 影响构建、依赖、Prisma、部署、worker、环境变量或生产数据结构：改走 CI。
- 若用户明确只要求速度，默认先选最快且风险可控的路径，再按需要升级。

# Development Principles

1. Workspace First
2. Campaign First
3. Draft First
4. Minimum Change Principle
5. Module Isolation Principle
6. Backward Compatibility
7. Rule Driven
8. AI Assist Only
9. Immutable Workbook
10. Repository First
11. Three-End Production Closure
12. Minimum Scope Verification

## Minimum Change Principle

Always make the smallest possible change that satisfies the request.

Avoid:

- Large refactoring
- Code cleanup unrelated to the task
- Renaming variables for style only
- Reorganizing folders
- Reformatting unrelated files
- Updating dependencies
## Backward Compatibility

Every modification must preserve existing functionality unless the task explicitly requests a behavior change.

Never remove or break existing features.

When introducing new functionality:

- Prefer extension over replacement.
- Preserve current APIs and data models.
- Keep existing user workflows working.

## 项目概览

这是一个本地优先的 Amazon 运营工作台，基于 Next.js 15、React 19、TypeScript、Tailwind CSS 4 构建。当前主要业务模块：

- Amazon PPC Optimization Workspace：导入 Amazon Bulk workbook，按 Campaign / Ad Group / Lifecycle / Workspace Unit 组织优化工作流，生成可审阅的调整草稿。
- Workspace 内置规则中心：维护 PPC 规则条件和动作，规则引擎输出 draft，不直接修改原始文件。
- Dashboard：展示广告指标、趋势和筛选。
- Listing AI：根据商品、关键词、广告数据和竞品信息生成 Listing 优化建议、图片计划和 A+ 模块建议。
- Logistics：处理物流相关 Excel / PDF 模板、箱规、货件对比和导出。

## 技术栈

- Framework: Next.js `^15.5.19` App Router
- UI: React `^19.2.7`, Tailwind CSS 4, lucide-react
- State: zustand
- Data / files: exceljs, xlsx, jszip, pdfjs-dist, pako, tesseract.js
- Charts: recharts
- Drag and drop: `@dnd-kit/*`
- API calls: Next Route Handlers + undici

## 重要提醒：Next.js 15

这个项目使用 Next.js 15。不要凭旧版 Next.js 经验直接改 API、缓存、路由或构建相关代码。遇到不确定的 Next 行为时，优先查看本地文档：

```bash
ls node_modules/next/dist/docs
```

项目通过 `scripts/next-run.mjs` 为 dev/build 使用不同的 dist 目录，避免 `.next` 状态互相污染。

## 常用命令

在项目根目录运行：

```bash
npm run dev
npm run build
npm run lint
npm run test
npm run check
```

脚本说明：

- `npm run dev` 使用 `.next-dev`，并启用 Turbopack。
- `npm run build` 使用 `.next-build`，配置为 standalone 输出。
- `npm run lint` 运行 ESLint flat config。
- `npm run test` 运行不依赖数据库、外部服务或密钥的核心业务回归测试。
- `npm run check` 依次运行测试、lint 和生产构建，适合作为每次更新后的完整本地健康检查。

## 目录地图

- `src/app/`：Next App Router 页面和 API routes。
  - `page.tsx`：首页入口。
  - `dashboard/`：PPC 数据看板。
  - `workspace/`：Bulk 文件导入和广告优化工作台。
  - `workspace/` 内已集成规则中心，不再保留独立 `/rules` 页面。
  - `listing-ai/`：Listing AI 工作台。
  - `logistics/`：物流文件处理工作台。
  - `settings/`：AI 模型配置等设置页。
  - `api/listing-ai/optimize/route.ts`：Listing AI 优化接口。
  - `api/ai-settings/test-chat/route.ts`：AI 配置连通性测试接口。
- `src/components/`：按业务区组织的客户端组件。
  - `app-shell/`：全局侧边导航、页面壳、错误边界。
  - `ui/`：轻量通用 UI 组件，如 Button / Card / Badge。
  - `workspace/`、`rule-builder/`、`dashboard/`、`listing-ai/`、`logistics/`：业务组件。
- `src/lib/`：业务逻辑、类型、状态和工具函数。
  - `types.ts`：PPC workspace、规则、指标、draft 等核心类型。
  - `stores/workspace-store.ts`：PPC 工作台 zustand store 和导入/匹配/持久化逻辑。
  - `repositories/workspace-repository.ts`：IndexedDB 本地 snapshot。
  - `rule-engine/engine.ts`：规则引擎。
  - `excel/bulk-export.ts`：PPC Bulk workbook 导出。
  - `listing-ai/`：Listing AI prompt、client、类型。
  - `logistics/`：物流 Excel / PDF 解析和导出逻辑。
  - `server/ai-fetch.ts`：服务端 AI 请求，包含系统代理探测。
- `src/data/`：mock data 和默认规则。
- `src/workers/`：浏览器 worker，目前用于 Excel 解析。
- `docs/`：PPC 工作台、数据模型、导出、规则、UI、物流等规格文档。
- `public/logistics-templates/`：物流导出使用的模板文件。
- `scripts/next-run.mjs`：为 Next dev/build 指定不同 distDir。

## 业务边界

- PPC 工作台的核心抽象是 Campaign Group、Lifecycle Group、Workspace Unit、Rule、Adjustment Draft。不要把导入的 workbook 当作唯一状态源。
- 规则引擎应生成草稿，由用户选择后再导出；不要让规则自动直接覆盖原始数据。
- `workspace-store.ts` 当前承担较多状态和数据转换职责。新增复杂逻辑时优先放到 `src/lib/*` 的纯函数模块，再由 store 调用。
- IndexedDB snapshot 是本地恢复机制。改 state shape 时要考虑旧 snapshot 的兼容性或降级处理。
- Listing AI 的输出结构由 `src/lib/listing-ai/types.ts` 定义，改 prompt 或 client 时要保持 UI 消费字段稳定。
- Logistics 模块依赖实际 Excel/PDF 模板和中文字段名，改解析逻辑前先看 `src/lib/logistics/types.ts`、`excel.ts`、`pdf.ts` 以及 `public/logistics-templates/`。

## 可迁移部署架构

当前阶段采用 Next.js + Prisma + PostgreSQL + local uploads。未来服务器部署目标是 Next.js + Prisma + PostgreSQL + R2/S3-compatible object storage + Queue Worker。

- 数据库存业务数据和文件元数据；原始文件、导入文件、导出文件等二进制对象存储在 storage provider。
- 业务代码不要直接依赖 `uploads/` 本地路径，应通过 storage adapter 读写文件。
- 文件在业务层通过 `fileId` / `FileAsset` 引用，不通过磁盘路径引用。
- 长任务在业务层通过 `jobId` / `ProcessingJob` 引用；API route 负责创建任务和查询状态，处理逻辑应放在 job handler / processor。
- 当前可以使用 local storage 和 inline processor，但接口边界应兼容未来替换为 R2/S3 和 queue worker。
- 所有未来需要多人使用的数据模型，应预留 `orgId` / `userId` / ownership 边界。

## 服务器部署与更新规则

本节是生产服务器部署与更新的唯一仓库内记录。新开窗口接手服务器更新时，先读本节；不要依赖散落在其他文档或聊天记录里的部署规则。

生产服务器当前资源较紧，部署时必须先按磁盘空间规划，避免把本地开发产物、旧修复目录或 Docker 构建缓存带上服务器。

- 服务器 IP：`159.75.203.221`。
- SSH 用户：`ubuntu`。
- 默认服务器目录：`/opt/amazon-ad-bulk-operation`。
- 正式访问地址：`https://aecob.com`。
- 服务器系统：Ubuntu 24.04 LTS x64。
- 生产架构：PostgreSQL 和 Redis 使用 Docker；Next web 和 worker 使用服务器本机 Node.js + systemd；Caddy 使用 Docker 反代到本机 web。
- Docker Compose 只管理 infra：`postgres`、`redis`。不要再为普通代码更新执行 `docker compose up -d --build web worker`。
- systemd 服务：`amazon-web`、`amazon-worker`。
- UFW 必须允许 `22/tcp`、`80/tcp`、`443/tcp`；`3000`、`5432`、`6379` 不开放公网。
- Caddy 证书和配置使用 Docker volumes `amazon-caddy-data`、`amazon-caddy-config` 持久化；不要无备份删除这些 volumes。
- 服务器 `.env` 路径：`/opt/amazon-ad-bulk-operation/.env`。这里保存 `AUTH_SECRET`、管理员 bootstrap 配置、R2/S3 配置等敏感运行环境变量。
- 管理员登录信息保存位置：`/root/amazon-ad-bulk-credentials.txt`。不要把密码写入仓库文档。
- 生产服务器默认文件存储：Cloudflare R2，`STORAGE_DRIVER=r2`，bucket 为 `amazon-bulk-uploads`。R2/S3 密钥只允许写在服务器 `.env` 或受控密钥管理中，不要提交到仓库或写入文档。
- 本地开发可继续使用 `STORAGE_DRIVER=local` 和 `uploads/`。更新生产系统时，不要把本地 local uploads 覆盖到服务器，也不要把生产 R2 设置改回 local。
- 部署同步必须排除大目录和历史产物：`.git`、`node_modules`、`node_modules.*`、`.next`、`.next-*`、`uploads`、`coverage`、`out`、`build`。
- 项目目录里曾出现过 `node_modules.broken-audit-fix-*`、`.next-build.broken-*`、`.next-build-stale-*` 等历史目录；这些目录绝不能同步到服务器。
- 不要使用会把整个本地工作区无差别覆盖到服务器的命令。同步前先确认排除规则；优先使用带 `--exclude` 的 `rsync`。
- 服务器上的 `.env`、Docker volumes、`uploads` 属于运行态数据；除非用户明确要求，不要删除或覆盖。
- PostgreSQL 和 Redis 只绑定 `127.0.0.1:5432`、`127.0.0.1:6379`，不要暴露公网端口。
- 生产 `.env` 中 `DATABASE_URL` 应指向 `127.0.0.1:5432`，`REDIS_URL` 应指向 `127.0.0.1:6379`。
- 本机生产进程必须使用 `npm run build` 后的 standalone 输出，web 启动命令是 `npm run start:standalone`，不要用 `npm run dev` 跑公网。
- worker 由 systemd 执行 `npm run worker`。服务器发布脚本会用 `node_modules/.package-lock.sha256` 判断依赖是否变化；`package-lock.json` 未变时跳过 `npm ci`。
- 仓库不保留应用 Dockerfile；生产应用进程只走本机 Node.js + systemd。不要为 web/worker 恢复 Docker build，除非用户明确要求重新容器化。
- 服务器发布脚本负责启动 Docker infra、Prisma generate、Prisma migrate deploy、bootstrap admin seed、Next standalone build、生成 release 目录、切换 current symlink、重启 `amazon-web` / `amazon-worker`、重建 Caddy 容器。
- 发布产物目录：`/opt/amazon-ad-bulk-releases/<timestamp>-<branch>-<commit>`。
- 当前线上版本软链接：`/opt/amazon-ad-bulk-current`。`amazon-web` 和 `amazon-worker` 都从该 symlink 启动，保证 web/worker 版本一致。
- 发布记录文件：`/opt/amazon-ad-bulk-release-log.jsonl`。每次部署和回滚都应追加记录。
- release 目录只保存运行所需的 standalone、源码、脚本、Prisma 和 public；`node_modules` 通过 symlink 共享 `/opt/amazon-ad-bulk-operation/node_modules`，避免复制大依赖。
- 默认只保留最近 5 个 release。可通过服务器环境变量 `KEEP_RELEASES` 临时调整；不要为了省空间删除当前 release 或 Docker volumes。
- 小盘服务器上如果历史 Docker build cache 占用过高，可在服务启动并验证通过后运行 `docker builder prune -af`；不要清理 Docker volumes。
- 每次部署后必须检查 `df -h /`、`docker compose ps`、`systemctl status amazon-web amazon-worker`、`journalctl -u amazon-web -u amazon-worker -n 100 --no-pager`。

推荐更新流程（优先 CI artifact 发布）：

```bash
npm run lint
npm run build
bash scripts/package-ci-artifact.sh
bash scripts/deploy-ci-artifact.sh dist/amazon-ad-bulk-operation-release.tar.gz
```

这条路径由 CI 或本机先完成 build，服务器只解压 artifact、执行 Prisma migrate、切换 release 并重启 systemd，不在服务器执行 `npm run build`。普通部署默认不执行 bootstrap seed；只有初始化环境时才临时设置 `RUN_BOOTSTRAP_SEED=true`。

当任务明确需要发布到服务器时，默认沿用这条 CI artifact 链路，不再把 build 放回服务器；只有明确的 fallback 或应急修复才走源码发布脚本。

服务器源码构建发布仍保留为 fallback：

```bash
npm run lint
npm run build

bash scripts/deploy-native-server.sh
```

如果包含 Prisma migration，部署后要确认迁移执行成功：

```bash
cd /opt/amazon-ad-bulk-operation
npm run db:migrate
```

服务器侧快速手动发布流程：

```bash
cd /opt/amazon-ad-bulk-operation
bash scripts/server-native-release.sh
```


## UI 与交互约定

- 整体是工具型 SaaS，不是营销落地页。优先信息密度、可扫描性、稳定布局和明确操作。
- 复用 `src/components/ui/` 中已有 Button / Card / Badge，避免随手新增一套视觉语言。
- 色彩变量在 `src/app/globals.css`，优先使用 `bg-brand`、`text-muted`、`border-border` 等语义类。
- 图标优先使用 lucide-react。
- 组件中可使用中文业务文案；代码标识符保持英文。
- 不要在小面板里使用过大的 hero 字号。表格、工具栏、侧栏、卡片标题要紧凑。
- 对文件上传、解析、导出、AI 请求等流程，要提供 loading、success、error 和空状态。

## 数据和文件处理

- Excel workbook 处理优先使用 exceljs / xlsx 等结构化 API，不要用字符串拼接伪造表格。
- PDF 解析逻辑集中在 Logistics 模块，注意浏览器端兼容和大文件性能。
- 批量导入可能有大 workbook，避免在渲染路径里做重计算；必要时使用 worker、memo 或分块处理。
- 导出文件必须保留用户可追溯的信息，例如原文件名、sheet、row number、campaign/ad group/key。

## AI 配置和安全

- 不要新增硬编码 API Key、Token、Secret。
- 当前 `src/lib/ai-settings.ts` 中已有 provider 默认配置和示例 key 字段；涉及这里时优先向环境变量、本地用户配置或显式输入迁移。
- 服务端 AI 请求走 `src/lib/server/ai-fetch.ts`，它会读取环境代理或 macOS 系统代理。
- API route 返回错误时不要回显完整密钥、Authorization header 或长响应体。

## 代码风格

- TypeScript strict 已开启。新增类型时尽量从业务模型表达，不要滥用 `any`。
- 使用路径别名 `@/*` 指向 `src/*`。
- 客户端组件需要浏览器 API、hooks、zustand 时必须带 `"use client"`。
- Server route handler 中需要 Node 能力时声明 `export const runtime = "nodejs"`。
- 保持函数小而清晰。解析、归一化、计算指标等逻辑优先写成可测试纯函数。
- 不要随意重排大文件或做无关格式化，避免污染 diff。

## 验证清单

改代码后按风险选择验证：

```bash
npm run lint
npm run build
```

涉及 UI 的改动应启动：

```bash
npm run dev
```

然后在浏览器检查对应页面：

- `/workspace`
- `/dashboard`
- `/listing-ai`
- `/logistics`
- `/settings`

涉及 Excel / PDF / AI 的改动，至少手动跑一遍对应上传、解析、导出或测试连接流程。

## Git 和仓库状态

当前仓库目录就是项目根目录，不需要进入额外的子目录。不要为了“清理”而重置或删除用户已有改动。修改前先确认工作目录，通常应在：

```bash
C:\Users\Administrator\Desktop\AMAZON BULK AD
```

只改和任务直接相关的文件。

执行任何 `git stash`、`git stash push`、`git stash pop`、`git stash apply`、`git stash drop`、`git stash clear` 或等价暂存/恢复操作前，必须先向用户说明原因、影响范围和准备执行的命令，并获得用户明确同意；不得为了切分任务、部署、同步或清理工作区而擅自 stash 用户改动。

## 文档维护

- `CLAUDE.md` 目前只包含 `@AGENTS.md`，用于让 Claude Code 复用本文件。除非确有需要，不要复制一份独立规则。
- 新增重要命令、目录、业务约定或外部服务时，同步更新本文件。
