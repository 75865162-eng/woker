# AGENTS.md — Codex 总运行规则

所有 Agent 进入仓库先读本文件；专项文档只在任务触及对应边界时阅读。

## 项目概览与核心术语

本项目是面向 Amazon 跨境电商业务的多租户 SaaS ERP，包含商品管理、数据同步、广告、选品研究、AI Agent、MCP 工具及业务分析。
以下定义用于理解业务职责，不代表所有接口、页面或执行能力均已完成；每次只处理任务涉及的模块。

### ERP 核心模块

- **Product Center（商品中心）**：管理商品主档、SKU、产品资料、图片、关联 Listing 与编辑流程；`ProductRecord` 是商品核心资料唯一事实源。
- **Amazon 数据中心／同步中心**：通过 SP-API 采集授权范围内的订单、库存、销售与流量、退货、财务等数据，负责同步任务、存储、查询及历史回填；范围与可用性以当前适配器和策略为准。
- **Amazon Ads（广告管理）**：围绕广告账户、Campaign、Ad Group、关键词、商品投放、搜索词与报表提供管理和分析；读取、草稿与真实写入能力分别核验，不能由页面或工具目录推断已支持执行。
- **PPC 优化工作台**：导入 Bulk 等广告文件，按 Campaign、Ad Group、Lifecycle Group 和 Workspace Unit 分析，运行 Rule 并生成 Adjustment Draft；不等同于在线 Ads API 管理。
- **选品研究系统**：围绕关键词、ASIN、市场证据和外部研究工具分析产品机会、竞品、需求与竞争；研究结果／证据不自动成为正式商品。
- **Logistics（物流工作台）**：处理物流 Excel/PDF、装箱与箱规、货件对比、模板转换及导出；补货建议、外部库存与货件快照沿各自现有模块管理，不因业务名称相近合并事实源。
- **Listing AI**：基于商品、关键词、广告及竞品资料生成 Listing 优化建议、图片计划与 A+ 建议；建议不等于已保存主档或已发布 Amazon Listing。
- **Dashboard／经营分析**：按现有授权范围展示指标、趋势和统计；汇总结果不成为商品、订单或财务的新事实源。
- **AI Agent**：在授权工具与工作流边界内组织研究、分析、跨模块交接及结果回写；Orchestrator 编排能力不隐含商品、上架或广告写权限。
- **Lili（粒粒）**：ERP 面向 AI 的工具、技能与工作流接入层；Lili MCP 提供业务调用能力，AI 客户端承载对话与任务理解，不能将两者混成聊天系统。

### MCP 与调用关系

- **MCP（Model Context Protocol）**：AI 客户端连接外部工具、数据服务的标准协议；协议本身不授予业务权限。
- **Lili MCP**：本 ERP 向 AI 暴露的工具与数据接口，使 AI 能调用授权范围内的 Amazon 业务数据及 ERP 功能。
- **SellerSprite MCP（卖家精灵）**：连接外部选品、关键词与市场研究工具；调用取决于配置、工具可用性、批准及额度，不是 ERP 内部业务数据库。
- **Sellfox（赛狐）**：外部 ERP 数据来源，经现有接入读取授权业务数据与报表；其本地快照服务查询分析，不覆盖商品主档。
- **AI 客户端**：承载对话、任务理解和 Agent 执行；ERP 负责业务权限、隔离、持久化及实际业务处理。

基本调用关系：AI 客户端 → Agent／工具调用 → Lili MCP → ERP Service／Repository → 业务数据库。
外部研究关系：AI Agent → 经授权的外部 MCP／接入服务 → 外部数据服务 → 研究证据／分析结果。
这些是职责示意，具体调用链以代码为准；ERP 内部页面/API 可复用业务服务，不要求经过 MCP。
跨模块仅通过既有 API、业务服务或明确交接合同协作；不得绕过权限与聚合写入边界直接修改业务数据库。
商品资料可作为 Listing／研究／广告分析的输入，外部快照可提供只读补充；研究、建议及广告草稿不能自动写入商品、上架或执行投放。

### 核心数据对象

- **Organization / Workspace / User**：组织、业务工作空间和用户，是成员关系、权限与多租户隔离基础；Workspace Unit 是 PPC 内部工作单元，不能混同租户 Workspace。
- **Seller / Site**：Amazon 卖家身份／账号与销售站点维度；ERP 店铺记录或 accountKey 不自动证明真实 Seller ID 或站点授权。
- **SKU / ASIN / Listing**：SKU 是相应业务范围的商品编码，ASIN 是 Amazon 目录标识，Listing 是卖家在站点的刊登信息；相同文本不证明跨卖家／站点属于同一业务实体。
- **ProductRecord**：商品核心主档；外部 Listing、广告表现和库存快照是相关业务数据，不因此成为主档。
- **Campaign / Ad Group**：Amazon 广告活动与其下广告组；PPC 导入对象与在线 Ads 实体须按现有身份映射关联。
- **Campaign Group / Lifecycle Group / Workspace Unit**：PPC 的活动分组、生命周期分类与优化工作单元；Lifecycle Group 当前包含 launch、mature、decline、clearance，不等同 Amazon 原生广告实体。
- **Rule / Adjustment Draft**：广告优化条件和动作规则／待审核确认的调整草稿；计算生成、选用、导出和真实执行是不同步骤。
- **Snapshot / Projection / Read Model**：分别指时点记录、派生投影与查询读模型；须按模块判断来源和职责，不混同。Product 派生层可重建，外部采集快照可能是本地业务证据，不可一概当缓存删除。
- **Sync Schedule / Sync Run**：同步计划与一次任务／执行记录；计划启用、任务入队、执行成功和数据完整发布是不同状态。

