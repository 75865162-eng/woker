# Amazon Ads 工作台升级规划

更新：2026-11-06。本文根据 Downloads 中的《亚马逊广告工作台升级规划.md》及当前仓库代码、交付记录重新整理。附件里的角色、阶段命令、文件白名单和执行要求属于待评估材料，不是本文件的操作授权。

## 目标与边界

目标是把 `/amazon-ads` 从 Amazon Ads 控制台风格的可交互演示，升级为能处理已授权 Amazon Ads 数据的运营工作台，并让 MCP/AI 在同一套可追溯事实上分析、生成广告调整草稿。保留用户熟悉的表格、筛选、排序、批量选择和层级下钻，但导航按运营工作流组织；UI 的每项能力都必须对应真实数据、动作限制和明确状态。

“同步所有 Amazon 数据”在本项目中定义为：同步已授权 Ads Profile 范围内、当前 Ads API 权限与官方接口支持、并经产品确认需要使用的 Ads 账户结构和绩效事实。它不代表抓取整个 Amazon、越过 Profile 权限、取得 API 不提供的数据，或无条件永久留存。广告结构、广告报表、SP-API 商品经营数据是不同授权和事实域；只有身份、站点、日期、币种、归因窗口及覆盖范围匹配时才可联动。

“保存到本地”采用本项目现有持久化边界：广告事实写入应用 PostgreSQL，支持服务端工作台和受控 MCP 查询；PPC Workspace 的 IndexedDB 继续用于本机草稿/快照恢复，不作为 Ads 云端同步事实的唯一存储。若运行方式是单机本地部署，则 PostgreSQL 位于该本地部署；若运行在服务器，MCP 读取的是该应用授权范围内的服务端数据库，不会自动复制到用户电脑。任何需要在 AI 客户端侧另存副本的方案应单独设计访问、加密、删除与同步边界。

优化边界：AI 可读取事实、解释口径、生成建议和可审阅草稿；广告变更仍走现有 Agent/PPC approval 与 action audit。批准和应用是不同状态。当前 Amazon Ads 写 transport 有闸门，未通过独立契约、安全和真实环境评审前不能把“可生成草稿”描述成“已能改 Amazon”。

## 当前基线

| 能力 | 当前代码状态 | 规划上的含义 |
| --- | --- | --- |
| 广告工作台 | Campaign、广告组、关键词、商品投放、否定项、搜索词、广告位、报告和账户页已存在；业务展示仍由 fixtures/mock provider 驱动 | 仍是后台式交互原型，当前指标不得用于业务决策；逐页接真实事实前需有显式 DEMO/真实模式分离 |
| Ads OAuth/Profile | 有 Ads 独立授权、Profile 发现、加密 refresh token、区域和 ERP 店铺绑定 | 不是 SP-API 授权；真人授权、跨区域、撤权/重连还需验收 |
| 同步 | 有计划、任务、队列恢复、租约/fencing、checkpoint、预算和失败分类；Sponsored Products Campaign/Ad Group/Keyword/Target 及两级 Negative 已有隔离只读 reader | `sync-adapter.ts` 生产入口仍 fail-closed；reader 未挂接 worker；具体 Report reader 未完成 |
| 持久化事实 | `AmazonAdsEntityRecord`、`AmazonAdsReportFact` 已有当前值模型；同步处理按业务键 upsert | 现有模型可供当前状态/当前事实读取，但会覆盖同键旧值，不能据此承诺完整原始响应或所有修订版本永久可查 |
| 读取 API | `/api/integrations/amazon/ads/data` 可按权限读取已存 entities/reports、分页并审计 | 路由不等于有数据；目前未提供总量、服务端排序/筛选全套参数和 UI 所需 freshness envelope，需按实际页面查询合同演进 |
| AI/审批 | Agent Gateway 注册 `amazon.ads.recommendation.plan/apply`；既有 PPC audit/approval 路径可承载已批准动作；Ads apply 受审批与执行闸门约束 | 复用现有审批与审计，不另建 change order、审批表或权限事实源 |
| MCP | `/api/mcp/amazon` 是个人 SP-API MCP 读取入口，不等于 Amazon Ads MCP；Ads Agent 工具与个人 MCP 入口不是同一合同 | 需要单独设计 Ads 只读/草稿工具如何暴露给目标 MCP 客户端，并校验 Ads Profile 权限；不得把 SP-API token 当 Ads 授权 |
| S5-S9 优化界面 | 已有建议工作台演示，状态为浏览器会话内 Mock | 可用于验证交互，不是正式持久化草稿、审批、执行或审计记录 |

