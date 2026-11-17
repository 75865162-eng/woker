import type { JsonValue } from "./types";
import { aggregateMetricsForCampaignGroups, enrichMetric } from "@/lib/metrics";
import type { OverallAdDataRow, PerformanceRow } from "@/lib/types";
import { isRecord, normalizeStringArray, productContextText, clampScore, formatPercent } from "./ppc-normalization";
import type { PpcDiagnosisItem, PpcOpportunityItem, PpcEvidenceItem } from "./ppc-contracts";

export function buildAdsSnapshot(
  performanceRows: PerformanceRow[],
  overallAdDataRows: OverallAdDataRow[],
  targetAcos: number,
  targetRoas: number,
) {
  const campaignGroupIds = Array.from(new Set(performanceRows.map((row) => row.campaignGroupId)));
  const metrics = aggregateMetricsForCampaignGroups(campaignGroupIds, performanceRows);
  const topRows = [...performanceRows]
    .sort((left, right) => {
      const leftScore = rowPpcScore(left, targetAcos, targetRoas);
      const rightScore = rowPpcScore(right, targetAcos, targetRoas);
      return rightScore - leftScore;
    })
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      campaignGroupId: row.campaignGroupId,
      campaignName: row.campaignName,
      adGroupName: row.adGroupName,
      keyword: row.keyword,
      target: row.target,
      matchType: row.matchType,
      currentBid: row.currentBid,
      acos: enrichMetric(row, "acos"),
      roas: enrichMetric(row, "roas"),
      cpc: enrichMetric(row, "cpc"),
      orders: row.orders,
      clicks: row.clicks,
      spend: row.spend,
    }));

  return {
    metrics,
    topRows,
    evidence: [{
      claim: "Aggregated PPC performance snapshot built from historical rows.",
      dataSource: "Historical PPC",
      toolId: "ppc.ads.snapshot",
      metric: "acos",
      value: metrics.acos,
      timestamp: new Date().toISOString(),
    }],
    overallAdDataRows,
  };
}

export function buildKeywordSignal(sellerSpriteKeywords: JsonValue, performanceRows: PerformanceRow[], productContext: JsonValue | null) {
  const keywordSeed = isRecord(sellerSpriteKeywords) ? sellerSpriteKeywords : {};
  const primary = normalizeStringArray(
    Array.isArray(keywordSeed.primaryKeywords) ? keywordSeed.primaryKeywords : [performanceRows[0]?.keyword, productContextText(productContext)].filter(Boolean),
  );
  const secondary = normalizeStringArray(Array.isArray(keywordSeed.secondaryKeywords) ? keywordSeed.secondaryKeywords : []);
  const longTail = normalizeStringArray(Array.isArray(keywordSeed.longTailKeywords) ? keywordSeed.longTailKeywords : []);
  const hasProvidedKeywords = [keywordSeed.primaryKeywords, keywordSeed.secondaryKeywords, keywordSeed.longTailKeywords].some((value) => Array.isArray(value) && value.length > 0);
  const candidateKeywords = [...primary, ...secondary, ...longTail].filter(Boolean).slice(0, 12);
  const keywordOpportunity = clampScore(
    Math.round(
      (candidateKeywords.length > 0 ? 55 : 30) +
        Math.min(30, performanceRows.filter((row) => row.orders > 0).length * 4) +
        Math.min(15, performanceRows.filter((row) => row.clicks > 20 && row.orders === 0).length * 3),
    ),
  );

  return {
    keywordOpportunity,
    candidateKeywords,
    evidence: [{
      claim: hasProvidedKeywords ? "Keyword signals inferred from provided keyword context and PPC rows." : "Keyword signals inferred from local PPC rows only.",
      dataSource: hasProvidedKeywords ? "Provided keyword context + PPC" : "Local PPC",
      toolId: "ppc.keyword.signal",
      metric: "keywordOpportunity",
      value: keywordOpportunity,
      timestamp: new Date().toISOString(),
    }],
  };
}

