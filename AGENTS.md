# AGENTS.md

这份文件给 Codex、Claude Code 和其他代码 agent 使用。进入本仓库后先读这里，再改代码。
系统要做“可迁移设计”。
也就是继续开发功能，同时慢慢把业务逻辑、数据模型、文件处理边界理清楚。等要多人使用时，再把存储层从浏览器 IndexedDB 换成后端数据库，而不是把整个系统重写
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
- Rule Center：维护 PPC 规则条件和动作，规则引擎输出 draft，不直接修改原始文件。
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
```

脚本说明：

- `npm run dev` 使用 `.next-dev`，并启用 Turbopack。
- `npm run build` 使用 `.next-build`，配置为 standalone 输出。
- `npm run lint` 运行 ESLint flat config。

## 目录地图

- `src/app/`：Next App Router 页面和 API routes。
  - `page.tsx`：首页入口。
  - `dashboard/`：PPC 数据看板。
  - `workspace/`：Bulk 文件导入和广告优化工作台。
  - `rules/`：规则编辑中心。
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

当前阶段采用 Next.js + Prisma + PostgreSQL。生产服务器文件存储使用 Cloudflare R2；本地开发可继续使用 local uploads。未来多人部署目标是 Next.js + Prisma + PostgreSQL + R2/S3-compatible object storage + Queue Worker。

- 数据库存业务数据和文件元数据；原始文件、导入文件、导出文件等二进制对象存储在 storage provider。
- 业务代码不要直接依赖 `uploads/` 本地路径，应通过 storage adapter 读写文件。
- 文件在业务层通过 `fileId` / `FileAsset` 引用，不通过磁盘路径引用。
- 长任务在业务层通过 `jobId` / `ProcessingJob` 引用；API route 负责创建任务和查询状态，处理逻辑应放在 job handler / processor。
- 当前可以使用 local storage 和 inline processor，但接口边界应兼容未来替换为 R2/S3 和 queue worker。
- 所有未来需要多人使用的数据模型，应预留 `orgId` / `userId` / ownership 边界。

## 服务器部署与更新规则

生产服务器当前资源较紧，部署时必须先按磁盘空间规划，避免把本地开发产物、旧修复目录或 Docker 构建缓存带上服务器。

- 服务器 IP：`108.61.0.221`。
- SSH 用户：`root`。
- 默认服务器目录：`/opt/amazon-ad-bulk-operation`。
- 默认访问地址：`https://108-61-0-221.sslip.io`。
- 备用直连地址：`http://108.61.0.221:3000`。注意 `3000` 端口是 HTTP，不是 HTTPS；正式访问优先使用 sslip.io HTTPS 地址。
- 服务器系统：Ubuntu 24.04 LTS x64。
- Docker 服务：`web`、`worker`、`migrate`、`postgres`、`redis`；另有 Caddy 反代容器提供 HTTPS。
- Caddy 入口：`80/443`，反代到 Docker 网络内的 `amazon-ad-bulk-operation-web-1:3000`。
- 服务器 `.env` 路径：`/opt/amazon-ad-bulk-operation/.env`。这里保存 `AUTH_SECRET`、管理员 bootstrap 配置、R2/S3 配置等敏感运行环境变量。
- 管理员登录信息保存位置：`/root/amazon-ad-bulk-credentials.txt`。不要把密码写入仓库文档。
- 生产服务器默认文件存储：Cloudflare R2，`STORAGE_DRIVER=r2`，bucket 为 `amazon-bulk-uploads`。R2/S3 密钥只允许写在服务器 `.env` 或受控密钥管理中，不要提交到仓库或写入文档。
- 部署同步必须排除大目录和历史产物：`.git`、`node_modules`、`node_modules.*`、`.next`、`.next-*`、`uploads`、`coverage`、`out`、`build`。
- 项目目录里曾出现过 `node_modules.broken-audit-fix-*`、`.next-build.broken-*`、`.next-build-stale-*` 等历史目录；这些目录绝不能同步到服务器，也不能进入 Docker build context。
- `.dockerignore` 必须持续覆盖 `node_modules.*` 和 `.next-*`；不要为了临时构建删除这些排除规则。
- 不要使用会把整个本地工作区无差别覆盖到服务器的命令。同步前先确认排除规则；优先使用带 `--exclude` 的 `rsync`。
- 服务器上的 `.env`、Docker volumes、`uploads` 属于运行态数据；除非用户明确要求，不要删除或覆盖。
- PostgreSQL 和 Redis 默认只在 Docker 网络内使用，不要重新暴露公网端口。
- `docker-compose.yml` 中的 `STORAGE_DRIVER`、`S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_FORCE_PATH_STYLE` 必须从服务器 `.env` 注入；不要写死真实密钥。
- Docker 构建应优先使用 Next standalone 产物和最小运行依赖；不要在 runner 镜像中复制完整 `node_modules`，除非已经确认磁盘和镜像体积风险。
- 小盘服务器上构建完成后，如磁盘紧张，优先运行 `docker builder prune -af` 清理 build cache；不要清理 Docker volumes。
- 每次部署后必须检查 `df -h /`、`docker compose ps`、`docker compose logs --tail=100 web` 和 `docker compose logs --tail=100 worker`。

