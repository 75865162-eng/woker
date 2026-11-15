"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DENSITY_HINTS,
  DENSITY_LABELS,
  DENSITY_ORDER,
  useDensityStore,
  type Density,
} from "@/lib/stores/density-store";

/**
 * 密度切换器。
 *
 * 放在壳层顶栏，三档：紧凑 / 标准 / 宽松。
 * 选择立即写入 html[data-density] 并持久化，页面不需要刷新。
 */
export function DensitySwitcher() {
  const density = useDensityStore((state) => state.density);
  const hydrated = useDensityStore((state) => state.hydrated);
  const setDensity = useDensityStore((state) => state.setDensity);
  const hydrate = useDensityStore((state) => state.hydrate);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleSelect = (next: Density) => {
    setDensity(next);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative" data-testid="density-switcher">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`信息密度：${DENSITY_LABELS[density]}`}
        title={`信息密度：${DENSITY_LABELS[density]}`}
        className="flex h-[var(--control-h-sm)] items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-meta text-foreground transition-colors hover:border-border-strong hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <Rows3 aria-hidden className="h-3.5 w-3.5 text-muted" />
        <span suppressHydrationWarning className="hidden xl:inline">
          {hydrated ? DENSITY_LABELS[density] : DENSITY_LABELS.standard}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="选择信息密度"
          className="absolute right-0 top-full z-[var(--z-dropdown)] mt-1 w-64 rounded-lg border border-border bg-surface p-1 shadow-3"
        >
          <p className="px-2 py-1.5 text-label font-semibold uppercase tracking-wide text-muted">
            信息密度
          </p>
          {DENSITY_ORDER.map((option) => {
            const active = hydrated && option === density;

            return (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => handleSelect(option)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  active && "bg-brand/8",
                )}
              >
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                  {active ? <Check aria-hidden className="h-3.5 w-3.5 text-brand" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-body font-semibold text-foreground">
                    {DENSITY_LABELS[option]}
                  </span>
                  <span className="mt-0.5 block text-label text-muted">{DENSITY_HINTS[option]}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
