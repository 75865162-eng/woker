"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * 浮层族：Tooltip / Popover / Dropdown / Dialog / Drawer。
 *
 * 层级只用令牌里的 --z-dropdown / --z-modal / --z-drawer，
 * 打开时都支持 Escape 关闭；Dialog 与 Drawer 使用原生 <dialog>，
 * 因此焦点陷阱、焦点归还、背景 inert 都由浏览器负责，不自己实现一遍。
 */

/* --------------------------------------------------------------- Tooltip */

export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "right";
  className?: string;
}) {
  return (
    <span className={cn("group/tt relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-[var(--z-dropdown)] w-max max-w-56 rounded-md bg-foreground px-2 py-1 text-label text-white opacity-0 shadow-2 transition-opacity duration-150 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100",
          side === "top" && "bottom-full left-1/2 mb-1.5 -translate-x-1/2",
          side === "bottom" && "left-1/2 top-full mt-1.5 -translate-x-1/2",
          side === "right" && "left-full top-1/2 ml-1.5 -translate-y-1/2",
        )}
      >
        {content}
      </span>
    </span>
  );
}

/* --------------------------------------------------------------- Popover */

export function Popover({
  trigger,
  children,
  align = "end",
  className,
  label,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <span onClick={() => setOpen((value) => !value)} className="contents">
        {trigger}
      </span>
      {open ? (
        <div
          aria-label={label}
          className={cn(
            "absolute top-full z-[var(--z-dropdown)] mt-1 min-w-48 rounded-lg border border-border bg-surface p-1 shadow-3",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- Dropdown */

export interface DropdownItem {
  key: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  /** 该项上方画一条分隔线 */
  dividerBefore?: boolean;
}

export function Dropdown({
  trigger,
  items,
  align = "end",
  header,
}: {
  trigger: ReactNode;
  items: DropdownItem[];
  align?: "start" | "end";
  header?: ReactNode;
}) {
  return (
    <Popover trigger={trigger} align={align} label="操作菜单">
      {header ? <div className="border-b border-border px-2 py-1.5 text-label font-semibold text-muted">{header}</div> : null}
      {items.map((item) => {
        const inner = (
          <>
            {item.icon ? <span className="shrink-0 text-muted">{item.icon}</span> : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{item.label}</span>
              {item.description ? <span className="mt-0.5 block text-label text-muted">{item.description}</span> : null}
            </span>
          </>
        );
        const base = cn(
          "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-body transition-colors",
          item.disabled
            ? "cursor-not-allowed text-muted opacity-60"
            : item.danger
              ? "text-danger-ink hover:bg-danger-soft"
              : "text-foreground hover:bg-surface-muted",
        );

        return (
          <div key={item.key}>
            {item.dividerBefore ? <div className="my-1 border-t border-border" /> : null}
            {item.href && !item.disabled ? (
              <a href={item.href} className={base}>
                {inner}
              </a>
            ) : (
              <button type="button" disabled={item.disabled} onClick={item.onSelect} className={base}>
                {inner}
              </button>
            )}
          </div>
        );
      })}
    </Popover>
  );
}

/* ---------------------------------------------------------------- Dialog */

export function Dialog({
  open,
  title,
  description,
  onClose,
  footer,
  children,
  size = "md",
  busy = false,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) {
          onClose();
        }
      }}
      className={cn(
        "m-auto max-h-[88dvh] w-[calc(100%-2rem)] overflow-auto rounded-xl border border-border bg-surface p-0 text-foreground shadow-pop backdrop:bg-black/35",
        size === "sm" && "max-w-md",
        size === "md" && "max-w-2xl",
        size === "lg" && "max-w-5xl",
      )}
    >
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-surface px-5 py-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-title text-foreground">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-meta text-muted">{description}</p> : null}
        </div>
        <Button type="button" size="icon" variant="ghost" disabled={busy} aria-label="关闭" onClick={onClose}>
          <X aria-hidden className="h-4 w-4" />
        </Button>
      </header>
      <div className="px-5 py-4">{open ? children : null}</div>
      {footer ? (
        <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">
          {footer}
        </footer>
      ) : null}
    </dialog>
  );
}

/* ----------------------------------------------------------------- Drawer */

export function Drawer({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = "md",
  busy = false,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) {
          onClose();
        }
      }}
      className={cn(
        "fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full overflow-hidden border-l border-border bg-surface p-0 text-foreground shadow-pop backdrop:bg-black/30",
        width === "sm" && "max-w-md",
        width === "md" && "max-w-xl",
        width === "lg" && "max-w-3xl",
      )}
    >
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-title text-foreground">
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-meta text-muted">{description}</p> : null}
          </div>
          <Button type="button" size="icon" variant="ghost" disabled={busy} aria-label="关闭抽屉" onClick={onClose}>
            <X aria-hidden className="h-4 w-4" />
          </Button>
        </header>
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">{open ? children : null}</div>
        {footer ? (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>
        ) : null}
      </div>
    </dialog>
  );
}
