"use client";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { CalendarDays, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEMO_TODAY } from "@/lib/amazon-ads/fixtures/catalog";
import type { DateRange } from "@/lib/amazon-ads/types";
export function AdsButton({ children, primary, ...props }: React.ComponentProps<typeof Button> & { primary?: boolean }) { return <Button size="sm" variant={primary ? "primary" : "secondary"} {...props}>{children}</Button>; }
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = ref.current;
    function trap(e: KeyboardEvent) {
      if (e.key !== "Tab" || !element) return;
      const controls = Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, a[href]'));
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
    element?.addEventListener("keydown", trap);
    return () => { element?.removeEventListener("keydown", trap); previous?.focus(); };
  }, []);
  return <div className="ads-modal-backdrop" onClick={onClose} onKeyDown={e => { if (e.key === "Escape") onClose(); }}><section ref={ref} role="dialog" aria-modal="true" aria-label={title} className="ads-modal" onClick={e => e.stopPropagation()}><header><h2>{title}</h2><button autoFocus aria-label="关闭对话框" onClick={onClose}><X size={18} /></button></header>{children}</section></div>;
}
export function shiftDate(date: string, days: number) { return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10); }
export function presetRange(name: string): DateRange {
  if (name === "今天") return { from: DEMO_TODAY, to: DEMO_TODAY };
  if (name === "昨天") return { from: shiftDate(DEMO_TODAY, -1), to: shiftDate(DEMO_TODAY, -1) };
  if (name === "本月") return { from: "2026-11-01", to: DEMO_TODAY };
  if (name === "上月") return { from: "2026-10-01", to: "2026-10-31" };
  return { from: shiftDate(DEMO_TODAY, -(name === "最近 30 天" ? 29 : name === "最近 14 天" ? 13 : 6)), to: DEMO_TODAY };
}
export function AdsDateRangePicker({ value, onChange }: { value: DateRange; onChange: (v: DateRange) => void }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(value);
  const valid = draft.from && draft.to && draft.from <= draft.to && Date.parse(draft.to) - Date.parse(draft.from) <= 365 * 86400000;
  return <div className="ads-popover-anchor"><AdsButton onClick={() => { setDraft(value); setOpen(!open); }} aria-expanded={open}><CalendarDays size={14} />{value.from} — {value.to}<ChevronDown size={13} /></AdsButton>{open && <div className="ads-popover ads-date-popover"><strong>日期范围</strong><div className="ads-preset-grid">{["今天", "昨天", "最近 7 天", "最近 14 天", "最近 30 天", "本月", "上月"].map(p => <button key={p} onClick={() => { onChange(presetRange(p)); setOpen(false); }}>{p}</button>)}</div><label>开始日期<input aria-label="开始日期" type="date" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label><label>结束日期<input aria-label="结束日期" type="date" value={draft.to} max={DEMO_TODAY} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label><small>演示基准日：2026-11-05；单次最多 366 天</small><AdsButton primary disabled={!valid || draft.to > DEMO_TODAY} onClick={() => { onChange(draft); setOpen(false); }}>应用自定义日期</AdsButton><AdsButton onClick={() => setOpen(false)}>取消</AdsButton></div>}</div>;
}
export function StatusBadge({ status }: { status: string }) { return <span className={`ads-status ${status}`}><i />{({ enabled: "正在投放", paused: "已暂停", archived: "已归档", ready: "已完成", generating: "正在生成", failed: "失败" } as Record<string, string>)[status] ?? status}</span>; }
