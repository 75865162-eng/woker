# P5：统一调度、观测与运维收口计划

状态：2026-11-05 用户已明确确认5A—5D方案并要求继续完工，现已完成本地实现和离线验收。沿用 `50ren-erp-pm` 和 `specs/004-amazon-operations-hub/` 追踪；结果见 `amazon-sync-p5-validation.md`。本文件下文保留实施前的核对、设计与影响说明；不授予生产变更或真实任务权限。

## 问题定性与现状证据

这是新三类增量资源的运维一致性收口，P2级开发风险；未访问真实数据，不能推断已有生产故障。P4最后一次 `test:amazon-sync:offline` 为84单元+116数据库集成+7浏览器通过，核心763、类型/lint记录沿用P4验收。

- `scheduler.ts tickSyncCenter` 已从数据库恢复dispatch intent、检查执行截止时间和应用审批，使用dispatchVersion及lease fence抵御旧队列投递；不根据source/plan自动授予执行权。
- `processor.ts` 已为Orders/Finance/Returns复用client LWA单飞、持久预算/令牌桶、RequestId日志、400/403终止及429/5xx有界重试。三资源分别保存持久cursor、raw密文和幂等事实，无需新框架或HTTP客户端。
- scheduler租约过期/审批阻断以及processor暂停/取消/执行前阻断主要改run，未在全部分支同步更新incremental cursor.status；可能出现run终止但cursor仍RUNNING。数据页/nextToken/报告offset未因此自动清空，但运维状态会误导。
- 通用catch将三资源的SyncInputError都标为ORDER_VALIDATION/ORDER_ROLE_OR_SCOPE。需要给Finance/Returns准确的资源错误码，并保持既有Orders错误码兼容。
- taskSummary已有时间/请求/写入/跳过/失败/429指标和资源窗口；source列表尚未提供统一安全cursor进度。受限报告原件、nextToken和checkpoint不得通过运维DTO输出。
- `maintenance.ts` 明确保留策略不等于清理授权，当前不执行自动删除。secret180天轮换、年度重新授权已有文档，仍缺一份跨三资源的实际值班与恢复指引。

## 先列出的契约差异 / 不改变的上线行为

1. **统一调度与自动采集不同**：当前逐次批准、24小时执行授权；本计划保持此边界。开放定时历史窗口/持续采集会扩大授权与API预算，需独立范围批准，不能把本次“继续”视为无限期执行许可。
2. **字段映射沿用既有模型**：原始要求cursor的seller_id/next_token，对应现有amazonSellerId/nextTokenCiphertext；run_id/起止/请求等对应AmazonSyncRun及AmazonSyncTaskLog。不得为了字面名称新增平行表或明文token。Reports没有nextToken，以加密report/document/archive/offset状态恢复。
3. **403/400告警采用现有站内任务错误/结构日志**：增加可读、非敏感的处理提示；不新接邮件、Slack或外部告警平台，也不发送消息。外部值班渠道与阈值待人工选择。
4. **旧三链路保持原行为**：Listings/FBA库存/销售日报的调度、JSON返回、预算键、报告轮询和手动重试不改。此次状态同步仅适用于Orders/Finance/Returns，现有队列名/worker默认模式不改。
5. **raw重放和密钥运维**：保留既有可重入恢复，不开放任意密文下载、人工重放入口、自动轮换、自动保留清理或解密导出。未知创建报告结果仍人工核查，不自动重新create。
6. P2免RDT及P4非restricted报告契约、P3卖家级采集与未知站点隔离、单报告退货统计均沿用已批准决策，不另改业务口径。不新增Amazon端点。

## 分阶段文件级实施与验收

