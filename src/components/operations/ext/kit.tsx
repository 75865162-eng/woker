import type { ReactNode } from 'react';

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="space-y-3"><div><h2 className="text-sm font-semibold">{title}</h2>{description && <p className="mt-0.5 text-xs text-muted">{description}</p>}</div>{children}</section>;
}

export function Kpis({ items }: { items: Array<{ label: string; value: string }> }) {
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{items.map(item => <article key={item.label} className="rounded border border-border bg-surface px-3 py-2"><p className="text-xs text-muted">{item.label}</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{item.value}</p></article>)}</div>;
}

export const money = (value: unknown) => Number(value).toFixed(2);
