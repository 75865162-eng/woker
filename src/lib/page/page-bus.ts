"use client";

/**
 * 页面级事件总线。
 *
 * Wimoor 原系统里「刷新 / 导出 / 清空缓存」多由 EventBus 或 provide/inject 广播；
 * 统一 PageFrame 挂在 layout 层，与实际工作台不在同一组件树，用 window CustomEvent
 * 解耦：框架发指令，页面自行订阅执行，避免侵入式改写 50 个 page.tsx。
 */
import { useEffect, useRef } from "react";

export const PageEvents = {
  refresh: "erp:page:refresh",
  export: "erp:page:export",
  invalidate: "erp:page:invalidate",
  filterChange: "erp:page:filter-change",
  toast: "erp:page:toast",
} as const;

export type PageEventType = (typeof PageEvents)[keyof typeof PageEvents];

export function emitPageEvent(type: PageEventType, detail?: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

export function usePageEvent(type: PageEventType, handler: (detail: unknown) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const listener = (event: Event) => {
      handlerRef.current((event as CustomEvent<unknown>).detail);
    };
    window.addEventListener(type, listener);
    return () => window.removeEventListener(type, listener);
  }, [type]);
}
