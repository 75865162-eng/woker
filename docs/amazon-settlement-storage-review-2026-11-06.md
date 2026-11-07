# 结算卖家级归档与站点归属：待批准的具体扩展

状态（2026-11-06 更新）：用户授权继续完善后，已实现 Prisma schema、增量迁移和本地执行链路，并在一次性隔离数据库验证。尚未向真实本机业务库执行迁移、修改采集配置或下载越范围结算原件。下文原拟议字段清单保留作审阅记录，以实际 migration/schema 为准。

实际迁移：`prisma/migrations/20261106070000_amazon_settlement_attribution/migration.sql`，新增两表及 `AmazonSyncDataSource.settlementPolicy`。卖家级原件引用既有加密 raw page；逐站查询沿用现有报告表作为派生投影，投影只写当前任务自己的来源，不让跨站任务绕过既有 source/run 外键。所有结算来源仍须分别运行，原件在卖家/区域/reportId 维度复用。

`collectionMarketplaceIds` 明确批准整份原件的采集范围；`archiveOnlyMarketplaceIds` 必须是其子集，允许单独审阅历史/未参与站点的加密归档，但不生成任何该站点的明细发布绑定。未知名称、缺失/冲突身份、不在绑定范围的行只保存 hash 和隔离原因。当前名称映射不代表已经核实真实原件格式。

12:57:18 UTC 的真实只读发现仍为 30 份报告，声明 9 个站点；当前参与验证返回 8 个，`A16F3NS8AD5QYS` 未验证。没有据此自动扩大真实采集范围。具体真实操作审批见交付记录新增段落。

## 真实证据与必要性

2026-11-06T11:49:47Z，本机独立联调授权的美国站 getReports 请求成功返回 30 份结算报告、无下一页；每份 metadata 均列 9 个 marketplaceId，全部包含现有四站绑定之外的站点。这是一个授权返回的多站报告，不能描述成九个 ERP 店铺。

现有 `AmazonSyncReportDocument` 唯一键为 organization/workspace/source/reportId，强制单站 marketplaceId；明细的复合外键也强制沿用该 source。它无法表达一份多站报告的唯一归档和未知归属费用。本轮保留该保护，增加明确的 SETTLEMENT_MULTI_MARKETPLACE 诊断；修正 89 天发现窗口和缺口记录，不宣称结算页面已恢复。

## 拟议 schema diff（另行批准后实施）

仅新增 `AmazonSettlementReport` 和 `AmazonSettlementRow`，不删除或改变已有四域报告表。对应可审阅 DDL 草案为 `amazon-settlement-storage-draft.sql`，位于 docs，未注册为 migration、未执行、未验证 SQL。以下为字段/约束清单，不是已应用迁移。

`AmazonSettlementReport`：

| 字段 | 类型/约束 |
| --- | --- |
| id | String 主键 |
| organizationId / workspaceId | String，不可空 |
| amazonSellerId / region | String，不可空；拒绝空 Seller ID |
| reportType / reportId | String，不可空；reportType 只允许现有结算类型 |
| authorizationId / authorizationRevision | String / Int；冻结来源，复合 FK 到现有组织/工作区授权 |
| sourceRunId | String；复合 FK 到同组织/工作区 AmazonSyncRun |
| reportMarketplaceIds | Json；真实报告声明，冻结后不可改 |
| collectionMarketplaceIds | Json；明确批准的原件采集范围，不由管理员角色隐式扩大 |
| siteBindings | Json；冻结 marketplaceId → sellerAccountId/sourceId/identityId 及版本，用现有真实绑定生成 |
| rawTaskId / rawPage | String? / Int?；指向唯一 AmazonSyncRawPage，沿用加密原件，不复制到各站 source |
| contentSha256 | String?；相同 reportId 内容冲突时阻断，不覆盖 |
| status | String；DISCOVERED / ARCHIVED / STAGED / PUBLISHED / BLOCKED |
| createdTime / capturedAt / publishedAt | DateTime? |

