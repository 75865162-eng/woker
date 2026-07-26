import type { Condition, ConditionGroup, LifecycleGroupId, OverallAdDataRow, RuleAction } from "@/lib/types";

const lifecycleGroupOptions: LifecycleGroupId[] = ["launch", "mature", "decline", "clearance"];
type PageItem = number | "...";
type OverallImportRow = Record<string, string | number | boolean | null | undefined>;
type OverallImportFile = {
  fileName: string;
  text?: string;
  rows?: OverallImportRow[];
};


export function formatExportTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function buildBlockedIdentityId(campaignName: string, adGroupName: string) {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  return `${normalize(campaignName)}::${normalize(adGroupName)}`;
}

export function sameScope(left: string[], right: string[]) {
  return left.length === right.length && left.every((id) => right.includes(id));
}

export function containsScope(container: string[], scope: string[]) {
  return scope.every((id) => container.includes(id));
}

export function countMatchedOverallKeywords(rows: OverallAdDataRow[]) {
  return new Set(
    rows
      .filter((row) => row.campaignGroupId && row.matchStatus !== "unmatched")
      .map((row) => `${row.campaignGroupId}::${row.keyword || row.target}::${row.matchType}`),
  ).size;
}

export function waitForPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export async function readOverallImportFile(file: File): Promise<OverallImportFile> {
  if (/\.csv$/i.test(file.name)) {
    return { fileName: file.name, text: await file.text() };
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const rows = workbook.SheetNames.flatMap((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
      return [];
    }

    return XLSX.utils.sheet_to_json<OverallImportRow>(worksheet, { defval: "", raw: true });
  });

  if (workbook.SheetNames.length === 0) {
    throw new Error(`${file.name} 没有可读取的工作表。`);
  }

  return {
    fileName: file.name,
    rows,
  };
}

export function lifecycleGroupLabel(lifecycleGroupId: LifecycleGroupId) {
  return lifecycleGroupId === "launch"
    ? "新品组"
    : lifecycleGroupId === "mature"
      ? "成熟组"
      : lifecycleGroupId === "decline"
        ? "衰退组"
        : "清库存组";
}

function conditionMetricLabel(metric: Condition["metric"]) {
  const labels: Partial<Record<Condition["metric"], string>> = {
    impressions: "曝光",
    clicks: "点击",
    orders: "订单",
    sales: "销售额",
    spend: "花费",
    acos: "ACOS",
    roas: "ROAS",
    cpc: "CPC",
    cvr: "CVR",
    orderShare: "单量占比",
    isCoreKeyword: "核心词",
    overallAcosDelta: "Overall ACOS 差值",
  };

  return labels[metric] ?? metric;
}

function conditionValue(condition: Condition, value: number | undefined) {
  if (value === undefined) {
    return "-";
  }

  return ["acos", "ctr", "cvr", "orderShare", "overallAcosDelta"].includes(condition.metric)
    ? `${Number.isInteger(value) ? value : Number(value.toFixed(2))}%`
    : String(Number.isInteger(value) ? value : Number(value.toFixed(2)));
}

export function summarizeCondition(condition: Condition) {
  const metric = conditionMetricLabel(condition.metric);
  const source = condition.dataSource === "overall" ? "Overall " : condition.dataSource === "bid_validation" ? "Bid/CPC " : "";

  if (condition.operator === "between") {
    const max = condition.max !== undefined && Math.abs(condition.max % 1 - 0.999) < 0.001
      ? Math.ceil(condition.max)
      : condition.max;
    return `${conditionValue(condition, condition.min)} ≤ ${source}${metric} < ${conditionValue(condition, max)}`;
  }

  const operators: Record<Condition["operator"], string> = {
    eq: "=",
    neq: "≠",
    gt: ">",
    gte: "≥",
    lt: "<",
    lte: "≤",
    between: "",
    increase_by: "增加超过",
    decrease_by: "降低超过",
  };

  return `${source}${metric} ${operators[condition.operator]} ${conditionValue(condition, condition.value)}`;
}

export function flattenConditionGroup(group: ConditionGroup): Condition[] {
  return group.conditions.flatMap((item) => "logic" in item ? flattenConditionGroup(item) : [item]);
}

export function summarizeAction(action: RuleAction) {
  switch (action.type) {
    case "increase_bid_percent":
      return `Bid +${action.value ?? 0}%`;
    case "decrease_bid_percent":
      return `Bid -${action.value ?? 0}%`;
    case "increase_bid_fixed":
      return `Bid +$${action.value ?? 0}`;
    case "decrease_bid_fixed":
      return `Bid -$${action.value ?? 0}`;
    case "set_bid":
      return `Bid = $${action.value ?? 0}`;
    case "set_bid_to_overall_cpc_ratio":
      return `Bid = Overall CPC × ${action.value ?? 0}%`;
    case "increase_bid_percent_capped_at_overall_cpc":
      return `Bid +${action.value ?? 0}%（不超过 Overall CPC）`;
    case "increase_bid_percent_with_overall_cpc_bounds":
      return `Bid +${action.value ?? 0}%（最低 Overall CPC 的 ${action.min ?? 0}%，不超过 ${action.max ?? 100}%）`;
    case "pause_keyword":
      return "暂停关键词";
    case "enable_keyword":
      return "启用关键词";
    case "no_change":
      return "不调整";
    default:
      return action.label ?? action.type;
  }
}

export function buildPageItems(currentPage: number, totalPages: number) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1) as PageItem[];
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "...", totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages];
}

function escapeCsvCell(value: string | number | undefined) {
  const text = value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function rowsToCsv(rows: Array<Array<string | number | undefined>>) {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

export async function downloadGroupingStatusWorkbook(rows: Array<Array<string | number | undefined>>) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("grouping-status");
  const lifecycleColumnIndex = rows[0]?.findIndex((header) => header === "lifecycleGroup") ?? -1;

  worksheet.addRows(rows);
  worksheet.columns = [
    { width: 32 },
    { width: 22 },
    { width: 36 },
    { width: 36 },
    { width: 18 },
    { width: 28 },
  ];
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.getRow(1).font = { bold: true };

  if (lifecycleColumnIndex >= 0) {
    for (let rowIndex = 2; rowIndex <= Math.max(rows.length + 200, 500); rowIndex += 1) {
      worksheet.getCell(rowIndex, lifecycleColumnIndex + 1).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${lifecycleGroupOptions.join(",")}"`],
        showErrorMessage: true,
        errorTitle: "生命周期分组无效",
        error: `请选择 ${lifecycleGroupOptions.join(" / ")} 之一。`,
      };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob("campaign-grouping-status.xlsx", new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

export async function readGroupingStatusFile(file: File) {
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    return file.text();
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return "";
  }

  const rows = XLSX.utils.sheet_to_json<Array<string | number | undefined>>(workbook.Sheets[firstSheetName], {
    header: 1,
    defval: "",
    raw: true,
  });

  return rowsToCsv(rows);
}

