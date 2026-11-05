# Orders P2 详情实施追踪

问题定性：订单详情核心能力扩展，同时发现授权契约冲突和 P1 raw 敏感性标记不准确。沿用既有 Orders v2026-01-01 模型、审批和 job，不改旧三条同步链路。

## Spec

用户明确批准按新版官方契约继续：LWA + 已批准 restricted roles，Orders 不申请 RDT。P2 在本地实现并通过隔离测试；没有触及真实配置、凭证、API 或生产。

## Plan

具体文件、官方 URL、性能影响、回滚和验收见 `docs/amazon-orders-p2-plan.md`。按 2A 契约/审批 → 2B 同模型迁移 → 2C 分片恢复 → 2D 离线验收推进。P2 结束等待用户确认，不开始 P3。

## Tasks

- [x] 核实 getOrder v2026-01-01 的实际参考页与金额 string 模型。
- [x] 核实官方 PII 授权说明，列出 RDT 冲突和 P1 FULFILLMENT 敏感性风险。
- [x] 输出文件级实施、影响、回滚与离线验收计划。
- [x] 用户明确决定新版 Orders PII 授权方式。
- [x] 修正 P1 标记并扩展审批/策略。
- [x] 同订单模型的详情持久化和增量迁移。
- [x] getOrder 分片、预算与恢复。
- [x] 完全离线测试与验证记录。
- [x] P2 本地 PR 草案；推送等待完整脏工作区分界审阅。

## Validation / Remaining Risks

验证与剩余风险见 `docs/amazon-orders-p2-validation.md`。没有访问真实业务接口/凭证、生产数据库/配置，也未创建自动任务。财务与退货不属于 P2。原始敏感报文仅加密存储，保留期和访问维护策略须在 P5 前确认。
