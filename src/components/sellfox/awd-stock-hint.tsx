"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { unavailableReason } from "./workbench-types";

// AWD fields have no verified local mapping. Even if a row happens to contain
// similarly named payload keys, this hint must keep every quantity unknown.
export function SellfoxAwdStockHint() {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  function cancelClose() { if (closeTimer.current) clearTimeout(closeTimer.current); }
  function show() {
    cancelClose();
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 232)),
      top: window.innerHeight - rect.bottom >= 160 ? rect.bottom + 4 : Math.max(8, rect.top - 156),
    });
  }
  function closeSoon() { cancelClose(); closeTimer.current = setTimeout(() => setPosition(null), 120); }
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) close(); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerdown", outside);
    };
  }, [position]);
  return <>
    <button ref={trigger} type="button" aria-label="查看AWD库存明细" aria-describedby={position ? id : undefined} className="inline-flex items-center gap-1 text-muted/60" onPointerEnter={show} onPointerLeave={closeSoon} onFocus={show} onBlur={() => setPosition(null)} onClick={event => { event.stopPropagation(); show(); }}>—<ChevronDown aria-hidden="true" className="h-3 w-3" /></button>
    {position ? createPortal(<div ref={panel} id={id} role="tooltip" aria-label="AWD库存明细" style={position} className="fixed z-50 w-56 max-h-[calc(100dvh-1rem)] overflow-auto border border-border bg-white p-3 text-xs text-foreground shadow-lg" onPointerEnter={cancelClose} onPointerLeave={closeSoon} onClick={event => event.stopPropagation()}>
      <dl className="space-y-2">{["AWD可售", "AWD预留", "小计"].map(label => <div key={label} className="flex items-center justify-between gap-4"><dt>{label}</dt><dd className="tabular-nums text-muted">—</dd></div>)}</dl>
      <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted">{unavailableReason}，不按 0 统计。</p>
    </div>, document.body) : null}
  </>;
}
