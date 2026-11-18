"use client";

import { type ReactNode } from "react";
import { Dialog } from "@/components/ui/overlays";

/**
 * 兼容薄封装：保留原「挂载即打开、卸载即关闭」的契约（调用方不传 open），
 * 实际承载统一到底座 Dialog，不再保留独立的原生 dialog 实现。
 */
export function ProductEditDialog({ title, children, onDismiss }: { title: string; children: ReactNode; onDismiss: () => void }) {
  return (
    <Dialog open title={title} onClose={onDismiss} size="md">
      {children}
    </Dialog>
  );
}
