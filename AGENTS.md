# AGENTS.md

这份文件给 Codex、Claude Code 和其他代码 agent 使用。进入本仓库后先读这里，再改代码。
系统要做“可迁移设计”。
也就是继续开发功能，同时慢慢把业务逻辑、数据模型、文件处理边界理清楚。PPC Workspace 的 IndexedDB 用于本地恢复与浏览器缓存，服务端快照、草稿记录等已由数据库承载；Product Center 商品主数据以 PostgreSQL 为事实源。新增多人数据应沿现有服务端存储边界扩展，不把 IndexedDB 描述为未来才迁移的唯一存储层。

## 长期安全审批规则

任何涉及真实数据、外部 API、凭证、配置写入、配置上传、生产环境或不可逆操作的行为，默认禁止执行。必须先提供具体、可审阅的变更方案，并等待用户针对该方案明确批准。用户批准某一项操作，不代表批准后续相关操作；如果目标环境、文件、范围、配置内容或影响发生变化，必须重新提交方案并等待批准。

未经批准，只允许只读检查、风险分析、生成变更方案、生成脱敏 diff、编写但不执行的脚本，以及在隔离环境使用 mock 数据进行验证。不得修改、覆盖、删除或上传真实配置，不得调用真实外部 API，不得启动真实任务、生产任务、迁移、部署、重启、回滚或清理真实数据。

## 最高优先级操作原则：两端对齐、同步闭环、生产级交付

每接到一个任务，都要默认按“本地 + GitHub 两端对齐、同步闭环、生产级”的标准执行；服务器备份、发布和恢复只在你明确要求时纳入任务范围：

- 两端对齐：本地开发工作区与 GitHub 仓库的代码、配置、文档和脚本保持一致；涉及发布、配置、数据库、存储、worker、定时任务或外部服务时，只在任务明确要求时再考虑服务器影响。
- 全改动区同步：执行备份到 GitHub、两端对齐、三端对齐或更新到服务器时，必须把当前工作区改动区里的所有已修改、已删除和未跟踪改动一起纳入盘点、提交、打包、发布或同步范围；不能只处理当前聊天窗口产生的改动。若发现与当前任务无关但已存在的改动，要在同步前说明并按用户确认的范围处理，不得悄悄遗漏。
- 性能影响预告：如果一个要求或改动可能让系统变慢、增加明显资源消耗、降低 P95 性能、拖慢构建/导入/导出/查询/渲染/AI 请求等关键路径，必须先向用户说明影响、风险和替代方案，获得确认后再改动。
- 全局影响预告：如果一个要求或改动可能影响全局行为、共享数据模型、权限体系、路由/API 契约、构建配置、部署流程、存储边界、worker/定时任务或多个业务模块，必须先向用户说明影响范围、回滚方式和验证计划，获得确认后再改动。
- 同步闭环：任务不能只停留在代码修改；要同步必要的文档、脚本、配置、验证步骤和部署注意事项，确保下一个 agent 或人工接手时能继续执行。
- 生产级交付：改动必须考虑构建、lint、兼容性、回滚、日志、错误处理、安全和数据保护；不能把临时方案当作最终生产方案。
- 结果确认：每个任务结束前，要说明已完成什么、验证了什么、还剩什么风险或需要用户确认的事项。

## 最小化处理和验证路线

为了提高处理效率，每个任务默认走最小化处理和分级验证路线：

- 先界定最小处理范围：只读取、分析和修改与当前任务直接相关的文件、模块、脚本和文档；不要展开无关重构、全局清理或大范围代码扫描。
- 先找现有边界：优先复用当前模块、类型、store、repository、route、脚本和 UI 组件的既有模式；只有现有边界不足以完成任务时，才新增抽象。
- 验证按以下固定级别执行，不默认跑满套：UI 或局部状态改动只运行相关测试（没有对应测试时说明）和 TypeScript；API、筛选、summary 或共享逻辑改动运行 `npm run check:fast`，也可按风险缩小到相关测试与类型检查。构建链、依赖、Prisma、权限改动做针对性专项验证；完整 `npm run check` 与 `git diff --check` 留给准备合码/上线的检查闭环。E2E、手动页面和服务器检查只在改动风险或任务验收明确需要时运行。
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

这是一个以本地优先工作流为基础、同时包含后端商品主数据域的 Amazon 运营工作台，基于 Next.js 15、React 19、TypeScript、Tailwind CSS 4 构建。PPC Workspace 仍可使用 IndexedDB snapshot 做本地恢复；Product Center 商品主数据已经以 PostgreSQL 为事实源，不要把两个域混为同一套存储策略。当前主要业务模块：

- Amazon PPC Optimization Workspace：导入 Amazon Bulk workbook，按 Campaign / Ad Group / Lifecycle / Workspace Unit 组织优化工作流，生成可审阅的调整草稿。
- Workspace 内置规则中心：维护 PPC 规则条件和动作，规则引擎输出 draft，不直接修改原始文件。
- Dashboard：展示广告指标、趋势和筛选。
- Listing AI：根据商品、关键词、广告数据和竞品信息生成 Listing 优化建议、图片计划和 A+ 模块建议。
- Logistics：处理物流相关 Excel / PDF 模板、箱规、货件对比和导出。

商品域路径边界以 `docs/product-domain-phase0.md` 和 `docs/product-domain-simple-architecture-plan.md` 为准：`ProductRecord` 是商品核心资料唯一事实源，保存经过 PostgreSQL transaction、revision、Audit/DataChangeVersion 和 Outbox；Projection、Read Model 和 Cache 都是可重建的派生层。当前列表主读路径仍是 `ProductSummaryRecord + ProductTextRecord`，详情主路径是 `ProductDetailService` 直接聚合 `ProductRecord` 和必要关联数据，不要把所有商品查询强制经过 Redis 或 Projection。已废弃的独立 Sellfox 商品资料和图片文案 Gallery 路径不得作为备用读写实现恢复。Sellfox 店铺、小时指标和产品表现快照属于报表数据，单独管理。

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

