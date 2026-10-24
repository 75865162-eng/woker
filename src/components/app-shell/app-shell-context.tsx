"use client";

import { createContext, useContext } from "react";
import type { RolePermissionMap } from "@/lib/accounts/permissions";

type AppShellUserContextValue = {
  organizationId?: string;
  userId?: string;
  userName?: string;
  userRole?: string;
  rolePermissions?: RolePermissionMap | null;
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
