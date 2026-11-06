# Amazon Ads 工作台升级规划

> 当前实施状态以文末「2026-11-06：获批的本地 P0 结构闭环」为准。前文离线阶段的 adapter 关闭描述是历史基线；本轮结构 adapter 已接线，但未启用真实任务，报告阶段仍阻断。

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


## 2026-11-06：获批的本地 P0 结构闭环（优先于前文离线状态）

本轮批准范围为 adapter/worker/现有实体存储/查询/UI 的本地实施与隔离验证；不含真实 API、真实任务、运行配置、数据库迁移、Git 提交推送或部署。期间工作区由其他任务产生新提交及 `amazon_ads_query_foundation` schema/migration/repository/query-service；本轮未改动这些 schema/migration，Prisma Client 仅做本地 generate。

| 范围 | 状态 | 证据与限制 |
| --- | --- | --- |
| SP 八类结构 adapter | 已完成并验证；真实环境未启用 | Campaign/Ad Group/Keyword/Target 与两级各两类 Negative，区域 endpoint、Amazon 外部 Profile header、独立 ID/父级、归档状态、分页、OTHER 表达式与脱敏错误；否定阶段每次派发一次请求，以版本化组合 cursor 保存具体 collection |
| worker → 快照 → 查询 | 已完成并验证（一次性 PG/Redis + fixture HTTP） | 复用租约/fence/checkpoint/队列；Prisma advisory lock 改用 executeRaw 避免 void 反序列化错误；结构结束标记 `COMPLETED_SP_STRUCTURE`，旧 reports checkpoint 在 token refresh 前阻断；成功只表示 SP 结构 |
| 当前实体存储 | 已完成并验证；不承诺历史版本 | 唯一键 organization/workspace/internal Profile/entityType/Amazon ID；task 创建顺序及 sourceUpdatedAt 防旧写；部分页原子提交并标注来源任务状态；未返回的行不删除，不推定为 Amazon 已删除 |
| 状态覆盖 | 已完成并验证 | 请求显式包含 ENABLED/PAUSED/ARCHIVED（官方允许的 live filters）；响应可保留其他合法状态。USER_DELETED 缺席不构成删除证据；不承诺完整删除流 |
| 实体查询 API | 已完成并验证 | `kind=entities` 分支使用 data-query；服务端 count/分页/排序、店铺/授权账户/内部 Profile/实体/父级/状态/名称关键词；实时 Seller/Marketplace 授权交集，CONNECTED Ads 授权及活动店铺；内部 ID 与 Amazon ID 分字段；结构拒绝报告日期筛选 |
| freshness | 已实现但能力有界 | 返回最近已存行同步时间、计划/最新任务状态、每 Profile 的币种/时区及按计划间隔计算的时效；不是报告日期覆盖证明，不将单个成功计划推断为全部数据域已同步 |
| 真实结构 UI | 已完成并验证 | 默认进入已存数据，八类实体切换、店铺/账户/Profile/层级/状态/搜索/排序、服务端 total 与翻页、来源与任务状态；显式返回 Demo，真实页无 mock fallback；尚未替换所有旧 Demo 详情/KPI/搜索词/广告位页 |
| 报告同步及版本 | 被依赖阻塞；未启用 | 不进入报告阶段；保留其他任务报告 schema/query 工作；具体 report 合同、历史回补、版本迁移/回填、真实来源样本另验收 |
| Ads 实体 MCP 工具 | 已完成并验证（隔离环境）；真实账号未启用 | 用户已批准只读切片；`amazon.ads.entities.list` 显式工具授权与实时范围交集已实现，详见下方追加记录；既有凭证不自动扩权 |
| 真实账号验证、迁移、运行配置 | 等待审批 | 本轮无真实 Ads 请求、无真实数据库迁移或启动同步；需要单独明确测试环境、Profile 与任务范围后执行 |

复现：`node scripts/test-amazon-ads-offline.mjs`（一次性预装 PG/Redis，显式环境白名单，禁止 dotenv、真实凭证、外网及镜像拉取；当前 schema db push 仅在临时数据库，不证明新 migration 已验收）。7 项覆盖八类持久化、Profile/站点隔离、total/筛选、429、重复派发、租约、旧写保护、API session、实际 BullMQ 消费、scheduler 恢复和暂停。Ads 页面隔离 Playwright 13 项通过。定向 reader 测试与最终静态检查见本轮交付结果。

