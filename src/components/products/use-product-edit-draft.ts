"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserId } from "@/lib/browser/random-id";
import {
  deleteProductDraft, productDraftIdentityKey, readProductDrafts, writeProductDraft,
  type LocalProductDraft, type ProductDraftIdentity,
} from "@/lib/products/product-edit-draft-repository";

export function useProductEditDraft<T extends { revision?: number }>(identity: ProductDraftIdentity, original: T, form: T, ready: boolean) {
  const [candidates, setCandidates] = useState<LocalProductDraft<T>[]>([]);
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState("正在检查本地草稿…");
  const session = useRef("");
  const stopped = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<LocalProductDraft<T> | null>(null);
  const adopted = useRef<LocalProductDraft<T>[]>([]);
  const wrote = useRef(false);
  const dirty = JSON.stringify(original) !== JSON.stringify(form);
  const identityKey = JSON.stringify(identity);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const value = pending.current;
    pending.current = null;
    if (!value || stopped.current) return;
    const operation = queue.current.catch(() => undefined).then(() => writeProductDraft(value));
    queue.current = operation;
    wrote.current = true;
    try {
      await operation;
      if (!stopped.current && !pending.current) setStatus("草稿已暂存（仅此浏览器，未正式保存）");
    } catch {
      if (!stopped.current) {
        if (!pending.current) pending.current = value;
        setStatus("暂存失败：请勿刷新，可继续编辑并尝试正式保存。");
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    stopped.current = false;
    session.current = createBrowserId();
    setChecked(false);
    const parsed = JSON.parse(identityKey) as ProductDraftIdentity;
    void readProductDrafts<T>(parsed).then((records) => {
      if (active) { setCandidates(records); setStatus("尚无未提交修改"); }
    }).catch((error: unknown) => {
      if (active) setStatus(error instanceof Error ? error.message : "本地草稿读取失败，请勿刷新。");
    }).finally(() => { if (active) setChecked(true); });
    return () => { active = false; void flush(); };
  }, [identityKey, flush]);

  useEffect(() => {
    if (!ready || !checked || candidates.length || stopped.current) return;
    if (!dirty) {
      clearTimeout(timer.current);
      pending.current = null;
      if (wrote.current || adopted.current.length) {
        const key = `${productDraftIdentityKey(identity)}:${session.current}`;
        const previous = adopted.current;
        adopted.current = [];
        queue.current = queue.current.catch(() => undefined).then(async () => {
          await deleteProductDraft(key);
          for (const record of previous) await deleteProductDraft(record.key, record.updatedAt);
        }).catch(() => {
          adopted.current.push(...previous);
          setStatus("草稿清理失败，重新打开时请放弃旧草稿。");
        });
        wrote.current = false;
      }
      return;
    }
    try {
      const key = productDraftIdentityKey(identity);
      pending.current = {
        key: `${key}:${session.current}`, identityKey: key, identity, schemaVersion: 1,
        baseRevision: original.revision, original, form, updatedAt: new Date().toISOString(),
      };
      setStatus("正在暂存…");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { void flush(); }, 350);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "本地草稿不可用。");
    }
    // identity is represented by its value key, not an object created on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, original, ready, checked, dirty, candidates.length, identityKey, flush]);

  useEffect(() => {
    const leave = () => { void flush(); };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", leave);
      void flush(); // Leaving is not discard. No lifecycle handler deletes drafts.
    };
  }, [flush]);

  async function clear() {
    stopped.current = true;
    clearTimeout(timer.current);
    pending.current = null;
    await queue.current.catch(() => undefined);
    try {
      await deleteProductDraft(`${productDraftIdentityKey(identity)}:${session.current}`);
      for (const record of [...adopted.current, ...candidates]) await deleteProductDraft(record.key, record.updatedAt);
      setCandidates([]);
      return true;
    } catch {
      stopped.current = false;
      setStatus("草稿清理失败：正式数据未回滚，请重试清理后关闭。");
      return false;
    }
  }

  function resume() { stopped.current = false; }
  function acceptCandidate() {
    const record = candidates[0];
    if (record) adopted.current.push(record);
    // Other sessions remain recoverable; only this chosen snapshot is adopted.
    setCandidates([]);
    return record;
  }

  return { candidates, checked, status, dirty, flush, clear, resume, acceptCandidate };
}
