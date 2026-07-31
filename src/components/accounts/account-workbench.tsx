"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Building2,
  Check,
  Filter,
  KeyRound,
  LockKeyhole,
  Mail,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  UserCog,
  UsersRound,
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
import { accountRosterStorageKey, defaultTeamAccounts, normalizeTeamAccounts, type AccountRoleId } from "@/lib/accounts/team-roster";

type AccountStatus = "active" | "pending" | "disabled";
type RoleId = AccountRoleId;

type Account = {
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
  roleId: RoleId;
  status: AccountStatus;
  lastActiveAt: string;
};

type Role = {
  id: RoleId;
  name: string;
  description: string;
  memberCount: number;
  permissions: Record<string, PermissionAction[]>;
};

const initialRoles: Role[] = [
  {
    id: "owner",
    name: "系统管理员",
    description: "全局配置、账号、权限与审计管理",
    memberCount: 1,
    permissions: createFullPermissions(),
  },
  {
    id: "admin",
    name: "运营主管",
    description: "管理业务数据、规则、导出与成员分工",
    memberCount: 2,
    permissions: createPermissions(["workspace", "rules", "listingAi", "products", "logistics"], ["view", "create", "edit", "approve", "export"]),
  },
  {
    id: "operations_supervisor",
    name: "运营主管",
    description: "管理 SKU 流转、分配运营和查看全部处理状态",
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
    id: "selection",
    name: "选品",
    description: "创建 SKU 并提交给运营确认",
    memberCount: 0,
    permissions: createPermissions(["products"], ["view", "create", "edit"]),
  },
  {
    id: "designer",
    name: "美工",
    description: "处理分配给自己的商品图片和视觉资料",
    memberCount: 0,
    permissions: createPermissions(["products", "listingAi", "imageUpscale"], ["view", "edit", "export"]),
  },
  {
    id: "ppc_manager",
    name: "广告优化",
    description: "处理 Bulk 导入、规则演算和广告调整草稿",
    memberCount: 5,
    permissions: createPermissions(["workspace", "rules"], ["view", "create", "edit", "export"]),
  },
  {
    id: "listing_operator",
    name: "Listing 运营",
    description: "维护商品资料、关键词、图片计划和 Listing AI",
    memberCount: 4,
    permissions: createPermissions(["listingAi", "products"], ["view", "create", "edit", "export"]),
  },
  {
    id: "logistics_operator",
    name: "物流协同",
    description: "处理物流模板、箱规、货件对比和导出",
    memberCount: 3,
    permissions: createPermissions(["logistics"], ["view", "create", "edit", "export"]),
  },
  {
    id: "viewer",
    name: "只读成员",
    description: "仅可查看已授权模块，不允许修改和导出",
    memberCount: 8,
    permissions: createPermissions(["workspace", "listingAi", "products", "logistics"], ["view"]),
  },
];

const initialAccounts: Account[] = [
  {
    id: "local-admin",
    name: "Local Admin",
    email: "1",
    department: "系统管理",
    title: "本地引导管理员",
    roleId: "owner",
    status: "active",
    lastActiveAt: "当前登录账号",
  },
  {
    id: "u-001",
    name: "张伟",
    email: "zhangwei@example.local",
    department: "广告中心",
    title: "广告主管",
    roleId: "ppc_manager",
    status: "active",
    lastActiveAt: "今天 09:42",
  },
  {
    id: "u-002",
    name: "李娜",
    email: "lina@example.local",
    department: "采购中心",
    title: "运营主管",
    roleId: "admin",
    status: "active",
    lastActiveAt: "今天 10:16",
  },
  {
    id: "u-003",
    name: "陈晨",
    email: "chenchen@example.local",
    department: "Listing 组",
    title: "Listing 专员",
    roleId: "listing_operator",
    status: "pending",
    lastActiveAt: "待首次登录",
  },
  {
    id: "u-004",
    name: "王敏",
    email: "wangmin@example.local",
    department: "物流中心",
    title: "物流专员",
    roleId: "logistics_operator",
    status: "active",
    lastActiveAt: "昨天 18:03",
  },
  {
    id: "u-005",
    name: "赵宁",
    email: "zhaoning@example.local",
    department: "财务协同",
    title: "只读审阅",
    roleId: "viewer",
    status: "disabled",
    lastActiveAt: "2026-07-18",
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
const rolePermissionsStorageKey = "amazon-bulk-ad-role-permissions";
const teamMembersApiPath = "/api/accounts/team-members";

function loadInitialAccounts() {
  const fallbackAccounts = defaultTeamAccounts.length ? (defaultTeamAccounts as Account[]) : initialAccounts;

  if (typeof window === "undefined") return fallbackAccounts;

  const saved = window.localStorage.getItem(accountRosterStorageKey);
  if (!saved) return fallbackAccounts;

  try {
    const accounts = normalizeTeamAccounts(JSON.parse(saved));
    return accounts.length
      ? accounts.map((account) => ({
          ...account,
          lastActiveAt: account.lastActiveAt ?? "未记录",
        }))
      : fallbackAccounts;
  } catch {
    window.localStorage.removeItem(accountRosterStorageKey);
    return fallbackAccounts;
  }
}

async function loadAccountsFromApi() {
  try {
    const response = await fetch(teamMembersApiPath, { cache: "no-store" });
    if (!response.ok) return null;

    const payload = (await response.json()) as { accounts?: unknown };
    return normalizeTeamAccounts(payload.accounts).map((account) => ({
      ...account,
      lastActiveAt: account.lastActiveAt ?? "未记录",
    }));
  } catch {
    return null;
  }
}

async function saveAccountsToApi(accounts: Account[]) {
  try {
    await fetch(teamMembersApiPath, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accounts }),
    });
  } catch {
    return undefined;
  }
}

