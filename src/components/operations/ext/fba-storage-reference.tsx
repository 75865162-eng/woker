"use client";

import { useState } from 'react';
import { DataTable } from '@/components/ui/data-table';
import { sizeLimitInCentimeters } from '@/lib/ext/calculator-units';
import { referenceViews } from '@/lib/ext/fba-reference';

/** Complete reference, including notes, exceptions, formulas and future changes. */
export function FbaStorageReference() {
  const [search, setSearch] = useState('');
  const views = referenceViews.filter(view => !['overview','calc','changes'].includes(view.id));
  return <section id="fee-reference" className="space-y-4 scroll-mt-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">美国站 2026 · 完整费用手册</h2>
      <input aria-label="搜索费用手册" className="h-9 rounded border border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted" placeholder="搜索费用、品类、触发条件" value={search} onChange={e=>setSearch(e.target.value)} />
    </div>
    <nav aria-label="费用手册目录" className="flex flex-wrap gap-2 text-xs">{views.map(v=><a key={v.id} href={`#reference-${v.id}`} className="rounded-md border border-border bg-surface px-3 py-2 font-medium text-brand shadow-sm transition-colors hover:border-brand hover:bg-brand hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{v.nav}</a>)}</nav>
    {views.map(view=>{
      const blocks=view.blocks.filter(block=>!search.trim()||JSON.stringify(block).toLowerCase().includes(search.trim().toLowerCase()));
      if (!blocks.length) return null;
      return <details key={view.id} id={`reference-${view.id}`} open={search.trim()?true:undefined} className="group scroll-mt-6 rounded-lg border border-border bg-surface p-4 shadow-sm open:border-brand open:ring-1 open:ring-brand/20">
        <summary className="cursor-pointer rounded text-sm font-semibold text-brand transition-colors hover:text-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{view.title} <span className="font-normal text-muted">· {blocks.length} 项</span></summary>
        <p className="my-3 text-xs text-muted">{view.lede}</p>
        <div className="space-y-5">{blocks.map((block,i)=><section key={i} className="space-y-2">
          <h3 className="text-sm font-medium">{block.title}</h3>
          {block.note&&<p className="text-xs text-muted">{block.note}</p>}
          {block.text&&<p className="rounded bg-background p-3 text-sm">{block.text}</p>}
          {block.rows&&<DataTable
            density="compact"
            columns={(block.head ?? []).flatMap((head, index) => {
              const column = { key: String(index), header: head.replace(/<br\s*\/?\s*>/g, '\n'), headerClassName: 'whitespace-pre-line', render: (row: { cells: (string | number)[] }) => typeof row.cells[index] === 'number' ? `$${Number(row.cells[index]).toFixed(2)}` : row.cells[index] };
              return head === '三边与围长上限' ? [
                { ...column, header: '三边与围长上限(in)' },
                { ...column, key: `${index}-cm`, header: '三边与围长上限(cm)', render: (row: { cells: (string | number)[] }) => sizeLimitInCentimeters(String(row.cells[index])) },
              ] : [column];
            })}
            rows={block.rows.map((cells, index) => ({ cells, id: String(index) }))}
            getRowKey={row => row.id}
          />}
          {block.events?.map(event=><div key={event.date} className="border-l-2 border-border pl-3"><p className="text-sm font-medium">{event.date} · {event.title}</p><ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted">{event.items.map(item=><li key={item}>{item}</li>)}</ul></div>)}
          {block.foot&&<p className="text-xs text-muted">{block.foot}</p>}
        </section>)}</div>
      </details>;
    })}
    {search&&!views.some(v=>v.blocks.some(b=>JSON.stringify(b).toLowerCase().includes(search.trim().toLowerCase())))&&<p className="text-sm text-muted">没有匹配的费用条目。</p>}
  </section>;
}
