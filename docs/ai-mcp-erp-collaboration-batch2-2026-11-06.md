# AI / MCP / ERP 协作升级：第二批交付与交接

当前契约更新（2026-11-10）：下文为历史交付记录。ERP、MCP、Lili 和销售导出已统一只返回正式字段 `facts`、`metrics`、`listingAttributes`、`fieldSources`，不再返回 `business*` 副本或 `exactMetrics`，也不再支持 `includeExactMetrics` 开关。这些开放 JSON 业务字段中的数值统一以精确字符串返回（`numericEncoding: JSON_NUMERIC_STRINGS`），保留未知字段、嵌套结构、布尔值和 null；分页等固定元数据继续使用其声明的数值类型。读取权限以服务端实时 Seller Account 分配为准，不继承历史字段、工具或财务管理员限制。历史测试数字不代表本次验收结果。

日期：2026-11-06。范围：C04–C05 本地离线实现。用户已批准数据集契约、兼容查询、规范化结果和 `sales-query.ts` 精确数值投影。本批不包含共享 Gateway、持久数据库迁移、配置写入、真实 API、commit/push 或部署。总 TODO 仅将 C04–C05 标为本地实现完成；生产样本、运行时Schema/Gateway及C06–C11仍未完成。

## 实现范围

| 文件 | 变更 |
| --- | --- |
| `src/lib/amazon-sync/mcp-datasets.ts` | 新增统一数据集目录、字段/过滤/排序/日期/分页/粒度/发布语义、参数归一化、描述Schema和结果元数据/报告呈现纯函数。 |
| `src/lib/amazon-sync/mcp-tool-registry.ts` | `data_query` / `data_describe_table` 与 Ads 专用工具Schema从数据集目录派生；保留现有21个工具名，更新相关工具版本。 |
| `src/lib/amazon-sync/mcp.ts` | 旧 `table` 与新 `module/dataType` 共用解析和查询契约；Ads通用及专用入口复用现有查询服务；执行额外Ads工具授权复核；返回统一分页和元数据。 |
| `src/lib/amazon-sync/skill-data.ts` | 移除重复表目录，复用同一过滤/分页/排序合同；保持原查询服务和来源边界。 |
| `src/lib/amazon-sync/sales-query.ts` | 用户已单独批准的可选 `includeExactMetrics`：在现有当前页SQL中用PostgreSQL JSON文本提取原始已存数值字符串；默认关闭，旧 `metrics` 不变，不增加查询或迁移。 |
| `src/app/api/mcp/amazon/route.ts` | 错误附加稳定 `requestId`、工具版本和脱敏业务码；区分参数无效、逻辑表未实现与数据集没有已发布来源。 |
| `tests/amazon-mcp-datasets.test.ts` | 新增纯契约、边界和跨维度汇总安全测试。 |
| `tests/amazon-mcp-registry.test.ts`、`tests/integration/amazon-mcp.integration.ts`、`tests/integration/amazon-ads-mcp.integration.ts` | 覆盖新旧参数、分页/过滤、兼容响应、权限、发布状态、通用/专用报告等价和精确字符串。 |

工作区内其他并行变更不属于本批。新增或修改的并行 `prisma/schema.prisma`、migration、processor、Ads页面、采集与其他同步逻辑均未由本批处理；未清理 `.next-amazon-live/`。

## 数据与兼容边界

| module / dataType | 旧 table | 来源与主要约束 | 每页上限 |
| --- | --- | --- | ---: |
| `amazon_sync / inventory` | `inventory` | 已发布库存snapshot；SKU/ASIN/condition；UTC capture日期；按SKU排序 | 1000 |
| `amazon_sync / listings` | `listings` | 已发布刊登snapshot；SKU/ASIN/listingStatus，state/status兼容别名；UTC capture日期 | 1000 |
| `amazon_sync / sales_traffic_daily` | `sales_traffic_daily` | 店铺逐日销售流量；不支持SKU/ASIN拆分；业务日期，最多90天 | 1000 |
| `amazon_ads / report_daily` | `ads_report_daily` | 完整成功任务的已发布事实版本；保留广告字段和Profile/发布边界；最多366个日期差（367个含首尾日期），每页≤100 | 100 |
| `amazon_ads / entities` | 无 | 当前观察的广告结构；缺行不代表删除；不提供业绩日期；需独立具名 `amazon.ads.entities.list` 凭证授权 | 100 |

