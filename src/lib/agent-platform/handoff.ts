/** Navigation contracts only. Business records and approvals remain server owned. */
export const handoffVersion = 1;
export type ChainStage = "market" | "product" | "supplier" | "listing" | "launch" | "ppc";
export type HandoffKind = "Opportunity" | "PRD" | "SupplierShortlist" | "ListingDraft" | "LaunchTicket" | "PpcPlan";
export const handoffStorageKeys: Record<ChainStage, string> = {
  market: "amazon.agent-platform.market-handoff",
  product: "amazon.agent-platform.product-handoff",
  supplier: "amazon.agent-platform.supplier-handoff",
  listing: "amazon.agent-platform.listing-handoff",
  launch: "amazon.agent-platform.orchestrator-handoff",
  ppc: "amazon.agent-platform.ppc-handoff",
};
export const handoffKinds: Record<ChainStage, HandoffKind> = {
  market: "Opportunity", product: "Opportunity", supplier: "PRD",
  listing: "SupplierShortlist", launch: "ListingDraft", ppc: "PpcPlan",
};
export interface HandoffIdentity {
  organizationId: string;
  userId: string;
  workspaceId: string;
}
export interface HandoffMetadata extends HandoffIdentity {
  version: 1;
  kind: HandoffKind;
  from: ChainStage | "user" | "orchestrator";
  to: ChainStage;
  sourceExecutionId: string;
  planId?: string;
  createdAt: string;
}
export interface LaunchApprovalReference {
  approvalId: string;
  executionId: string;
  planId: string;
}
export type HandoffPayload = Record<string, unknown> & { _handoff?: HandoffMetadata };
export interface ChainExecutionRef { stage: ChainStage | "orchestrator"; executionId: string }

export function readHandoffTrace(value: unknown): ChainExecutionRef[] {
  if (!isObject(value) || value.traceLinks == null) return [];
  if (!Array.isArray(value.traceLinks) || value.traceLinks.length > 12) throw new Error("交接执行引用过多或格式错误。");
  return value.traceLinks.map((item) => {
    if (!isObject(item) || !["orchestrator", "market", "product", "supplier", "listing", "launch", "ppc"].includes(String(item.stage)) || typeof item.executionId !== "string" || !item.executionId || item.executionId.length > 200) throw new Error("交接执行引用无效。");
    return { stage: item.stage as ChainExecutionRef["stage"], executionId: item.executionId };
  });
}

export function handoffProvenance(value: unknown): unknown {
  if (!isObject(value)) return null;
  return value._handoff ?? { legacy: true, goal: value.goal ?? value.naturalLanguageGoal ?? "", marketplace: value.marketplace ?? "" };
}

