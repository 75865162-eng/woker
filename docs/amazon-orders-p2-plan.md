# 订单详情 P2：官方契约与实施计划（2026-11-05）

状态：**用户已批准按新版契约继续；P2 已在本地实现并离线验收。** Orders 使用 LWA + 已批准角色，不申请 RDT。本文沿用 `50ren-erp-pm` 的 spec → plan → tasks → validation 追踪，在现有 Operations Hub 边界内扩展。

## 官方依据与必须先确认的冲突

仅查阅公开官方文档；未调用 SP-API/LWA 业务接口、未读取真实凭证、未启动同步或生产迁移。

| 官方页面 | 版本 / 核验结果 |
| --- | --- |
| https://developer-docs.amazon.com/sp-api/reference/getorder-3 | Orders v2026-01-01，`GET /orders/2026-01-01/orders/{orderId}`，默认 0.5 rps / burst 30；不是旧版 `/reference/getorder` |
| https://developer-docs.amazon.com/sp-api/docs/access-orders-pii | 明确说明 Orders v2026-01-01 访问 PII **不需要 RDT**；字段可见性取决于角色、履约方式、国家和状态 |
| https://developer-docs.amazon.com/sp-api/docs/get-order-information | 同样说明新版无需 RDT；`includedData` 控制扩展数据集；基础响应本身包含 `orderItems` |
| https://developer-docs.amazon.com/sp-api/docs/orders-api-migration-guide | 新版模型和字段结构不同，不能套用 v0 订单模型或 Tokens 资源路径 |

上述页面于 2026-11-05 查阅。getOrder 参考页内嵌 OpenAPI 的 `info.version` 为 `2026-01-01`，`Decimal` 定义为 string，`Money` 由 `amount` 和 `currencyCode` 组成。链接是公开文档地址，不是测试请求目标；新增测试只访问本地 mock。

原任务要求所有订单 PII/明细必须走 RDT，与新版官方契约冲突。两种选择：

1. **按新版契约继续（建议）**：LWA + 所需已批准角色；PII 加密、用途/范围审批及访问控制；Orders 不申请 RDT。后续 Reports 的受限文档 RDT 仍按其独立官方契约处理。
2. **保留原 RDT 硬要求**：暂停 P2；不构造没有官方依据的新版 Tokens 路径，也不切回 v0。

用户明确选择方案 1：按新版契约继续。P2 不实现 Orders RDT；详情调用只使用 LWA 及已批准角色。Reports 受限文档的 RDT 留待 P4 按 Reports 官方契约核验。

## P1 发现的修正项

`includedData=FULFILLMENT` 不能被标记为“无 PII”：官方 PII 清单包括商品礼品留言；商品定制 URL 也是敏感字段。P1 事实解析器只提取白名单基本字段，raw 已整体加密且未开放普通读取；但这不能证明上游响应没有 PII。

现有代码两处已修正：

- `src/lib/amazon/sp-api-client.ts` 的 “non-PII FULFILLMENT” 注释不准确。
- `src/lib/amazon-sync/processor.ts` 的 `piiCollected:false` 无法由请求数据集或解析白名单证明。应改为分别表达“事实表未提取 PII”与“加密原始报文可能含 PII”；先盘点消费方，保持覆盖信息接口兼容，不能把未知冒充为 false。

P1 raw 的业务事实白名单仍不包含 PII；新 coverage 字段将事实表采集与 raw 潜在 PII 分开。无需、也不得读取真实 raw 报文来证明风险。

## 影响、性能与回滚

P2 会扩展订单模型、审批冻结范围和 processor 分片，不改变 Listings、FBA 库存、日报或 ProductRecord 事实源。每个列表命中订单最多增加一次正常详情请求及对应受限重试、短事务和加密证据写入；0.5 rps 的持续预算约 1,800 次/小时，不能承诺积压立即追平。调用上限、订单数、数据集和预算必须进入审批范围，详情任务不能绕过现有租约/围栏。

回滚以停用详情策略/入口、停止对应已批准任务为主，保留已写入事实与加密证据；迁移只向前，不自动删表、回退数据库或重放生产数据。P2 运行开关与现有 P1 列表行为兼容，旧 source 不自动升级为详情采集。实际部署、配置应用、迁移和任务执行均不在本次授权范围内。

## 分步实施、文件与验收

以下步骤属于一个 P2 交付阶段，P2 完成后停下等待下一阶段确认，不提前接入财务/退货。

