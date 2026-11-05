# P4 PR 草案：通过既有 Reports 链路同步 FBA 仓收退货

状态：本地可审阅草案，尚未创建 GitHub PR。工作区混有前期实现和其他改动；拆分提交/推送范围尚未确认。本阶段不部署、不应用生产迁移、不启动真实同步。

现有退货域只有规划入口。此次增加 FBA 仓库已收到的退货报告：经审批冻结单站点窗口，使用既有 SP-API client、processor、Prisma 和原件加密能力完成 create → poll → document → download/parse。页面以一份已发布报告为边界展示订单/ASIN、原始原因与状态、UTC 仓收时间及数量；不改变库存、退款、财务或订单状态。

## 契约与官方证据

所有 Reports 操作版本 **v2021-06-30**：

| 操作 | 方法、资源及官方参考 |
| --- | --- |
| createReport | POST `/reports/2021-06-30/reports`，https://developer-docs.amazon.com/sp-api/reference/createreport |
| getReport | GET `/reports/2021-06-30/reports/{reportId}`，https://developer-docs.amazon.com/sp-api/reference/getreport |
| getReportDocument | GET `/reports/2021-06-30/documents/{reportDocumentId}`，https://developer-docs.amazon.com/sp-api/reference/getreportdocument |
| FBA Returns | `returnReportTypes.FBA_RECEIVED` 唯一 allowlist：https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba#fba-returns-report |
| 下载/加密/RDT | https://developer-docs.amazon.com/sp-api/docs/retrieve-a-report ；FBA Returns 列 Pricing 或 Amazon Fulfillment，无 restricted 标记；不申请 RDT，不支持未核验受限类型 |

官方已有 External Fulfillment Returns **v2024-09-11**（https://developer-docs.amazon.com/sp-api/reference/external-fulfillment-returns-v2024-09-11），与 FBA 仓收报告范围不同。本阶段不接入；批准计划记录了对原始“无独立 Returns API”表述的纠正。公开文档核验摘录及校验值见 `amazon-returns-p4-official-evidence.json`。

## 设计取舍

- 唯一键 tenant/workspace/seller/site/reportId/rowHash；完全相同行折叠并保留重复质量计数。此键不能跨报告消重，因此不提供跨报告累加；翻页固定 reportId，未完整提交报告不可查询。
- 原文可能含评论/商品名，只加密归档；明细只选白名单字段。TSV 16MiB、50,000 行上限、列/单元格上限，支持 BOM/CRLF/quoted tab/newline/GZIP；不写明文临时报告。每批仅保留配置数量的投影行，原件仍在现有有界下载/加密内存范围内。每批重扫原件校验，生产文件容量和 P95 需专项确认。
- 原因维度保留未知代码，null 状态保留 null；不编造中文原因映射。时间必须有明确 offset，转换 UTC 并另存配置站点时区；未证实日期格式 fail closed，不猜服务器时区。
- 附属加密 cursor 状态保存 report/document/archive/offset；事实+行进度同事务，重试或新批准 run 复用原报告与原件。Reports 非 nextToken 分页，next_token 为空；不伪造分页 token。
- create 意图先持久化；响应丢失停止人工核查，不自动再申请。404/IN_QUEUE/IN_PROGRESS 退避且有次数/时间上限；下载403/404更新签名元数据，不重建报告或误禁用 LWA；400/403终止，429/5xx有限重试。配置 seller/app/operation 令牌桶并兼顾现有 Reports budget；等待时释放 worker。
- 每次 HTTP 和提交前复核角色/region/站点/审批/绑定，撤权阻止写入；解绑取消关联任务。只允许逐次审批窗口，不启用自动计划。复用原客户端 LWA缓存及单飞；不重写原销售报告的 JSON、轮询和重试行为。

## 迁移及回滚

新增 `returnsPolicy`、cursor密文状态、`AmazonReturnRecord`、`AmazonReturnReason`；扩展 returns incremental 的现有检查，不改旧表业务行。迁移 `20261105060000_amazon_returns_reports` 只在 disposable PG 验证。生产需审核 DDL 锁、索引/原件增长、保留及访问流程。回滚停用 returns source/入口并 fence任务，保留事实/证据/游标；数据库不自动回退或删表。

## 验证

运行命令、最终计数、自检和未完成发布门槛见 `amazon-returns-p4-validation.md`。新增测试覆盖报告完整生命周期、空报告、重复与重放、跨run批次恢复、404/400/403/429/500、签名URL刷新、角色/归属变化零HTTP、途中撤权、写事务回滚、单报告查询权限与浏览器分页。完整离线回归同时覆盖原三链路、Orders和Finance。无生产凭证、真实Amazon请求或真实任务参与。