现状依据：[Ads 代码审计](./ads-audit.md)、[Ads API 接入基线](./amazon-ads-api-integration.md)、[页面与同步进度](./amazon-ads-progress-2026-11-05.md)、[S5-S9 交付记录](./amazon-ads-s5-s9-delivery.md)、[窗口 E 评审](./amazon-ads-window-e-review.md)。

## 产品信息架构

主导航从 Amazon 后台功能镜像改为运营闭环，保留现有表格交互和兼容深链：

```text
概览
投放：Campaign / 广告组、投放对象、搜索词、广告位
商品：广告商品表现与可匹配的经营上下文
优化：建议与草稿、审批/执行记录
系统：数据健康与同步、账户/Profile、审计与策略
```

Campaign 的 SP/SB/SD 类型通过范围筛选，不再复制成多个重复入口。关键词、商品投放、否定关键词和否定商品归入“投放对象”页，以对象类型切换。报告生成在数据页作为次级操作；营销组合、品牌提升、Marketing Stream 等未接通能力不占主导航，不显示为已可用功能。

## 页面规格：UI 与功能一起定义

所有数据页面共用范围上下文：组织/工作区由服务端身份确定；用户可选 Ads Profile、站点、广告产品和日期。Profile、seller、marketplace 等范围由服务端权限约束，客户端参数不能扩大访问范围。所有指标展示来源、同步时间、日期窗口、币种、归因窗口（适用时）、freshness 和演示标识。字段不可用、上游未覆盖和数值为零必须区分。

### 概览

- **界面**：顶部范围栏；按结构、Campaign 日报、搜索词/广告位报表分组的数据新鲜度带；花费、广告销售、订单、点击、ACOS、预算状态 KPI；趋势图；可解释异常列表。
- **功能**：切换 Profile/日期后统一重查；点击 KPI 或异常进入对应列表并保留筛选；异常只采用已验证事实和有版本的规则，不在浏览器临时推断“预算受限”等状态。
- **数据/状态**：KPI 由服务端事实聚合；总销售额、TACoS、Buy Box 等经营指标仅在有匹配的 SP-API/商品经营来源与分母时显示。未授权、未同步、同步中、无记录、部分覆盖分别呈现，真实模式绝不回退到 mock。

### Campaign 与广告组

- **界面**：服务端分页表格，支持 Campaign/广告组层级切换、状态/类型/Portfolio/名称/预算/绩效筛选、列配置、排序和行详情抽屉。列包括状态、名称、广告产品、预算、花费、曝光、点击、CPC、销售额、订单、ACOS及数据覆盖提示。
- **功能**：分页、筛选、排序和总量来自服务端，状态与 URL query 同步；行详情下钻广告组、投放对象、搜索词和广告位；选择项可加入草稿，归档/不可编辑实体禁用不支持的动作。
- **数据/状态**：结构来自实体快照，表现来自相应 report facts，来源分层标注；SB 等数据缺失表示“暂缺/不适用”，不按 0 处理。导出只导出所选真实查询结果并写入口径，不以 fixture 冒充数据。

### 投放对象

- **界面**：类型 segmented control：关键词、商品投放、否定关键词、否定商品；共享筛选和表格，列随对象类型变化，保留 Campaign/广告组归属和实体 ID 的详情。
- **功能**：查看真实状态、匹配方式、当前 bid 及关联绩效；创建、暂停/启用、调价等入口只建立 Adjustment Draft。重复对象、父级不匹配、归档对象和无稳定 Amazon entity ID 的旧 Bulk 行不得进入 API 草稿。
- **校验/状态**：站点、币种、广告产品和实体类型对应的限制必须来自经核实的服务端政策。无策略、边界未知或数据过期时拒绝风险增加动作并说明原因；不采用演示固定百分比作为生产阈值。

### 搜索词