- PPC 工作台的核心抽象是 Campaign Group、Lifecycle Group、Workspace Unit、Rule、Adjustment Draft。不要把导入的 workbook 当作唯一状态源。
- 规则引擎应生成草稿，由用户选择后再导出；不要让规则自动直接覆盖原始数据。
- `workspace-store.ts` 当前承担较多状态和数据转换职责。新增复杂逻辑时优先放到 `src/lib/*` 的纯函数模块，再由 store 调用。
- IndexedDB snapshot 是本地恢复机制。改 state shape 时要考虑旧 snapshot 的兼容性或降级处理。
- 选品本地证据表单为 `/agents/market/selection`，复用 selection pipeline 校验与 `.pipeline.lock`；本机目录按 `SELECTION_ORGANIZATION_ID` / `SELECTION_WORKSPACE_ID`（默认 `default`）限制组织/工作区，缺显式组织绑定时仅限数据库唯一组织。Market 上传 draft 仍为只读机会输入；详细边界见 `docs/selection-round-d.md`“网页表单兜底”。
- Listing AI 的输出结构由 `src/lib/listing-ai/types.ts` 定义，改 prompt 或 client 时要保持 UI 消费字段稳定。
- Logistics 模块依赖实际 Excel/PDF 模板和中文字段名，改解析逻辑前先看 `src/lib/logistics/types.ts`、`excel.ts`、`pdf.ts` 以及 `public/logistics-templates/`。

## Product Center 当前规则与后续方向

Product Center 当前阶段是“性能优化 + 架构收口”，不是新 ERP 功能扩张。处理商品列表、详情、图片、缓存或投影任务时，必须先以 `docs/product-domain-simple-architecture-plan.md` 的当前审计结论为准。

### 当前已确认

- 商品编辑草稿与正式商品分离：`src/lib/products/product-edit-draft-repository.ts` 的 IndexedDB 仅保存当前设备未提交表单，按 organization/workspace/user/SKU/editor/session 隔离；刷新或卸载不得删除草稿。明确取消/关闭确认后清理，主编辑器点击保存才调用正式 API；视频、运营进度和 Excel 导入均先进入表单草稿。详情初始化只使用权威完整数据，冲突后加载最新再由用户恢复并核对，不自动重试。规格与验收见 `specs/003-product-edit-drafts/`；独立模拟接口的浏览器回归：`npm run test:products:browser`（不需要账号、不访问生产）。
- `products:backfill-image-assets` 默认只读 dry-run；正式执行必须携带 `--apply --organization-id=<id> --actor-user-id=<id>`，操作者须为目标组织有效 owner/database_admin；建议额外传 `--workspace-id=<id>` 缩小范围。事实源改动经过聚合 CAS/审计/Outbox，不能恢复直接更新 payload 的实现。无用户明确维护/部署请求时不得对生产运行该脚本。

- `ProductRecord` 是商品核心资料唯一 Source of Truth；`payload` 不因性能优化直接删除。
- 商品保存通过 PostgreSQL transaction、revision、审计记录和 `ProductOutboxEvent` 完成；Projection、Read Model 和 Cache 不得反向覆盖 `ProductRecord`。
- 商品列表当前真实主读路径是 `ProductSummaryRecord + ProductTextRecord`，由数据库执行过滤、排序和分页；不要未经 benchmark 直接切换到 `ProductRecord` 直读。
- 商品详情当前通过 `ProductDetailService` 统一聚合 `ProductRecord`、必要关联数据和投影状态；不要把详情拆成前端请求瀑布。
- 列表当前使用分页、`useVirtualRows`、第一张 `thumbUrl`、lazy loading、异步解码和低优先级图片请求；不要默认加载全量商品、完整 payload 或原图。
- `ProductMedia` 是媒体关系/元数据索引，不是商品核心资料事实源；二进制属于 Storage / FileObject。
- Redis 当前主要用于 BullMQ 调度，不是商品事实源，也不是图片二进制缓存；商品详情 Redis 缓存尚未证明有收益。
- 商品编辑器能力保留与入口级回归门槛见 `docs/product-domain-simple-architecture-plan.md` §3.6；修改主编辑器或详情区块前先盘点功能，未经明确确认不得删除既有入口，测试需验证用户路径可达和可操作。

### 后续升级硬约束

- 先做 1,000 / 5,000 / 10,000 SKU 的列表、详情、图片和并发 benchmark，记录 API/SQL/网络/浏览器的 P50、P95、P99，再决定是否改查询、索引、分页或缓存。
- 没有真实性能证据时，不新增 Read Model，不强制接入 Redis，不把复杂筛选列表迁移到 Redis，不引入 Elasticsearch、微服务或新的图片处理服务。
- Redis 只允许缓存高频、重算成本明显、可从 PostgreSQL 重建且允许短暂最终一致的数据；必须包含 organization/workspace/权限/版本维度，并具备 TTL、失效和 PostgreSQL fallback。
- Redis 不保存原图、缩略图二进制、密钥、完整大 payload、库存扣减结果或金额结算结果。
- 任何列表主读路径切换都必须保留旧路径回滚能力，并验证分页结果、筛选结果、权限边界、投影延迟和 P95。
- 任何 Projection、Summary、Text、Media 或 Cache 的删除，都必须先完成调用方盘点、历史数据一致性校验、重建验证和回滚方案。
- 发现 ProductRecord、ProductMedia、Summary 或缓存存在重复写入时，先收口写入边界；不要通过增加另一张表或手动同步继续放大多 Source of Truth。

### 当前未完成项

- 尚未形成 1,000 / 5,000 / 10,000 SKU 的真实 P50/P95/P99 benchmark；
- 尚未证明 `ProductSummaryRecord` 是否应长期作为列表主读模型；
- 尚未证明商品详情 Redis 缓存能改善 P95；
- 深页 `OFFSET/LIMIT`、50 用户并发、图片 immutable/CDN 缓存和图片引用重复表示仍需专项验证；
- `/api/products` 的关键词搜索语义必须以真实代码和测试为准，不要只根据 UI 文案判断已支持。

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

