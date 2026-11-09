import { parseResearchBrief } from "@/lib/selection-research/brief";
import { loadBundledResearchSkills } from "@/lib/selection-research/skills";
import { researchBudgetPreview } from "@/lib/selection-research/budget";
import { resolveResearchMarketplace } from "@/lib/selection-research/marketplace";
import { rejectCredentials, validate } from "@/lib/selection-research/schema";
import type { ObjectJson, ToolDefinition } from "@/lib/selection-research/types";

export const publicResearchTools: ToolDefinition[] = [{
  name: "research_prepare",
 description: "Prepare stage 0 from natural language without authentication: parse explicit constraints, load the existing five-stage Skill template and preview planning call ranges and research credits (1 credit = CNY 0.01); task call caps are optional. No account data, private settings, task persistence, AI model or market API is used. Missing information and supplier costs remain unknown. Then authenticate a data scope before research_start; the first paid request requires task-level human approval, and subsequent paid read calls run within the saved capped or uncapped task authorization.",
  inputSchema: { type: "object", properties: { requirement: { type: "string", minLength: 1, maxLength: 12000 }, marketplace: { type: "string", minLength: 1, maxLength: 16 } }, required: ["requirement"], additionalProperties: false },
  annotations: { readOnlyHint: true },
}];

/** Stateless public preparation. Registry declarations are requirements, never evidence of connected supplier tools. */
export async function callPublicResearchTool(name: string, args: ObjectJson) {
  const tool = publicResearchTools.find(tool => tool.name === name);
  if (!tool) throw new Error("UNKNOWN_PUBLIC_RESEARCH_TOOL");
  rejectCredentials(args); validate(tool.inputSchema, args);
  const requirement = String(args.requirement);
  if (!requirement.trim()) throw new Error("EMPTY_RESEARCH_REQUIREMENT");
  const marketplaceResolution = resolveResearchMarketplace(requirement, typeof args.marketplace === "string" ? args.marketplace : undefined);
  const marketplace = marketplaceResolution.value ?? "";
  const brief = parseResearchBrief(requirement, marketplace);
  const skills = await loadBundledResearchSkills();
  return {
    ok: true, stage: 0, persisted: false, scope: "anonymous-definitions", marketDataCollected: false,
    brief: { ...brief, marketplace: marketplace || null, unresolved: [...brief.unresolved, ...(!marketplace ? ["marketplace"] : [])] },
    marketplaceResolution,
    skills: skills.map((skill, index) => ({ stage: index + 1, name: skill.name, source: skill.path, sha256: skill.sha256, declaredTools: skill.tools,
      loadTool: { name: "meta_load_skill", arguments: { skill_name: skill.name } } })),
    budget: researchBudgetPreview({ skills, registry: [], policies: {}, limits: {}, budgetMode: "uncapped" }),
    discovery: { status: "AUTHENTICATED_PROVIDER_DISCOVERY_REQUIRED", verifiedSupplierTools: [] },
    nextAction: { kind: marketplace ? "AUTHENTICATE_FOR_DATA" : "COLLECT_INPUT", tool: "research_start",
      arguments: { requirement, ...(marketplace ? { marketplace } : {}) }, missingArguments: ["workspaceId", ...(!marketplace ? ["marketplace"] : [])],
      message: marketplaceResolution.conflict ? "站点参数与原文或多个站点之间存在冲突，先请用户明确目标站点；不得默认覆盖。"
        : "阶段0未创建持久化任务。使用arguments保留原始需求；认证后从绑定的数据范围补充workspaceId。连接与Skill加载无需ERP网页登录；真实付费请求前仍须展示预算和完整请求、等待人工授权。" },
  };
}