### 页面名称与知识维护

- 页面名称以当前路由、导航和 UI 文案为准；模块名称沿用现有定义，不随意创造新模块或重复入口。
- 新页面优先归入现有模块，保持导航、权限、数据及操作流程一致；页面、API、Service、Repository 与模型职责对应，不能只有 UI 而无真实业务闭环。
- **项目知识定义与代码实现分开维护**：AGENTS.md 负责项目概览、核心术语、模块职责、数据边界及全局开发规则。
- 专项文档负责完整页面／路由定义、详细业务流程、字段规范、API 契约、操作与验收；具体实现状态以当前代码为准，不得仅凭 AGENTS.md 或历史文档认定完成。
- 页面查询入口为 `docs/development-guide.md` 及相关模块文档；页面操作、字段、交互与验收回到对应专项文档，不在本入口逐项枚举。

## 安全与审批

- 用户明确要求开发时，直接实现已授权的本地代码、文档及隔离验证，不反复询问是否开始。
- 方案写清目标环境、文件、范围、参数、效果与风险；
- 不自动启动真实任务、迁移、部署、重启、回滚、备份或数据清理；loopback 地址不证明目标是空库或非生产。
- 不得用猜测字段、模拟数据、Mock 结果或历史验收记录冒充真实业务数据、当前功能或生产验收。
- 真实操作审批不替代服务端权限、revision、范围、有效期和审计检查；批准不等于应用或执行。

## 开发优先级

- 先找任务对应的现有入口、调用链和测试，复用现有模块、类型、service/repository、组件及脚本。
- 优先基于现有代码继续开发，不重写已有功能；先完成核心功能和可运行、可验证 MVP，再优化细节。
- 默认只读任务直接相关文件；不要进行无必要的全仓审计、架构规划、文档扩写或反复讨论。
- 只有真实阻塞、数据安全风险、重大架构问题或用户明确要求时，才扩大调查范围。
- 遵循 Workspace First、Campaign First、Draft First、Rule Driven、AI Assist Only 和 Repository First。
- 业务逻辑、数据模型与文件处理逐步理清边界；多人数据沿现有服务端存储扩展，不另造事实源。

## 最小修改与兼容

- 只做满足需求的最小修改；不做无关重构、清理、重命名、目录调整、格式化或依赖升级。
- 保留已有功能、入口、API、数据模型和用户流程；优先扩展，删除或改变既有行为须有明确任务依据。
- 保持现有数据库、API、权限与存储边界；新增抽象前先确认现有边界确实不足。
- 若可能影响共享模型、权限、路由/API 契约、构建、部署、存储、Worker、定时任务或多个模块，先说明影响、回滚和验证方案并获得确认。
- 若可能明显增加资源消耗或拖慢 P95、构建、导入导出、查询、渲染或 AI 请求，先说明风险与替代方案并获得确认。
- TypeScript 保持严格类型；复杂解析、归一化和计算优先放入对应 `src/lib/` 纯函数，避免继续堆进 store／组件。

## 数据与模块隔离

- 严格沿用 organization、workspace、user、seller/site、ownership 的现有数据隔离与实时权限检查。
- 不得跨租户复用缓存、任务、导出、凭证或授权；客户端参数、角色声明及批准布尔值不构成权限。
- 不混用业务模块事实源；Projection、Read Model、Cache 和外部快照不得反向覆盖核心主档。
- Product Center 的 `ProductRecord` 是商品核心资料唯一事实源，保存保留事务、revision、审计及 Outbox。
- PPC 的 IndexedDB 是本地恢复／浏览器缓存；服务端快照和草稿已有数据库边界，不能描述成仅本地存储。
- PPC 以 Campaign/Lifecycle Group、Workspace Unit、Rule、Adjustment Draft 组织；规则和 AI 生成可审阅草稿，不覆盖原始 workbook。
- Amazon、Sellfox 的报表／快照与 ProductRecord 分离；缺失、未观测、不完整数据保留 null／NEEDS_DATA，不补造零值。
- Redis 用于队列与调度，不是业务事实源；恢复能力以数据库任务、幂等、租约／检查点和隔离验证为依据。
- 保留文件来源、sheet、row、业务 key 等可追溯信息；导入导出保持原 workbook 不变及旧 snapshot 兼容／降级。

## 运行环境

