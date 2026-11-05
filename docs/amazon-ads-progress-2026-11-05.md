# Amazon Ads 广告管理与优化进度总报告

更新日期：2026-11-05

范围：本地仓库 `/amazon-ads/campaigns` 广告管理工作台、Amazon Ads 授权/同步后端，以及已实现的优化建议演示。

证据边界：本报告依据代码、规格/交付文档、隔离测试和本地页面 HTTP 状态。当前访问 `http://localhost:3017/amazon-ads/campaigns` 会重定向到登录页，因此没有登录态页面检查；没有连接真实 Amazon Ads 账号、调用真实 Ads API、读取生产数据、操作数据库或服务器。

## 1. 当前结论

当前属于“可交互 UI 原型 + 安全的授权与同步基础设施 + 优化流程演示”，还不是已接入真实广告账户的生产工作台。Campaign、Ad Group、Keyword、Target、Search Term、Placement 等表现数据来自本地 fixture/mock provider。广告实体/报表读取 adapter 明确未实现并 fail-closed，因此现有 KPI、图表和导出都不能作为真实广告绩效或实际优化效果。

后端基础已经较完整：Ads OAuth 独立于 SP-API；支持 Profile 发现与店铺绑定；具备加密凭证、同步计划/任务、队列、租约与 fencing、检查点、限流预算、审计及分页读取已存事实的 API。真实请求链路在读 adapter 完成前不会进入 Amazon Ads 读取阶段。自动同步默认为关闭，且受组织/工作区 allowlist 限制。

优化建议方面，既有 PPC Draft/审批/Agent Gateway 能力仍是正式写操作应复用的边界；S5–S9 当前交付的是隔离的 Mock 会话演示，覆盖关键词/定向草稿、规则/经营上下文护栏、dry-run/模拟审批、会话审计/逆向草稿。没有任何演示动作会写回 Amazon。

## 2. 进度总览

| 工作流 | 已完成 | 当前状态 | 生产验收缺口 |
| --- | --- | --- | --- |
| 广告管理 UI | 导航、Campaign 列表与详情、广告组/关键词/投放/否定项/搜索词/广告位、筛选、排序、分页、列配置、CSV、KPI/图表、报告、偏好设置 | Mock 演示可交互 | 页面尚未接真实实体和报表事实；需登录态体验确认 |
| 会话内编辑 | 创建 Campaign/Ad Group 演示记录；编辑预算/竞价；批量启停；Placement 出价、预算规则、状态和事件记录 | 仅当前页面会话/浏览器状态 | 不持久化到服务端，不改变 Amazon，也不是审批记录 |
| Ads 账户 | 独立 OAuth 起始/回调、Profile 发现、refresh token 加密、区域 Profile 元数据、ERP 店铺绑定 | 服务端代码已实现，浏览器测试以 mock API 验证 | 用户真实授权、跨区域/重连/撤权隔离验收未做；真实 OAuth 会访问 Amazon |
| Ads 同步 | 计划/任务模型、队列恢复、检查点、租约/fence、API budget、任务控制与审计 | 框架已接通，读 adapter 未实现 | 逐实体/报表官方契约、adapter、隔离集成及真实账号小范围验收 |
| 数据读取 | 分页读取已存实体/日报事实 API，组织/工作区/卖家范围与读取审计 | 读取“已有记录”的接口存在 | 数据源仍无真实 Ads 同步产物；UI 也未消费此 API |
| 优化建议 S5–S9 | 关键词/定向草稿、规则提示、经营上下文护栏、dry-run、模拟审批、事件与逆向草稿 | Mock 演示已交付 | 应复用 PPC 审批和 Agent Gateway；持久化、真实政策、执行、审计、回滚契约未完成 |
| 报告/数仓 | 演示报告本地生成与 CSV 下载 | Mock | 官方 Reporting/Exports 真实链路、口径/归因/新鲜度和仓储验证未完成 |
| 实时与高级洞察 | 导航占位（营销组合模型、品牌提升研究等） | 规划中 | 数据合同、流式来源、实验设计与真实业务证据均缺少 |

