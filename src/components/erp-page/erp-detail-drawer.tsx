"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ErpDetailSection = {
  title?: string;
  fields?: { label: string; value: ReactNode }[];
  table?: { columns: string[]; rows: ReactNode[][] };
  content?: ReactNode;
};

export type ErpDetailDrawerProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  sections?: ErpDetailSection[];
  footer?: ReactNode;
  widthClassName?: string;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 对应 Wimoor「详情弹窗/抽屉 / 主从双视图」的右侧详情抽屉：ESC、遮罩点击、焦点管理。 */
export function ErpDetailDrawer({
  open,
  title,
  onClose,
  sections = [],
  footer,
  widthClassName = "max-w-2xl",
}: ErpDetailDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // 保持最新 onClose，避免回调标识变化导致焦点/滚动锁副作用反复重跑。
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panelRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn("flex h-full w-full flex-col bg-white shadow-2xl", widthClassName)}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-white px-5 py-3">
          <h2 id={titleId} className="text-sm font-bold text-foreground">{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭详情"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="thin-scrollbar flex-1 space-y-5 overflow-y-auto p-5">
          {sections.map((section, sectionIndex) => (
            <section key={sectionIndex} className="space-y-3">
              {section.title ? (
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted">{section.title}</h3>
              ) : null}
              {section.fields?.length ? (
                <dl className="grid grid-cols-1 gap-x-6 rounded-lg border border-border bg-white sm:grid-cols-2">
                  {section.fields.map((field, fieldIndex) => (
                    <div key={fieldIndex} className="flex items-start justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0">
                      <dt className="shrink-0 text-xs text-muted">{field.label}</dt>
                      <dd className="text-right text-xs font-semibold text-foreground">{field.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {section.table ? (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full border-collapse text-xs">
                    <thead className="bg-surface-muted">
                      <tr>
                        {section.table.columns.map((column, columnIndex) => (
                          <th key={columnIndex} scope="col" className="border-b border-border px-3 py-2 text-left font-semibold text-foreground">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.table.rows.map((cells, rowIndex) => (
                        <tr key={rowIndex} className="border-b border-border last:border-b-0">
                          {cells.map((cell, cellIndex) => (
                            <td key={cellIndex} className="px-3 py-2 text-foreground">{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {section.content ? <div className="text-sm text-foreground">{section.content}</div> : null}
            </section>
          ))}
        </div>

        {footer ? <footer className="shrink-0 border-t border-border bg-white px-5 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}