旧消费者可继续只传 `table` 和既有 `filters/page/pageSize`；新消费者可传 `module/dataType`。同时传两类定位时必须指向同一数据集。不存在的物理名、已知但未实现的逻辑表、未发布数据集和空结果分别拒绝或表示，不静默忽略筛选。多种别名与规范字段值冲突、跨数据集字段、未知字段、非法日期、越界页大小、非法排序均拒绝。销售流量默认最近7个UTC日标签，广告日报默认最近30日标签；snapshot不自动限定capture日期。日期标签遵循各来源既有查询服务语义。

保留旧 `data`、`items`、`total`、`metrics` 等字段。行查询增加 `pagination`、`warnings` 和 `meta`；旧工具名、旧 table 参数、旧销售数值对象均不删除。MCP route错误不包含原始筛选值。当前是应用侧Schema/归一化，不宣称MCP route已执行完整JSON Schema验证；C06负责Gateway及运行时输入/输出验证。

销售流量 `exactMetrics` 仅在MCP读路径开启。它将PostgreSQL中JSON数值原文投影为字符串，以避免JS Number二次舍入；`metrics` 继续走旧解析以维持兼容。若写入PostgreSQL前精度已经损失，本方案无法恢复。没有新增DB查询或列迁移。

Ads报表通用与专用工具复用相同的已发布查询器和presenter。总计仅在比较所需币种、Profile时区、归因等维度均已知且一致时提供；混合或未知时 `totals` 为null并附阻断警告。空页依据总记录数和请求页区分，避免将深页空页误报为数据集没有记录。来源版本、日期语义、范围和Schema状态随结果返回；真实上游样本/版本语义仍待原Ads采集任务验证。

## 验证

| 命令/检查 | 结果 |
| --- | --- |
| 数据集纯测试 + 注册表测试 | 10/10通过 |
| `node scripts/test-amazon-sync-integration.mjs --mcp` | 39/39通过，含销售JSON数值精度、旧metrics兼容和报告一致性 |
| `node scripts/test-amazon-ads-offline.mjs --mcp` | 13/13通过，含独立具名授权、通用/专用等价及查询中撤权 |
| `npm run lint -- --ignore-pattern '.next-amazon-live/**'` | 通过；5条既有warning，0 error |
| `npm run test` | 898通过、1失败；失败在并行改动的 `automatic-schedule.ts` 支持站点变更与旧测试期望不一致（测试仍只期望US/CA，现代码增加MX/BR），不属于本批文件。 |
| `npm run typecheck` | 被并行改动 `src/lib/amazon-sync/processor.ts` 的4处Prisma唯一键类型不匹配阻断；本批没有运行Prisma generate，也未修改该处理器。 |
| 本地纯契约微基准 | 21工具目录序列化约39,968字节；2000次归一化（预热100次）P50 0.003375ms / P95 0.004750ms / P99 0.007667ms。仅作纯函数参考，不代表请求、SQL、并发或生产延迟。 |

完整 `npm run check`、生产构建、浏览器E2E、真实数据/上游样本与Gateway路径未运行。当前全局类型检查和全套测试的阻塞必须由对应并行schema/processor及schedule工作合并解决后再重跑；不能将其计作本批失败，也不能据本批专项通过声称整个工作区可发布。

## 回滚与后续

回滚本批时按文件逆向撤回数据集adapter、MCP enrichment和可选exactMetrics投影，并保留原有权限检查、数据发布边界与凭证隔离；不覆盖其他工作区改动，不删除事实数据、配置或schema，不回退迁移。由于销售精确字段是可选且默认关闭，非MCP调用保持原行为。

C04–C05已达到本地实现和专项离线测试门槛。后续生产级闭环仍需C06接入Gateway并验证输入/输出Schema、取消/超时/资源预算；C07批准流程，C08管理页面，C09审计，C10逐域扩展，以及C11全链路兼容、性能和发布前检查。广告数据真实性、T12/T13质量语义与T14性能矩阵仍由原Ads任务负责。当前不执行真实API、持久迁移、配置写入、任务启动、commit/push或部署。
