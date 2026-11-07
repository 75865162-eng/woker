# Campaign 本地业务视图交付

日期：2026-11-06。对应 T13/T19 的结构业务视图子项；不是完整 SP 工作台、正式报告采集或生产账号验收完成声明。

## 页面、入口与行为

- `/amazon-ads/campaigns` 和 `/amazon-ads/campaigns/sp`：默认打开本地 SP Campaign 业务列表；新增组件 `src/components/amazon-ads/ads-campaign-workspace.tsx`，复用原 Amazon Ads CSS、页头、侧栏、表格与详情样式。每页25条，店铺/站点/Profile、状态、名称或Amazon ID搜索、排序和分页由既有本地API执行；搜索显式提交，避免每次输入触发查询。
- `/amazon-ads/campaigns/{内部ProfileID}/{AmazonCampaignID}`：可直接打开只读详情；Profile和实体ID共同查询，下属Ad Group同样固定该Profile/Campaign并分页。相同Amazon ID不作为跨Profile全局键。SB/SD等未接入路径不展示SP结果。
- `/amazon-ads` 保留原已同步数据浏览器，并增加“进入本地广告活动工作台”。正式视图侧栏保留数据浏览器、账户/同步中心及显式Demo入口；原Demo内部功能与会话不替换、不清理。生产路由组件选择真实业务视图，测试组件仍可显式指定Demo或通用浏览器。
- 详情展示规范化预算/状态/币种/时区/投放类型/开始结束日及来源；金额字符串不经浮点转换。原始维度在展开后才渲染，来源任务按需独立读取；任务无权限不影响已经授权的结构查看。
- 加载/空数据/401/403/404/500/非法响应/超时有明确状态；无静默Mock回退。请求键变更立即隐藏旧行和总量，AbortController阻止晚响应覆盖新筛选。每次本地读取有15秒客户端时限，超时后可显式重试。移动端菜单沿用现有响应式布局并验证横向表格滚动。

## 权限、事实源与流转

页面入口继续要求 `workspace:view`，数据始终通过 `GET /api/integrations/amazon/ads/data` → `queryAmazonAdsData` → 现有Repository/PostgreSQL。服务端现有组织/工作区、用户、店铺、Marketplace、Profile和撤权复核不变；客户端筛选不代替服务端权限。

来源任务查询复用 `GET /api/integrations/amazon/ads/sync?taskId=...&profileId=...` 的 `taskDetail` 合同，仍要求原 `settings:view` 和数据范围，不新增权限旁路。账户/同步中心复用原 `AdsAccounts`，其中既有授权/配置/任务控制仍沿用原权限与审批边界；本批Campaign和Ad Group数据视图不新增写操作。

结构是当前已观察快照，无日报日期维度。页面明确说明日期不用于当前结构过滤，不显示假Spend/ACOS/ROAS/趋势，不用当前预算冒充历史预算。来源任务成功也不等于官方账号与完整覆盖已经验收。

## 修改文件

- 新增 `src/components/amazon-ads/ads-campaign-workspace.tsx`。
- 修改 `ads-workspace.tsx`、`ads-workspace-route.tsx`、`ads-synced-data.tsx`、`amazon-ads.css` 和 `src/app/amazon-ads/layout.tsx`，接入口、选择真实路由并更新页面副标题。
- 新增 `tests/browser/amazon-ads-campaigns.spec.ts`；扩展 `amazon-ads.config.ts` 和 `amazon-ads-harness.tsx`，保留原浏览器回归语义。
- 同步现有任务清单及待办状态。没有新增数据库模型、迁移、API、Repository、Worker、权限或运行配置。

## 验证路线

