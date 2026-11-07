# Amazon Ads Phase D 交付记录

日期：2026-11-06

本阶段在上一阶段的 Ads 报表 staging/version、权限重查和 MCP 只读查询基础上，补齐了 Skill 调用的可追溯状态面板和统一只读兼容入口。没有修改现有 Skill 正文，没有调用真实 Amazon API、凭证或生产任务。

## 已完成

- 报表查询统一返回已发布版本事实，并补充店铺、站点、日期范围、粒度、币种、同步/发布时间、版本 ID、来源任务、完整性状态和 Schema 状态。
- 报表返回空值安全的 CTR、CPC、CVR、ACOS、ROAS。百分比字段以百分比点返回；分母缺失或为零时返回 `null`，不同币种、归因窗口和 API 合同仍分组汇总。
- 删除 Ads 同步处理器中会绕过统一报告发布校验的死分支。真实 Reports adapter 尚未完成时，结构同步不会创建或发布报告版本；隔离环境仍使用 `report-publication.ts` 完成 staging、校验、原子发布、幂等重试和撤回/恢复。
- 设置接口 `GET /api/operations/amazon-mcp` 增加真实 Ads 连接/Profile、结构/报告 adapter 状态、同步计划与新鲜度、已发布版本/来源任务/报告合同、完整性和 Schema 状态，以及当前用户脱敏的 MCP 成功/拒绝调用记录。
- MCP 新增只读 Skill 兼容别名：`ads_list_entities`、`ads_get_campaign_structure`、`ads_get_sync_status`、`ads_get_data_health`、`ads_get_connection_status`、`ads_get_settings`。别名不扩展权限，仍要求凭证显式授权并通过当前 ERP 店铺/站点授权边界。
- 实体返回继续使用字段白名单；报告、结构、逻辑表查询均不返回原始凭证、加密 checkpoint 或未经验证的字段。

## 数据库与迁移

本阶段没有新增 Prisma schema 或 migration。上一阶段的 `AmazonAdsReportVersion`、`AmazonAdsReportFact`、`AmazonAdsReportRequest`、Attempt/DomainState 结构继续作为事实存储；本地隔离测试使用一次性 PostgreSQL `db push`，没有对持久或生产数据库执行迁移。

## 验证

- 新增派生指标纯函数测试通过。
- Ads query、budget、adapter、sync policy 定向测试：23/23 通过。
- Ads 报表隔离闭环：15/15 通过。
- Ads MCP 隔离测试：10/10 通过，包含 Skill 兼容别名、字段白名单、店铺/Profile 交集、撤权重查和调用审计。
- 现有项目单元回归：860/860 通过。
- `npm run typecheck`、定向 ESLint 和 `git diff --check` 通过。

## 仍待真实环境验收

- Amazon Ads Reports API 的实际 reportType、字段合同、归因窗口、时区和下载/解压协议尚未由已授权测试 Profile 核验；报告 adapter 因此仍返回不可用状态，不能宣称已有真实日报同步。
- 未连接真实 Profile、未执行生产同步、未运行持久迁移，也未启用写操作。竞价、预算、状态、关键词、否定词和商品投放修改仍必须先形成草稿并走既有 Agent Gateway 审批。
- Skills 依赖的趋势、推荐和写入工具没有虚构实现；当前可用能力是已发布 Ads 结构、`ads_report_daily`（存在已发布版本且凭证显式授权时）和状态/健康只读别名。未验证逻辑表继续返回 `SCHEMA_UNVERIFIED`。
