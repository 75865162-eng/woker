# 四个 Amazon 数据承接域：审查与实施

## 实施前审查（2026-11-05）

1. 连接：AmazonSpApiAuthorization 存储组织/工作区内 Seller、区域、endpoint、凭证 revision、参与站点及角色 attestation；凭证通过 integration-secrets AES-GCM 加密。AmazonSellerIdentity 与 AmazonSyncDataSource 约束 ERP Seller/Marketplace/授权，用户与角色数据范围授权与模块 RBAC 相交。参与站点成功不证明业务角色。
2. 既有实现：Orders 2026-01-01 searchOrders + 可选 getOrder，订单头和明细在同一事务写入；销售日报、FBA 退货复用 Reports 2021-06-30 创建/轮询/下载；财务用 Finances 2024-06-19 listTransactions。原文可能含 PII，AmazonSyncRawPage 加密保存。
3. 任务：AmazonSyncRun、ResourceCursor、Page/TaskLog、ApiBudget/TokenBucket；dispatchVersion、lease/fence、审批/身份/revision 重检；暂停取消、429/5xx 有限重试和不确定创建保护。复用现有 BullMQ Worker，不增设队列或调度框架。
4. 数据库：已有 AmazonOrderItemRecord、OrderDetailWork，订单明细按父订单复合 FK 隔离；尚无结算/赔偿/库龄事实表。新增 Reports document/row 只承接这三类外部观察，不写 ProductRecord、库存扣减或财务入账。
5. 页面：/operations?view=...；Button/Badge、scope headers、后端分页、来源任务与审批页可复用。现有导出仅销售日报异步 JSONL，不可称全部域已经支持导出。新增页列设置仅当前视图，不改变事实。
6. 目录：syncDomains.implemented 控制适配器准入，implementedDomain 为服务端入口。新页面存在不足以启用独立采集；order_items 使用 orders 详情，没有第二个同步源。授权状态须由真实成功请求证明，静态 verified 字段不能作为实测授权。

## 官方证据与边界

2026-11-05 经官方站点只读 WebMCP 读取 FBA Reports（updatedAt 2026-10-13）和 Settlement Reports（updatedAt 2026-10-14）。普通 HTTP 受到证书/连接/反爬限制，未请求任何业务 API。历史证据保留 docs/amazon-sync-center-phase0/official-live-doc-evidence.json。

| 域 | API / operation | 角色/资格 | 日期与格式 |
| --- | --- | --- | --- |
| 订单商品 | Orders 2026-01-01 searchOrders/getOrder | 复用现有详情 requiredRoles / includedData / business purpose attestation；新版 Orders PII 不使用 v0 RDT | 查询明确 createdTime 或 sourceUpdatedAt；orderItems[].product.asin/sellerSku、quantityOrdered、proceeds.proceedsTotal，JSON |
| 结算 | Reports 2021-06-30 getReports/getReport/getReportDocument，GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2 | Finance and Accounting，Seller Central sellers | getReports 的 createdSince/Until 是报告创建时间，不是结算周期；只能发现 Amazon 生成报告；TSV，amount 支持小数逗号，不能跨币种累加 |
| 赔偿 | 同版 createReport/getReport/getReportDocument，GET_FBA_REIMBURSEMENTS_DATA | Pricing 或 Amazon Fulfillment attestation，FBA seller 资格待真实核验 | approval-date，日更新；TSV，金额精确字符串；现金/库存件数分开；不直接与财务入账相加 |
| 库龄 | 同版 createReport/getReport/getReportDocument，GET_FBA_INVENTORY_PLANNING_DATA | Amazon Fulfillment，FBA sellers | snapshot-date，当前快照；不将请求日期解释为历史库存；NL/PL/SE/BE 不支持，BR 字段较少；缺失分桶保持 NULL |

链接：
- https://developer-docs.amazon.com/sp-api/reference/getorder-3
- https://developer-docs.amazon.com/sp-api/reference/getreports
- https://developer-docs.amazon.com/sp-api/reference/createreport
- https://developer-docs.amazon.com/sp-api/reference/getreport
- https://developer-docs.amazon.com/sp-api/reference/getreportdocument
- https://developer-docs.amazon.com/sp-api/docs/report-type-values-settlement
- https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba

所有域复用官方 NA/EU/FE endpoint；实际 Seller/Marketplace 可用性仍待真实验收。默认预算是保守上限，使用持久预算及响应限流调整，不承诺官方 SLA。Reports 轮询等待有界，下载复用 S3 HTTPS 白名单、禁止跳转、16 MiB 压缩/解压上限。时间含糊时拒绝，不猜测地区时区；结算仅保存日期原文及明确可解析的日期，不伪造 UTC。

## 影响与回滚

本次是业务扩展（P2），新增三类报告事实与分页读模型；不迁移商品主读路径。每次处理一个 HTTP 操作/有限行批次，限制报告数量、页数和行数，避免无界订单详情并发。只编写增量迁移，不对现有库执行。回滚停用新源和任务并保留历史事实/原文；数据库向前修复，不自动删表。既有自动同步工作区改动不扩大到新增三个域。

## 验收

隔离 fixture 验证金额/日期/TSV、任务恢复/身份/撤权/发布保护、SQL 查询范围及分页、页面筛选/来源入口；运行核心测试、lint、TypeScript。真实 Seller 角色、报告格式地区变体、生产 DDL 锁与 P95 仍需受控上线验收。不得以离线 fixture 通过宣称生产数据已接入。