- 隔离浏览器：原22项 + 新9项，共31/31通过；包含筛选/分页、跨Profile相同Amazon ID、来源任务成功及拒绝、非法/失败/空结果、请求竞态、超时、直达详情、移动端与入口切换。
- 最后店铺/站点组合筛选调整后重跑新9项：9/9通过。
- 全仓 `npm run typecheck` 与定向ESLint均通过。
- 浏览器将全部页面/API响应拦截到本机fixture，只允许GET，不使用登录凭证、生产服务、真实数据库或Amazon请求。由于仅局部UI接线且未改变API/权限/Schema/构建链，采用相关浏览器回归+类型+定向lint；未重复后端集成、全量check或生产构建。合码/上线再走对应完整关口。

## 尚未完成与回滚

本批已接入域是已有SP Campaign和所属Ad Group当前结构快照；没有新增官方reader。Campaign表现/日期范围、完整Ad Group独立详情、关键词/投放等业务页面、历史结构、导出及建议草稿仍待相应合同和纵向切片完成。正式报告transport与账号验收继续关闭，不把浏览器fixture当成真实数据证明。

回滚恢复上述前端接线/样式/副标题并移除新组件及专项测试即可；不需要数据库或运行配置操作。15秒仅为浏览器读取时限，不改变服务端任务预算、队列lease或Amazon调用超时。未做生产规模性能benchmark，不宣称P95达标。

未提交、推送、部署、执行真实任务或修改凭证，工作区其他改动保留。下一批应扩展真实Ad Group/Keyword/Target业务路径及已发布日报的质量/口径展示；正式报告合同取证与真实试点仍单独受审批控制。


## 后续交付：独立 Ad Group 业务视图

2026-11-06追加。延续现有结构页面，新增 `/amazon-ads/ad-groups`（含 `/sp`）和 `/amazon-ads/ad-groups/{内部ProfileID}/{AmazonAdGroupID}`。侧栏提供独立广告组入口；活动详情中的广告组可点击进入详情，详情通过同一内部Profile返回所属活动。没有修改API、权限、数据库、Worker或正式transport。

- 列表复用同一结构列表组件，每页25条；店铺、Marketplace、Profile、状态、搜索、排序、Campaign ID均由既有本地查询服务执行，竞价排序使用已支持的 `bid`。Campaign ID和搜索显式提交，切换列表会重置不兼容筛选/排序。
- 详情使用 `SP:ad-group + internalProfileId + externalId`，显示规范化状态、默认竞价、币种、时区、所属活动和已有来源证据；层级优先使用 `campaignId`，兼容已保存的 `parentExternalId`，不从原始payload猜父级。金额保留字符串精度。
- 服务端仍执行组织/工作区/店铺/站点/Profile过滤和撤权复核，客户端不直连数据库或Amazon。加载、空、失败、超时、重试和旧请求清理复用现有边界。来源任务查询权限独立，不因查看结构获得管理权。Demo仍为显式选择。
- 修改 `src/components/amazon-ads/ads-campaign-workspace.tsx`、`ads-workspace-route.tsx`、`tests/browser/amazon-ads-campaigns.spec.ts`及原任务/现况文档。无新表、迁移、Repository、API或Worker；复用 `queryAmazonAdsData`。

验证：隔离浏览器回归 **35/35** 通过（原31+新增4），新增覆盖跨Profile同ID详情、父子导航、直达详情、缺失记录、撤权后清除数据及重试、列表服务端组合筛选/分页/竞价排序与列表切换。定向ESLint通过。

**本批全仓TypeScript未通过**：`src/lib/amazon-sync/processor.ts` 第431、516、523、924、937行，涉及并行修改中的 `AmazonSyncPageCreateInput` 与订单/财务唯一键Prisma类型不匹配；本批前端与测试文件没有TypeScript诊断。保留该批工作区改动，未替其他任务改Schema或重新生成客户端掩盖错误。本节是追加批次状态，不能沿用前一批TypeScript通过结果作为当前全仓通过证明。合码前需相关同步改动完成类型对齐后重跑。

本批仅UI接线，无接口或权限变动，采用浏览器回归+定向lint+全仓类型检查；未运行全量check、生产构建、数据库集成或真实性能benchmark。没有生产就绪整体结论。未调用真实API、启动同步、执行迁移、修改凭证、提交、推送或部署。回滚只撤回本节对应前端接线与测试变更，不回滚之前Campaign交付或其他工作区修改。

