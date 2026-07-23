export type LifecycleGroupId = "launch" | "mature" | "decline" | "clearance";

export type MetricKey =
  | "impressions"
  | "clicks"
  | "ctr"
  | "orders"
  | "sales"
  | "spend"
  | "acos"
  | "roas"
  | "cpa"
  | "cpc"
  | "cvr"
  | "acots"
  | "asots"
  | "topOfSearchShare"
  | "advertisedProductOrders"
  | "otherProductOrders"
  | "viewableImpressions";

export type DerivedMetricKey = "orderShare" | "isCoreKeyword" | "overallAcosDelta";

export type ConditionMetricKey = MetricKey | DerivedMetricKey;

export type ConditionDataSource = "bulk" | "overall" | "comparison" | "derived" | "bid_validation";

export type ConditionOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "increase_by"
  | "decrease_by";

export type LogicalOperator = "AND" | "OR";

export type BidActionType =
  | "increase_bid_percent"
  | "decrease_bid_percent"
  | "increase_bid_fixed"
  | "decrease_bid_fixed"
  | "set_bid"
  | "set_bid_to_overall_cpc_ratio"
  | "increase_bid_percent_capped_at_overall_cpc"
  | "increase_bid_percent_with_overall_cpc_bounds";

export type RuleActionType =
  | BidActionType
  | "pause_keyword"
  | "enable_keyword"
  | "add_negative_keyword"
  | "add_label"
  | "mark_pending"
  | "no_change";

export type BatchGranularity = "Daily" | "Weekly" | "Monthly";

export type ParseJobStatus = "idle" | "parsing" | "completed" | "failed";

export type OverallAdDataStatus = "idle" | "parsing" | "matched" | "failed";

export interface CampaignGroup {
  id: string;
  sheetName?: string;
  campaignName: string;
  adGroupName: string;
  lifecycleGroupId?: LifecycleGroupId;
  keywordCount: number;
  lastUpdated: string;
}

export interface BlockedCampaignIdentity {
  id: string;
  campaignName: string;
  adGroupName: string;
  blockedAt: string;
}

export interface Campaign extends CampaignGroup {
  sourceWorkbookId?: string;
  productTargetCount?: number;
}

export interface CampaignSheetGroup {
  sheetName: string;
  groups: CampaignGroup[];
}

export interface CampaignCollection {
  sheetName: string;
  campaigns: Campaign[];
}

