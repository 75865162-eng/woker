# AI / MCP / ERP 协作能力升级待办

日期：2026-11-06。初版为依据本地代码形成的待实施方案；C01–C09 已完成或部分完成本地离线实现。C01 盘点、C02–C03 注册表/实时授权发现见[首批交付与交接](ai-mcp-erp-collaboration-batch1-2026-11-06.md)；C04–C05 数据集契约、兼容查询及验证见[第二批交付与交接](ai-mcp-erp-collaboration-batch2-2026-11-06.md)；C06–C07 Gateway入口、Schema校验、申请流程验证见[第三批交付与交接](ai-mcp-erp-collaboration-batch3-2026-11-06.md)；C08–C09 设置目录与脱敏审计见[第四批交付与交接](ai-mcp-erp-collaboration-batch4-2026-11-06.md)。这些状态仅代表本地离线实现，不代表Prisma底层物理取消、生产数据/上游样本验证或上线验收。未修改 Skills 或真实配置，未访问真实业务数据或外部 API，未执行持久库迁移、commit/push 或部署。ERP 提供业务数据和受控功能，现有 Skill 保持原正文、规则和提示词；分析和策略仍由 AI / Skill 完成。

## 1. 实际代码差距

本节保留实施前审计基线；C01–C03 实施后的现状以首批交付文档为准，不能将下表全部视为仍未修复。

| 边界 | 已有实现与证据 | 本阶段差距 |
| --- | --- | --- |
| MCP Server | `src/app/api/mcp/amazon/route.ts` 提供 initialize、tools/list、tools/call | 工具名/描述取自服务端 `amazonMcpTools`，inputSchema 在 route 内另一套分支维护；tools/list 未提供 outputSchema、模块、工具版本和完整启用状态 |
| 目录与执行 | `src/lib/amazon-sync/mcp.ts` 中工具清单、别名、参数检查及调用分支 | 缺少统一的“描述 + Schema + 权限 + handler + 实现状态”注册项；需防止新增清单项没有后端实现或 Schema 与解析器漂移 |
| 工具发现授权 | tools/list 按凭证 tools 筛选；调用有实时权限边界 | 发现结果尚未统一表达当前角色/模块权限、店铺站点范围、handler就绪与数据可用性；调用检查必须保留，不用发现结果代替 |
| Agent Gateway | `src/lib/agent-platform/tool-gateway.ts` 有 enabled、Agent工具权限、审批要求、超时及重试 | MCP `invokeAmazonMcp` 当前直接进入业务查询，不调用该 Gateway。Gateway 当前也没有执行 input/output JSON Schema 校验；超时包装不会取消底层操作，不能直接包装全部 MCP 后声称安全闭环 |
| 统一数据入口 | `src/lib/amazon-sync/skill-data.ts` 有 table list/describe/query；映射 inventory、listings、sales_traffic_daily、ads_report_daily | module/dataType 未形成统一协议；各表过滤不同；SKU/ASIN/关键词/状态不能跨表通用。已知逻辑表名称不等于已有查询实现 |
| Ads 专用读取 | `amazon.ads.entities.list`、`amazon.ads.reports.list` 与兼容别名；发布版本查询、精确数值、预算、分页排序和SQL超时已有 | 通用入口与专用入口 Schema/分页上限需一致描述；报表只有离线采集切片，不能因可查询而宣称真实采集完整 |
| 其他 ERP 模块 | `src/lib/agent-platform/{product,listing,ppc,market,supplier,orchestrator,selection}.ts` 已有内部工具定义和 adapter 边界 | 内部 Agent 工具不等于 MCP 工具；逐项核对真实服务、认证上下文、数据源与副作用后才允许暴露。不可整体导出内部工具或把 Demo 输出当真实数据 |
| 配置页面 | `skill-erp-settings-panel.tsx` 嵌入 `amazon-mcp-panel.tsx`；后者从管理 API 读取工具、范围、发布状态和调用分页 | 顶部 `plannedInterfaces` 与“MCP工具已实现”等为静态描述；应由注册表和后端就绪/数据状态驱动 |
| 审计与错误 | MCP已有请求ID、凭证生命周期、协议及调用审计，参数/结果安全摘要；日志分页筛选已实现 | 当前日志仅 SUCCEEDED / DENIED，执行异常被归入 denied；缺少统一工具版本、耗时、稳定业务错误码、Gateway关联ID及失败分类 |