仍待：广告组关键词/商品投放/广告商品的业务详情、已发布日报的指标/时间/质量口径展示、导出/历史、统一建议草稿及审批执行回读。下一批优先把广告组下的已同步结构实体接到统一查询服务，不用新增报告字段绕过正式合同待核验项。


## 后续交付：Campaign 与 Ad Group 下属投放结构

2026-11-06追加。Campaign详情现提供 Campaign 否定关键词/商品投放；Ad Group详情提供关键词、商品投放、Ad Group否定关键词/商品投放。使用已存在的本地结构查询和SP reader，没有增加数据库/API/权限/同步实现。

- 每个域按 Profile ID + 域类型 + 上级 Campaign/Ad Group ID 查询；Campaign否定项不附加Ad Group过滤。域切换独立重置本地筛选和分页，旧响应由公共读取hook取消并隐藏。
- 支持搜索、状态过滤、分页、服务端排序、刷新、规范化matchType/expressionType/targetingExpression/bid/state、同步时间及来源任务/原始记录展开。使用API规范化列，不以payload过期值覆盖；精度保留为字符串。否定项不显示不适用的竞价。
- 广告商品目前没有实现并核验reader，明确显示未接入状态，不发查询、不显示Mock产品。搜索词、Placement、Advertised/Purchased Product及表现指标也不因此推断完成。
- 主要改动：`src/components/amazon-ads/ads-campaign-workspace.tsx`、`tests/browser/amazon-ads-campaigns.spec.ts`和本文件。Campaign/ad-group父子列表之前置接线继续保留。

验证：专项配置全浏览器回归 **41/41**（包括原22、Campaign/AdGroup列表详情，以及4个结构域、Campaign否定范围、错误独立性和未支持域零查询）；`npm run typecheck`通过，定向ESLint通过。所有网络只指向本地fixture、GET请求；没有外部API、真实账号、数据库或凭证。

仅UI和测试变化，采用相关浏览器回归、定向lint和项目TypeScript；未跑全仓check/生产构建、数据库集成或真实性能benchmark。无需迁移回滚；仅撤销子实体详情接线/测试即可，不影响同步事实。未提交/推送/部署。

剩余：SP广告商品reader/合同；Search Term、Placement、Advertised/Purchased Product正式报表合同和视图；日期/归因/版本质量语义在工作台中的统一呈现；真实账号的只读对账与后续审批/执行/回读。未核验官方字段不假设，报告transport仍由既有合同闸门控制。


## 后续交付：Campaign 已发布日报详情

2026-11-06追加。本地Campaign详情增加显式展开的日报区块，查询既有 `GET /api/integrations/amazon/ads/data` → `queryPublishedAdsReports`，只读最新已发布事实；没有调用报告创建、同步或Amazon API。

- 点击“查看 Campaign 已发布日报”后才读取，默认结构详情不触发报告汇总。查询明确限定内部Profile、Campaign、`spCampaigns`、`SPONSORED_PRODUCTS`、日期范围、页码及排序。起始范围为最近30个日历标签；支持报告日/曝光/点击/花费/订单/销售额排序、日期校验、刷新、重试和分页。
- 使用现有服务端全筛选范围 totals，而非当前页求和；按币种、归因窗口、API版本、报告类型和广告产品展示独立汇总，缺失指标显示“—”，保留十进制字符串精度。明示CTR/ACOS是百分比点、CPC/ROAS口径由服务端派生。
- 行级展示报告日标签、指标、归因窗口、API版本、发布版本、来源任务和本地同步时间。告知时区/日期语义/字段完整性限制、范围仅为已观察已发布事实、日期覆盖和归因回补未保证。合同、真实账号样本和报告同步生产启用仍未验收，不将此视为正式Amazon报告reader已落地。
- 响应对来源、日期范围、freshness、分页、warnings、指标十进制格式做运行时校验；权限/服务错误沿用安全状态提示。日期更改未提交前不会读取新范围；范围无效时保留既有快照且不发请求。
- 修改 `src/components/amazon-ads/ads-campaign-workspace.tsx`、`tests/browser/amazon-ads-campaigns.spec.ts`及现有任务状态说明。无schema/API/权限/Worker改动。

