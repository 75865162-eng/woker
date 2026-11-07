"use client";

import { useState } from "react";
import type { Decision, Run } from "@/lib/selection-research/types";

const decisionLabels: Record<Decision["kind"], string> = {
  SELECT: "第一次业务确认", CONFIRM: "第二次业务确认", AUTHORIZE_TOOL: "单次工具请求授权",
  RECONCILE: "请求结果与费用核对", INCREASE_BUDGET: "提高调用上限",
};

/** Display saved decisions only. Status changes never substitute for a human approval record. */
export function ResearchAudit({ run }: { run: Run }) {
  const [expanded, setExpanded] = useState(false);
  const first = run.decisions.find(entry => entry.decision.kind === "SELECT");
  const final = [...run.decisions].reverse().find(entry => entry.decision.kind === "CONFIRM");
  const selected = run.results[0]?.candidates?.find(candidate => candidate.id === first?.decision.candidateId);
  const technical = run.decisions.filter(entry => !["SELECT", "CONFIRM"].includes(entry.decision.kind));
  return <section className="space-y-3 rounded border p-3 text-sm" aria-label="审批与保存记录">
    <h3 className="font-semibold">审批与保存记录</h3>
    <p>业务确认与单次工具授权、费用核对分别记录。确认研究结论仅允许生成报告，不授权修改店铺业务数据。</p>
    <ol className="space-y-2">
      <li className="rounded bg-slate-50 p-2"><strong>第一次业务确认：{first ? "已记录" : "尚未确认"}</strong>
        {first && <><p className="break-all">已选方向：{selected?.name ?? first.decision.candidateId}</p><p className="break-all">确认时间：{first.at} · 操作者 ID：{first.actorId}</p></>}
      </li>
      <li className="rounded bg-slate-50 p-2"><strong>第二次业务确认：{final ? "已记录" : "尚未确认"}</strong>
        {final && <p className="break-all">确认时间：{final.at} · 操作者 ID：{final.actorId}</p>}
      </li>
    </ol>
    {run.report ? <div className="space-y-1 rounded bg-slate-50 p-2">
      <p className="font-medium">HTML 报告保存记录已存在</p>
      <p className="break-all">FileObject：{run.report.fileId} · 保存时间：{run.report.savedAt}</p>
      <p>可通过下方下载入口读取保存文件；文件可用性与完整性由下载接口校验。</p>
    </div> : <p className="rounded bg-amber-50 p-2 text-amber-900">{first && final ? "报告尚无保存记录。若保存失败，可重试保存，无需重复两次业务确认。" : "报告尚无保存记录；需先完成两次业务确认。"}</p>}
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>工具授权、费用及额度记录（{technical.length} 条）</summary>
      {expanded && (technical.length ? <ol className="mt-2 space-y-2">{technical.map((entry, index) => <li key={index} className="space-y-1 rounded border p-2">
        <p className="font-medium">{decisionLabels[entry.decision.kind]}</p>
        <p className="break-all">时间：{entry.at} · 操作者 ID：{entry.actorId}</p>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(entry.decision, null, 2)}</pre>
      </li>)}</ol> : <p>尚无额外工具授权、费用核对或额度调整记录。</p>)}
    </details>
  </section>;
}
