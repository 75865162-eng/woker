# P4 退货：官方核验、冲突与实施计划

状态：2026-11-05 用户明确批准本计划的 FBA 仓收退货范围，已完成本地实现。沿用 `50ren-erp-pm` 与现有 Operations Hub 实施追踪；验收与剩余人工事项见 `amazon-returns-p4-validation.md`。未读取真实凭证/配置、未执行生产任务或迁移。下文保留批准时的设计与影响说明。

## 现状与需要明确的差异

1. `sp-api-client.ts` 已有 Reports v2021-06-30 的 createSalesTrafficReport/getReport/getReportDocument/downloadReportDocument；下载支持有界 GZIP、安全 S3 URL 和无凭证下载，但只返回 JSON。`processor.ts executeReportSlice` 只处理 sales_traffic，状态密文在 run checkpoint；固定间隔、24 小时上限，404 当前为终止错误，手动 retry 当前重新开始报告。
2. P4 应扩展既有客户端的报告创建和文本解码能力，以退货 reportType 适配器进入现有 processor，不建 HTTP 客户端，不把 TSV 伪装 JSON。不修改销售日报现有返回类型、轮询、retry 或发布行为。退货分支独立持久状态/有界批次，沿用现有审批、Prisma、加密、lease/fence 和预算表。
3. 用户“截至 2026-11 没有独立 Returns REST API”的表述与当前官方目录冲突：已列 **External Fulfillment Returns v2024-09-11**。参考 https://developer-docs.amazon.com/sp-api/reference/external-fulfillment-returns-v2024-09-11 ，指南 https://developer-docs.amazon.com/sp-api/docs/external-fulfillment-returns 。其官方 Retrieve Return Information 指南要求卖家提供 location ID / SKU ID 以及 Direct-to-Consumer Shipping (Restricted) 角色：https://developer-docs.amazon.com/sp-api/docs/retrieve-return-information 。这证明独立 API 的存在，不证明它适用于当前 ERP 的 FBA 仓收退货；本次不接入 listReturns/getReturn。
4. 建议 P4 只做 **FBA Returns Report**：`GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA`。它只覆盖 Amazon fulfillment center **已收到**的 FBA 退货，内容日更新；不等于退货申请、FBM、自配送、退款或赔偿。不要用该表直接更新库存、订单状态或财务金额。
5. 仓库 phase0 曾提出 customer-comments 不默认留 raw；本次用户原始任务明确要求原始报文回溯。按用户要求优先：完整 TSV 原文只存加密 envelope（JSON 包含 raw text、内容校验与请求元数据），customer-comments/product-name 等自由文本不进入明文事实、日志或 UI；不落任何明文报告临时文件。生产保留期/访问流程另行审查。
6. 报告各行没有 marketplaceId 字段。请求严格单站点，getReport 返回的 seller 关联、reportId/type/marketplaceIds/时间窗必须与冻结状态一致，依据经校验的报告级 manifest 赋予行站点；不根据 SKU/ASIN 猜归属。不套用财务 seller-wide 范围。

## 官方契约与端点证据

| 操作/契约 | 版本、官方 URL 与结论 |
| --- | --- |
| FBA 报告类型与字段 | Reports **v2021-06-30**；https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba#fba-returns-report 。FBA sellers，可请求、不可 scheduled；TSV；日更新；原始 Return Reason/Disposition |
| createReport | **v2021-06-30**，POST `/reports/2021-06-30/reports`；https://developer-docs.amazon.com/sp-api/reference/createreport ；官方默认 0.0167 rps / burst 15 |
| getReport | 同版本，GET `/reports/2021-06-30/reports/{reportId}`；https://developer-docs.amazon.com/sp-api/reference/getreport ；默认 2 rps / burst 15；DONE/IN_QUEUE/IN_PROGRESS/FATAL/CANCELLED |
| getReportDocument | 同版本，GET `/reports/2021-06-30/documents/{reportDocumentId}`；https://developer-docs.amazon.com/sp-api/reference/getreportdocument ；默认 0.0167 rps / burst 15；返回有时效的 presigned URL，可选 GZIP |
| 请求与角色 | https://developer-docs.amazon.com/sp-api/docs/request-a-report ：报告需要有效应用/卖家授权和所需角色之一；FBA Returns 官方列 Pricing、Amazon Fulfillment。策略保存官方角色集合、校验至少一个已批准且已 attested 的匹配角色，不凭名称猜资格，不证明实际卖家必定可取报告 |
| 下载与 RDT | https://developer-docs.amazon.com/sp-api/docs/retrieve-a-report ；https://developer-docs.amazon.com/sp-api/docs/get-authorization-to-access-restricted-report-types 。仅 restricted report type 的 getReportDocument 需 RDT，resource path 必须具体到实际 documentId；报告始终需静态加密 |

FBA Returns 页列出的角色没有 restricted 标记，本次不在没有依据时为它强制申请 RDT；也不新增任意受限 reportType。P4 类型 allowlist 只接受已核验 FBA Returns，未核验/受限类型 fail closed；若未来需另一种受限退货报告，必须先核对官方角色与 Tokens 契约，按具体 GET/path 独立缓存 RDT，不能套用 Orders 已确认的免 RDT 规则。此阶段不新增 Tokens API 端点或假定测试其过期流程。

公开字段已核验：`return-date`、`order-id`、`sku`、`asin`、`fnsku`、`product-name`、`quantity`、`fulfillment-center-id`、`detailed-disposition`、`reason`、`status`、`license-plate-number`、`customer-comments`。官方字段清单没有给出所有字段的可空/日期格式/原因枚举承诺，适配器不臆造：必需列缺失阻止发布；未知原因/状态原样保留；日期有明确 offset 才直接转 UTC，其他格式按明确审批的解析策略处理，无法确定时报安全错误，不使用服务器时区猜测。

