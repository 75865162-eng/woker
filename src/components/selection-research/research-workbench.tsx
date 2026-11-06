"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Run } from "@/lib/selection-research/types";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

type Summary = { id: string; status: string; input: { requirement?: string }; updatedAt: string };
export function ResearchWorkbench() {
  const [requirement, setRequirement] = useState("");
  const [marketplace, setMarketplace] = useState("US");
  const [runs, setRuns] = useState<Summary[]>([]);
  const [run, setRun] = useState<Run>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedFileId, setSavedFileId] = useState("");
  const [mode, setMode] = useState<"fixture" | "live">("fixture");
  const [availability, setAvailability] = useState<{ sellerSprite: string; ai: string; xiyou: string }>();
  const [maxMarketCalls, setMaxMarketCalls] = useState(3);
  const [billingReceipt, setBillingReceipt] = useState("");
  const [billingUnits, setBillingUnits] = useState(1);
  const [budgetLimit, setBudgetLimit] = useState(4);
  const [discovery, setDiscovery] = useState<unknown>();
  const scopeGeneration = useRef(0);
  const request = useCallback(async (url: string, body?: unknown) => {
    const response = await fetch(url, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "请求失败");
    return data;
  }, []);
  const refresh = useCallback(async () => {
    const generation = scopeGeneration.current;
    const data = await request("/api/selection-research");
    if (generation === scopeGeneration.current) { setRuns(data.runs); setAvailability(data.availability); }
  }, [request]);
  useEffect(() => {
    const changed = () => { scopeGeneration.current++; setRun(undefined); setSavedFileId(""); setError(""); setRuns([]); void refresh().catch(() => setError("工作区任务读取失败，请刷新。")); };
    void refresh().catch(() => setError("任务读取失败，请确认已登录且有 Agent 查看权限。"));
    window.addEventListener(workspaceScopeChangedEventName, changed);
    return () => { window.removeEventListener(workspaceScopeChangedEventName, changed); };
  }, [refresh]);
  async function perform(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); await refresh(); } catch (failure) { setError(failure instanceof Error ? failure.message : "操作失败"); }
    finally { setBusy(false); }
  }
  async function command(body: unknown) {
    if (!run) return;
    const generation = scopeGeneration.current;
    const data = await request(`/api/selection-research/${encodeURIComponent(run.id)}`, body);
    if (generation === scopeGeneration.current && data.run) setRun(data.run);
    if (generation === scopeGeneration.current && data.fileId) setSavedFileId(data.fileId);
  }
  // Bounded HTTP steps. A human gate stops the loop; no background task survives in the browser.
  async function drive() {
    if (!run) return;
    const generation = scopeGeneration.current;
    let next = run;
    for (let i = 0; i < (run.mode === "live" ? 1 : 30) && ["CREATED", "RESUMABLE", "RUNNING"].includes(next.status); i++) {
      if (generation !== scopeGeneration.current) break;
      const data = await request(`/api/selection-research/${encodeURIComponent(next.id)}`, { operation: "step" });
      next = data.run;
      if (generation !== scopeGeneration.current) break;
      setRun(next);
    }
  }
  const control = "rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50";
  return <div className="space-y-5">
    <button className={control} disabled={busy} onClick={() => void perform(async () => { const result = await request("/api/selection-research/discover", {}); setDiscovery(result); })}>仅发现在线工具目录（不创建任务、不取市场数据）</button>
    {discovery !== undefined && <details open><summary>在线目录发现结果</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(discovery, null, 2)}</pre></details>}
    <div className="rounded border border-slate-300 bg-slate-50 p-4 text-sm">Lili 已并入本系统，沿用当前 ERP 账号，无需单独注册或登录。SellerSprite：{availability?.sellerSprite ?? "读取中"}；AI：{availability?.ai ?? "读取中"}；西柚：{availability?.xiyou ?? "读取中"}。真实模式会先读取在线工具目录；每个市场工具调用均需审批，市场服务实际费用须逐次核对。</div>
    <form className="space-y-3 rounded border p-4" onSubmit={(event) => { event.preventDefault(); void perform(async () => {
      const generation = scopeGeneration.current;
      const data = await request("/api/selection-research", { requirement, marketplace, mode, ...(mode === "live" ? { maxMarketCalls } : {}) });
      if (generation === scopeGeneration.current) { setRun(data.run); setSavedFileId(""); if (data.discovery) setAvailability((current) => current && ({ ...current, sellerSprite: `在线目录已读取，支持 ${data.discovery.registeredReadTools.length} 个只读工具；缺失 ${data.discovery.missingCanonicalTools.join(", ") || "无"}` })); }
    }); }}>
      <label className="block font-medium" htmlFor="research-requirement">自然语言选品要求</label>
      <textarea id="research-requirement" className="min-h-28 w-full rounded border p-3" required maxLength={20000} value={requirement} onChange={(event) => setRequirement(event.target.value)} placeholder="输入产品方向、目标市场、价格带及选品要求" />
      <label className="mr-3">市场 <input aria-label="目标市场" className={control} value={marketplace} onChange={(event) => setMarketplace(event.target.value)} required maxLength={16} /></label>
      <label className="mr-3">运行模式 <select aria-label="运行模式" className={control} value={mode} onChange={(event) => setMode(event.target.value as "fixture" | "live")}><option value="fixture">隔离样本</option><option value="live">真实数据</option></select></label>
      {mode === "live" && <label className="mr-3">SellerSprite 最大调用次数 <input aria-label="最大市场调用次数" className={control} type="number" min={1} max={30} value={maxMarketCalls} onChange={(event) => setMaxMarketCalls(Number(event.target.value))} /></label>}
      <button className={control} disabled={busy || !requirement.trim()} type="submit">{mode === "live" ? "读取在线工具目录并创建真实任务" : "创建隔离样本任务"}</button>
    </form>
    {error && <p role="alert" className="rounded border border-red-300 p-3 text-red-700">{error}</p>}
    <section className="rounded border p-4"><h2 className="mb-2 font-semibold">我的研究任务（当前工作区，最近30条）</h2><div className="flex flex-wrap gap-2">{runs.map((item) => <button className={control} disabled={busy} key={item.id} onClick={() => void perform(async () => {
      const generation = scopeGeneration.current;
      const data = await request(`/api/selection-research/${encodeURIComponent(item.id)}`);
      if (generation === scopeGeneration.current) { setRun(data.run); setSavedFileId(""); }
    })}>{item.input.requirement?.slice(0, 30)} · {item.status}</button>)}</div></section>
    {run && <section className="space-y-4 rounded border p-4">
      <h2 className="font-semibold">第 {run.stage} / 5 阶段 · {run.status}</h2><p className="break-all text-sm">任务：{run.id} · 模式：{run.mode} · 调用：{run.calls.length} · 修订：{run.revision}</p>
      {run.mode === "live" && <p className="text-sm">SellerSprite 请求次数：{run.calls.filter((call) => call.provider === "sellersprite").length} / {run.limits.sellersprite ?? 0}。次数上限不代表费用金额上限；AI 模型也可能按其服务商规则计费。关闭页面后不会继续请求，可重新打开任务恢复。</p>}
      <div className="flex flex-wrap gap-2">
        {["CREATED", "RESUMABLE", "RUNNING"].includes(run.status) && <button className={control} disabled={busy} onClick={() => void perform(drive)}>{run.mode === "live" ? "继续执行一步" : "继续到下一确认节点"}</button>}
        {run.status === "FAILED" && <button className={control} disabled={busy} onClick={() => void perform(() => command({ operation: "recover" }))}>恢复失败任务</button>}
        {!["COMPLETED", "CANCELLED"].includes(run.status) && <button className={control} disabled={busy} onClick={() => void perform(() => command({ operation: "cancel" }))}>取消任务</button>}
      </div>
      {run.gate && <div className="space-y-2 rounded border border-blue-300 bg-blue-50 p-3"><h3 className="font-semibold">需要人工确认：{run.gate.kind}</h3><p>{run.gate.reason}</p>
        {run.gate.kind === "NICHE" && run.results[0]?.candidates?.map((candidate) => <button key={candidate.id} className={`${control} mr-2`} disabled={busy} onClick={() => void perform(() => command({ operation: "decide", decision: { gateId: run.gate!.id, kind: "SELECT", candidateId: candidate.id } }))}>选择：{candidate.name}</button>)}
        {run.gate.kind === "FINAL" && <button className={control} disabled={busy} onClick={() => void perform(() => command({ operation: "decide", decision: { gateId: run.gate!.id, kind: "CONFIRM" } }))}>确认研究结果，允许生成报告</button>}
        {run.gate.kind === "MCP_CALL" && run.pendingAction && <div className="w-full space-y-2"><p className="font-medium">待执行工具：{run.pendingAction.tool}。预计费用金额目前无法从在线目录确认。</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 text-xs">{JSON.stringify({ arguments: run.pendingAction.arguments, schema: run.registry.find((tool) => tool.name === run.pendingAction!.tool)?.inputSchema }, null, 2)}</pre><button className={control} disabled={busy} onClick={() => void perform(() => command({ operation: "decide", decision: { gateId: run.gate!.id, kind: "AUTHORIZE_TOOL", callId: run.pendingActionId } }))}>批准这一次请求（点击继续后执行）</button></div>}
        {run.gate.kind === "BILLING" && run.calls.some((call) => call.billing === "UNKNOWN") && <div className="flex flex-wrap items-end gap-2"><label>实际扣费单位<input aria-label="实际扣费单位" className={control} type="number" min={0} value={billingUnits} onChange={(event) => setBillingUnits(Number(event.target.value))} /></label><label>账单/扣费凭据<input aria-label="扣费凭据" className={control} value={billingReceipt} onChange={(event) => setBillingReceipt(event.target.value)} /></label><button className={control} disabled={busy || !billingReceipt.trim()} onClick={() => { const call = [...run.calls].reverse().find((entry) => entry.billing === "UNKNOWN"); if (call) void perform(() => command({ operation: "decide", decision: { gateId: run.gate!.id, kind: "RECONCILE", callId: call.id, units: billingUnits, receipt: billingReceipt } })); }}>登记实际费用并继续</button></div>}
        {run.gate.kind === "BUDGET" && <div className="flex items-end gap-2"><label>新的调用次数上限<input aria-label="新的调用次数上限" className={control} type="number" min={(run.limits.sellersprite ?? 0) + 1} value={budgetLimit} onChange={(event) => setBudgetLimit(Number(event.target.value))} /></label><button className={control} disabled={busy} onClick={() => void perform(() => command({ operation: "decide", decision: { gateId: run.gate!.id, kind: "INCREASE_BUDGET", limits: { sellersprite: budgetLimit }, toolMaxCalls: Object.fromEntries(Object.entries(run.policies).filter(([name, policy]) => run.calls.filter((call) => call.tool === name).length >= policy.maxCalls && budgetLimit > policy.maxCalls).map(([name]) => [name, budgetLimit])) } }))}>批准提高调用上限</button></div>}
      </div>}
      {run.status === "COMPLETED" && <div className="flex gap-3"><a className={control} href={`/api/selection-research/${encodeURIComponent(run.id)}/report?workspaceId=${encodeURIComponent(run.scope.workspaceId)}`}>下载单文件 HTML 报告</a><button className={control} disabled={busy} onClick={() => void perform(() => command({ operation: "export" }))}>另存到现有文件存储</button></div>}
      {(run.report?.fileId || savedFileId) && <p role="status">已保存文件：<a className="underline" href={`/api/selection-research/${encodeURIComponent(run.id)}/report/${encodeURIComponent(run.report?.fileId || savedFileId)}?workspaceId=${encodeURIComponent(run.scope.workspaceId)}`}>下载保存的 HTML 报告</a>（FileObject {run.report?.fileId || savedFileId}）</p>}
      <ol className="space-y-2">{run.results.map((result, i) => <li className="rounded bg-slate-50 p-3" key={i}><strong>阶段 {i + 1}</strong>：{result.summary} {result.verdict ?? ""}</li>)}</ol>
      <details><summary>Skill 快照、调用证据及审批记录</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(run, null, 2)}</pre></details>
    </section>}
  </div>;
}
