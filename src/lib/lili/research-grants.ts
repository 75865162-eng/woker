import type { PermissionAction } from "@/lib/accounts/permissions";

/** Explicit credential grants. Existing Amazon tool grants never imply these. */
export const researchToolActions = {
  research_start: "create",
  research_read: "view",
  research_evidence: "view",
  research_list: "view",
  research_step: "edit",
  research_pause: "edit",
  research_resume: "edit",
  research_recover: "edit",
  research_cancel: "edit",
  research_export: "export",
} as const satisfies Record<string, PermissionAction>;
export type ResearchToolName = keyof typeof researchToolActions;
export const researchCredentialTools = [
  ["research_start", "Lili 开品：创建研究（真实调用仍需审批）"],
  ["research_list", "Lili 开品：查询本人任务历史"],
  ["research_evidence", "Lili 开品：分页读取本人原始证据"],
  ["research_read", "Lili 开品：读取本人研究"],
  ["research_step", "Lili 开品：推进研究（不能批准人工节点）"],
  ["research_pause", "Lili 开品：暂停本人研究"],
  ["research_resume", "Lili 开品：恢复暂停（不执行请求）"],
  ["research_recover", "Lili 开品：恢复失败（不重放请求）"],
  ["research_cancel", "Lili 开品：取消本人研究"],
  ["research_export", "Lili 开品：保存已确认的 HTML 报告"],
] as const;
export function isResearchTool(name: string): name is ResearchToolName {
  return Object.hasOwn(researchToolActions, name);
}