以上是代码审计，非生产验证。现有实时授权复核、凭证与店铺站点交集、Ads显式工具授权、已发布数据边界必须保留。

## 2. 目标与兼容方案

调用链：AI / 原 Skill → MCP发现与调用 → 参数/身份验证 → Agent Gateway受控适配 → 既有ERP业务服务 → 事实源或已发布数据 → 标准响应。

优先保留 `/api/mcp/amazon`、旧工具名称、凭证grant和 `data_query` 调用形态；先在服务端统一定义与适配，不要求 Skill 改提示词。新工具不能通过旧凭证自动获得授权，新别名不能扩大旧权限。内部Agent身份不得替代实际MCP用户身份。

注册表首期使用服务端类型化定义与handler绑定，复用既有Agent元数据；不先新增数据库工具配置表。数据库记录不作为第二套执行事实源。工具元数据候选：name、description、module、version、inputSchema、outputSchema、operationMode、requiredPermissions、enabled、implementationStatus、handler引用。服务端校验名称唯一、handler存在、Schema可用及别名映射。

操作模式区分 READ_ONLY、APPROVAL_REQUEST、RESTRICTED；审批型准确说明“创建申请”的副作用，不表示批准或执行。未实现的远端执行不得作为可调用工具发布。数据可用性另查，不将“零条数据”误判为“工具未实现”。

tools/list 返回当前身份允许发现的可调用工具，标准字段使用协议支持的Schema/annotations；模块、版本等扩展元数据须按已协商MCP版本验证。禁用/未实现工具在管理员目录显示原因，不能向AI泄露未授权能力细节。先采用每次tools/list重新读取、无跨身份缓存的方式；不宣称支持尚未实现的 listChanged 推送。

## 3. 统一查询协议待办

协议以逻辑数据集为边界，不开放SQL、物理表名、任意字段路径或跨模块join。module + dataType映射唯一注册数据集；旧table经兼容adapter解析。两者同时提供但冲突时拒绝，不能静默选一方。

| 需求输入 | 规范化方向 | 限制 |
| --- | --- | --- |
| 业务模块/数据类型 | module、dataType；保留旧table映射 | 只有已实现且验证过Schema的数据集可查询 |
| 店铺/站点 | 复用sellerAccountId(s)、marketplaceId | 服务端取org/workspace/user；对每个Seller/Marketplace配对验证，不做两个集合的笛卡尔积 |
| 日期范围 | from、to及数据集声明的日期语义 | 报表日/抓取时间/业务更新时间明确区分；有界窗口，不默认全历史 |
| Campaign / Ad Group | campaignId、adGroupId | 只用于确有这些维度的数据集；验证实际字段与父子范围 |
| ASIN / SKU | asin、sellerSku；兼容既有advertisedAsin | 店铺销售汇总没有ASIN/SKU粒度；拒绝不支持过滤，不能返回未过滤全量 |
| 关键词 | keyword与匹配语义 | 结构keywordText、搜索词searchTerm、全文search不同；按数据集显式映射，不互相替代 |
| 状态 | 规范化state/status与映射说明 | 广告结构状态、刊登状态、发布状态不同；报表发布边界不可由客户端选择取消 |
| 分页/排序 | page、pageSize、sortBy、sortDirection | 数据集白名单、稳定次级排序、明确上限；旧通用1000与Ads100上限差异需显式校验 |

响应候选：data、pagination、meta、warnings；meta携带requestId、toolVersion、dataset、实际scope、日期及其语义、grain、来源、syncRun/task、发布版本、同步时间、币种/时区/归因与质量说明。无该语义时明确null/不适用，不伪造版本或币种。商品主数据使用其revision，不冒称报表发布版本。

