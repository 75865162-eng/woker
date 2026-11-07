"use client";

import { useMemo, useState } from "react";
import type { Claim, Run } from "@/lib/selection-research/types";

const claimLabels: Record<Claim["kind"], string> = { observed: "数据观察", calculated: "计算结论", estimated: "估算，待验证", assumption: "假设，待验证" };
const verdictLabels = { GO: "建议推进", NO_GO: "不建议推进", NEEDS_VALIDATION: "仍需验证" };

/** Read-only review of persisted results; expanding evidence never dispatches a tool. */
export function ResearchResults({ run }: { run: Run }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const successfulCalls = useMemo(() => new Map(run.calls.filter(call => call.status === "SUCCEEDED").map(call => [call.id, call])), [run.calls]);
  const evidenceIds = useMemo(() => [...new Set(run.results.flatMap(result => result.claims.flatMap(claim => claim.evidenceIds)))], [run.results]);
  if (!run.results.length) return null;
  const selected = run.results[0]?.candidates?.find(candidate => candidate.id === run.selectedCandidateId);
  return <section className="space-y-3 rounded border p-3" aria-label="研究结论与证据">
    <h3 className="font-semibold">研究结论与证据</h3>
    <p className="text-sm">市场：{run.marketplace}{run.asin ? ` · ASIN：${run.asin}` : ""}{selected ? ` · 已选方向：${selected.name}` : ""}。请求时间不代表源数据日期或新鲜度，请核对原始响应。</p>
    {run.mode === "fixture" && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">隔离样本，仅验证流程，不构成真实市场研究或采购建议。</p>}
    {run.results.map((result, index) => <article key={index} className="space-y-2 border-t pt-3" aria-label={`阶段 ${index + 1} 研究结果`}>
      <h4 className="font-semibold">阶段 {index + 1}{result.verdict ? ` · ${verdictLabels[result.verdict]}（${result.verdict}）` : ""}</h4>
      <p className="whitespace-pre-wrap break-words text-sm">{result.summary}</p>
      <ul className="space-y-2">{result.claims.map((claim, claimIndex) => <li key={claimIndex} className="space-y-1 rounded bg-slate-50 p-2 text-sm">
        <p className={claim.kind === "assumption" || claim.kind === "estimated" ? "font-medium text-amber-900" : "font-medium"}>{claimLabels[claim.kind]}</p>
        <p className="whitespace-pre-wrap break-words">{claim.text}</p>
        {claim.formula && <p className="whitespace-pre-wrap break-words">计算公式：{claim.formula}</p>}
        {claim.applicableDate && <p>声明适用日期：{claim.applicableDate}</p>}
        {claim.sourceUrl && <p className="break-all">声明来源：{claim.sourceUrl}</p>}
        <div className="flex flex-wrap gap-2">{claim.evidenceIds.length ? claim.evidenceIds.map(id => {
          const call = successfulCalls.get(id);
          return call ? <a key={id} className="break-all underline" href={`#research-evidence-${id}`} onClick={() => setExpanded(previous => ({ ...previous, [id]: true }))}>证据：{call.provider} · {call.tool} · {id}</a>
            : <span key={id} className="break-all text-red-700">证据缺失或调用未成功：{id}</span>;
        }) : <span className="text-amber-900">未引用成功调用证据</span>}</div>
      </li>)}</ul>
    </article>)}
    {evidenceIds.some(id => successfulCalls.has(id)) && <div className="space-y-2 border-t pt-3">
      <h4 className="font-semibold">引用的原始证据</h4>
      {evidenceIds.map(id => {
        const call = successfulCalls.get(id);
        if (!call) return null;
        return <details key={id} id={`research-evidence-${id}`} className="rounded border p-2 text-sm" open={expanded[id] ?? false} onToggle={event => {
          const open = event.currentTarget.open;
          setExpanded(previous => Boolean(previous[id]) === open ? previous : { ...previous, [id]: open });
        }}>
          <summary className="break-all">{call.provider} · {call.tool} · {call.requestedAt} · {call.status} · {id}</summary>
          {expanded[id] && <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({ id: call.id, provider: call.provider, tool: call.tool, requestedAt: call.requestedAt, respondedAt: call.respondedAt, arguments: call.arguments, rawResponse: call.rawResponse, billing: call.billing, knownUnits: call.knownUnits }, null, 2)}</pre>}
        </details>;
      })}
    </div>}
  </section>;
}