## 3. `/amazon-ads/campaigns` 页面能力细目

### 3.1 页面框架与范围选择

- 左侧工作区导航：广告账户与授权；全部 Campaign、SP/SB/SD；建议；关键词、商品投放、否定投放、搜索词、广告位；报告摘要、搜索广告报告；营销组合模型和品牌提升洞察占位。
- 支持账户、国家/地区、广告类型和日期范围选择。示例账户/国家及货币来自演示 fixtures；日期筛选驱动 mock 指标，不代表服务端查询。
- 支持折叠侧栏、移动端导航、紧凑/舒适行高、默认首页等偏好。偏好放在 sessionStorage 的演示键中。
- 页面底部明确提示为演示环境，数据口径与真实平台归因可能不同；表格导出文件名带 `DEMO-`。

### 3.2 Campaign 列表与详情

- Campaign 列表包含投放状态、名称、广告类型、每日预算、日期及表现指标等可配置列；支持关键词搜索、状态过滤、排序、25/50/100 条分页、当前页/筛选结果选择、列显隐、表现视图和 CSV 导出。
- Campaign 详情包含广告组、竞价调整、否定投放、预算规则、设置、历史等页签；可查看按所选日期范围聚合的 KPI/趋势图，隐藏/显示图表和选择指标。
- 广告组详情提供商品广告、关键词、商品投放、否定关键词/商品投放、搜索词、广告表现等视图。
- 表格支持会话内批量启用/暂停；预算/默认竞价可内联编辑；创建 Campaign/Ad Group 会生成已暂停的演示行。归档项限制编辑。
- 上述改动只存在于 React 会话状态；预算/竞价编辑会增加本地事件日志，但无服务端持久化、preview/apply 请求或 Amazon 写调用。

### 3.3 分析与报表页面

- 关键词、商品投放、否定项、搜索词、广告位等表格会显示相应维度与表现数据，并可按 Campaign/Ad Group 等范围筛选。
- 表格搜索、过滤和排序同步作用于当前 mock 行；测试覆盖累计指标计算、比率按汇总事实求值、Placement 保留 Campaign/广告类型/账户身份、否定投放关联和搜索词触发对象。
- 报告页可以在本地生成 Campaign/Ad Group/Keyword/Search Term/Placement/Product 类演示报告，展示 ready/generating/failed 状态样例并下载 CSV；不会启动后台报告任务。
- 营销组合模型、品牌提升研究当前是规划占位，不能误认为已有真实洞察能力。

### 3.4 当前 UI 数据边界

- fixtures 提供演示 Campaign、Ad Group、日报指标、搜索词、Placement、报告等数据；mock provider 根据选定账户、市场、日期及维度合成或聚合结果。
- 不应把演示账户名、ASIN、账户指标、预算、订单、销售额、ACOS/ROAS 或模拟趋势写入业务结论、运营建议或绩效复盘。
- 当前正式 Ads 数据读取 API 查询的是数据库中已经落地的实体/报告事实，而 UI 主工作台仍从 mock provider 取数；二者尚未打通。

## 4. 授权、同步和数据链路

### 4.1 授权

- Ads 使用自身 LWA/OAuth、refresh token 和 Ads Profile；与 Seller Partner API（SP-API）授权、token 和业务语义分开。
- OAuth state 一次性校验，refresh token 密文按 organization/workspace/authorization 作用域加密；Profile 解析验证身份、区域及站点元数据，并能协调成功检查区域内的 Profile 状态。
- Profile 可绑定 ERP Seller Account。页面绑定测试覆盖已有 Profile 的店铺绑定，且测试不主动发起 OAuth。
- “配置了凭证”或“Profile 可见”均不等价于同步成功或 Ads API 数据已经可读。

### 4.2 同步框架

