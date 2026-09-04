# Listing Agent Evaluation

## Coverage

代码内已生成 10 个 evaluation cases，覆盖：
- 正常 handoff
- 缺少 product report
- keyword heavy
- competitor heavy
- title focus
- bullet focus
- description focus
- A+ focus
- low confidence
- human approval

## Evaluation Signals

每个 case 关注：
- 是否正确读取 product handoff
- 是否生成 keyword map
- 是否生成 title
- 是否生成 bullets
- 是否生成 description
- 是否生成 A+ brief
- 是否在高风险动作前进入审批
- 是否保留 trace / evidence / memory

## Expected Runtime Behavior

Listing Agent 必须：
- 只通过 Tool Gateway 调用工具
- 不能绕过权限系统
- 不能把 synthetic adapter 输出当作真实 keyword truth
- 所有关键判断都必须有证据