- **界面**：常驻口径条、查询范围与目标 ACOS/花费阈值筛选；表格展示 search term、触发对象、曝光、点击、花费、订单、销售额、ACOS、转化率和数据窗口；可勾选批量项。
- **功能**：支持按证据生成“加入否定词”“提升为关键词”“调整现有 bid”等草稿；草稿预览显示目标实体、前后值、影响范围、证据行、缺失上下文和策略版本。
- **口径/状态**：必须按实际 report contract 说明覆盖范围。例如某 API 只返回达到点击门槛的词时，明确指出不能覆盖 0 点击曝光词；不得承诺与 Amazon 控制台逐行或像素级一致。没有报表数据时不显示合成建议。

### 广告位

- **界面**：作为“投放”下的视图呈现广告位、Campaign、广告产品、期间和绩效，支持筛选及下钻。
- **功能**：读取经核实的 Placement report；可生成调整草稿，但执行能力必须以该站点/广告产品官方写接口和服务端策略为前提。无写契约时只提供分析和导出。
- **状态**：区分报表不支持、尚未同步、暂无事实和同步失败；不能用零值填充缺失数据。

### 商品经营联动

- **界面**：按广告实体/ASIN 查看可匹配的库存、价格、Buy Box、总销售等经营信息，并显示每个来源的时间戳和站点；多 ASIN Campaign 显示覆盖组成，不能将单一 ASIN 状态概括为 Campaign 状态。
- **功能**：用于解释广告表现和限制风险增加类建议；仅在 organization/workspace/seller/site/ASIN/日期/币种均匹配且数据新鲜时提供联动结论。未知或过期上下文保持未知，并阻止依赖它的加价/扩预算草稿。
- **边界**：Ads Profile 与 SP-API seller 授权分开检查；商品主数据仍以 ProductRecord/PostgreSQL 为准，经营快照是有来源的外部事实，不写回 ProductRecord。

### 优化与草稿

- **界面**：一个工作区展示规则/AI 建议、证据、草稿清单、逐项前后值、风险、冲突与缺失项；提交后链接到既有审批详情和 action audit。页面草稿、PPC adjustment draft 与 Agent approval 的状态分别清楚，不再出现“模拟批准”。
- **功能**：AI/MCP 与页面共享同一正式草稿/审批记录；创建草稿不等于提交审批，审批不等于应用，应用结果逐项记录成功、失败或结果未知。逆向操作产生新草稿并重新审批，不修改历史。
- **安全**：服务端重新核对用户权限、Profile/seller 范围、实体类型/父级、当前远端值、草稿 revision、策略版本、有效期与幂等键。未知执行结果先对账，禁止盲目重放。Ads transport 未实现时 UI 明确为“草稿/审批能力”而非“已修改 Amazon”。

### 数据健康与同步

- **界面**：按 Profile 展示授权/过期状态、绑定店铺、同步计划开关、最近成功时间、当前阶段、数据类型覆盖、请求/处理计数、下次任务、错误码和可操作的暂停/重试/手动运行按钮。
- **功能**：用户可在授权允许范围内查看和控制同步计划；手动运行创建有范围的任务而不在请求线程执行长任务；任务通过既有 queue/worker/checkpoint/resume 生命周期。
- **状态**：未连接、授权失效、等待 adapter、等待执行、运行中、部分完成、成功、可重试失败、阻断失败各自可识别。任务成功必须表示其明确的数据阶段成功，不得以“队列已入列”表示数据已同步。

## 数据同步、留存与可追溯

### 数据范围

按官方支持能力逐类接入，不把一个“全部同步”任务扩成不可控全量抓取：

| 数据类别 | 首要用途 | 接入顺序 | 留存要求 |
| --- | --- | --- | --- |
| Profile、Campaign、Ad Group、Keyword、Target、Negative 等结构 | 列表、层级、当前设置、可操作实体身份 | 先 Campaign/Ad Group，再扩实体 | 保留当前规范化状态与可审计的来源/同步版本；只有对比/回滚需要时才保留字段变更历史 |
| Campaign/Ad Group 日报 | KPI、趋势、效率分析 | 与首个结构只读切片配套 | 按可用范围增量同步并回补；保留 API 版本、站点时区、报告日、归因窗口及修订信息 |
| Search Term、Placement、Advertised Product 等报表 | 词/广告位/商品决策 | 逐报告类型核实 schema 后加入 | 保存报表窗口、来源、覆盖条件、生成/修订批次和原始维度；各报告可用范围不同，不共用未经核验的保留天数 |
| SP-API/经营上下文 | 断货、Buy Box、总销售分母等解释 | Ads 基础读链路稳定后单独对接 | 使用其现有授权、存储、隐私和保留边界；不复制为 Ads Source of Truth |

