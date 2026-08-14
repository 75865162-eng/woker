"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Check,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserCog,
  UserPlus,
  UsersRound,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createFullPermissions,
  createPermissions,
  permissionActions,
  permissionModules,
  rolePermissionsCookieName,
  type PermissionAction,
  type RolePermissionMap,
} from "@/lib/accounts/permissions";
import { normalizeTeamAccounts, type AccountRoleId } from "@/lib/accounts/team-roster";
import {
  exportAccountWorkbook,
  parseAccountWorkbookFile,
} from "@/lib/accounts/account-workbook";

type AccountStatus = "active" | "pending" | "disabled";
type RoleId = AccountRoleId;

type Account = {
  id: string;
  username: string;
  name: string;
  email: string;
  password?: string;
  department: string;
  title: string;
  roleId: RoleId;
  status: AccountStatus;
  lastActiveAt: string;
  amazonStorePermissions: string;
  multiPlatformStorePermissions: string;
  phone: string;
  lastLoginIp: string;
  lastLoginAt: string;
  sourceCreatedAt: string;
};

type Role = {
  id: RoleId;
  name: string;
  description: string;
  memberCount: number;
  permissions: Record<string, PermissionAction[]>;
};

type RoleSettings = {
  labels: Partial<Record<RoleId, string>>;
  hiddenRoleIds: RoleId[];
};

type CurrentAuthUser = {
  id: string;
  email: string;
  role: string;
};

const initialRoles: Role[] = [
  {
    id: "owner",
    name: "超级管理员",
    description: "全局配置、账号、权限与审计管理",
    memberCount: 1,
    permissions: createFullPermissions(),
  },
  {
    id: "database_admin",
    name: "数据库管理员",
    description: "维护账号、权限、系统设置和数据治理，不默认拥有业务审批权",
    memberCount: 0,
    permissions: createPermissions(
      ["products", "workspace", "searchMerge", "searchMergeHistory", "listingAi", "imageUpscale", "logistics", "tasks", "versions", "accounts", "settings"],
      ["view", "create", "edit", "export"],
    ),
  },
  {
    id: "operations_supervisor",
    name: "主管",
    description: "管理业务流转、成员分工和审批",
    memberCount: 1,
    permissions: createPermissions(["products", "listingAi", "imageUpscale"], ["view", "create", "edit", "approve", "export"]),
  },
  {
    id: "operations",
    name: "运营",
    description: "负责 SKU 运营确认、资料完善和后续转交",
    memberCount: 0,
    permissions: createPermissions(["products", "listingAi", "imageUpscale"], ["view", "create", "edit", "export"]),
  },
  {
    id: "operations_assistant",
    name: "运营助理",
    description: "协助维护商品资料和运营任务",
    memberCount: 0,
    permissions: createPermissions(["products", "listingAi"], ["view", "create", "edit"]),
  },
  {
    id: "developer",
    name: "开发",
    description: "负责新品开发、供应商资料和选品信息维护",
    memberCount: 0,
    permissions: createPermissions(["products", "logistics"], ["view", "create", "edit", "export"]),
  },
  {
    id: "designer",
    name: "美工",
    description: "处理分配给自己的商品图片和视觉资料",
    memberCount: 0,
    permissions: createPermissions(["products", "listingAi", "imageUpscale"], ["view", "edit", "export"]),
  },
  {
    id: "warehouse",
    name: "仓管",
    description: "处理入库、出库、箱规和货件资料",
    memberCount: 0,
    permissions: createPermissions(["logistics"], ["view", "create", "edit", "export"]),
  },
  {
    id: "finance",
    name: "财务",
    description: "查看业务数据并导出财务所需资料",
    memberCount: 0,
    permissions: createPermissions(["products", "workspace", "logistics", "versions"], ["view", "export"]),
  },
  {
    id: "warehouse_supervisor",
    name: "仓库主管",
    description: "管理仓库作业、物流资料和相关审批",
    memberCount: 0,
    permissions: createPermissions(["logistics", "accounts"], ["view", "create", "edit", "approve", "export"]),
  },
  {
    id: "viewer",
    name: "查看者",
    description: "只查看工作台、商品、Listing AI 和物流基础数据",
    memberCount: 0,
    permissions: createPermissions(["products", "workspace", "listingAi", "logistics", "tasks"], ["view"]),
  },
  {
    id: "procurement",
    name: "采购",
    description: "维护采购商品资料并协同物流处理",
    memberCount: 0,
    permissions: createPermissions(["products", "logistics"], ["view", "create", "edit", "export"]),
  },
];

const statusLabels: Record<AccountStatus, string> = {
  active: "在线",
  pending: "待激活",
  disabled: "已停用",
};

const statusTones: Record<AccountStatus, "green" | "amber" | "gray"> = {
  active: "green",
  pending: "amber",
  disabled: "gray",
};

const fieldClass =
  "w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10";
const accountTableCellClass = "h-[72px] px-4 py-2 align-top";
const accountTableScrollClass = "max-h-14 overflow-auto overscroll-contain whitespace-pre-wrap break-words pr-1 leading-5";
const teamMembersApiPath = "/api/accounts/team-members";
const rolePermissionsApiPath = "/api/accounts/role-permissions";
const defaultMemberFallbackRoleId: RoleId = "viewer";

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function isDefaultSuperAccount(account: { id?: string; email?: string; username?: string }) {
  return (
    account.id === "local-admin" ||
    account.email?.trim().toLowerCase() === "1" ||
    account.username?.trim().toLowerCase() === "1"
  );
}

function getFallbackPassword(account: { id?: string; email?: string; username?: string } | string) {
  const identity = typeof account === "string" ? { id: account } : account;

  return isDefaultSuperAccount(identity) ? "1" : "12345678";
}

function withAccountPassword(account: Account): Account {
  return {
    ...account,
    password: account.password || getFallbackPassword(account),
  };
}

