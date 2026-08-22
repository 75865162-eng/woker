import { parseCsv, readColumn, readNumber } from "@/lib/bulk/row-utils";
import type { OverallAdDataMatchSummary, OverallAdDataRow, PerformanceRow } from "@/lib/types";

export type OverallAdDataBuildResult = {
  fileName: string;
  rows: OverallAdDataRow[];
  summary: OverallAdDataMatchSummary;
};

const overallFieldCandidates = {
  sheetName: ["Sheet 名", "Sheet", "Portfolio", "Campaign Type"],
  campaignName: ["广告活动名称", "广告活动名称（仅供参考）", "Campaign Name", "Campaign"],
  adGroupName: ["广告组名称", "广告组名称（仅供参考）", "Ad Group Name", "Ad Group Name (Informational only)"],
  keyword: ["关键词文本", "关键词", "Keyword Text", "Customer Search Term", "Search Term", "Keyword"],
  target: ["商品投放表达式", "投放对象", "Targeting Expression", "Product Targeting Expression", "Target"],
  matchType: ["投放匹配类型", "匹配类型", "Targeting Match Type", "Match Type"],
  impressions: ["展示量", "曝光量", "Impressions"],
  clicks: ["点击量", "点击次数", "Clicks"],
  orders: ["购买量", "订单量", "订单数量", "Orders", "Purchases"],
  sales: ["销售额 (USD)", "销售额", "销量", "销售", "Sales", "7 Day Total Sales", "14 Day Total Sales"],
  spend: ["总成本 (USD)", "总成本", "花费", "支出", "Spend", "Cost"],
  cpc: ["CPC", "CPC (USD)", "Cost Per Click"],
  acos: ["ACOS", "ACoS", "Advertising Cost of Sales"],
  roas: ["ROAS", "Return on Ad Spend"],
};

overallFieldCandidates.sheetName.push("店铺名称", "活动类型");
overallFieldCandidates.campaignName.push("所在广告活动");
overallFieldCandidates.adGroupName.push("所在广告组");
overallFieldCandidates.keyword.push("用户搜索词", "投放");
overallFieldCandidates.target.push("投放");
overallFieldCandidates.matchType.push("匹配类型");
overallFieldCandidates.impressions.push("广告曝光量");
overallFieldCandidates.clicks.push("广告点击量");
overallFieldCandidates.orders.push("广告订单量", "本广告产品订单量");
overallFieldCandidates.sales.push("广告销售额", "本广告产品销售额");
overallFieldCandidates.spend.push("广告花费");