### 事实版本与保留

当前实体和报告表按自然业务键 upsert，满足当前值查询但不能独自满足“历史永久可查”。接 adapter 前需确定最小版本策略：保留同步运行/来源元数据；报表修订作为新版本记录，并在完整校验后发布当前可见版本；失败或不完整批次不覆盖最后一个完整版本。结构数据若只需当前状态，则明确历史能力限制；若要审计变化/恢复，则增加经评审的版本或变更记录，不盲目保存每次原始响应。

保留期限按 Amazon API 合同、用途、隐私/组织政策、数据库成本、备份和删除请求逐类决定。不得把附件中的 95/65 天、D+4 或“永久”直接写成普适事实；先验证实际接口保留、时区、归因迟到和修订周期。避免高频全量拉取；使用有界增量、幂等 upsert、限流/Retry-After、可恢复 checkpoint 和按 Profile 隔离。性能目标通过真实数据量 benchmark 决定，不能预设不实 SLA。

### 统一数据合同

每个查询和页面数据包至少能表达：`source`、`apiVersion`、`profileId`（仅在权限允许时）、`seller/marketplace`、`syncedAt`、`dateWindow`、`profileTimezone`、`currency`、`attributionWindow`、`freshness`、`coverage`、`isDemo`。不适用值为 null/明确状态，不伪造默认值。事实行与草稿保留稳定 Amazon entity ID、父级关系和来源 task/report batch。

## MCP / AI 工具合同

MCP 工具应接现有服务端权限、Agent Tool Gateway 和审计能力；个人 SP-API MCP 不自动取得 Ads 权限。首版只开放最小可用能力：

| 工具类别 | 预期能力 | 结果约束 |
| --- | --- | --- |
| 只读 | 查询 freshness/范围、汇总、Campaign/Ad Group、搜索词、投放对象、广告位和匹配的经营上下文 | 强制 organization/workspace/actor 权限；Profile 由服务端授权集合校验；结果带来源、日期、币种、归因和覆盖；大结果分页/聚合，禁止默认导出全账户明细 |
| 草稿 | 基于指定事实生成 bid/预算/否词/关键词等草稿 | 必须引用事实 ID/时间窗和目标实体 ID；执行服务端重复检查、策略检查、freshness 检查和 dry-run；返回缺少证据/阻断原因 |
| 审批/应用 | 首阶段不提供 MCP 直接批准或绕过 UI 的 apply | AI 只能提交既有人工审批流程；是否允许授权后的 MCP 用户查看/推进审批需另定义角色与审计，不改变现有人工审批规则 |

建议的 AI 工作流为：先读 freshness 与账户/Profile 范围；再读所需窗口事实；对证据和经营上下文做匹配校验；生成 dry-run 草稿；由用户在既有审批界面审阅并批准；执行若未来获批启用，则逐项记录结果且未知结果停下对账。提示词或客户端声明不能赋予工具额外权限。

## 实施阶段与完成条件

阶段按依赖推进；阶段完成记录代码/文档证据、验证命令、影响、回滚及未决项。该顺序是工程方案，不表示后续外部访问或生产改动已获授权。

### 当前落地状态（2026-11-06）

