"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { draftStorageKey, readDraft, removeDraft, writeDraft } from "@/lib/workspace/draft-storage";
import { readWorkspaceScopeId } from "@/lib/workspace/workspace-scope-store";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

/**
 * 未提交的表单草稿。
 *
 * keep-alive 视图被 LRU 淘汰时组件会卸载，`useState` 里的输入会跟着丢——
 * 这是纯性能优化不该带来的代价。草稿写进 sessionStorage（同一浏览器标签页内有效），
 * 重新挂载时回填；提交成功后必须调用 `clearDraft()`，否则下次进页面会看到上一次的旧值。
 *
 * 只放「用户敲进去、丢了要重打」的内容，不放服务端数据（那些走 `useExt` 缓存重取）。
 */
export function useDraftState<T>(key: string, initial: T) {
  const user = useAppShellUser();
  const organizationId = user?.organizationId;
  const userId = user?.userId;
  const [value, setValue] = useState<T>(initial);
  const valueRef = useRef(value);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  const readCurrentDraft = useCallback(() => {
    const storageKey = draftStorageKey(key, {
      organizationId,
      workspaceId: readWorkspaceScopeId(),
      userId,
    });
    if (!storageKey) {
      valueRef.current = initialRef.current;
      setValue(initialRef.current);
      return;
    }
    try {
      const nextValue = readDraft(sessionStorage, storageKey, initialRef.current);
      valueRef.current = nextValue;
      setValue(nextValue);
    } catch {
      valueRef.current = initialRef.current;
      setValue(initialRef.current);
    }
  }, [key, organizationId, userId]);

  useEffect(() => {
    readCurrentDraft();
    window.addEventListener(workspaceScopeChangedEventName, readCurrentDraft);
    return () => window.removeEventListener(workspaceScopeChangedEventName, readCurrentDraft);
  }, [readCurrentDraft]);

  const update = useCallback((next: T | ((current: T) => T)) => {
    const storageKey = draftStorageKey(key, {
      organizationId,
      workspaceId: readWorkspaceScopeId(),
      userId,
    });
    const resolved = typeof next === "function" ? (next as (current: T) => T)(valueRef.current) : next;
    valueRef.current = resolved;
    setValue(resolved);
    try {
      writeDraft(sessionStorage, storageKey, resolved);
    } catch {
      // sessionStorage may be unavailable.
    }
  }, [key, organizationId, userId]);

  // 提交回调持有当次渲染的清理函数；A 的异步提交完成不能清掉 B。
  const renderedStorageKey = draftStorageKey(key, { organizationId, workspaceId: readWorkspaceScopeId(), userId });
  const clearDraft = useCallback(() => {
    const storageKey = renderedStorageKey;
    const currentStorageKey = draftStorageKey(key, { organizationId, workspaceId: readWorkspaceScopeId(), userId });
    if (currentStorageKey === storageKey) {
      valueRef.current = initialRef.current;
      setValue(initialRef.current);
    }
    try {
      removeDraft(sessionStorage, storageKey);
    } catch {
      // sessionStorage may be unavailable.
    }
  }, [key, organizationId, userId, renderedStorageKey]);

  return [value, update, clearDraft] as const;
}
