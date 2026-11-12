"use client";

import { useState } from "react";

/** Read-only evidence: retain source field names and exact values, including null. */
export function BusinessRecordFields({ fields }: { fields: Record<string, unknown> }) {
  const [search, setSearch] = useState("");
  const entries = Object.entries(fields).filter(([key]) => key.toLowerCase().includes(search.toLowerCase()));
  return <section className="space-y-3" aria-label="完整业务字段">
    <label className="grid gap-1 text-xs">查找字段<input className="min-h-9 rounded border border-border bg-background px-2 text-sm" value={search} onChange={event => setSearch(event.target.value)} placeholder="按原始字段名筛选" /></label>
    <dl className="divide-y divide-border rounded border border-border text-xs">{entries.map(([key, value]) => <div key={key} className="grid gap-2 p-3 sm:grid-cols-[160px_minmax(0,1fr)]"><dt className="break-words font-medium">{key}</dt><dd className="min-w-0 break-words whitespace-pre-wrap">{value === null ? <span className="text-muted">未返回（null）</span> : typeof value === "object" ? <pre className="overflow-auto whitespace-pre-wrap font-mono">{JSON.stringify(value, null, 2)}</pre> : String(value)}</dd></div>)}</dl>
    {!entries.length && <p className="text-xs text-muted">没有匹配字段。</p>}
  </section>;
}
