"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Run } from "@/lib/selection-research/types";
import type { ResearchReadiness } from "@/lib/selection-research/preflight";
import type { ResearchAiSource } from "@/lib/selection-research/ai-settings";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { researchBudgetPreview, researchUsage, researchCreditUsage } from "@/lib/selection-research/budget";
import { researchValidationMessages } from "@/lib/selection-research/validation-feedback";
import { ResearchResults } from "./research-results";
import { ResearchChargeForm } from "./research-charge-form";
import { ResearchAudit } from "./research-audit";

type Summary = { id: string; status: string; input: { requirement?: string }; updatedAt: string };
const failureMessages: Record<string, string> = {
  APPROVED_SCHEMA_CHANGED: "工具参数定义已改变，原请求未执行。恢复后必须重新审阅请求。",
  REQUIRED_PROVIDER_EVIDENCE_MISSING: "缺少 ERP、SellerSprite 或西柚的成功证据，不能完成本阶段。",
  TOOL_UNAVAILABLE_OR_FORBIDDEN: "工具不可用或无权调用，请检查当前工作区的连接和授权。",
  RUNTIME_TOOL_UNAVAILABLE_OR_FORBIDDEN: "发送前检查发现工具不可用或授权已撤回，业务请求未发送。修复连接后可手动恢复并重新审批。",
  INVALID_TOOL_ARGUMENTS: "发送前检查发现参数不符合工具 Schema，业务请求未发送，请核对执行记录后恢复。",
  UNSUPPORTED_TOOL_SCHEMA: "当前工具 Schema 含未支持的约束，业务请求未发送，需要修复适配器后再恢复。",
  DUPLICATE_CALL_REQUIRES_REVIEW: "检测到重复请求，已停止，避免重复调用或扣费。",
  RESEARCH_AI_NOT_CONFIGURED: "当前工作区缺少 AI 模型配置，请在 ERP 设置中选择已有模型。",
  RESEARCH_AI_REQUEST_FAILED: "AI 服务请求失败，证据已保留。请检查模型服务后再手动恢复。",
  RESEARCH_CONTEXT_TOO_LARGE_REQUIRES_REVIEW: "证据超过模型上下文上限，需要人工审阅，未自动截断证据。",
  RESEARCH_ACTION_TIMEOUT: "本步骤超时。请核对执行记录后再恢复，避免重复请求。",
  GO_REQUIRES_RESOLVED_ASSUMPTIONS: "仍有未验证假设或估算，不能生成 GO 结论。",
};
function rememberRun(id?: string) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("runId", id); else url.searchParams.delete("runId");
  window.history.replaceState(null, "", url);
}
export function ResearchWorkbench() {
  const [asin, setAsin] = useState("");
  const [erpCredentialId, setErpCredentialId] = useState("");
  const [requirement, setRequirement] = useState("");
  const [marketplace, setMarketplace] = useState("US");
  const [runs, setRuns] = useState<Summary[]>([]);
  const [run, setRun] = useState<Run>();
  const [busy, setBusy] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState("");
  const [savedFileId, setSavedFileId] = useState("");
  const [mode, setMode] = useState<"fixture" | "live">("live");
  const [aiConfigSource, setAiConfigSource] = useState<ResearchAiSource>("workspace");
  const [availability, setAvailability] = useState<{ sellerSprite: string; ai: string; xiyou: string; erp?: string }>();
  const [maxMarketCalls, setMaxMarketCalls] = useState<number | undefined>();
  const budgetMode = maxMarketCalls === undefined ? "uncapped" : "reviewed";
  const [budgetLimit, setBudgetLimit] = useState(4);
  const [discovery, setDiscovery] = useState<{ providers?: { provider: string; status: string; toolCount: number; reason?: string }[]; tools?: unknown[]; readiness?: ResearchReadiness; aiModel?: { provider: string; model: string } }>();
  const scopeGeneration = useRef(0);
  const stopRequested = useRef(false);
  const showRun = useCallback((next: Run) => { setRun(next); setSavedFileId(next.report?.fileId ?? ""); rememberRun(next.id); }, []);
  const request = useCallback(async (url: string, body?: unknown) => {
    const response = await fetch(url, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(`${data.error || "请求失败"}${data.providers ? " · " + data.providers.map((p: { provider: string; reason?: string; status: string }) => `${p.provider}: ${p.reason ?? p.status}`).join("；") : ""}`);
    return data;
  }, []);
  const refresh = useCallback(async () => {
    const generation = scopeGeneration.current;
    const data = await request("/api/selection-research");
    if (generation === scopeGeneration.current) { setRuns(data.runs); setAvailability(data.availability); }
  }, [request]);
  useEffect(() => {
    let disposed = false;
    const invalidate = () => { scopeGeneration.current++; stopRequested.current = true; };
    const initialize = async (restore: boolean) => {
      const generation = scopeGeneration.current;
      const id = restore ? new URL(window.location.href).searchParams.get("runId") : null;
      // A failed history/availability request must not hide an independently authorized saved run.
      const active = () => !disposed && generation === scopeGeneration.current;
      let historyFailed = false, restored = false;
      const history = refresh().catch(() => {
        historyFailed = true;
        if (active() && (!id || restored)) setError(id ? "历史列表暂时读取失败；当前任务已恢复，可查看已保存结果。" : "历史列表读取失败，请确认当前工作区与查看权限后重试。");
      });
      const current = id ? request(`/api/selection-research/${encodeURIComponent(id)}`).then(data => {
        if (!active()) return;
        restored = true; showRun(data.run);
        if (historyFailed) setError("历史列表暂时读取失败；当前任务已恢复，可查看已保存结果。");
      }).catch(() => { if (active()) setError("任务读取失败，请确认当前工作区与查看权限后重试。"); }) : Promise.resolve();
      await Promise.all([history, current]);
    };
    const changed = () => { invalidate(); setRun(undefined); setSavedFileId(""); setError(""); setRuns([]); setDiscovery(undefined); setAvailability(undefined); setErpCredentialId(""); setBusy(false); setAdvancing(false); rememberRun(); void initialize(false); };
    void initialize(true);
    window.addEventListener(workspaceScopeChangedEventName, changed);
    return () => { disposed = true; invalidate(); window.removeEventListener(workspaceScopeChangedEventName, changed); };
  }, [refresh, request, showRun]);
  async function perform(work: () => Promise<void>) {
    const generation = scopeGeneration.current;
    setBusy(true); setError("");
    try { await work(); if (generation === scopeGeneration.current) await refresh(); } catch (failure) { if (generation === scopeGeneration.current) setError(failure instanceof Error ? failure.message : "操作失败"); }
    finally { if (generation === scopeGeneration.current) setBusy(false); }
  }
  async function command(body: unknown) {
    if (!run) return;
    const generation = scopeGeneration.current;
    const data = await request(`/api/selection-research/${encodeURIComponent(run.id)}`, body);
    if (generation === scopeGeneration.current && data.run) showRun(data.run);
    if (generation === scopeGeneration.current && data.fileId) setSavedFileId(data.fileId);
    if (generation === scopeGeneration.current && data.run?.status === "COMPLETED" && !data.run.report && (body as { operation?: string }).operation === "decide") {
      try {
        const saved = await request(`/api/selection-research/${encodeURIComponent(run.id)}`, { operation: "export" });
        if (generation === scopeGeneration.current) { showRun(saved.run); setSavedFileId(saved.fileId); }
      } catch { throw new Error("研究已完成，但报告保存失败。审批和证据已保留，请点击“保存 HTML 报告”重试。"); }
    } else if (generation === scopeGeneration.current && data.run && (body as { operation?: string }).operation === "decide") {
      await drive(data.run);
    }
  }
  // Bounded HTTP steps. A human gate stops the loop; no background task survives in the browser.
  async function drive(initial = run) {
    if (!initial) return;
    const generation = scopeGeneration.current;
    let next = initial;
    stopRequested.current = false; setAdvancing(true);
    try {
      for (let i = 0; i < 30 && !next.pausedAt && ["CREATED", "RESUMABLE", "RUNNING"].includes(next.status); i++) {
        if (generation !== scopeGeneration.current || stopRequested.current) break;
        const data = await request(`/api/selection-research/${encodeURIComponent(next.id)}`, { operation: "step" });
        next = data.run;
        if (generation !== scopeGeneration.current) break;
        showRun(next);
        if (next.executionMode === "codex") break;
      }
    } finally { if (generation === scopeGeneration.current) setAdvancing(false); }
  }
  const control = "rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50";
  return <div className="space-y-5">
    <button className={control} disabled={busy} onClick={() => void perform(async () => { const generation = scopeGeneration.current; const result = await request("/api/selection-research/discover", { erpCredentialId, asin, requirement, marketplace, maxMarketCalls, budgetMode, aiConfigSource }); if (generation === scopeGeneration.current) setDiscovery(result); })}>检查工具与启动条件（不创建任务、不取市场数据）</button>
    {discovery?.providers && <div className="rounded border p-3 text-sm" role="status">{discovery.providers.map(provider => <p key={provider.provider}>{provider.provider}：{provider.status} · {provider.toolCount} 个真实工具 {provider.reason ? `· ${provider.reason}` : ""}</p>)}</div>}
    {discovery?.readiness && <section className="space-y-2 rounded border p-3 text-sm" aria-label="真实研究启动检查">
      <h2 className="font-semibold">{discovery.readiness.ready ? "连接配置与输入检查通过" : "真实研究尚有阻塞项"}</h2>
      <p>这是本次检查结果，修改输入后请重新检查。配置存在不代表模型调用已成功；检查不会创建任务、请求模型或调用市场业务数据。</p>
      <ul>{discovery.readiness.checks.map(check => <li key={check.id} className={check.status === "blocked" ? "text-red-700" : "text-slate-700"}>{check.id} · {check.status === "ready" ? "通过" : "未就绪"}：{check.message}</li>)}</ul>
      {discovery.aiModel && <p>所选模型：{discovery.aiModel.provider} / {discovery.aiModel.model}</p>}
    </section>}
    {discovery !== undefined && <details><summary>在线目录发现结果</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(discovery, null, 2)}</pre></details>}
    <div className="rounded border border-slate-300 bg-slate-50 p-4 text-sm">Lili 已并入本系统，沿用当前 ERP 账号，无需单独注册或登录。ERP：{availability?.erp ?? "请发现在线目录"}；SellerSprite：{availability?.sellerSprite ?? "读取中"}；AI：{run?.executionMode === "codex" ? "当前 Codex 会话" : availability?.ai ?? "读取中"}；西柚：{availability?.xiyou ?? "读取中"}。真实任务首次批准后，后续付费市场查询在本任务调用上限内自动执行，并逐笔保存请求与费用状态；供应商费用未知，不表示免费。选品、最终结论等业务确认仍会暂停。</div>
    <p className="text-sm">单站点、一个细分市场规划约18–30次：筛选8–10次、深研6–10次、评论4–8次、关税通常0次、决策0–2次。规划不是硬上限或供应商报价；研究积分1积分=¥0.01。</p>
    <form className="space-y-3 rounded border p-4" onSubmit={(event) => { event.preventDefault(); void perform(async () => {
      const generation = scopeGeneration.current;
      const data = await request("/api/selection-research", { requirement, marketplace, mode, asin: asin.trim().toUpperCase() || undefined, erpCredentialId: erpCredentialId || undefined, ...(mode === "live" ? { maxMarketCalls, budgetMode, aiConfigSource } : {}) });
      if (generation === scopeGeneration.current) { showRun(data.run); if (data.discovery) setAvailability((current) => current && ({ ...current, sellerSprite: `在线目录已读取，支持 ${data.discovery.registeredReadTools.length} 个只读工具；缺失 ${data.discovery.missingCanonicalTools.join(", ") || "无"}` })); }
    }); }}>
      <label className="block">目标 ASIN（指定商品研究时填写）<input aria-label="目标 ASIN" className={control} value={asin} maxLength={10} pattern="[A-Za-z0-9]{10}" onChange={event => setAsin(event.target.value.toUpperCase())} placeholder="B0XXXXXXXX" /></label>
      <label className="block">ERP MCP 凭证 ID（存在多个授权时必填）<input aria-label="ERP MCP 凭证 ID" className={control} value={erpCredentialId} maxLength={100} onChange={event => setErpCredentialId(event.target.value)} placeholder="使用现有个人授权，不填 Token" /></label>
      <label className="block font-medium" htmlFor="research-requirement">自然语言选品要求</label>
      <textarea id="research-requirement" className="min-h-28 w-full rounded border p-3" required maxLength={20000} value={requirement} onChange={(event) => setRequirement(event.target.value)} placeholder="输入产品方向、目标市场、价格带及选品要求" />
      <label className="mr-3">市场 <input aria-label="目标市场" className={control} value={marketplace} onChange={(event) => setMarketplace(event.target.value)} required maxLength={16} /></label>
      <label className="mr-3">运行模式 <select aria-label="运行模式" className={control} value={mode} onChange={(event) => setMode(event.target.value as "fixture" | "live")}><option value="fixture">隔离样本</option><option value="live">真实数据</option></select></label>
      {mode === "live" && <label className="mr-3">AI 模型来源 <select aria-label="AI 模型来源" className={control} value={aiConfigSource} onChange={event => { setAiConfigSource(event.target.value as ResearchAiSource); setDiscovery(undefined); }}><option value="workspace">当前工作区已有配置</option><option value="server_runtime">已有服务端模型（需设置编辑权限）</option></select></label>}
      {mode === "live" && <label className="mr-3">每个外部来源最大调用次数（留空不限额） <input aria-label="最大市场调用次数" className={control} type="number" min={1} value={maxMarketCalls ?? ""} placeholder="不限额" onChange={(event) => { setMaxMarketCalls(event.target.value === "" ? undefined : Number(event.target.value)); setDiscovery(undefined); }} /></label>}
      <button className={control} disabled={busy || !requirement.trim()} type="submit">{mode === "live" ? "读取在线工具目录并创建真实任务" : "创建隔离样本任务"}</button>
    </form>
    {error && <p role="alert" className="rounded border border-red-300 p-3 text-red-700">{error}</p>}
    <section className="rounded border p-4"><h2 className="mb-2 font-semibold">我的研究任务（当前工作区，最近30条）</h2><div className="flex flex-wrap gap-2">{runs.map((item) => <button className={control} disabled={busy} key={item.id} onClick={() => void perform(async () => {
      const generation = scopeGeneration.current;
      const data = await request(`/api/selection-research/${encodeURIComponent(item.id)}`);
      if (generation === scopeGeneration.current) showRun(data.run);
    })}>{item.input.requirement?.slice(0, 30)} · {item.status}</button>)}</div></section>
    {run && <section className="space-y-4 rounded border p-4">
      <h2 className="font-semibold">第 {run.stage} / 5 阶段 · {run.status}</h2><p className="break-all text-sm">任务：{run.id} · 模式：{run.mode} · 调用记录：{run.calls.length} · 修订：{run.revision}</p>
      {run.brief && <details><summary>任务解析与待确认约束</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(run.brief, null, 2)}</pre></details>}
      {run.aiModel && <p className="text-sm">任务保存的模型：{run.aiModel.provider} / {run.aiModel.model} · 来源：{run.executionMode === "codex" ? "当前 Codex 会话（不调用网站模型）" : run.aiConfigSource === "server_runtime" ? "已有服务端模型" : "当前工作区配置"}</p>}
      {run.status === "FAILED" && <p role="alert" className="rounded border border-red-300 p-3 text-red-700">{researchValidationMessages[run.failure ?? ""] ?? failureMessages[run.failure ?? ""] ?? "本步骤失败，已保留现有证据。请检查执行记录后手动恢复。"}{run.validationFeedback && run.validationFeedback.code === run.failure && run.validationFeedback.path && <> 字段：<code>{run.validationFeedback.path}</code></>}</p>}
      {run.planningPause && run.pausedAt && <p role="status">{run.planningPause.reason} 阶段 {run.planningPause.stage} 已调用 {run.planningPause.calls} 次。</p>}
      {run.calls.some((call) => call.dispatch === "NOT_SENT") && <p className="text-sm">已保留发送前拦截记录：{run.calls.filter((call) => call.dispatch === "NOT_SENT").length} 条；这些业务请求未发送，不占用调用预算。修复原因并恢复时，失效的授权需重新确认。</p>}
      {run.paidCallAuthorization && <p className="text-sm">首次付费授权：{run.paidCallAuthorization.approvedAt} · 操作者 ID：{run.paidCallAuthorization.approvedByUserId}。后续付费市场请求引用此授权；每次请求仍单独记录。授权只属于此任务，不跨任务或工作区。</p>}
      {run.mode === "live" && run.budgetMode !== "mock_unlimited" && <p className="text-sm">SellerSprite 请求次数：{run.calls.filter((call) => call.provider === "sellersprite" && call.dispatch !== "NOT_SENT").length} / {run.budgetMode === "uncapped" ? "不限额" : run.limits.sellersprite ?? 0}；西柚请求次数：{run.calls.filter((call) => call.provider === "xiyou" && call.dispatch !== "NOT_SENT").length} / {run.budgetMode === "uncapped" ? "不限额" : run.limits.xiyou ?? 0}。次数上限不代表费用金额上限；AI 模型也可能按其服务商规则计费。授权后自动推进到业务确认节点，遇到特定业务确认时暂停；费用未知或未确认不会暂停，结果不明的请求保留记录且不自动重试；可以主动暂停后续步骤。关闭页面后不会继续请求，可重新打开任务恢复。</p>}
      <div className="flex flex-wrap gap-2">
        {["CREATED", "RESUMABLE", "RUNNING"].includes(run.status) && <button className={control} disabled={busy} onClick={() => void perform(() => drive())}>继续到下一确认节点</button>}
        {advancing && <button className={control} onClick={() => { stopRequested.current = true; }}>暂停后续步骤</button>}
        {!["COMPLETED", "CANCELLED"].includes(run.status) && <button className={control} disabled={busy} onClick={() => void perform(() => command({ operation: run.pausedAt ? "resume" : "pause" }))}>{run.pausedAt ? "解除暂停（保留审批节点）" : "暂停任务"}</button>}
        {run.pausedAt && <span role="status">任务已暂停；暂停状态保存到服务端。</span>}
        {run.status === "FAILED" && <button className={control} disabled={busy} onClick={() => void perform(() => command({ operation: "recover" }))}>恢复失败任务</button>}
        {!["COMPLETED", "CANCELLED"].includes(run.status) && <button className={control} disabled={busy} onClick={() => void perform(() => command({ operation: "cancel" }))}>取消任务</button>}
      </div>
      <ResearchResults key={`results-${run.id}`} run={run} />
      {run.gate && <div className="space-y-2 rounded border border-blue-300 bg-blue-50 p-3"><h3 className="font-semibold">{run.gate.kind === "BUDGET" && run.paidCallAuthorization ? "任务调用上限已达" : run.gate.kind === "BILLING" ? "旧版费用暂停（可直接解除）" : `需要人工确认：${run.gate.kind}`}</h3><p>{run.gate.reason}</p>
        {run.gate.kind === "NICHE" && run.results[0]?.candidates?.map((candidate) => <button key={candidate.id} className={`${control} mr-2`} disabled={busy} onClick={() => void perform(() => command({ operation: "decide", decision: { gateId: run.gate!.id, kind: "SELECT", candidateId: candidate.id } }))}>选择：{candidate.name}</button>)}
        {run.gate.kind === "FINAL" && <button className={control} disabled={busy} onClick={() => void perform(() => command({ operation: "decide", decision: { gateId: run.gate!.id, kind: "CONFIRM" } }))}>确认研究结果，允许生成报告</button>}
        {run.gate.kind === "MCP_CALL" && run.pendingAction && <div className="w-full space-y-2"><p className="font-medium">待执行工具：{run.pendingAction.tool}。预计调用 1 次；研究积分待核实。首次批准后，本研究任务后续付费市场请求会按以下授权自动运行；每次请求仍会单独记录。业务确认仍需人工处理。</p><p>本任务授权范围：{run.budgetMode === "uncapped" ? "当前站点及五阶段只读研究，任务次数不限额" : Object.entries(run.limits).map(([provider, limit]) => `${provider} ${limit} 次`).join(" · ") || "无其他付费来源"}。单工具上限：{run.budgetMode === "uncapped" ? "不限额（仍校验已授权工具与参数）" : Object.entries(run.policies).filter(([, policy]) => policy.paid).map(([tool, policy]) => `${tool} ${policy.maxCalls} 次`).join(" · ") || "按当前已发现目录"}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 text-xs">{JSON.stringify({ arguments: run.pendingAction.arguments, schema: run.registry.find((tool) => tool.name === run.pendingAction!.tool)?.inputSchema }, null, 2)}</pre><button className={control} disabled={busy} onClick={() => void perform(() => command({ operation: "decide", decision: { gateId: run.gate!.id, kind: "AUTHORIZE_TOOL", callId: run.pendingActionId } }))}>批准本任务的付费查询并执行首笔</button></div>}
        {run.gate.kind === "BILLING" && <div className="space-y-2">
          <p>这是旧版费用暂停。无需确认金额或填写回执；恢复后保留未知费用记录，不重试原请求。</p>
          <button className={control} disabled={busy} onClick={() => void perform(() => command({ operation: "resume" }))}>解除旧费用暂停</button>
        </div>}
        {run.gate.kind === "BUDGET" && (run.paidCallAuthorization ? <p className="text-sm">本任务已达到已批准的硬调用上限；系统不会再申请额度审批或自动扩额。需要更多调用时，请新建任务并设置更高上限。</p> : <div className="flex items-end gap-2"><label>新的调用次数上限<input aria-label="新的调用次数上限" className={control} type="number" min={(run.limits.sellersprite ?? 0) + 1} value={budgetLimit} onChange={(event) => setBudgetLimit(Number(event.target.value))} /></label><button className={control} disabled={busy} onClick={() => void perform(() => command({ operation: "decide", decision: { gateId: run.gate!.id, kind: "INCREASE_BUDGET", limits: Object.fromEntries(Object.keys(run.limits).filter(provider => budgetLimit > run.limits[provider]).map(provider => [provider, budgetLimit])), toolMaxCalls: Object.fromEntries(Object.entries(run.policies).filter(([name, policy]) => run.calls.filter((call) => call.tool === name && call.dispatch !== "NOT_SENT").length >= policy.maxCalls && budgetLimit > policy.maxCalls).map(([name]) => [name, budgetLimit])) } }))}>批准提高调用上限</button></div>)}
      </div>}
      {run.mode === "live" && <details open={run.gate?.kind === "MCP_CALL"}><summary>阶段预算与真实调用用量</summary><p>{researchBudgetPreview(run).message}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ budget: researchBudgetPreview(run), usage: researchUsage(run), researchCredits: researchCreditUsage(run) }, null, 2)}</pre></details>}
      <ResearchChargeForm key={`charge-${run.id}`} run={run} busy={busy} save={entry => void perform(() => command({ operation: "record-charge", ...entry }))} />
      <ResearchAudit key={`audit-${run.id}`} run={run} />
      {run.status === "COMPLETED" && <div className="flex gap-3"><a className={control} href={`/api/selection-research/${encodeURIComponent(run.id)}/report?workspaceId=${encodeURIComponent(run.scope.workspaceId)}`}>下载单文件 HTML 报告</a><button className={control} disabled={busy} onClick={() => void perform(() => command({ operation: "export" }))}>保存 HTML 报告</button></div>}
      {(run.report?.fileId || savedFileId) && <p role="status">已保存文件：<a className="underline" href={`/api/selection-research/${encodeURIComponent(run.id)}/report/${encodeURIComponent(run.report?.fileId || savedFileId)}?workspaceId=${encodeURIComponent(run.scope.workspaceId)}`}>下载保存的 HTML 报告</a>（FileObject {run.report?.fileId || savedFileId}）</p>}
      <details><summary>Skill 快照、调用证据及审批记录</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(run, null, 2)}</pre></details>
    </section>}
  </div>;
}
