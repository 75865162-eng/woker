import { enrichMetric } from "@/lib/metrics";
import type { CampaignGroup, OverallAdDataRow, PerformanceRow } from "@/lib/types";
import type { JsonValue } from "./types";
import type { PpcDiagnosisItem, PpcOpportunityItem, PpcBidRecommendationItem, PpcNegativeRecommendationItem, PpcCampaignRecommendationItem } from "./ppc-contracts";
import type { buildAdsSnapshot, buildKeywordSignal } from "./ppc-analysis";
import { evidenceFromRows } from "./ppc-analysis";
import { roundBid } from "./ppc-normalization";

export function buildBidRecommendations(
  performanceRows: PerformanceRow[],
  overallAdDataRows: OverallAdDataRow[],
  diagnosis: PpcDiagnosisItem[],
  targetAcos: number,
  adsSnapshot: ReturnType<typeof buildAdsSnapshot>,
): PpcBidRecommendationItem[] {
  const recommendations: PpcBidRecommendationItem[] = [];
  const overallRowsByKey = new Map(
    overallAdDataRows
      .filter((row) => row.campaignGroupId)
      .map((row) => [`${row.campaignGroupId}::${row.keyword.toLowerCase()}::${row.matchType.toLowerCase()}`, row]),
  );

  for (const row of performanceRows.slice(0, 18)) {
    const acos = enrichMetric(row, "acos");
    const roas = enrichMetric(row, "roas");
    const cpc = enrichMetric(row, "cpc");
    const baseConfidence = row.orders > 0 ? 0.82 : 0.68;
    const overallRow = overallRowsByKey.get(`${row.campaignGroupId}::${row.keyword.toLowerCase()}::${row.matchType.toLowerCase()}`);
    const evidence = [
      ...evidenceFromRows("ppc.bid.recommend", "acos", [row], "Historical PPC", "竞价建议"),
      ...(overallRow
        ? [{
            claim: "Matched Overall row confirms auction efficiency.",
            dataSource: "Amazon Ads",
            toolId: "ppc.ads.snapshot",
            metric: "cpc",
            value: overallRow.cpc ?? cpc,
            timestamp: new Date().toISOString(),
          }]
        : []),
    ];

    if (row.orders > 0 && acos !== null && acos <= targetAcos) {
      const suggestedBid = roundBid(row.currentBid * 1.08);

      recommendations.push({
        rowId: row.id,
        campaignGroupId: row.campaignGroupId,
        keyword: row.keyword,
        target: row.target,
        currentBid: row.currentBid,
        suggestedBid,
        deltaPercent: Number((((suggestedBid - row.currentBid) / row.currentBid) * 100).toFixed(1)),
        recommendation: "上调竞价 5-10% 并单独观察转化。",
        confidence: baseConfidence,
        evidence,
      });
      continue;
    }

    if (row.clicks >= 15 && row.orders === 0) {
      const suggestedBid = roundBid(Math.max(0.02, row.currentBid * 0.8));

      recommendations.push({
        rowId: row.id,
        campaignGroupId: row.campaignGroupId,
        keyword: row.keyword,
        target: row.target,
        currentBid: row.currentBid,
        suggestedBid,
        deltaPercent: Number((((suggestedBid - row.currentBid) / row.currentBid) * 100).toFixed(1)),
        recommendation: "先降价控损，必要时暂停或转否定。",
        confidence: 0.88,
        evidence,
      });
      continue;
    }

    if (roas >= adsSnapshot.metrics.roas && row.orders > 0) {
      const suggestedBid = roundBid(row.currentBid * 1.05);

      recommendations.push({
        rowId: row.id,
        campaignGroupId: row.campaignGroupId,
        keyword: row.keyword,
        target: row.target,
        currentBid: row.currentBid,
        suggestedBid,
        deltaPercent: Number((((suggestedBid - row.currentBid) / row.currentBid) * 100).toFixed(1)),
        recommendation: "轻度加价以获取更多高质量流量。",
        confidence: 0.8,
        evidence,
      });
    }
  }

  if (!recommendations.length) {
    const fallbackRow = performanceRows[0];
    if (fallbackRow) {
      recommendations.push({
        rowId: fallbackRow.id,
        campaignGroupId: fallbackRow.campaignGroupId,
        keyword: fallbackRow.keyword,
        target: fallbackRow.target,
        currentBid: fallbackRow.currentBid,
        suggestedBid: roundBid(fallbackRow.currentBid),
        deltaPercent: 0,
        recommendation: "数据不足，先观察并继续收集样本。",
        confidence: 0.5,
        evidence: evidenceFromRows("ppc.bid.recommend", "clicks", [fallbackRow], "Historical PPC", "样本不足"),
      });
    }
  }

  return recommendations.slice(0, 12);
}

