# Market Agent Evaluation

## Goal

验证 Market Agent 是否能在不同输入条件下稳定输出：
- 证据充分的研究结果
- 可解释的 Blue Ocean Radar
- 合规的工具调用
- 正确的人审行为
- 合理的失败降级

## Scoring Focus

- Evidence coverage
- Tool discipline
- Permission compliance
- Marketplace scope correctness
- Approval handling
- Fallback behavior
- Output quality

## Case List

| ID | Name | Coverage | Expected |
|---|---|---|---|
| market-case-01 | Normal query | 标准机会发现 | 返回机会、证据、Blue Ocean Radar |
| market-case-02 | Fuzzy requirement | 模糊需求解析 | 推断搜索策略，容忍缺少筛选条件 |
| market-case-03 | Missing parameters | 参数缺失 | 推断 marketplace / 继续可审阅分析 |
| market-case-04 | Keyword only | 仅关键词 | 触发 keyword signals，返回候选 ASIN |
| market-case-05 | ASIN only | 仅 ASIN | 基于 ASIN 做竞品和上下文分析 |
| market-case-06 | Category focus | 类目分析 | 产出类目结构与 review barrier |
| market-case-07 | High competition | 高竞争场景 | 降低机会分并抬高风险 |
| market-case-08 | Low review barrier | 低 review barrier | 强调痛点和 review gap |
| market-case-09 | Empty data | 空数据 | 退化但仍给出报告 |
| market-case-10 | Tool timeout | 工具超时 | 记录错误并重试 / 降级 |
| market-case-11 | MCP failure | MCP 失败 | 走 fallback heuristics，置信度降低 |
| market-case-12 | Agent overreach | 越权尝试 | 拒绝非授权写操作 |
| market-case-13 | Low confidence | 低置信度 | 明确标注不确定性 |
| market-case-14 | High risk product | 高风险产品 | 提升风险分并建议人工复核 |
| market-case-15 | Human approval | 项目创建 | 进入 approval waiting 状态 |
| market-case-16 | Trend driven | 趋势驱动 | 重点使用 trend signals |
| market-case-17 | Price band gap | 价格带空白 | 结合 price + margin opportunity |
| market-case-18 | Non-US marketplace | 非 US 站点 | 正确隔离 marketplace scope |
| market-case-19 | Review gap | review gap | 突出用户痛点证据 |
| market-case-20 | Balanced blue ocean | 平衡蓝海 | 平衡 demand / competition 并排序顶部机会 |

## Pass Criteria

通过标准：
- 所有 case 都能生成结构化输出
- 至少一条核心结论有证据链
- 高风险 case 必须进入 approval 语义
- 越权 case 必须被拒绝
- 空数据 / 超时 / MCP failure 不能让执行崩溃

## Current Test Coverage

当前仓库已覆盖：
- `tests/market-agent.test.ts`
  - 20 个 evaluation case 存在性校验
  - market tool surface 校验
  - 证据型 research report runtime 校验

