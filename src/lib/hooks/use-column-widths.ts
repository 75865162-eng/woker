"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export const COLUMN_WIDTH_MIN = 48;
export const COLUMN_WIDTH_MAX = 800;

type Widths = Record<string, number>;

function clampWidth(width: number) {
  return Math.round(Math.min(Math.max(width, COLUMN_WIDTH_MIN), COLUMN_WIDTH_MAX));
}

/**
 * 用户层级列宽：localStorage 立即应用（防闪烁），服务端 UserPreference 为真值。
 * 拖拽只在内存更新，松手才 PUT 一次；未登录或接口失败时仅本次会话生效。
 */
export function useColumnWidths(tableId: string, defaults: Widths = {}) {
  const [widths, setWidths] = useState<Widths>({});
  const storageKey = `col-widths:${tableId}`;
  const apiPath = `/api/user-preferences/table-columns:${encodeURIComponent(tableId)}`;
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  // 启动：localStorage 先行，服务端覆盖
  useEffect(() => {
    let cancelled = false;
    try {
      const cached = window.localStorage.getItem(storageKey);
      if (cached) setWidths(JSON.parse(cached) as Widths);
    } catch {
      // 忽略本地缓存损坏
    }
    fetch(apiPath)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { value: Widths | null } | null) => {
        if (cancelled || !data?.value || typeof data.value !== "object") return;
        setWidths(data.value);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(data.value));
        } catch {
          // localStorage 不可用时跳过
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
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
        body: JSON.stringify(next),
      }).catch(() => undefined);
    },
    [apiPath, storageKey],
  );

  /** 拖拽手柄 pointerdown 时调用；松手后持久化 */
  const startResize = useCallback(
    (event: React.PointerEvent, columnKey: string) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = widthsRef.current[columnKey] ?? defaults[columnKey] ?? 0;
      if (startWidth <= 0) return;

      const onMove = (moveEvent: PointerEvent) => {
        const next = clampWidth(startWidth + moveEvent.clientX - startX);
        setWidths((prev) => (prev[columnKey] === next ? prev : { ...prev, [columnKey]: next }));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        persist(widthsRef.current);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [defaults, persist],
  );

  /** 重置单列（不传 key 则全部重置） */
  const resetWidths = useCallback(
    (columnKey?: string) => {
      const next = columnKey ? Object.fromEntries(Object.entries(widthsRef.current).filter(([k]) => k !== columnKey)) : {};
      setWidths(next);
      persist(next);
    },
    [persist],
  );

  /** 列的最终宽度：用户设置 > 默认值 */
  const getWidth = useCallback((columnKey: string) => widths[columnKey] ?? defaults[columnKey], [defaults, widths]);

  return { widths, getWidth, startResize, resetWidths };
}
