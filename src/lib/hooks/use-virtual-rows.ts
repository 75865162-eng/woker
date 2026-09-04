"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type VirtualRowsOptions = {
  itemCount: number;
  rowHeight: number;
  overscan?: number;
  enabled?: boolean;
};

type VirtualRowsState = {
  startIndex: number;
  endIndex: number;
  beforeHeight: number;
  afterHeight: number;
  totalHeight: number;
};

const defaultState: VirtualRowsState = {
  startIndex: 0,
  endIndex: 0,
  beforeHeight: 0,
  afterHeight: 0,
  totalHeight: 0,
};

export function useVirtualRows<T extends HTMLElement>({ itemCount, rowHeight, overscan = 6, enabled = true }: VirtualRowsOptions) {
  const containerRef = useRef<T | null>(null);
  const [state, setState] = useState<VirtualRowsState>(defaultState);

  const recompute = useCallback(() => {
    if (!enabled || itemCount <= 0) {
      setState(defaultState);
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const viewportHeight = container.clientHeight || rowHeight * Math.min(itemCount, overscan * 2 + 12);
    const scrollTop = container.scrollTop;
    const visibleCount = Math.ceil(viewportHeight / rowHeight);
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const endIndex = Math.min(itemCount, startIndex + visibleCount + overscan * 2);

    setState({
      startIndex,
      endIndex,
      beforeHeight: startIndex * rowHeight,
      afterHeight: Math.max(0, (itemCount - endIndex) * rowHeight),
      totalHeight: itemCount * rowHeight,
    });
  }, [enabled, itemCount, overscan, rowHeight]);

  useEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    if (!enabled || itemCount <= 0) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    let frame = 0;
    const schedule = () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }

      frame = window.requestAnimationFrame(recompute);
    };

    container.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }

      container.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [enabled, itemCount, recompute]);

  return useMemo(
    () => ({
      containerRef,
      ...state,
    }),
    [state],
  );
}