export function normalizeMatchValue(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeMatchType(value: string | undefined) {
  const normalized = normalizeMatchValue(value);
  const matchTypeMap: Record<string, string> = {
    exact: "exact",
    精确: "exact",
    精确匹配: "exact",
    精准: "exact",
    phrase: "phrase",
    词组: "phrase",
    词组匹配: "phrase",
    短语: "phrase",
    broad: "broad",
    广泛: "broad",
    广泛匹配: "broad",
    "broad match": "broad",
    紧密匹配: "close match",
    宽泛匹配: "loose match",
    同类商品: "substitutes",
    关联商品: "complements",
    "phrase match": "phrase",
    "exact match": "exact",
  };

  return matchTypeMap[normalized] ?? normalized;
}

function normalizePercentMetric(value: number) {
  return value > 0 && value <= 1 ? value * 100 : value;
}

function buildKeywordMatchKey(keyword: string | undefined, matchType: string | undefined) {
  return `${normalizeMatchValue(keyword)}::${normalizeMatchType(matchType)}`;
}

function buildKeywordOnlyMatchKey(keyword: string | undefined) {
  return normalizeMatchValue(keyword);
}

function getBulkMatchKeys(row: PerformanceRow) {
  return Array.from(
    new Set([
      buildKeywordMatchKey(row.keyword, row.matchType),
      buildKeywordMatchKey(row.target, row.matchType),
    ]),
  );
}

function getBulkKeywordOnlyMatchKeys(row: PerformanceRow) {
  return Array.from(new Set([buildKeywordOnlyMatchKey(row.keyword), buildKeywordOnlyMatchKey(row.target)]));
}

export function matchOverallAdDataRows(input: {
  rows: OverallAdDataRow[];
  scopeCampaignGroupIds: string[];
  performanceRows: PerformanceRow[];
  fileName: string;
}): OverallAdDataBuildResult {
  const { rows, scopeCampaignGroupIds, performanceRows, fileName } = input;
  const scopedPerformanceRows = performanceRows.filter((row) => scopeCampaignGroupIds.includes(row.campaignGroupId));
  const bulkRowsByKeywordAndMatchType = scopedPerformanceRows.reduce<Map<string, PerformanceRow[]>>((map, row) => {
    for (const key of getBulkMatchKeys(row)) {
      const existingRows = map.get(key) ?? [];

      existingRows.push(row);
      map.set(key, existingRows);
    }
    return map;
  }, new Map());
  const bulkRowsByKeywordOnly = scopedPerformanceRows.reduce<Map<string, PerformanceRow[]>>((map, row) => {
    for (const key of getBulkKeywordOnlyMatchKeys(row)) {
      if (!key) {
        continue;
      }

      const existingRows = map.get(key) ?? [];

      existingRows.push(row);
      map.set(key, existingRows);
    }
    return map;
  }, new Map());
  const matchedRows = rows.map((row) => {
    const exactCandidates = bulkRowsByKeywordAndMatchType.get(buildKeywordMatchKey(row.keyword, row.matchType)) ?? [];
    const candidates = exactCandidates.length
      ? exactCandidates
      : bulkRowsByKeywordOnly.get(buildKeywordOnlyMatchKey(row.keyword)) ?? [];
    const candidateCampaignGroupIds = Array.from(new Set(candidates.map((candidate) => candidate.campaignGroupId)));

    if (candidateCampaignGroupIds.length === 1) {
      const matchedCampaignGroupId = candidateCampaignGroupIds[0];
      const matchedBulkRow = candidates.find((candidate) => candidate.campaignGroupId === matchedCampaignGroupId);

      return {
        ...row,
        sheetName: row.sheetName ?? matchedBulkRow?.sheetName,
        campaignName: row.campaignName ?? matchedBulkRow?.campaignName,
        adGroupName: row.adGroupName ?? matchedBulkRow?.adGroupName,
        campaignGroupId: matchedCampaignGroupId,
        matchStatus: "matched" as const,
        matchError: undefined,
      };
    }

    if (candidateCampaignGroupIds.length > 1) {
      return {
        ...row,
        matchStatus: "ambiguous" as const,
        matchError: "关键词和匹配类型命中多个广告组，请在单个广告组范围内上传 Overall 数据。",
      };
    }

    return {
      ...row,
      matchStatus: "unmatched" as const,
      matchError: "找不到与 Bulk 关键词/投放对象 + 匹配类型一致的行。",
    };
  });
  const matchedCampaignGroups = new Set(matchedRows.flatMap((row) => (row.campaignGroupId ? [row.campaignGroupId] : []))).size;
  const summary: OverallAdDataMatchSummary = {
    totalRows: matchedRows.length,
    matchedRows: matchedRows.filter((row) => row.matchStatus === "matched").length,
    unmatchedRows: matchedRows.filter((row) => row.matchStatus === "unmatched").length,
    ambiguousRows: matchedRows.filter((row) => row.matchStatus === "ambiguous").length,
    matchedCampaignGroups,
    scopedCampaignGroups: scopeCampaignGroupIds.length,
  };

  return {
    fileName,
    rows: matchedRows,
    summary,
  };
}

export function buildOverallAdDataRows(input: {
  fileName: string;
  text: string;
  scopeCampaignGroupIds: string[];
  performanceRows: PerformanceRow[];
}): OverallAdDataBuildResult {
  const { fileName, text, scopeCampaignGroupIds, performanceRows } = input;
  const fileId = `overall-${Date.now()}`;
  const csvRows = parseCsv(text);
  const rows = csvRows
    .map((row, index): OverallAdDataRow | null => {
      const keyword = readColumn(row, overallFieldCandidates.keyword);
      const matchType = readColumn(row, overallFieldCandidates.matchType);

      if (!keyword || !matchType) {
        return null;
      }

      const spend = readNumber(row, overallFieldCandidates.spend);
      const cpc = readNumber(row, overallFieldCandidates.cpc);
      const sales = readNumber(row, overallFieldCandidates.sales);
      const acosValue = readNumber(row, overallFieldCandidates.acos);
      const roasValue = readNumber(row, overallFieldCandidates.roas);

      return {
        id: `${fileId}-${index}`,
        fileId,
        scopeCampaignGroupIds,
        sheetName: readColumn(row, overallFieldCandidates.sheetName) || undefined,
        campaignName: readColumn(row, overallFieldCandidates.campaignName) || undefined,
        adGroupName: readColumn(row, overallFieldCandidates.adGroupName) || undefined,
        keyword,
        target: readColumn(row, overallFieldCandidates.target),
        matchType,
        impressions: readNumber(row, overallFieldCandidates.impressions),
        clicks: readNumber(row, overallFieldCandidates.clicks),
        orders: readNumber(row, overallFieldCandidates.orders),
        sales,
        spend,
        cpc: cpc > 0 ? cpc : undefined,
        acos: acosValue ? normalizePercentMetric(acosValue) : sales > 0 ? (spend / sales) * 100 : undefined,
        roas: roasValue || (spend > 0 ? sales / spend : undefined),
        matchStatus: "unmatched",
      };
    })
    .filter((row): row is OverallAdDataRow => Boolean(row));

  return matchOverallAdDataRows({
    rows,
    scopeCampaignGroupIds,
    performanceRows,
    fileName,
  });
}
