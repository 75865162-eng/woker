# Supplier Agent Evaluation

## Coverage

代码内已生成 10 个 evaluation cases，覆盖：
- 正常 handoff
- 缺少 PRD
- 模糊 sourcing brief
- 成本压力
- 交期压力
- 类目约束
- 报价对比
- 低置信度
- project approval
- 非 US marketplace

## Evaluation Signals

每个 case 关注：
- 是否正确读取 product handoff
- 是否生成 supplier shortlist
- 是否生成 quotation analysis
- 是否生成 RFQ draft
- 是否生成 sourcing project draft
- 是否在高风险动作前进入审批
- 是否保留 trace / evidence / memory

## Expected Runtime Behavior

Supplier Agent 必须：
- 只通过 Tool Gateway 调用工具
- 不能绕过权限系统
- 不能把 synthetic adapter 输出当作真实供应商事实
- 所有关键判断都必须有证据
