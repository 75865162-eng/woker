import type { LogisticsLogEntry, LogisticsStatusTone, LogisticsWorkspaceState } from "@/lib/logistics/types";

export function buildLogisticsTaskSummary(state: LogisticsWorkspaceState) {
  const primaryPdfSummary = state.pdfSummaries[0] ?? null;
  const activeARows = getVisibleLogisticsRows(state);

  return {
    shipmentTitle: primaryPdfSummary?.shipmentTitle || "--",
    shipmentName: primaryPdfSummary?.shipmentName || "--",
    warehouseCode: primaryPdfSummary?.warehouseCode || "--",
    fbaCode: primaryPdfSummary?.fbaCode || "--",
    boxCount: primaryPdfSummary?.totalBoxes ?? state.aSummary?.totalBoxes ?? 0,
    skuCount: activeARows.length,
    totalShipment: activeARows.reduce((sum, row) => sum + row.totalShipment, 0),
    pdfCount: state.pdfSummaries.length,
    pdfPageCount: state.pdfSummaries.reduce((sum, item) => sum + item.pages.length, 0),
    warningCount: state.logs.filter((item) => item.level === "warning").length,
    errorCount: state.logs.filter((item) => item.level === "error").length,
  };
}

export function getVisibleLogisticsRows(state: LogisticsWorkspaceState) {
  return (state.aSummary?.rows ?? []).filter((row) => row.totalShipment > 0);
}

export function logisticsToneForLog(level: LogisticsLogEntry["level"]): LogisticsStatusTone {
  if (level === "success") return "green";
  if (level === "warning") return "amber";
  if (level === "error") return "red";
  return "blue";
}
