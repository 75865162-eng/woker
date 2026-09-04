"use client";

import { createContext, useContext } from "react";

type AppShellUserContextValue = {
  userName?: string;
  userRole?: string;
  userInitials: string;
};

const AppShellUserContext = createContext<AppShellUserContextValue | null>(null);

export function AppShellUserProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: AppShellUserContextValue;
}) {
  return <AppShellUserContext.Provider value={value}>{children}</AppShellUserContext.Provider>;
}

export function useAppShellUser() {
  return useContext(AppShellUserContext);
}