- 更新服务器前必须先执行完整改动区盘点：用 `git status --short` 确认所有已修改、已删除和未跟踪改动；只要这些改动属于本次要上线的工作范围，就必须全部纳入 GitHub 同步、artifact 打包和服务器发布，不能只发布当前聊天窗口或当前 agent 修改的文件。
- 如果发现改动区里有不确定是否该上线的内容，先向用户说明文件清单和风险并等待确认；不要静默跳过，也不要用局部打包、局部 rsync 或局部提交制造本地、GitHub、服务器三端不一致。
- 新部署目标服务器 IP：`123.207.47.225`。
- SSH 用户：`ubuntu`。
- 默认服务器目录：`/opt/amazon-ad-bulk-operation`。
- 新部署访问地址：`http://123.207.47.225`（HTTP 未加密；仅用于用户明确要求的 IP 临时入口）。
- 旧服务器 `159.75.203.221` 与 `https://aecob.com` 仍在独立运行，保留原有数据库和 R2 数据；新服务器为空库，不自动迁移或同步旧主机数据。不要将两端误认为同一数据集，也不要未经明确要求关闭旧服务器或修改 DNS。
- 服务器系统：Ubuntu 24.04 LTS x64。
- 生产架构：PostgreSQL 和 Redis 使用 Docker；Next web 和 worker 使用服务器本机 Node.js + systemd；Caddy 使用 Docker 反代到本机 web。
- Docker Compose 只管理 infra：`postgres`、`redis`。不要再为普通代码更新执行 `docker compose up -d --build web worker`。
- systemd 服务：`amazon-web`、`amazon-worker`、`amazon-image-upscale-worker`、`amazon-sync-worker`、`amazon-sellfox-sync-worker`。
- UFW 必须允许 `22/tcp`、`80/tcp`、`443/tcp`；`3000`、`5432`、`6379` 不开放公网。
- Caddy 证书和配置使用 Docker volumes `amazon-caddy-data`、`amazon-caddy-config` 持久化；不要无备份删除这些 volumes。
- 服务器 `.env` 路径：`/opt/amazon-ad-bulk-operation/.env`。这里保存 `AUTH_SECRET`、管理员 bootstrap 配置、R2/S3 配置等敏感运行环境变量。
- 管理员登录信息保存位置：`/root/amazon-ad-bulk-credentials.txt`。不要把密码写入仓库文档。
- 旧服务器文件存储：Cloudflare R2，`STORAGE_DRIVER=r2`，bucket 为 `amazon-bulk-uploads`。新空库服务器首次安装使用独立 local uploads；切换 R2 必须另行配置目标环境密钥和明确对象数据范围。R2/S3 密钥只允许写在服务器 `.env` 或受控密钥管理中，不要提交到仓库或写入文档。
- 本地开发可继续使用 `STORAGE_DRIVER=local` 和 `uploads/`。更新生产系统时，不要把本地 local uploads 覆盖到服务器，也不要把生产 R2 设置改回 local。
- 部署同步必须排除大目录和历史产物：`.git`、`node_modules`、`node_modules.*`、`.next`、`.next-*`、`uploads`、`coverage`、`out`、`build`。
- 项目目录里曾出现过 `node_modules.broken-audit-fix-*`、`.next-build.broken-*`、`.next-build-stale-*` 等历史目录；这些目录绝不能同步到服务器。
- 不要使用会把整个本地工作区无差别覆盖到服务器的命令。同步前先确认排除规则；优先使用带 `--exclude` 的 `rsync`。
- 服务器上的 `.env`、Docker volumes、`uploads` 属于运行态数据；除非用户明确要求，不要删除或覆盖。
- PostgreSQL 和 Redis 只绑定 `127.0.0.1:5432`、`127.0.0.1:6379`，不要暴露公网端口。
- 生产 `.env` 中 `DATABASE_URL` 应指向 `127.0.0.1:5432`，`REDIS_URL` 应指向 `127.0.0.1:6379`。
- 本机生产进程必须使用 `npm run build` 后的 standalone 输出，web 启动命令是 `npm run start:standalone`，不要用 `npm run dev` 跑公网。
- 全新 Ubuntu 24.04 主机先运行 `sudo bash scripts/bootstrap-server.sh`，再通过 workflow_dispatch 显式启用 `initial_deployment=true` 和 `install_dependencies=true`。该脚本生成独立 `.env` 与管理员初始密码文件；首发执行迁移、管理员 seed，并启用 systemd workers。
- worker 由 systemd 执行 `npm run worker`。服务器发布脚本会用 `node_modules/.package-lock.sha256` 判断依赖是否变化；`package-lock.json` 未变时跳过 `npm ci`。
- 仓库不保留应用 Dockerfile；生产应用进程只走本机 Node.js + systemd。不要为 web/worker 恢复 Docker build，除非用户明确要求重新容器化。
- 发布最高原则：根据实际改动按需迁移和重启。禁止每次发布默认迁移数据库、重启全部 worker、重建 Caddy 或更新 infra。
- CI 使用明确的 BASE_SHA 与目标 commit 生成 `deployment-plan.json`，随校验产物发布；服务器核对 headSha 与产物一致、baseSha 与当前线上 RELEASE.json 的 commit 一致。清单缺失、字段无效或基线不一致时停止，不默认全量操作。
- 仅文档改动只同步 GitHub；应用改动由 CI 构建并重启 web。普通 worker、图片 worker 各按入口、共享依赖和运行配置决定重启；`src/lib` 变化目前保守重启两类 worker，不能仅检查入口文件。
- 仅 Prisma schema、migration 或依赖锁文件变化才执行服务器 Prisma generate；仅 migration 变化才执行 migrate deploy。schema 变化缺少配套 migration 时禁止发布，迁移必须人工审核。服务器 npm ci 仍需锁文件变化和明确安装授权。
- systemd、Caddy 和 Docker infra 分别按清单更新；发布脚本和基础设施变化必须人工审核并显式确认。普通发布不执行 bootstrap seed 或商品维护脚本，不触碰 .env、上传文件或 volumes。
- 服务器校验 CI artifact SHA256、按清单执行必要操作、生成 release、切换 current symlink、健康检查并记录结果；不执行 Next standalone build。失败只回滚应用及本次涉及的运行配置，不自动回滚数据库。
- 发布产物目录：`/opt/amazon-ad-bulk-releases/<timestamp>-<branch>-<commit>`。
- 当前发布版本软链接：`/opt/amazon-ad-bulk-current`。web 和 worker 均从此链接启动；不涉及变更的 worker 可以继续运行旧 release，清理时必须保留仍被进程使用的版本目录。
- 发布记录文件：`/opt/amazon-ad-bulk-release-log.jsonl`。每次部署和回滚都应追加记录。
- release 目录只保存运行所需的 standalone、源码、脚本、Prisma 和 public；`node_modules` 通过 symlink 共享 `/opt/amazon-ad-bulk-operation/node_modules`，避免复制大依赖。
- 默认只保留最近 5 个 release。可通过服务器环境变量 `KEEP_RELEASES` 临时调整；不要为了省空间删除当前 release 或 Docker volumes。
- 小盘服务器上如果历史 Docker build cache 占用过高，可在服务启动并验证通过后运行 `docker builder prune -af`；不要清理 Docker volumes。
- 每次部署后优先读取 release 目录中的 `RELEASE-RESULT.json`；只有摘要显示失败时，再检查 `df -h /`、`docker compose ps`、`systemctl status amazon-web amazon-worker` 和 `journalctl -u amazon-web -u amazon-worker -n 100 --no-pager`。
- 发布失败时只允许回滚应用代码、current symlink、systemd 进程和 Caddy 配置；数据库 migration 只向前执行，不自动执行 `migrate down`、删表或恢复数据库。`RELEASE-RESULT.json` 必须明确记录 `database: not_rolled_back`。

