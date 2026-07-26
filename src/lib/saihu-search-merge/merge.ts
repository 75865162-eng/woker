import type { SaihuMergedRow, SaihuMergeResult } from "@/lib/saihu-search-merge/types";

const requiredColumns = ["用户搜索词", "广告订单量", "广告曝光量", "广告点击量", "广告花费", "广告销售额"];

const outputHeaders = [
  "用户搜索词",
  "用户搜索词翻译",
  "用户搜索词标签",
  "ABA搜索词排名",
  "投放",
  "匹配类型",
  "所在广告组",
  "所在广告活动",
  "广告订单量",
  "广告曝光量",
  "广告点击量",
  "广告花费",
  "广告销售额",
  "广告销量",
  "CPC",
  "CPA",
  "广告点击率",
  "广告转化率",
  "ACoS",
  "ROAS",
  "广告笔单价",
  "广告订单量占比",
  "广告曝光量占比",
  "广告点击量占比",
  "广告花费占比",
  "广告销售额占比",
  "来源行数",
];

const percentHeaders = new Set([
  "广告点击率",
  "广告转化率",
  "ACoS",
  "广告订单量占比",
  "广告曝光量占比",
  "广告点击量占比",
  "广告花费占比",
  "广告销售额占比",
]);

type SheetRow = Record<string, unknown>;

interface TermBucket {
  searchTerm: string;
  translations: Set<string>;
  tags: Set<string>;
  targetings: Set<string>;
  matchTypes: Set<string>;
  adGroups: Set<string>;
  campaigns: Set<string>;
  abaRank: number | null;
  orderCount: number;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  units: number;
  sourceRows: number;
}

