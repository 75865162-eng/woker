"use client";

import { useRef, useState } from "react";
import type { Product } from "@/lib/products/types";
import { restoreProductEdits } from "@/lib/products/product-edit-draft-repository";
import { productToDraft } from "./product-workbench-data";
import type { ProductEditorDraft } from "./product-workbench-model";

export function useProductRevisionConflict(options: {
  sku: string;
  workspaceId: string;
  products: Product[];
  nextSku: string;
  flushDraft: () => Promise<unknown>;
  setDraft: (draft: ProductEditorDraft) => void;
  setBaseSnapshot: (draft: ProductEditorDraft) => void;
  setEditorError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [latest, setLatest] = useState<ProductEditorDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(false);
  const conflict = useRef<{ original: ProductEditorDraft; form: ProductEditorDraft } | null>(null);

  async function loadLatest() {
    setLoading(true);
    options.setEditorError("");
    try {
      await options.flushDraft();
      const response = await fetch(`/api/products/${encodeURIComponent(options.sku)}/detail`, { cache: "no-store", headers: { "x-workspace-id": options.workspaceId } });
      const data = await response.json() as { product?: Product; error?: string };
      if (!response.ok || !data.product || !Number.isInteger(data.product.revision)) throw new Error(data.error || "最新商品读取失败");
      setLatest(productToDraft(data.product, options.products, options.nextSku));
    } catch (error) {
      options.setEditorError(error instanceof Error ? error.message : "最新商品读取失败");
    } finally {
      setLoading(false);
    }
  }

  function begin(original: ProductEditorDraft, form: ProductEditorDraft) {
    conflict.current = { original, form };
    setActive(true);
    setLatest(null);
    setOpen(true);
  }

  function clear() {
    conflict.current = null;
    setActive(false);
    setOpen(false);
    setLatest(null);
  }

  function useServerVersion() {
    if (!latest) return;
    options.setBaseSnapshot(latest);
    options.setDraft(latest);
    clear();
    options.setEditorError("");
  }

  function restoreMine() {
    if (!latest || !conflict.current) return;
    options.setBaseSnapshot(latest);
    options.setDraft(restoreProductEdits(conflict.current.original, conflict.current.form, latest));
    clear();
    options.setEditorError("已恢复你的修改，未自动保存。请核对最新数据和表单后点击保存；修改过的数组/复合字段会整体恢复。");
  }

  function acceptCandidate(record: { original: ProductEditorDraft; form: ProductEditorDraft; baseRevision?: number }, current: ProductEditorDraft, isEditing: boolean) {
    if (isEditing && record.baseRevision === undefined) {
      options.setDraft(restoreProductEdits(record.original, record.form, current));
      return;
    }
    if (record.baseRevision !== current.revision) setLatest(current);
    options.setBaseSnapshot({ ...record.original, revision: record.baseRevision });
    options.setDraft({ ...record.form, revision: record.baseRevision });
  }

  return { open, setOpen, latest, loading, active, conflict, begin, clear, loadLatest, useServerVersion, restoreMine, acceptCandidate };
}