- 计划阶段按 `campaigns → ad-groups → keywords → targets → negatives → reports` 组织；任务有日期范围、状态、尝试次数、页数/处理数、API 请求数、错误摘要和加密 checkpoint。
- 具备队列 dispatch version、任务租约、lease owner、fencing version、profile advisory lock，避免重复/过期 worker 写入；失败可保留检查点，区分 retry、blocked、adapter 未就绪和 exhausted。
- 同步前检查活动计划 revision、授权/范围与配置；保存实体快照与日报事实时带 organization/workspace/profile/task 关联，使用幂等业务键 upsert 并写审计。
- API budget 协调按 application/client digest、seller 和 operation 维度控制，不把明文 Client ID 当协调键。同步默认关闭，allowlist 精确限定组织/工作区。
- 关键闸门：`amazonAdsReadAdapter` 当前是 pending adapter；`adsReadAdapterReady()` 为 false，worker 会在 Ads token refresh 和广告数据请求之前 fail-closed。当前触发任务只会等待 adapter，不能获得真实 Campaign/报表数据。

### 4.3 已实现 API 范围

- OAuth start/callback、Profiles 查询/绑定、同步计划和任务控制路由存在。
- `/api/integrations/amazon/ads/data` 可分页读取已经存储的实体或日报 facts，并按访问范围过滤和写读取审计。
- 路由存在只证明接口代码，不证明 UI 使用它、数据库中已有真实数据、同步链成功或真实账号已授权。

## 5. 优化与建议内容盘点

### 5.1 现有 PPC 正式优化边界

仓库已有 PPC Workspace 的 Rule → Adjustment Draft、Campaign/Ad Group/Lifecycle/Workspace Unit 组织方式、持久化预览/审批/执行审计及 Agent Tool Gateway。规则或 Agent 建议应形成可审阅草稿，保留原始 Bulk 文件并由用户确认；不能直接覆盖 workbook 或绕过审批写 Amazon。Amazon Ads 专用真实写 transport 当前未开放/未实现。

### 5.2 S5–S9 演示优化流程

| 阶段 | 当前演示能力 | 护栏 | 尚未具备 |
| --- | --- | --- | --- |
| S5 关键词/投放优化 | 展示关键词与 Target；生成调价、新建关键词草稿；演示策略范围与重复检查 | 推荐入口标为未接入；草稿不自动执行 | 官方建议 API、真实关键词表现、可配置站点策略和服务端草稿 |
| S6 规则/流量信号 | 展示规则与关联 Campaign；提供状态/信号入口 | Marketing Stream 显示未开通；不自动运行 | 规则服务端版本、流量事件源、规则运行与执行反馈 |
| S7 商品经营上下文 | 展示 ASIN 经营信息的演示场景 | 未知上下文、断货或 Buy Box 丢失时阻止增加出价/预算；缺经营能力则整块不显示 | 真实库存/Buy Box 权威来源、站点/卖家/时间/币种/归因一致性检查 |
| S8 建议与审批 | 指标带时间戳的建议、dry-run、提交模拟审批 | 依据缺失则拒绝；模拟流程不调用外部 API | 正式权限、审批人、revision/CAS、幂等、过期与撤权重验、逐项执行结果 |
| S9 历史与回滚 | 当前会话事件、已捕获的前后快照、逆向草稿 | 归档、重复回滚、现值冲突会拒绝；回滚仍需 dry-run/审批 | 服务端不可变审计、真实快照覆盖、冲突恢复流程和正式逆向执行 |

这些内容是原型交互和局部演示状态，不是已批准的正式 Ads 审批政策或后台操作记录。正式接入要复用既有 Agent/PPC 审批与审计边界，避免再造一套并行变更单、审批表或权限事实源。

### 5.3 优化数据与决策规则

- 当前不存在已验证的真实广告基线，因此无法报告真实 ACOS、ROAS、CTR、CVR、浪费花费、预算受限、关键词收割或优化前后提升。
- 不采纳旧规划中未经证实的固定门槛（如统一预算/调价幅度、差异百分比、固定冷却期或 7 天效果承诺）。这些需要站点、广告类型、币种、归因窗口、数据延迟和运营目标证据，并由负责人审阅后成为可配置策略。
- 搜索词转关键词、添加否定词、调整竞价/预算、Placement 调整、断货/Buy Box 保护等必须先通过可信事实、作用范围与草稿预览验证；未知或缺失上下文按保守策略阻止风险增加动作。
- 经营数据交叉联动至少要核对组织、工作区、卖家、站点/Profile、SKU/ASIN、日期、币种、归因窗口、覆盖完整性和更新时间。无分母时保持 null；不能用广告销售额代替总销售额计算 TACoS，也不能由单一 ASIN 推断多 ASIN Campaign 的整体经营安全。