function toText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function parseNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const text = toText(value);
  if (!text) {
    return 0;
  }

  const normalized = text.replace(/US\$/giu, "").replace(/%/gu, "").replace(/[^\d.-]/gu, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNullableNumber(value: unknown) {
  const text = toText(value);
  if (!text && typeof value !== "number") {
    return null;
  }

  const parsed = parseNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function addText(set: Set<string>, value: unknown) {
  const text = toText(value);
  if (text) {
    set.add(text);
  }
}

function addTags(set: Set<string>, value: unknown) {
  const text = toText(value);
  if (!text) {
    return;
  }

  text
    .split(/[,，、]/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => set.add(item));
}

function joinSet(set: Set<string>) {
  const values = Array.from(set);
  const meaningful = values.filter((value) => value !== "无标签");
  return (meaningful.length ? meaningful : values).join(", ");
}

function ratio(numerator: number, denominator: number) {
  if (!denominator) {
    return null;
  }
  return numerator / denominator;
}

function share(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 0;
}

function buildBucket(row: SheetRow, searchTerm: string): TermBucket {
  const bucket: TermBucket = {
    searchTerm,
    translations: new Set<string>(),
    tags: new Set<string>(),
    targetings: new Set<string>(),
    matchTypes: new Set<string>(),
    adGroups: new Set<string>(),
    campaigns: new Set<string>(),
    abaRank: null,
    orderCount: 0,
    impressions: 0,
    clicks: 0,
    spend: 0,
    sales: 0,
    units: 0,
    sourceRows: 0,
  };

  applyRow(bucket, row);
  return bucket;
}

function applyRow(bucket: TermBucket, row: SheetRow) {
  addText(bucket.translations, row["用户搜索词翻译"]);
  addTags(bucket.tags, row["用户搜索词标签"]);
  addText(bucket.targetings, row["投放"]);
  addText(bucket.matchTypes, row["匹配类型"]);
  addText(bucket.adGroups, row["所在广告组"]);
  addText(bucket.campaigns, row["所在广告活动"]);

  const abaRank = parseNullableNumber(row["ABA搜索词排名"]);
  if (abaRank !== null) {
    bucket.abaRank = bucket.abaRank === null ? abaRank : Math.min(bucket.abaRank, abaRank);
  }

  bucket.orderCount += parseNumber(row["广告订单量"]);
  bucket.impressions += parseNumber(row["广告曝光量"]);
  bucket.clicks += parseNumber(row["广告点击量"]);
  bucket.spend += parseNumber(row["广告花费"]);
  bucket.sales += parseNumber(row["广告销售额"]);
  bucket.units += parseNumber(row["广告销量"]);
  bucket.sourceRows += 1;
}

function toMergedRow(bucket: TermBucket, totals: Pick<TermBucket, "orderCount" | "impressions" | "clicks" | "spend" | "sales">): SaihuMergedRow {
  return {
    searchTerm: bucket.searchTerm,
    translation: Array.from(bucket.translations)[0] ?? "",
    tags: joinSet(bucket.tags),
    abaRank: bucket.abaRank,
    targeting: joinSet(bucket.targetings),
    matchTypes: joinSet(bucket.matchTypes),
    adGroups: joinSet(bucket.adGroups),
    campaigns: joinSet(bucket.campaigns),
    orderCount: bucket.orderCount,
    impressions: bucket.impressions,
    clicks: bucket.clicks,
    spend: bucket.spend,
    sales: bucket.sales,
    units: bucket.units,
    cpc: ratio(bucket.spend, bucket.clicks),
    cpa: ratio(bucket.spend, bucket.orderCount),
    ctr: ratio(bucket.clicks, bucket.impressions),
    conversionRate: ratio(bucket.orderCount, bucket.clicks),
    acos: ratio(bucket.spend, bucket.sales),
    roas: ratio(bucket.sales, bucket.spend),
    averageOrderValue: ratio(bucket.sales, bucket.orderCount),
    orderShare: share(bucket.orderCount, totals.orderCount),
    impressionShare: share(bucket.impressions, totals.impressions),
    clickShare: share(bucket.clicks, totals.clicks),
    spendShare: share(bucket.spend, totals.spend),
    salesShare: share(bucket.sales, totals.sales),
    sourceRows: bucket.sourceRows,
  };
}

function validateColumns(columns: string[]) {
  const missing = requiredColumns.filter((column) => !columns.includes(column));
  if (missing.length) {
    throw new Error(`缺少必要列：${missing.join("、")}`);
  }
}

export async function mergeSaihuSearchTerms(file: File): Promise<SaihuMergeResult> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, cellHTML: false, cellFormula: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;

  if (!sheetName || !sheet) {
    throw new Error("没有识别到可读取的工作表。");
  }

  const sourceRows = XLSX.utils.sheet_to_json<SheetRow>(sheet, { raw: true, defval: null });
  const columns = sourceRows.length ? Object.keys(sourceRows[0]) : [];
  validateColumns(columns);

  const buckets = new Map<string, TermBucket>();
  let skippedRows = 0;

  sourceRows.forEach((row) => {
    const searchTerm = toText(row["用户搜索词"]);
    if (!searchTerm) {
      skippedRows += 1;
      return;
    }

    const key = searchTerm.toLowerCase();
    const existing = buckets.get(key);
    if (existing) {
      applyRow(existing, row);
    } else {
      buckets.set(key, buildBucket(row, searchTerm));
    }
  });

  const totals = Array.from(buckets.values()).reduce(
    (acc, bucket) => ({
      orderCount: acc.orderCount + bucket.orderCount,
      impressions: acc.impressions + bucket.impressions,
      clicks: acc.clicks + bucket.clicks,
      spend: acc.spend + bucket.spend,
      sales: acc.sales + bucket.sales,
      units: acc.units + bucket.units,
    }),
    { orderCount: 0, impressions: 0, clicks: 0, spend: 0, sales: 0, units: 0 },
  );

  const rows = Array.from(buckets.values())
    .map((bucket) => toMergedRow(bucket, totals))
    .sort((a, b) => b.orderCount - a.orderCount || b.sales - a.sales || b.clicks - a.clicks || a.searchTerm.localeCompare(b.searchTerm));

  const duplicateBuckets = Array.from(buckets.values()).filter((bucket) => bucket.sourceRows > 1);
  const duplicateSourceRows = duplicateBuckets.reduce((sum, bucket) => sum + bucket.sourceRows, 0);

  return {
    summary: {
      fileName: file.name,
      sheetName,
      sourceRows: sourceRows.length - skippedRows,
      mergedRows: rows.length,
      duplicateTermCount: duplicateBuckets.length,
      duplicateSourceRows,
      totalOrders: totals.orderCount,
      totalImpressions: totals.impressions,
      totalClicks: totals.clicks,
      totalSpend: totals.spend,
      totalSales: totals.sales,
      totalUnits: totals.units,
    },
    rows,
  };
}

function formatDecimal(value: number | null, digits = 4) {
  if (value === null || Number.isNaN(value)) {
    return "";
  }
  return Number(value.toFixed(digits));
}

function toOutputRow(row: SaihuMergedRow) {
  return {
    "用户搜索词": row.searchTerm,
    "用户搜索词翻译": row.translation,
    "用户搜索词标签": row.tags,
    "ABA搜索词排名": row.abaRank ?? "",
    "投放": row.targeting,
    "匹配类型": row.matchTypes,
    "所在广告组": row.adGroups,
    "所在广告活动": row.campaigns,
    "广告订单量": row.orderCount,
    "广告曝光量": row.impressions,
    "广告点击量": row.clicks,
    "广告花费": formatDecimal(row.spend, 2),
    "广告销售额": formatDecimal(row.sales, 2),
    "广告销量": row.units,
    "CPC": formatDecimal(row.cpc, 2),
    "CPA": formatDecimal(row.cpa, 2),
    "广告点击率": formatDecimal(row.ctr),
    "广告转化率": formatDecimal(row.conversionRate),
    "ACoS": formatDecimal(row.acos),
    "ROAS": formatDecimal(row.roas, 2),
    "广告笔单价": formatDecimal(row.averageOrderValue, 2),
    "广告订单量占比": formatDecimal(row.orderShare),
    "广告曝光量占比": formatDecimal(row.impressionShare),
    "广告点击量占比": formatDecimal(row.clickShare),
    "广告花费占比": formatDecimal(row.spendShare),
    "广告销售额占比": formatDecimal(row.salesShare),
    "来源行数": row.sourceRows,
  };
}

export async function buildSaihuSearchMergeWorkbook(result: SaihuMergeResult) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(result.rows.map(toOutputRow), { header: outputHeaders });

  worksheet["!cols"] = outputHeaders.map((header) => ({
    wch:
      header === "用户搜索词" ? 32 :
      ["投放", "所在广告组", "所在广告活动"].includes(header) ? 36 :
      header.includes("占比") ? 14 :
      16,
  }));

  outputHeaders.forEach((header, columnIndex) => {
    if (!percentHeaders.has(header)) {
      return;
    }

    for (let rowIndex = 1; rowIndex <= result.rows.length; rowIndex += 1) {
      const cellRef = XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex });
      const cell = worksheet[cellRef];
      if (cell && typeof cell.v === "number") {
        cell.z = "0.00%";
      }
    }
  });

  XLSX.utils.book_append_sheet(workbook, worksheet, "合并结果");

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ["文件名", result.summary.fileName],
    ["来源工作表", result.summary.sheetName],
    ["原始有效行数", result.summary.sourceRows],
    ["合并后搜索词数", result.summary.mergedRows],
    ["重复搜索词数", result.summary.duplicateTermCount],
    ["重复来源行数", result.summary.duplicateSourceRows],
    ["广告订单量", result.summary.totalOrders],
    ["广告曝光量", result.summary.totalImpressions],
    ["广告点击量", result.summary.totalClicks],
    ["广告花费", Number(result.summary.totalSpend.toFixed(2))],
    ["广告销售额", Number(result.summary.totalSales.toFixed(2))],
    ["广告销量", result.summary.totalUnits],
  ]);
  summarySheet["!cols"] = [{ wch: 18 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "汇总");

  const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function createSaihuSearchMergeFileName(sourceName: string) {
  const baseName = sourceName.replace(/\.(xlsx|xls|csv)$/iu, "");
  return `${baseName}_搜索词合并_${Date.now()}.xlsx`;
}