推荐更新流程（只使用 GitHub Actions CI artifact 发布）：

```bash
# 先盘点完整改动区，确认范围并提交、推送。
# base_sha 必须来自当前线上 RELEASE.json 的 commit。
gh workflow run ci-cd.yml --ref main -f base_sha=<线上commit> -f deploy_production=true
# 涉及发布脚本/基础设施：审核后追加 -f deployment_reviewed=true
```

GitHub CI 负责测试、lint、build、打包和 release-check；本机不重复生产构建，服务器只接收校验产物按清单发布。普通发布不运行 bootstrap seed；初始化需单独授权。

当任务明确需要发布到服务器时，默认沿用这条 CI artifact 链路，不再把 build 放回服务器；只有明确的 fallback 或应急修复才走源码发布脚本。

不再引用已不存在的源码发布脚本。CI 失败不得改成本机或服务器构建；应急旁路必须单独说明并获得授权。迁移结果读取发布摘要确认，不为验证重复执行迁移。


## 业务流转登录提醒

- 未完成任务按 ProductRecord 当前阶段和负责人判断，不以通知 readAt 判断完成；关闭弹窗只收起，同一次登录去重，下次登录仍有任务才弹。详细边界与回滚见 `docs/product-domain-simple-architecture-plan.md` 的业务流转通知段落。
- `npx playwright test --config tests/browser/notifications.config.ts`：模拟通知 API、真实 Tailwind 样式的隔离登录提醒回归，不访问生产。

## Amazon 数据同步中心审批

- 支持单管理员流程：当前组织有效 `owner` / `database_admin` 在具备 `operations:approve` 和原有业务权限时，可批准自己的申请；普通成员仍不得自行审批。角色与权限必须在服务端从数据库实时读取，不接受客户端声明。
- 保留申请、脱敏审阅、批准、独立应用、revision、有效期、范围和审计校验；批准不等于应用或启动任务。批准审计记录 `selfApproved` / `approverRole`，不自动批准既有申请；其他业务模块的审批规则不变。

### Amazon Orders P1/P2 离线开发边界

- `orders` uses Orders v2026-01-01 `searchOrders` plus optional approval-bound `getOrder` detail. Each job resumes a bounded cursor; page/work/fact/raw commits are idempotent and raw PII remains AES-GCM encrypted. Amazon documents say v2026-01-01 Orders PII does not require RDT; do not create or reuse a v0 Tokens path. PII datasets require explicit business-purpose and restricted-role attestation; standard queries/UI expose no PII or raw envelopes. Official pages: `https://developer-docs.amazon.com/sp-api/reference/getorder-3`, `https://developer-docs.amazon.com/sp-api/docs/access-orders-pii`.
- `npm run test:amazon-orders:offline`: disposable preinstalled Docker PG/Redis + `.invalid` fixture HTTP + order browser; no inherited credentials/database config, dotenv, image pulls or real sync. `npm run test:amazon-sync:offline` includes existing sync regressions. Specs, validation, and remaining financial/returns gates: `docs/amazon-orders-p1.md`, `docs/amazon-orders-p2-plan.md`.
- Amazon 角色仅记录管理员核实的 attestation，不把 Marketplace 参与资格当作 Orders 域权限证明。非敏感 applicationId/预算同应用跨站点一致；新数据仍隔离 organization/workspace/seller/site，不改 ProductRecord 或 PPC 存储边界。

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

涉及 Excel / PDF / AI 的改动，至少手动跑一遍对应上传、解析、导出或测试连接流程。

## Git 和仓库状态

当前仓库目录就是项目根目录，不需要进入额外的子目录。不要为了“清理”而重置或删除用户已有改动。修改前先确认工作目录，通常应在：

```bash
C:\Users\Administrator\Desktop\AMAZON BULK AD
```

只改和任务直接相关的文件。若任务包含备份到 GitHub、两端对齐、三端对齐或更新到服务器，执行前必须先用 `git status --short` 盘点完整工作区，并把所有改动区内容作为一个整体同步闭环处理；不能只提交、推送、打包或发布当前 agent 自己刚改的文件。

