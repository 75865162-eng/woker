import type { ProviderStatus, RuntimeTool } from "@/lib/lili/runtime-tools";
import { rejectCredentials } from "./schema";
import { SKILLS, type SkillSnapshot } from "./types";

export function parseResearchInput(body: Record<string, unknown>) {
  // A missing/typoed live mode must never silently create a sample-data task.
  if (body.mode !== "live" && body.mode !== "fixture") throw new Error("EXPLICIT_RESEARCH_MODE_REQUIRED");
  if (typeof body.requirement !== "string" || !body.requirement.trim() || body.requirement.length > 20_000 || typeof body.marketplace !== "string" || !body.marketplace.trim() || body.marketplace.trim().length > 16) throw new Error("INVALID_RESEARCH_REQUEST");
  if (body.asin !== undefined && typeof body.asin !== "string") throw new Error("INVALID_ASIN");
  const asin = typeof body.asin === "string" ? body.asin.trim().toUpperCase() : undefined;
  if (asin && !/^[A-Z0-9]{10}$/.test(asin)) throw new Error("INVALID_ASIN");
  if (body.erpCredentialId !== undefined && (typeof body.erpCredentialId !== "string" || body.erpCredentialId.length > 100)) throw new Error("INVALID_ERP_CREDENTIAL_ID");
  if (body.mode === "live" && (typeof body.maxMarketCalls !== "number" || !Number.isSafeInteger(body.maxMarketCalls) || body.maxMarketCalls < 1 || body.maxMarketCalls > 30)) throw new Error("MISSING_MARKET_CALL_BUDGET");
  const input = { mode: body.mode, requirement: body.requirement.trim(), marketplace: body.marketplace.trim().toUpperCase(), asin: asin || undefined,
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
  checks.push({ id: "ai", status: input.ai === "configured" ? "ready" : "blocked", message: input.ai === "configured" ? "已有模型配置；尚未发起模型请求验证。" : "当前工作区模型未配置或配置不可用，请在 ERP 设置中选择已有模型。" });
  const skillsReady = input.skills?.length === SKILLS.length && input.skills.every((skill, i) => skill.name === SKILLS[i] && skill.markdown && skill.sha256);
  checks.push({ id: "skills", status: skillsReady ? "ready" : "blocked", message: skillsReady ? "五个现有 Skill 原文及哈希已加载。" : "现有研究 Skill 加载失败或不完整；未替换为样本。" });
  try {
    parseResearchInput({ ...input.request, mode: "live" });
    checks.push({ id: "input", status: "ready", message: "研究输入和调用次数上限格式有效；付费请求仍需逐次审批。" });
  } catch {
    checks.push({ id: "input", status: "blocked", message: "请填写研究要求、站点及1至30次的调用上限，并检查 ASIN 和凭证 ID 格式。" });
  }
  return { ready: checks.every(check => check.status === "ready"), checks };
}