export function AccountWorkbench() {
  const [accounts, setAccounts] = useState<Account[]>(loadInitialAccounts);
  const [roles, setRoles] = useState(initialRoles);
  const [activeRoleId, setActiveRoleId] = useState<RoleId>("ppc_manager");
  const [statusFilter, setStatusFilter] = useState<"all" | AccountStatus>("all");
  const [query, setQuery] = useState("");
  const [newAccountOpen, setNewAccountOpen] = useState(false);
  const [passwordAccount, setPasswordAccount] = useState<Account | null>(null);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [permissionSavedAt, setPermissionSavedAt] = useState("");
  const [rosterHydrated, setRosterHydrated] = useState(false);
  const visibleRoles = useMemo(
    () =>
      roles.map((role) => ({
        ...role,
        memberCount: accounts.filter((account) => account.roleId === role.id).length,
      })),
    [accounts, roles],
  );

  useEffect(() => {
    let canceled = false;

    void loadAccountsFromApi().then((apiAccounts) => {
      if (canceled) return;

      if (!apiAccounts?.length) {
        setRosterHydrated(true);
        return;
      }

      setAccounts(apiAccounts);
      window.localStorage.setItem(accountRosterStorageKey, JSON.stringify(apiAccounts));
      setRosterHydrated(true);
    });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(rolePermissionsStorageKey);
    if (!saved) return;

    try {
      const savedRolePermissions = JSON.parse(saved) as RolePermissionMap;
      setRoles((current) =>
        current.map((role) => ({
          ...role,
          permissions: savedRolePermissions[role.id] ?? role.permissions,
        })),
      );
    } catch {
      window.localStorage.removeItem(rolePermissionsStorageKey);
    }
  }, []);

  useEffect(() => {
    if (!rosterHydrated) return;
    window.localStorage.setItem(accountRosterStorageKey, JSON.stringify(accounts));
  }, [accounts, rosterHydrated]);

  const activeRole = visibleRoles.find((role) => role.id === activeRoleId) ?? visibleRoles[0];

  const filteredAccounts = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return accounts.filter((account) => {
      const statusMatched = statusFilter === "all" || account.status === statusFilter;
      const keywordMatched =
        !keyword ||
        account.name.toLowerCase().includes(keyword) ||
        account.email.toLowerCase().includes(keyword) ||
        account.department.toLowerCase().includes(keyword) ||
        account.title.toLowerCase().includes(keyword);

      return statusMatched && keywordMatched;
    });
  }, [accounts, query, statusFilter]);

  const activeAccounts = accounts.filter((account) => account.status === "active").length;
  const pendingAccounts = accounts.filter((account) => account.status === "pending").length;
  const disabledAccounts = accounts.filter((account) => account.status === "disabled").length;
  const departments = Array.from(new Set(accounts.map((account) => account.department)));
  const roleMemberCount = accounts.filter((account) => account.roleId === activeRole.id).length;

  function commitAccounts(updater: (current: Account[]) => Account[]) {
    setAccounts((current) => {
      const next = updater(current);
      window.localStorage.setItem(accountRosterStorageKey, JSON.stringify(next));
      void saveAccountsToApi(next);
      return next;
    });
  }

  function createAccount(payload: Omit<Account, "id" | "status" | "lastActiveAt">) {
    const nextAccount: Account = {
      ...payload,
      id: `u-${Date.now()}`,
      status: "pending",
      lastActiveAt: "待首次登录",
    };

    commitAccounts((current) => [nextAccount, ...current]);
    setNewAccountOpen(false);
  }

  function updateAccountRole(accountId: string, roleId: RoleId) {
    commitAccounts((current) =>
      current.map((account) => {
        if (account.id !== accountId || account.roleId === roleId) return account;
        return { ...account, roleId };
      }),
    );
  }

  function saveAccount(account: Account) {
    commitAccounts((current) => current.map((item) => (item.id === account.id ? account : item)));
    setEditAccount(null);
  }

  function toggleAccountStatus(accountId: string) {
    commitAccounts((current) =>
      current.map((account) =>
        account.id === accountId ? { ...account, status: account.status === "disabled" ? "active" : "disabled" } : account,
      ),
    );
  }

  function togglePermission(moduleId: string, action: PermissionAction) {
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

  function saveRolePermissions() {
    const rolePermissionMap = Object.fromEntries(roles.map((role) => [role.id, role.permissions])) as RolePermissionMap;
    const serialized = JSON.stringify(rolePermissionMap);

    window.localStorage.setItem(rolePermissionsStorageKey, serialized);
    document.cookie = `${rolePermissionsCookieName}=${encodeURIComponent(serialized)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    setPermissionSavedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
    window.setTimeout(() => window.location.reload(), 250);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {[
            { id: "all", label: "全部账号" },
            { id: "active", label: "在线" },
            { id: "pending", label: "待激活" },
            { id: "disabled", label: "已停用" },
          ].map((item) => (
            <button
              key={item.id}
              className={`h-9 rounded-md border px-3 text-sm font-bold transition ${
                statusFilter === item.id ? "border-brand bg-brand text-white" : "border-border bg-white text-muted hover:text-foreground"
              }`}
              onClick={() => setStatusFilter(item.id as typeof statusFilter)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary">
            <Building2 className="h-4 w-4" />
            组织架构
          </Button>
          <Button onClick={() => setNewAccountOpen(true)}>
            <Plus className="h-4 w-4" />
            新建同事账号
          </Button>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
        <MetricCard title="账号总数" value={accounts.length} note={`在线 ${activeAccounts}`} icon={UsersRound} tone="blue" />
        <MetricCard title="业务部门" value={departments.length} note={departments.slice(0, 2).join(" / ")} icon={Building2} tone="green" />
        <MetricCard title="待激活账号" value={pendingAccounts} note="新建后首次登录改密" icon={Mail} tone="amber" />
        <MetricCard title="停用账号" value={disabledAccounts} note="保留审计记录" icon={LockKeyhole} tone="gray" />
      </section>

      <section className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
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
                  placeholder="搜索姓名、邮箱、部门"
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
                    <th className="px-5 py-3 text-left">邮箱</th>
                    <th className="px-5 py-3 text-left">部门 / 岗位</th>
                    <th className="px-5 py-3 text-left">系统角色</th>
                    <th className="px-5 py-3 text-left">状态</th>
                    <th className="px-5 py-3 text-left">最近活动</th>
                    <th className="px-5 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccounts.map((account) => (
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
                      <td className="px-5 py-4 text-muted">{account.email}</td>
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
                        <Badge tone={statusTones[account.status]}>{statusLabels[account.status]}</Badge>
                      </td>
                      <td className="px-5 py-4 text-muted">{account.lastActiveAt}</td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setEditAccount(account)}>
                            <Pencil className="h-4 w-4" />
                            编辑
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setPasswordAccount(account)}>
                            <KeyRound className="h-4 w-4" />
                            改密
                          </Button>
                          <Button size="sm" variant={account.status === "disabled" ? "secondary" : "danger"} onClick={() => toggleAccountStatus(account.id)}>
                            {account.status === "disabled" ? "启用" : "停用"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredAccounts.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted">没有找到匹配账号。</p> : null}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>角色权限</CardTitle>
                <p className="mt-1 text-sm text-muted">按角色维护模块权限，新建账号时直接分配角色。</p>
              </div>
                <Badge tone="blue">{visibleRoles.length} 个角色</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {visibleRoles.map((role) => (
                <button
                  key={role.id}
                  className={`w-full rounded-md border px-4 py-3 text-left transition ${
                    activeRole.id === role.id ? "border-brand bg-brand/5" : "border-border bg-white hover:bg-surface-muted"
                  }`}
                  onClick={() => setActiveRoleId(role.id)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-bold text-foreground">{role.name}</p>
                    <Badge tone={activeRole.id === role.id ? "green" : "gray"}>{role.memberCount} 人</Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted">{role.description}</p>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{activeRole.name} 权限矩阵</CardTitle>
                <p className="mt-1 text-sm text-muted">当前实际绑定 {roleMemberCount} 个账号。</p>
              </div>
              <Button size="sm" variant="secondary" onClick={saveRolePermissions}>
                <ShieldCheck className="h-4 w-4" />
                保存权限
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {permissionSavedAt ? <p className="text-xs font-medium text-green-700">权限已保存：{permissionSavedAt}，页面正在刷新。</p> : null}
              {permissionModules.map((module) => (
                <div key={module.id} className="grid grid-cols-[130px_minmax(0,1fr)] items-center gap-3 rounded-md border border-border px-3 py-2">
                  <p className="text-sm font-bold text-foreground">{module.name}</p>
                  <div className="grid grid-cols-5 gap-2">
                    {permissionActions.map((action) => {
                      const checked = activeRole.permissions[module.id]?.includes(action.id) ?? false;

                      return (
                        <label key={action.id} className="flex items-center justify-center gap-1 text-xs font-medium text-muted">
                          <input
                            checked={checked}
                            className="h-4 w-4 accent-brand"
                            onChange={() => togglePermission(module.id, action.id)}
                            type="checkbox"
                          />
                          {action.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>SKU 流转权限</CardTitle>
          <p className="mt-1 text-sm text-muted">账号角色会直接决定商品页负责人下拉和 SKU 处理权限。</p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          {[
            { title: "选品", body: "新建 SKU 后自动成为选品负责人，不需要手动选择。", tone: "gray" as const },
            { title: "运营主管 / 运营", body: "SKU 状态为运营确认中时必须选择，可多选；被选中的运营获得该 SKU 编辑权。", tone: "amber" as const },
            { title: "美工", body: "SKU 状态为美工处理中时必须选择，可多选；被选中的美工只有查看权。", tone: "blue" as const },
            { title: "停用账号", body: "不会出现在运营或美工负责人下拉里，也不会获得新的 SKU 权限。", tone: "red" as const },
          ].map((item) => (
            <div key={item.title} className="rounded-md border border-border bg-white p-4">
              <Badge tone={item.tone}>{item.title}</Badge>
              <p className="mt-3 text-sm leading-6 text-muted">{item.body}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>人员分布</CardTitle>
            <Badge tone="gray">按部门</Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {departments.map((department) => {
              const count = accounts.filter((account) => account.department === department).length;
              const percent = Math.round((count / accounts.length) * 100);

              return <DepartmentBar key={department} name={department} count={count} percent={percent} />;
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>最近账号动态</CardTitle>
            <Badge tone="blue">审计预览</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              "李娜调整了广告优化角色的导出权限",
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
      {editAccount ? (
        <EditAccountDialog account={editAccount} roles={roles} onClose={() => setEditAccount(null)} onSubmit={saveAccount} />
      ) : null}
      {passwordAccount ? <PasswordDialog account={passwordAccount} onClose={() => setPasswordAccount(null)} /> : null}
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
      <CardContent className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-muted">{title}</p>
          <p className="mt-2 text-3xl font-black text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted">{note}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-surface-muted">
          <Icon className={`h-5 w-5 ${colorClass}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function DepartmentBar({ name, count, percent }: { name: string; count: number; percent: number }) {
  return (
    <div className="rounded-md border border-border px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-foreground">{name}</p>
        <span className="text-sm font-black text-foreground">{count}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-muted">
        <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
      </div>
    </div>
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
    department: "广告中心",
    title: "运营专员",
    roleId: "viewer" as RoleId,
  });

  const ready = form.name.trim() && form.email.trim();

  return (
    <Modal title={title} onClose={onClose}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="姓名">
          <input className={fieldClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
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

  return (
    <Modal title="编辑账号资料" onClose={onClose}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="姓名">
          <input className={fieldClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
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
        <Button onClick={() => onSubmit(form)}>
          <Check className="h-4 w-4" />
          保存修改
        </Button>
      </div>
    </Modal>
  );
}

function PasswordDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const matched = password.length >= 8 && password === confirmPassword;

  return (
    <Modal title={`修改密码：${account.name}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          新密码仅用于该同事下次登录。正式接入后这里会调用服务端密码重置接口。
        </p>
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
        <Button disabled={!matched} onClick={onClose}>
          <KeyRound className="h-4 w-4" />
          确认改密
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
