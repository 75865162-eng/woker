"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./button";

/** Native modal provides focus trapping and focus return. */
export function WorkbenchDialog({ open, title, onClose, busy = false, drawer = false, children }: {
  open: boolean; title: string; onClose: () => void; busy?: boolean; drawer?: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}
    className={"fixed max-h-[92dvh] w-[calc(100%-2rem)] overflow-auto rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/30 " + (drawer ? "inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh max-w-3xl" : "m-auto max-w-5xl")}>
    <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface px-5 py-3">
      <h2 id={titleId} className="text-sm font-semibold">{title}</h2>
      <Button type="button" size="icon" variant="ghost" disabled={busy} aria-label="关闭弹窗" onClick={onClose}><X className="h-4 w-4" /></Button>
    </header>
    <div className="p-5">{open ? children : null}</div>
  </dialog>;
}
