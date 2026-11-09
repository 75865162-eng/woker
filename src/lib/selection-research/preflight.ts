import type { ProviderStatus, RuntimeTool } from "@/lib/lili/runtime-tools";
import { rejectCredentials } from "./schema";
import { SKILLS, type SkillSnapshot } from "./types";
import { parseResearchAiSource } from "./ai-settings";

export function parseResearchInput(body: Record<string, unknown>) {
  // A missing/typoed live mode must never silently create a sample-data task.
  if (body.mode !== "live" && body.mode !== "fixture") throw new Error("EXPLICIT_RESEARCH_MODE_REQUIRED");
  if (typeof body.requirement !== "string" || !body.requirement.trim() || body.requirement.length > 20_000 || typeof body.marketplace !== "string" || !body.marketplace.trim() || body.marketplace.trim().length > 16) throw new Error("INVALID_RESEARCH_REQUEST");
  if (body.asin !== undefined && typeof body.asin !== "string") throw new Error("INVALID_ASIN");
  const asin = typeof body.asin === "string" ? body.asin.trim().toUpperCase() : undefined;
  if (asin && !/^[A-Z0-9]{10}$/.test(asin)) throw new Error("INVALID_ASIN");
  if (body.erpCredentialId !== undefined && (typeof body.erpCredentialId !== "string" || body.erpCredentialId.length > 100)) throw new Error("INVALID_ERP_CREDENTIAL_ID");
  if (body.budgetMode !== undefined && !["reviewed", "mock_unlimited", "uncapped"].includes(String(body.budgetMode))) throw new Error("INVALID_RESEARCH_REQUEST");
  if (body.mode === "live" && body.budgetMode === "mock_unlimited") throw new Error("LIVE_BUDGET_REVIEW_REQUIRED");
  if ((body.budgetMode === "reviewed" && body.maxMarketCalls === undefined) || (body.budgetMode === "uncapped" && body.maxMarketCalls !== undefined) || (body.maxMarketCalls !== undefined && (typeof body.maxMarketCalls !== "number" || !Number.isSafeInteger(body.maxMarketCalls) || body.maxMarketCalls < 1))) throw new Error("MISSING_MARKET_CALL_BUDGET");
  const input = { budgetMode: (body.budgetMode ?? (body.maxMarketCalls === undefined ? "uncapped" : "reviewed")) as "reviewed" | "mock_unlimited" | "uncapped", mode: body.mode, requirement: body.requirement.trim(), marketplace: body.marketplace.trim().toUpperCase(), asin: asin || undefined,
    aiConfigSource: parseResearchAiSource(body.aiConfigSource),
    erpCredentialId: typeof body.erpCredentialId === "string" ? body.erpCredentialId.trim() || undefined : undefined, maxMarketCalls: body.maxMarketCalls as number | undefined };
  rejectCredentials(input);
  return input;
}

export type ResearchReadiness = { ready: boolean; checks: { id: string; status: "ready" | "blocked"; message: string }[] };
/** Metadata/configuration checks only. This never proves successful business/model calls or grants execution. */
export function researchReadiness(input: { providers: ProviderStatus[]; tools: RuntimeTool[]; ai: string; skills?: SkillSnapshot[]; request: Record<string, unknown> }): ResearchReadiness {
  const checks: ResearchReadiness["checks"] = [];
  for (const id of ["erp", "sellersprite", "xiyou"] as const) {
    const source = input.providers.find(provider => provider.provider === id);
    const callable = input.tools.filter(tool => tool.provider === id && tool.availability === "available").length;
    const ready = source?.status === "connected" && callable > 0;
    checks.push({ id, status: ready ? "ready" : "blocked", message: ready ? `在线目录已读取，${callable} 个审核过的只读工具；业务数据尚未调用。` : source?.reason ?? "来源未连接或没有可用的只读工具。" });
  }
  checks.push({ id: "ai", status: input.ai === "configured" ? "ready" : "blocked", message: input.ai === "configured" ? "已有模型配置；尚未发起模型请求验证。" : input.ai === "runtime_model_permission_required" ? "选用服务端模型需要当前账号已有的系统设置编辑权限。" : "所选模型未配置或配置不可用；可在 ERP 设置中配置工作区模型，或显式选用已有服务端模型。" });
  const skillsReady = input.skills?.length === SKILLS.length && input.skills.every((skill, i) => skill.name === SKILLS[i] && skill.markdown && skill.sha256);
  checks.push({ id: "skills", status: skillsReady ? "ready" : "blocked", message: skillsReady ? "五个现有 Skill 原文及哈希已加载。" : "现有研究 Skill 加载失败或不完整；未替换为样本。" });
  try {
    parseResearchInput({ ...input.request, mode: "live" });
    checks.push({ id: "input", status: "ready", message: "研究输入与所选预算模式有效；费用审批仅在用户或当前 Skill 明确要求时触发；第1和第5阶段等待业务确认。" });
  } catch {
    checks.push({ id: "input", status: "blocked", message: "请填写研究要求及站点，调用上限可留空；填写时须为正整数，并检查 ASIN 和凭证 ID 格式。" });
  }
  return { ready: checks.every(check => check.status === "ready"), checks };
}