业务唯一键：`(organizationId, workspaceId, amazonSellerId, region, reportType, reportId)`；不把 authorizationRevision 放入业务唯一键，换凭证不能重复入账。另加 `(organizationId, workspaceId, id)` 复合唯一键供明细外键，以及 scope/status/createdTime 索引。

`AmazonSettlementRow`：

| 字段 | 类型/约束 |
| --- | --- |
| id | String 主键 |
| organizationId / workspaceId / reportDocumentId | String；复合 FK 到同组织/工作区 AmazonSettlementReport |
| rowNumber / rowHash | Int / String；唯一键 `(reportDocumentId, rowNumber)`，保留原始行身份，不跨报告累计成独立交易 |
| sourceId | String?；复合 FK 到现有同组织/工作区 source，仅在真实归属确认后赋值 |
| marketplaceId / sellerAccountId | String?；与 source/冻结 binding 在同一事务核对 |
| attributionStatus | ATTRIBUTED / MISSING_MARKETPLACE / CONFLICTING_MARKETPLACE / OUT_OF_SCOPE |
| businessDate / businessDateRaw / orderId / sellerSku / asin | 复用现有结算可查询字段的类型；均可空 |
| amountOriginal / currencyCode / transactionType / amountType / amountDescription | 复用原文字符串语义，不做 JS Number 汇总 |
| fields | Json?；仅 ATTRIBUTED 行允许写安全列白名单，未知归属行只留哈希/行号/原因，原文从加密归档受控读取 |

数据库 CHECK：ATTRIBUTED 必须具有 sourceId/marketplaceId/sellerAccountId；其他状态必须全部为空且不落普通查询字段。添加 scope/source/businessDate 索引。完整 Prisma diff 和迁移 SQL 在批准本扩展后生成并审阅；新表仅向前添加，不做现有数据回填。

## 执行与权限契约

1. 请求前验证当前有效用户、角色、授权 revision、真实 Seller ID、所有采集站点及任务审批。当前四站之外的 metadata 不授权下载原件。要读完整九站报告，必须先明确九站采集权限与业务目的；否则 BLOCKED，不隐式建立五个额外店铺。
2. 沿现有 scope lock/事务，通过业务唯一键认领报告；并发来源只共用同一 acquisition，不各自下载。断点只保存一个 raw 引用及解析 offset；先验证已有原件摘要，再继续处理。
3. 行内明确 marketplace-id 优先；marketplace-name 仅使用经核实的精确字典，不模糊猜测。相互冲突、未知、缺失归属费用隔离；不得按币种、SKU、发现请求的锚点站点默认归属。
4. 每批明细、offset 与状态在同一事务提交，并重新检查范围/版本。发布不等于所有行已归属；coverage 分开计数 attributed/quarantined，不标记历史完整。
5. 查询只返回 PUBLISHED + ATTRIBUTED 行，join 当前可见 source，保留组织/工作区/店铺/站点权限交集。隔离明细和完整原件只走另行批准的管理员审阅，不向普通站点页面/MCP 暴露。

## 性能、验证、回滚

复用当前分片预算、500 行批次和有界原件；无新增轮询。唯一键减少跨站重复获取；新增索引与批次归属查询有数据库开销，先用隔离临时库验证查询计划/并发锁与正确性，再评估真实 P95。批量读取冻结绑定，禁止逐行查库。

验收：多站并发发现只归档一次；重启/重试不重复发布；同 reportId 不同内容阻断；越权零下载；未归属数据不进普通 DTO；跨组织/工作区/店铺隔离；授权撤销和 revision 改变中断；日期窗口过期不推进游标。真实九站采集、现有库迁移、Worker 重启及任务恢复另列操作清单逐项批准。

回滚关闭新结算采集/读取入口，保留新表/原件/隔离记录，旧表读取保持可用。不得回退为把多站报告写入单站的实现，不删表、不迁移覆盖历史记录、不自动回滚数据库。
