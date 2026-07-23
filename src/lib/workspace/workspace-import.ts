import type {
  CampaignGroup,
  CampaignSheetGroup,
  LifecycleGroupId,
  OverallAdDataMatchSummary,
  OverallAdDataRow,
  PerformanceRow,
  WorkspaceUnit,
} from "@/lib/types";

export type SheetRow = Record<string, string | number | boolean | null | undefined>;

export type OverallAdDataCsvFile = {
  fileName: string;
  text?: string;
  rows?: SheetRow[];
};

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

const fieldCandidates = {
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

const overallFieldCandidates = {
  sheetName: ["Sheet 名", "Sheet", "Portfolio", "Campaign Type", "店铺名称", "活动类型"],
  campaignName: ["广告活动名称", "广告活动名称（仅供参考）", "Campaign Name", "Campaign", "所在广告活动"],
  adGroupName: ["广告组名称", "广告组名称（仅供参考）", "Ad Group Name", "Ad Group Name (Informational only)", "所在广告组"],
  keyword: ["关键词文本", "关键词", "Keyword Text", "Customer Search Term", "Search Term", "Keyword", "用户搜索词", "投放"],
  target: ["商品投放表达式", "投放对象", "Targeting Expression", "Product Targeting Expression", "Target", "投放"],
  matchType: ["投放匹配类型", "匹配类型", "Targeting Match Type", "Match Type"],
  impressions: ["展示量", "曝光量", "Impressions", "广告曝光量"],
  clicks: ["点击量", "点击次数", "Clicks", "广告点击量"],
  orders: ["购买量", "订单量", "订单数量", "Orders", "Purchases", "广告订单量", "本广告产品订单量"],
  sales: ["销售额 (USD)", "销售额", "销量", "销售", "Sales", "7 Day Total Sales", "14 Day Total Sales", "广告销售额", "本广告产品销售额"],
  spend: ["总成本 (USD)", "总成本", "花费", "支出", "Spend", "Cost", "广告花费"],
  cpc: ["CPC", "CPC (USD)", "Cost Per Click"],
  acos: ["ACOS", "ACoS", "Advertising Cost of Sales"],
  roas: ["ROAS", "Return on Ad Spend"],
};

export function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .replace(/\uFEFF/g, "")
    .replace(/[\s()[\]_\-:：,，.。/\\（）]/g, "");
}

export function readColumn(row: SheetRow, candidates: string[]) {
  const entries = Object.entries(row).filter(([key]) => !key.startsWith("__"));
  const normalizedEntries = entries.map(([key, value]) => [normalizeHeader(key), value] as const);

  for (const candidate of candidates.map(normalizeHeader)) {
    const exactEntry = normalizedEntries.find(([key]) => key === candidate);

    if (exactEntry) {
      const value = exactEntry[1];
      return value === null || value === undefined ? "" : String(value).trim();
    }
  }

  for (const candidate of candidates.map(normalizeHeader)) {
    const fuzzyEntry = normalizedEntries.find(
      ([key]) => key.includes(candidate) || candidate.includes(key),
    );

    if (fuzzyEntry) {
      const value = fuzzyEntry[1];
      return value === null || value === undefined ? "" : String(value).trim();
    }
  }

  return "";
}

