"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createColumnResizeController, normalizeColumnWidths } from "./column-widths-controller";
import type { ColumnWidths } from "./column-widths-controller";

/**
 * 会话级列宽：仅当前浏览器标签页会话内有效（sessionStorage）。
 * - 拖拽实时改内存，松手写入 sessionStorage；
 * - 关闭标签页/会话结束即清除，不写服务端、不写 localStorage，不产生任何持久化数据契约；
 * - 刷新同一标签页仍保留（sessionStorage 语义）。
 * 复用与广告表相同的拖拽控制器，保证交互手感一致。
 */
export function useSessionColumnWidths(tableId: string, defaults: ColumnWidths = {}) {
  const [widths, setWidths] = useState<ColumnWidths>({});
  const storageKey = `session-col-widths:${tableId}`;
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const controllerRef = useRef<ReturnType<typeof createColumnResizeController> | null>(null);

  // 启动时读会话缓存，并注册拖拽控制器
  useEffect(() => {
    let cached: ColumnWidths = {};
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw) cached = normalizeColumnWidths(JSON.parse(raw));
    } catch {
      // 会话缓存损坏则忽略，用默认宽度
    }
    widthsRef.current = cached;
    setWidths(cached);

    const controller = createColumnResizeController({
      target: window,
      scope: storageKey,
      getScope: () => storageKey,
      getWidths: () => widthsRef.current,
      setWidths: (next) => { widthsRef.current = next; setWidths(next); },
      persist: (next) => {
        try { window.sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* 会话存储不可用时仅内存生效 */ }
      },
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [storageKey]);

  const startResize = useCallback(
    (event: React.PointerEvent, columnKey: string) => {
      event.preventDefault();
      event.stopPropagation();
      const startWidth = widthsRef.current[columnKey] ?? defaults[columnKey] ?? 0;
      controllerRef.current?.start(event.clientX, startWidth, columnKey);
    },
    [defaults],
  );

  /** 双击重置单列：删掉该列覆盖值；全部重置传空。 */
  const resetWidths = useCallback(
    (columnKey?: string) => {
      const next = columnKey
        ? Object.fromEntries(Object.entries(widthsRef.current).filter(([k]) => k !== columnKey))
        : {};
      widthsRef.current = next;
      setWidths(next);
      try { window.sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* 忽略 */ }
    },
    [storageKey],
  );

  /** 列最终宽度：会话内拖拽值 > 默认固定值 */
  const getWidth = useCallback((columnKey: string) => widths[columnKey] ?? defaults[columnKey], [defaults, widths]);

  return { widths, getWidth, startResize, resetWidths };
}
