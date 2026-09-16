# PPC Agent Evaluation

## Scope

PPC Agent evaluation 覆盖：

- 正常 PPC 诊断
- 高 ACOS
- 低 ACOS 扩量
- 高点击零订单
- 否定词建议
- Campaign 结构建议
- SellerSprite keyword seed
- Product Data context
- Sparse data
- Workspace scope
- Human Approval
- 越权拦截
- Amazon Ads dry-run execution plan

## Evaluation Cases

代码位置：

```ts
src/lib/agent-platform/ppc.ts
```

当前内置 12 个 evaluation cases：

1. `ppc-case-01` High ACOS diagnosis
2. `ppc-case-02` Low ACOS scale
3. `ppc-case-03` Negative keyword opportunity
4. `ppc-case-04` Campaign cleanup
5. `ppc-case-05` Sparse data
6. `ppc-case-06` No orders
7. `ppc-case-07` Product context aware
8. `ppc-case-08` SellerSprite aware
9. `ppc-case-09` Workspace scope
10. `ppc-case-10` Human approval bundle
11. `ppc-case-11` High risk campaign change
12. `ppc-case-12` Evidence trace

## Pass Criteria

每次评估至少检查：

- Agent 只能调用 `ppcAgentDefinition.tools` 中的工具。
- Tool permission 必须全部在 Agent permission matrix 中。
- 输出必须包含 `report`、`evidence`、`adjustmentDrafts`。
- Bid recommendation 必须包含 current bid、suggested bid、delta、confidence 和 evidence。
- Negative recommendation 必须包含 term、match type、confidence 和 evidence。
- Campaign recommendation 必须包含 recommendation、confidence 和 evidence。
- 高风险 Bulk / Amazon API action 必须产生 approval request。
- `bulk.export.prepare` 审批通过后，approved drafts 必须进入 workspace `pendingAdjustmentDrafts` 队列。
- 未审批前不得执行 Amazon Ads 修改。
- `amazon.ads.recommendation.plan` 必须通过 Tool Gateway 生成 dry-run plan。
- `amazon.ads.recommendation.apply` 默认必须被审批和配置门禁阻止。
- Trace 必须记录 decision、tool input、tool output、recommendation。

## Automated Tests

代码位置：

```ts
tests/ppc-agent.test.ts
```

覆盖：

- 工具面和 eval case 数量
- Agent -> Tool -> Permission
- Runtime 执行输出诊断、建议和 adjustment drafts
- 越权工具调用拦截
- approved PPC drafts 进入 workspace pending draft queue
- Amazon Ads adapter 安全生成 execution plan，并阻止未审批 apply

## Manual Evaluation

手动验证 `/agents/ppc`：

1. 进入 `/workspace` 导入 Bulk 和 Overall 数据。
2. 进入 `/agents/ppc`。
3. 输入目标 ACOS / ROAS / Margin。
4. 运行 PPC Agent。
5. 检查 Diagnosis、Opportunity、Bid、Negative、Campaign recommendations。
6. 发起 `Approve Bulk Handoff`。
7. 审批通过或拒绝。
8. 发起 `Approve Amazon API`，检查 Approval 卡片是否显示 Amazon Ads Plan 和 operations 数量。
9. 审批通过后进入 `/workspace`，检查待处理修改队列是否出现 PPC Agent 草稿。
10. 检查 Execution Timeline 和 Tool Calls。

## Known Limits

- 当前 Amazon Ads API 仍未执行真实写操作，但已有 dry-run execution plan adapter scaffold。
- 当前 PPC Adapter 使用 workspace 快照和本地分析逻辑；SellerSprite MCP / Amazon Ads API 的真实 adapter 应在下一阶段接入 Tool Gateway。
- Approved `bulk.export.prepare` recommendation bundle 会写入 workspace `pendingAdjustmentDrafts`，但仍需用户手动导出 Bulk。
