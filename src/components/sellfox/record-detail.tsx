import { useEffect, useState } from "react";
import { captions, display, runProgress, type Row } from "./workbench-types";

export function SellfoxRecordDetail({ row, rawUrl, headers, onClose }: { row: Row; rawUrl: string; headers: HeadersInit; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false); const [raw, setRaw] = useState<{ payload: unknown; truncated: boolean } | null>(null); const [error, setError] = useState("");
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController(); let canceled = false;
    void fetch(rawUrl, { headers, signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取原始摘要失败。");
      if (!canceled) setRaw(data);
    }).catch((cause) => { if (!canceled) setError(cause instanceof Error ? cause.message : "读取原始摘要失败。"); });
    return () => { canceled = true; controller.abort(); };
  }, [expanded, rawUrl, headers]);
  const store = row.SellfoxStore as Row | undefined;
  const fields: Row = { ...row, ...(store ? { name: store.name, externalId: store.externalId, marketplace: store.marketplace } : {}), ...(row.resource ? { progress: runProgress(row) } : {}) };
  return <section className="border border-border bg-white" aria-label="记录摘要"><div className="flex items-center justify-between border-b border-border px-3 py-2.5"><h2 className="text-xs font-semibold">记录摘要</h2><button aria-label="关闭详情" onClick={onClose} className="text-muted hover:text-foreground">×</button></div><dl className="max-h-80 space-y-2 overflow-auto p-3">{Object.entries(fields).filter(([, value]) => value === null || typeof value !== "object").map(([key, value]) => <div key={key}><dt className="text-[10px] text-muted">{captions[key] ?? key}</dt><dd className="break-words text-xs">{display(value, key)}</dd></div>)}</dl><details className="border-t border-border p-3 text-xs" onToggle={(event) => setExpanded(event.currentTarget.open)}><summary className="cursor-pointer">展开原始摘要</summary><p className="my-2 text-[10px] text-muted">按需读取；长内容会截断，敏感字段已隐藏。</p>{error ? <p role="alert" className="text-red-700">{error}</p> : raw ? <><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(raw.payload, null, 2)}</pre>{raw.truncated ? <p className="mt-2 text-amber-700">内容已截断。</p> : null}</> : <p>正在读取…</p>}</details></section>;
}
