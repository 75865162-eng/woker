"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type UIState = {
  navOpen: boolean;
  toast: string;
  sandboxExtras: boolean;
  setNav: (open: boolean) => void;
  flash: (toast: string) => void;
  setSandboxExtras: (on: boolean) => void;
};

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      navOpen: false,
      toast: "",
      sandboxExtras: true,
      setNav: (navOpen) => set({ navOpen }),
      flash: (toast) => {
        set({ toast });
        window.setTimeout(() => set({ toast: "" }), 3200);
      },
      setSandboxExtras: (sandboxExtras) => set({ sandboxExtras }),
    }),
    { name: "tiaotiao-lili-ui", partialize: (state) => ({ sandboxExtras: state.sandboxExtras }) },
  ),
);

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    el.remove();
  }
}
