# Ads 报表发布与只读查询收口：审批方案

状态：用户已于 2026-11-06 明确批准本地实施；代码与隔离验证已完成。真实 API、配置、任务、迁移与部署不在批准范围内。实际交付及限制见升级规划同日追加记录。

## 已观察到的差异

1. `query-service.ts buildAdsReportWhere` 允许 versionId=null 的成功旧任务事实；所有 PUBLISHED 版本并列返回，不选每业务事实键的最新发布版本，分页/汇总也会重复。与现有 Skill 的先排序后过滤逻辑不一致。
2. `repository.ts listFreshness` 报表 fallback 读取所有事实，可能将未发布事实描述为 CURRENT/覆盖日期；meta 还混用了结构计划成功时间。
3. `skill-data.ts` / MCP 表目录只检查 SP 来源范围及报表发布状态，没有 Ads CONNECTED 检查；旧 `data_query` 凭证已可读取新增 Ads 逻辑表，与“新域显式授权”要求不符。
4. worker 的报告版本写入/发布分支当前不可达（结构阶段在此前结束，报告事实被阻断）；不能将这段代码当作已验证的报表发布链。未见完整发布校验/撤回恢复服务或测试。
5. schema/migration/Client 由并行任务维护。本切片不修改或重新生成它们，也不把 db push 的隔离测试视为 migration 验收。

## 拟批准的本地代码范围

- `src/lib/amazon-ads/{repository,query-service,query-contract}.ts`，新增同域 `report-query.ts` / `report-publication.ts`（若现有边界足够则不新增）；API Ads data route 仅保持薄路由。
- `src/lib/amazon-sync/{mcp,skill-data}.ts`、`src/app/api/mcp/amazon/route.ts`：只读报告工具和已有逻辑表接线；权限规则不扩张。
- 对应 query/MCP/fixture/隔离 PG 测试与 runner，以及规划/API/交付文档。设置页面仅按现有真实后端目录展示工具状态，不重写 Skill 正文。
- 不改 schema、migration、生成 Client、环境文件、生产配置、任务计划或结构 worker；报告 adapter 和真实报告阶段继续关闭。

## 具体行为

1. 复用现有 ReportVersion/Fact，统一 API 与 MCP 的事实选择边界：组织/工作区/Profile/reportType/adProduct/reportDate/factKey 内选最新 PUBLISHED 且来源任务 SUCCEEDED 的版本，再应用 Campaign 等维度筛选；同口径才比较，不混币种/归因/API 口径。未知旧 version-less 行不进入读取或目录。需核对现有 factKey 口径，不凭空重算旧数据。
2. 查询只含 CONNECTED Ads 授权、活动且已绑定店铺、实时 ERP/MCP Seller-站点交集；事务内 count/rows/币种汇总/freshness 使用一致快照，返回前复查权限/绑定。严格字段/排序白名单，页大小最多100，日期窗口有界，返回来源版本及字段口径；不返回 rawDimensions 或凭证。
3. 新只读工具 `amazon.ads.reports.list` 必须显式授予凭证；旧 `data_query` 访问 ads_report_daily 还需该新工具授权，旧库存/刊登/销售工具行为保持。目录显示未授权/无已发布数据/未核验等原因，不将旧凭证自动扩权。
4. 在现有存储上实现可隔离调用的 staging/校验/发布与撤回恢复服务：校验来源 task/Profile/请求日期、已核实合同声明、事实键/报告类型/币种/归因、去重行数；失败/取消/校验失败不可发布。发布与任务成功在事务内完成；重复发布幂等；历史版本保留。撤回恢复只作本地函数与 fixture 验证，不接 API/MCP 写入口。空报告及删除语义需明确合同，无法证明时保持 blocked，不推断清空历史。
5. 单个查询当前快照不等于报告完整重放，报告实际读取 adapter 尚未实现；不会调用真实 Amazon 或启用任何计划。没有官方具体 Campaign 报告合同前，不声称发布服务可以用于真实报告。

## 数据、性能与回滚

只新增/修改本地代码和隔离 fixture；不改真实数据或配置。窗口函数去重/count/聚合可能提高 SQL 成本：先要求有界日期/授权范围、页大小100、查询事务超时，使用隔离多 Profile 数据测验证。无性能证据不加索引/缓存/新模型。查询回滚可恢复本切片代码；已发布版本保持保留，不删表/历史数据，不自动恢复不安全 legacy 读取。需要停用真实工具/凭证时另按目标环境审批。

## 验证与验收

隔离 PG/Redis + mock transport；不得读取 dotenv、继承真实凭证或访问真实外网。覆盖多租户/店铺/站点/Profile、断连/解绑/撤权、最新版本先选后筛选、失败/取消/staging/legacy 排除、null、空版本、重试幂等/去重行数、事务发布和回滚、API/MCP一致 total/分页/排序/汇总/freshness、工具显式权限及脱敏。回归 Bulk Operations 核心测试、TypeScript、定向 ESLint、diff check；完整构建受既有全局 lint 门禁约束，记录失败而不清理其他任务产物。

批准仅涵盖本地实现与隔离验证；不含真实 API/Profile 测试、配置、真实任务、真实迁移、提交推送或部署。