| 步骤 | 文件 | 具体变更与验收 |
| --- | --- | --- |
| 5A 调度状态闭环 | `src/lib/amazon-sync/scheduler.ts`、`processor.ts`、`service.ts`；必要的纯状态分类放现有 `policy.ts` | 对新三资源的租约过期、审批过期/撤销、暂停/取消、手动retry和执行前阻断，在run变更的同一transaction/锁中更新归属该run的未完成cursor状态；拒绝覆盖另一run或SUCCEEDED游标。保留watermark/密文token/listComplete/reportState/成功水位。过期worker不能继续提交；正常恢复不重新扫历史。旧三资源分支行为保持兼容 |
| 5B 安全观测 | 现有 `read.ts`、`contracts.ts`、`processor.ts`、`src/components/operations/sync-center-workbench.tsx` | source可选增量进度DTO只含resource/窗口/status/lastSuccessAt/updatedAt及是否可继续，不含token、密文、offset内部原件ID、raw或PII。给Finance/Returns独立失败码，保留Orders旧码；任务页/质量页呈现过期审批、有限重试耗尽、需人工核查等提示，不改变事实完整性定义。保持现有tenant/seller/site/grant过滤，无新公开route |
| 5C 离线契约回归 | `tests/integration/amazon-sync-lifecycle.integration.ts`（新）、`tests/amazon-sync-center.test.ts`（必要专项）、既有browser测试和fixture、`scripts/test-amazon-sync-integration.mjs` | 注入fixture/可控时间或调整临时调度字段，逐资源验证lease过期与重入、审批过期/撤销、pause/resume/cancel/retry、重复dispatch/旧fence、跨runcursor保护、DTO隐私/权限及错误码。使用临时PG/Redis+mock，无sleep、无真实域名/凭证。新专项纳入现有 `test:amazon-sync:offline`，不引入依赖或独立调度框架 |
| 5D 文档交付 | README、AGENTS、`docs/amazon-sync-p5-operations.md`、`docs/amazon-sync-p5-pr.md`、`docs/amazon-sync-p5-validation.md`、`specs/004-amazon-operations-hub/sync-p5.md` | 统一现有表/字段映射、资源角色与预算、freshness与业务完整性区别、401/403/429/5xx/lease/报告创建不确定的处理、180天secret轮换/年度重授权、保留和恢复限制、回滚与发布门槛；逐条自检和待人工清单。先本地PR草案，不擅自提交混合工作区 |

## 全局/性能影响与回滚

- 影响共享scheduler/processor/service的**新三资源分支**及安全DTO/UI，属于全局影响，按仓库AGENTS先确认本文件再改代码。无需schema变更、migration或依赖变更。
- 每次状态迁移最多增加一次有tenant/source/activeRunId条件的cursor update；source列表使用现有source-resourceCursor关系一次select/include，避免逐source N+1。无新增轮询、长sleep、全表扫描、定时任务或额外Amazon调用。该DB开销仍需通过fixture专项观察，不将临时库数据宣称为生产P95承诺。
- 锁顺序沿用scopeLock/fence，不改变HTTP期间事务边界。run条件更新成功后才更新cursor，防止旧worker/过期scheduler修改别的run进度。
- 回滚应用代码至P4；保留所有事实、游标和密文证据，不执行数据回退。若真实启用时需停用绑定，仍走独立审批与既有取消fence；本地测试不触碰真实绑定。

## 验证路线

先新生命周期专项及类型检查，再 `npm run test:amazon-sync:offline` 全资源离线回归；核心测试、全仓lint（显式排除既有 `.next-amazon-live/**`）和 `git diff --check` 完成开发检查闭环。只有代码更改带来新风险才重复同类验证。完整生产构建/Node22 CI/生产迁移审查属于后续合码发布门槛，本阶段不运行真实账号E2E、worker入口、部署、真实API或凭证轮换。

## 待确认范围

用户已确认上述5A—5D的共享状态/DTO影响：**沿用逐次批准的有界任务，补齐run↔cursor状态一致性、站内可读提示和运维文档，不开放自动定时采集、不增加外部告警通道、无需新迁移。**

后续独立人工事项：持续调度执行授权模型；告警渠道/责任人/SLA；真实站点初始窗口/预算/角色；FX来源和退货日期/原因口径；raw保留及解密访问预算；Node22 CI、PR拆分/完整改动区GitHub同步与生产变更审批。
