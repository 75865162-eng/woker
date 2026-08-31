"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Archive,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserCog,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  permissionActions,
  permissionModules,
  type PermissionAction,
} from "@/lib/accounts/permissions";
import { buildDefaultRoleCatalog, type RoleCatalogItem } from "@/lib/accounts/role-catalog";
import { accountWorkbookColumns, createAccountWorkbookRows, exportAccountWorkbook, parseAccountWorkbookFile } from "@/lib/accounts/account-workbook";
import { normalizeTeamAccounts, type AccountRoleId } from "@/lib/accounts/team-roster";

type AccountStatus = "active" | "pending" | "disabled" | "archived";
type RoleId = AccountRoleId;

type Account = {
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

type Role = {
  id: RoleId;
  name: string;
  description: string;
  memberCount: number;
  permissions: Record<string, PermissionAction[]>;
  sortOrder: number;
};

const defaultRoleCatalog = buildDefaultRoleCatalog();
const initialRoles: Role[] = defaultRoleCatalog.map((role) => ({
  ...role,
  id: role.id as RoleId,
  memberCount: 0,
}));

const fieldClass =
  "w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10";
const teamMembersApiPath = "/api/accounts/team-members";
const rolesApiPath = "/api/accounts/roles";
const accountPageSize = 10;

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

function isDefaultSuperAccount(account: { id?: string; email?: string; username?: string; phone?: string } | string) {
  const identity = typeof account === "string" ? { id: account } : account;

  return (
    identity.id === "local-admin" ||
    identity.email?.trim().toLowerCase() === "1" ||
    identity.username?.trim().toLowerCase() === "1" ||
    identity.phone?.trim().toLowerCase() === "1"
  );
}

function getFallbackPassword(account: { id?: string; email?: string; username?: string; phone?: string } | string) {
  return isDefaultSuperAccount(account) ? "1" : "12345678";
}

function canManageRole(roleId: RoleId) {
  return roleId !== "owner";
}

function canManageAccount(account: Account) {
  return !isDefaultSuperAccount(account) && account.roleId !== "owner";
}

function normalizeRoleCatalogItem(role: RoleCatalogItem): Role {
  return {
    ...role,
    id: role.id as RoleId,
    memberCount: 0,
  };
}

function normalizeRoleCatalogResponse(value: unknown): Role[] {
  if (!Array.isArray(value)) return initialRoles;

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

function withLoadedAccountState(account: Account): Account {
  return {
    ...account,
    passwordDirty: false,
  };
}

function serializeAccountsForApi(accounts: Account[]) {
  return accounts.map((account) => {
    const record = { ...account };
    delete record.passwordDirty;
    return record;
  });
}

async function loadAccountsFromApi() {
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

async function saveAccountsToApi(accounts: Account[]) {
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

async function loadRolesFromApi() {
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

async function saveRolesToApi(roles: Role[]) {
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

export function AccountWorkbench() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountSaveError, setAccountSaveError] = useState("");
  const [roles, setRoles] = useState(initialRoles);
  const [activeRoleId, setActiveRoleId] = useState<RoleId>("operations");
  const [query, setQuery] = useState("");
  const [newAccountOpen, setNewAccountOpen] = useState(false);
  const [newRoleOpen, setNewRoleOpen] = useState(false);
  const [roleMembersOpen, setRoleMembersOpen] = useState(false);
  const [roleManageMode, setRoleManageMode] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [archivedAccountsOpen, setArchivedAccountsOpen] = useState(false);
  const [roleSavedAt, setRoleSavedAt] = useState("");
  const [roleRevision, setRoleRevision] = useState("");
  const [accountImportMessage, setAccountImportMessage] = useState("");
  const [accountImporting, setAccountImporting] = useState(false);
  const [accountPage, setAccountPage] = useState(1);
  const accountImportInputRef = useRef<HTMLInputElement | null>(null);
  const visibleAccounts = useMemo(() => accounts.filter((account) => account.status !== "archived"), [accounts]);
  const visibleRoles = useMemo(
    () =>
      roles.map((role) => ({
        ...role,
        memberCount: visibleAccounts.filter((account) => account.roleId === role.id).length,
      })),
    [roles, visibleAccounts],
  );

  useEffect(() => {
    let canceled = false;

    void loadAccountsFromApi().then((payload) => {
      if (canceled) return;

      if (!payload) {
        return;
      }

      setAccounts(payload.accounts);
    });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    void loadRolesFromApi().then((savedRoles) => {
      if (canceled || !savedRoles) return;
      setRoleRevision(savedRoles.revision);
      setRoles(savedRoles.roles.length ? savedRoles.roles : initialRoles);
    });

    return () => {
      canceled = true;
    };
  }, []);

  const activeRole = visibleRoles.find((role) => role.id === activeRoleId) ?? visibleRoles[0];
  const activeRoleMembers = useMemo(
    () => (activeRole ? visibleAccounts.filter((account) => account.roleId === activeRole.id) : []),
    [activeRole, visibleAccounts],
  );
  const availableRoleTemplates = useMemo(
    () => defaultRoleCatalog.filter((role) => !roles.some((item) => item.id === role.id) && canManageRole(role.id)),
    [roles],
  );

  const filteredAccounts = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return visibleAccounts.filter((account) => {
      const keywordMatched =
        !keyword ||
        account.name.toLowerCase().includes(keyword) ||
        account.phone?.toLowerCase().includes(keyword) ||
        account.email.toLowerCase().includes(keyword) ||
        account.username?.toLowerCase().includes(keyword) ||
        account.department.toLowerCase().includes(keyword) ||
        account.title.toLowerCase().includes(keyword) ||
        account.id.toLowerCase().includes(keyword);

      return keywordMatched;
    });
  }, [query, visibleAccounts]);

  const disabledAccounts = visibleAccounts.filter((account) => account.status === "disabled");
  const archivedAccounts = accounts.filter((account) => account.status === "archived");
  const departments = Array.from(new Set(visibleAccounts.map((account) => account.department)));
  const roleMemberCount = activeRole ? visibleAccounts.filter((account) => account.roleId === activeRole.id).length : 0;
  const accountPageCount = Math.max(1, Math.ceil(filteredAccounts.length / accountPageSize));
  const currentAccountPage = Math.min(accountPage, accountPageCount);
  const paginatedAccounts = filteredAccounts.slice((currentAccountPage - 1) * accountPageSize, currentAccountPage * accountPageSize);
  const firstAccountIndex = filteredAccounts.length ? (currentAccountPage - 1) * accountPageSize + 1 : 0;
  const lastAccountIndex = Math.min(currentAccountPage * accountPageSize, filteredAccounts.length);

  useEffect(() => {
    setAccountPage(1);
  }, [query]);

  useEffect(() => {
    if (accountPage > accountPageCount) {
      setAccountPage(accountPageCount);
    }
  }, [accountPage, accountPageCount]);

  function commitAccounts(updater: (current: Account[]) => Account[]) {
    setAccounts((current) => {
      const next = updater(current);
      setAccountSaveError("");
      void saveAccountsToApi(next).then((result) => {
        if (!result) return;

        if (!result.ok) {
          setAccountSaveError(result.error);
          void loadAccountsFromApi().then((payload) => {
            if (!payload) return;
            setAccounts(payload.accounts);
          });
          return;
        }

        setAccounts(result.accounts);
      });
      return next;
    });
  }

  function createAccount(payload: Omit<Account, "id" | "status" | "lastActiveAt">) {
    const id = `u-${Date.now()}`;
    const nextAccount: Account = {
      ...payload,
      id,
      password: payload.password || getFallbackPassword({ ...payload, id }),
      passwordDirty: true,
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

  function toggleAccountStatus(accountId: string) {
    commitAccounts((current) =>
      current.map((account) =>
        account.id === accountId && canManageAccount(account)
          ? { ...account, status: account.status === "disabled" ? "active" : "disabled" }
          : account,
      ),
    );
  }

  function archiveAccount(accountId: string) {
    commitAccounts((current) =>
      current.map((account) =>
        account.id === accountId && canManageAccount(account)
          ? { ...account, status: "archived", lastActiveAt: account.lastActiveAt || "已归档" }
          : account,
      ),
    );
  }

  const roleLabels = useMemo(
    () => Object.fromEntries(roles.map((role) => [role.id, role.name])) as Record<RoleId, string>,
    [roles],
  );
  const archivedAccountRows = useMemo(() => createAccountWorkbookRows(archivedAccounts, roleLabels), [archivedAccounts, roleLabels]);

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
              (Boolean(imported.phone) && account.phone === imported.phone) ||
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
              passwordDirty: existing.passwordDirty ?? false,
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
            passwordDirty: true,
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
    if (!activeRole) return;

    setRoles((current) =>
    current.map((role) => {
        if (!activeRole || role.id !== activeRole.id) return role;

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

  function toggleModulePermissions(moduleId: string) {
    if (!activeRole) return;

    setRoles((current) =>
    current.map((role) => {
        if (!activeRole || role.id !== activeRole.id) return role;

        const currentActions = role.permissions[moduleId] ?? [];
        const allSelected = permissionActions.every((action) => currentActions.includes(action.id));

        return {
          ...role,
          permissions: {
            ...role.permissions,
            [moduleId]: allSelected ? [] : permissionActions.map((action) => action.id),
          },
        };
      }),
    );
  }

  function updateActiveRole(field: "name" | "description" | "sortOrder", value: string) {
    if (!activeRole) return;

    setRoles((current) =>
      current.map((role) => {
        if (!activeRole || role.id !== activeRole.id) return role;

        return {
          ...role,
          [field]: field === "sortOrder" ? Number(value) || 0 : value,
        };
      }),
    );
  }

  async function saveRoles() {
    const savedToApi = await saveRolesToApi(roles);

    setRoleRevision(savedToApi.revision);
    setRoleSavedAt(`${new Date().toLocaleString("zh-CN", { hour12: false })}${savedToApi.ok ? "" : "（保存失败）"}`);
    if (savedToApi.ok) {
      setRoles(savedToApi.roles ?? roles);
      window.setTimeout(() => window.location.reload(), 250);
    }
  }

  function addRole(roleId: RoleId) {
    const role = defaultRoleCatalog.find((item) => item.id === roleId);
    if (!role) return;

    setRoles((current) => (current.some((item) => item.id === role.id) ? current : [...current, normalizeRoleCatalogItem(role)]));
    setActiveRoleId(role.id);
    setNewRoleOpen(false);
  }

  function deleteRole(roleId: RoleId) {
    const role = visibleRoles.find((item) => item.id === roleId);
    if (!role || role.memberCount > 0 || !canManageRole(role.id)) return;

    const nextRoles = roles.filter((item) => item.id !== roleId);
    const nextActiveRoleId = activeRoleId === roleId ? nextRoles[0]?.id : activeRoleId;

    setRoles(nextRoles);
    if (nextActiveRoleId) {
      setActiveRoleId(nextActiveRoleId);
    }
    setRoleMembersOpen(false);
    void saveRolesToApi(nextRoles).then((savedToApi) => {
      setRoleRevision(savedToApi.revision);
      setRoleSavedAt(`${new Date().toLocaleString("zh-CN", { hour12: false })}${savedToApi.ok ? "" : "（保存失败）"}`);
      if (savedToApi.ok) {
        setRoles(savedToApi.roles ?? nextRoles);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-end">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary">
            <Building2 className="h-4 w-4" />
            组织架构
          </Button>
          <input
            ref={accountImportInputRef}
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importAccounts(file);
              event.currentTarget.value = "";
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
          <Button onClick={() => setNewAccountOpen(true)}>
            <UserPlus className="h-4 w-4" />
            新建同事账号
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

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard title="账号总数" value={visibleAccounts.length} note="当前可见账号" icon={UsersRound} tone="blue" />
        <MetricCard title="停用账号" value={disabledAccounts.length} note="保留账号但禁止登录" icon={UserCog} tone="gray" />
        <button className="text-left" onClick={() => setArchivedAccountsOpen(true)} type="button">
          <MetricCard title="归档" value={archivedAccounts.length} note="查看已归档员工" icon={Archive} tone="gray" />
        </button>
      </section>

      <section className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>同事账号列表</CardTitle>
              <p className="mt-1 text-sm text-muted">用于创建账号、修改资料、重置密码和调整角色。</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  className={`${fieldClass} min-w-64 pl-9`}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索姓名、手机号、部门"
                />
              </div>
              <Button variant="secondary">
                <Filter className="h-4 w-4" />
                筛选
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead className="bg-surface-muted text-xs font-bold text-muted">
                  <tr>
                    <th className="px-5 py-3 text-left">姓名</th>
                    <th className="px-5 py-3 text-left">手机号</th>
                    <th className="px-5 py-3 text-left">部门 / 岗位</th>
                    <th className="px-5 py-3 text-left">系统角色</th>
                    <th className="px-5 py-3 text-left">最近活动</th>
                    <th className="px-5 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedAccounts.map((account) => (
                    <tr key={account.id} className="border-t border-border">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand/10 text-xs font-black text-brand">
                            {account.name.slice(0, 1)}
                          </div>
                          <div>
                            <p className="font-bold text-foreground">{account.name}</p>
                            <p className="text-xs text-muted">{account.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-muted">{account.phone || account.username || account.email || "—"}</td>
                      <td className="px-5 py-4">
                        <p className="font-medium text-foreground">{account.department}</p>
                        <p className="text-xs text-muted">{account.title}</p>
                      </td>
                      <td className="px-5 py-4">
                        <select className={fieldClass} value={account.roleId} onChange={(event) => updateAccountRole(account.id, event.target.value as RoleId)}>
                          {roles.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-medium text-foreground">{account.lastLoginIp || "IP 未记录"}</p>
                        <p className="text-xs text-muted">{account.lastLoginAt || account.lastActiveAt || "时间未记录"}</p>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setEditAccount(account)}>
                            <Pencil className="h-4 w-4" />
                            编辑
                          </Button>
                          <Button size="sm" variant={account.status === "disabled" ? "secondary" : "danger"} onClick={() => toggleAccountStatus(account.id)}>
                            {account.status === "disabled" ? "启用" : "停用"}
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => archiveAccount(account.id)}>
                            归档
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredAccounts.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted">没有找到匹配账号。</p> : null}
            <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
              <p className="text-sm text-muted">
                第 {currentAccountPage} / {accountPageCount} 页，显示 {firstAccountIndex}-{lastAccountIndex} / {filteredAccounts.length} 个账号
              </p>
              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={currentAccountPage <= 1}
                  onClick={() => setAccountPage((page) => Math.max(1, page - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  上一页
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={currentAccountPage >= accountPageCount}
                  onClick={() => setAccountPage((page) => Math.min(accountPageCount, page + 1))}
                >
                  下一页
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-[minmax(240px,1fr)_minmax(0,2fr)] gap-3">
            <div className="space-y-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 px-3 py-2.5">
                  <div>
                    <CardTitle className="text-sm">角色权限</CardTitle>
                    <p className="mt-0.5 text-xs text-muted">按角色维护模块权限，新建账号时直接分配角色。</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone="blue">{visibleRoles.length} 个角色</Badge>
                    <Button className="h-8 px-2" size="sm" variant="secondary" onClick={() => setNewRoleOpen(true)}>
                      <Plus className="h-3.5 w-3.5" />
                      添加
                    </Button>
                    <Button className="h-8 px-2" size="sm" variant="secondary" onClick={() => setRoleManageMode((value) => !value)}>
                      {roleManageMode ? "完成" : "管理"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1.5 p-3">
                  {visibleRoles.map((role) => (
                    <div
                      key={role.id}
                      className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 transition ${
                        activeRole?.id === role.id ? "border-brand bg-brand/5" : "border-border bg-white hover:bg-surface-muted"
                      }`}
                    >
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          setActiveRoleId(role.id);
                          setRoleMembersOpen(true);
                        }}
                        type="button"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-bold text-foreground">{role.name}</p>
                          <Badge tone={activeRole?.id === role.id ? "green" : "gray"}>{role.memberCount} 人</Badge>
                        </div>
                        <p className="mt-0.5 text-xs leading-4 text-muted">{role.description}</p>
                      </button>
                      {roleManageMode ? (
                        <button
                          aria-label={`删除${role.name}`}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
                          disabled={role.memberCount > 0 || !canManageRole(role.id)}
                          onClick={() => deleteRole(role.id)}
                          title={role.memberCount > 0 ? "已有成员的角色不能删除" : "删除角色"}
                          type="button"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between px-4 py-3">
                  <CardTitle className="text-sm">人员分布</CardTitle>
                  <Badge tone="gray">按部门</Badge>
                </CardHeader>
                <CardContent className="space-y-2 p-4">
                  {departments.map((department) => {
                    const count = visibleAccounts.filter((account) => account.department === department).length;
                    const percent = visibleAccounts.length ? Math.round((count / visibleAccounts.length) * 100) : 0;

                    return <DepartmentBar key={department} name={department} count={count} percent={percent} />;
                  })}
                </CardContent>
              </Card>
            </div>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 px-3 py-2.5">
                  <div>
                    <CardTitle className="text-sm">权限管理</CardTitle>
                    <p className="mt-0.5 text-xs text-muted">
                      {activeRole ? `${activeRole.name} 当前实际绑定 ${roleMemberCount} 个账号。` : "暂无可编辑角色。"}
                      {roleRevision ? ` 版本 ${roleRevision}` : ""}
                    </p>
                  </div>
                  <Button className="shrink-0 px-2" size="sm" variant="secondary" onClick={() => void saveRoles()}>
                    <ShieldCheck className="h-3.5 w-3.5" />
                    保存角色
                  </Button>
                </CardHeader>
                <CardContent className="space-y-1.5 p-3">
                  {roleSavedAt ? <p className="text-xs font-medium text-green-700">角色已保存：{roleSavedAt}，页面正在刷新。</p> : null}
                  {activeRole ? (
                    <div className="space-y-3 rounded-md border border-border bg-surface-muted p-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="角色名称">
                          <input
                            className={fieldClass}
                            value={activeRole.name}
                            onChange={(event) => updateActiveRole("name", event.target.value)}
                          />
                        </Field>
                        <Field label="排序">
                          <input
                            className={fieldClass}
                            inputMode="numeric"
                            type="number"
                            value={activeRole.sortOrder}
                            onChange={(event) => updateActiveRole("sortOrder", event.target.value)}
                          />
                        </Field>
                      </div>
                      <Field label="角色说明">
                        <textarea
                          className={`${fieldClass} min-h-20 resize-y`}
                          value={activeRole.description}
                          onChange={(event) => updateActiveRole("description", event.target.value)}
                        />
                      </Field>
                    </div>
                  ) : null}
                  {activeRole ? (
                    permissionModules.map((module) => (
                      <div key={module.id} className="grid grid-cols-[86px_minmax(0,1fr)] items-center gap-1.5 rounded-md border border-border px-2 py-1.5">
                        <p className="text-xs font-bold text-foreground">{module.name}</p>
                        <div className="grid grid-cols-6 gap-1">
                          <label className="flex items-center justify-center gap-0.5 text-[11px] font-medium text-muted">
                            <input
                              checked={permissionActions.every((action) => activeRole.permissions[module.id]?.includes(action.id))}
                              className="h-3.5 w-3.5 accent-brand"
                              onChange={() => toggleModulePermissions(module.id)}
                              type="checkbox"
                            />
                            全选
                          </label>
                          {permissionActions.map((action) => {
                            const checked = activeRole.permissions[module.id]?.includes(action.id) ?? false;

                            return (
                              <label key={action.id} className="flex items-center justify-center gap-0.5 text-[11px] font-medium text-muted">
                                <input
                                  checked={checked}
                                  className="h-3.5 w-3.5 accent-brand"
                                  onChange={() => togglePermission(module.id, action.id)}
                                  type="checkbox"
                                />
                                {action.label}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-md border border-border bg-white px-3 py-8 text-center text-sm text-muted">没有可编辑的角色。</p>
                  )}
                </CardContent>
              </Card>
          </div>
        </div>
      </section>

      <Card>
        <CardHeader className="px-4 py-3">
          <CardTitle>SKU 流转权限</CardTitle>
          <p className="mt-1 text-sm text-muted">账号角色会直接决定商品页负责人下拉和 SKU 处理权限。</p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-4">
          {[
            { title: "采购", body: "新建 SKU 后自动成为采购负责人，不需要手动选择。", tone: "gray" as const },
            { title: "主管 / 运营 / 运营助理", body: "SKU 状态为运营确认中时必须选择，可多选；被选中的成员获得该 SKU 编辑权。", tone: "amber" as const },
            { title: "美工", body: "SKU 状态为美工处理中时必须选择，可多选；被选中的美工只有查看权。", tone: "blue" as const },
            { title: "停用账号", body: "不会出现在运营或美工负责人下拉里，也不会获得新的 SKU 权限。", tone: "red" as const },
          ].map((item) => (
            <div key={item.title} className="rounded-md border border-border bg-white p-3">
              <Badge tone={item.tone}>{item.title}</Badge>
              <p className="mt-2 text-sm leading-5 text-muted">{item.body}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between px-4 py-3">
            <CardTitle>最近账号动态</CardTitle>
            <Badge tone="blue">审计预览</Badge>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {[
              "李娜调整了运营角色的导出权限",
              "张伟重置了陈晨的首次登录密码",
              "系统停用了赵宁账号并保留审计记录",
            ].map((item, index) => (
              <div key={item} className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-muted text-brand">
                    <Activity className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-medium text-foreground">{item}</p>
                </div>
                <span className="text-xs text-muted">{index + 1} 小时前</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {newAccountOpen ? <AccountDialog roles={roles} title="新建同事账号" onClose={() => setNewAccountOpen(false)} onSubmit={createAccount} /> : null}
      {newRoleOpen ? <RoleDialog roles={availableRoleTemplates} onClose={() => setNewRoleOpen(false)} onSubmit={addRole} /> : null}
      {roleMembersOpen ? <RoleMembersDialog role={activeRole} accounts={activeRoleMembers} onClose={() => setRoleMembersOpen(false)} /> : null}
      {editAccount ? (
        <EditAccountDialog account={editAccount} roles={roles} onClose={() => setEditAccount(null)} onSubmit={saveAccount} />
      ) : null}
      {archivedAccountsOpen ? <ArchivedAccountsDialog rows={archivedAccountRows} onClose={() => setArchivedAccountsOpen(false)} /> : null}
    </div>
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

function DepartmentBar({ name, count, percent }: { name: string; count: number; percent: number }) {
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-foreground">{name}</p>
        <span className="text-sm font-black text-foreground">{count}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function ArchivedAccountsDialog({ rows, onClose }: { rows: ReturnType<typeof createAccountWorkbookRows>; onClose: () => void }) {
  return (
    <Modal title="已归档员工信息" onClose={onClose} size="wide">
      <div className="overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[1280px] border-collapse text-xs">
          <thead className="bg-surface-muted font-bold text-muted">
            <tr>
              {accountWorkbookColumns.map((column) => (
                <th key={column} className="whitespace-nowrap px-3 py-2 text-left">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border">
                {accountWorkbookColumns.map((column) => (
                  <td key={column} className="whitespace-nowrap px-3 py-2 text-muted">
                    {row[column]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted">暂无已归档员工。</p> : null}
      </div>
    </Modal>
  );
}

function RoleDialog({
  roles,
  onClose,
  onSubmit,
}: {
  roles: Role[];
  onClose: () => void;
  onSubmit: (roleId: RoleId) => void;
}) {
  const [selectedRoleId, setSelectedRoleId] = useState<RoleId>(roles[0]?.id ?? "viewer");
  const selectedRole = roles.find((role) => role.id === selectedRoleId);

  return (
    <Modal title="添加角色" onClose={onClose}>
      {roles.length ? (
        <div className="space-y-4">
          <Field label="角色模板">
            <select className={fieldClass} value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value as RoleId)}>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </Field>
          {selectedRole ? (
            <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
              <p className="text-sm font-bold text-foreground">{selectedRole.name}</p>
              <p className="mt-1 text-sm leading-5 text-muted">{selectedRole.description}</p>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button onClick={() => onSubmit(selectedRoleId)}>
              <Plus className="h-4 w-4" />
              添加角色
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="rounded-md border border-border bg-surface-muted px-3 py-8 text-center text-sm text-muted">暂无可添加的内置角色。</p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function RoleMembersDialog({ role, accounts, onClose }: { role: Role; accounts: Account[]; onClose: () => void }) {
  return (
    <Modal title={`${role.name}成员`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-md border border-border bg-surface-muted px-3 py-2.5">
          <div>
            <p className="text-sm font-bold text-foreground">{role.name}</p>
            <p className="mt-0.5 text-xs text-muted">{role.description}</p>
          </div>
          <Badge tone="blue">{accounts.length} 人</Badge>
        </div>
        <div className="max-h-[420px] overflow-auto rounded-md border border-border">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead className="bg-surface-muted text-xs font-bold text-muted">
              <tr>
                <th className="px-4 py-2.5 text-left">姓名</th>
                <th className="px-4 py-2.5 text-left">手机号</th>
                <th className="px-4 py-2.5 text-left">部门 / 岗位</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <p className="font-bold text-foreground">{account.name}</p>
                    <p className="text-xs text-muted">{account.id}</p>
                  </td>
                  <td className="px-4 py-3 text-muted">{account.phone || account.username || account.email || "—"}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{account.department}</p>
                    <p className="text-xs text-muted">{account.title}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {accounts.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted">当前角色暂无绑定成员。</p> : null}
        </div>
      </div>
    </Modal>
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
    name: "",
    email: "",
    phone: "",
    department: "广告中心",
    title: "运营专员",
    roleId: "operations" as RoleId,
  });

  const ready = form.name.trim() && (form.phone.trim() || form.email.trim());

  return (
    <Modal title={title} onClose={onClose}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="姓名">
          <input className={fieldClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="手机号">
          <input className={fieldClass} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
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
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const passwordChanged = password.trim().length > 0;
  const passwordReady = !passwordChanged || (password === confirmPassword && password.trim().length > 0);
  const submitDisabled = passwordChanged ? !passwordReady : false;

  return (
    <Modal title="编辑账号资料" onClose={onClose}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="姓名">
          <input className={fieldClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="手机号">
          <input className={fieldClass} value={form.phone || ""} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
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
      </div>
      <div className="mt-5 rounded-md border border-border bg-surface-muted px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-foreground">账号密码</p>
            <p className="mt-0.5 text-xs text-muted">留空则不修改密码。</p>
          </div>
          <div className="text-xs text-muted">登录账号：{form.phone || form.username || form.email || form.id}</div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="新密码">
            <input className={fieldClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <Field label="确认密码">
            <input className={fieldClass} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </Field>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button
          disabled={submitDisabled}
          onClick={() =>
            onSubmit({
              ...form,
              password: passwordChanged ? password : account.password,
              passwordDirty: passwordChanged || account.passwordDirty,
            })
          }
        >
          <Check className="h-4 w-4" />
          保存修改
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

function Modal({
  title,
  children,
  onClose,
  size = "default",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  size?: "default" | "wide";
}) {
  const widthClass = size === "wide" ? "max-w-6xl" : "max-w-2xl";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-8" onClick={onClose}>
      <div className={`w-full ${widthClass} rounded-lg bg-white shadow-xl`} onClick={(event) => event.stopPropagation()} role="dialog">
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
