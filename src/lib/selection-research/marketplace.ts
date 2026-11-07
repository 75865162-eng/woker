const sites = [
  ["US", "美国"], ["CA", "加拿大"], ["UK", "英国"], ["DE", "德国"], ["FR", "法国"],
  ["IT", "意大利"], ["ES", "西班牙"], ["JP", "日本"], ["AU", "澳大利亚"], ["MX", "墨西哥"],
] as const;
const normalize = (value: string) => {
  const trimmed = value.trim();
  return sites.find(([code, label]) => [code, label, `${label}站`].includes(trimmed.toUpperCase()))?.[0] ?? trimmed.toUpperCase();
};

/** Only explicit site language counts. Currency, seller location and competitor URLs do not imply a target site. */
export function resolveResearchMarketplace(requirement: string, argument?: string) {
  const mentions: { value: string; sourceText: string }[] = [];
  for (const [code, label] of sites) for (const match of requirement.matchAll(new RegExp(`${label}站(?:点)?`, "g"))) mentions.push({ value: code, sourceText: match[0] });
  for (const match of requirement.matchAll(/(?:目标站点|目标市场|站点|marketplace|target market)\s*[:：]\s*([^，,；;。\n]+)/gi)) {
    const value = normalize(match[1]);
    if (sites.some(([code]) => code === value)) mentions.push({ value, sourceText: match[0] });
  }
  const explicit = argument?.trim() ? normalize(argument) : undefined;
  const values = new Set([...mentions.map(mention => mention.value), ...(explicit ? [explicit] : [])]);
  const conflict = values.size > 1;
  return { value: values.size === 1 ? [...values][0] : null, conflict,
    source: conflict || !values.size ? null : explicit ? "argument" : "requirement",
    sourceTexts: [...new Set(mentions.map(mention => mention.sourceText))] };
}