export interface WorkspaceUnit {
  id: string;
  name: string;
  campaignGroupIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OverallAdDataUpload {
  id: string;
  uploadedAt: string;
  fileName: string;
  scopeCampaignGroupIds: string[];
  rows: OverallAdDataRow[];
  status: OverallAdDataStatus;
  error?: string;
  matchSummary: OverallAdDataMatchSummary;
}

export interface ExportHistoryRecord {
  id: string;
  exportedAt: string;
  fileName: string;
  bulkFileName?: string;
  overallFileName?: string;
  lifecycleGroupId?: LifecycleGroupId;
  lifecycleGroupName?: string;
  campaignGroupIds: string[];
  campaignGroupNames: string[];
  keywordNames: string[];
  overallAdDataRows: OverallAdDataRow[];
  overallAdDataMatchSummary: OverallAdDataMatchSummary;
  adjustmentDrafts: AdjustmentDraft[];
  selectedDraftIds: string[];
}

export interface RuleRunHistoryRecord {
  id: string;
  ranAt: string;
  exportedAt?: string;
  exportFileName?: string;
  bulkFileName?: string;
  overallFileName?: string;
  campaignGroupIds: string[];
  campaignGroupNames: string[];
  overallAdDataRows: OverallAdDataRow[];
  overallAdDataMatchSummary: OverallAdDataMatchSummary;
  adjustmentDrafts: AdjustmentDraft[];
}

export interface LifecycleGroup {
  id: LifecycleGroupId;
  name: string;
  description: string;
  tone: "blue" | "green" | "amber" | "red";
  ruleIds: string[];
}

export interface DataBatch {
  id: string;
  campaignGroupId: string;
  fileName: string;
  uploadedAt: string;
  rowCount: number;
  dateRange: string;
  status: "archived" | "processing" | "failed";
}

export interface PerformanceRow {
  id: string;
  campaignGroupId: string;
  batchId: string;
  sheetName?: string;
  sourceRowIndex?: number;
  sourceRowNumber?: number;
  entity?: string;
  adGroupNameRef?: string;
  campaignName: string;
  adGroupName: string;
  keyword: string;
  target: string;
  matchType: string;
  currentBid: number;
  impressions: number;
  clicks: number;
  orders: number;
  sales: number;
  spend: number;
  topOfSearchShare: number;
  advertisedProductOrders: number;
  otherProductOrders: number;
  viewableImpressions: number;
  status: "enabled" | "paused";
}

export interface OverallAdDataRow {
  id: string;
  fileId: string;
  sheetName?: string;
  campaignGroupId?: string;
  scopeCampaignGroupIds?: string[];
  campaignName?: string;
  adGroupName?: string;
  keyword: string;
  target: string;
  matchType: string;
  impressions: number;
  clicks: number;
  orders: number;
  sales: number;
  spend: number;
  cpc?: number;
  acos?: number;
  roas?: number;
  matchStatus: "matched" | "unmatched" | "ambiguous";
  matchError?: string;
}

export interface OverallAdDataMatchSummary {
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  ambiguousRows: number;
  matchedCampaignGroups: number;
  scopedCampaignGroups: number;
}

export interface MetricSnapshot {
  campaignGroupId: string;
  batchId: string;
  sales: number;
  spend: number;
  acos: number;
  roas: number;
  ctr: number;
  cpc: number;
  orders: number;
  impressions: number;
  clicks: number;
  cvr: number;
}

export interface CampaignMetricSnapshot extends MetricSnapshot {
  campaignId: string;
}

export interface Condition {
  id: string;
  dataSource?: ConditionDataSource;
  metric: ConditionMetricKey;
  compareMetric?: MetricKey;
  operator: ConditionOperator;
  value?: number;
  min?: number;
  max?: number;
}

export interface ConditionGroup {
  id: string;
  logic: LogicalOperator;
  conditions: Array<Condition | ConditionGroup>;
}

export interface RuleAction {
  id: string;
  type: RuleActionType;
  value?: number;
  min?: number;
  max?: number;
  label?: string;
}

export interface Rule {
  id: string;
  name: string;
  lifecycleGroupId: LifecycleGroupId;
  enabled: boolean;
  priority: number;
  conditionGroup: ConditionGroup;
  actions: RuleAction[];
  updatedAt: string;
}

export interface AdjustmentDraft {
  id: string;
  runHistoryId?: string;
  batchId?: string;
  sheetName?: string;
  sourceRowIndex?: number;
  sourceRowNumber?: number;
  campaignGroupId: string;
  rowId: string;
  field?: "bid" | "state";
  headerName?: string;
  oldValue?: string | number | null;
  newValue?: string | number;
  keyword: string;
  target: string;
  currentBid: number;
  suggestedBid: number;
  deltaPercent: number;
  reason: string;
  matchedRule: string;
  selected: boolean;
}

export interface WorkspaceDraft extends AdjustmentDraft {
  campaignId: string;
}

export interface HeaderMapEntry {
  headerName: string;
  columnIndex: number;
  excelColumn: string;
}

export type HeaderMap = Record<string, HeaderMapEntry>;

export interface DraftValidationResult {
  draftId: string;
  valid: boolean;
  status: "valid" | "blocked" | "conflict";
  message: string;
  sheetName?: string;
  sourceRowIndex?: number;
  headerName?: string;
}

export interface TrendPoint {
  date: string;
  sales: number;
  spend: number;
  acos: number;
  roas: number;
  orders: number;
}

export interface BatchComparisonRow {
  metric: string;
  current: number;
  previous: number;
  delta: number;
  growthRate: number;
}

export interface RulePreview {
  matchedKeywords: number;
  matchedAdGroups: number;
  estimatedChanges: number;
  estimatedSpendImpact: number;
}

export interface OptimizationEngine {
  id: string;
  name: string;
  run: (input: OptimizationInput) => AdjustmentDraft[];
}

export interface OptimizationInput {
  campaignGroup: CampaignGroup;
  rows: PerformanceRow[];
  overallAdDataRows?: OverallAdDataRow[];
  rules: Rule[];
}

export interface WorkspaceSnapshotRecord {
  version: number;
  savedAt: string;
  snapshot: unknown;
}