## 6. “鱼骨”进度与现况分析

**结果问题：为什么现在还不能把 `/amazon-ads/campaigns` 当作真实广告优化工作台？**

```text
数据事实 ─────── fixtures/mock 指标；同步尚不能读取真实广告实体/报表 ─┐
授权与账户 ────── OAuth/Profile 代码在；真人首次授权、撤权/重连验收未做 ─┤
同步与集成 ────── 队列/租约/checkpoint 已有；Ads read adapter 未实现 ───┤
页面与产品 ────── UI 操作仍改本地会话；工作台未消费已存事实 API ───────┼─> 无法形成真实、可追溯、可执行的优化闭环
优化与治理 ────── S5-S9 是 Mock；正式 Ads 写操作和服务端审批未接通 ───┤
口径与验证 ────── 报告/归因/时区/经营分母未以真实账户验收 ───────────┤
发布与运维 ────── 当前仅盘点本地代码；无获批的配置/迁移/部署验证 ─────┘
```

### 根因分支

1. **数据源**：fixtures 被设计为原型数据；没有真实同步结果，因此 KPI 和导出没有可运营的事实依据。这是最大阻塞项。
2. **连接授权**：后端 OAuth 边界已实现，但真实用户/Profile 生命周期验收缺失。安全地把 OAuth 代码写好，不等同于授权已建立。
3. **读取同步**：同步执行骨架具备恢复和隔离能力，然而 adapter 缺官方逐端点/逐报告契约与解析实现，当前 fail-closed 是正确状态，也是现实数据不可用的直接原因。
4. **产品接线**：Campaign 工作台仍由 mock provider 驱动；即使未来同步入库，如果不加来源/新鲜度/空状态并切换服务端分页查询，用户仍看不到真实数据。
5. **写入与审批**：会话编辑和 S5–S9 模拟审批不具备服务端权限、幂等、审计、冲突处理或真实结果确认能力。真实 Ads 写 transport 需另行评审。
6. **业务口径**：归因窗口、日期时区、币种、延迟和修正会影响指标。缺同范围口径时，自动优化可能得出错误方向。
7. **验证/发布**：隔离 mock 测试不能替代真实账户和生产验证；当前工作区有大量跨模块未提交变更，不能将本报告视为已同步 GitHub 或已发布。

### 综合判断

代码成熟度：UI/演示中高，授权与任务框架中等，真实 Ads 读链路未完成，正式优化写链路未开放。用户可用页面评估工作流布局和交互，但不可用其数据做经营决策。下一阶段的主要工作应是单一只读数据切片闭环和页面来源切换，不是继续扩大导航页数或提前开放批量写操作。

## 7. 当前风险、优化机会与优先顺序

### P0：确保演示与真实数据不会混淆

- 所有 fixture 指标、演示报告、临时编辑与优化建议保持显著 DEMO/MOCK 标记；真实模式若无来源/新鲜度则显示未连接、未同步或无数据，不回退到 mock 假装成功。
- 正式建议输出应携带事实来源、时间范围、币种、归因窗口、freshness、作用实体、前后值、理由和缺失信息。

### P1：选择一条只读纵向切片

- 先审阅并锁定一个低风险能力（例如 Campaign 列表只读或一个小范围报告），记录 Amazon 官方当前契约、权限、区域、分页、限流、异步状态、字段和口径。
- 在 mock transport/fixture 下实现 adapter、范围校验、分页与重试语义、预算占用、持久化与任务恢复测试；当前 adapter 闸门继续 fail-closed，直到契约与回归完成。
- 仅在明确组织/工作区/Profile 和小范围授权下另行审批真实 OAuth/真实 Ads 请求；不以本次代码任务授权外部调用。