- 已离线完成 Sponsored Products Campaign 与 Ad Group list transport，具备注入式 fetch、必填响应字段校验、游标处理和脱敏错误分类；Campaign/Ad Group 的 `adsReadAdapterReady()` 仍为 false，不触发真实 API。
- 已补齐 Keyword、Target、广告组级及 Campaign 级 Negative Keyword/Target 六类 Sponsored Products v3 隔离 reader；Campaign 级否定对象使用独立 endpoint、media type、collection 和 campaign parent ID。fixture 校验父级、实体 ID、分页、核心字段与枚举；所有 readers 均未接入 worker 或生产 adapter。
- 已核实 Reporting v1 通用 create/retrieve 异步信封，但尚未核实具体日报类型的 fields/filter、下载 URL 白名单、格式/分片完整性、回补/修订周期。因此本阶段不实现可被误认为完整的通用 Reports reader。
- 新增离线 `parseReportingV1Envelope` 纯函数：校验官方成功/错误 envelope、状态、格式、日期周期、warnings 和分片元数据；丢弃临时分片 URL 与上游错误消息，不处理文件内容，也不产出广告事实。
- 本次离线验证：`npx tsx --test tests/amazon-ads-sync.test.ts`（14 项通过）、相关文件 ESLint、scoped `git diff --check` 通过。全仓 TypeScript 检查被工作区现有 Prisma schema/migration 与生成 client 不一致阻塞，详见本轮交付说明。
- 下一项只读开发可在继续官方合同核验后，为一个明确 Sponsored Products 报表类型补充 fixture transport 与解析器；在共享 schema、worker、事实版本/保留策略、服务端查询/API 或页面接线发生变化前，先提交具体影响、回滚和验证方案，等待明确批准。
- 完成本地离线 reader 不代表 Amazon Ads 数据已同步到本机 PostgreSQL；当前 worker 和生产 adapter 仍阻断，UI 仍需后续按真实数据接线。

### 规划遗漏与冲突审计（2026-11-06）

以下是原始规划没有充分定义、但完成“真实数据可查、AI 可安全决策”前必须收口的事项。它们是待办/决策，不代表已经实现或获准触碰生产。

| 项目 | 现状证据 | 需要补齐 | 阶段/边界 |
| --- | --- | --- | --- |
| Profile 身份映射 | DB 外键 `AmazonAdsEntityRecord.profileId` 指向 `AmazonAdsProfile.id` 内部主键；同步/筛选代码也以内部 ID 关联。页面/API 却将返回字段和 query 参数称为 `profileId`，容易被理解为 Amazon 数字 Profile ID | 统一 API 合同字段名；用户可见 Amazon Profile ID 与内部关联键分开表达；测试 Profile 切换、跨 Profile 与 seller 授权隔离 | P0/P2；改接口前先做兼容与权限影响评审 |
| MCP 是否为 Ads MCP | 当前 Agent Gateway 有 `amazon.ads.recommendation.*` 工具，但依赖传入 PPC 报告/草稿；当前 MCP HTTP 入口是 Amazon SP-API MCP。新增的通用 Skill data MCP 只注册库存、刊登、销售逐日表，Ads 逻辑表仍列为 `SCHEMA_UNVERIFIED`，没有 Ads facts 查询 | 为目标 MCP 客户端定义 Ads 专属身份、Profile 授权解析、只读 facts 工具和草稿工具；服务端 scope、审计、分页/聚合与错误脱敏测试 | P5；不能把 SP-API MCP 或通用 Skill MCP 宣称为 Ads MCP |
| 报告 API 版本冲突 | 原始规划 P-09/覆盖矩阵写 Reporting v3；当前接入基线转向 Reporting v1，但具体报告字段尚未验证 | 对 Campaign、Search Term、Placement 分别确认采用的官方 API/版本、权限、字段、归因、日期边界、限制与版本迁移策略，并统一两份规划 | P1/P4；不得混合 v1/v3 的字段口径 |
| 保留与删除政策 | 原始规划把 95/65 天云端窗口、D-1、D+4 和永久留存写作硬事实；当前证据尚未逐报告验证。现有事实表按业务键覆盖当前值，不能支持任意历史版本回看 | 官方逐报告留存/迟到修订核验；定义按组织/用途的保留期、撤权后的访问阻断、用户删除/组织关闭、备份过期和审计保留；在此之前不承诺永久历史 | P1/P4；涉及共享 schema、数据删除、备份或保留配置时须单独审批 |
| “本地”部署位置 | 原始目标称“落本地”，应用代码当前以服务端 PostgreSQL 为事实库；部署在服务器时数据不会自动复制到用户电脑 | 产品确定运行形态：单机本地 PostgreSQL，或服务器数据库由 MCP 受控读取；若需本地客户端副本，单独定义加密、授权、同步、撤销和删除 | P0 决策；不得暗中增加本地副本/同步机制 |
| freshness/覆盖的可计算规则 | 页面规格要求 freshness、coverage、部分数据；现有同步计划/事实表没有经报告类型验证的覆盖模型，现有 API 也没有统一 freshness envelope | 以数据源、报告类型、Profile 时区、完成批次和最近成功时间定义状态；区分 0、缺字段、无权限、未同步、部分完成、过期和失败 | P1/P2；API 与共享同步状态变更需批准 |
| 运行与成本治理 | 已有 API budget 协调与任务失败状态；报告生成的 Client ID 全局并发/每日容量、轮询次数、历史回补预算和存储增长尚未落实到报告任务 | 设定可配置的全局 create/poll/download 预算、最大回补窗口、并发/字节/行数上限、告警和 runbook；值须来自官方限制与实际成本，不抄规划常数 | P1/P4；可能影响 worker 资源、数据库增长和 P95，提交影响与验证计划 |
| 工作区改动基线 | 本次审计时工作区已有多个 Ads/MCP/设置相关已修改和未跟踪文件，包含新的通用 Skill MCP 变更；P0 所述“冻结并分组提交/stash”尚未完成 | 先盘点全部改动、确认归属与是否同属本项目，再建立可审阅基线；不擅自 stash、提交、推送或把无关文件纳入发布 | P0；任何 Git 同步前需先确认完整改动范围 |

