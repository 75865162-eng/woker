import { normalizeHeader, readColumn, readNumber, type SheetRow } from "@/lib/bulk/overall-data";
import type { CampaignGroup, CampaignSheetGroup, PerformanceRow } from "@/lib/types";

export type ParseDiagnostics = {
  totalRows: number;
  sponsoredProductRows: number;
  rowsWithAdGroup: number;
  keywordRows: number;
  rowsWithBid: number;
  executableRows: number;
  sampleHeaders: string[];
  sampleEntities: string[];
};
export const bulkFieldCandidates = {
  entity: ["实体层级", "实体", "记录类型", "Entity", "Record Type"],
  campaignName: [
    "广告活动名称（仅供参考）",
    "广告活动名称(仅供参考)",
    "广告活动名称",
    "Campaign Name (Informational only)",
    "Campaign Name",
  ],
  adGroupName: [
    "广告组名称（仅供参考）",
    "广告组名称(仅供参考)",
    "Ad Group Name (Informational only)",
    "Ad Group Name",
    "广告组名称",
    "广告组",
  ],
  keyword: ["关键词文本", "关键字文本", "关键词", "关键字", "Keyword Text", "Keyword"],
  target: ["商品定位表达式", "投放对象", "Product Targeting Expression", "Targeting Expression", "Target"],
  matchType: ["投放匹配类型", "匹配类型", "Targeting Match Type", "Match Type"],
  bid: ["竞价", "出价", "关键词竞价", "关键字竞价", "Bid", "Max Bid", "Keyword Bid"],
  state: ["状态", "投放状态", "State", "Status"],
  impressions: ["展示量", "曝光量", "Impressions"],
  clicks: ["点击量", "点击次数", "Clicks"],
  spend: ["总成本 (USD)", "总成本", "花费", "支出", "Spend", "Cost"],
  sales: ["销售额 (USD)", "销售额", "销量", "销售", "Sales", "7 Day Total Sales", "14 Day Total Sales"],
  orders: ["购买量", "订单数量", "订单", "Orders", "Purchases", "7 Day Total Orders", "14 Day Total Orders"],
};

function buildCampaignGroupId(sheetName: string, adGroupName: string) {
  return `${sheetName}::${adGroupName}`.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-");
}

export function buildWorkspaceUnitName(groups: CampaignGroup[]) {
  if (groups.length === 0) {
    return "Manual Workspace Unit";
  }

  if (groups.length === 1) {
    return groups[0].adGroupName;
  }

  return `${groups[0].adGroupName} +${groups.length - 1} 个分组`;
}

export function buildSheetGroups(groups: CampaignGroup[]) {
  return groups.reduce<CampaignSheetGroup[]>((sheetGroups, group) => {
    const sheetName = group.sheetName ?? "Mock Sheet";
    const existingSheet = sheetGroups.find((item) => item.sheetName === sheetName);

    if (existingSheet) {
      existingSheet.groups.push(group);
    } else {
      sheetGroups.push({ sheetName, groups: [group] });
    }

    return sheetGroups;
  }, []);
}

function isSponsoredProductsCampaignSheet(sheetName: string) {
  const normalized = normalizeHeader(sheetName);

  return (
    normalized.includes(normalizeHeader("商品推广活动")) ||
    normalized.includes(normalizeHeader("Sponsored Products Campaigns")) ||
    normalized.includes(normalizeHeader("Sponsored Products"))
  );
}

function isKeywordEntity(entity: string) {
  const normalized = normalizeHeader(entity);

  return (
    normalized === normalizeHeader("关键词") ||
    normalized === normalizeHeader("关键字") ||
    normalized === "keyword" ||
    normalized === "keywords"
  );
}

function isExecutableKeywordRow(row: SheetRow, sheetName: string) {
  const entity = readColumn(row, bulkFieldCandidates.entity);
  const adGroupName = readColumn(row, bulkFieldCandidates.adGroupName);
  const bid = readColumn(row, bulkFieldCandidates.bid);

  return isSponsoredProductsCampaignSheet(sheetName) && isKeywordEntity(entity) && adGroupName !== "" && bid !== "";
}

