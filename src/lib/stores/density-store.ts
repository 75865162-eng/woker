"use client";

import { create } from "zustand";

/**
 * 信息密度偏好。
 *
 * 三档的差异全部落在 CSS 变量上（见 globals.css 第 4 层），
 * 因此切换密度会真实改变表格行高、单元格内距、控件高度与正文字号，
 * 而不只是换个按钮状态。
 *
 * 持久化走 localStorage 单键，不使用 middleware：
 * 需要精确控制「何时读、何时写」，避免 SSR 水合差异。
 */

export type Density = "compact" | "standard" | "comfortable";

export const DENSITY_STORAGE_KEY = "erp-density";
export const DENSITY_ORDER: Density[] = ["compact", "standard", "comfortable"];

export const DENSITY_LABELS: Record<Density, string> = {
  compact: "紧凑",
  standard: "标准",
  comfortable: "宽松",
};

export const DENSITY_HINTS: Record<Density, string> = {
  compact: "行高 32px · 适合盘点、对账等长表格",
  standard: "行高 40px · 默认工作密度",
  comfortable: "行高 48px · 适合演示与审阅",
};

export function isDensity(value: unknown): value is Density {
  return value === "compact" || value === "standard" || value === "comfortable";
}

export function readStoredDensity(): Density {
  if (typeof window === "undefined") {
    return "standard";
  }

  try {
    const stored = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    return isDensity(stored) ? stored : "standard";
  } catch {
    return "standard";
  }
}

export function applyDensity(density: Density) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.density = density;
}

type DensityState = {
  density: Density;
  hydrated: boolean;
  setDensity: (density: Density) => void;
  hydrate: () => void;
};

export const useDensityStore = create<DensityState>((set, get) => ({
  density: "standard",
  hydrated: false,
  setDensity: (density) => {
    if (!isDensity(density)) {
      return;
    }

    applyDensity(density);
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
    } catch {
      // 隐私模式下写入失败不影响本次切换，只是下次不记得。
    }
    set({ density });
  },
  hydrate: () => {
    if (get().hydrated) {
      return;
    }

    const density = readStoredDensity();
    applyDensity(density);
    set({ density, hydrated: true });
  },
}));