## 分步实施、文件与验收

| 步骤 | 预计文件 | 验收点 |
| --- | --- | --- |
| 4A TSV 与配置 | `src/lib/amazon-sync/returns.ts`；现有 `policy.ts`、`approval-policy.ts`；`src/lib/amazon/sp-api-client.ts` | reportType 从枚举/allowlist；窗口、回查、安全延迟、时区、轮询次数/退避、三操作预算走配置；文本/JSON 两种输出互不破坏；TSV BOM/CRLF/quoted tab/newline/编码/GZIP 有界处理；自由文本不进入普通 DTO；所有操作注释带官方 URL/版本 |
| 4B 落库及审批冻结 | `prisma/schema.prisma`、`prisma/migrations/20261105060000_amazon_returns_reports/migration.sql`；`service.ts`、`change-approval.ts`、`contracts.ts` | additive `AmazonReturnRecord`/原因维度与报告处理状态；幂等键包含 tenant/workspace/seller/marketplace/reportId/rowHash；`returnsPolicy`、窗口、授权/来源 revision/region/endpoint 冻结；新 resource cursor 保存已提交 watermark 与待处理 report/document/解析批次；原始文件密文留档 |
| 4C Reports 执行 | 现有 `processor.ts`、`service.ts`；复用现有 checkpoint/raw/log/budget/token bucket/lease/fence | create→poll→document→download/parse 全链路；一次有界操作/批次；HTTP 前与提交前四元组/权限检查；轮询 404 视为暂未就绪，计入次数/超时与退避，到上限失败保留状态；400/403 终止，429/5xx 有限重试；下载 URL 过期重新取 document metadata，不重新 create；create 成功响应丢失标不确定，停止并保留证据，禁止自动重复 create |
| 4D ERP 查询 | `returns-query.ts`、`src/components/operations/returns-workbench.tsx`；既有 sync-center route/workbench/read/snapshots | 服务端分页与 seller/site 权限；原因、ASIN、订单、状态和日期筛选；匹配 Orders 限同 tenant/seller/site，未匹配保留外部 orderId 不造订单；只展示选定报告/窗口，不把不同 reportId 重叠数据累加当独立退货事件；报告窗口成功不等于售后全量完整 |
| 4E 离线验证与交付 | `tests/fixtures/amazon/returns/*`、`tests/amazon-returns.test.ts`、`tests/integration/amazon-returns.integration.ts`、`tests/browser/amazon-returns.*`；既有 runner/package.json；README/AGENTS、P4 PR 草案/验收、spec tracking | `npm run test:amazon-returns:offline` 一条命令；完全离线 mock/临时 PG/Redis；正常/空报告/重复行/重放/分批中断恢复/404未就绪/轮询耗尽/429/500/403/单飞刷新/零HTTP越权/UTC/未知原因；回归原三链路和 Orders/Finance；迁移仅临时库 |

### 幂等与业务数量

`reportId + 行内容 hash` 是报告内幂等证据，不是跨报告唯一退货事件键。同一窗口重复申请产生不同 reportId 时，不据此全表累加数量；UI/查询以明确选定的一个有效报告为边界，不提供跨报告虚假合计。同一报告的完全相同行按照指定幂等键折叠，保留跳过数/重复质量标记；不能默认把它们认定为不同退货件。原因维度原始代码为事实，中文归类只能用配置映射，未映射明确展示。退款/退货/赔偿分别管理，不重复计账。

### 重入与 watermark

持续资源 cursor 保留 source/window、加密 state、reportId、documentId、原文 archive ID/hash、已处理行位置/批次；download 后先加密归档再按有界批次写事实，每批事实和行检查点同事务。重启从批次恢复，禁止再次 createReport。只有整份校验和解析完成才能推进成功水位；失败批次保留先前提交数据但 UI 不发布为完整报告。window 使用配置的初始时间/窗口/回查，不每次扫历史；`next_token` 对这种非分页 Reports 资源为空，报告处理状态使用附属加密 checkpoint，不伪造 Amazon nextToken。

## 影响、性能与回滚

涉及 additive Prisma、审批摘要、共享客户端和 processor，但只增加 returns 分支；旧销售 JSON API 保持兼容。下载/解压沿现有 16MiB 上限控制内存，解析额外限定行数/列长/单批行数，批量事务提交；不会把限流等待变成 worker sleep。报告轮询/下载/加密及索引会增加 DB/存储负担，生产最大文件及 P95 尚需容量审查；首版只审批有界窗口，不启用周期任务、自动回溯或大范围总表聚合。

回滚停用 returns source/入口并 fence 关联任务，保留密文报告、事实及游标；数据库只向前，不自动删表/清库。源/授权停用时级联停用退货任务。所有生产配置、数据库迁移、任务、保留清理、部署仍需单独审查。只扩展本阶段所需文件，不覆盖既有无关改动，不提交/推送混合工作区；P4 结束提供本地 PR 草案，真正拆分 PR/同步需先明确完整范围。

## 待人工确认

**已确认**：P4 只做上述 FBA 仓库已收退货报告；普通页面不展示 customer-comments 等自由文本，原件仅密文留档；按明确报告边界查询，不把不同报告叠加当跨报告去重事实；不启用 External Fulfillment Returns 或 Customer Feedback。

后续配置必须明确（本轮不读取真实配置）：站点与角色 attestation、初始窗口/回查、安全延迟、无 offset 日期格式/时区解释、原因业务映射、raw 保留/访问预算。没有配置时安全拒绝，不在代码里写死客户业务口径；原因未知原样保留。P4 实现完成后跑测试、输出逐条自检和剩余风险，再等待 P5 确认。
