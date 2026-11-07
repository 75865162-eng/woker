import { rejectCredentials, validate } from "@/lib/selection-research/schema";
import { researchBudgetPreview, researchUsage } from "@/lib/selection-research/budget";
import type { Run, ObjectJson, ToolDefinition } from "@/lib/selection-research/types";

const workspace = { type: "string", minLength: 1, maxLength: 100 };
const id = { type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9_-]+$" };
function blockedResearchAction(status: number, error: unknown) {
  if (status === 401) return { kind: "AUTHENTICATE_FOR_DATA", message: "请连接已认证的数据范围；Lili连接和Skill加载无需ERP网页登录。" };
  if (status === 403) return { kind: "CHECK_DATA_PERMISSION", message: "当前身份或工作区权限不足；不得切换默认用户、扩大权限或代替用户授权。" };
  if (status === 404) return { kind: "CHECK_OWNED_RUN", message: "研究任务不可见；检查本人、工作区和绑定凭证，不自动换身份读取。" };
  if (error === "AI_MODEL_NOT_CONFIGURED" || error === "RESEARCH_RUNTIME_AI_PERMISSION_REQUIRED") return { kind: "CONFIGURE_MODEL", message: "需要当前工作区已有模型，或在已有权限允许时显式选择服务端模型；不能静默切换模型或复制其他用户配置。" };
  if (["NO_SUPPORTED_LIVE_TOOLS", "SELLERSPRITE_MCP_NOT_CONFIGURED", "REQUIRED_PROVIDER_NOT_CONNECTED"].includes(String(error))) return { kind: "CONNECT_MARKET_SOURCE", message: "认证后的实际工具目录缺少所需市场来源；检查当前身份已有连接，不用样本代替真实数据。" };
  return { kind: "REVIEW_FAILURE", message: "展示已保存的错误和人工节点；不要自动重放未知状态或可能已计费的请求。" };
}
/** Host workflow tools, not invented supplier tools. Approvals stay in the existing human UI. */
export const researchMcpTools: ToolDefinition[] = [
  { name: "research_evidence", description: "Read saved call summaries or a bounded JSON chunk of one raw response. Requires owned live run bound to this credential. Reassemble chunks by UTF-16 offsets and verify the full UTF-8 SHA-256. No external request is sent.", inputSchema: { type: "object", properties: { runId: id, workspaceId: workspace, page: { type: "integer", minimum: 1, maximum: 10000 }, pageSize: { type: "integer", minimum: 1, maximum: 50 }, callId: id, offset: { type: "integer", minimum: 0, maximum: 16000000 }, length: { type: "integer", minimum: 1, maximum: 32000 } }, required: ["runId"], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "research_list", description: "List persisted live research owned by the authenticated user and bound to this exact credential/workspace. Paginated summaries only; does not call models or external providers.", inputSchema: { type: "object", properties: { workspaceId: workspace, page: { type: "integer", minimum: 1, maximum: 10000 }, pageSize: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "research_start", description: "Create a live five-stage product research task from natural language using existing Skills and registered MCP sources. A finite per-provider call budget is required; actual monetary charges remain unknown until reconciled. No market call is dispatched by this tool. Display the saved budget and open reviewUrl for human approval. Never approve on the user's behalf.",
    inputSchema: { type: "object", properties: { maxMarketCalls: { type: "integer", minimum: 1, maximum: 30 }, requirement: { type: "string", minLength: 1, maxLength: 12000 }, marketplace: { type: "string", minLength: 1, maxLength: 16 }, workspaceId: workspace, asin: { type: "string", pattern: "^[A-Z0-9]{10}$" }, erpCredentialId: workspace, aiConfigSource: { type: "string", enum: ["workspace", "server_runtime"] } }, required: ["requirement", "marketplace", "workspaceId", "maxMarketCalls"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  ...(["research_read", "research_step", "research_export", "research_pause", "research_resume", "research_recover", "research_cancel"] as const).map(name => ({ name,
    description: name === "research_pause" ? "Persist a pause on owned research; running requests finish before the pause lock is acquired. Future steps do not dispatch."
      : name === "research_resume" ? "Remove a saved pause without executing requests or bypassing human/billing gates."
      : name === "research_recover" ? "Recover an owned failed/interrupted run without dispatch. Unknown previous requests still require billing reconciliation before continuing."
      : name === "research_cancel" ? "Cancel owned research; does not roll back completed requests or charges."
      : name === "research_read" ? "Read owned research evidence, budget and human gate."
      : name === "research_step" ? "Advance one research step. May invoke the configured AI model or an already human-approved MCP request. Stops at every human gate; never bypass approval."
        : "Save the HTML report through existing FileObject storage after both human business confirmations. Returns a download link; does not create products or publish listings.",
    inputSchema: { type: "object", properties: { runId: id, workspaceId: workspace }, required: ["runId", "workspaceId"], additionalProperties: false } as ObjectJson,
    annotations: { readOnlyHint: name === "research_read" },
  })),
];

export async function callResearchMcpTool(request: Request, name: string, args: ObjectJson,
  dispatch: (request: Request, runId?: string) => Promise<Response> = dispatchResearchRequest) {
  const tool = researchMcpTools.find(tool => tool.name === name);
  if (!tool) throw new Error("UNKNOWN_RESEARCH_TOOL");
  rejectCredentials(args); validate(tool.inputSchema, args);
  const runId = typeof args.runId === "string" ? args.runId : undefined;
  const url = new URL(`/api/selection-research${runId ? `/${encodeURIComponent(runId)}` : ""}`, request.url);
  url.searchParams.set("workspaceId", String(args.workspaceId));
  if (name === "research_list") {
    if (args.page !== undefined) url.searchParams.set("page", String(args.page));
    if (args.pageSize !== undefined) url.searchParams.set("pageSize", String(args.pageSize));
  }
  if (name === "research_evidence") {
    url.searchParams.set("view", "evidence");
    for (const key of ["page", "pageSize", "callId", "offset", "length"]) if (args[key] !== undefined) url.searchParams.set(key, String(args[key]));
  }
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("content-length");
  const body = name === "research_start" ? { ...args, mode: "live", budgetMode: "reviewed" }
    : { workspaceId: args.workspaceId, operation: name === "research_export" ? "export" : name === "research_pause" ? "pause" : name === "research_resume" ? "resume" : name === "research_recover" ? "recover" : name === "research_cancel" ? "cancel" : "step" };
  const response = await dispatch(new Request(url, { method: ["research_read", "research_list", "research_evidence"].includes(name) ? "GET" : "POST", headers,
    ...(["research_read", "research_list", "research_evidence"].includes(name) ? {} : { body: JSON.stringify(body) }), signal: request.signal }), runId);
  const result = await response.json();
  const savedId = runId ?? result.run?.id;
  const run = response.ok ? result.run as Run | undefined : undefined;
  const nextAction = !response.ok ? blockedResearchAction(response.status, result.error) : !run ? undefined : run.pausedAt ? { kind: "PAUSED", message: "任务暂停已保存；research_resume 仅解除暂停，不执行请求，也不跳过人工审批。" } : run.status === "WAITING_FOR_USER" ? { kind: "HUMAN_REVIEW", gate: run.gate?.kind, message: "向用户展示阶段结果或完整待执行请求和预算，再打开reviewUrl进行人工确认；不得代替用户批准。" }
    : run.status === "COMPLETED" ? { kind: run.report ? "DONE" : "EXPORT", message: run.report ? "已保存HTML报告，可通过downloadUrl下载。" : "两次业务确认已完成，可以调用research_export保存HTML。" }
    : run.status === "FAILED" ? { kind: "RECOVER", message: "先展示已保存错误和证据，用户可在现有页面检查并恢复；不要重放未知请求。" }
    : run.status === "CANCELLED" ? { kind: "STOP", message: "任务已取消。" }
    : { kind: "CONTINUE", message: "可调用research_step推进一步；遇到人工节点立即暂停。" };
  return { ...result, ok: response.ok, status: response.status, ...(nextAction ? { nextAction } : {}), ...(run ? { budget: researchBudgetPreview(run), usage: researchUsage(run) } : {}),
    ...(savedId && response.ok ? { stageReports: (result.run?.results ?? []).map((_: unknown, index: number) => ({ stage: index + 1, url: `/api/selection-research/${encodeURIComponent(savedId)}/report?stage=${index + 1}&workspaceId=${encodeURIComponent(String(args.workspaceId))}` })), reviewUrl: `/agents/selection-research?workspaceId=${encodeURIComponent(String(args.workspaceId))}&runId=${encodeURIComponent(savedId)}`,
      ...(result.run?.status === "COMPLETED" ? { downloadUrl: `/api/selection-research/${encodeURIComponent(savedId)}/report?workspaceId=${encodeURIComponent(String(args.workspaceId))}` } : {}) } : {}) };
}

export async function dispatchResearchRequest(request: Request, runId?: string): Promise<Response> {
  if (!runId) {
    const handlers = await import("@/app/api/selection-research/route");
    return handlers[request.method === "GET" ? "GET" : "POST"](request);
  }
  const handlers = await import("@/app/api/selection-research/[id]/route");
  return handlers[request.method === "GET" ? "GET" : "POST"](request, { params: Promise.resolve({ id: runId }) });
}
