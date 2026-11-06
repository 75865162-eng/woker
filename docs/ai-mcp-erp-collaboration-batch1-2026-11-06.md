# AI / MCP / ERP 协作升级：首批交付与交接

日期：2026-11-06。范围：C01–C03 本地离线开发。用户已针对首批注册表、当前授权发现及隔离验证明确批准；不包含后续批次、真实 API、配置写入、持久库迁移、commit/push 或部署。

## 1. C01 逐工具盘点

共同入口：[JSON-RPC route](../src/app/api/mcp/amazon/route.ts)。本批统一定义：[mcp-tool-registry.ts](../src/lib/amazon-sync/mcp-tool-registry.ts)，包含每工具名称、描述、canonicalName、模块、版本、inputSchema、outputSchema、模式、权限、enabled、实现状态；[mcp.ts](../src/lib/amazon-sync/mcp.ts) 的 `registeredAmazonMcpTools` 逐名绑定实际 handler，`invokeRegisteredAmazonMcp` 保留既有业务分支与返回前授权检查。

以下均为真实 ERP 本地业务读取/申请实现，不以 fixture 或 Demo 返回业务数据。隔离测试使用合成数据，不证明现有真实数据或上游采集已验证。

| 工具名 | handler / 实际服务或存储 | 输入要点 | 现有输出与业务副作用 |
| --- | --- | --- | --- |
| `amazon.ads.reports.list` | [report-query.ts](../src/lib/amazon-ads/report-query.ts) `queryPublishedAdsReports` | Profile、报告类型、日期、Campaign/Ad Group/target/ASIN/searchTerm/placement；pageSize ≤100 | `data.items/total + meta`；只读完整成功任务的已发布版本，精确数值字符串 |
| `amazon.ads.entities.list` | [data-query.ts](../src/lib/amazon-ads/data-query.ts) `queryAdsEntities` | Profile、entityType、层级 ID、state/search；pageSize ≤100 | `data.items/total + meta`；结构字段白名单，无业绩或报告日期 |
| `ads_list_entities` | 同一结构服务；独立具名 handler | 结构入口同形 | 兼容别名；不隐式授予 canonical 工具或日报权限 |
| `ads_get_campaign_structure` | 同一结构服务；handler 强制 `SP:campaign` | 结构入口同形 | 仅活动结构；保留原别名行为 |
| `ads_get_sync_status` | [mcp.ts](../src/lib/amazon-sync/mcp.ts) `getMcpSettingsSnapshot` | 店铺/站点 | `data.sync + meta`；同步状态/adapter readiness，无启动操作 |
| `ads_get_data_health` | 同上 | 店铺/站点 | `data.health + meta`；Schema、发布完整性与新鲜度 |
| `ads_get_connection_status` | 同上 | 店铺/站点 | `data.connection + meta`；连接摘要，不返回密钥 |
| `ads_get_settings` | 同上；本批增加所选配对 fence，并省略个人全量调用日志 | 店铺/站点 | `data + meta`；Profile/计划/发布摘要，不更改设置 |
| `amazon.stores.list` | [mcp.ts](../src/lib/amazon-sync/mcp.ts) `verifiedSources` | 店铺/站点 | 原有数据源摘要数组；只读 |
| `amazon.inventory.list` | 同文件库存分支，`AmazonInventorySnapshot` | 店铺/站点、page | `rows + source`；50 行/页，成功发布 head |
| `amazon.inventory.summary` | 同文件库存聚合分支 | 店铺/站点 | `summary + source`；数量汇总，非策略 |
| `amazon.catalog.list` | 同文件刊登分支，`AmazonCatalogSnapshot` | 店铺/站点、page | `rows + source`；50 行/页，成功发布 head |
| `amazon.sales.list` | [sales-query.ts](../src/lib/amazon-sync/sales-query.ts) `readSalesTraffic` | 日期、店铺/站点、任务、keyword、page | `rows/pagination/source/asOf`；店铺逐日粒度，50 行/页 |
| `amazon.sync.status` | `verifiedSources` | 店铺/站点 | 原有数据源摘要数组；不创建任务 |
| `amazon.history.read` | [snapshots.ts](../src/lib/amazon-sync/snapshots.ts) `readTaskSnapshot` | taskId 实际必填、page、店铺/站点 | 历史库存/刊登 snapshot + source；只读成功且授权的任务 |
| `amazon.sales.export` | `readSalesTraffic` | 销售查询同形、page 必须为1 | JSONL 字符串与 rowCount，最多1000行；不写导出文件、不调用外部接口 |
| `data_list_tables` | [skill-data.ts](../src/lib/amazon-sync/skill-data.ts) `availableSkillTables`；已发布 Ads 检查 | 店铺/站点 | `data.items/total + meta`；仅授权且有发布数据的逻辑表 |
| `data_describe_table` | 同文件 `describeSkillTable` | table、店铺/站点 | `data.table + meta`；应用字段与粒度，不冒称上游样本已核实 |
| `data_query` | 同文件 `querySkillTable` | table、filters、page、pageSize | `data.items/total + meta`；库存、刊登、店铺日报、广告日报四表；前三表上限1000，Ads实际仍受100上限约束 |
| `data_sync_status` | `verifiedSources` | 店铺/站点 | `data.items/total + meta`；数据源与同步状态 |
| `data_sync_start` | [change-approval.ts](../src/lib/amazon-sync/change-approval.ts) `requestChange` | resource；销售流量可传 dateFrom/dateTo；最多20数据源 | `approvalRequired:true/started:false/changeRequest`；写持久申请；不批准、不应用、不启动 |

