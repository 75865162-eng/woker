# 开发与模块约定

## 文档分层与页面查询

项目定义与实现状态分开维护。AGENTS.md 中的模块职责说明不证明相应功能已完成；页面、API、权限和可执行能力须核对当前代码。

| 内容 | 维护位置 | 使用方式 |
| --- | --- | --- |
| 项目概览、核心模块、术语、数据边界、全局开发规则 | `AGENTS.md` | 进入项目先读 |
| 页面名称、实际路由、源码入口和模块功能 | 本文目录地图及相关模块文档 | 按任务查询，改名或迁移时同步对应定义 |
| 操作、字段、交互、API 契约与验收标准 | 对应模块专项文档 | 仅实现该流程时阅读 |
| 实际实现与能力状态 | 当前路由、导航、UI、服务和测试代码 | 不用历史说明替代核验 |

跨模块调用遵循已有服务/API/交接合同；页面可访问、工具已列出或研究已有结果，都不意味着已获写入／执行权限。


<!-- AGENTS migration 2026-11-08: original lines 100-203 -->

仅按任务阅读相关模块；版本以 package.json 为准，源码路径使用当前仓库。

## 项目概览

这是一个以本地优先工作流为基础、同时包含后端商品主数据域的 Amazon 运营工作台，基于 Next.js 15、React 19、TypeScript、Tailwind CSS 4 构建。PPC Workspace 仍可使用 IndexedDB snapshot 做本地恢复；Product Center 商品主数据已经以 PostgreSQL 为事实源，不要把两个域混为同一套存储策略。当前主要业务模块：

- Amazon PPC Optimization Workspace：导入 Amazon Bulk workbook，按 Campaign / Ad Group / Lifecycle / Workspace Unit 组织优化工作流，生成可审阅的调整草稿。
- Workspace 内置规则中心：维护 PPC 规则条件和动作，规则引擎输出 draft，不直接修改原始文件。
- Dashboard：展示广告指标、趋势和筛选。
- Listing AI：根据商品、关键词、广告数据和竞品信息生成 Listing 优化建议、图片计划和 A+ 模块建议。
- Logistics：处理物流相关 Excel / PDF 模板、箱规、货件对比和导出。

商品域路径边界以 `docs/product-domain-phase0.md` 和 `docs/product-domain-simple-architecture-plan.md` 为准：`ProductRecord` 是商品核心资料唯一事实源，保存经过 PostgreSQL transaction、revision、Audit/DataChangeVersion 和 Outbox；Projection、Read Model 和 Cache 都是可重建的派生层。当前列表主读路径仍是 `ProductSummaryRecord + ProductTextRecord`，详情主路径是 `ProductDetailService` 直接聚合 `ProductRecord` 和必要关联数据，不要把所有商品查询强制经过 Redis 或 Projection。已废弃的独立 Sellfox 商品资料和图片文案 Gallery 路径不得作为备用读写实现恢复。Sellfox 店铺、小时指标和产品表现快照属于报表数据，单独管理。

## 技术栈

- Framework: Next.js 15（具体版本见 `package.json`） App Router
- UI: React 19（具体版本见 `package.json`）, Tailwind CSS 4, lucide-react
- State: zustand
- Data / files: exceljs, xlsx, jszip, pdfjs-dist, pako, tesseract.js
- Charts: recharts
- Drag and drop: `@dnd-kit/*`
- API calls: Next Route Handlers + undici

## 重要提醒：Next.js 15

