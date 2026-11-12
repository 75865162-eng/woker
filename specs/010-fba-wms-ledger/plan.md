# 实施计划与影响评审

用户范围澄清（2026-11-12）：只移植业务结构、关联和流程接入能力；具体核算主体、本位币、计价方法及估值范围、期间制度和报关模板由目标 ERP 的现有规则与配置决定。先复用目标端实现；缺少配置时保留待配置并阻止依赖执行，不为移植写死 Wimoor 默认值，也不以选择公司业务参数作为继续结构开发的前提。结构移植仍需保留目标端权限、事务、幂等、审计及数据完整性约束。

## 基线与问题定性

业务扩展与架构风险并存。复用[纠正版评审](../../docs/wimoor-integration/fba-wms-ledger-corrected-plan-2026-11-11.md)。此前文档的“未见总账模型”等结论已过时：当前 Schema 含 FinanceBook/Period/Subject/OpeningBalance/Voucher/VoucherLine，服务为 src/lib/finance/ledger-service.ts；不得重新建一套。

已读当前入口：src/lib/fba-local/service.ts、finance-draft-service.ts、src/lib/wms/domain-events.ts、event-bus.ts、event-dispatch.ts、event-consumers.ts、valuation-service.ts、src/lib/finance/ledger-service.ts、rules.ts 与 prisma/schema.prisma。仅为定向源码核对，无当前生产状态结论。

## 三阶段修改范围

| 阶段 | 复用入口 | 增量工作 | 验证 |
| --- | --- | --- | --- |
| 一：FBA | src/lib/fba-local/、src/lib/amazon-sync/inbound.ts、已有 operations 头程入口 | 逐操作能力矩阵；补现有计划/预占/发出与结果恢复缺口；费用、货件和报关保留明确来源；写 Schema 缺失项保持阻塞 | 现有 FBA 规则、装箱、货件关联、费用和报关用例；临时库 HTTP 并发、隔离和回滚 |
| 二：WMS | src/lib/wms/、WmsDomainEvent/WmsEventDelivery、WmsFinanceDraft/WmsCostEntry | 对照采购、调拨、盘点、冻结、退回与库龄逐项补业务闭环；补数据库事件恢复与成本交接；复用目标端计价合同，补成本结构与配置引用 | 原数量流程回归、事件重投/故障、成本缺失、在途一致、隔离；变更查询时验证分页/性能 |
| 三：总账 | src/lib/finance/ledger-service.ts、rules.ts、既有 finance-ledger API | 来源到正式草稿映射；AP/AR 核销与费用去重；结账真实证据；冲销幂等；目标端政策引用和对账阻断项 | 来源重复、请求冲突、双人审核、期间并发、借贷及子账核对、跨期更正 |

实施按小切片推进，每项代码变更先明确独立验收，不以本计划代表整个模块完成。外部 Inbound 写操作、库存容量/限制源和正式报关模板的合同证据是依赖项，不能以内部 XML 或 SDK 候选冒充。

## 已确认待处理风险

1. ledger-service.ts 的 close-period 原将 unreconciledDocuments 和 missingCostDocuments 固定为 0；页面原文已明确仅覆盖已登记账簿。本轮移除虚构的外部检查数，改用独立的 REGISTERED_LEDGER_ONLY 规则并在返回/审计明确 businessReconciliationVerified=false。完整业务关账仍需来源及期间/账套关联后取证。
2. reverse-voucher 命中幂等键直接返回既有记录，未比较请求和操作者；须校验原凭证、目标期间、来源、日期和请求身份，且合法重试不受已生成冲销状态影响。
3. 当前 WMS 成本按已批准的批次单位成本规则计价；不等于已经实现移动加权平均。扩展前需明确估值范围、资本化、负库存、晚到费用和跨期政策。
4. FBA 核算草稿使用 proposedSubjects，并明确 accountingConfigurationVerified=false；不能直接跳过正式科目/期间校验提交总账。

## 影响、回退与验证边界

目标是当前本地工作树及隔离资源。将影响 FBA/WMS/Finance 的共享模型、来源引用、事件和 API 行为；正式 Schema 与迁移按切片给出。保留租户及 ProductRecord，不改变根环境、Worker 注册/启动或导航。若后续需要改权限、公共 Layout 或导航，先独立列影响并按规则做性能基线。

回退：停止本次新增动作/消费者的投递和执行，保留已提交单据、流水、事件及凭证；以正式更正动作处理业务事实，不删账、不反向迁移、不假定代码回退可撤销真实出库。

验证：先读 runner；规则测试不加载环境，集成仅使用显式创建的临时资源并剔除真实凭据；每切片运行相关测试、定向 lint 和 typecheck，跨模块最终 check:fast；准备合码才完整 check。真实 Amazon、现有库迁移和发布不在本次授权推导范围。

Spec Kit CLI：本次执行 specify workflow run 返回 command not found，未安装或初始化工具；手动保存 spec → plan → tasks → validation 链路。未改动已有 .specify/feature.json 指向，避免覆盖其他任务。

## 首批实际交付

FBA/WMS 域内来源查询、统一财务交接 API/服务、总账来源预览及正式科目映射界面已实现；复用现有表，无 Schema/迁移/Worker/权限目录/公共导航改动。提取原创建凭证事务供手工和来源交接复用，修复嵌套分录持久化、关闭期间新建凭证及冲销重试冲突；凭证显示使用精确求和。详见[交付记录](../../docs/wimoor-integration/three-stage-delivery-2026-11-12.md)。

完整三阶段中在线 Inbound、移动加权平均、AP/AR 与全部来源业务关账仍未完成，不以本轮交接闭环替代。