回滚：撤销本轮代码切片恢复旧 adapter 阻断与显式 Demo 入口；环境停用/计划暂停须另按审批执行。保留所有已存快照与来源任务，不删数据、不回滚其他任务的 schema/migration。已观察的当前快照不具备多页全域原子发布或任意历史恢复能力。


### 本切片最终验证记录

- 已完成并验证：SP reader 16/16、一次性 PG/Redis 同步集成 7/7、隔离浏览器 13/13；TypeScript、修改文件定向 ESLint、`git diff --check` 通过。
- `npm run check:fast` 的核心测试 852/852 通过；全局 lint 被已有未跟踪 `.next-amazon-live/` 生成文件扫描阻断，本轮未删除产物或改全局 lint 配置。完整 `npm run check` / 生产构建未运行，合码前须先处理该门禁并重跑。
- 扩展 Amazon sync 离线集成 166/167 通过；未通过项为 returns fixture 的 application ID 冲突（`amazon-returns.integration.ts:82`），不作为 Ads 切片已通过的证据，也未扩范围修改该域。
- 本轮验证全部使用隔离 fixture 与临时数据库；没有真实 Amazon API/Profile 验证，没有启动真实同步、应用真实迁移或提交、推送、部署。临时库 schema 验证不替代并发任务新增 migration 的独立审阅与验收。


## 2026-11-06：获批的只读 Ads MCP 切片

**已完成并验证（隔离环境）；真实账号未启用。** `/api/mcp/amazon` 新增 `amazon.ads.entities.list`，读取 `AmazonAdsEntityRecord`，支持八类 SP 实体。没有 schema/migration、写工具、外部 API 或运行配置改动。

- 凭证必须显式包含新工具；旧凭证及其轮换不自动扩权。现有“允许工具”列表自动展示新工具，由用户创建新凭证时选择。本轮未创建或修改任何真实凭证。
- 复用 `withAmazonMcpBoundary` 与 `queryAdsEntities`：凭证范围、实时 ERP 个人/角色 Seller/Marketplace 授权、已有 verified SP source 范围、Ads CONNECTED 授权及绑定活动店铺的 Profile 求交集。SP source 只作额外范围前置条件，不代替 Ads 授权。没有已验证 SP source 的 Ads-only 范围暂不开放 MCP。
- 服务端分页（默认 50、最多 100）、真实 total、白名单排序；支持店铺/站点、授权账户、内部 Profile、实体/父级 ID、状态和搜索。不支持结构日期筛选；日期属于后续报告能力。
- 返回内部与 Amazon Profile ID、父级、白名单结构字段、来源任务、同步/上游更新时间、Profile freshness、字段说明及能力限制。原始 payload、accountInfo、凭证、checkpoint 均不返回；嵌套 budget/expression 同样使用字段白名单。
- 查询结束后再次检查 Ads Profile 绑定与 CONNECTED 状态，并复用 MCP 原有实时权限/数据源复查；在实际 SQL 等待期间解绑时阻断响应，不释放旧授权结果。