验证：全套Amazon Ads隔离浏览器回归 **45/45**；`npm run typecheck`及定向ESLint通过。fixture覆盖Profile/活动/域/日期/排序参数、跨页汇总与不同归因/API口径、缺失值、错误403/非法envelope/空结果/重试/无效日期、默认不请求。浏览器仅向本地fixture发GET；没有数据库、真实账号或Amazon请求。

最小验证采用相关UI全回归、类型和定向lint；未运行完整项目check/生产构建/数据库集成或真实性能benchmark。需要作为合码/上线闭环时再依仓库要求执行完整检查。本地回滚仅移除CampaignReports UI/测试接线，不改变查询服务和已发布事实。没有提交、推送、部署。

剩余限制：报表合同仍有待官方文档/真实样本确认项，生产report transport/自动同步关闭；现在的日报页是读取已发布本地记录，不保证任何Profile已有可展示事实。报告时区/完整性语义、Search Term/Placement及Advertised/Purchased Product业务视图仍需单独完成。AI建议必须等待口径/完整性证据与统一草稿审批链路，不由本页面输出。


## 后续交付：日报汇总拒绝部分缺失指标

2026-11-06追加。审计发现 `SUM` 会忽略null，导致某个已观察事实缺失spend/sales等字段时仍输出已知小计，影响API、MCP及页面绩效判断。本批在共享 `queryPublishedAdsReports` 修正完整性语义。

- 同一筛选/口径分组内，每项基础指标仅在 `COUNT(metric) = COUNT(*)` 时返回精确 `SUM`；任一已观察行缺失则该项汇总为null。完整指标继续正常汇总，真实0不转为null；不存在以0填补缺失字段。
- 现有 `deriveAdsMetrics` 在基础汇总缺失时自然返回null，所以CTR/CPC/CVR/ACOS/ROAS不会用部分已知分子或分母生成假比率。修订选择、权限、Profile/店铺/站点过滤、分页及跨口径分组不变。缺失值只影响当前筛选中对应指标，不污染筛选外记录。
- API/MCP envelope和字段形状保持兼容，仅纠正部分缺失情况下的值，warnings补充语义；Campaign日报提示随之更新。此规则只证明已保存行中的字段完整，不证明日期覆盖、未观察行或归因最终性。
- 修改 `src/lib/amazon-ads/report-query.ts`、`src/components/amazon-ads/ads-campaign-workspace.tsx`；在 `tests/integration/amazon-ads-reports.integration.ts` 新增两项数据库集成场景（六种逐字段缺失矩阵与null/0/归因修订场景）。保留该集成文件中其他批次已有改动。无新表、迁移、API、Repository或Worker。

验证结果：

- `node scripts/test-amazon-ads-offline.mjs --reports`：**43/43**，一次性预装Docker PostgreSQL/Redis，隔离环境白名单、fixture transport和网络闸门，未继承真实凭证或数据库配置；包括新缺失指标矩阵、跨页汇总、派生比率、API/MCP一致性、筛选范围、修订后恢复、null与0、已有大数精度/撤权/发布边界回归。
- `npm run check:fast`：**904/904单测通过**，其lint阶段因工作区已有 `.next-amazon-live` 生成产物被扫描而失败，未运行该链后续typecheck；未删除产物或修改全局lint配置。
- 补充 `node node_modules/eslint/bin/eslint.js . --ignore-pattern '.next-amazon-live/**'`：**0错误、5条其他文件警告**；本批三文件定向lint通过。单独 `npm run typecheck`通过。
- Campaign/AdGroup/子实体/日报页面专项 **23/23**通过；本批相关tracked diff空白检查通过。因共享聚合语义改动，执行数据库集成+核心单测+全仓类型和排除构建产物的源代码lint，未跑生产构建或全量E2E。

