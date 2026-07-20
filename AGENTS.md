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

在 `repo/` 目录运行：

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
- `/rules`
- `/dashboard`
- `/listing-ai`
- `/logistics`
- `/settings`

涉及 Excel / PDF / AI 的改动，至少手动跑一遍对应上传、解析、导出或测试连接流程。

## Git 和仓库状态

当前仓库可能有根目录到 `repo/` 的迁移痕迹，git status 里可能同时出现根目录文件删除和 `repo/` 文件新增/修改。不要为了“清理”而重置或删除用户已有改动。修改前先确认工作目录，通常应在：

```bash
/Users/chenjieliang/Documents/amazon ad bulk operation/repo
```

只改和任务直接相关的文件。

## 文档维护

- `CLAUDE.md` 目前只包含 `@AGENTS.md`，用于让 Claude Code 复用本文件。除非确有需要，不要复制一份独立规则。
- 新增重要命令、目录、业务约定或外部服务时，同步更新本文件。