export function buildDiagnosis(
  performanceRows: PerformanceRow[],
  overallAdDataRows: OverallAdDataRow[],
  adsSnapshot: ReturnType<typeof buildAdsSnapshot>,
  keywordSignal: ReturnType<typeof buildKeywordSignal>,
  targetAcos: number,
  targetMargin: number,
  marketplace: string,
): PpcDiagnosisItem[] {
  const diagnosis: PpcDiagnosisItem[] = [];
  const totalAcos = adsSnapshot.metrics.acos;
  const badRows = performanceRows.filter((row) => row.clicks >= 20 && row.orders === 0);
  const winningRows = performanceRows.filter((row) => {
    const acos = enrichMetric(row, "acos");
    return row.orders > 0 && acos !== null && acos <= targetAcos;
  });
  const highCpcRows = performanceRows.filter((row) => row.clicks >= 10 && enrichMetric(row, "cpc") > adsSnapshot.metrics.cpc * 1.15);

  if (totalAcos !== null && totalAcos > targetAcos && adsSnapshot.metrics.sales > 0) {
    diagnosis.push({
      severity: "high",
      issue: "整体 ACOS 高于目标",
      impact: `当前 ACOS ${formatPercent(totalAcos)} 高于目标 ${formatPercent(targetAcos)}，需要先控损再扩量。`,
      evidence: evidenceFromRows("ppc.diagnosis.analyze", "acos", performanceRows.slice(0, 3), "Historical PPC", "整体 ACOS 偏高"),
    });
  }

  if (badRows.length > 0) {
    diagnosis.push({
      severity: "high",
      issue: "存在高点击零订单浪费",
      impact: `${badRows.length} 条关键词/投放对象出现高点击无订单，优先考虑降价、否定或暂停。`,
      evidence: evidenceFromRows("ppc.diagnosis.analyze", "clicks", badRows.slice(0, 3), "Historical PPC", "高点击零订单"),
    });
  }

  if (winningRows.length > 0) {
    diagnosis.push({
      severity: "medium",
      issue: "存在可扩量的高效词",
      impact: `${winningRows.length} 条词/投放对象表现优于目标 ACOS，可适度加价或拆分独立放量。`,
      evidence: evidenceFromRows("ppc.diagnosis.analyze", "roas", winningRows.slice(0, 3), "Historical PPC", "高效词"),
    });
  }

  if (highCpcRows.length > 0) {
    diagnosis.push({
      severity: "medium",
      issue: "CPC 偏高",
      impact: `${highCpcRows.length} 条记录 CPC 高于组合均值，存在出价或匹配宽泛问题。`,
      evidence: evidenceFromRows("ppc.diagnosis.analyze", "cpc", highCpcRows.slice(0, 3), "Historical PPC", "高 CPC"),
    });
  }

  if (keywordSignal.keywordOpportunity >= 70) {
    diagnosis.push({
      severity: "medium",
      issue: "关键词扩量空间明显",
      impact: "SellerSprite 与 PPC 词数据都显示可进一步扩展的关键词空间。",
      evidence: [...keywordSignal.evidence],
    });
  }

  if (overallAdDataRows.some((row) => row.matchStatus === "unmatched")) {
    diagnosis.push({
      severity: "low",
      issue: "Overall 数据存在未匹配项",
      impact: "有少量 Overall 记录未能准确回写到 Bulk 行，建议检查词形和匹配类型。",
      evidence: [{
        claim: "Overall data contains unmatched rows.",
        dataSource: "Amazon Ads",
        toolId: "ppc.ads.snapshot",
        metric: "matchStatus",
        value: "unmatched",
        timestamp: new Date().toISOString(),
      }],
    });
  }

  if (marketplace && targetMargin >= 30 && adsSnapshot.metrics.sales > 0 && totalAcos !== null && totalAcos <= targetAcos) {
    diagnosis.push({
      severity: "medium",
      issue: "有利润空间支持加码",
      impact: `目标利润率 ${formatPercent(targetMargin)} 与当前表现匹配，适合优先扩量高效词。`,
      evidence: evidenceFromRows("ppc.diagnosis.analyze", "sales", winningRows.slice(0, 2), "Historical PPC", "利润空间支持加码"),
    });
  }

  if (!diagnosis.length) {
    diagnosis.push({
      severity: "low",
      issue: "信号不足",
      impact: "当前数据量有限，但仍可先从搜索词浪费和核心词放量两个方向入手。",
      evidence: adsSnapshot.evidence,
    });
  }

  return diagnosis;
}