执行任何 `git stash`、`git stash push`、`git stash pop`、`git stash apply`、`git stash drop`、`git stash clear` 或等价暂存/恢复操作前，必须先向用户说明原因、影响范围和准备执行的命令，并获得用户明确同意；不得为了切分任务、部署、同步或清理工作区而擅自 stash 用户改动。

## 文档维护

- `CLAUDE.md` 目前只包含 `@AGENTS.md`，用于让 Claude Code 复用本文件。除非确有需要，不要复制一份独立规则。
- 新增重要命令、目录、业务约定或外部服务时，同步更新本文件。

## 赛狐 Agent 本地读取

- Listing 列表读取现有 current view 的类型投影；`sellfox_listing_project_write` 在快照写入事务内维护，禁止把默认列表恢复为逐行 payload 解析。增量迁移/全历史回填成本、隔离 benchmark 与回滚见 `docs/sellfox-listings-read-model.md`。

- 销量订单量落 `SellfoxSalesDailySnapshot.orders`，旧值/缺日保持 NULL，浏览 `metric=orders`；利润按 `onlySettle=false/true` 分区同步与唯一键保存，查询/导出必须显式选口径，禁止跨分区求和。两页主图来自 Listing current，顶部 KPI 复用筛选 totals 按币种显示。增量迁移、验证和旧版回退约束见 `docs/sellfox-sales-profit-p0.md`。

- `/sellfox` 四域UI列由 `workbench-types.ts` 的columns配置；`layout=workbench` 只读浏览分支按本地实体聚合/分页、销量最多90天日矩阵。CSV/利润Excel跟随可见列，Agent导出保留原英文长表。父ASIN/价格/库存补充来自current，不冒充历史；金额按币种分开，缺失不补0，无结构状态的广告控件灰显。浏览器验收使用真实Tailwind样式，运行 `npm run test:sellfox:browser`。
- `docs/sellfox-agent-read.md` 定义库存 current、MSKU 日销、Listing current、利润及广告产品日报窄表/SQL 视图、CSV、字段映射与缺失值口径。Agent/CLI 例行读本地，不调用赛狐 API 或依赖网页登录；ProductRecord 不被赛狐覆盖。
- 库存/Listing current 只发布完整店铺采集；日销需校验 coverage/complete，缺日不得补零。广告日报缺预算时禁止给暂停/降预算建议；SP/SB真数据已核验，SD仅验证真实空报告，非空数据仍待验收。
- Listing V2 已验证 delete 状态可有稳定id+ASIN但缺MSKU，快照msku存NULL；在售/其他未验证状态仍不得放宽身份检查。对应增量迁移为 `20261025030000_allow_deleted_sellfox_listing_without_msku`，不修改ProductRecord。
- 销量计划可配置 backfillStart，持久化游标默认从上一完整冬季开始；`SELLFOX_BACKFILL_DAYS_PER_RUN` 默认7、上限90。所有计划默认关闭，扩采前评估≥1200ms串行耗时。
- `npm run sellfox:backfill-sales -- --help`：按显式组织/工作区/操作者盘点完整覆盖缺口，默认dry-run；`--apply`按店拆分最多90天加入现有队列，相同日期范围复用原批次。历史任务低于手动/定时任务优先级；开启计划需另行授权，历史回填期间日销计划仍拉T-1，不重复启动历史补数。执行与恢复见 `docs/sellfox-agent-read.md`。

## 经营中台定时同步

- `/operations?tab=sync` 计划按组织/工作区/域隔离，默认关闭，仅 inventory/catalog 执行器已实现；启用仍需明确的服务端授权映射。
- `npm run worker:amazon-sync` 运行专用 Amazon 只读队列和 30 秒计划检查；不由页面启动调度器。
- 生产专用服务为 `amazon-sync-worker` systemd unit；部署计划仅在 worker 入口/共享依赖/schema/迁移/unit 变化时重启它。
- `npm run test:operations:browser` 在隔离模拟接口中验证六域状态、缺失值、计划控件、手动同步和切 workspace 迟到响应；不需要账号，不访问真实 Amazon，不替代服务端权限/真实数据验收。
- 计划、幂等、防重与验收说明见 `docs/amazon-operations-hub.md`。新增计划表后先按受控迁移流程应用，禁止在代码任务中自动迁移生产。

### Amazon 刊登与补货扩展

- Amazon 自动同步保持独立快照；`SellerAccount.accountKey` 不是默认 Seller ID。服务端显式配置 `AMAZON_SP_API_SELLER_BINDINGS`，只允许实际授权的 inventory/catalog；缺配置 BLOCKED。
- Product Center 只附加当前页的只读 Amazon 投影，禁止写入 ProductRecord；补货策略/建议为独立表，不自动生成采购单。
- 专用 Amazon worker 同时处理每日补货重算。真实销量缺日、缺周期或库存 STALE 时必须 NEEDS_DATA；ERP 历史来源按精确 MSKU，禁止将导入缺省零当真实零。

### 内部 Ops CLI 与 Amazon 出价审计

- `npm run ops:cli -- --help`：仅本机进程读取本地数据库；OPS_CLI_ORGANIZATION_ID / ACTOR_USER_ID / WORKSPACE_IDS 绑定身份与范围，检查 active 成员及模块权限，PG READ ONLY 事务禁止隐式写库。CLI 不直接请求 Amazon、不触发同步、不写 ProductRecord。
- `ppc suggest` 复用现有分析工具，只输出报告/草稿；PPC 日指标缺可靠 SKU/ASIN 日期映射时保持 null/说明。
- Amazon 出价动作经 AmazonAgentActionAudit preview → 既有 approvals confirm → audit apply，组织/工作区、30 分钟到期、幂等和批量/出价限制均由服务端检查。
- AMAZON_ADS_EXECUTION_ENABLED 默认 false；当前 true 仍明确 NOT_IMPLEMENTED、整批零 HTTP，禁止标为 APPLIED。实现真实 transport/profile/实体授权映射并完成受控联调前，不得仅靠开关或删除闸门上线。
- CLI 命令、配置、API、stub 契约、验证边界和回滚见 `docs/amazon-operations-hub.md`。