function stripAccountPasswords(accounts: Account[]) {
  return accounts.map((account) => {
    const record = { ...account };
    delete record.password;
    return record;
  });
}

async function loadAccountsFromApi() {
  try {
    const response = await fetch(teamMembersApiPath, { cache: "no-store" });
    if (!response.ok) return null;

    const payload = (await response.json()) as { accounts?: unknown; revision?: unknown };
    return {
      accounts: normalizeTeamAccounts(payload.accounts).map((account) => withAccountPassword({
        ...account,
        lastActiveAt: account.lastActiveAt ?? "未记录",
        username: account.username ?? "",
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

async function saveAccountsToApi(accounts: Account[], revision: string) {
  try {
    const response = await fetch(teamMembersApiPath, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accounts: stripAccountPasswords(accounts), revision }),
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
      accounts: normalizeTeamAccounts(payload.accounts).map((account) => withAccountPassword({
        ...account,
        lastActiveAt: account.lastActiveAt ?? "未记录",
        username: account.username ?? "",
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

function normalizeRoleSettings(value: unknown): RoleSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { labels: {}, hiddenRoleIds: [] };
  }

  const record = value as Partial<RoleSettings>;
  const labels =
    record.labels && typeof record.labels === "object" && !Array.isArray(record.labels)
      ? (record.labels as Partial<Record<RoleId, string>>)
      : {};
  const hiddenRoleIds = Array.isArray(record.hiddenRoleIds)
    ? record.hiddenRoleIds.filter((roleId): roleId is RoleId => initialRoles.some((role) => role.id === roleId) && roleId !== "owner")
    : [];

  return {
    labels,
    hiddenRoleIds: Array.from(new Set(hiddenRoleIds)),
  };
}

async function loadRoleAccessFromApi() {
  try {
    const response = await fetch(rolePermissionsApiPath, { cache: "no-store" });
    if (!response.ok) return null;

    const payload = (await response.json()) as { permissions?: RolePermissionMap; roleSettings?: unknown };
    return {
      permissions: payload.permissions ?? null,
      roleSettings: normalizeRoleSettings(payload.roleSettings),
    };
  } catch {
    return null;
  }
}

async function loadCurrentAuthUser() {
  try {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    if (!response.ok) return null;

    const payload = (await response.json()) as { user?: CurrentAuthUser | null };
    return payload.user ?? null;
  } catch {
    return null;
  }
}

async function saveRoleAccessToApi(permissions: RolePermissionMap, roleSettings: RoleSettings) {
  const response = await fetch(rolePermissionsApiPath, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ permissions, roleSettings }),
  });

  return response.ok;
}

export function AccountWorkbench() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentAuthUser | null>(null);
  const [accountRevision, setAccountRevision] = useState("");
  const [accountSaveError, setAccountSaveError] = useState("");
  const [roles, setRoles] = useState(initialRoles);
  const [hiddenRoleIds, setHiddenRoleIds] = useState<RoleId[]>([]);
  const [activeRoleId, setActiveRoleId] = useState<RoleId>("operations");
  const [roleMenuId, setRoleMenuId] = useState<RoleId | null>(null);
  const [renameRole, setRenameRole] = useState<Role | null>(null);
  const [memberRole, setMemberRole] = useState<Role | null>(null);
  const [deleteRole, setDeleteRole] = useState<Role | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | AccountStatus>("all");
  const [query, setQuery] = useState("");
  const [newAccountOpen, setNewAccountOpen] = useState(false);
  const [passwordAccount, setPasswordAccount] = useState<Account | null>(null);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [permissionSavedAt, setPermissionSavedAt] = useState("");
  const [accountImportMessage, setAccountImportMessage] = useState("");
  const [accountImporting, setAccountImporting] = useState(false);
  const accountImportInputRef = useRef<HTMLInputElement>(null);
  const canSeeSuperAdmin = currentUser?.role === "owner" && (currentUser.id === "local-admin" || currentUser.email === "1");
  const isSupervisor = currentUser?.role === "operations_supervisor";
  const canManageRole = useCallback((roleId: RoleId) => {
    if (isSupervisor) return !["owner", "database_admin", "operations_supervisor"].includes(roleId);

    return canSeeSuperAdmin || roleId !== "owner";
  }, [canSeeSuperAdmin, isSupervisor]);
  const canManageAccount = useCallback((account: Account) => {
    if (isDefaultSuperAccount(account)) return false;
    if (canSeeSuperAdmin) return true;
    if (account.roleId === "owner") return false;
    if (isSupervisor && (account.id === currentUser?.id || account.roleId === "database_admin")) return false;

    return true;
  }, [canSeeSuperAdmin, currentUser?.id, isSupervisor]);
  const availableRoles = useMemo(
    () => roles.filter((role) => canManageRole(role.id) && !hiddenRoleIds.includes(role.id)),
    [canManageRole, hiddenRoleIds, roles],
  );
  const visibleAccounts = useMemo(
    () => (canSeeSuperAdmin ? accounts : accounts.filter((account) => account.roleId !== "owner")),
    [accounts, canSeeSuperAdmin],
  );
  const visibleRoles = useMemo(
    () =>
      availableRoles.map((role) => ({
        ...role,
        memberCount: visibleAccounts.filter((account) => account.roleId === role.id).length,
      })),
    [availableRoles, visibleAccounts],
  );

  useEffect(() => {
    if (!visibleRoles.length || visibleRoles.some((role) => role.id === activeRoleId)) return;

    setActiveRoleId(visibleRoles[0].id);
  }, [activeRoleId, visibleRoles]);

  useEffect(() => {
    let canceled = false;

    void loadCurrentAuthUser().then((user) => {
      if (canceled) return;

      setCurrentUser(user);
    });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    void loadAccountsFromApi().then((payload) => {
      if (canceled) return;

      if (!payload?.accounts.length) {
        return;
      }

      setAccounts(payload.accounts);
      setAccountRevision(payload.revision);
    });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    void loadRoleAccessFromApi().then((savedRoleAccess) => {
      if (canceled || !savedRoleAccess) return;

      setRoles((current) =>
        current.map((role) => ({
          ...role,
          name: savedRoleAccess.roleSettings.labels[role.id] ?? role.name,
          permissions: {
            ...role.permissions,
            ...(savedRoleAccess.permissions?.[role.id] ?? {}),
          },
        })),
      );
      setHiddenRoleIds(savedRoleAccess.roleSettings.hiddenRoleIds);
    });

    return () => {
      canceled = true;
    };
  }, []);

  const activeRole = visibleRoles.find((role) => role.id === activeRoleId) ?? visibleRoles[0] ?? availableRoles[0] ?? roles[0];
  const canEditActiveRolePermissions = activeRole.id !== "owner";

  const filteredAccounts = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return visibleAccounts.filter((account) => {
      const statusMatched = statusFilter === "all" || account.status === statusFilter;
      const keywordMatched =
        !keyword ||
        account.name.toLowerCase().includes(keyword) ||
        account.email.toLowerCase().includes(keyword) ||
        account.department.toLowerCase().includes(keyword) ||
        account.title.toLowerCase().includes(keyword);

      return statusMatched && keywordMatched;
    });
  }, [query, statusFilter, visibleAccounts]);

  const activeAccounts = visibleAccounts.filter((account) => account.status === "active").length;
  const pendingAccounts = visibleAccounts.filter((account) => account.status === "pending").length;
  const disabledAccounts = visibleAccounts.filter((account) => account.status === "disabled").length;
  const departments = Array.from(new Set(visibleAccounts.map((account) => account.department)));
  const roleMemberCount = visibleAccounts.filter((account) => account.roleId === activeRole.id).length;
  const hasUsername = visibleAccounts.some((account) => account.username);
  const hasAmazonStorePermissions = visibleAccounts.some((account) => account.amazonStorePermissions);
  const hasMultiPlatformStorePermissions = visibleAccounts.some((account) => account.multiPlatformStorePermissions);
  const hasPhone = visibleAccounts.some((account) => account.phone);
  const hasLastLoginIp = visibleAccounts.some((account) => account.lastLoginIp);
  const hasLastLoginAt = visibleAccounts.some((account) => account.lastLoginAt);
  const hasSourceCreatedAt = visibleAccounts.some((account) => account.sourceCreatedAt);

  function commitAccounts(updater: (current: Account[]) => Account[]) {
    setAccounts((current) => {
      const next = updater(current);
      const revision = accountRevision;
      setAccountSaveError("");
      void saveAccountsToApi(next, revision).then((result) => {
        if (!result) return;

        if (!result.ok) {
          setAccountSaveError(result.error);
          void loadAccountsFromApi().then((payload) => {
            if (!payload) return;
            setAccounts(payload.accounts);
            setAccountRevision(payload.revision || result.revision);
          });
          return;
        }

        setAccounts(result.accounts);
        setAccountRevision(result.revision);
      });
      return next;
    });
  }

  function createAccount(payload: Omit<Account, "id" | "status" | "lastActiveAt">) {
    if (isDefaultSuperAccount(payload)) {
      setAccountSaveError("默认超级账号固定为最高权限，不能重复创建或调整。");
      return;
    }

    const id = `u-${Date.now()}`;
    const nextAccount: Account = {
      ...payload,
      id,
      password: payload.password || getFallbackPassword({ ...payload, id }),
      status: "pending",
      lastActiveAt: "待首次登录",
    };

    commitAccounts((current) => [nextAccount, ...current]);
    setNewAccountOpen(false);
  }

  function updateAccountRole(accountId: string, roleId: RoleId) {
    commitAccounts((current) =>
      current.map((account) => {
        if (account.id !== accountId || account.roleId === roleId || !canManageAccount(account)) return account;
        return { ...account, roleId };
      }),
    );
  }

  function saveAccount(account: Account) {
    commitAccounts((current) => current.map((item) => (item.id === account.id && canManageAccount(item) ? account : item)));
    setEditAccount(null);
  }

  function saveAccountPassword(accountId: string, password: string) {
    commitAccounts((current) =>
      current.map((account) => (account.id === accountId && canManageAccount(account) ? { ...account, password } : account)),
    );
    setPasswordAccount(null);
  }

  function toggleAccountStatus(accountId: string) {
    commitAccounts((current) =>
      current.map((account) =>
        account.id === accountId && canManageAccount(account)
          ? { ...account, status: account.status === "disabled" ? "active" : "disabled" }
          : account,
      ),
    );
  }

  const roleLabels = useMemo(
    () => Object.fromEntries(roles.map((role) => [role.id, role.name])) as Record<RoleId, string>,
    [roles],
  );

  async function exportAccounts() {
    const blob = await exportAccountWorkbook(visibleAccounts, roleLabels);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    downloadBlob(blob, `账号列表-${stamp}.xlsx`);
  }

  async function importAccounts(file: File) {
    setAccountImportMessage("");
    setAccountSaveError("");
    setAccountImporting(true);

    try {
      const { accounts: importedAccounts, errors } = await parseAccountWorkbookFile(file, roleLabels);
      if (!importedAccounts.length) {
        throw new Error(errors[0] ?? "文件中没有可导入的有效账号。");
      }

      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = errors.length;
      commitAccounts((current) => {
        const next = [...current];

        importedAccounts.forEach((imported, index) => {
          const existingIndex = next.findIndex(
            (account) =>
              account.id === imported.id ||
              (Boolean(imported.username) && account.username === imported.username) ||
              (Boolean(imported.email) && account.email.trim().toLowerCase() === imported.email?.toLowerCase()),
          );
          if (existingIndex >= 0) {
            const existing = next[existingIndex];
            if (!canManageAccount(existing) || !canManageRole(imported.roleId)) {
              skippedCount += 1;
              return;
            }
            next[existingIndex] = {
              ...existing,
              id: existing.id,
              username: imported.username || existing.username,
              name: imported.name,
              email: imported.email || existing.email,
              department: imported.department || existing.department,
              title: imported.title || existing.title,
              roleId: imported.roleId,
              status: imported.status,
              password: existing.password,
              lastActiveAt: imported.lastActiveAt || existing.lastActiveAt,
              amazonStorePermissions: imported.amazonStorePermissions || existing.amazonStorePermissions,
              multiPlatformStorePermissions: imported.multiPlatformStorePermissions || existing.multiPlatformStorePermissions,
              phone: imported.phone || existing.phone,
              lastLoginIp: imported.lastLoginIp || existing.lastLoginIp,
              lastLoginAt: imported.lastLoginAt || existing.lastLoginAt,
              sourceCreatedAt: imported.sourceCreatedAt || existing.sourceCreatedAt,
            };
            updatedCount += 1;
            return;
          }

          if (isDefaultSuperAccount(imported)) {
            skippedCount += 1;
            return;
          }

          if (!canManageRole(imported.roleId)) {
            skippedCount += 1;
            return;
          }
          const id = `u-${Date.now()}-${index + 1}`;
          const nextAccount: Account = {
            id,
            username: imported.username ?? "",
            name: imported.name,
            email: imported.email ?? "",
            department: imported.department,
            title: imported.title,
            roleId: imported.roleId,
            status: imported.status,
            password: getFallbackPassword({ id, email: imported.email ?? "", username: imported.username ?? "" }),
            lastActiveAt: imported.lastActiveAt || "待首次登录",
            amazonStorePermissions: imported.amazonStorePermissions ?? "",
            multiPlatformStorePermissions: imported.multiPlatformStorePermissions ?? "",
            phone: imported.phone ?? "",
            lastLoginIp: imported.lastLoginIp ?? "",
            lastLoginAt: imported.lastLoginAt ?? "",
            sourceCreatedAt: imported.sourceCreatedAt ?? "",
          };
          next.unshift(nextAccount);
          createdCount += 1;
        });

        return next;
      });
      setAccountImportMessage(`已导入：新增 ${createdCount} 个，更新 ${updatedCount} 个${skippedCount ? `，跳过 ${skippedCount} 行` : ""}。`);
    } catch (error) {
      setAccountSaveError(error instanceof Error ? error.message : "账号列表导入失败。");
    } finally {
      setAccountImporting(false);
      if (accountImportInputRef.current) accountImportInputRef.current.value = "";
    }
  }

  function togglePermission(moduleId: string, action: PermissionAction) {
    if (!canEditActiveRolePermissions) return;

    setRoles((current) =>
      current.map((role) => {
        if (role.id !== activeRole.id) return role;

        const currentActions = role.permissions[moduleId] ?? [];
        const nextActions = currentActions.includes(action)
          ? currentActions.filter((item) => item !== action)
          : [...currentActions, action];

        return {
          ...role,
          permissions: {
            ...role.permissions,
            [moduleId]: nextActions,
          },
        };
      }),
    );
  }

  function setModulePermissions(moduleId: string, actions: PermissionAction[]) {
    if (!canEditActiveRolePermissions) return;

    setRoles((current) =>
      current.map((role) => {
        if (role.id !== activeRole.id) return role;

        return {
          ...role,
          permissions: {
            ...role.permissions,
            [moduleId]: actions,
          },
        };
      }),
    );
  }

  function buildRolePermissionMap(roleList: Role[]) {
    return Object.fromEntries(
      roleList.map((role) => [
        role.id,
        Object.fromEntries(permissionModules.map((module) => [module.id, role.permissions[module.id] ?? []])),
      ]),
    ) as RolePermissionMap;
  }

  function buildRoleSettings(roleList: Role[], hiddenIds: RoleId[]): RoleSettings {
    return {
      labels: Object.fromEntries(roleList.map((role) => [role.id, role.name])) as Partial<Record<RoleId, string>>,
      hiddenRoleIds: hiddenIds,
    };
  }

  async function saveRoleAccess(roleList = roles, hiddenIds = hiddenRoleIds, reload = false) {
    const rolePermissionMap = buildRolePermissionMap(roleList);
    const roleSettings = buildRoleSettings(roleList, hiddenIds);
    const serialized = JSON.stringify(rolePermissionMap);
    const savedToApi = await saveRoleAccessToApi(rolePermissionMap, roleSettings);

    document.cookie = `${rolePermissionsCookieName}=${encodeURIComponent(serialized)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    setPermissionSavedAt(`${new Date().toLocaleString("zh-CN", { hour12: false })}${savedToApi ? "" : "（仅本机）"}`);
    if (reload) window.setTimeout(() => window.location.reload(), 250);
  }

  async function saveRolePermissions() {
    await saveRoleAccess(roles, hiddenRoleIds, true);
  }

  function saveRoleName(roleId: RoleId, name: string) {
    if (roleId === "owner") return;

    const trimmed = name.trim();
    if (!trimmed) return;

    const nextRoles = roles.map((role) => (role.id === roleId ? { ...role, name: trimmed } : role));
    setRoles(nextRoles);
    setRenameRole(null);
    void saveRoleAccess(nextRoles, hiddenRoleIds);
  }

  function saveRoleMembers(roleId: RoleId, memberIds: string[]) {
    if (roleId === "owner") return;

    const memberIdSet = new Set(memberIds);
    const fallbackRoleId = roleId === defaultMemberFallbackRoleId
      ? availableRoles.find((role) => role.id !== roleId)?.id ?? roleId
      : defaultMemberFallbackRoleId;

    commitAccounts((current) =>
      current.map((account) => {
        if (!canManageAccount(account)) return account;
        if (memberIdSet.has(account.id)) return { ...account, roleId };
        if (account.roleId === roleId && fallbackRoleId !== roleId) return { ...account, roleId: fallbackRoleId };
        return account;
      }),
    );
    setMemberRole(null);
  }

  function confirmDeleteRole(roleId: RoleId) {
    if (roleId === "owner" || roleId === defaultMemberFallbackRoleId) return;

    const nextHiddenRoleIds = Array.from(new Set([...hiddenRoleIds, roleId]));
    setHiddenRoleIds(nextHiddenRoleIds);
    commitAccounts((current) =>
      current.map((account) =>
        account.roleId === roleId && canManageAccount(account) ? { ...account, roleId: defaultMemberFallbackRoleId } : account,
      ),
    );
    if (activeRoleId === roleId) {
      setActiveRoleId(availableRoles.find((role) => role.id !== roleId)?.id ?? defaultMemberFallbackRoleId);
    }
    setDeleteRole(null);
    setRoleMenuId(null);
    void saveRoleAccess(roles, nextHiddenRoleIds);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: "all", label: "全部账号" },
            { id: "active", label: "在线" },
            { id: "pending", label: "待激活" },
            { id: "disabled", label: "已停用" },
          ].map((item) => (
            <button
              key={item.id}
              className={`h-8 rounded-md border px-3 text-xs font-bold transition ${
                statusFilter === item.id ? "border-brand bg-brand text-white" : "border-border bg-white text-muted hover:text-foreground"
              }`}
              onClick={() => setStatusFilter(item.id as typeof statusFilter)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              className={`${fieldClass} h-9 min-w-72 pl-9`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索姓名、邮箱、部门"
            />
          </div>
          <Button onClick={() => setNewAccountOpen(true)}>
            <Plus className="h-4 w-4" />
            新建账号
          </Button>
          <input
            ref={accountImportInputRef}
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importAccounts(file);
            }}
            type="file"
          />
          <Button variant="secondary" disabled={accountImporting} onClick={() => accountImportInputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            {accountImporting ? "导入中" : "导入"}
          </Button>
          <Button variant="secondary" onClick={() => void exportAccounts()}>
            <Download className="h-4 w-4" />
            导出
          </Button>
        </div>
      </div>
      {accountSaveError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {accountSaveError}
        </div>
      ) : null}
      {accountImportMessage ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
          {accountImportMessage}
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <MetricCard title="账号总数" value={visibleAccounts.length} note={`在线 ${activeAccounts}`} icon={UsersRound} tone="blue" />
        <MetricCard title="业务部门" value={departments.length} note={departments.slice(0, 2).join(" / ")} icon={Building2} tone="green" />
        <MetricCard title="待激活账号" value={pendingAccounts} note="新建后首次登录改密" icon={Mail} tone="amber" />
        <MetricCard title="停用账号" value={disabledAccounts} note="保留审计记录" icon={LockKeyhole} tone="gray" />
      </section>

      <section>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 px-4 py-3">
            <div>
              <CardTitle>账号列表</CardTitle>
              <p className="mt-0.5 text-xs text-muted">创建、导入、导出账号，并维护角色和状态。</p>
            </div>
            <Badge tone="gray">{filteredAccounts.length} / {visibleAccounts.length}</Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead className="bg-surface-muted text-xs font-bold text-muted">
                  <tr>
                    <th className="px-4 py-2.5 text-left">姓名</th>
                    {hasUsername ? <th className="px-4 py-2.5 text-left">用户名</th> : null}
                    <th className="px-4 py-2.5 text-left">邮箱</th>
                    <th className="px-4 py-2.5 text-left">部门 / 岗位</th>
                    <th className="w-[200px] min-w-[200px] px-4 py-2.5 text-left">系统角色</th>
                    {hasAmazonStorePermissions ? <th className="px-4 py-2.5 text-left">亚马逊店铺权限</th> : null}
                    {hasMultiPlatformStorePermissions ? <th className="px-4 py-2.5 text-left">多平台店铺权限</th> : null}
                    {hasPhone ? <th className="px-4 py-2.5 text-left">手机号</th> : null}
                    <th className="px-4 py-2.5 text-left">状态</th>
                    {hasLastLoginIp ? <th className="px-4 py-2.5 text-left">最近登录 IP</th> : null}
                    {hasLastLoginAt ? <th className="px-4 py-2.5 text-left">最近登录时间</th> : null}
                    {hasSourceCreatedAt ? <th className="px-4 py-2.5 text-left">创建时间</th> : null}
                    <th className="px-4 py-2.5 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccounts.map((account) => {
                    const editable = canManageAccount(account);

                    return (
                      <tr key={account.id} className="border-t border-border">
                        <td className={accountTableCellClass}>
                          <div className={`${accountTableScrollClass} flex items-start gap-3`}>
                            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand/10 text-xs font-black text-brand">
                              {account.name.slice(0, 1)}
                            </div>
                            <div>
                              {editable ? (
                                <button
                                  className="font-bold text-brand underline-offset-2 hover:underline"
                                  onClick={() => setEditAccount(account)}
                                  title="编辑账号"
                                  type="button"
                                >
                                  {account.name}
                                </button>
                              ) : (
                                <p className="font-bold text-foreground">{account.name}</p>
                              )}
                              <p className="text-xs text-muted">{account.id}</p>
                            </div>
                          </div>
                        </td>
                        {hasUsername ? (
                          <td className={`${accountTableCellClass} text-muted`}>
                            <div className={accountTableScrollClass}>{account.username}</div>
                          </td>
                        ) : null}
                        <td className={`${accountTableCellClass} text-muted`}>
                          <div className={accountTableScrollClass}>{account.email}</div>
                        </td>
                        <td className={accountTableCellClass}>
                          <div className={accountTableScrollClass}>
                            <p className="font-medium text-foreground">{account.department}</p>
                            <p className="text-xs text-muted">{account.title}</p>
                          </div>
                        </td>
                        <td className={`${accountTableCellClass} w-[200px] min-w-[200px] max-w-[200px]`}>
                          {editable ? (
                            <select className={fieldClass} value={account.roleId} onChange={(event) => updateAccountRole(account.id, event.target.value as RoleId)}>
                              {availableRoles.map((role) => (
                                <option key={role.id} value={role.id}>
                                  {role.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className={`${accountTableScrollClass} text-sm font-semibold text-muted`}>
                              {roles.find((role) => role.id === account.roleId)?.name ?? account.roleId}
                            </div>
                          )}
                        </td>
                        {hasAmazonStorePermissions ? (
                          <td className={`${accountTableCellClass} max-w-64 text-muted`}>
                            <div className={accountTableScrollClass}>{account.amazonStorePermissions}</div>
                          </td>
                        ) : null}
                        {hasMultiPlatformStorePermissions ? (
                          <td className={`${accountTableCellClass} max-w-64 text-muted`}>
                            <div className={accountTableScrollClass}>{account.multiPlatformStorePermissions}</div>
                          </td>
                        ) : null}
                        {hasPhone ? (
                          <td className={`${accountTableCellClass} text-muted`}>
                            <div className={accountTableScrollClass}>{account.phone}</div>
                          </td>
                        ) : null}
                        <td className={accountTableCellClass}>
                          <Badge tone={statusTones[account.status]}>{statusLabels[account.status]}</Badge>
                        </td>
                        {hasLastLoginIp ? (
                          <td className={`${accountTableCellClass} text-muted`}>
                            <div className={accountTableScrollClass}>{account.lastLoginIp}</div>
                          </td>
                        ) : null}
                        {hasLastLoginAt ? (
                          <td className={`${accountTableCellClass} text-muted`}>
                            <div className={accountTableScrollClass}>{account.lastLoginAt}</div>
                          </td>
                        ) : null}
                        {hasSourceCreatedAt ? (
                          <td className={`${accountTableCellClass} text-muted`}>
                            <div className={accountTableScrollClass}>{account.sourceCreatedAt}</div>
                          </td>
                        ) : null}
                        <td className={accountTableCellClass}>
                          <div className="flex justify-end gap-2">
                            <Button size="icon" variant="secondary" title="编辑账号" disabled={!editable} onClick={() => setEditAccount(account)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="secondary" title="查看/修改账密" disabled={!editable} onClick={() => setPasswordAccount(account)}>
                              <KeyRound className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant={account.status === "disabled" ? "secondary" : "danger"} disabled={!editable} onClick={() => toggleAccountStatus(account.id)}>
                              {account.status === "disabled" ? "启用" : "停用"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredAccounts.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted">没有找到匹配账号。</p> : null}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="min-w-0">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 px-2.5 py-2">
              <div>
                <CardTitle className="text-sm">角色权限</CardTitle>
                <p className="mt-0.5 text-xs text-muted">选择角色后维护权限。</p>
              </div>
              <Badge className="shrink-0" tone="blue">{visibleRoles.length}</Badge>
            </CardHeader>
            <CardContent className="max-h-[360px] space-y-1 overflow-auto p-2">
              {visibleRoles.map((role) => (
                <div
                  key={role.id}
                  className={`relative rounded-md border transition ${
                    activeRole.id === role.id ? "border-brand bg-brand/5" : "border-border bg-white hover:bg-surface-muted"
                  }`}
                >
                  <button
                    className="w-full px-2.5 py-1.5 pr-10 text-left"
                    onClick={() => setActiveRoleId(role.id)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-bold text-foreground">{role.name}</p>
                      <Badge className="shrink-0" tone={activeRole.id === role.id ? "green" : "gray"}>{role.memberCount} 人</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">{role.description}</p>
                  </button>
                  <button
                    aria-label={`${role.name} 编辑选项`}
                    className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-white hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      setRoleMenuId((current) => (current === role.id ? null : role.id));
                    }}
                    title="编辑选项"
                    type="button"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {roleMenuId === role.id ? (
                    <div className="absolute right-1.5 top-8 z-20 w-36 rounded-md border border-border bg-white py-1 shadow-lg">
                      <RoleMenuItem
                        disabled={role.id === "owner"}
                        icon={Pencil}
                        label="编辑名称"
                        onClick={() => {
                          setRenameRole(role);
                          setRoleMenuId(null);
                        }}
                      />
                      <RoleMenuItem
                        disabled={role.id === "owner"}
                        icon={UserPlus}
                        label="编辑成员"
                        onClick={() => {
                          setMemberRole(role);
                          setRoleMenuId(null);
                        }}
                      />
                      <RoleMenuItem
                        disabled={role.id === "owner" || role.id === defaultMemberFallbackRoleId}
                        icon={Trash2}
                        label="删除角色"
                        tone="danger"
                        onClick={() => {
                          setDeleteRole(role);
                          setRoleMenuId(null);
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0">
          <Card>
            <CardHeader className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-sm">{activeRole.name} 权限矩阵</CardTitle>
                <p className="mt-0.5 text-xs text-muted">当前实际绑定 {roleMemberCount} 个账号。</p>
              </div>
              <Button className="h-8 shrink-0 px-2" disabled={!canEditActiveRolePermissions} size="sm" variant="secondary" onClick={saveRolePermissions}>
                <ShieldCheck className="h-3.5 w-3.5" />
                保存权限
              </Button>
            </CardHeader>
            <CardContent className="max-h-[360px] space-y-1 overflow-auto p-2">
              {permissionSavedAt ? <p className="text-xs font-medium text-green-700">权限已保存：{permissionSavedAt}，页面正在刷新。</p> : null}
              {permissionModules.map((module) => (
                <div key={module.id} className="grid grid-cols-1 gap-2 rounded-md border border-border px-2 py-1.5 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-center">
                  <p className="text-xs font-bold text-foreground">{module.name}</p>
                  <div className="grid grid-cols-5 gap-1">
                    {permissionActions.map((action) => {
                      const checked = activeRole.permissions[module.id]?.includes(action.id) ?? false;

                      return (
                        <label
                          key={action.id}
                          className={`flex h-6 items-center justify-center rounded border text-[11px] font-bold transition ${
                            checked ? "border-brand bg-brand text-white" : "border-border bg-white text-muted"
                          }`}
                          title={action.label}
                        >
                          <input
                            checked={checked}
                            className="sr-only"
                            disabled={!canEditActiveRolePermissions}
                            onChange={() => togglePermission(module.id, action.id)}
                            type="checkbox"
                          />
                          {action.label}
                        </label>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-1 sm:w-[92px]">
                    <button
                      type="button"
                      className="h-6 rounded border border-border bg-white px-1.5 text-[11px] font-bold text-muted transition hover:border-brand hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                      disabled={!canEditActiveRolePermissions}
                      onClick={() => setModulePermissions(module.id, permissionActions.map((action) => action.id))}
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      className="h-6 rounded border border-border bg-white px-1.5 text-[11px] font-bold text-muted transition hover:border-red-300 hover:text-red-700 disabled:pointer-events-none disabled:opacity-40"
                      disabled={!canEditActiveRolePermissions}
                      onClick={() => setModulePermissions(module.id, [])}
                    >
                      全取消
                    </button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      {newAccountOpen ? <AccountDialog roles={availableRoles} title="新建账号" onClose={() => setNewAccountOpen(false)} onSubmit={createAccount} /> : null}
      {editAccount ? (
        <EditAccountDialog account={editAccount} roles={availableRoles} onClose={() => setEditAccount(null)} onSubmit={saveAccount} />
      ) : null}
      {passwordAccount ? <PasswordDialog account={passwordAccount} onClose={() => setPasswordAccount(null)} onSubmit={saveAccountPassword} /> : null}
      {renameRole ? <RoleNameDialog role={renameRole} onClose={() => setRenameRole(null)} onSubmit={saveRoleName} /> : null}
      {memberRole ? (
        <RoleMembersDialog
          accounts={visibleAccounts}
          canManageAccount={canManageAccount}
          role={memberRole}
          roleLabels={roleLabels}
          onClose={() => setMemberRole(null)}
          onSubmit={saveRoleMembers}
        />
      ) : null}
      {deleteRole ? (
        <DeleteRoleDialog
          memberCount={visibleAccounts.filter((account) => account.roleId === deleteRole.id).length}
          role={deleteRole}
          onClose={() => setDeleteRole(null)}
          onSubmit={confirmDeleteRole}
        />
      ) : null}
    </div>
  );
}

function RoleMenuItem({
  disabled = false,
  icon: Icon,
  label,
  tone = "default",
  onClick,
}: {
  disabled?: boolean;
  icon: typeof UsersRound;
  label: string;
  tone?: "default" | "danger";
  onClick: () => void;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold transition ${
        tone === "danger" ? "text-red-700 hover:bg-red-50" : "text-foreground hover:bg-surface-muted"
      } disabled:pointer-events-none disabled:opacity-40`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function MetricCard({
  title,
  value,
  note,
  icon: Icon,
  tone,
}: {
  title: string;
  value: number;
  note: string;
  icon: typeof UsersRound;
  tone: "blue" | "green" | "amber" | "gray";
}) {
  const colorClass = {
    blue: "border-t-blue-500 text-blue-700",
    green: "border-t-emerald-500 text-emerald-700",
    amber: "border-t-amber-500 text-amber-700",
    gray: "border-t-slate-400 text-slate-600",
  }[tone];

  return (
    <Card className={`border-t-4 ${colorClass}`}>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs font-bold text-muted">{title}</p>
          <p className="mt-1 text-2xl font-black text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted">{note}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-muted">
          <Icon className={`h-5 w-5 ${colorClass}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function AccountDialog({
  roles,
  title,
  onClose,
  onSubmit,
}: {
  roles: Role[];
  title: string;
  onClose: () => void;
  onSubmit: (payload: Omit<Account, "id" | "status" | "lastActiveAt">) => void;
}) {
  const [form, setForm] = useState({
    username: "",
    name: "",
    email: "",
    department: "广告中心",
    title: "运营专员",
    roleId: "operations" as RoleId,
    amazonStorePermissions: "",
    multiPlatformStorePermissions: "",
    phone: "",
    lastLoginIp: "",
    lastLoginAt: "",
    sourceCreatedAt: "",
  });

  const ready = form.name.trim() && form.email.trim();

  return (
    <Modal title={title} onClose={onClose}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="姓名">
          <input className={fieldClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="用户名">
          <input className={fieldClass} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
        </Field>
        <Field label="邮箱">
          <input className={fieldClass} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </Field>
        <Field label="部门">
          <input className={fieldClass} value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} />
        </Field>
        <Field label="岗位">
          <input className={fieldClass} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </Field>
        <Field label="系统角色">
          <select className={fieldClass} value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value as RoleId })}>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="手机号">
          <input className={fieldClass} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button disabled={!ready} onClick={() => onSubmit(form)}>
          <Check className="h-4 w-4" />
          创建账号
        </Button>
      </div>
    </Modal>
  );
}

function EditAccountDialog({
  account,
  roles,
  onClose,
  onSubmit,
}: {
  account: Account;
  roles: Role[];
  onClose: () => void;
  onSubmit: (account: Account) => void;
}) {
  const [form, setForm] = useState(account);

  return (
    <Modal title="编辑账号资料" onClose={onClose}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="姓名">
          <input className={fieldClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="用户名">
          <input className={fieldClass} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
        </Field>
        <Field label="邮箱">
          <input className={fieldClass} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </Field>
        <Field label="部门">
          <input className={fieldClass} value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} />
        </Field>
        <Field label="系统角色">
          <select className={fieldClass} value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value as RoleId })}>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="亚马逊店铺权限">
          <textarea className={fieldClass} rows={2} value={form.amazonStorePermissions} onChange={(event) => setForm({ ...form, amazonStorePermissions: event.target.value })} />
        </Field>
        <Field label="多平台店铺权限">
          <textarea className={fieldClass} rows={2} value={form.multiPlatformStorePermissions} onChange={(event) => setForm({ ...form, multiPlatformStorePermissions: event.target.value })} />
        </Field>
        <Field label="手机号">
          <input className={fieldClass} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        </Field>
        <Field label="最近登录 IP">
          <input className={fieldClass} value={form.lastLoginIp} onChange={(event) => setForm({ ...form, lastLoginIp: event.target.value })} />
        </Field>
        <Field label="最近登录时间">
          <input className={fieldClass} value={form.lastLoginAt} onChange={(event) => setForm({ ...form, lastLoginAt: event.target.value })} />
        </Field>
        <Field label="创建时间">
          <input className={fieldClass} value={form.sourceCreatedAt} onChange={(event) => setForm({ ...form, sourceCreatedAt: event.target.value })} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button onClick={() => onSubmit(form)}>
          <Check className="h-4 w-4" />
          保存修改
        </Button>
      </div>
    </Modal>
  );
}

function PasswordDialog({
  account,
  onClose,
  onSubmit,
}: {
  account: Account;
  onClose: () => void;
  onSubmit: (accountId: string, password: string) => void;
}) {
  const currentPassword = account.password || getFallbackPassword(account.id);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState(currentPassword);
  const [confirmPassword, setConfirmPassword] = useState(currentPassword);
  const matched = password.length >= 1 && password === confirmPassword;

  return (
    <Modal title={`账密：${account.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="账号">
            <input className={fieldClass} readOnly value={account.email || account.id} />
          </Field>
          <Field label="当前密码">
            <div className="flex rounded-md border border-border bg-white focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/10">
              <input
                className="min-w-0 flex-1 rounded-l-md px-3 py-2 text-sm text-foreground outline-none"
                readOnly
                type={showPassword ? "text" : "password"}
                value={currentPassword}
              />
              <button
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                className="flex h-9 w-9 items-center justify-center rounded-r-md text-muted hover:bg-surface-muted hover:text-foreground"
                onClick={() => setShowPassword((value) => !value)}
                type="button"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
        </div>
        <Field label="新密码">
          <input className={fieldClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <Field label="确认密码">
          <input className={fieldClass} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button disabled={!matched} onClick={() => onSubmit(account.id, password)}>
          <KeyRound className="h-4 w-4" />
          保存密码
        </Button>
      </div>
    </Modal>
  );
}

function RoleNameDialog({
  role,
  onClose,
  onSubmit,
}: {
  role: Role;
  onClose: () => void;
  onSubmit: (roleId: RoleId, name: string) => void;
}) {
  const [name, setName] = useState(role.name);
  const ready = name.trim().length > 0;

  return (
    <Modal title={`编辑角色：${role.name}`} onClose={onClose}>
      <Field label="角色名称">
        <input className={fieldClass} maxLength={24} value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button disabled={!ready} onClick={() => onSubmit(role.id, name)}>
          <Check className="h-4 w-4" />
          保存名称
        </Button>
      </div>
    </Modal>
  );
}

function RoleMembersDialog({
  accounts,
  canManageAccount,
  role,
  roleLabels,
  onClose,
  onSubmit,
}: {
  accounts: Account[];
  canManageAccount: (account: Account) => boolean;
  role: Role;
  roleLabels: Record<RoleId, string>;
  onClose: () => void;
  onSubmit: (roleId: RoleId, memberIds: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set(accounts.filter((account) => account.roleId === role.id).map((account) => account.id)));

  function toggleMember(accountId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  }

  return (
    <Modal title={`编辑成员：${role.name}`} onClose={onClose}>
      <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
        {accounts.map((account) => {
          const editable = canManageAccount(account);
          const checked = selectedIds.has(account.id);

          return (
            <label
              key={account.id}
              className={`flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 ${
                editable ? "bg-white" : "bg-surface-muted"
              }`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">{account.name}</p>
                <p className="truncate text-xs text-muted">
                  {account.email || account.username || account.id} · 当前 {roleLabels[account.roleId] ?? account.roleId}
                </p>
              </div>
              <input
                checked={checked}
                className="h-4 w-4 shrink-0 accent-brand"
                disabled={!editable}
                onChange={() => toggleMember(account.id)}
                type="checkbox"
              />
            </label>
          );
        })}
        {accounts.length === 0 ? <p className="rounded-md border border-border px-3 py-8 text-center text-sm text-muted">暂无可编辑账号。</p> : null}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button onClick={() => onSubmit(role.id, Array.from(selectedIds))}>
          <UserPlus className="h-4 w-4" />
          保存成员
        </Button>
      </div>
    </Modal>
  );
}

function DeleteRoleDialog({
  memberCount,
  role,
  onClose,
  onSubmit,
}: {
  memberCount: number;
  role: Role;
  onClose: () => void;
  onSubmit: (roleId: RoleId) => void;
}) {
  return (
    <Modal title={`删除角色：${role.name}`} onClose={onClose}>
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        删除后该角色会从角色列表和账号角色下拉中隐藏，当前 {memberCount} 个成员会迁移到查看者。
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button variant="danger" onClick={() => onSubmit(role.id)}>
          <Trash2 className="h-4 w-4" />
          删除角色
        </Button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-bold uppercase tracking-normal text-muted">{label}</span>
      {children}
    </label>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()} role="dialog">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand text-white">
              <UserCog className="h-5 w-5" />
            </div>
            <h2 className="text-base font-black text-foreground">{title}</h2>
          </div>
          <button className="flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-foreground" onClick={onClose} type="button">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