export function buildOpportunities(
  diagnosis: PpcDiagnosisItem[],
  adsSnapshot: ReturnType<typeof buildAdsSnapshot>,
  keywordSignal: ReturnType<typeof buildKeywordSignal>,
  performanceRows: PerformanceRow[],
  targetAcos: number,
  targetRoas: number,
): PpcOpportunityItem[] {
  const opportunities: PpcOpportunityItem[] = [];
  const winningRows = performanceRows.filter((row) => {
    const acos = enrichMetric(row, "acos");
    return row.orders > 0 && acos !== null && acos <= targetAcos;
  });
  const wasteRows = performanceRows.filter((row) => row.clicks >= 20 && row.orders === 0);
  const exploratoryRows = performanceRows.filter((row) => row.clicks >= 10 && row.orders > 0 && enrichMetric(row, "roas") >= targetRoas);

  if (winningRows.length) {
    opportunities.push({
      opportunityId: "scale-winning-terms",
      title: "扩量高效关键词",
      type: "scale",
      score: clampScore(80 + Math.min(15, winningRows.length * 2)),
      rationale: "当前存在 ACOS 达标且有订单的词，可以拆分放量并上调竞价。",
      evidence: evidenceFromRows("ppc.opportunity.detect", "acos", winningRows.slice(0, 4), "Historical PPC", "高效词扩量"),
    });
  }

  if (wasteRows.length) {
    opportunities.push({
      opportunityId: "cut-waste",
      title: "削减无订单浪费",
      type: "fix",
      score: clampScore(75 + Math.min(15, wasteRows.length * 2)),
      rationale: "高点击无订单的词/投放对象应先降价、否定或暂停。",
      evidence: evidenceFromRows("ppc.opportunity.detect", "clicks", wasteRows.slice(0, 4), "Historical PPC", "无订单浪费"),
    });
  }

  if (keywordSignal.keywordOpportunity >= 60) {
    opportunities.push({
      opportunityId: "expand-keyword-surface",
      title: "扩展关键词面",
      type: "structure",
      score: keywordSignal.keywordOpportunity,
      rationale: "根据本地 PPC 与已提供的关键词上下文评估可扩展的关键词范围；这是规则推断，需人工复核。",
      evidence: [...keywordSignal.evidence],
    });
  }

  if (exploratoryRows.length) {
    opportunities.push({
      opportunityId: "defend-winners",
      title: "保护高转化词",
      type: "defend",
      score: clampScore(78 + Math.min(10, exploratoryRows.length)),
      rationale: "高 ROAS 的词需要单独结构保护，避免被泛词拖累。",
      evidence: evidenceFromRows("ppc.opportunity.detect", "roas", exploratoryRows.slice(0, 4), "Historical PPC", "高 ROAS 防守"),
    });
  }

  if (!opportunities.length) {
    opportunities.push({
      opportunityId: "observe-and-learn",
      title: "先观察再细分",
      type: "structure",
      score: 52,
      rationale: "数据还不足以形成强结论，建议先积累更多点击和订单样本。",
      evidence: diagnosis.flatMap((item) => item.evidence).slice(0, 3),
    });
  }

  return opportunities.sort((left, right) => right.score - left.score);
}

export function evidenceFromRows(
  toolId: string,
  metric: string,
  rows: PerformanceRow[],
  dataSource: string,
  claimPrefix: string,
): PpcEvidenceItem[] {
  return rows.map((row) => ({
    claim: `${claimPrefix}: ${row.keyword || row.target}`,
    dataSource,
    toolId,
    metric,
    value: {
      campaignGroupId: row.campaignGroupId,
      keyword: row.keyword,
      target: row.target,
      matchType: row.matchType,
      currentBid: row.currentBid,
      impressions: row.impressions,
      clicks: row.clicks,
      orders: row.orders,
      sales: row.sales,
      spend: row.spend,
      acos: enrichMetric(row, "acos"),
      roas: enrichMetric(row, "roas"),
      cpc: enrichMetric(row, "cpc"),
    },
    timestamp: new Date().toISOString(),
  }));
}

export function rowPpcScore(row: PerformanceRow, targetAcos: number, targetRoas: number) {
  const acos = enrichMetric(row, "acos");
  const roas = enrichMetric(row, "roas");
  const ordersScore = Math.min(30, row.orders * 6);
  const acosScore = row.orders > 0 && acos !== null ? Math.max(0, 30 - Math.max(0, acos - targetAcos)) : 0;
  const roasScore = row.orders > 0 ? Math.max(0, 20 + Math.min(20, Math.max(0, roas - targetRoas) * 5)) : 0;

  return ordersScore + acosScore + roasScore - Math.min(20, row.clicks / 5);
}