export function readNumber(row: SheetRow, candidates: string[]) {
  const value = readColumn(row, candidates).replace(/[$,%￥,]/g, "");
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : 0;
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && quoted && nextChar === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

export function parseCsv(text: string): SheetRow[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  const headers = parseCsvLine(lines[0] ?? "");

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);

    return headers.reduce<SheetRow>((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

function readLooseColumn(row: SheetRow, candidates: string[]) {
  const entries = Object.entries(row).filter(([key]) => !key.startsWith("__"));
  const normalizedEntries = entries.map(([key, value]) => [normalizeHeader(key), value] as const);

  for (const candidate of candidates.map(normalizeHeader)) {
    const entry = normalizedEntries.find(([key]) => key === candidate);

    if (entry) {
      const value = entry[1];
      return value === null || value === undefined ? "" : String(value).trim();
    }
  }

  return "";
}

export function normalizeMatchValue(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function buildBlockedCampaignIdentityId(campaignName: string, adGroupName: string) {
  return `${normalizeMatchValue(campaignName)}::${normalizeMatchValue(adGroupName)}`;
}

function normalizeMatchType(value: string | undefined) {
  const normalized = normalizeMatchValue(value);
  const matchTypeMap: Record<string, string> = {
    exact: "exact",
    精确: "exact",
    精确匹配: "exact",
    精准: "exact",
    精准匹配: "exact",
    phrase: "phrase",
    词组: "phrase",
    词组匹配: "phrase",
    短语: "phrase",
    短语匹配: "phrase",
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

function getBulkMatchKeys(row: PerformanceRow) {
  return Array.from(
    new Set([
      buildKeywordMatchKey(row.keyword, row.matchType),
      buildKeywordMatchKey(row.target, row.matchType),
    ]),
  );
}

function getOverallMatchKeys(row: OverallAdDataRow) {
  return Array.from(
    new Set([
      buildKeywordMatchKey(row.keyword, row.matchType),
      buildKeywordMatchKey(row.target, row.matchType),
    ]),
  );
}

function sameOverallCampaignIdentity(row: OverallAdDataRow, candidate: PerformanceRow) {
  return normalizeMatchValue(row.adGroupName) === normalizeMatchValue(candidate.adGroupName);
}

function parseOverallAdDataCsvRows(
  _fileName: string,
  text: string,
  scopeCampaignGroupIds: string[],
  fileIndex = 0,
) {
  return parseOverallAdDataSheetRows(parseCsv(text), scopeCampaignGroupIds, fileIndex);
}

function parseOverallAdDataSheetRows(
  sheetRows: SheetRow[],
  scopeCampaignGroupIds: string[],
  fileIndex = 0,
) {
  const fileId = `overall-${Date.now()}-${fileIndex}`;
  return sheetRows
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
}

export function buildOverallAdDataRows(
  fileName: string,
  text: string,
  scopeCampaignGroupIds: string[],
  performanceRows: PerformanceRow[],
) {
  const rows = parseOverallAdDataCsvRows(fileName, text, scopeCampaignGroupIds);

  return matchOverallAdDataRows(rows, scopeCampaignGroupIds, performanceRows, fileName);
}

export function buildOverallAdDataRowsFromFiles(
  files: OverallAdDataCsvFile[],
  scopeCampaignGroupIds: string[],
  performanceRows: PerformanceRow[],
) {
  const rows = files.flatMap((file, index) =>
    file.rows
      ? parseOverallAdDataSheetRows(file.rows, scopeCampaignGroupIds, index)
      : parseOverallAdDataCsvRows(file.fileName, file.text ?? "", scopeCampaignGroupIds, index),
  );
  const fileName =
    files.length === 1
      ? files[0]?.fileName ?? ""
      : `${files.length} 个 Overall 文件：${files.map((file) => file.fileName).join("、")}`;

  return matchOverallAdDataRows(rows, scopeCampaignGroupIds, performanceRows, fileName);
}

export function matchOverallAdDataRows(
  rows: OverallAdDataRow[],
  scopeCampaignGroupIds: string[],
  performanceRows: PerformanceRow[],
  fileName: string,
) {
  const scopedPerformanceRows = performanceRows.filter((row) => scopeCampaignGroupIds.includes(row.campaignGroupId));
  const bulkRowsByKeywordAndMatchType = scopedPerformanceRows.reduce<Map<string, PerformanceRow[]>>((map, row) => {
    for (const key of getBulkMatchKeys(row)) {
      const existingRows = map.get(key) ?? [];

      existingRows.push(row);
      map.set(key, existingRows);
    }
    return map;
  }, new Map());
  const matchedRows = rows.map((row) => {
    const candidates = getOverallMatchKeys(row).flatMap((key) => bulkRowsByKeywordAndMatchType.get(key) ?? []);
    const hasOverallAdGroup = Boolean(normalizeMatchValue(row.adGroupName));
    const scopedCandidates = hasOverallAdGroup
      ? candidates.filter((candidate) => sameOverallCampaignIdentity(row, candidate))
      : candidates;
    const candidateCampaignGroupIds = Array.from(new Set(scopedCandidates.map((candidate) => candidate.campaignGroupId)));

    if (candidateCampaignGroupIds.length === 1) {
      const matchedCampaignGroupId = candidateCampaignGroupIds[0];
      const matchedBulkRow = scopedCandidates.find((candidate) => candidate.campaignGroupId === matchedCampaignGroupId);

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
      const matchedCampaignGroupId = candidateCampaignGroupIds[0];
      const matchedBulkRow = scopedCandidates.find((candidate) => candidate.campaignGroupId === matchedCampaignGroupId);

      return {
        ...row,
        sheetName: row.sheetName ?? matchedBulkRow?.sheetName,
        campaignName: row.campaignName ?? matchedBulkRow?.campaignName,
        adGroupName: row.adGroupName ?? matchedBulkRow?.adGroupName,
        campaignGroupId: matchedCampaignGroupId,
        matchStatus: "ambiguous" as const,
        matchError: hasOverallAdGroup
          ? "广告组、关键词和匹配类型命中多个 Bulk 候选，已按第一个候选处理"
          : "关键词和匹配类型命中多个广告组，已按第一个 Bulk 候选广告组处理",
      };
    }

    if (hasOverallAdGroup && candidates.length > 0) {
      return {
        ...row,
        matchStatus: "unmatched" as const,
        matchError: "关键词和匹配类型存在于 Bulk，但不在 Overall 指定的广告组内",
      };
    }

    return {
      ...row,
      matchStatus: "unmatched" as const,
      matchError: hasOverallAdGroup
        ? "找不到与 Overall 广告组 + 关键词/投放对象 + 匹配类型一致的 Bulk 行"
        : "找不到 Bulk 关键词/投放对象 + 匹配类型完全一致的行",
    };
  });
  const matchedCampaignGroups = new Set(matchedRows.flatMap((row) => (row.campaignGroupId ? [row.campaignGroupId] : []))).size;
  const summary: OverallAdDataMatchSummary = {
    totalRows: matchedRows.length,
    matchedRows: matchedRows.filter((row) => row.matchStatus !== "unmatched" && row.campaignGroupId).length,
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

export function buildCampaignGroupId(sheetName: string, adGroupName: string) {
  return `${sheetName}::${adGroupName}`.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-");
}

export function createWorkspaceUnitId() {
  return `workspace-unit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

export function upsertWorkspaceUnitForCampaign(
  workspaceUnits: WorkspaceUnit[],
  campaignGroups: CampaignGroup[],
  campaignGroupId: string,
  workspaceUnitId: string,
) {
  const groupIds = new Set<string>();

  return workspaceUnits.map((unit) => {
    if (unit.id === workspaceUnitId) {
      unit.campaignGroupIds.forEach((id) => groupIds.add(id));
      groupIds.add(campaignGroupId);
      const nextCampaignGroupIds = Array.from(groupIds);
      const nextGroups = campaignGroups.filter((group) => nextCampaignGroupIds.includes(group.id));

      return {
        ...unit,
        campaignGroupIds: nextCampaignGroupIds,
        name: buildWorkspaceUnitName(nextGroups),
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      ...unit,
      campaignGroupIds: unit.campaignGroupIds.filter((id) => id !== campaignGroupId),
    };
  }).filter((unit) => unit.campaignGroupIds.length > 0);
}

export function detachCampaignGroupFromWorkspaceUnits(workspaceUnits: WorkspaceUnit[], campaignGroupId: string) {
  return workspaceUnits
    .map((unit) => {
      const nextCampaignGroupIds = unit.campaignGroupIds.filter((id) => id !== campaignGroupId);

      return {
        ...unit,
        campaignGroupIds: nextCampaignGroupIds,
      };
    })
    .filter((unit) => unit.campaignGroupIds.length > 0);
}

export function rebuildWorkspaceUnits(workspaceUnits: WorkspaceUnit[], campaignGroups: CampaignGroup[]) {
  return workspaceUnits
    .map((unit) => {
      const groups = campaignGroups.filter((group) => unit.campaignGroupIds.includes(group.id));

      return {
        ...unit,
        name: buildWorkspaceUnitName(groups),
        updatedAt: new Date().toISOString(),
      };
    })
    .filter((unit) => unit.campaignGroupIds.length > 1);
}

function normalizeLifecycleGroupId(value: string): LifecycleGroupId | undefined {
  const normalized = normalizeMatchValue(value);
  const lifecycleMap: Record<string, LifecycleGroupId> = {
    launch: "launch",
    "新品组": "launch",
    "新品": "launch",
    mature: "mature",
    "成熟组": "mature",
    "成熟": "mature",
    decline: "decline",
    "衰退组": "decline",
    "衰退": "decline",
    clearance: "clearance",
    "清库存组": "clearance",
    "清库存": "clearance",
  };

  return lifecycleMap[normalized];
}

function buildCampaignGroupLookup(groups: CampaignGroup[]) {
  return groups.reduce<Map<string, string>>((lookup, group) => {
    [
      group.id,
      group.adGroupName,
      `${group.sheetName ?? ""}::${group.adGroupName}`,
      `${group.campaignName}::${group.adGroupName}`,
    ].forEach((value) => {
      const normalized = normalizeMatchValue(value);

      if (normalized) {
        lookup.set(normalized, group.id);
      }
    });

    return lookup;
  }, new Map());
}

export function buildWorkspaceUnitsFromGroupingRows(rows: SheetRow[], groups: CampaignGroup[]) {
  const groupLookup = buildCampaignGroupLookup(groups);
  const unitRows = new Map<string, string[]>();
  const lifecycleByCampaignGroupId = new Map<string, LifecycleGroupId | undefined>();
  let importedRows = 0;

  rows.forEach((row) => {
    const campaignGroupKey =
      readLooseColumn(row, ["campaignGroupId", "campaign_group_id", "id"]) ||
      readLooseColumn(row, ["adGroupName", "ad_group_name", "Ad Group Name"]) ||
      readLooseColumn(row, ["campaignName", "campaign_name", "Campaign Name"]);
    const campaignGroupId = groupLookup.get(normalizeMatchValue(campaignGroupKey));

    if (!campaignGroupId) {
      return;
    }

    importedRows += 1;

    const rawLifecycle = readLooseColumn(row, ["lifecycleGroup", "lifecycleGroupId", "lifecycle", "产品周期分组"]).toLowerCase();
    const workspaceUnitName = readLooseColumn(row, ["workspaceUnit", "workspaceUnitId", "workspace", "分组"]);
    const normalizedWorkspaceUnitName = workspaceUnitName.toLowerCase();
    const shiftedLifecycle = !rawLifecycle && Boolean(normalizeLifecycleGroupId(normalizedWorkspaceUnitName));
    const lifecycleGroupId = normalizeLifecycleGroupId(rawLifecycle) ?? (shiftedLifecycle ? normalizeLifecycleGroupId(normalizedWorkspaceUnitName) : undefined);

    if (lifecycleGroupId) {
      lifecycleByCampaignGroupId.set(campaignGroupId, lifecycleGroupId);
    }

    if (!workspaceUnitName || shiftedLifecycle) {
      return;
    }

    const workspaceUnitKey = normalizeMatchValue(workspaceUnitName);
    const currentIds = unitRows.get(workspaceUnitKey) ?? [];
    unitRows.set(workspaceUnitKey, Array.from(new Set([...currentIds, campaignGroupId])));
  });

  const now = new Date().toISOString();
  const workspaceUnits = Array.from(unitRows.entries()).flatMap(([key, campaignGroupIds], index): WorkspaceUnit[] => {
    const validIds = campaignGroupIds.filter((id) => groups.some((group) => group.id === id));

    if (validIds.length < 2) {
      return [];
    }

    const unitGroups = groups.filter((group) => validIds.includes(group.id));

    return [
      {
        id: `imported-workspace-unit-${index + 1}-${key.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").slice(0, 32)}`,
        name: buildWorkspaceUnitName(unitGroups),
        campaignGroupIds: validIds,
        createdAt: now,
        updatedAt: now,
      },
    ];
  });

  return { importedRows, lifecycleByCampaignGroupId, workspaceUnits };
}

export function findWorkspaceUnitByCampaignGroupId(workspaceUnits: WorkspaceUnit[], campaignGroupId: string) {
  return workspaceUnits.find((unit) => unit.campaignGroupIds.includes(campaignGroupId));
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
  const entity = readColumn(row, fieldCandidates.entity);
  const adGroupName = readColumn(row, fieldCandidates.adGroupName);
  const bid = readColumn(row, fieldCandidates.bid);

  return isSponsoredProductsCampaignSheet(sheetName) && isKeywordEntity(entity) && adGroupName !== "" && bid !== "";
}

export function toPerformanceRow(row: SheetRow, sheetName: string, batchId: string, fallbackSourceRowIndex: number): PerformanceRow | null {
  const sourceRowIndex = Number(row.__sourceRowIndex ?? fallbackSourceRowIndex);
  const adGroupName = readColumn(row, fieldCandidates.adGroupName);

  if (!isExecutableKeywordRow(row, sheetName)) {
    return null;
  }

  const campaignName = readColumn(row, fieldCandidates.campaignName) || sheetName;
  const keyword = readColumn(row, fieldCandidates.keyword) || readColumn(row, fieldCandidates.target) || "未命名关键词";
  const campaignGroupId = buildCampaignGroupId(sheetName, adGroupName);
  const currentBid = readNumber(row, fieldCandidates.bid);
  const state = readColumn(row, fieldCandidates.state);

  return {
    id: `${batchId}-${sheetName}-${sourceRowIndex}`,
    batchId,
    sheetName,
    sourceRowIndex,
    sourceRowNumber: sourceRowIndex,
    campaignGroupId,
    entity: readColumn(row, fieldCandidates.entity),
    adGroupNameRef: adGroupName,
    campaignName,
    adGroupName,
    keyword,
    target: readColumn(row, fieldCandidates.target) || keyword,
    matchType: readColumn(row, fieldCandidates.matchType) || "-",
    currentBid,
    impressions: readNumber(row, fieldCandidates.impressions),
    clicks: readNumber(row, fieldCandidates.clicks),
    orders: readNumber(row, fieldCandidates.orders),
    sales: readNumber(row, fieldCandidates.sales),
    spend: readNumber(row, fieldCandidates.spend),
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
    const entity = readColumn(row, fieldCandidates.entity);
    const hasAdGroup = readColumn(row, fieldCandidates.adGroupName) !== "";
    const hasBid = readColumn(row, fieldCandidates.bid) !== "";
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
