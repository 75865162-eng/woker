# P3 财务交易：契约核验与实施计划（2026-11-05）

状态：用户已明确批准方案 A（卖家级采集、按真实站点落库、未知归属隔离）。P3 已在本地实现，离线验收见 `amazon-finance-p3-validation.md`；未应用真实配置或执行生产迁移。

## 当前边界与官方证据

现有 `finance` domain 是未实现入口；P1/P2 Orders 已具备逐页/逐单任务、审批冻结、resource cursor、raw 密文与 seller/app/operation token bucket。HTTP 仍在 `amazon/sp-api-client.ts`，service/processor 直接使用 Prisma，不新增 repository 框架。财务沿同一分层扩展，不改旧三条同步和订单语义。

| 契约 | 官方核验结果与来源 |
| --- | --- |
| 唯一新增业务端点 | Finances **v2024-06-19** `listTransactions`：`GET /finances/2024-06-19/transactions`；https://developer-docs.amazon.com/sp-api/reference/listtransactions |
| 交易唯一标识 | `Transaction.transactionId` 被官方定义为交易唯一标识，但 schema 中不是 required；缺失时不能臆造财务主键。默认整页校验失败且不推进游标，保留脱敏错误，由人工确认是否允许独立隔离策略 |
| 金额 | `totalAmount.currencyAmount → BigDecimal` 为 JSON **number**，`currencyCode` 独立。必须从 JSON 原始 number lexeme 无损解码成十进制字符串，不先经 JS Number；与 Orders 的 string Decimal 不同 |
| 分页 | `payload.transactions` 与 `payload.nextToken`；允许空页；后续请求必须保留原过滤参数，只改变 nextToken；无 token 才完成窗口，不用“空页”判断完成 |
| 日期 | `postedAfter` 包含边界，`postedBefore` 不含；起止均须早于请求至少两分钟；窗口不得超过 180 天。financial events 可能不含最近 48 小时的订单，postedDate 不是 updatedAt |
| 限流 | 默认 0.5 rps / burst 10，参数走策略配置；响应 `x-amzn-RateLimit-Limit` 有则校正；预算复用 seller/app/operation，不按站点拆分 |
| 角色 | 官方 Finances API 的 `Roles_finances_2024_06_19` 文档组件列明 **Finance and Accounting**；https://developer-docs.amazon.com/sp-api/docs/finances-api-v2024-06-19-use-case-guide （页面标题 Finances API）；https://developer-docs.amazon.com/sp-api/docs/roles-in-the-selling-partner-api#finance-and-accounting |
| 响应参考补充 | https://developer-docs.amazon.com/sp-api/docs/finances-api-v2024-06-19-reference （参考页提示部分响应显示技术问题，可结合 OpenAPI） |

以上为 2026-11-05 公开官方文档只读检查，没有 SP-API/LWA 请求、凭证或生产数据参与。当前官方 reference 的内嵌 OpenAPI `info.version=2024-06-19`；仓库原有 `docs/amazon-sync-center-phase0/official-model-evidence.json` 也记录此版本，旧 SHA 不冒充本次新下载的 SHA。

不新增 v0 `listFinancialEvents`。不实现 balances/summary 等额外端点，也不增加自动生产任务。

## 已确认决策：站点隔离与美国 MFN

官方 `listTransactions` 操作说明：查询美国 MFN 订单时应省略 `marketplaceId`。现有 `AmazonSyncDataSource`、权限与 cursor 都按 seller/marketplace 绑定，直接省略会扩大请求范围，不能把卖家级响应归入单一站点。

**方案 A（建议，完整性优先）**：增加显式卖家级财务采集范围，审批包含可访问站点集合；请求省略 marketplaceId。返回后核对 `sellingPartnerMetadata.sellingPartnerId`、metadata/marketplaceDetails 的站点归属，按真实归属写入交易事实；未知/缺失/冲突归属进入独立加密待处理记录，不伪造站点、不写订单表。采集审批仅限具备相应卖家/站点权限的操作者与审批人；若响应包含批准范围之外的数据，fail closed，不向当前站点查询面暴露。需明确卖家级采集权限与 raw 归档的访问边界，不用“管理员”自动替代范围审批。

**方案 B（范围优先）**：P3 只采用已绑定站点的 marketplaceId 过滤，保持现有权限契约；UI、coverage 和文档明确 **不保证美国 MFN 财务完整性**，不能称全部账务已同步。后续卖家级财务需独立阶段审批。

无论选择哪种方案，都不能硬编码美国 marketplaceId，须用已有站点 metadata/显式策略配置确定适用范围。用户明确选择方案 A 后实施上述范围，保留方案 B 仅作决策记录。

## 金额、汇率与时效口径

