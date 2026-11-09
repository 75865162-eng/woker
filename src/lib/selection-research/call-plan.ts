/** Planning estimates for one marketplace, selecting one niche and reviewing 3–5 competitors.
 * Not a supplier quote, observed usage or a hard ceiling. */
export const researchCallPlan = [
  { skill: "amazon-niche-finder", min: 8, max: 10, basis: "挖词、验证需求、筛选3–5个细分市场" },
  { skill: "amazon-product-research", min: 6, max: 10, basis: "研究一个选定市场及头部竞品" },
  { skill: "amazon-review-analyzer", min: 4, max: 8, basis: "获取3–5个竞品差评，必要时补页" },
  { skill: "tariff-calculator-amazon", min: 0, max: 0, basis: "通常复用已有市场数据；税率证据和报价另行核实" },
  { skill: "amazon-product-selection", min: 0, max: 2, basis: "评分、利润及压力测试优先复用已有数据" },
] as const;