资源影响：六项聚合增加同一次group scan中的count状态，未新增SQL往返、表/索引/缓存或扫描步骤；没有生产P95测量，不能宣称已达容量门槛。回滚撤销聚合表达式、warning和页面提示即可，无数据库回滚。但旧SUM会重新暴露部分小计风险，人工回滚前需明确了解。

未调用真实Amazon API、启动真实任务、修改真实配置/凭证、迁移、提交、推送或部署；其他并行改动保留。下一步应补报告字段完整性计数/来源合同语义和正式报告取证，后续AI分析不再消费部分小计作为完整指标。


## 后续交付：日报字段完整性计数

2026-11-06追加。在上一批防止部分小计冒充完整总计后，本批把原因透明化：每个已发布报表汇总分组附带 `completeness`，包含当前已观察事实总数，以及曝光、点击、订单、件数、花费、销售额逐项提供数/缺失数/status。

- 新纯函数 `src/lib/amazon-ads/report-completeness.ts` 给出 basis=`CURRENT_OBSERVED_FACTS`；status为 COMPLETE/PARTIAL/MISSING/NO_FACTS。count以十进制字符串传输，服务端用BigInt精确比较；任何超出观察行数/负数均失败，不转浮点。0是真实已提供值，和缺失严格区分。
- 查询在同一既有总计SQL分组中复用 `COUNT(*)` / `COUNT(metric)`，不新增往返或扫描阶段。完整性随 totals 从共同查询服务自然传给API/MCP，不扩大scope、权限或响应的敏感字段。MCP原有 totals 口径安全规则不变。
- Campaign日报汇总可展开查看每项已提供/缺失数。明确限定为已观察、当前选中的已发布事实，不代表日期/账户/Amazon未观察行/归因完整。旧API响应可读但显示“计数未提供”；若新字段自相矛盾则拒绝整份响应并清除旧指标。
- 新增 `tests/amazon-ads-report-completeness.test.ts`，报告数据库集成扩展，浏览器回归验证UI、旧响应和非法计数。无Prisma/schema/API路由/Worker变更；MCP使用已有报告查询路径。

验证：隔离Campaign页面回归 **25/25**；报告服务真实SQL隔离集成 **43/43**（含逐指标部分缺失/跨分页/API-MCP一致、无事实、修订恢复）；新增纯函数测试 **2/2**；`npm run typecheck`通过，6个相关源码/测试文件定向ESLint通过，相关diff `git diff --check`通过。浏览器仅本机fixture，数据库用一次性PG/Redis，HTTP/Amazon请求由网络守卫禁止。

审查中曾发现项目target不接受BigInt literal语法，已改用 `BigInt(...)` 并重新通过类型检查；未调整tsconfig。未重跑整仓check/build；此前 `check:fast` lint扫描工作区构建产物会误报，此批采用定向lint。未做生产规模P95测试；SQL增加每组6个COUNT表达式但同一扫描，不增加请求轮次，仍需容量benchmark。

回滚只需撤销 completeness纯函数、聚合投影、UI说明及本批测试；不涉及数据库和运行态。未调用真实Amazon API/凭证/任务，无迁移、提交、推送、部署；并行工作区修改原样保留。


## 后续交付：日报来源任务详情

2026-11-06追加。Campaign 日报事实表将来源任务ID改为按需展开，复用既有 `GET /api/integrations/amazon/ads/sync?taskId=...&profileId=...` 与 `TaskEvidence`。请求同时绑定事实的内部Profile及sourceTaskId；沿用同步中心原有任务查看权限，权限错误只影响任务详情，不清空已经授权的日报。关闭状态不发任务请求。