推荐更新流程：

```bash
npm run lint
npm run build

rsync -av \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'node_modules.*' \
  --exclude '.next' \
  --exclude '.next-*' \
  --exclude 'uploads' \
  --exclude 'coverage' \
  --exclude 'out' \
  --exclude 'build' \
  ./ root@108.61.0.221:/opt/amazon-ad-bulk-operation/

ssh root@108.61.0.221
cd /opt/amazon-ad-bulk-operation
docker compose up -d --build web worker
docker compose ps
docker compose logs --tail=100 web
docker compose logs --tail=100 worker
df -h /
```

如果包含 Prisma migration，部署后要确认迁移执行成功：

```bash
cd /opt/amazon-ad-bulk-operation
docker compose run --rm migrate
```

如果 Docker build cache 占用过高，可在服务启动并验证通过后清理：

```bash
docker builder prune -af
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

改代码后按改动类型运行最低验证；无法执行的项目必须在交付报告中说明原因和风险。

| 改动类型 | 最低自动验证 | 必要的手动检查 |
| --- | --- | --- |
| 纯文档、配置或不影响运行时代码的改动 | `npm run lint`（适用时） | 检查链接、命令和配置引用有效 |
| TypeScript 类型、纯函数、store 或规则引擎 | `npm run lint`；运行相关自动化测试（如存在） | 覆盖受影响的业务规则、边界值和旧数据兼容性 |
| React 组件、页面或样式 | `npm run lint`、`npm run build` | 启动 `npm run dev`，检查受影响页面的加载、空态、loading、成功和错误状态；在桌面和移动宽度确认无溢出或重叠 |
| Next API route、鉴权、文件上传或服务端逻辑 | `npm run lint`、`npm run build`；运行相关自动化测试（如存在） | 验证成功、输入校验、未授权、失败响应；不得回显密钥或敏感请求头 |
| Prisma schema 或 migration | `npm run lint`、`npm run build`、`npx prisma validate` | 检查 migration 与 schema 一致；仅在明确授权的本地/测试数据库应用 migration，并验证升级路径 |
| Excel、PDF、导入或导出 | `npm run lint`、`npm run build` | 使用代表性文件验证上传、解析、错误提示和导出；确认导出保留原文件名、sheet、row number 及业务追溯信息 |
| AI 配置或 Listing AI | `npm run lint`、`npm run build` | 验证设置页测试连接及受影响的生成流程；确认错误信息不泄露密钥、Authorization header 或长响应体 |

页面检查按实际受影响路由选择，不要求无关页面回归：

- PPC workspace：`/workspace`
- Rule Center：`/rules`
- Dashboard：`/dashboard`
- Listing AI：`/listing-ai`
- Logistics：`/logistics`
- Settings：`/settings`
- 账户与权限：`/accounts`
- 商品工作台：`/products`
- 任务中心：`/tasks`
- 版本历史：`/versions`
- Sellfox：`/sellfox`

## 执行任务交付格式

执行任务完成时必须使用以下格式向主控汇报。不要用“已完成”代替可审查证据。

```text
结果：完成 / 部分完成 / 阻塞
分支：<branch name 或 N/A；Git 改动必须提供分支>
提交：<commit SHA 或 N/A；Git 改动必须提供 SHA>
改动文件：
- <path>：<简述>
验证：
- <command 或手动步骤>：通过 / 失败 / 未运行（原因）
页面检查：
- <route>：<检查的状态与结果；不适用则说明>
风险与待办：
- <无，或具体风险、已知限制、未执行验证及原因>
```

主控创建执行任务时必须提供目标、范围边界、验收标准和本节适用的验证项。执行任务不得自行扩大需求；审查任务以该报告和实际分支/提交为输入独立验证。

## Git 和仓库状态

当前仓库目录就是项目根目录，不需要进入额外的子目录。不要为了“清理”而重置或删除用户已有改动。修改前先确认工作目录，通常应在：

```bash
C:\Users\Administrator\Desktop\AMAZON BULK AD
```

只改和任务直接相关的文件。

## 文档维护

- `CLAUDE.md` 目前只包含 `@AGENTS.md`，用于让 Claude Code 复用本文件。除非确有需要，不要复制一份独立规则。
- 新增重要命令、目录、业务约定或外部服务时，同步更新本文件。
