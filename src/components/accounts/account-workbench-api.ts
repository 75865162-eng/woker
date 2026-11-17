"use client";

import { type PermissionAction } from "@/lib/accounts/permissions";
import { buildDefaultRoleCatalog, type RoleCatalogItem } from "@/lib/accounts/role-catalog";
import { normalizeTeamAccounts, type AccountRoleId } from "@/lib/accounts/team-roster";

export type AccountStatus = "active" | "pending" | "disabled" | "archived";

export type RoleId = AccountRoleId;

export type Account = {
  id: string;
  username?: string;
  name: string;
  email: string;
  password?: string;
  passwordDirty?: boolean;
  department: string;
  title: string;
  roleId: RoleId;
  status: AccountStatus;
  lastActiveAt: string;
  amazonStorePermissions?: string;
  multiPlatformStorePermissions?: string;
  phone?: string;
  lastLoginIp?: string;
  lastLoginAt?: string;
  sourceCreatedAt?: string;
};

export type Role = {
  id: RoleId;
  name: string;
  description: string;
  memberCount: number;
  permissions: Record<string, PermissionAction[]>;
  sortOrder: number;
};

export const defaultRoleCatalog = buildDefaultRoleCatalog();

export const fieldClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10";

export const teamMembersApiPath = "/api/accounts/team-members";

export const rolesApiPath = "/api/accounts/roles";

export const accountPageSize = 10;

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function isDefaultSuperAccount(account: { id?: string; email?: string; username?: string; phone?: string } | string) {
  const identity = typeof account === "string" ? { id: account } : account;

  return (
    identity.id === "local-admin" ||
    identity.email?.trim().toLowerCase() === "1" ||
    identity.username?.trim().toLowerCase() === "1" ||
    identity.phone?.trim().toLowerCase() === "1"
  );
}

export function getFallbackPassword(account: { id?: string; email?: string; username?: string; phone?: string } | string) {
  return isDefaultSuperAccount(account) ? "1" : "12345678";
}

export function canManageRole(roleId: RoleId) {
  return roleId !== "owner";
}

export function canManageAccount(account: Account) {
  return !isDefaultSuperAccount(account) && account.roleId !== "owner";
}

export function normalizeRoleCatalogItem(role: RoleCatalogItem): Role {
  return {
    ...role,
    id: role.id as RoleId,
    memberCount: 0,
  };
}

export function normalizeRoleCatalogResponse(value: unknown): Role[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item, index) => {
      const role = item as Partial<RoleCatalogItem> & { id?: string; name?: string; description?: string; permissions?: Record<string, PermissionAction[]> };

      return {
        id: String(role.id ?? `role-${index + 1}`) as RoleId,
        name: String(role.name ?? "未命名角色"),
        description: String(role.description ?? ""),
        memberCount: 0,
        permissions: role.permissions ?? {},
        sortOrder: Number.isFinite(role.sortOrder) ? Number(role.sortOrder) : index,
      };
    })
    .filter((role) => Boolean(role.id.trim()));
}

export function withLoadedAccountState(account: Account): Account {
  return {
    ...account,
    password: undefined,
    passwordDirty: false,
  };
}

export function serializeAccountsForApi(accounts: Account[]) {
  return accounts.map((account) => {
    const record = { ...account };
    if (!account.passwordDirty) delete record.password;
    delete record.passwordDirty;
    return record;
  });
}

export async function loadAccountsFromApi() {
  try {
    const response = await fetch(teamMembersApiPath, { cache: "no-store" });
    if (!response.ok) return null;

    const payload = (await response.json()) as { accounts?: unknown; revision?: unknown };
    return {
      accounts: normalizeTeamAccounts(payload.accounts).map((account) => withLoadedAccountState({
        ...account,
        lastActiveAt: account.lastActiveAt ?? "未记录",
        username: account.username ?? "",
        password: account.password ?? undefined,
        amazonStorePermissions: account.amazonStorePermissions ?? "",
        multiPlatformStorePermissions: account.multiPlatformStorePermissions ?? "",
        phone: account.phone ?? "",
        lastLoginIp: account.lastLoginIp ?? "",
        lastLoginAt: account.lastLoginAt ?? "",
        sourceCreatedAt: account.sourceCreatedAt ?? "",
      })) as Account[],
      revision: typeof payload.revision === "string" ? payload.revision : "",
    };
  } catch {
    return null;
  }
}

export async function saveAccountsToApi(accounts: Account[]) {
  try {
    const response = await fetch(teamMembersApiPath, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accounts: serializeAccountsForApi(accounts) }),
    });
    const payload = (await response.json()) as { accounts?: unknown; revision?: unknown; error?: string };

    if (!response.ok) {
      return {
        ok: false as const,
        error: payload.error ?? "账号列表保存失败。",
        revision: typeof payload.revision === "string" ? payload.revision : "",
      };
    }

    return {
      ok: true as const,
      accounts: normalizeTeamAccounts(payload.accounts).map((account) => withLoadedAccountState({
        ...account,
        lastActiveAt: account.lastActiveAt ?? "未记录",
        username: account.username ?? "",
        password: account.password ?? undefined,
        amazonStorePermissions: account.amazonStorePermissions ?? "",
        multiPlatformStorePermissions: account.multiPlatformStorePermissions ?? "",
        phone: account.phone ?? "",
        lastLoginIp: account.lastLoginIp ?? "",
        lastLoginAt: account.lastLoginAt ?? "",
        sourceCreatedAt: account.sourceCreatedAt ?? "",
      })) as Account[],
      revision: typeof payload.revision === "string" ? payload.revision : "",
    };
  } catch {
    return {
      ok: false as const,
      error: "账号列表保存失败。",
      revision: "",
    };
  }
}

export async function loadRolesFromApi() {
  try {
    const response = await fetch(rolesApiPath, { cache: "no-store" });
    if (!response.ok) return null;

    const payload = (await response.json()) as { roles?: unknown; revision?: string };
    return {
      roles: normalizeRoleCatalogResponse(payload.roles),
      revision: typeof payload.revision === "string" ? payload.revision : "",
    };
  } catch {
    return null;
  }
}

export async function saveRolesToApi(roles: Role[]) {
  try {
    const response = await fetch(rolesApiPath, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roles }),
    });

    if (!response.ok) {
      return {
        ok: false as const,
        revision: "",
      };
    }

    const payload = (await response.json()) as { revision?: string; roles?: unknown };
    return {
      ok: true as const,
      revision: typeof payload.revision === "string" ? payload.revision : "",
      roles: normalizeRoleCatalogResponse(payload.roles),
    };
  } catch {
    return {
      ok: false as const,
      revision: "",
    };
  }
}
