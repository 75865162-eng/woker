export interface SaihuMergedRow {
  searchTerm: string;
  translation: string;
  tags: string;
  abaRank: number | null;
  targeting: string;
  matchTypes: string;
  adGroups: string;
  campaigns: string;
  orderCount: number;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  units: number;
  cpc: number | null;
  cpa: number | null;
  ctr: number | null;
  conversionRate: number | null;
  acos: number | null;
  roas: number | null;
  averageOrderValue: number | null;
  orderShare: number;
  impressionShare: number;
  clickShare: number;
  spendShare: number;
  salesShare: number;
  sourceRows: number;
}

export interface SaihuMergeSummary {
  fileName: string;
  sheetName: string;
  sourceRows: number;
  mergedRows: number;
  duplicateTermCount: number;
  duplicateSourceRows: number;
  totalOrders: number;
  totalImpressions: number;
  totalClicks: number;
  totalSpend: number;
  totalSales: number;
  totalUnits: number;
}

export interface SaihuMergeResult {
  summary: SaihuMergeSummary;
  rows: SaihuMergedRow[];
}

export type SaihuHistoryAction = "upload" | "export";

export interface SaihuHistoryRecord {
  id: string;
  action: SaihuHistoryAction;
  createdAt: string;
  sourceFileName: string;
  outputFileName?: string;
  outputBlob?: Blob;
  summary: SaihuMergeSummary;
  rows: SaihuMergedRow[];
}