**审计结论：** 以上遗漏不会改变当前 fail-closed 状态。当前可以继续做离线合同与 UI 原型工作；真实 Campaign 任务接线、报告留存/修订、服务端查询 API、页面切换、Ads MCP、正式草稿闭环分别受 worker/API/schema/权限或客户端授权边界影响，应按上表阶段逐项提交变更方案后再实施。当前 `adsReadAdapterReady()` 仍应为 false。

| 阶段 | 范围 | 完成条件 |
| --- | --- | --- |
| 0. 基线与演示隔离 | 盘点实际改动区及 PPC/Agent 边界；确认 DEMO/真实模式、现有授权与事实合同 | 真实模式无 mock 回退；三类无数据/未连/未同步状态分明；不清理或选择性忽略工作区已有改动 |
| 1. 只读数据合同 | 选 Campaign 结构 + 一类日报作为纵向切片；逐项核验官方端点、权限、区域、分页、字段、限流、异步与错误语义；为现有 adapter 写 fixture transport 和隔离测试 | adapter 继续 fail-closed 直到合同/测试满足；任务范围、checkpoint、幂等、审计可复现；无真实请求作为离线测试前提 |
| 2. 持久化与查询 | 明确当前值与版本留存策略；补齐服务端查询的 scope、total、排序/筛选、日期、来源与 freshness 合同 | 小范围历史回补及修订不会暴露不完整批次；权限隔离、分页和查询成本有测试/证据；如需 schema 变化，先审 migration 与回滚 |
| 3. 真实数据 UI | 先 Campaign/Ad Group，再搜索词、对象、Placement；依次接每类经验证事实 | 页面分页来自服务端；每个 KPI 可追溯来源/窗口/新鲜度；空缺、未覆盖和 0 分离；旧深链兼容；DEMO 模式明确隔离 |
| 4. 商品上下文与优化草稿 | 对接现有可信经营数据；页面和 Agent 使用同一事实/草稿合同；复用 PPC/Agent approval/audit | ASIN/站点/日期/币种匹配且 freshness 合格才联动；正式草稿有持久化 revision/幂等/审计；AI 与 UI 共用审批事实源 |
| 5. MCP 只读与草稿 | 将有限 Ads 查询和草稿工具映射到现有 Agent Gateway；为目标 MCP client 定义身份/授权连接，不混用 SP-API 凭证 | 权限越界、跨 workspace、过期授权、过期数据和大结果均 fail-closed；工具只能产草稿；隔离测试覆盖审计和脱敏 |
| 6. 写执行评审（单独决策） | 只有产品明确要自动应用广告改动时，核验每种 Ads 写 API、实体稳定 ID、现值冲突、审批绑定、逐项结果、未知结果处理、熔断及逆向草稿 | 单独审核具体变更方案并批准后才实现/启用；真实外部写入、配置启用和部署分别仍需明确授权。未批准时保持写 transport 关闭 |

## 验收

