"use client";

import { type ReactNode } from "react";
import { Dialog, Drawer } from "./overlays";

/**
 * 兼容薄封装：历史 21 个调用方保持原 props 不变，
 * 实际承载统一到底座的 Dialog / Drawer，不再保留独立的原生 dialog 实现。
 * drawer -> Drawer(width=lg，对应原 max-w-3xl)；其余 -> Dialog(size=lg，对应原 max-w-5xl)。
 */
export function WorkbenchDialog({ open, title, onClose, busy = false, drawer = false, children }: {
  open: boolean; title: string; onClose: () => void; busy?: boolean; drawer?: boolean; children: ReactNode;
}) {
  if (drawer) {
    return (
      <Drawer open={open} title={title} onClose={onClose} busy={busy} width="lg">
        {children}
      </Drawer>
    );
  }
  return (
    <Dialog open={open} title={title} onClose={onClose} busy={busy} size="lg">
      {children}
    </Dialog>
  );
}
