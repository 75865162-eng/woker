import type { PermissionAction } from "@/lib/accounts/permissions";
import type { WorkspaceScopeInput } from "@/lib/workspace/scope";

/** 运行 Skill 所需的权限模块与动作。复用 Lili 归属的 agents 模块，不新增权限面。 */
export const SKILL_MODULE_ID = "agents";
export const SKILL_RUN_ACTION: PermissionAction = "create";
export const SKILL_EXPORT_ACTION: PermissionAction = "export";

export type SkillInputKind = "marketplace" | "asin" | "dateRange" | "text";

export type SkillInput = {
  key: string;
  label: string;
  kind: SkillInputKind;
  required: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string;
};

export type ExportFormat = "xlsx" | "docx";

export type SkillView = {
  slug: string;
  name: string;
  summary: string;
  category: string;
  categoryLabel: string;
  steps: string[];
  tools: string[];
  prompt: string;
  featured: boolean;
  isNew: boolean;
  inputs: SkillInput[];
  exportFormat: ExportFormat;
  exportFormatLabel: string;
  dataTables: string[];
};

export type SkillRunRequest = {
  inputs: Record<string, string>;
  scope: WorkspaceScopeInput;
};

export type SkillRunStep = {
  id: string;
  label: string;
  status: "running" | "done" | "skipped" | "failed";
  detail?: string;
  durationMs?: number;
};

/** SSE 事件：进度步骤、内容增量、完成、错误。 */
export type SkillRunEvent =
  | { type: "step"; step: SkillRunStep }
  | { type: "delta"; text: string }
  | { type: "done"; report: string; exportFormat: ExportFormat; exportFileName: string; downloadId: string; historyId: string | null }
  | { type: "error"; code: string; message: string };

export type SkillReportRow = Record<string, string | number | null>;

/** 传给 skillTableAvailability 的数据源摘要（与 skill-data 内部 DataSource 结构一致，只读字段子集）。 */
export type DataSource = {
  id: string;
  resource: string;
  sellerAccountId: string;
  marketplaceId: string;
  activeRunId: string | null;
  lastSuccessAt: Date | null;
  freshnessMinutes: number;
  rowCount: number;
  publishedRun: {
    status: string;
    executionVersion: number;
    resource: string;
    sourceId: string | null;
    finishedAt: Date | null;
    stage: string;
  } | null;
};

/** LLM 输出的结构化报告。markdown 用于预览与 Word；rows 用于 Excel。缺失值保留 null。 */
export type StructuredReport = {
  title: string;
  markdown: string;
  rows: SkillReportRow[];
  notes?: string[];
};