- 关闭演示模式后所有页面只显示数据库中的授权范围事实或明确状态，不出现 fixture KPI、样例账户、样例 ASIN、模拟报告和模拟审批。
- 所有页面与 MCP 读取遵循同一 scope；跨组织、工作区、seller、Profile 测试拒绝越权，并记录必要读取审计。
- 列表分页、排序、筛选与 total 来自服务端；URL 可恢复查询范围；表格 UI 与数据查询口径一致。
- 展示层能区分 0、null、不支持、尚未同步、过期和部分覆盖；每项指标能解释来源、期间、时区、币种、归因和更新时间。
- 搜索词/广告位等每种报表各自展示 API 覆盖和口径；与后台不一致时可以定位到合同/范围/更新时间，而不是宣称像素级一致。
- 历史修订可追溯；失败或部分数据批次不覆盖最后一次完整可用事实；保留规则有用途、范围和删除机制。
- 页面与 AI 只生成同一正式草稿；审批前无 Amazon 写请求。获批写执行是独立阶段，不能以演示测试替代真实授权。
- 不以单个 ASIN 状态推导混合 Campaign 安全；缺少匹配的经营数据时阻止依赖其安全结论的风险增加建议。

## 不纳入当前实施基线

Marketing Stream/SNS/SQS、AMC、ClickHouse、全量导出/无限历史回补、广告后台像素级复制、新审批/变更网关/并行审计表、固定全局调价与预算阈值、AI 自动批准、未经批准的真实 OAuth/API 调用、数据库迁移、配置启用、GitHub 推送和生产发布。需要时应按其真实权限、成本、性能和回滚范围分别提出方案。

## 回滚与验证路线

页面和查询改造优先保留旧入口及 DEMO 模式切换，以 feature/config 逐页回退到既有原型；数据同步可暂停计划并停止 adapter 调度，保留已写事实供审计，不通过代码回滚删除历史数据。schema 迁移、保留策略、真实凭证和外部写操作需要独立回滚/补偿方案；数据库迁移只能按仓库政策向前处理，外部广告变更以经审核的新逆向草稿补偿。

只读合同/解析器阶段运行对应 Ads adapter、同步、权限和隔离测试；查询/API/共享逻辑阶段运行 `npm run check:fast`；UI 局部变更运行相关浏览器回归和 TypeScript；schema/权限/worker/依赖阶段做专项验证；准备合码再运行 `npm run check` 与 `git diff --check`。真实 OAuth、真实 API、性能 benchmark、生产同步和部署只在目标、账号、数据范围与影响方案明确且获批后验收。

## 落地记录

### 2026-11-06：真实已存事实浏览首片

- 在 Amazon Ads 原型顶部增加“已同步数据”入口；与 Mock 工作台分开呈现，返回演示工作台不会改变既有 demo 状态。
- 新视图调用现有 `GET /api/integrations/amazon/ads/data`，分别浏览 PostgreSQL 已存 entity snapshots 和 report facts，提供类型/日期筛选、有限分页、来源 task/Profile、同步时间及原始维度查看。
- 空记录、加载和读取错误有独立状态；真实视图不读取 fixtures，也不会把空库显示成 Amazon 侧零活动。
- 此首片只证明界面能读出“数据库已存事实”，不证明事实已由真实 Ads API 产生。现有读取 API 尚无总量、完整 freshness/coverage 信封、Profile 时区和可靠币种展示，页面明确披露该合同缺口；当前工作台其他视图仍为 Mock。
- 未修改共享 API、schema、worker、adapter、授权配置或写入通道。真实 Ads 读取 adapter 继续 fail-closed，完整 P0/P1 未完成。
- 验证：`npx playwright test --config tests/browser/amazon-ads.config.ts`（12 项通过）；`npm run typecheck -- --pretty false`；对本次改动 TS/TSX 运行 ESLint。下一步先核验一个官方只读实体端点及响应/分页/限流合同，再以隔离 transport 实现 Campaign 切片；不连接真实账号。

### 2026-11-06：日报类型筛选

- 已同步数据页补充报告类型筛选，和既有实体类型、日期范围筛选并列；输入变化回到第一页，并将 `reportType` 传给已支持该参数的只读数据 API。
- 浏览器回归确认筛选值进入请求，且真实已存事实页继续与 Mock 工作台分离；本次没有改动 API、权限、schema 或 worker。
- 验证：`npx playwright test --config tests/browser/amazon-ads.config.ts`（12 项通过）、相关 ESLint、scoped `git diff --check` 通过。全仓 TypeScript 检查仍受本工作区未完成的 Prisma schema/client 对齐影响；本次 UI 测试用 esbuild 构建组件并运行隔离浏览器流程。