调用示例（需用户另行在目标环境创建明确授权的个人凭证；示例不含 token）：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "amazon.ads.entities.list",
    "arguments": {
      "internalProfileId": "<ERP内部Profile主键>",
      "entityType": "SP:campaign",
      "page": 1,
      "pageSize": 50,
      "sort": "syncedAt",
      "direction": "desc"
    }
  }
}
```

验证：`node scripts/test-amazon-ads-offline.mjs --mcp` 6/6 通过（一次性 PG/Redis、网络 guard、fixture 行），涵盖旧凭证缺工具、八类查询、分页、跨店铺/站点/Profile、字段脱敏、断连/解绑、查询中途解绑及撤权。既有 `node scripts/test-amazon-sync-integration.mjs --mcp` 31/31 通过。本轮核心测试 `npm run test` 856/856、TypeScript、修改文件定向 ESLint、`git diff --check` 均通过。沿用已记录的全局 lint 产物扫描阻断，本切片未重复执行全局 lint/完整生产构建；合码前需处理门禁后运行完整检查。临时数据库按当前 schema 建库，不代表并发任务 migration 已在真实环境应用或完成验收。

回滚：移除新工具注册/调用分支和专用 schema，恢复查询函数原签名；保留既有工具与全部实体数据。现有新工具凭证会收到拒绝，禁用真实凭证须另按目标环境审批操作。真实 Profile/API 验收、报告同步、写入/自动优化仍未完成；本轮未提交、推送或部署。


## 2026-11-06：获批的报表发布/查询收口与真实页面详情

此段优先于前文“兼容 version-less 成功事实”“通用 data_query 可读取 Ads”的历史状态。完整保留并行任务的 schema、migration、Client、worker 和 Bulk Operations 改动；本轮没有提交、推送、部署或真实请求。

| 范围 | 状态 | 实际能力与限制 |
| --- | --- | --- |
| 实体 MCP | 已完成并验证 | `amazon.ads.entities.list`，显式工具授权，读取八类 SP 当前结构；6项隔离验证仍通过 |
| 报表统一读取 | 已完成并验证（fixture 数据） | `report-query.ts` 成为 API/MCP 报表统一边界；仅最新 PUBLISHED+SUCCEEDED 事实；先选版本后筛维度；排除 legacy/staging/failed/canceled；保留 null；同一事务 count/分页/分口径汇总/freshness；不返回 rawDimensions |
| 报表显式权限 | 已完成并验证 | 新 `amazon.ads.reports.list` 需明确授予；旧 data_query/describe 访问 Ads 表也需该新工具，目录不向旧凭证自动开放；实时 ERP Seller/Marketplace 与 CONNECTED Ads Profile/活动店铺求交集，返回前再复查；旧库存/刊登/销售工具保留 |
| 读取边界与成本 | 已实现并验证有界行为；生产容量未验证 | 日期最多367天，单页100，Profile最多500；SQL单条8秒、读取事务20秒；MCP报表凭证每进程每分钟60次、最多10000个预算键。进程预算不是全实例共享限流；尚无真实 P95/容量 benchmark |
| 报表 staging/发布 | 已实现但未启用 | `report-publication.ts` 只在 `AMAZON_SYNC_OFFLINE_FIXTURE=1` 下可调用，manifest明确 ISOLATED_FIXTURE_ONLY；无 API/MCP 写入口，未接 report worker。字段/粒度/日期/币种/时区/归因/API校验，围栏和租约，去重事实键，实际去重rowCount，任务成功与发布同事务；坏页不部分入库 |
| 历史与撤回恢复 | 已完成并验证（隔离函数） | 保留版本/事实，WITHDRAWN隐藏，恢复保留原发布时间；事务失败保留STAGING并回滚任务成功；零行报告保持阻断，不推断清空历史。仅保证已观察事实键修订，不宣称整报告替换或任意历史恢复 |
| 结构详情/层级 | 已完成并验证 | 当前已存实体ID打开只读详情；显示内部/外部Profile、直接父级、状态、来源任务及时间；Campaign/Ad Group下属跳转保留Profile，Campaign否定与广告组否定分开 |
| 日报事实页 | 已完成并验证查询/UI接线；无真实报告采集 | 店铺/授权账户/Profile/父级/日期/报告类型/产品/搜索/排序/服务器分页；显示发布版本、发布时间和null占位；无原始维度泄漏，无虚构KPI；实际是否有数据由已发布事实决定 |
| 读取审计 | 已实现并验证 | 记录工具、调用者、范围、日期/白名单参数摘要、matchedCount/returnedCount、当前页来源版本和来源；不写入token/raw或搜索自由文本；不是全量跨页版本清单 |
| Skill/ERP | 已实现现有目录承接 | 复用既有动态工具和逻辑表配置，报表已连接检查纳入可用性；未重写任何 Skill 正文。完整逐报告覆盖/版本列表与Skill调用看板尚未实现 |
| 第一个真实日报/其他产品 | 被依赖阻塞 | 未核实具体Campaign Performance合同及真实Profile样本；SP真实report adapter仍关闭。SB/SD/TV不以SP字段冒充 |
| 真实测试Profile | 等待目标信息与独立审批 | 准备文件 `docs/amazon-ads-test-profile-readiness-2026-11-06.md` 明确缺口：未选目标环境/Profile，持久化测试请求预算/截止保护尚未实现，不具备可直接启动的真实验收方案 |

验证（本轮最终）：

- `node scripts/test-amazon-ads-offline.mjs --reports`：11/11，真实临时 PG/Redis，覆盖旧版本/legacy、null、显式授权、断连、staging/去重/发布/撤回恢复、坏行/取消/失败/围栏、事务失败回滚、SQL等待中撤权、API登录和API/MCP一致性。无TODO或跳过项。
- `node scripts/test-amazon-ads-offline.mjs`：结构同步7/7与实体MCP6/6；并行任务新增租约恢复行为按最新代码验证，无worker实现覆盖。
- 原有 MCP 集成31/31、核心测试857/857；Ads隔离浏览器16/16，包括真实实体详情、日报版本/null/筛选，以及真实浏览器DOM下Bulk导出不可变原文件、实体ID保留、勾选边界与旧值冲突保护。需账号的完整PPC登录/上传/恢复E2E未运行，不冒充已覆盖。
- TypeScript、修改文件定向ESLint、`git diff --check`通过。完整 `npm run check`/生产构建未运行，沿用已记录的`.next-amazon-live/`全局lint扫描门禁；未清理目录或改全局配置。

汇总按币种、报告类型、广告产品、API版本和归因窗口分组，不跨口径计算ACOS/ROAS；未知归因或币种不能作经营绩效结论。freshness仅表示已发布观察数据的日期/发布时间，不表示全量覆盖、最终归因或已做时效SLA判定。查询中不同口径分区不会互相替换。

回滚为撤销本轮代码恢复前一实现，保留全部数据；不自动恢复不安全的legacy读取。关闭真实工具/凭证或计划、执行真实迁移/发布需重新按目标审批。没有广告写调用、自动优化或AI建议执行。

最终只读核对：通过 `@prisma/client` 实际模块解析路径检查运行时生成 schema，按 model/enum 块比较字段与约束（忽略格式、字段顺序和等价属性顺序）与当前工作区一致；根 node_modules/.prisma 下另有旧副本，不是当前实际 Client，本轮未覆盖或清理。此检查与TypeScript通过均不证明 migration 链或真实数据库一致，真实迁移仍待独立审批与验收。


### 2026-11-06：报表发布合同与撤回恢复并发校验补强

- **已完成并验证**：发布及恢复先重建全部存储指标，再校验 manifest 白名单。impressions、clicks、orders、units、spend、sales 任一列出现合同外非 null 值（包括零）均拒绝，失败事务保留 STAGING / WITHDRAWN，任务不会误报成功。
- **已完成并验证**：撤回／恢复在取得任务级 advisory lock 后重新读取版本和来源任务；等待期间来源任务变为 FAILED 时拒绝恢复，避免使用锁前的成功状态。
- 验证：`node scripts/test-amazon-ads-offline.mjs --reports` 13/13（本轮新增六类存储指标污染及锁等待期间任务失效回归）；TypeScript、两处修改文件定向 ESLint 与 `git diff --check` 通过。临时 PG/Redis 使用 fixture，未继承真实凭证或访问 Amazon。隔离 db push 不代表 migration 链验收。
- 本轮只改 report-publication 服务和对应集成测试；UI、结构 worker 和 MCP 契约沿用上一轮验证，不重复运行浏览器或全套核心测试。完整 check/生产构建未运行，仍受已记录的全局 lint 扫描产物门禁影响。
- **已实现但未启用**：报表发布服务仍仅限离线 fixture，无写 API 或 worker 接线。
- **被依赖阻塞／尚未实现**：真实报表合同与下载 adapter、指定测试 Profile 的真实采集验收仍未完成。实体／报表只读 API 和 MCP 已接本地存储，但尚无本任务真实 Amazon 同步验收数据；AI 广告写入与自动执行保持关闭。
- 未改 schema、migration、生成 Client、配置或真实任务；未提交、推送或部署。回滚仅恢复本轮服务与测试代码，不删除事实或版本。


### 2026-11-06：日报汇总精度与合同分区回归

- **已完成并验证**：修复报表查询将 SUM(bigint) 强制转回 bigint 导致溢出的问题。保留 PostgreSQL numeric 汇总，Decimal 以完整十进制字符串输出，避免科学计数法和 JavaScript Number 精度损失；null 仍表示未提供。
- 隔离 PG 先复现 `22003 bigint out of range`，再验证 110 行最大合法 bigint 的 impressions/clicks/orders/units 汇总、六位小数金额累加、空 sales，以及 API/MCP 单页1条仍返回真实 total=110，不受汇总失败阻断。MCP 仍按既有契约返回 items/total，不新增汇总字段。
- **已完成并验证**：相同旧 factKey 在不同币种、API版本、归因窗口中保留独立版本与汇总；同口径旧行被替代后，Campaign 筛选不会使其重新出现。
- 广告账户页仅增量修复重试按钮配置空值保护：配置数据未就绪时禁用按钮，保留已有同步任务中心改动。未调用真实重试接口。
- 本轮验证：报表隔离 PG/Redis 集成15/15，Ads隔离浏览器16/16，TypeScript、三处代码文件定向ESLint、git diff --check通过。浏览器使用既有模拟API，不代表真实账户/真实数据验收，也未新增账户重试的浏览器用例。
- 完整 check/build 未运行；本轮采用相关集成、类型、lint和已有浏览器回归，无 schema/依赖/构建链修改。既有全局 lint 扫描 .next-amazon-live 产物问题未处理。
- **已实现但未启用**：报表发布仍为离线fixture服务。**被依赖阻塞／尚未实现**：真实报表读取合同、adapter及指定授权测试Profile的采集验收；实体和报表API/MCP已接本地存储，但未据此宣称真实Amazon数据同步成功。AI写入继续关闭。
- 未改schema/migration/Client或配置，未执行真实外部请求、任务、提交、推送或部署。回滚可恢复本轮查询、空值保护及测试代码，保留数据。


### 2026-11-06：结构同步生命周期与任务概览

- **Phase B 已完成（离线）**：Sponsored Products 八类结构数据接入既有 worker 与数据库快照；每次 dispatch 写 Attempt，成功时更新结构域 freshness；429/可重试失败保留此前成功时间；过期 lease 在事务中 fence、结束 Attempt 并从 checkpoint 恢复。真实 API 与自动同步运行配置仍关闭。
- **Phase C 本地任务中心已扩展并验证**：同步状态 API 支持 Profile/状态筛选和服务端分页；Profile 与 Marketplace 权限通过统一 scope helper 过滤，Profile 列表也按相同 grant 收窄。账户页显示完整授权 Profile 选项、任务/Attempt 历史、取消确认及刷新。取消在服务端递增 fencing、结束最新活动 Attempt、保留已提交事实与历史 Attempt，并使旧 dispatch 在外部请求前失效。
- Phase C 已有任务详情、受限来源记录和按页 Attempt 时间线，任务访问先经过组织/工作区/Profile 授权过滤；仍缺独立审计事件时间线。Reporting freshness 必须绑定成功发布版本与报告日期覆盖，不复用结构 freshness。完整范围、回滚和限制见 [Phase C 交付记录](./amazon-ads-phase-c-delivery-2026-11-06.md)。
- 本轮验证：核心测试860/860、Amazon Ads 结构/权限/取消与 MCP 隔离集成27/27、报表隔离集成15/15、Ads工作台浏览器21/21、TypeScript通过、定向ESLint无错误（1条既有React依赖warning）、`git diff --check`通过。未运行完整 `check:fast`/生产 build；未执行真实 API、持久数据库迁移、真实任务、凭证/配置修改或部署。
- 下一步：定义 reporting freshness 的发布版本/日期覆盖语义和独立审计事件呈现；真实授权测试 Profile 的数据采集仍需另外完成目标环境审查，不把离线 fixture 结果当真实账户验收。


### 2026-11-06：真实实体页面标准字段接线

- **已完成并验证**：列表和详情优先使用 API 标准字段 name/keywordText/bid/budgetAmount/matchType/campaignId/adGroupId，旧快照字段缺失时兼容原始 payload；零竞价不会被空值替代。原始字段折叠区仍单独保留来源值，不与当前标准值混淆。
- **已完成并验证**：只读详情增加 Campaign/AdGroup ID、预算类型、投放类型、表达式类型与投放表达式、起止日期；Ad Group 下钻携带标准 Campaign ID、Ad Group ID及内部 Profile，避免过期 payload 破坏筛选隔离。
- **已完成并验证**：页面开放现有 API 白名单的 name/budgetAmount/bid 服务端排序；更换筛选或数据域开始加载时清除前次结果与来源元数据，防止日报显示结构总量或旧范围同步时间。
- 本轮代码范围仅 ads-synced-data.tsx 和对应浏览器回归，未修改共享API/worker/schema。Ads隔离浏览器18/18，TypeScript、定向ESLint、git diff --check通过；新增覆盖标准字段覆盖旧payload、空payload、零竞价、下钻请求与加载期间旧总量/来源清除。测试使用模拟API，不代表真实Amazon采集验收。
- 验证按UI级别执行，未重复数据库/核心全套、check或生产构建；API/MCP行为沿用上轮隔离验证。文档/API接入记录与下载目录原规划同步追加。
- **已实现但未启用**：报表发布服务仅离线fixture；**被依赖阻塞／尚未实现**：真实报表合同与adapter、明确授权测试Profile的真实数据采集验收。八类SP结构和已发布日报的页面/API/MCP接本地存储，尚未宣称本任务已采集真实经营数据；AI写入关闭。
- 无真实外部请求、配置、任务、迁移、提交推送或部署；未覆盖其他任务已有改动。回滚本轮UI和测试代码即可，不影响数据库记录。


### 2026-11-06：结构查询返回前授权复核与父级筛选修正

- **已完成并验证**：结构API在实体行/count/freshness读取后，重新读取实时ERP权限和当前Profile；CONNECTED、活动店铺及授权/外部Profile/店铺/站点/币种/时区绑定变化均拒绝整次结果，403不携带行、总量或来源元数据。使用既有repository边界，每次读取增加一次实时授权与最多1000个Profile的有界复查；不新增缓存、模型或接口字段。
- **已完成并验证**：Campaign筛选仅将Ad Group和Campaign级否定项的直接父级当作Campaign。Keyword/Target等广告组子项的父级ID即使与另一Campaign ID相同也不会误入；其归属继续按标准campaignId或兼容payload判断。旧Ad Group与Campaign否定项仍保留直接父级兼容路径。
- 本轮隔离PG/Redis回归：结构同步/查询12/12、实体MCP6/6；覆盖实际SQL锁等待期间撤权、授权断连、Profile解绑、店铺停用、管理员仍可见范围内店铺/站点重绑、相同数字父级ID碰撞及真实服务端分页。API测试成员fixture显式授予workspace:view，未放宽生产权限。
- 核心测试857/857、TypeScript、两处修改代码定向ESLint和git diff --check通过。UI无改动，沿用上轮浏览器18/18；未重复报表PG测试。完整check/build未运行，既有全局lint扫描产物问题不在本轮范围。
- 复核用于避免释放查询期间已失效的权限快照，不宣称跨数据库事务与HTTP发送绝对原子，也未在本切片改造结构count/rows的事务一致性；生产P95仍待真实规模benchmark。
- **已实现但未启用**：报表发布仅离线fixture；**被依赖阻塞／尚未实现**：真实报表合同/adapter和授权Profile采集验收。当前实体/日报API与只读MCP接本地存储，不表示已完成本任务真实Amazon采集；写入及自动执行关闭。
- 未修改schema/migration/Client/配置、未调用真实API或启动真实任务，未提交推送部署。回滚仅恢复query-service与对应测试，保留数据；不覆盖其他任务改动。


### 2026-11-06：结构域状态真实性收口

- **已完成并验证**：修复Worker的SYNCING状态被查询汇总误判为CURRENT。未知/取消/未识别状态不再默认成功；授权Profile中部分缺少状态或部分未知时，只能PARTIAL或UNKNOWN，失败和运行中状态保持优先。
- **已完成并验证**：结构页选择Keyword/Target等类型仍查询结构域状态（reportType为空）；不再把entityType作为reportType绕过域记录，从而用旧成功快照盖住当前失败/运行中状态。该状态代表八类SP结构域，不宣称每实体独立完成证据。
- **已完成并验证**：meta Profile freshness取数据域状态，计划ACTIVE单独保留在syncPlans中；最近结构成功时间仅取数据域成功，不从计划成功时间制造数据成功。无域记录时，仅来源任务SUCCEEDED且stage=COMPLETED_SP_STRUCTURE可作为成功兜底；其他成功旧阶段为UNKNOWN，附ENTITY_FRESHNESS_FROM_SNAPSHOT警告。此CURRENT仍不证明缺失行删除或达到时效SLA。
- **已完成并验证**：实体页面展示结构域状态、最近结构成功与来源警告；未知、部分和运行中均不会被计划ACTIVE掩盖。保持Amazon式布局和只读交互，无新增外部调用或自动行为。
- 验证：结构同步/查询隔离PG14/14、实体MCP6/6、查询单测4/4（含12组状态/缺失Profile组合）、Ads模拟API浏览器19/19、TypeScript、定向ESLint及git diff --check通过。fixture数据库db push不代表迁移链验收。未重复完整核心857项、报表PG或check/build；前轮核心通过，且本轮仅查询状态/兜底及显示变化。
- 本轮文件边界：query-service、repository的读取兜底、ads-synced-data及对应测试；未修改Worker、schema/migration/Client、MCP契约或配置。无新增数据库查询，只扩展既有select与内存状态归并。
- **已实现但未启用**：报表发布仍离线fixture；**被依赖阻塞／尚未实现**：真实报表合同/adapter及明确授权Profile真实采集验收。实体/日报只读API和MCP承接本地存储，尚无本任务真实Amazon采集验收结论；广告写入和自动执行关闭。
- 未执行真实API、配置、任务、迁移、提交推送或部署。回滚恢复本轮读取/显示与测试代码，保留数据和其他任务工作。


### 2026-11-06：结构API单次查询快照一致性

- **已完成并验证**：生产结构查询将初始ERP授权、Profile/计划元数据、行、真实total及freshness纳入同一PostgreSQL只读RepeatableRead事务。同步在读取过程中提交新记录或状态时，本次响应保留一致快照，下一次请求再读到新数据。
- 返回前授权/Profile绑定复核及读取审计仍在事务外执行；未用旧事务快照替代实时撤权复核。既有真实SQL锁等待中撤权、断连/解绑/店铺变更测试保持通过。
- 事务沿用报表读取保护：statement_timeout=8秒、事务timeout=20秒；repository接受既有Prisma TransactionClient，不新增数据库模型、缓存或API字段。事务占用连接和MVCC快照的生产P95仍待规模验证；不宣称零成本或跨多次翻页保留同一快照。
- 本轮隔离PG/Redis：结构同步/查询15/15、实体MCP6/6。新增确定性并发回归：先读8行，另一连接原子提交第9行和FAILED域状态，再执行count/freshness；本次仍8条/旧状态，后续生产查询为9条/FAILED。
- 查询单测4/4（状态矩阵按并行任务现有CANCELLED=PARTIAL及WAITING_FOR_CONFIG=SYNCING更新，不回滚其实现）、TypeScript、定向ESLint和git diff --check通过。UI及返回契约未改，沿用上轮浏览器19/19；未重复核心/报表全套、check或生产构建。
- 本轮仅query-service只读事务、repository Client类型及对应测试；未改worker/schema/migration/生成Client/配置。隔离db push不等于真实迁移验收。
- **已实现但未启用**：报表发布离线fixture；**被依赖阻塞／尚未实现**：真实报表合同/adapter、明确授权Profile真实数据采集验收。页面与实体/报表只读MCP继续承接本地存储，尚未据此宣称本任务已同步真实Amazon经营数据；广告写入及自动执行保持关闭。
- 未执行真实外部请求、任务、配置、迁移、提交推送部署。回滚本轮查询事务与类型/测试即可，数据保留；其他任务修改保持不动。


### 2026-11-06：只读实体MCP标准字段与查询语义对齐

- **已完成并验证**：MCP实体查询复用页面buildAdsEntityWhere和freshnessEnvelope；支持标准name/keywordText的大小写不敏感搜索，以及标准Campaign/AdGroup归属。标准字段已存在时，过期payload的同字段不再参与筛选；旧空标准字段仍保留payload兼容。页面查询同样获得该标准字段优先修正。
- **已完成并验证**：MCP fields优先返回标准字段、零竞价、精确十进制预算和标准表达式，继续执行嵌套budget/expression白名单；不会泄露payload私有字段、token或非白名单表达式字段。字段名和既有items/total结构保留；规范化Decimal返回十进制字符串，兼容旧payload的字符串/数字值。
- **已完成并验证**：MCP结构freshness读取已有结构域状态，不再以计划成功时间推断完成；meta.coverage提供CURRENT/SYNCING/FAILED/PARTIAL/UNKNOWN，Profile级状态同一口径。lastSyncAt仍为筛选行最近保存时间，不能当作全域成功时间。无额外实时Amazon请求。
- 只读RepeatableRead事务增加8秒statement_timeout/20秒事务timeout。Profile超过500时明确拒绝并要求缩小范围，不静默截断元数据；显式工具授权、ERP/站点/Profile交集及返回前绑定/凭证复核保持。
- 验证：结构同步/查询隔离PG15/15、实体MCP最终9/9（新增标准字段与空/旧payload、字段脱敏、域状态和501个Profile边界）、原有MCP集成31/31；浏览器19/19、TypeScript、定向ESLint和git diff --check通过。测试全为隔离fixture，无真实API或经营数据。
- 浏览器fixture与并行任务当前账户页对齐：移除一份完全相同的重复plans属性，将旧“同步任务中心”断言定位到现有“任务历史”。未回滚其账户页实现。未重复完整核心、报表PG或check/build。
- 本轮范围data-query/query-service/mcp与对应测试；新增域状态读取沿用既有有界Profile/repository路径，没有新增模型/缓存/写入口。生产P95及多实例查询容量仍待真实规模验证。
- **已实现但未启用**：报表发布离线fixture；**被依赖阻塞／尚未实现**：真实报告合同/adapter和明确授权测试Profile真实采集验收。页面/API/只读MCP已接本地存储，不等于本任务完成真实Amazon采集；广告写入和自动执行保持关闭。
- 无schema/migration/Client/配置修改、真实请求/任务/迁移、提交推送部署。回滚本轮查询与MCP序列化及测试即可，保留全部数据和其他任务修改。


### 2026-11-06：查询参数歧义保护

- **已完成并验证**：API解析前拒绝同一参数重复但值不同、三种Profile别名值不同、两组排序字段/方向别名冲突。明确返回400，不静默选择第一个/优先别名；值相同的重复参数及Profile别名保持兼容。Profile仍指ERP内部主键，不把外部Amazon ID自动转换为内部ID。
- 结构与日报API共用校验，离线结构reader也复用冲突保护并保留SyncInputError错误协议。校验仅遍历请求参数，不新增数据库查询、模型或外部调用。未新增MCP参数别名，也未扩展原有工具授权。
- **已完成并验证**：当前并行编辑将adsEntityFields调用误传payload，定向回归复现标准字段回退与类型错误后，仅恢复传入完整row；保留同文件其他任务新增工具和实现。
- 验证：参数/查询单测5/5；隔离PG结构同步/查询16/16，含已登录结构与日报API冲突参数400、响应不含数据/total/meta及相同Profile别名200；实体MCP最终9/9，TypeScript、定向ESLint及git diff --check通过。最初整组运行捕获上述MCP回归，修复后单独重跑实体MCP验证。全部隔离fixture，不使用真实凭证或API。
- 本轮无UI改动，沿用前轮浏览器19/19，未重复全套核心、报表发布PG、check/build。回滚仅恢复参数校验/测试；MCP调用修复保留既有标准字段契约，数据不受影响。
- **已实现但未启用**：报表发布仍离线fixture；**被依赖阻塞／尚未实现**：真实报表合同/adapter及指定授权Profile真实采集验收。页面、只读实体和报表MCP承接本地存储，不宣称本任务真实Amazon同步成功；广告写入和自动执行关闭。
- 未修改schema/migration/生成Client/配置，未执行真实任务、外部请求、迁移、提交推送或部署；其他任务修改保留。


### 2026-11-06：日报筛选范围汇总页面接线

- **已完成并验证**：日报页面消费既有API totals，展示当前筛选范围跨全部分页的服务端汇总，注明真实total与返回的日期范围；不在前端累加当前页、不硬编码总量。
- 按报告类型/广告产品/币种/归因窗口/API版本逐组展示曝光、点击、花费、订单、销售额和件数；不合并跨口径分组，不新增客户端ACOS/ROAS计算。未知币种、未知归因明确标注；数值以来源十进制字符串显示，零保留为0，null显示—。聚合仍仅代表已观察的已发布事实，不证明全域覆盖或最终归因。
- 加载/错误/切换实体域不展示旧汇总，筛选返回空totals时隐藏汇总；详情分页和只读入口保持。没有新增请求、数据库查询、外部调用、schema或API契约。
- 验证：Ads模拟API浏览器20/20，新增跨分页服务端total=101而当前页仅1行、三口径独立分组、超安全整数/六位金额精度、零/null、未知口径及空筛选隐藏；组件限定TypeScript和两处修改文件定向ESLint、git diff --check通过。
- **验证阻塞**：全仓TypeScript因其他任务正在修改的src/lib/amazon-sync/mcp.ts:279语法错误失败，本轮未覆盖其新增状态工具。组件限定检查使用临时tsconfig extends仓库配置、incremental=false，检查后临时目录自动移除；不将限定检查冒充全仓通过。本轮UI切片未重复PG/核心全套或check/build。
- 本轮仅ads-synced-data.tsx、浏览器回归及规划/API文档。**已实现但未启用**：报表发布仍为离线fixture；**被依赖阻塞／尚未实现**：真实报表合同/adapter、明确授权Profile真实采集验收。汇总接本地存储API，不代表已采集真实Amazon经营数据，测试未访问真实API。
- 未执行真实请求、配置、任务、migration/Client生成、提交推送或部署；广告写入关闭。回滚本轮UI与测试即可，保留数据和并行任务修改。