export function toPerformanceRow(row: SheetRow, sheetName: string, batchId: string, fallbackSourceRowIndex: number): PerformanceRow | null {
  const sourceRowIndex = Number(row.__sourceRowIndex ?? fallbackSourceRowIndex);
  const adGroupName = readColumn(row, bulkFieldCandidates.adGroupName);

  if (!isExecutableKeywordRow(row, sheetName)) {
    return null;
  }

  const campaignName = readColumn(row, bulkFieldCandidates.campaignName) || sheetName;
  const keyword = readColumn(row, bulkFieldCandidates.keyword) || readColumn(row, bulkFieldCandidates.target) || "未命名关键词";
  const campaignGroupId = buildCampaignGroupId(sheetName, adGroupName);
  const currentBid = readNumber(row, bulkFieldCandidates.bid);
  const state = readColumn(row, bulkFieldCandidates.state);

  return {
    id: `${batchId}-${sheetName}-${sourceRowIndex}`,
    batchId,
    sheetName,
    sourceRowIndex,
    sourceRowNumber: sourceRowIndex,
    campaignGroupId,
    entity: readColumn(row, bulkFieldCandidates.entity),
    adGroupNameRef: adGroupName,
    campaignName,
    adGroupName,
    keyword,
    target: readColumn(row, bulkFieldCandidates.target) || keyword,
    matchType: readColumn(row, bulkFieldCandidates.matchType) || "-",
    currentBid,
    impressions: readNumber(row, bulkFieldCandidates.impressions),
    clicks: readNumber(row, bulkFieldCandidates.clicks),
    orders: readNumber(row, bulkFieldCandidates.orders),
    sales: readNumber(row, bulkFieldCandidates.sales),
    spend: readNumber(row, bulkFieldCandidates.spend),
    topOfSearchShare: 0,
    advertisedProductOrders: 0,
    otherProductOrders: 0,
    viewableImpressions: 0,
    status: state.includes("暂停") || state.toLowerCase() === "paused" ? "paused" : "enabled",
  };
}

export function collectDiagnostics(sheetName: string, rows: SheetRow[], current: ParseDiagnostics): ParseDiagnostics {
  const sampleHeaders = current.sampleHeaders.length
    ? current.sampleHeaders
    : Object.keys(rows[0] ?? {})
        .filter((key) => !key.startsWith("__"))
        .slice(0, 16);
  const sampleEntities = new Set(current.sampleEntities);
  let sponsoredProductRows = current.sponsoredProductRows;
  let rowsWithAdGroup = current.rowsWithAdGroup;
  let keywordRows = current.keywordRows;
  let rowsWithBid = current.rowsWithBid;
  let executableRows = current.executableRows;

  for (const row of rows) {
    const entity = readColumn(row, bulkFieldCandidates.entity);
    const hasAdGroup = readColumn(row, bulkFieldCandidates.adGroupName) !== "";
    const hasBid = readColumn(row, bulkFieldCandidates.bid) !== "";
    const isSpSheet = isSponsoredProductsCampaignSheet(sheetName);
    const isKeyword = isKeywordEntity(entity);

    if (entity && sampleEntities.size < 10) {
      sampleEntities.add(entity);
    }
    if (isSpSheet) sponsoredProductRows += 1;
    if (hasAdGroup) rowsWithAdGroup += 1;
    if (isKeyword) keywordRows += 1;
    if (hasBid) rowsWithBid += 1;
    if (isSpSheet && isKeyword && hasAdGroup && hasBid) executableRows += 1;
  }

  return {
    totalRows: current.totalRows + rows.length,
    sponsoredProductRows,
    rowsWithAdGroup,
    keywordRows,
    rowsWithBid,
    executableRows,
    sampleHeaders,
    sampleEntities: Array.from(sampleEntities),
  };
}

export function buildParseFailureMessage(diagnostics: ParseDiagnostics) {
  const headers = diagnostics.sampleHeaders.length ? diagnostics.sampleHeaders.join("、") : "未读取到表头";
  const entities = diagnostics.sampleEntities.length ? diagnostics.sampleEntities.join("、") : "未读取到实体层级值";

  return [
    "已解析文件，但未找到可执行关键词行。",
    "MVP 仅处理“商品推广活动 / Sponsored Products Campaigns”中实体层级为“关键词/关键字/Keyword”且竞价不为空的行。",
    `诊断：总行 ${diagnostics.totalRows}，商品推广 Sheet 行 ${diagnostics.sponsoredProductRows}，有广告组 ${diagnostics.rowsWithAdGroup}，关键词实体 ${diagnostics.keywordRows}，有竞价 ${diagnostics.rowsWithBid}，可执行 ${diagnostics.executableRows}。`,
    `识别到的表头示例：${headers}。`,
    `实体层级示例：${entities}。`,
  ].join(" ");
}

export function buildGroupsFromRows(existingGroups: CampaignGroup[], rows: PerformanceRow[]) {
  const groupMap = new Map<string, CampaignGroup>();

  for (const group of existingGroups) {
    groupMap.set(group.id, group);
  }

  for (const row of rows) {
    const existingGroup = groupMap.get(row.campaignGroupId);
    groupMap.set(row.campaignGroupId, {
      id: row.campaignGroupId,
      sheetName: row.sheetName,
      campaignName: existingGroup?.campaignName ?? row.campaignName,
      adGroupName: row.adGroupName,
      lifecycleGroupId: existingGroup?.lifecycleGroupId,
      keywordCount: (existingGroup?.keywordCount ?? 0) + 1,
      lastUpdated: new Date().toISOString().slice(0, 10),
    });
  }

  return Array.from(groupMap.values()).sort((left, right) => {
    const sheetCompare = (left.sheetName ?? "").localeCompare(right.sheetName ?? "", "zh-CN");
    return sheetCompare || left.adGroupName.localeCompare(right.adGroupName, "zh-CN");
  });
}