认证壳和业务页面性能回归规则及 fixture 验证见 `docs/performance-regression.md`；修改公共壳、身份、权限或 Provider 时先测量基线。

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
npm run test:e2e
npm run check
npm run products:refresh-derived
npm run products:repair-projections
npm run products:scan-statuses
```

脚本说明：

- `npm run dev` 使用 `.next-dev`，并启用 Turbopack。
- `npm run build` 使用 `.next-build`，配置为 standalone 输出。
- `npm run lint` 运行 ESLint flat config。
- `npm run test` 运行不依赖数据库、外部服务或密钥的核心业务回归测试。
- `npm run test:e2e` 使用 Playwright 模拟隔离测试账号完成登录、Bulk/Overall 上传、分组、规则运行、保存恢复和导出；必须设置 `E2E_TEST_EMAIL`、`E2E_TEST_PASSWORD`，可用 `E2E_BASE_URL` 指定测试环境。
- `npm run check:fast` 运行核心测试、lint 和类型检查；API、筛选、summary 或共享逻辑改动时运行。
- `npm run check` 依次运行测试、lint 和生产构建；用于准备合码/上线的完整检查，不作为日常小改动默认验证。构建链、依赖、Prisma、权限改动按需执行针对性检查；合码/上线闭环运行完整检查，并配合 `git diff --check`。
- `npm run products:refresh-derived` 刷新商品列表派生字段、重建商品摘要表并清理过期商品列表缓存；涉及商品状态、负责人、超期逻辑或生产定时维护时使用。
- `npm run products:repair-projections` 以 `ProductRecord` 为事实源，分批重建 `ProductSummaryRecord` / `ProductTextRecord` 和列表汇总；只在人工维护或投影漂移排查时执行，不在服务启动时运行。
- `npm run products:scan-statuses` 只读扫描 `ProductRecord.status` 是否属于产品状态枚举；发现非法状态时以退出码 2 结束，不自动修改数据。

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
- `docs/product-domain-simple-architecture-plan.md`：Product Center 当前性能审计、读模型/缓存责任、benchmark 门槛和后续架构收口规划。
- `public/logistics-templates/`：物流导出使用的模板文件。
- `scripts/next-run.mjs`：为 Next dev/build 指定不同 distDir。

## 业务边界

- Lili MCP 是本 ERP 系统向 AI 提供的工具与数据接口，使 AI 能通过 MCP 调用 ERP 中的 Amazon 业务数据及相关功能。Lili MCP 不是聊天工具；聊天由 AI 客户端承载，Lili MCP 提供 ERP 工具与数据访问能力。
- PPC 工作台的核心抽象是 Campaign Group、Lifecycle Group、Workspace Unit、Rule、Adjustment Draft。不要把导入的 workbook 当作唯一状态源。
- 规则引擎应生成草稿，由用户选择后再导出；不要让规则自动直接覆盖原始数据。
- `workspace-store.ts` 当前承担较多状态和数据转换职责。新增复杂逻辑时优先放到 `src/lib/*` 的纯函数模块，再由 store 调用。
- IndexedDB snapshot 是本地恢复机制。改 state shape 时要考虑旧 snapshot 的兼容性或降级处理。
- 选品本地证据表单为 `/agents/market/selection`，复用 selection pipeline 校验与 `.pipeline.lock`；本机目录按 `SELECTION_ORGANIZATION_ID` / `SELECTION_WORKSPACE_ID`（默认 `default`）限制组织/工作区，缺显式组织绑定时仅限数据库唯一组织。Market 上传 draft 仍为只读机会输入；详细边界见 `docs/selection-round-d.md`“网页表单兜底”。
- Listing AI 的输出结构由 `src/lib/listing-ai/types.ts` 定义，改 prompt 或 client 时要保持 UI 消费字段稳定。
- Logistics 模块依赖实际 Excel/PDF 模板和中文字段名，改解析逻辑前先看 `src/lib/logistics/types.ts`、`excel.ts`、`pdf.ts` 以及 `public/logistics-templates/`。


<!-- AGENTS migration 2026-11-08: original lines 333-394 -->
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

按上方分级规则选择验证，不默认执行完整检查或 E2E：

```bash
# UI / 局部状态：相关测试（无对应测试时说明）+ TypeScript
# API / 筛选 / summary / 共享逻辑：
npm run check:fast
# 准备合码 / 上线：
npm run check
git diff --check
```

仅当任务验收明确要求手动页面检查时，才启动：

```bash
npm run dev
```

然后在浏览器检查对应页面：

- `/workspace`
- `/dashboard`
- `/listing-ai`
- `/logistics`
- `/settings`

涉及 Excel / PDF / AI 的改动，按风险选择隔离上传、解析、导出或模拟连接验证；真实连接仍需独立批准，不因本清单自动执行。