每次读取仍有 append-only 审计和凭证 lastUsedAt 更新，因此 READ_ONLY 指业务事实只读，不表示无审计写入。旧工具没有远端写入 handler。本批不新增执行工具。

## 2. 权限矩阵与首批修正

共同边界：[data-access.ts](../src/lib/amazon-sync/data-access.ts) 的 `withAmazonMcpBoundary`、`amazonDataAccess`、`explicitAmazonDataAccess`、`assertAmazonAction`。当前实际业务模块权限是 `operations`；注册表中的 `amazon_ads` / `amazon_sync` 是目录模块标签，不新增另一套角色权限。

| 类型 | 当前角色权限 | 显式数据 grant | 凭证与业务附加边界 |
| --- | --- | --- | --- |
| 业务读取/描述/状态 | `operations:view` | 当前个人/当前角色的 view，enabled 且 mcpEnabled | 当前个人 credential、具名 tools、org/workspace、逐 seller/site 配对、有效身份和数据源 |
| `amazon.sales.export` | `operations:export`；认证另要求 view | export，enabled 且 mcpEnabled | 同上；最多1000行；view不能替代export |
| `data_sync_start` | `operations:create`；认证另要求 view | sync，enabled 且 mcpEnabled | 同上；仅 inventory/catalog/sales_traffic 的持久申请 |
| 广告日报专用/通用查询 | 上述读取边界 | 上述 view | 额外独立具名 `amazon.ads.reports.list` 凭证授权；CONNECTED Profile 与发布版本边界 |
| 结构兼容别名 | 上述读取边界 | 上述 view | 每个别名独立具名授权；canonicalName不扩权 |
| 管理员 | 实时角色与模块权限 | 不隐式赋予 MCP 数据范围 | ERP管理员身份不等于个人MCP超级权限 |

`tools/list` 每次读取当前凭证，按最多三种 action 分组校验，使用凭证∩实时ERP配对∩已核实数据源；返回前再次校验授权、数据源绑定及凭证变化。无跨用户缓存，无每工具逐次查库。空结果不暴露被拒绝工具原因或其他租户范围；服务异常不伪装为空结果。`tools/call` 仍独立执行原实时授权，不把发现结果当授权凭据。

发现仅验证可调用前提，不扫描业务事实来判断是否有行；新版 `_meta` 明示 `erp/dataAvailability=NOT_CHECKED`。有数据源但尚无发布行与未实现工具不同。实际数据状态仍由既有描述/状态/查询服务给出。

本批还修正原 Ads 状态 handler 的范围缺口：设置聚合显式接收服务端已选 seller/site pairs；MCP不返回该用户其他凭证的调用日志。ERP管理 API 仍保留个人审计分页。

## 3. 兼容表与文件范围

| 消费者 | 首批兼容行为 |
| --- | --- |
| 原 Skill / MCP客户端 | 保留21个工具名、既有参数与text JSON结果；不改Skill正文、规则或提示词 |
| 旧 `data_query` | 保留table/filters/page/pageSize，不提前支持module/dataType；冲突和跨表过滤的统一留给C04 |
| 原凭证编辑页 | 管理API保留`tools: [name,description][]`；新增`toolCatalog`元数据，未改凭证数据 |
| 旧协议或未带版本header | 保留原inputSchema/annotations，不增加outputSchema或structuredContent |
| 明确带`MCP-Protocol-Version: 2025-06-18` | object结果同时保留text并新增structuredContent，目录增加object outputSchema与命名空间_meta；旧数组结果继续text，不发布不符合协议的array outputSchema |
| 协议协商 | 仍为无状态端点，initialize接受原三个版本；不新增session持久化或宣称listChanged支持。新字段按显式协议header门控，不能把未带header请求当已协商新版 |