- 原始金额必须保留 wire lexeme（支持 JSON 指数表示），以 Decimal/NUMERIC 校验后存储；超精度拒绝，不静默舍入。CI 当前 Node 22；无损 JSON 解析实现需验证 Node 22 可用，不能仅依赖本机 Node 24 的行为。
- currency、原始金额、原币 NUMERIC、折算币种、折算金额、汇率原始字符串、来源标识/版本/有效期必须可追溯。汇率表来自审批后的配置，不硬编码供应商、汇率或隐含 1:1；缺汇率时保留原币事实，折算列为空并标记未折算，不把未折算记录算入折算汇总。
- `postedDate` 用于水位线，不是可靠更新版本。需要可配置安全延迟与重叠回查，承认超出重叠范围的状态更新可能遗漏。不能声称 posted watermark 已保证所有 DEFERRED → RELEASED 的后续变更；更大补偿窗口或业务重查需单独审批，禁止每次历史全扫。
- order_id 从 `relatedIdentifiers` 中真实 `ORDER_ID` 读取；无值允许 null 并独立分类。`transactionType`/status 保留原值，未知/null 标记待映射，不根据可能过旧的 enum 伪造状态。
- 同一 transactionId 的内容变更缺少 Amazon updatedAt，设计须使用受控采集顺序、审批版本与冲突证据；旧批次重放不得无条件覆盖较新采集事实。

## 文件级分步实施与验收

| 步骤 | 文件/边界 | 验收 |
| --- | --- | --- |
| 3A 适配器与策略 | `src/lib/amazon/sp-api-client.ts`；同目录命名延伸 `src/lib/amazon-sync/finance.ts`、`finance-rate-limit.ts`（仅现有 helper 不适用时新增），已有 `policy.ts`、`approval-policy.ts` | 单一 Finances 版本；从配置读取范围/窗口/预算/汇率；独立 Finance and Accounting 角色检查；无损 number lexeme 处理；不改变旧客户端响应解析 |
| 3B 持久化与范围 | `prisma/schema.prisma`；`prisma/migrations/<实施时间>_amazon_finance_transactions/migration.sql`；`service.ts`、`change-approval.ts`、`data-access.ts`（仅方案 A 所需） | 唯一键来自 transactionId，附 tenant/workspace/seller 隔离；独立财务表，订单关联可空；currency/原金额/NUMERIC/折算证据；方案 A 未归属行隔离；范围和配置进入审批冻结/版本检查 |
| 3C 增量执行 | `amazon-sync/processor.ts`、`service.ts`、`read.ts`、`contracts.ts`；复用 resource cursor/raw page/run log/token bucket/lease/fence | 每片一页，分页有界内存，逐页事务提交；raw 加密、事实 upsert 与游标推进同事务；重启从失败页继续；空页有 nextToken 必须继续；400/403/404 不重试、429/5xx 有限重试；解绑级联停用关联任务 |
| 3D ERP 读取与配置 | `src/lib/amazon-sync/finance-query.ts`、`src/components/operations/finance-workbench.tsx`；既有 `sync-center-workbench.tsx`、`src/app/api/operations/sync-center/route.ts` | 复用现有 UI 与权限，服务端分页/筛选/币种，展示未折算/未完整原因，不泄露 raw/token；配置先申请、批准与应用分离，不自动启动 |
| 3E 验证与交付 | `tests/fixtures/amazon/finance/`、`tests/amazon-finance.test.ts`、`tests/integration/amazon-finance.integration.ts`、`tests/browser/amazon-finance.*`、现有 offline runner、`package.json`、README/AGENTS、P3 验收/PR 草案 | 一条完全离线命令；正常/多页/空页/幂等/第二页失败恢复/错误/角色与范围零 HTTP/金额精度/UTC/未知 enum；回归 P1/P2 与旧三链路；迁移只用临时库 |

## 影响、性能与回滚

新增财务模型和运行路径涉及共享 processor、审批和权限范围（方案 A），用户已确认上述具体方案。只做 additive migration，不更改旧表业务含义。每次单页落库，响应设置大小/行数上限，最大页数与批准时间窗有界；大交易量增加 DB upsert、raw 加密归档和存储开销，暂不承诺生产 P95。默认逐次执行审批，不启用周期任务。汇率变更不自动重算历史，以版本留痕。

回滚为停用财务数据源/入口与 fence 活动任务，保留已采集 raw/cursor/facts；数据库只向前，不自动删表、恢复库或覆盖用户配置。生产 DDL 锁/存储预算须在发布审查单独评估。本次不执行迁移到真实库、GitHub 混合改动推送、部署或真实任务。

## 待人工确认

1. 已确认：采用方案 A 卖家级采集；只接受全部已验证参与站点的显式冻结集合，各站点须绑定同一 ERP 店铺。未知归属隔离，越批准范围整页拒绝。
2. 原始返回缺 transactionId 的默认处理：停止该页不推进（建议默认），还是允许另设加密隔离队列？不生成假唯一键。
3. 汇率来源/时间/版本、折算币种、精度和舍入口径；缺配置默认未折算。
4. 安全延迟、重叠补偿、DEFERRED 状态跨窗变化的复核口径；不将增量完整性等同最终结算。
5. raw/未归属数据的保留期、访问及存储预算；生产配置需单独审批。
6. 现有 dirty 工作区的 P1/P2/P3 分 PR 边界。当前不提交、打包或推送混合变更。

P3 完成后输出测试结果/变更摘要并等待确认，不自动进入 P4 退货。
