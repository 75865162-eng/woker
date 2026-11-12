"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import type { readOrderFulfillmentRecoveryHistory, readOrderFulfillmentRecoveryPages, readOrderFulfillmentRecoveryPreview } from "@/lib/amazon-sync/order-fulfillment-recovery";

type Preview = Awaited<ReturnType<typeof readOrderFulfillmentRecoveryPreview>>;
export function OrderFulfillmentRecoveryPanel({ sourceId, taskId, sellerName, marketplaceId, busy, requestHeaders, requestApproval, openApprovals }: {
  sourceId: string; taskId: string; sellerName: string; marketplaceId: string; busy: boolean;
  requestHeaders: () => Headers; requestApproval: (command: Record<string, unknown>) => Promise<boolean>; openApprovals: () => void;
}) {
  const [pages, setPages] = useState(""), [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState(""), [submitted, setSubmitted] = useState(false), [working, setWorking] = useState(false);
  const [batch, setBatch] = useState<Awaited<ReturnType<typeof readOrderFulfillmentRecoveryPages>> | null>(null);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof readOrderFulfillmentRecoveryHistory>> | null>(null);
  const sequence = useRef(0), pending = useRef<AbortController | null>(null), previewWorkspace = useRef("");
  function invalidate() { ++sequence.current; pending.current?.abort(); setPreview(null); setSubmitted(false); setError(""); setWorking(false); }
  useEffect(() => {
    const generation = sequence, request = pending;
    const reset = () => { ++sequence.current; pending.current?.abort(); setPreview(null); setSubmitted(false); setError(""); setWorking(false); setPages(""); setBatch(null); setHistory(null); };
    reset(); window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => { ++generation.current; request.current?.abort(); window.removeEventListener(workspaceScopeChangedEventName, reset); };
  }, [sourceId, taskId]);
  async function loadHistory() {
    invalidate(); setHistory(null);
    const n = sequence.current, controller = new AbortController(); pending.current = controller;
    const headers = requestHeaders(), workspace = headers.get("x-workspace-id") ?? "";
    setWorking(true);
    try {
      const params = new URLSearchParams({ section: "order-fulfillment-history", sourceId, taskId });
      const response = await fetch(`/api/operations/sync-center?${params}`, { headers, cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (n !== sequence.current) return;
      if (!response.ok) throw new Error(body.error ?? "读取批次记录失败。");
      if (workspace !== (requestHeaders().get("x-workspace-id") ?? "")) { invalidate(); return; }
      setHistory(body);
    } catch (error) { if (n === sequence.current && !controller.signal.aborted) { setBatch(null); setHistory(null); setError(error instanceof Error ? error.message : "读取失败。"); } }
    finally { if (n === sequence.current) setWorking(false); }
  }
  async function discoverPages(after = 0) {
    invalidate(); setPages(""); setBatch(null);
    const n = sequence.current, controller = new AbortController(); pending.current = controller;
    const headers = requestHeaders(), workspace = headers.get("x-workspace-id") ?? "";
    setWorking(true);
    try {
      const params = new URLSearchParams({ section: "order-fulfillment-pages", sourceId, taskId, after: String(after) });
      const response = await fetch(`/api/operations/sync-center?${params}`, { headers, cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (n !== sequence.current) return;
      if (!response.ok) throw new Error(body.error ?? "查找原件页失败。");
      if (workspace !== (requestHeaders().get("x-workspace-id") ?? "")) { invalidate(); return; }
      setBatch(body); setPages(body.pages.join(","));
    } catch (error) { if (n === sequence.current && !controller.signal.aborted) { setBatch(null); setHistory(null); setError(error instanceof Error ? error.message : "查找失败。"); } }
    finally { if (n === sequence.current) setWorking(false); }
  }
  async function loadPreview() {
    invalidate();
    const selected = pages.split(",").map(value => Number(value.trim()));
    if (!/^\s*\d+(?:\s*,\s*\d+)*\s*$/.test(pages) || selected.length > 10 || selected.some(page => !Number.isSafeInteger(page) || page <= 0) || new Set(selected).size !== selected.length) {
      setError("请输入 1–10 个不重复的正整数原件页，以逗号分隔。"); return;
    }
    const n = sequence.current, controller = new AbortController(); pending.current = controller;
    const headers = requestHeaders(); previewWorkspace.current = headers.get("x-workspace-id") ?? "";
    setWorking(true);
    try {
      const params = new URLSearchParams({ section: "order-fulfillment-preview", sourceId, taskId, rawPages: selected.join(",") });
      const response = await fetch(`/api/operations/sync-center?${params}`, { headers, cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (n !== sequence.current) return;
      if (!response.ok) throw new Error(body.error ?? "履约补齐预览失败。");
      if (previewWorkspace.current !== (requestHeaders().get("x-workspace-id") ?? "")) { invalidate(); return; }
      setPreview(body);
    } catch (error) { if (n === sequence.current && !controller.signal.aborted) { setBatch(null); setHistory(null); setError(error instanceof Error ? error.message : "预览失败。"); } }
    finally { if (n === sequence.current) setWorking(false); }
  }
  async function submit() {
    if (!preview || !preview.manifest.changedRows || working || busy) return;
    if (previewWorkspace.current !== (requestHeaders().get("x-workspace-id") ?? "")) { invalidate(); return; }
    const n = sequence.current; setWorking(true); setError("");
    try {
      const accepted = await requestApproval(preview.command);
      if (n !== sequence.current) return;
      setPreview(null); setSubmitted(accepted);
      if (!accepted) setError("申请未成功，请重新预览；详细原因见页面提示。");
    } catch (error) { if (n === sequence.current) { setPreview(null); setError(error instanceof Error ? error.message : "申请失败，请重新预览。"); } }
    finally { if (n === sequence.current) setWorking(false); }
  }
  return <section aria-label="订单历史履约字段补齐" className="space-y-3 rounded border border-border p-4">
    <h3 className="text-sm font-semibold">订单历史履约字段补齐</h3>
    <p className="text-xs text-muted">{sellerName} / {marketplaceId} · 从本任务已保存的详情原件补齐缺失的履约方和配送服务等级。已有值冲突或详情版本变化时停止。</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" disabled={busy || working} onClick={() => void discoverPages()}>自动查找原件页</Button>
      <Button size="sm" variant="secondary" disabled={busy || working} onClick={() => void loadHistory()}>刷新补齐批次记录</Button>
      {batch?.hasNext && batch.nextCursor !== null && <Button size="sm" variant="secondary" disabled={busy || working} onClick={() => void discoverPages(batch.nextCursor!)}>选择下一批原件</Button>}
    </div>
    {batch && <p className="text-xs text-muted">{batch.pages.length ? `已选择真实原件页：${batch.pages.join("、")}。请预览后提交审批。` : batch.hasNext ? "当前扫描范围没有匹配原件，可继续下一批。" : "没有更多匹配本任务的订单详情原件。"}</p>}
    {history && <div aria-label="补齐批次记录" className="space-y-2 text-xs">
      <p className="text-muted">最近 {history.batches.length} 条审批记录{history.hasMore ? "，更早记录见变更审批" : ""}。已应用表示该次执行成功，不代表整个任务或全部字段已补齐；恢复后须重新预览。</p>
      {!history.batches.length && <p>本任务暂无履约补齐审批记录。</p>}
      {history.batches.map(item => <div key={item.id} className="flex flex-wrap items-center gap-2">
        <span>原件页 {item.pages.join("、")} · {({ REQUESTED: "待审批", APPROVED: "已批准待应用", APPLIED: "已应用", REJECTED: "已拒绝", STALE: "版本失效", EXPIRED: "已过期", FAILED: "失败", APPLYING: "应用中" } as Record<string, string>)[item.status] ?? item.status} · 拟补齐 {item.changedRows ?? "未知"} 行</span>
        <Button size="sm" variant="secondary" disabled={busy || working} onClick={() => { invalidate(); setBatch(null); setPages(item.pages.join(",")); }}>恢复此批原件页</Button>
      </div>)}
    </div>}
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void loadPreview(); }}>
      <label className="grid gap-1 text-xs">原件页（最多 10 页）<input className="rounded border border-border bg-background px-2 py-1.5" value={pages} onChange={event => { invalidate(); setPages(event.target.value); }} placeholder="例如 1001,1002" required disabled={busy || working} /></label>
      <Button type="submit" size="sm" variant="secondary" disabled={busy || working}>预览履约补齐</Button>
    </form>
    <p className="text-xs text-muted">单次最多 10 份详情原件。预览不写库，也不请求 Amazon；只接受本任务已保存且核验通过的原件页。</p>
    {working && <p role="status" className="text-xs text-muted">正在处理…</p>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {preview && <div className="space-y-2 text-xs">
      <p>已核对 {preview.manifest.checkedRows} 行，拟补齐 {preview.manifest.changedRows} 行、{preview.manifest.addedFields} 个字段值。</p>
      <p className="text-muted">解析器 {preview.manifest.parserVersion} · 原件 {preview.manifest.archives.length} 页。只填充缺失字段，金额、商品明细和同步游标保持不变。</p>
      {preview.manifest.changedRows ? <Button size="sm" disabled={busy || working} onClick={() => void submit()}>提交履约补齐审批</Button> : <p role="status">所选原件页没有可补齐的缺失履约字段。</p>}
    </div>}
    {submitted && <div className="space-y-2 text-xs"><p role="status">履约补齐申请已提交，尚未改写数据；批准并应用后才会生效。</p><Button size="sm" variant="secondary" onClick={openApprovals}>前往变更审批</Button></div>}
  </section>;
}
