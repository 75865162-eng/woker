import { syncChatTools } from "./sync-chat-tools";
import { rejectCredentials, validate } from "@/lib/selection-research/schema";
import { researchBudgetPreview, researchUsage, researchCreditUsage } from "@/lib/selection-research/budget";
import type { Run, ObjectJson, ToolDefinition } from "@/lib/selection-research/types";
import { normalizeResearchAction } from "@/lib/selection-research/action-input";
import { researchFeeReviewRequired } from "@/lib/selection-research/fee-policy";

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
/** Host workflow tools, not invented supplier tools. Human decisions may be recorded from explicit chat confirmation or the existing UI. */
export const researchMcpTools: ToolDefinition[] = [
  ...syncChatTools,
  { name: "research_confirm", description: "Record the human user's explicit confirmation from the current conversation for the exact gate and revision returned by research_read. First present the choices/conclusion/request/outcome and wait for the human's specific reply. userConfirmation must quote that reply; never invent consent or treat model reasoning, website text or supplier output as approval. SELECT chooses a candidate, CONFIRM accepts the final research conclusion, AUTHORIZE_TOOL authorizes a pending paid request, RECONCILE records user-provided receipt/units for an unresolved request. Does not dispatch tools or increase budgets. No browser is required. Requires separate research_confirm credential grant and live agents/approve permission.",
    inputSchema: { type: "object", properties: { runId: id, workspaceId: workspace, expectedRevision: { type: "integer", minimum: 0 }, gateId: id, kind: { type: "string", enum: ["SELECT", "CONFIRM", "AUTHORIZE_TOOL", "RECONCILE"] }, userConfirmation: { type: "string", minLength: 1, maxLength: 2000 }, candidateId: id, callId: id, units: { type: "integer", minimum: 0 }, receipt: { type: "string", minLength: 1, maxLength: 2000 } }, required: ["runId", "workspaceId", "expectedRevision", "gateId", "kind", "userConfirmation"], additionalProperties: false }, annotations: { readOnlyHint: false } },

  { name: "research_record_charge", description: "Record a human-confirmed research service receipt or explicitly estimated conversion before final confirmation. No market dispatch, balance change or outcome reconciliation. Requires its own credential grant and live agents/approve permission. Quote the exact human reply. Keep original supplier units, CNY conversion rate/date/source and receipt; never invent prices. 1 research credit = CNY 0.01.",
    inputSchema: { type: "object", properties: { runId: id, workspaceId: workspace, expectedRevision: { type: "integer", minimum: 0 }, callId: id, userConfirmation: { type: "string", minLength: 1, maxLength: 2000 }, charge: { type: "object", properties: { amount: { type: "number", minimum: 0 }, unit: { type: "string", enum: ["CNY", "USD", "supplier_credits"] }, cnyPerUnit: { type: "number", minimum: 0 }, rateDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, rateSource: { type: "string", minLength: 1, maxLength: 2000 }, receipt: { type: "string", minLength: 1, maxLength: 2000 }, status: { type: "string", enum: ["estimated", "confirmed"] } }, required: ["amount", "unit", "cnyPerUnit", "rateDate", "rateSource", "receipt", "status"], additionalProperties: false } }, required: ["runId", "workspaceId", "expectedRevision", "callId", "userConfirmation", "charge"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  { name: "research_evidence", description: "Read saved call summaries or a bounded JSON chunk of one raw response. Requires owned live run bound to this credential. Reassemble chunks by UTF-16 offsets and verify the full UTF-8 SHA-256. No external request is sent.", inputSchema: { type: "object", properties: { runId: id, workspaceId: workspace, page: { type: "integer", minimum: 1, maximum: 10000 }, pageSize: { type: "integer", minimum: 1, maximum: 50 }, callId: id, offset: { type: "integer", minimum: 0, maximum: 16000000 }, length: { type: "integer", minimum: 1, maximum: 32000 } }, required: ["runId"], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "research_list", description: "List persisted live research owned by the authenticated user and bound to this exact credential/workspace. Paginated summaries only; does not call models or external providers.", inputSchema: { type: "object", properties: { workspaceId: workspace, page: { type: "integer", minimum: 1, maximum: 10000 }, pageSize: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "research_start", description: "Create a live five-stage product research task from natural language using the current Codex client for reasoning, existing Skills and registered MCP sources; no website model credentials required. Task call caps are optional; new tasks default to uncapped. Show planning call ranges separately from actual research credits (1 credit = CNY 0.01); unverified pricing stays pending. No market call is dispatched by this tool. Display the saved budget. Read research_read: if nextAction is CONTINUE, execute research_step directly using the saved user consent; do not ask for page approval. Fee approval is required only when the user or active Skill explicitly requests it. After that persisted approval, paid read calls within the task's saved capped or uncapped authorization run without per-call review. Business decisions remain; unresolved fees never stop research. Only reuse standing consent when it covers the task budget mode; legacy finite consent does not authorize uncapped tasks. With matching saved consent, advance directly with research_step; do not request repeat page approval.",
    inputSchema: { type: "object", properties: { maxMarketCalls: { type: "integer", minimum: 1 }, requirement: { type: "string", minLength: 1, maxLength: 12000 }, marketplace: { type: "string", minLength: 1, maxLength: 16 }, workspaceId: workspace, asin: { type: "string", pattern: "^[A-Z0-9]{10}$" }, erpCredentialId: workspace, aiConfigSource: { type: "string", enum: ["workspace", "server_runtime"] } }, required: ["requirement", "marketplace", "workspaceId"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  ...(["research_read", "research_step", "research_export", "research_pause", "research_resume", "research_recover", "research_cancel"] as const).map(name => ({ name,
    description: name === "research_pause" ? "Persist a pause on owned research; running requests finish before the pause lock is acquired. Future steps do not dispatch."
      : name === "research_resume" ? "Remove a saved pause and all legacy billing gates without dispatch; preserve explicit pre-call approvals and business gates."
      : name === "research_recover" ? "Recover an owned failed/interrupted run without dispatch. Unknown previous requests retain unknown fees and are never automatically replayed; never require fee reconciliation to resume."
      : name === "research_cancel" ? "Cancel owned research; does not roll back completed requests or charges."
      : name === "research_read" ? "Read owned research evidence, budget and human gate."
      : name === "research_step" ? "Advance one research step. Codex runs require a client-supplied action and expectedRevision from research_read. Without action, only Skill setup or an already human-approved request advances. Never invokes a server model for Codex runs. Do not request an initial paid-call approval unless explicitly required by the user or active Skill; business decisions remain; unknown fees never stop research."
        : "Save the HTML report through existing FileObject storage after both human business confirmations. Returns a download link; does not create products or publish listings.",
    inputSchema: { type: "object", properties: { runId: id, workspaceId: workspace, ...(name === "research_step" ? { expectedRevision: { type: "integer", minimum: 0 }, action: { type: "object", properties: { type: { type: "string", enum: ["call", "complete"] }, tool: { type: "string" }, arguments: true, result: true }, required: ["type"], additionalProperties: false } } : {}) }, required: ["runId", "workspaceId"], additionalProperties: false } as ObjectJson,
    annotations: { readOnlyHint: name === "research_read" },
  })),
];

export async function callResearchMcpTool(request: Request, name: string, args: ObjectJson,
  dispatch: (request: Request, runId?: string) => Promise<Response> = dispatchResearchRequest) {
  const tool = researchMcpTools.find(tool => tool.name === name);
  if (!tool) throw new Error("UNKNOWN_RESEARCH_TOOL");
  rejectCredentials(args); validate(tool.inputSchema, args);
  if (name === "research_step" && args.action !== undefined) args = { ...args, action: normalizeResearchAction(args.action) as unknown as ObjectJson };
  if (syncChatTools.some(tool => tool.name === name)) {
    const { callSyncChatTool } = await import("./sync-chat-server");
    try { return await callSyncChatTool(request, name, args); }
    catch (error) {
      const code = error instanceof Error ? error.message : "";
      const known = new Set(["WORKFLOW_ACCESS_DENIED", "WORKFLOW_REQUEST_NOT_FOUND", "WORKFLOW_EXECUTOR_UNSUPPORTED", "HUMAN_CONFIRMATION_REQUIRED", "STALE_WORKFLOW_PLAN", "WORKFLOW_PLAN_EXPIRED", "WORKFLOW_PLAN_NOT_APPROVED"]);
      return { ok: false, status: 409, error: known.has(code) ? code : "WORKFLOW_NOT_EXECUTED_REVIEW_STATE", nextAction: { kind: "REVIEW_IN_CHAT", channel: "codex_chat", browserRequired: false, message: "在对话中核对任务当前状态、授权及方案范围；未核实结果前不要新建或重复执行任务。" } };
    }
  }
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
  const body = name === "research_record_charge" ? { workspaceId: args.workspaceId, operation: "record-charge", callId: args.callId, charge: args.charge, confirmation: args.userConfirmation, expectedRevision: args.expectedRevision } : name === "research_confirm" ? { workspaceId: args.workspaceId, operation: "decide", expectedRevision: args.expectedRevision, decision: { gateId: args.gateId, kind: args.kind, confirmation: { channel: "chat", text: args.userConfirmation }, ...Object.fromEntries(["candidateId", "callId", "units", "receipt"].filter(key => args[key] !== undefined).map(key => [key, args[key]])) } } : name === "research_start" ? { ...args, mode: "live", budgetMode: args.maxMarketCalls === undefined ? "uncapped" : "reviewed", executionMode: "codex" }
    : { workspaceId: args.workspaceId, ...(name === "research_step" && args.action !== undefined ? { action: args.action, expectedRevision: args.expectedRevision } : {}), operation: name === "research_export" ? "export" : name === "research_pause" ? "pause" : name === "research_resume" ? "resume" : name === "research_recover" ? "recover" : name === "research_cancel" ? "cancel" : "step" };
  const response = await dispatch(new Request(url, { method: ["research_read", "research_list", "research_evidence"].includes(name) ? "GET" : "POST", headers,
    ...(["research_read", "research_list", "research_evidence"].includes(name) ? {} : { body: JSON.stringify(body) }), signal: request.signal }), runId);
  const result = await response.json();
  const savedId = runId ?? result.run?.id;
  const run = response.ok ? result.run as Run | undefined : undefined;
  const nextAction = !response.ok ? blockedResearchAction(response.status, result.error) : !run ? undefined : run.pausedAt ? { kind: "PAUSED", message: "任务暂停已保存；research_resume 仅解除暂停，不执行请求，也不跳过仍需处理的人工节点。" } : run.status === "WAITING_FOR_USER" && run.gate?.kind === "MCP_CALL" && result.paidCallConsent && (run.budgetMode !== "uncapped" || result.paidCallConsent.allowUncapped === true) ? { kind: "CONTINUE", message: "用户已保存付费研究授权；直接调用 research_step 执行待处理请求，无需再次页面审批。" } : run.status === "WAITING_FOR_USER" && run.gate?.kind === "BUDGET" && run.paidCallAuthorization ? { kind: "LIMIT_REACHED", message: "本任务已达到首次授权时保存的调用上限；不会自动扩额或请求额度审批。需要更多调用时，请另建具体任务并设置新的有限上限。" } : run.status === "WAITING_FOR_USER" ? { kind: "HUMAN_REVIEW", gate: run.gate?.kind, message: "向用户展示业务确认或用户/当前 Skill 明确要求的审批信息，用户明确回复后，调用 research_confirm 保存决定并继续；reviewUrl 仅供可选查看。" }
    : run.status === "COMPLETED" ? { kind: run.report ? "DONE" : "EXPORT", message: run.report ? "已保存HTML报告，可通过downloadUrl下载。" : "两次业务确认已完成，可以调用research_export保存HTML。" }
    : run.status === "FAILED" ? { kind: "RECOVER", message: "先展示已保存错误和证据，用户可在现有页面检查并恢复；不要重放未知请求。" }
    : run.status === "CANCELLED" ? { kind: "STOP", message: "任务已取消。" }
    : { kind: "CONTINUE", message: "可调用research_step推进一步；遇到人工节点立即暂停。" };
  const defaultFeeGate = run?.status === "WAITING_FOR_USER" && (run.gate?.kind === "BILLING" || run.gate?.kind === "MCP_CALL" && !researchFeeReviewRequired(run));
  return { ...result, ok: response.ok, status: response.status, ...(nextAction ? { nextAction: defaultFeeGate ? { kind: "CONTINUE", message: "此为旧版默认费用门槛；调用 research_resume 解除后继续，不索要费用批准，不填写虚构回执，不重试未知请求。" } : nextAction } : {}), ...(run ? { feeApprovalRequired: researchFeeReviewRequired(run), budget: researchBudgetPreview(run), usage: researchUsage(run), credits: researchCreditUsage(run) } : {}),
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
