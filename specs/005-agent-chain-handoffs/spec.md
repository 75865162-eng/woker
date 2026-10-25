# Feature Specification: Round C Agent 全链交接

**Created**: 2026-10-25
**Status**: Approved for P0 implementation
**Input**: 复用 Agent Runtime 与 Orchestrator，打通六段版本化交接与 Launch/PPC 审批边界。

## User Scenarios & Testing
### User Story 1 - 交接继续工作 (Priority: P1)
运营从 Orchestrator 打开下一站，或从业务 Agent 确认交接，接收页加载目标、站点和已有业务报告。
独立验收：Market→Product→Supplier→Listing→Launch，payload 可校验且保留来源执行链接。
### User Story 2 - Launch 控制 PPC (Priority: P1)
负责人复核 Launch 后批准，PPC 才接受该全链任务。
验收：客户端勾选、篡改审批 ID、跨组织/工作区、拒绝或过期审批均不能解锁；真实批准后可诊断建议。
### User Story 3 - 选品工具如实暴露缺口 (Priority: P2)
Market 可请求 selection 工具，读取已上传且按组织/工作区隔离的 Round B 实际草稿，返回可交接的证据报告；无 fileId 时明确后台实时采集未实现，不生成虚假机会。上传限 2 MB，fixture、未知版本和非法来源拒绝；缺失指标/商业机会分为 null，证据完整度独立表示。
### Edge Cases
旧版交接可降级读取；未来版本、损坏数据、身份/工作区不匹配显示错误；存储失败不跳转。切工作区废弃已加载交接。独立 PPC 诊断继续可用。

## Requirements
- FR-001: 六类交接必须版本化并校验目标、来源、身份范围和数据结构。
- FR-002: 现有 StorageKey 继续使用，仅承载当前设备导航交接，不成为多人事实源。
- FR-003: Orchestrator 只编排；不得获得业务写工具。
- FR-004: Launch 决策复用既有 Approval；PPC 服务端校验组织、工作区、动作类型、计划与审批执行。
- FR-005: 广告执行继续走已有独立审批；Launch 批准不等于已上架或授权广告花费。
- FR-006: SKU 仍由 POST /api/products 与 /dashboard 管理；本期不新增建 SKU 路径。
- FR-007: 来源 execution 必须可导航追踪；旧交接无法证明来源时如实标记。
### Key Entities
Opportunity / PRD / SupplierShortlist / ListingDraft / LaunchTicket / PpcPlan；现有 AgentExecution 与 AgentApproval 为持久化记录。

## Success Criteria
- SC-001: 六个入口都能消费交接，并保留已有业务页功能。
- SC-002: 全链 PPC 在无有效 Launch 审批时全部拒绝。
- SC-003: 所有新增边界测试、核心回归、lint、类型检查通过。

## Assumptions
P0+ 自动顺序 execution、Round B 真采集、SP-API 上架与真实 Ads transport 不在本期。每次业务交接点击代表人工复核草稿；高风险写入仍需持久化审批。

### Round B 供应线索增量
Supplier 消费 Product 保留的 selectionSource，展示未经核验的 1688 线索，未知价格/联系人/交期不得模拟；空短名单阻止 UI 交接，异常停止生成；人工审阅后原报告传到 Listing。不得发送询价、采购或改正式商品。
