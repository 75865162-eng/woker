import { sellfoxDomains, type SellfoxDomain } from "@/lib/sellfox/workbench-view";

export function SellfoxDomainTabs({ domain, active, onChange }: { domain: SellfoxDomain; active: boolean; onChange: (domain: SellfoxDomain) => void }) {
  return <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="赛狐数据域">{sellfoxDomains.map((item) => <button key={item.id} aria-current={domain === item.id ? "page" : undefined} onClick={() => onChange(item.id)} className={`shrink-0 border-b-2 px-3 py-1.5 text-xs ${domain === item.id ? "border-brand font-semibold text-brand" : "border-transparent text-muted hover:text-foreground"}`}>{item.label}{item.id === "runs" && active ? <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}</button>)}</nav>;
}