### Sellfox 只读同步

- `npm run sellfox:ads-reparse-cache -- --organization-id=<id> --workspace-id=<id>`：仅从现有 task.fileKey 缓存重解析完成/已下载广告报告，默认 dry-run，只有 `--write` 才按原窗口事务替换；默认投放与搜索词，不创建/轮询/下载上游任务。上线后另行授权执行，范围、空报告及回滚注意事项见 `docs/sellfox-ads-subtabs-gap.md`「既有数据纠正」。
- `npm run sellfox:ads-reset-stuck-creating -- --organization-id=<id> --workspace-id=<id>`：将卡住的广告报告任务（`creating` 且无 externalTaskId/fileKey）标为 `failed` 以便重提；默认 dry-run，只有 `--write` 才更新 status；不删行、不调赛狐。123 上 SD×adTargeringReport 等用法见 `docs/sellfox-ads-subtabs-gap.md`「部署后重置卡住 creating」。

- 广告 Phase A/B 新增 `ads_targeting` / `ads_search_term` / `ads_campaign` / `ads_ad_group` / `ads_placement`，报告代码精确为 `adTargeringReport` / `adSearchTermReport` / `adCampaignReport` / `adGroupReport` / `adSpaceReport`；2026-10-26 已对照真实 XLSX 确认列映射（覆盖范围见缺口文档）；投放/搜索词真实 ID 列为 `广告投放ID`，兼容 `投放ID`，双列歧义或显式空 ID 拒绝。五计划默认关闭、1440 分钟、Asia/Shanghai 06:30；广告位已确认活动/广告位/日期唯一，真实文件无广告组ID，兼容广告组仅元数据，重复身份整文件拒绝。列/身份/回退与灰显范围见 `docs/sellfox-ads-subtabs-gap.md`；`/saihu-search-merge` 人工上传保持独立。

- 凭据仅由服务端 `SELLFOX_CLIENT_ID` / `SELLFOX_CLIENT_SECRET` 读取；overview 只返回 configured。所有 Open API 请求必须在 Node Worker 中经 `src/lib/sellfox/client.ts` 发起。
- 使用专用 `npm run worker:sellfox-sync` 和 `amazon-sellfox-sync-worker.service`；BullMQ concurrency 固定为 1。客户端对 token、重试和资源请求统一串行，间隔不少于 1200ms。
- 官方 token `expires_in` 单位为毫秒。库存/销量/Listing已在用户授权的本机单店只读联调中核验，解析契约与脱敏 fixture 见 `snapshot-contracts.ts`、`narrow-contracts.ts` 和 `tests/fixtures/sellfox/`；销量 productNum/salePrice 独立请求按店铺/MSKU/业务日合并，缺值保留 null。上述广告 Phase A/B 的真实样本覆盖与剩余验证缺口见 `docs/sellfox-ads-subtabs-gap.md`；后续未验证资源仍由 `sellfoxSyncDisabledReason` 禁止同步，不得恢复猜字段落库。
- 快照长期保留，不设自动过期清理。销售/表现按报表日；库存按抓取时间保存，日期筛选展示当日多次库存状态。
- ProductRecord 保持唯一商品主档事实源。赛狐快照只服务报表、列表和只读分析。
- 手动与定时任务共用 SellfoxSyncRun 和 sync service；计划需在当前工作区由有 `sellfox:create` 权限的用户显式启用。同步 Worker 与 Redis 不可用时 API 返回服务端错误，不退化为请求内同步。
- Sellfox 计划与手动提交按组织/工作区/资源共用事务防重锁；执行开始重新检查 active 用户和 sellfox:create。`/settings?tab=operations` 赛狐面板显示 Worker 心跳及当前工作区计划，schedules API 返回 lastEnqueuedAt/nextRunAt；时间为 Asia/Shanghai，计划默认关闭，页面不启动 Worker。创建防重不等于多副本执行租约，生产接管验证见 `docs/sellfox-sync-workbench-plan.md` §10。
- 库存、销量、表现、店铺和运行记录按 organization/workspace 隔离；详细接口契约与验证步骤见 `docs/sellfox-sync-workbench-plan.md`。
- `npm run test:sellfox:browser`：隔离模拟接口验证多店/日期/站点、URL 导航、导出链接、按需详情、日志轮询与切工作区迟到响应；不访问真实赛狐或生产库。浏览器不持有 token；列表与导出复用 browse-query，导出超过 10,000 条明确拒绝，不能静默截断。

### 本地 Amazon US 选品 CLI

- `npm run selection:run -- --keyword "..." --slug <slug>`：Playwright 只采 Amazon US / 1688，默认只输出 selections 下的本地草稿与 ERP 格式 workbook；用 `npm run test:selection` 跑隔离 fixture 回归。
- 入口与限速/SQLite/云端补漏/人工供应商兜底说明见 `scripts/selection-pipeline/README.md`。研究图片、草稿、SQLite 配额不提交 GitHub，不接付费选品/代理 SaaS。
- 仅 `--write` 可创建正式商品；必须显式配置目标数据库、组织、有效 owner/database_admin 操作者，经既有 Product 聚合/审计/Outbox 边界创建。fixture 禁止写库；无凭据不伪造图片 fileId。

### Agent Round C 全链交接

- 交接合同和 Launch/PPC 服务端闸门见 `docs/agent-chain-round-c.md`、`specs/005-agent-chain-handoffs/`；sessionStorage 只作导航交接，带组织/用户/工作区/来源 execution，不是业务事实源。
- `launchApproved` 请求布尔值不授予权限。Launch 批准引用真实 Approval/原计划，PPC 入站在工具执行前核验；Orchestrator 仍只有编排工具，无 Ads/上架/商品写权限。
- `market.selection.run` 可读取当前组织/工作区上传的 Round B draft 证据（Market 页，agents:create，2 MB）；通过既有 FileObject/storage 保存规范化研究切片，商业评分与未观测指标保留 null，证据完整度单列，不创建商品。后台实时采集 runner/job 仍未接入，缺 fileId 时 NOT_IMPLEMENTED；禁止回落模拟机会、请求内启动采集或调用 `--write`。
- `npx playwright test --config tests/browser/agent-chain.config.ts`：隔离六段 UI/Runtime 交接与 Launch 前后 PPC 门禁，不访问外部服务/生产库，不替代真实选品/上架/广告验收。

