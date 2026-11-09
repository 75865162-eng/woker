export interface BriefField { value: string; sourceText: string }
export interface ResearchBrief {
  originalRequirement: string;
  marketplace: string;
  productDirection: BriefField | null;
  targetAudience: BriefField | null;
  procurementQuantity: { value: number; sourceText: string } | null;
  targetPrice: BriefField | null;
  costConstraint: BriefField | null;
  depth: BriefField | null;
  unresolved: string[];
}

/** Conservative intake only. Ambiguous or absent constraints remain unknown; original text is authoritative. */
export function parseResearchBrief(requirement: string, marketplace: string): ResearchBrief {
  const field = (pattern: RegExp): BriefField | null => {
    const matches = [...requirement.matchAll(pattern)];
    const values = new Set(matches.map(match => match[1].trim()));
    return values.size === 1 ? { value: matches[0][1].trim(), sourceText: matches[0][0] } : null;
  };
  // Explicit labels win. Never interpret a Skill name or prose mentioning research as a product.
  const labeled = [...requirement.matchAll(/(?:产品方向|产品大方向|product direction|starting direction|我想做的方向是)\s*[:：]\s*(?:【([^】]+)】|([^，,；;。\n.]+))/gi)];
  const directions = new Set(labeled.map(match => (match[1] ?? match[2]).trim()));
  const productDirection = labeled.length
    ? directions.size === 1 ? { value: [...directions][0], sourceText: labeled[0][0] } : null
    : /amazon-[a-z-]+|tariff-calculator-amazon/i.test(requirement) ? null
      : field(/^(?:research)\s+([^，,；;。\n.]+)[.]?$/gi) ?? field(/(?:研究)\s+([^，,；;。\n]+)/g);

  const targetAudience = field(/(?:目标用户|目标人群|target audience)\s*[:：]\s*([^，,；;。\n]+)/gi);
  const quantity = field(/(?:采购数量|采购|首批|purchase quantity)\s*[:：]?\s*([0-9]+)\s*(?:件|个|套|units)(?![A-Za-z])/gi);
  const numericQuantity = quantity ? Number(quantity.value) : null;
  const procurementQuantity = quantity && Number.isSafeInteger(numericQuantity) && numericQuantity! > 0 ? { value: numericQuantity!, sourceText: quantity.sourceText } : null;
  const targetPrice = field(/(?:目标售价|目标价格|target price)\s*[:：]?\s*([^，,；;。\n]+)/gi);
  const costConstraint = field(/(?:成本约束|成本上限|target cost|cost limit)\s*[:：]?\s*([^，,；;。\n]+)/gi);
  const depth = field(/(?:研究深度|research depth)\s*[:：]\s*([^，,；;。\n]+)/gi);
  const values = { productDirection, targetAudience, procurementQuantity, targetPrice, costConstraint, depth };
  return { originalRequirement: requirement, marketplace, ...values,
    unresolved: Object.entries(values).filter(([, value]) => value === null).map(([key]) => key) };
}