export function executionMatchesHandoff(execution: { input?: unknown } | null | undefined, payload: HandoffPayload | null) {
  if (!payload) return true;
  const input = isObject(execution?.input) ? execution.input : {};
  return JSON.stringify(input.handoff) === JSON.stringify(handoffProvenance(payload));
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const objectOrNull = { type: ["object", "null"] };
const stringSchema = { type: "string", minLength: 1 };
const fieldsByKind = {
  Opportunity: { marketOpportunity: objectOrNull, marketReport: objectOrNull },
  PRD: { productReport: objectOrNull, prd: { type: ["array", "object", "null"] } },
  SupplierShortlist: { supplierReport: objectOrNull, productReport: objectOrNull },
  ListingDraft: { listingDraft: objectOrNull, productReport: objectOrNull, supplierReport: objectOrNull },
  LaunchTicket: { launchApproval: { type: "object", required: ["approvalId", "executionId", "planId"], properties: { approvalId: stringSchema, executionId: stringSchema, planId: stringSchema } } },
  PpcPlan: { productContext: objectOrNull, launchApproval: objectOrNull, status: { enum: ["ready", "blocked_until_launch"] } },
} as const;
const outputFields: Partial<Record<HandoffKind, string>> = {
  Opportunity: "marketOpportunity", PRD: "productReport", SupplierShortlist: "supplierReport", ListingDraft: "listingDraft",
};

/** JSON schemas are also available for external producers to discover the v1 contract. */
export const handoffSchemas = Object.fromEntries(Object.entries(fieldsByKind).map(([kind, fields]) => [kind, {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: `${kind} v1`, type: "object", required: ["goal", "marketplace", "_handoff"],
  allOf: [
    ...(outputFields[kind as HandoffKind] ? [{
      if: { properties: { _handoff: { properties: { from: { not: { const: "orchestrator" } } } } } },
      then: { required: [outputFields[kind as HandoffKind]], properties: { [outputFields[kind as HandoffKind]!]: { type: "object", minProperties: 1 } } },
    }] : []),
    ...(kind === "LaunchTicket" ? [{ required: ["launchApproval"] }] : []),
    ...(kind === "PpcPlan" ? [{
      required: ["status"],
      if: { properties: { status: { const: "ready" } } },
      then: { required: ["launchApproval"], properties: { launchApproval: fieldsByKind.LaunchTicket.launchApproval } },
    }] : []),
  ],
  properties: {
    goal: stringSchema, marketplace: stringSchema, ...fields,
    traceLinks: { type: "array", maxItems: 12, items: { type: "object", required: ["stage", "executionId"], properties: { stage: { enum: ["orchestrator", "market", "product", "supplier", "listing", "launch", "ppc"] }, executionId: { type: "string", minLength: 1, maxLength: 200 } } } },
    _handoff: {
      type: "object", required: ["version", "kind", "from", "to", "organizationId", "userId", "workspaceId", "sourceExecutionId", "createdAt"],
      properties: {
        version: { const: 1 }, kind: { const: kind },
        from: { enum: ["user", "orchestrator", "market", "product", "supplier", "listing", "launch", "ppc"] },
        to: { enum: ["market", "product", "supplier", "listing", "launch", "ppc"] },
        organizationId: stringSchema, userId: stringSchema, workspaceId: stringSchema,
        sourceExecutionId: stringSchema, planId: stringSchema, createdAt: { type: "string", format: "date-time" },
      },
    },
  },
}])) as Record<string, Record<string, unknown>>;

export function parseLaunchApproval(value: unknown): LaunchApprovalReference | null {
  if (!isObject(value)) return null;
  const { approvalId, executionId, planId } = value;
  return [approvalId, executionId, planId].every((v) => typeof v === "string" && v.trim())
    ? { approvalId: approvalId as string, executionId: executionId as string, planId: planId as string } : null;
}

export function validateHandoff(value: unknown, to: ChainStage, identity: HandoffIdentity): HandoffPayload {
  if (!isObject(value)) throw new Error("交接内容必须是对象。");
  readHandoffTrace(value);
  // Old navigation payloads remain readable, but cannot supply launch authority.
  if (!("_handoff" in value)) {
    if (to === "ppc") throw new Error("PPC 全链交接需要 v1 契约与服务端 Launch 审批。");
    if (!["goal", "naturalLanguageGoal", "productReport", "marketOpportunity", "listingDraft"].some((key) => key in value)) {
      throw new Error("旧版交接缺少业务内容。");
    }
    return value;
  }
  const meta = value._handoff;
  if (!isObject(meta) || meta.version !== handoffVersion) throw new Error("不支持的交接版本。");
  if (meta.to !== to || !Object.keys(fieldsByKind).includes(String(meta.kind))) throw new Error("交接目标或类型不匹配。");
  const expectedKinds = to === "ppc" ? ["LaunchTicket", "PpcPlan"] : to === "listing" ? ["PRD", "SupplierShortlist"] : [handoffKinds[to]];
  if (!expectedKinds.includes(String(meta.kind))) throw new Error("交接类型与目标不匹配。");
  for (const key of ["organizationId", "userId", "workspaceId"] as const) {
    if (!identity[key] || meta[key] !== identity[key]) throw new Error("交接所属用户、组织或工作区已变化，请回到来源重新交接。");
  }
  if (typeof meta.sourceExecutionId !== "string" || !meta.sourceExecutionId || typeof meta.createdAt !== "string" || !Number.isFinite(Date.parse(meta.createdAt))) throw new Error("交接缺少有效执行来源或时间。");
  if (!["user", "orchestrator", "market", "product", "supplier", "listing", "launch", "ppc"].includes(String(meta.from))) throw new Error("交接来源无效。");
  if (typeof value.goal !== "string" || !value.goal.trim() || typeof value.marketplace !== "string" || !value.marketplace.trim()) throw new Error("交接缺少目标或站点。");
  for (const field of ["marketOpportunity", "marketReport", "productReport", "supplierReport", "listingDraft", "productContext"]) {
    if (value[field] != null && !isObject(value[field])) throw new Error(`交接字段 ${field} 格式错误。`);
  }
  if (value.launchApproval != null && !parseLaunchApproval(value.launchApproval)) throw new Error("Launch 审批引用格式错误。");
  if (meta.planId != null && (typeof meta.planId !== "string" || !meta.planId.trim())) throw new Error("交接计划引用无效。");
  if (value.prd != null && !isObject(value.prd) && !Array.isArray(value.prd)) throw new Error("PRD 格式错误。");
  const allowedSources: Record<ChainStage, string[]> = { market: ["user"], product: ["market"], supplier: ["product"], listing: ["product", "supplier"], launch: ["listing"], ppc: ["launch"] };
  if (meta.from !== "orchestrator" && !allowedSources[to].includes(String(meta.from))) throw new Error("交接来源与目标顺序不匹配。");
  if (meta.kind === "LaunchTicket" && !parseLaunchApproval(value.launchApproval)) throw new Error("LaunchTicket 缺少审批引用。");
  if (meta.kind === "PpcPlan" && !["ready", "blocked_until_launch"].includes(String(value.status))) throw new Error("PPC 交接状态无效。");
  if (meta.kind === "PpcPlan" && value.status === "ready" && !parseLaunchApproval(value.launchApproval)) throw new Error("PPC ready 交接缺少 Launch 审批引用。");
  // Orchestrator may prepare a not-yet-executed brief. Business handoffs require output.
  if (meta.from !== "orchestrator") {
    const field = outputFields[meta.kind as HandoffKind];
    if (field && (!isObject(value[field]) || !Object.keys(value[field]).length)) throw new Error(`业务交接缺少 ${field} 输出。`);
  }
  return value as HandoffPayload;
}

export function createHandoff(payload: Record<string, unknown>, metadata: Omit<HandoffMetadata, "version" | "createdAt">): HandoffPayload {
  const value = {
    ...payload,
    goal: payload.goal ?? payload.naturalLanguageGoal,
    _handoff: { ...metadata, version: handoffVersion, createdAt: new Date().toISOString() },
  };
  return validateHandoff(value, metadata.to, metadata);
}