实际业务文件：`src/lib/amazon-sync/mcp-tool-registry.ts`（新增）、`src/lib/amazon-sync/mcp.ts`、`src/app/api/mcp/amazon/route.ts`、`src/app/api/operations/amazon-mcp/route.ts`。验证文件：`tests/amazon-mcp-registry.test.ts`（新增）、`tests/integration/amazon-mcp.integration.ts`、`tests/integration/amazon-ads-mcp.integration.ts`。本交接文档与总规划同步更新。无Prisma migration、依赖、运行配置、worker、Skill或部署改动。

注册表绑定保留现有共享业务 dispatcher，以最小改动维护旧响应；不是把内部Agent工具整体导出。已核对[内部工具类型](../src/lib/agent-platform/types.ts)及[Gateway](../src/lib/agent-platform/tool-gateway.ts)：其Agent权限/审批上下文不能替代个人MCP身份，且本批无完全匹配的可直接复用服务注册项；Gateway适配在C06处理。

## 4. 验证及性能

结果在首批最终验证结束后补充。命令均使用现有离线 runner 或纯fixture；不读取真实dotenv、不继承真实数据库/服务密钥、不拉取Docker镜像。临时PG/Redis由runner创建和清理。

- 注册表：21工具绑定、重复名/孤立或缺失handler、坏Schema根类型、坏别名、禁用谓词、审批申请标注与协议兼容。
- 集成：当前授权变化、凭证工具/店铺站点收窄、目录读取中撤销grant/凭证、现有调用中撤权、跨租户/用户、Ads显式授权、发布边界与状态摘要防泄漏。
- 生产构建、页面E2E和真实采集不在本批运行；本批没有UI变动。准备合码/上线才做完整check与发布闭环。

20次串行临时库样本仅比较“旧内存工具过滤”与“新增实时发现”，不含共同认证/协议审计。它不能替代生产全请求、并发或P95/P99容量验收；SQL数尚未instrument，不填写虚构实测值。C11仍需完整矩阵。

## 5. 回滚与剩余工作

本地回滚仅逆向撤回本批列明文件diff，不使用覆盖整个工作区的reset，不覆盖其他窗口改动；保留权限检查和本批修正的摘要范围防泄漏逻辑。若选择完全回退，旧摘要范围缺陷必须先独立修复，不能以兼容名义恢复泄漏。不执行数据库回滚、事实清理或凭证恢复。

后续C04–C05方案（尚未应用）：

| 新定位 | 原table兼容 | 拟复用读取入口与授权附加条件 |
| --- | --- | --- |
| `amazon_sync / inventory` | `inventory` | `querySkillTable`；原view边界 |
| `amazon_sync / listings` | `listings` | `querySkillTable`；原view边界 |
| `amazon_sync / sales_traffic_daily` | `sales_traffic_daily` | `readSalesTraffic`；店铺逐日，不接受SKU/ASIN过滤 |
| `amazon_ads / report_daily` | `ads_report_daily` | `queryPublishedAdsReports`；独立`amazon.ads.reports.list`工具授权，最大100行/页 |
| `amazon_ads / entities` | 无旧table；仅新增明确定位 | `queryAdsEntities`；要求额外具名`amazon.ads.entities.list`授权，旧data_query凭证不自动取得新数据集 |

新定位必须同时给出module/dataType；与table同传时必须解析为同一数据集，否则400拒绝。新纯契约文件拟为`src/lib/amazon-sync/mcp-datasets.ts`；涉及的现有文件仅`mcp-tool-registry.ts`、`mcp.ts`、`skill-data.ts`及对应测试/文档；只有需调整JSON-RPC错误映射时才修改MCP route，不改管理API权限。

1. 新增纯数据集契约模块，四个已有table和Ads结构映射module/dataType，table旧参数继续可用；两套定位冲突、未知/不支持过滤明确拒绝，禁止静默返回未过滤全量。
2. 在`skill-data.ts`与注册表复用过滤白名单、粒度、日期语义和分页上限；Ads通用与专用入口继续共用`queryPublishedAdsReports`/`queryAdsEntities`，不创建第二套业务查询。
3. 在`mcp.ts`和契约模块追加requestId/toolVersion/dataset/实际scope等元数据，并保留旧data/rows/total及text结果形状。无币种/时区/版本语义时使用null，不推断；精确金额仍为字符串。
4. API/参数契约影响限上述入口；不改共享Gateway、权限模型或存储事实源。新增校验是有界纯函数，预计不增加DB遍历；需隔离比较rows/count/版本/过滤分页，以及核心测试、lint、TypeScript。
5. 回滚按本批新增契约adapter逆向撤回，保留旧table入口和既有授权；不删表、不执行真实查询。C06–C11、其他ERP域C10、真实数据、配置、GitHub同步和部署需另按范围确认。
