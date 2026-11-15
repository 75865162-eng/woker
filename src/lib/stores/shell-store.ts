"use client";

import { create } from "zustand";

/**
 * 壳层折叠状态。
 *
 * 展开 224px / 折叠 64px，选择持久化到 localStorage。
 * 折叠时导航只保留图标，靠 title 与 aria-label 保证可达。
 */

export const SHELL_NAV_STORAGE_KEY = "erp-nav-collapsed";

function readStoredCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(SHELL_NAV_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

type ShellState = {
  navCollapsed: boolean;
  hydrated: boolean;
  toggleNav: () => void;
  hydrateNav: () => void;
};

export const useShellStore = create<ShellState>((set, get) => ({
  navCollapsed: false,
  hydrated: false,
  toggleNav: () => {
    const next = !get().navCollapsed;
    try {
      window.localStorage.setItem(SHELL_NAV_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // 写入失败只影响下次记忆，不影响本次折叠。
    }
    set({ navCollapsed: next });
  },
  hydrateNav: () => {
    if (get().hydrated) {
      return;
    }

    set({ navCollapsed: readStoredCollapsed(), hydrated: true });
  },
}));