export function buildNegativeRecommendations(
  performanceRows: PerformanceRow[],
  overallAdDataRows: OverallAdDataRow[],
  diagnosis: PpcDiagnosisItem[],
  keywordSignal: ReturnType<typeof buildKeywordSignal>,
): PpcNegativeRecommendationItem[] {
  const recommendations: PpcNegativeRecommendationItem[] = [];
  const wasteRows = performanceRows.filter((row) => row.clicks >= 20 && row.orders === 0);

  for (const row of wasteRows.slice(0, 8)) {
    recommendations.push({
      term: row.keyword || row.target,
      matchType: row.matchType,
      recommendation: "建议添加否定词或把该词从广泛流量中隔离出去。",
      confidence: 0.86,
      evidence: evidenceFromRows("ppc.negative.recommend", "clicks", [row], "Historical PPC", "否定词候选"),
    });
  }

  if (!recommendations.length && keywordSignal.candidateKeywords.length) {
    recommendations.push({
      term: keywordSignal.candidateKeywords[0] ?? "unknown",
      matchType: "broad",
      recommendation: "当前没有明确否定词，但应持续监控泛词流量。",
      confidence: 0.55,
      evidence: keywordSignal.evidence,
    });
  }

  if (overallAdDataRows.some((row) => row.matchStatus === "unmatched")) {
    recommendations.push({
      term: "overall-unmatched",
      matchType: "signal",
      recommendation: "先修复未匹配数据，避免把错误词误判为浪费。",
      confidence: 0.65,
      evidence: [{
        claim: "Unmatched overall data affects negative keyword confidence.",
        dataSource: "Amazon Ads",
        toolId: "ppc.ads.snapshot",
        metric: "matchStatus",
        value: "unmatched",
        timestamp: new Date().toISOString(),
      }],
    });
  }

  return recommendations.slice(0, 10);
}

export function buildCampaignRecommendations(
  campaignGroups: CampaignGroup[],
  diagnosis: PpcDiagnosisItem[],
  opportunities: PpcOpportunityItem[],
  productContext: JsonValue | null,
): PpcCampaignRecommendationItem[] {
  const recommendations: PpcCampaignRecommendationItem[] = [];

  if (diagnosis.some((item) => item.issue.includes("ACOS"))) {
    recommendations.push({
      title: "把高 ACOS 词拆成独立控制组",
      recommendation: "将高花费泛词与高效 exact 词拆开，分别设定预算和出价上限。",
      confidence: 0.88,
      evidence: diagnosis.flatMap((item) => item.evidence).slice(0, 4),
    });
  }

  if (opportunities.some((item) => item.type === "scale")) {
    recommendations.push({
      title: "为赢家词单独建扩量路径",
      recommendation: "对高效词建立单独 campaign / ad group，保留更高预算和更窄的匹配范围。",
      confidence: 0.86,
      evidence: opportunities.filter((item) => item.type === "scale").flatMap((item) => item.evidence).slice(0, 4),
    });
  }

  if (campaignGroups.length > 1) {
    recommendations.push({
      title: "统一检查生命周期分组与预算",
      recommendation: "按新品、成熟、衰退、清库存四类检查预算分配和否定词继承。",
      confidence: 0.78,
      evidence: [{
        claim: "Campaign grouping available for lifecycle planning.",
        dataSource: "Workspace",
        toolId: "ppc.workspace.load",
        metric: "campaignGroupCount",
        value: campaignGroups.length,
        timestamp: new Date().toISOString(),
      }],
    });
  }

  if (productContext) {
    recommendations.push({
      title: "把产品卖点映射到关键词分层",
      recommendation: "让 title、bullet、A+ 卖点反向驱动 PPC 的 keyword hierarchy 和精准词池。",
      confidence: 0.72,
      evidence: [{
        claim: "Product context can inform PPC keyword hierarchy.",
        dataSource: "Product Data",
        toolId: "ppc.workspace.load",
        metric: "productContext",
        value: productContext,
        timestamp: new Date().toISOString(),
      }],
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      title: "先稳定结构，再扩量",
      recommendation: "当前信号有限，先收拢浪费、确认核心词，再逐步放量。",
      confidence: 0.7,
      evidence: diagnosis.flatMap((item) => item.evidence).slice(0, 3),
    });
  }

  return recommendations.slice(0, 6);
}
