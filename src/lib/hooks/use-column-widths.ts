"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { createColumnResizeController, normalizeColumnWidths } from "./column-widths-controller";
import type { ColumnWidths } from "./column-widths-controller";

type Widths = ColumnWidths;

/**
 * 用户层级列宽：localStorage 立即应用（防闪烁），服务端 UserPreference 为真值。
 * 拖拽只在内存更新，松手才 PUT 一次；未登录或接口失败时仅本次会话生效。
 */
export function useColumnWidths(tableId: string, defaults: Widths = {}) {
  const [widths, setWidths] = useState<Widths>({});
  const user = useAppShellUser();
  const storageKey = `col-widths:${user?.organizationId ?? "unbound"}:${user?.userId ?? "unbound"}:${tableId}`;
  const apiPath = `/api/user-preferences/table-columns:${encodeURIComponent(tableId)}`;
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const scopeRef = useRef(storageKey);
  scopeRef.current = storageKey;
  const persistRef = useRef<(next: Widths) => void>(() => undefined);
  const controllerRef = useRef<{ scope: string; controller: ReturnType<typeof createColumnResizeController> } | null>(null);
  useEffect(() => {
    const entry = {
      scope: storageKey,
      controller: createColumnResizeController({
        target: window,
        scope: storageKey,
        getScope: () => scopeRef.current,
        getWidths: () => widthsRef.current,
        setWidths: (next) => { widthsRef.current = next; setWidths(next); },
        persist: (next) => persistRef.current(next),
      }),
    };
    controllerRef.current = entry;
    return () => {
      entry.controller.dispose();
      if (controllerRef.current === entry) controllerRef.current = null;
    };
  }, [storageKey]);

  // 启动：localStorage 先行，服务端覆盖
  useEffect(() => {
    let cancelled = false;
    const requestScope = storageKey;
    widthsRef.current = {};
    setWidths({});
    try {
      const cached = window.localStorage.getItem(storageKey);
      if (cached) {
        const normalized = normalizeColumnWidths(JSON.parse(cached));
        widthsRef.current = normalized;
        setWidths(normalized);
      }
    } catch {
      // 忽略本地缓存损坏
    }
    fetch(apiPath)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { value: { widths: Widths } | null } | null) => {
        if (cancelled || scopeRef.current !== requestScope || !data?.value?.widths || typeof data.value.widths !== "object") return;
        const normalized = normalizeColumnWidths(data.value.widths);
        widthsRef.current = normalized;
        setWidths(normalized);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(normalized));
        } catch {
          // localStorage 不可用时跳过
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      controllerRef.current?.controller.cancel();
    };
  }, [apiPath, storageKey]);

  const persist = useCallback(
    (next: Widths) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // 忽略
      }
      fetch(apiPath, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widths: next }),
      }).catch(() => undefined);
    },
    [apiPath, storageKey],
  );
  persistRef.current = persist;

  /** 拖拽手柄 pointerdown 时调用；松手后持久化 */
  const startResize = useCallback(
    (event: React.PointerEvent, columnKey: string) => {
      event.preventDefault();
      event.stopPropagation();
      const startWidth = widthsRef.current[columnKey] ?? defaults[columnKey] ?? 0;
      controllerRef.current?.controller.start(event.clientX, startWidth, columnKey);
    },
    [defaults],
  );

  /** 重置单列（不传 key 则全部重置） */
  const resetWidths = useCallback(
    (columnKey?: string) => {
      const next = columnKey ? Object.fromEntries(Object.entries(widthsRef.current).filter(([k]) => k !== columnKey)) : {};
      widthsRef.current = next;
      setWidths(next);
      persist(next);
    },
    [persist],
  );

  /** 列的最终宽度：用户设置 > 默认值 */
  const getWidth = useCallback((columnKey: string) => widths[columnKey] ?? defaults[columnKey], [defaults, widths]);

  return { widths, getWidth, startResize, resetWidths };
}