相关改动仅在 `src/components/amazon-ads/ads-campaign-workspace.tsx` 与 `tests/browser/amazon-ads-campaigns.spec.ts`；没有新增API/查询/权限/数据库逻辑。日报表格继续展示版本和本地同步时间。浏览器验证 sourceTaskId、Profile范围、返回任务阶段及既有权限行为；Amazon Ads隔离浏览器回归 **25/25**，定向ESLint和相关diff空白检查通过。此前同批报告集成 **43/43**、TypeScript通过；本小批仅复用既有TaskEvidence，不重复数据库测试。无迁移/外部调用/提交/推送/部署。


## 后续交付：逐 Profile 日报新鲜度与观察覆盖

2026-11-06追加。在Campaign日报中消费既有 `freshness.profiles`：展示内部Profile、报告类型、状态、当前筛选已观察起止日期、最近成功发布、最近尝试、warningCodes及独立权限的任务详情。明确分开查询日期与观察日期，不以MIN/MAX断言连续覆盖，不将未知/无明细呈现为健康。没有新增查询、API、权限、模型或Worker。

运行时校验新增可选freshness明细字段类型，兼容旧接口但明确提示“覆盖范围与最近尝试不可判定”。任务详情仅点击后请求，403不影响已授权日报/新鲜度。修改 `src/components/amazon-ads/ads-campaign-workspace.tsx` 与 `tests/browser/amazon-ads-campaigns.spec.ts`；扩展现有fixture及新增任务403/旧响应回归。

本轮验证：浏览器专项 **26/26**，定向ESLint通过，相关diff空白检查通过。全仓 `npm run typecheck` **未通过**：并行修改的 `tests/integration/amazon-mcp.integration.ts` 第325–332行读取failureClass/toolVersion/gatewayStatus/durationMs，但实际类型仅有id/status/createdAt；本轮修改文件无诊断。未覆盖或修改该并行任务文件，不沿用之前TypeScript成功结果作为当前通过证据。

本轮仅UI消费既有数据，采用专项浏览器/类型/定向lint，不重复数据库集成或生产构建。完整上线关口需类型阻断处理后再跑。回滚移除该freshness区块及可选响应校验即可，不改变事实/同步状态。未调用真实API、操作配置/凭证、迁移、提交、推送或部署；其他并行改动保留。


## 后续交付：服务端报告新鲜度判定纠偏

2026-11-06追加。发现共享报告查询将generic和exact域状态按未排序SQL返回顺序存入Map，存在覆盖不确定性；还把结构SyncPlan.intervalMinutes用于报告CURRENT/STALE，空结果时全局MISSING又会掩盖报告失败。

- 新纯函数 `src/lib/amazon-ads/report-freshness.ts` 收口确定性判定。指定reportType时，优先同Profile的exact状态，无exact才回退generic；跨报告查询按FAILED→SYNCING→STALE→观察态保守选取，并使用尝试时间/报告类型/任务ID确定性打破平局，返回任务、警告与状态属于同一条证据。
- 不再查询结构SyncPlan并用于报告新鲜度。没有报告专属时效合同就仅报告OBSERVED_PUBLISHED；保存的明确STALE、失败和进行中状态继续保留。无事实时仍保留FAILED/SYNCING，不用MISSING掩盖。
- API/MCP沿用既有共同服务、字段和权限，不修改数据库或计划、不开启同步；warnings解释OBSERVED_PUBLISHED边界。查询少读一类结构计划，不新增SQL/往返。未来报告专属cadence/SLA需合同确认后另行实施。
- 改动：`src/lib/amazon-ads/report-query.ts`、新增 `src/lib/amazon-ads/report-freshness.ts` / `tests/amazon-ads-report-freshness.test.ts`；扩展 `tests/integration/amazon-ads-reports.integration.ts`，保留其中其他工作区改动。