### Selection Round D 质量门禁

- `scripts/selection-pipeline/README.md` 和 `docs/selection-round-d.md` 定义人工 `tag --reviews-file`、`suppliers --suppliers-file`、`workbook --upload-images` 续作。create/run --write 前重算原始低星评论、标签引用、≥3 条去重供应线索与实际图片；fixture/缺证据/上传未齐时硬失败，不信任旧 quality.json。
- draft/Market 的 sales30Days 必须标 heuristic=true；空标签为 NEEDS_DATA，不是无差评。真人上传/建 SKU/页面验收与 fixture、临时库、浏览器 harness 验证分别记录，不能代签；market.selection.run 继续只读上传 fileId，不启动 CLI。


## Amazon 同步中心 Phase 1 试点

- 复用现有 AmazonSyncSchedule / AmazonSyncRun / BullMQ / amazon-sync-worker；仅 FBA inventory 与 Listings Items catalog 已接入。ProductRecord 不被外部同步覆盖，赛狐指标独立。
- `AMAZON_SYNC_CENTER_SCOPES` 为组织＋工作区精确二元数组 JSON，缺省关闭；web 与 worker 必须一致。启用前停止旧计划并排空旧任务，显式导入／验证授权，不自动推断 Seller ID。
- `npm run test:amazon-sync:integration` 使用预装官方 Docker 镜像建立独立 PostgreSQL／Redis，一次性验证真实迁移、队列和恢复；Amazon 响应模拟，不调用生产。脚本不拉取镜像，不接触既有容器。
- `npm run test:amazon-sync:browser` 为真实 Tailwind 样式、模拟 API 的隔离浏览器回归。
- 本轮包含 schema 扩展；关闭试点需保留兼容新唯一键的应用，禁止任意回滚到迁移前应用或自动删表。部署／回滚、验证限制见 `docs/amazon-sync-center-phase1/`，未明确要求不得执行生产迁移或发布。

## Amazon SP-API 本地真实联调

- 2026-11-05 默认库存/Listing 隔离集成已获单独批准并通过 16 项（真实 fixture PostgreSQL/Redis、审批 Route Handler、测试 Worker、Chromium，Amazon transport 模拟），临时资源已清理。记录：`docs/amazon-sync-default-isolated-verification.json`。不代表真实 Amazon 或生产性能验收。

- 日期/Reports 销售流量、版本查询/导出、商品观察字段写入保护的本地增量边界见 `docs/amazon-sync-center-phase2-development.md`。销售数据为店铺逐日汇总，缺失/未闭合报告不发布为完整；单独获批的临时空库迁移/SQL 及销售审批→测试 BullMQ consumer→发布→查询→本地导出下载集成已通过（Amazon HTTP 模拟）。现有环境迁移和真实联调仍须逐项审批，旧集成通过记录不代表当前代码已验收。

- `node scripts/amazon-sync-live-preflight.mjs`：只检查环境配置并输出布尔结果，不连接数据库／Redis、不解密、不请求 Amazon；退出 2 表示未就绪，退出 0 不能代表真实验收。可通过 DOTENV_CONFIG_PATH 指定本地私有环境文件。
- `node --test tests/amazon-sync-preflight.test.mjs`：预检脱敏与拒绝非本地配置的专项测试。
- 操作与未填真实结果记录见 `docs/amazon-sync-center-phase1/live-validation.md`。共用 Amazon Worker 会扫描旧计划及补货到期任务；真实联调仅用人工确认的独立本地数据库与 Redis／DB，不使用测试 fixture 或生产隧道，不制造真实限流。

- 专用本地 Amazon 联调环境实测记录：`docs/amazon-sync-center-phase1/local-environment.md`。私有 `.env.amazon-live.local` 与 `tmp/amazon-live-private/` 不纳入 Git；只监听本机的 3017／55439／6399，用独立数据库与 Redis。不得把空授权环境就绪表述为真实 Amazon 验收通过。

## Amazon ERP 生产准入补充

- `node scripts/test-amazon-sync-integration.mjs --security`：一次性 PostgreSQL/Redis 和本地临时存储的多店铺安全回归，验证补货、只读 CLI、撤权及导入结果下载；不访问真实 Amazon，不替代 MCP/OAuth 验收。S0 范围、兼容性和验证结果见 `docs/amazon-multistore-s0-delivery.md`。

- 成员 Workspace/Seller 数据授权、24 小时人工任务执行窗口、受控 Worker 的本地代码边界及生产门槛见 `docs/erp-production-readiness-plan.md`。普通成员无显式授权拒绝；旧无执行期限任务/旧无范围导出须重新批准/申请，不自动回填权限。
- `AMAZON_SYNC_WORKER_MODE=approved-only` 配合 JSON `AMAZON_SYNC_WORKER_TASK_IDS` / `AMAZON_SYNC_WORKER_EXPORT_IDS` 只处理明确 ID、使用独立队列且不刷新补货；默认 standard 保留原行为。真实配置和启动仍需单独审批。设置页标准队列心跳不代表受控队列在线。
- 隔离 runner 当前包含第五迁移 `20261105000000_amazon_data_access_grants`；2026-11-05 单独获批后，销售 SQL 4 项、销售链路 1 项、默认库存/Listing 16 项均通过，临时资源已清理。记录见 `docs/amazon-sync-access-grants-isolated-verification.json`；不代表现有库迁移或真实 Amazon 验收通过。

## Amazon 多店铺身份与个人 MCP