金额/大整数保持精确字符串；零、null、空结果、无权限、未同步、未发布、Schema未验证分别表达。数据可用状态和Schema证据级别分开；应用模型验证不等于Amazon真实样本验证。跨币种/时区/归因不混算。协议提供数据与必要确定性指标，不新增广告诊断或策略引擎。

## 4. 分批可执行清单

以下C编号仅管理本协作升级，不替换Ads原T编号。C01 已盘点；C02–C09 已完成或部分完成本地离线实现，详细边界见批次交付文档；C10–C11 尚未实施。C06 已有MCP Gateway入口Schema校验、单次执行和迟到结果抑制，但Prisma/外部服务底层物理取消、生产性能验收仍未完成。下表保留原任务及验收边界。

| ID / 优先级 | 待办与主要边界 | 依赖 | 完成标准 |
| --- | --- | --- | --- |
| C01 / P0 | 盘点现有MCP每工具名称、别名、handler、权限、input/output、数据与副作用；形成逐项映射 | 无 | 清单逐项链接代码；区分真实service、fixture、dry-run、未实现 |
| C02 / P0 | 将MCP清单/Schema/handler统一为服务端注册表，route与管理API共用；优先复用Agent元数据 | C01 | 无重复名、孤立handler、缺Schema；禁止未实现工具宣称可调用；旧工具兼容测试 |
| C03 / P0 | 工具发现按当前身份、权限、grant、开关过滤；返回版本/模式/Schema和受限可用性 | C02 | tools/list与tools/call一致；撤权、禁用、版本更新立即反映；不泄露其他租户范围 |
| C04 / P0 | **本地实现完成，后续运行时校验待C06**：统一数据集描述、过滤Schema和旧data_query适配；覆盖现有四表与Ads结构入口 | C02 | 描述与执行共用数据集合同；冲突/未知参数拒绝；日期/分页/排序/字段映射一致；独立测试通过 |
| C05 / P0 | **本地实现完成，生产语义/来源样本待验证**：规范结果与错误信封；专用工具与通用入口共用业务读服务及质量元数据 | C04 | 同筛选rows/count/totals/来源版本一致；空/null/不可用可区分；旧响应兼容有测试；混合/未知汇总维度阻止合计 |
| C06 / P0 | **入口实现完成，底层物理取消待补**：为MCP提供Gateway入口，保留原实时权限边界；输入输出Schema校验；只读不自动重试副作用 | C02/C04 | MCP→Gateway→service可追溯；不伪造Agent/approval；超时/取消不回传迟到成功；Prisma/网络调用物理取消及独立预算仍待专项闭环 |
| C07 / P0 | **申请链路与离线验收完成**：精确接线审批申请工具，复用持久审批/revision/digest/有效期；执行工具保持禁用 | C06 | `data_sync_start` 只创建REQUESTED申请；批准≠应用≠启动；回归确认没有创建同步任务或调用外部写接口 |
| C08 / P1 | **本地实现完成**：配置页由管理API注册目录驱动，展示权限、模式、版本、Schema、实现/来源/发布状态与阻断原因 | C03/C05 | 浏览器隔离用例覆盖目录、空目录、坏目录及凭证生命周期；不显示密钥、原始正文、签名URL |
| C09 / P1 | **本地实现完成，分类全路径覆盖仍需扩展**：审计新增失败分类、耗时、工具版本、Gateway状态和requestId关联；支持失败分类筛选，白名单摘要 | C06 | 隔离集成验证成功与输入Schema失败；代码记录拒绝、校验、超时、取消和执行失败分类；历史行缺字段时仍可读；不记录原始敏感参数 |
| C10 / P1 | 审计其他ERP模块，选已有真实只读service逐域注册，不新增分析逻辑 | C03–C06 | 每域独立授权、Schema、粒度和来源测试；ProductRecord等沿既有存储边界；不默认开放PII或内部Agent全工具 |
| C11 / P0收口 | 隔离端到端与消费者兼容，记录性能、回滚及交接 | C03–C09 | AI可发现→描述→查询→追溯；禁用/撤权/超时/未发布/坏Schema负例通过；Bulk不回归 |