验证：报告隔离数据库集成 **44/44**（新场景验证exact覆盖、generic回退、不同结构频率、空事实下失败/运行中保留），新纯函数 **3/3**（包含顺序置换和多Profile边界）；`npm run typecheck`、4个相关文件定向ESLint及相关diff空白检查通过。一次性PG/Redis、fixture及网络守卫，无真实服务/凭证。

此次共享判定使用真实SQL集成+纯函数矩阵+全仓类型+定向lint进行风险收敛；没有重复浏览器测试（UI未修改）、全量check或生产构建。现工作区曾出现生成目录lint问题，不清理其他任务产物。未做生产P95benchmark；未改Schema/迁移/配置/凭证，没有真实API、生产任务、提交、推送、部署。

回滚仅恢复query-service内部新鲜度计算并移除helper，API和数据库不需回滚；但会重新引入覆盖顺序/错误cadence问题。正式报表合同、账号验收、日期完整性、报告专属时效计划及广告审批执行仍待完成。

## 后续交付：独立关键词、商品投放与两级否定业务页面

2026-11-06追加。将已具备本地结构读取能力的六个数据域接入正式业务导航，减少必须逐级进入详情才能管理结构数据的限制：

- `/amazon-ads/keywords`：`SP:keyword`；`/amazon-ads/targets`：`SP:target`。
- `/amazon-ads/negatives`：分开选择 `SP:negative-keyword`、`SP:negative-target`、`SP:campaign-negative-keyword`、`SP:campaign-negative-target`，不混合层级。三个入口均接受 `/sp` 列表别名；未知详情路径明确显示未接入。
- 复用既有列表筛选与读取边界：店铺、Marketplace、Profile、状态、Campaign/Ad Group ID、搜索、排序及25条分页均通过 `GET /api/integrations/amazon/ads/data?kind=entities` 在服务端执行；沿用原实时权限与范围过滤，没有新增API、查询合同、Repository、Schema或迁移。活动级否定项不提供广告组筛选，所有否定项不显示竞价或竞价排序。
- 读取规范化关键词、匹配类型、投放表达式、竞价与归属，不把raw payload旧值作为表格事实。每行从所属Profile解析站点/币种；同Amazon ID的跨Profile父对象链接均携带该行内部Profile。来源任务与raw按需展开，任务权限继续独立校验。
- 切换数据域重置筛选和页码，旧请求中止且延迟响应不能覆盖新域。复用加载、超时、空、403、失败与重试状态；正式工作台不回退Demo。结构页面明确标注当前快照，不提供伪历史日期或占位业绩；未接入关键词/投放日报、历史观察、导出及写操作。

修改文件：`src/components/amazon-ads/ads-campaign-workspace.tsx`、`src/components/amazon-ads/ads-workspace-route.tsx`、`tests/browser/amazon-ads-campaigns.spec.ts`，以及本交付与原任务/待办状态说明。保持原Demo与Campaign/Ad Group列表详情能力。

回滚仅撤销本批独立入口、列表domain扩展及对应浏览器测试；已有详情内子实体读取仍保留，不涉及数据库/运行配置/外部服务。下一步仍为正式Campaign报表合同补证和受控只读验收；Search Term、Placement、Product Ads等未确认数据域不以此次结构页面交付宣称完成。真实API/凭证/配置/任务/生产迁移/部署均未执行，未提交或推送。

验证结果：Amazon Ads浏览器回归 **57/57**（原22项、工作台35项，其中本批新增9项），覆盖六域接线、Profile限定父对象链接、规范字段与币种、分页/组合筛选、四类否定域切换与筛选重置、403/500/格式错误/空结果恢复、加载及延迟响应隔离，同时回归旧Demo。`npm run typecheck`、三个相关文件定向ESLint及相关diff空白检查通过。首次使用顶层playwright包CLI遇到本机已安装版本不一致，改用项目`@playwright/test/cli.js`即通过，未改依赖。验证仅为拦截全部网络的浏览器fixture；本批没有修改后端/数据库，未重复数据库集成、check:fast或生产构建，合码/上线时再按全量关口验证。