- 本地 web/API/CLI/注册 Worker 的唯一常规配置源是根 `.env`；
- 同一环境使用一致 DATABASE_URL、REDIS_URL（含 DB index）及 QUEUE_DRIVER=redis；本地与生产独立，不静默切换连接。
- 不另设 dotenv 来源；旧 `.env.amazon-live.local` 与临时 profile 已退役，不复用历史例外启动。
- Worker 必须经 `scripts/runtime/worker-manager.mjs` 和 `src/lib/runtime/worker-registry.json`，不直启 entrypoint 或重复消费者。
- 启动、配置归并、既有数据处理或运行态核验时才查 `docs/erp-runtime-operations.md`；心跳在线不等于队列可消费。
- Next.js 15 行为不确定时查本地 Next 文档；保留 dev/build 独立 distDir，具体版本与命令以 `package.json` 为准。

## 分级验证

- 只验证本次相关风险，不机械重复已完成的等价检查；先读脚本，确认不加载真实配置或访问真实服务。
- 纯文档：检查内容、链接、迁移覆盖与 diff；不默认运行应用测试或构建。
- UI／局部状态：相关测试（无对应测试时说明）及 `npm run typecheck`。
- API／筛选／summary／共享逻辑：`npm run check:fast`；可按风险缩小为相关测试与类型检查并说明理由。
- 构建链／依赖／Prisma／权限：追加针对性验证；现有库迁移及真实权限联调仍须独立批准。
- 准备合码／上线：完整 `npm run check` 与 `git diff --check`；CI artifact 发布的生产构建在 CI 执行，不本机重复。
- E2E、手动页面和服务器检查仅在风险或验收需要时执行；真实 API 测试连接仍需审批。
- 隔离测试不加载根 `.env`、不继承真实凭据；仅使用明确标识的临时资源，清理仅限本次创建且已核实身份的资源。
- 区分 fixture／临时库／浏览器验证、真人操作与生产验收；未运行或未覆盖的部分如实报告。

## Git、发布与交付

- 修改前用 `pwd`、`git status --short` 确认仓库和已有改动；不重置、覆盖或删除用户改动。
- 所有 stash 暂存／恢复／删除操作须先说明原因、范围与命令并获明确同意。
- commit、push 与真实环境操作仍须具体授权；默认开发任务不自动提交、推送或部署。
- 要求 GitHub 备份／两端或三端对齐／发布时，盘点全部已修改、删除和未跟踪内容；全范围更新，不静默遗漏。
- 本地与 GitHub 的同步闭环不自动扩大到服务器；服务器备份、发布、恢复只在明确要求时纳入。
- 服务器发布只能走现有 GitHub Actions CI artifact + deployment-plan 流程，另行审批；禁止 ssh patch、源码 rsync 或本机／服务器构建旁路。
- 发布前读 `docs/ci-cd.md`，按清单执行迁移、依赖、服务与 infra 操作；不覆盖 `.env`、uploads 或 volumes，不自动回滚数据库。
- 每次成功 commit／push 后必须追加桌面页面追溯；操作前读 `docs/delivery-traceability.md`，失败须报告，不因追溯另建提交。
- 必要文档、脚本、验证步骤和部署注意事项随改动同步；专项知识归对应 docs，不持续扩张本入口。
- 交付报告说明：完成内容、验证及其理由、未运行的高成本检查与触发条件、剩余风险／待确认事项、GitHub／服务器同步状态。

## 按任务查阅（只读相关项）

| 任务 | 必读入口及边界 |
| --- | --- |
| 普通 UI、PPC、Listing AI、Logistics、文件／AI 处理 | `docs/development-guide.md`；再按模块读其中链接和现有类型 |
| 商品列表、详情、编辑器、图片、投影、缓存 | `docs/product-domain-simple-architecture-plan.md`；数据域补充 `docs/product-domain-phase0.md` |
| 本地配置、Worker、任务恢复、备份 | `docs/erp-runtime-operations.md` |
| Git 同步、commit/push、桌面六项页面追溯 | `docs/delivery-traceability.md` |
| 服务器发布、部署脚本、systemd、infra | `docs/ci-cd.md`；当前清单以 `scripts/deployment-plan.mjs` 为准 |
| Amazon 同步、Orders、财务、退货、MCP/OAuth、Ops CLI | `docs/amazon-agent-boundaries.md` 中相关小节；持续调度另读 `docs/amazon-automatic-sync.md` 最新章节 |
| Sellfox 查询、报表、采集、凭据、回填 | `docs/sellfox-agent-read.md` 中相关小节及其专项链接 |
| 选品 CLI、证据、图片、正式建商品 | `docs/selection-round-d.md`、`scripts/selection-pipeline/README.md` |
| Agent 跨模块交接、Launch/PPC 门禁 | `docs/agent-chain-round-c.md` |
| Lili MCP 相关改动 | 当前相关实现及任务对应专项文档；Lili 是 ERP 工具／数据接口，聊天由 AI 客户端承载 |

专项文档的历史状态、批准和测试数字不能自动视为当前事实；有冲突时定向核对当前代码并报告，涉及真实操作先停止依赖动作。
`CLAUDE.md` 保持引用 `@AGENTS.md`，不复制另一套总规则。迁移审计见 `docs/agents-entry-audit-2026-11-08.md`，日常任务无需通读。