- 本地交付与生产门槛见 `docs/amazon-multistore-delivery-2026-11-05.md`；验证清单见 `docs/amazon-multistore-verification-2026-11-05.json`。隔离 runner 增加第六迁移 `20261105010000_amazon_multistore_mcp`；新增 SQL 不能据此视为已应用到现有库。
- `node scripts/test-amazon-sync-integration.mjs --mcp`：真实临时 PostgreSQL / Redis 的个人凭证、当前 ERP 用户/角色/站点/操作交集、OAuth、审批及并发撤权回归；所有 Amazon HTTP 模拟。
- MCP 入口为 `/api/mcp/amazon`，凭证绑定个人且只在创建/轮换时展示一次。ERP 管理员身份不隐式授权 MCP，旧 grants 的 `mcpEnabled` 默认 false。凭证页面在同步中心“同步设置”；店铺及角色范围在“店铺与授权”。
- OAuth 使用固定登记 callback、单次 state 及卖家范围验证；参与站点不能单独证明 Seller ID。OAuth 配置变量名及历史数据核查/回滚规则见交付文档，不在仓库保存真实值。
- `npx tsx scripts/audit-amazon-lineage.ts --report-only --organization-id=<id> --workspace-id=<id>` 是有界只读归属报告，不加载 `.env`，不按 SKU/ASIN 推测或自动回填。连接真实目标前仍须具体审批；截断/异常退出 2，不能当作全库核查完成。
- 主要 ERP 读取入口与 MCP 有 append-only 审计；CLI 业务查询仍在 READ ONLY 事务中，输出前在事务外追加读取审计。不得为写审计放宽业务查询范围。

## Amazon 财务 P3 本地实现边界

- Finances v2024-06-19 只使用 `listTransactions`，复用现有审批 / service / processor / SP-API client。`financePolicy` 明确卖家级范围、全部验证站点、时区、窗口、预算和可选 FX；source marketplace 仅为管理锚点，不是返回行的默认归属。
- 财务采集及查询当前限实时 owner/database_admin，仍须逐次范围审批和每站点有效绑定。site-only grant / MCP 不暴露财务 source、run 或 raw。缺角色或范围变化在 HTTP 前阻断；落库前再次检查。
- 金额保留 JSON number 原文并使用 NUMERIC，不经 JS Number；未知归属加密隔离，查询排除；不把完成 posted 窗口称作结算完整。生产不提供 raw 自动重放入口。
- `npm run test:amazon-finance:offline` 运行 fixture 单测、临时 PG/Redis 集成与浏览器验证；`npm run test:amazon-sync:offline` 扩展旧三链路及 Orders 回归。均不加载真实 dotenv 或运行真实任务。详见 `docs/amazon-finance-p3-plan.md`、`docs/amazon-finance-p3-validation.md`。P4 须阶段确认后推进。

## Amazon 退货 P4 本地实现边界

- P4 仅 FBA 仓收退货，复用 Reports v2021-06-30/client/processor/审批；reportType 仅由 `returns.ts` 枚举及批准策略 allowlist 提供。Pricing 或 Amazon Fulfillment 角色须已确认；本报告非受限类型，不申请 RDT。不借此允许其他报告类型。
- `returnsPolicy` 明确窗口、站点时区、至少一天安全延迟、三操作预算、轮询上限和解析批次。cursor 的 `reportStateCiphertext` 保存报告/文档/原件/行 offset；每批明细和 cursor 同事务；未知 create 结果停下人工核查，不能重放创建。404 轮询与过期下载 URL 走有界退避。
- 单份已发布报告为查询边界；`reportId + rowHash` 仅报告内幂等，不能跨报告累加当独立退货事件。原因维度保留原始代码，订单关联限 tenant/seller/site/authorization，不造订单，不修改库存/财务。原件仅加密归档，评论/商品自由文本不进普通 DTO/日志/UI；无 offset 日期 fail closed。
- `npm run test:amazon-returns:offline`：fixture 单测、临时 PG/Redis、退货及订单/财务浏览器；全资源回归 `npm run test:amazon-sync:offline`。不得读取真实 dotenv、启动真实 job 或执行真实迁移。计划/官方依据/验收见 `docs/amazon-returns-p4-plan.md`、`docs/amazon-returns-p4-validation.md`。P5 仍需阶段确认。

## Amazon 同步 P5 生命周期与观测

后续用户已批准 US/CA 自动同步范围，当前持续调度规则见 `docs/amazon-automatic-sync.md`：有效授权和数据源就绪后系统建计划，订单／日报／财务最多回溯 730 天，再每日增量，商品／库存每日快照。P5 下述逐次审批描述保留为手动任务历史边界；自动任务由实时启用计划、revision、角色、数据源与授权共同控制。退货未纳入自动计划。新增计划约束迁移须随版本经 CI 发布，不得只推 worker 而遗漏迁移。

- P5继续逐次审批窗口，不开放自动持续采集。新三资源的异常/控制状态经 `service.ts syncIncrementalCursorStatus` 在scope锁及run变更同事务更新；只改匹配source/resource/activeRunId且未SUCCEEDED的cursor，禁止清空watermark/token/reportState/成功水位。健康窗口RUNNING与run等待片段状态语义不同，不强制逐片同值。
- scheduler租约恢复与执行审批阻断、processor执行前阻断/运行中pause/cancel、service显式resume/retry须遵守该边界；旧三链路保持原调度/重试/预算。Finance/Returns使用独立校验码，Orders旧码兼容。
- source进度DTO只select资源/窗口/status/lastSuccessAt/updatedAt；任务提示只允许固定文案，不得输出token/密文/raw/签名URL/PII。现有tenant/seller/site过滤和财务管理员边界不可放宽。
- 专项 `npm run test:amazon-sync:lifecycle`，完整 `npm run test:amazon-sync:offline`；前者仅新建临时PG/Redis与mock transport。运维、角色/额度、轮换、恢复及告警边界见 `docs/amazon-sync-p5-operations.md`；P5不新增迁移、端点或真实配置操作。