### P2：连接 UI 与已发布数据

- 让 Campaign 页面采用服务端分页查询，显示数据来源、最后成功同步、报告窗口和失败/空状态；取消真实模式下对 mock 的隐式回退。
- 校验账户/站点/Profile 与 Seller 绑定范围、读取权限和审计；确认过滤/排序/总量来自服务端而非浏览器全量载入。

### P3：完善优化建议而不越权写入

- 复用 Agent Gateway/PPC Draft/审批路径；将建议保存为版本化草稿，包含依据与风险，先 dry-run，批准与应用分离。
- 对否定词、加价、预算增长、商品投放等风险动作使用策略配置、上下限、变化幅度/频率护栏、幂等键、执行逐项结果和熔断。门槛由真实数据和业务负责人确定，不硬编码美国站演示常数。
- 逆向草稿必须以真实快照及当前远端值校验为基础；“回滚”是新的受审阅动作，不覆盖审计历史。

### P4：再评估高级分析

- 先验证真实 Reports 数据和同范围经营事实，再考虑 TACoS、Buy Box/库存防护、Marketing Stream 或更复杂数仓；没有需求和基准前不新增流式基础设施、ClickHouse 或全量高频采集。

## 8. 验证与限制

- 本次定向运行：`npx tsx --test tests/amazon-ads.test.ts tests/amazon-ads-authorization.test.ts tests/amazon-ads-sync.test.ts`，19/19 通过。覆盖 mock 指标/范围/CSV、token/checkpoint 加密、Profile 合同、同步 allowlist、日期窗口、checkpoint、adapter fail-closed、budget digest、幂等键和失败分类。
- 浏览器隔离回归：`npx playwright test --config tests/browser/amazon-ads.config.ts`，9/9 通过。覆盖表格操作、账户/Profile 展示与绑定、详情/设置/创建、范围过滤、报告、偏好、桌面与移动布局、历史和搜索词触发信息。
- 本地 URL 检查：HTTP 307 重定向 `/login?next=%2Famazon-ads%2Fcampaigns`；没有对真实登录页或账号数据做检查。
- 未运行全仓 `npm run check:fast`、生产构建或真实 Ads 请求。这份任务新增的是文档汇总；定向测试足以验证被引用的 Ads 合同/演示事实，不能证明全仓跨模块状态或生产可用性。合码前仍需冻结完整工作区并按仓库规则执行完整闭环。

## 9. 关键代码与文档索引

- 页面入口与路由：[Amazon Ads 页面](../src/app/amazon-ads/[[...view]]/page.tsx)、[工作台组件](../src/components/amazon-ads/ads-workspace.tsx)
- 列表/演示数据：[数据表](../src/components/amazon-ads/ads-table.tsx)、[fixtures](../src/lib/amazon-ads/fixtures/catalog.ts)、[mock provider](../src/lib/amazon-ads/mock-provider.ts)
- Ads OAuth/同步：[授权服务](../src/lib/amazon-ads/authorization.ts)、[同步 adapter](../src/lib/amazon-ads/sync-adapter.ts)、[同步处理器](../src/lib/amazon-ads/sync-processor.ts)
- API：[OAuth 与 Profiles 路由](../src/app/api/integrations/amazon/ads)、[数据查询路由](../src/app/api/integrations/amazon/ads/data/route.ts)
- 优化演示：[现状审计](./ads-audit.md)、[S5–S9 交付记录](./amazon-ads-s5-s9-delivery.md)
- 官方契约与授权边界：[Amazon Ads API 接入基线](./amazon-ads-api-integration.md)

## 10. 明确未做事项

没有调用真实 Amazon OAuth/API，没有修改凭证或 `.env`，没有启动真实同步、运行数据库迁移、部署/重启服务器、提交或推送 GitHub，也没有清理工作区内容。本报告只新增一份本地文档；当前 Git 工作区原有改动仍需按仓库规则整体盘点后，方可另行决定同步范围。