推荐实施顺序：C01–C03 → C04–C05 → C06–C07 → C08–C09 → C11；C10在首批闭环后按域扩展。C08–C09 的隔离验证、限制与回滚见第四批交付文档。无需等待真实Ads采集才能完善目录和通用协作协议，但不能用基础设施完成掩盖真实数据缺口。

## 5. Ads T02、T07–T14 如何衔接

原状态仍以[Ads任务清单](../specs/007-amazon-ads-production-readiness/tasks.md)为准，本规划不替原任务勾选完成。

| 原任务 | 当前限制 | 与协作升级关系 |
| --- | --- | --- |
| T02 | 正式V1/V3合同与身份映射未重新核验；live关闭 | C03/C08必须显示真实采集未验证；不阻断注册表和离线协议开发 |
| T07 | 正式下载host/DNS/重定向/文件合同未完成 | 属数据采集边界，复用原任务；MCP不另做下载器，不暴露签名URL |
| T08–T11 | 专用报告调度、预算/恢复、BullMQ闭环未完成 | C07只申请，不顺带启动；数据生产与工具路由分别验收 |
| T12 | 覆盖/版本/时区/归因及partial-null语义待落实 | C05先如实输出现有限制；可信跨Profile汇总不能提前标完成 |
| T13 | 页面与MCP同质量口径待完成 | C05/C08复用同一个元数据服务，验收证据可共用；不复制另一套质量状态 |
| T14 | 性能/内存/容量实测矩阵未完成 | C11补MCP目录/Gateway增量开销，数据仓库矩阵仍由原任务完成 |

旧T20–T24涉及分析/策略/正式执行的内容不纳入本阶段；仅复用已有草稿和审批服务接口。不得据旧规划重新实现Skill分析能力。

## 6. 影响、回滚与验证

整体改动影响MCP契约、共享Gateway、权限发现、设置页和审计展示。C08–C09 仅消费既有管理API注册目录并扩展现有JSON审计metadata白名单/查询过滤，不新增Prisma字段或索引；可按批回滚UI/审计metadata消费者和写入逻辑，不移除实时授权、既有审计动作或数据隔离。C06底层物理取消及生产性能仍待专项闭环。

发现时增加实时权限检查、调用时增加Schema校验/Gateway和审计，可能增加DB调用及P95。优先一次请求内复用必要权限结果，但返回前撤权复核保留；不默认增加跨用户缓存、全表扫描或每工具逐次查库。使用固定种子和相同硬件比较现有/新路径P50/P95/P99、SQL数、目录大小、并发及内存；候选门槛与实测分开记录。性能不达标先减少重复查询，不降低授权检查。

隔离测试矩阵：目录注册/Schema/handler一致性；工具别名权限不扩大；token∩用户∩组织工作区∩店铺站点∩模块权限；调用中撤权；非法/冲突参数；过滤分页排序；发布失败不污染；API/MCP同源；Gateway审批绕过与未知结果；取消/超时；日志脱敏；配置页真实API响应；现有Bulk导入/草稿/导出关键回归。

API/共享逻辑采用check:fast或明确等价的核心测试+lint+TypeScript；数据库/队列用一次性PG/Redis及mock transport；页面用隔离API浏览器测试。上线前完整check与diff检查，真实验收另列目标环境与预算。既有872核心、23报表、10MCP结果仅为上阶段证据，不计作本规划新增功能已通过。

回滚按批回退注册表消费者/adapter，恢复旧路由契约，保留授权、审计、已发布数据和文件；不能恢复已禁用权限或以旧路径绕过新安全边界。不得自动回滚数据库、删除事实或原始文件。当前工作区 `.next-amazon-live/` 与既有Bulk改动完整保留，不停止已有进程、不清理生成目录。

最终交付需附：实际改动文件、逐工具目录、旧新参数/响应兼容表、权限矩阵、迁移情况、离线命令结果、性能差异、真实验证范围与阻塞项。未获精确批准不执行真实API、配置写入、持久库迁移、任务启动、commit/push或部署。