| 步骤 | 计划改动文件 | 验收点 |
| --- | --- | --- |
| 2A 契约、安全分类与审批 | `src/lib/amazon-sync/orders.ts`、`contracts.ts`、`approval-policy.ts`、`change-approval.ts`、`service.ts`；`src/lib/amazon/sp-api-client.ts` | 修正 P1 敏感性标记；新增显式详情数据集、用途、角色和预算配置；冻结范围并校验租户/seller/marketplace/region/revision，失败零 HTTP；配置角色仍标明管理员 attestation，不冒称 Amazon 实时验证。PII 可见性还受履约方式/站点/状态影响，attestation 不代表 Amazon 保证字段可见 |
| 2B 同一订单模型扩展 | `prisma/schema.prisma`；`prisma/migrations/20261105040000_amazon_order_details/migration.sql`；`orders.ts` | 扩展 `AmazonOrderRecord`，不另建 v0 模型；明细按订单/`orderItemId` 子关系幂等；金额保留原始字符串与 currency，以 NUMERIC(65,30)/Decimal 写入；不经 Number/float；超精度直接拒绝；UTC 与站点时区分开；敏感详情仅密文，无普通 GET/UI 明文输出 |
| 2C 详情分片与恢复 | `sp-api-client.ts`、`amazon-sync/processor.ts`、`service.ts`、`orders-rate-limit.ts`、`read.ts`、`orders-query.ts` | 同一 orders job 内持久化待处理详情版本，每片一单；复用 seller/app/operation 预算与响应头校正；列表页提交同时登记待补齐单，详情成功与完成标记同事务；中断只重试待处理单，不重扫历史；旧列表响应不覆盖较新详情；列表完成与详情完成分别呈现 |
| 2D 离线测试与交付 | `tests/fixtures/amazon/orders/`、`tests/amazon-orders.test.ts`、`tests/amazon-sp-api-client.test.ts`、`tests/integration/amazon-orders.integration.ts`；按输出变化补 `tests/browser/amazon-orders.spec.ts`；`scripts/test-amazon-sync-integration.mjs`、`README.md`、`docs/amazon-orders-p2-validation.md`、`docs/amazon-orders-p2-pr.md` | 一条离线命令覆盖正常路径、幂等、分页后详情恢复、错误/授权分支和金额时区；文档附官方版本/URL、取舍、容量与回滚；只生成 P2 PR 草案，工作区分支/混合改动经审阅后才提交推送 |

精度策略定为 NUMERIC(65,30)：API Decimal 字符串保留原样，超出 35 位整数或 30 位小数的金额在写入前拒绝，数据库等值约束防止静默舍入。金额业务口径也必须区分订单 `proceeds.grandTotal`、商品 `proceeds.proceedsTotal` 与商品价格，不凭名称推断可加总关系。

详情结果要再次校验 `orderId` / `salesChannel.marketplaceId` 与冻结范围。PII 数据集不因管理员通用角色存在而自动全开；字段缺失可代表 Amazon 可见性限制，不伪造姓名/地址，也不将业务字段 null 一概当模型过旧。未知枚举保留原值并独立标记内部未映射。

当前执行细节：先提交列表页及待处理版本，再在同一 job 内优先完成这些详情后继续下一列表页；最终列表页与详情全部完成才推进 `lastSuccessAt`。`detailsCompletedCount` 独立于列表行计数。详情 raw 用 `AmazonSyncRawPage` 的 operation 元数据区分，archive ordinal 从 1001 开始，列表页仅为 1—1000；这不是额外列表分页。恢复新 run 时仍从未完成窗口的 pending work 继续。已完成但相同版本/相同详情策略的订单不再重复 getOrder。

详情策略由 source revision 与冻结副本共同保护；未完成窗口禁止更换策略。基础商品标识/数量/proceeds 保存在明细子表，定制 URL、礼品留言、买家/收件人等未知字段只在加密 envelope 中。UI 展示 `proceeds.grandTotal` 原始字符串，金额不做自动汇率转换或和商品价格推断求和。当前不提供 PII 明文读接口。

测试不代表生产 P95 已验证。迁移为新增表/列/唯一索引，生产 DDL 的锁与容量预算仍须在发布审查时单独核查；不得直接对真实环境执行测试迁移。client secret 每 180 天轮换、refresh token 按年度重新授权的既有运维保守口径继续生效。

## P2 测试矩阵

- fixture 为仓库内人工合成数据；mock host 使用 `.invalid` 或 loopback，无实际 Amazon 域名/凭证作为测试请求；公开参考 URL 只出现在注释/文档。
- 临时 PostgreSQL/Redis、测试专用加密密钥、临时 storage；runner 不继承 dotenv/真实配置，外网 guard 默认拒绝；clock/sleeper 可注入，新增用例无真实 sleep。
- 正常详情、多个列表页/多个待处理单、第二单失败重启、同版本重放、过期响应/并发版本冲突、跨租户/站点隔离和停用围栏。
- 400/403 不重试，429 带抖动退避，500 有界重试；详情 404 与 Reports 未就绪 404 独立处理，不跨资源套用策略。
- access token 过期刷新、跨客户端实例进程内单飞；角色/区域/卖家/站点不匹配零 HTTP。按新版方案不添加虚构 Orders RDT 测试，Reports RDT 到 P4 独立验证。
- 原始金额字符串和 Decimal 精度、UTC 偏移转换、未知/null 状态、缺失可选敏感字段；搜索日志/错误/普通查询响应无 fixture token/PII，DB 敏感字段仅密文。
- 单命令沿用 `npm run test:amazon-orders:offline`；随后按 API/Prisma 风险运行相关回归、类型/源码 lint 和临时库 migration 验证。不运行真实同步、生产迁移、部署或线上页面。

## 待人工确认

**用户已确认**：按新版官方契约采用 LWA + 已批准 restricted roles，不为 Orders 申请 RDT。剩余业务口径仍默认关闭，不阻断 P2 代码路径。

其余项先保持默认不启用，禁止替用户填写真实配置：

- 生产绑定应只选必要数据集，并按官方 PII guide 核对角色、FBA/FBM、国家、状态的逐字段条件；业务负责人仍需确认是否实际需要买家/地址，不默认全量采集。
- PII/raw 的保留期、可访问角色、删除/留存要求；没有批准前无明文显示或导出入口。
- 金额采用哪组 API 字段作为 ERP 展示口径，精度与币种规则。
- 每次批准的最大订单数/调用预算，以及列表完成与详情完整的业务展示定义。
- 现有未提交改动的 P1/P2 PR 分界；本次不自动打包、推送其他聊天改动。
