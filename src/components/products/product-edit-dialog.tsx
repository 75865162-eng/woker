"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/** Shared native HTML dialog: application content, focus trapping, no window.alert/confirm. */
export function ProductEditDialog({ title, children, onDismiss }: { title: string; children: ReactNode; onDismiss: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onDismiss(); }}
      className="m-auto max-h-[85vh] w-[min(94vw,850px)] overflow-auto rounded-lg border border-border bg-white p-5 text-foreground shadow-xl backdrop:bg-black/40">
      <h3 id={titleId} className="mb-3 text-base font-bold">{title}</h3>
      {children}
    </dialog>
  );
}
