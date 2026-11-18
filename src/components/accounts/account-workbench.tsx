"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccountWorkbookTransfer } from "./use-account-workbook-transfer";
import { Archive, Download, Search, Upload, UserCog, UserPlus, UsersRound } from "lucide-react";
import { AccountMembersTable } from "./account-members-table";
import { PointsPolicyPanel } from "@/components/settings/points-policy-panel";
import { McpSettingsPanel } from "@/components/settings/mcp-settings-panel";
import { LiliDevicesPanel } from "@/components/settings/lili-devices-panel";
import { ListPageTemplate } from "@/components/templates/page-templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type PointsRow } from "@/components/accounts/points-quick-panel";
import { useAccountRoles } from "./use-account-roles";
import { type RoleCatalogItem } from "@/lib/accounts/role-catalog";
import { createAccountWorkbookRows } from "@/lib/accounts/account-workbook";
import { type TeamAccountRecord } from "@/lib/accounts/team-roster";
import { type AccountStatus, type RoleId, type Account, fieldClass, accountPageSize, getFallbackPassword, canManageAccount, canManageRole, withLoadedAccountState, loadAccountsFromApi, saveAccountsToApi } from "./account-workbench-api";
import { MetricCard, ArchivedAccountsDialog, RoleDialog, RoleMembersDialog, AccountDialog, EditAccountDialog } from "./account-workbench-dialogs";
import { AccountDetailDrawer } from "./account-detail-drawer";
import { AccessCenter } from "./access-center";
import { AccessConfigPanels } from "./access-config-panels";

// main2 授权中心（access）与既有积分定价（points）/MCP 设备（mcp）四 tab 共存。
type AccountTab = "members" | "access" | "points" | "mcp";

function normalizeAccountTab(value: string | null): AccountTab {
  // 旧 tab=roles 归一到新授权中心 access；其余沿用原名。
  if (value === "roles") return "access";
  if (value === "access" || value === "points" || value === "mcp") return value;
  return "members";
}

export function AccountWorkbench({
  initialAccounts,
  initialRoles: serverRoles,
  canEditAccess = false,
}: {
  initialAccounts?: TeamAccountRecord[];
  initialRoles?: RoleCatalogItem[];
  canEditAccess?: boolean;
}) {
  const [accounts, setAccounts] = useState<Account[]>(() =>
    (initialAccounts ?? []).map((account) => withLoadedAccountState({
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
  );
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab = normalizeAccountTab(searchParams.get("tab"));
  const urlRole = searchParams.get("role")?.trim() || "";
  const [accountSaveError, setAccountSaveError] = useState("");
  const [activeTab, setActiveTabState] = useState<AccountTab>(urlTab);
  const [pointsByUser, setPointsByUser] = useState<Record<string, PointsRow>>({});
  const [canAdjustPoints, setCanAdjustPoints] = useState(false);
  const [pointsReloadKey, setPointsReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<AccountStatus | "all">("all");
  const [roleFilter, setRoleFilter] = useState<RoleId | "all">("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [newAccountOpen, setNewAccountOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [detailAccount, setDetailAccount] = useState<Account | null>(null);
  const [archivedAccountsOpen, setArchivedAccountsOpen] = useState(false);
  const [accountPage, setAccountPage] = useState(1);
  const visibleAccounts = useMemo(() => accounts.filter((account) => account.status !== "archived"), [accounts]);
  const { roles, visibleRoles, activeRole, setActiveRoleId, activeRoleMembers, availableRoleTemplates, newRoleOpen, setNewRoleOpen, roleMembersOpen, setRoleMembersOpen, addRole, deleteRole } = useAccountRoles(serverRoles, visibleAccounts);

  // tab 切换同步到 URL，保持可分享/可回退。access/points/mcp 均按原名写入。
  function setActiveTab(tab: AccountTab) {
    setActiveTabState(tab);
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "members") params.delete("tab");
    else params.set("tab", tab);
    if (tab !== "access") params.delete("role");
    const query = params.toString();
    router.replace(query ? `/accounts?${query}` : "/accounts", { scroll: false });
  }

  // URL → state：支持浏览器前进/后退与外部深链。
  useEffect(() => {
    setActiveTabState(urlTab);
  }, [urlTab]);

  // 旧 tab=roles 深链统一规范化为 tab=access（保留 role 选中参数）。
  useEffect(() => {
    if (searchParams.get("tab") === "roles") {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", "access");
      router.replace(`/accounts?${params.toString()}`, { scroll: false });
    }
  }, [searchParams, router]);

  useEffect(() => {
    let canceled = false;

    void fetch("/api/points/overview", { cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((body: { rows?: PointsRow[]; access?: { canAdjust: boolean } } | null) => {
        if (canceled || !body) return;

        const map: Record<string, PointsRow> = {};
        for (const row of body.rows ?? []) map[row.userId] = row;
        setPointsByUser(map);
        setCanAdjustPoints(Boolean(body.access?.canAdjust));
      })
      .catch(() => {
        // 积分看板不可用时不影响账号管理主流程
      });

    return () => {
      canceled = true;
    };
  }, [pointsReloadKey]);

  useEffect(() => {
    let canceled = false;

    if (initialAccounts) return;

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
  }, [initialAccounts]);

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

      return keywordMatched &&
        (statusFilter === "all" || account.status === statusFilter) &&
        (roleFilter === "all" || account.roleId === roleFilter) &&
        (departmentFilter === "all" || account.department === departmentFilter);
    });
  }, [query, statusFilter, roleFilter, departmentFilter, visibleAccounts]);

  const disabledAccounts = visibleAccounts.filter((account) => account.status === "disabled");
  const archivedAccounts = accounts.filter((account) => account.status === "archived");
  const departments = Array.from(new Set(visibleAccounts.map((account) => account.department)));
  const accountPageCount = Math.max(1, Math.ceil(filteredAccounts.length / accountPageSize));
  const currentAccountPage = Math.min(accountPage, accountPageCount);
  const paginatedAccounts = filteredAccounts.slice((currentAccountPage - 1) * accountPageSize, currentAccountPage * accountPageSize);
  const firstAccountIndex = filteredAccounts.length ? (currentAccountPage - 1) * accountPageSize + 1 : 0;
  const lastAccountIndex = Math.min(currentAccountPage * accountPageSize, filteredAccounts.length);

  useEffect(() => {
    setAccountPage(1);
  }, [query, statusFilter, roleFilter, departmentFilter]);

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

  const { accountImportMessage, accountImporting, accountImportInputRef, exportAccounts, importAccounts } = useAccountWorkbookTransfer({ accounts: visibleAccounts, roleLabels, commitAccounts, setError: setAccountSaveError });

  return (
    <ListPageTemplate header={<div className="space-y-[var(--gap-section)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="inline-flex w-fit items-center gap-1 border-b border-border" role="tablist" aria-label="账号权限视图">
          {([ ["members", "成员"], ["access", "授权中心"], ["points", "积分额度与定价"], ["mcp", "MCP 与设备凭证"] ] as const).map(([tab, label]) => (
            <button key={tab} aria-selected={activeTab === tab} className={`border-b-2 px-4 py-2 text-sm font-semibold ${activeTab === tab ? "border-brand text-brand" : "border-transparent text-muted hover:text-foreground"}`} onClick={() => setActiveTab(tab)} role="tab" type="button">
              {label}
            </button>
          ))}
        </div>
        {activeTab === "members" ? <div className="flex flex-col gap-2 sm:flex-row">
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
        </div> : null}
      </div>
      {accountSaveError ? (
        <div className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-medium text-danger-ink">
          {accountSaveError}
        </div>
      ) : null}
      {accountImportMessage ? (
        <div className="rounded-md border border-success/30 bg-success-soft px-4 py-3 text-sm font-medium text-success-ink">
          {accountImportMessage}
        </div>
      ) : null}
      </div>} stats={activeTab === "members" ? <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <button className="text-left" onClick={() => { setQuery(""); setStatusFilter("all"); setRoleFilter("all"); setDepartmentFilter("all"); }} type="button"><MetricCard title="账号总数" value={visibleAccounts.length} note="清除筛选并查看全部" icon={UsersRound} tone="blue" /></button>
        <button className="text-left" onClick={() => { setQuery(""); setRoleFilter("all"); setDepartmentFilter("all"); setStatusFilter(statusFilter === "disabled" ? "all" : "disabled"); }} type="button"><MetricCard title="停用账号" value={disabledAccounts.length} note="点击筛选停用账号" icon={UserCog} tone="gray" /></button>
        <button className="text-left" onClick={() => setArchivedAccountsOpen(true)} type="button">
          <MetricCard title="归档" value={archivedAccounts.length} note="查看已归档员工" icon={Archive} tone="gray" />
        </button>
      </section> : undefined} table={<div className="space-y-[var(--gap-section)]">
      {activeTab === "members" ? <>
      <section className="grid grid-cols-1 gap-[var(--gap-field)]">
        <Card>
          <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-section">同事账号列表</CardTitle>
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
            </div>
          </CardHeader>
          <div className="grid grid-cols-1 gap-2 border-t border-border px-4 py-3 sm:grid-cols-3">
            <select aria-label="按状态筛选" className={fieldClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AccountStatus | "all")}>
              <option value="all">全部状态</option><option value="active">正常</option><option value="pending">待激活</option><option value="disabled">已停用</option>
            </select>
            <select aria-label="按角色筛选" className={fieldClass} value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleId | "all")}>
              <option value="all">全部角色</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
            <select aria-label="按部门筛选" className={fieldClass} value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
              <option value="all">全部部门</option>{departments.map((department) => <option key={department} value={department}>{department}</option>)}
            </select>
            {(statusFilter !== "all" || roleFilter !== "all" || departmentFilter !== "all") ? <Button className="sm:col-span-3 sm:justify-self-end" size="sm" variant="secondary" onClick={() => { setStatusFilter("all"); setRoleFilter("all"); setDepartmentFilter("all"); }}>清除筛选</Button> : null}
          </div>
          <CardContent className="p-0">
            <AccountMembersTable
              accounts={paginatedAccounts} roles={roles} pointsByUser={pointsByUser}
              total={filteredAccounts.length} page={currentAccountPage} pageCount={accountPageCount}
              firstIndex={firstAccountIndex} lastIndex={lastAccountIndex} onPageChange={setAccountPage}
              onRoleChange={updateAccountRole} onEdit={setEditAccount} onOpenDetail={setDetailAccount}
              onToggleStatus={toggleAccountStatus} onArchive={archiveAccount}
            />
          </CardContent>
        </Card>

      </section>
      </> : activeTab === "access" ? <>
        <AccessCenter
          initialSubjectId={urlRole || undefined}
          roleManagement={{
            roles: visibleRoles.map((role) => ({ id: role.id, name: role.name, description: role.description, memberCount: role.memberCount })),
            canManage: (id) => canManageRole(id as RoleId),
            onAdd: () => setNewRoleOpen(true),
            onMembers: (id) => { setActiveRoleId(id as RoleId); setRoleMembersOpen(true); },
            onDelete: (id) => deleteRole(id as RoleId),
          }}
        />
        <AccessConfigPanels canEdit={canEditAccess} />
      <details className="rounded-md border border-border bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-foreground">SKU 流转权限说明</summary>
        <Card className="border-0 shadow-none">
        <CardHeader className="px-4 py-3">
          <CardTitle className="text-section">SKU 流转权限</CardTitle>
          <p className="mt-1 text-sm text-muted">账号角色会直接决定商品页负责人下拉和 SKU 处理权限。</p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-4">
          {[
            { title: "采购", body: "新建 SKU 后自动成为采购负责人，不需要手动选择。", tone: "gray" as const },
            { title: "主管 / 运营 / 运营助理", body: "SKU 状态为运营确认中时必须选择，可多选；被选中的成员获得该 SKU 编辑权。", tone: "amber" as const },
            { title: "美工", body: "SKU 状态为美工处理中时必须选择，可多选；被选中的美工只有查看权。", tone: "blue" as const },
            { title: "停用账号", body: "不会出现在运营或美工负责人下拉里，也不会获得新的 SKU 权限。", tone: "red" as const },
          ].map((item) => (
            <div key={item.title} className="rounded-md border border-border bg-surface p-3">
              <Badge tone={item.tone}>{item.title}</Badge>
              <p className="mt-2 text-sm leading-5 text-muted">{item.body}</p>
            </div>
          ))}
        </CardContent>
        </Card>
      </details>
      </> : activeTab === "points" ? (
        <PointsPolicyPanel />
      ) : (
        <div className="space-y-[var(--gap-section)]">
          <McpSettingsPanel />
          <LiliDevicesPanel />
        </div>
      )}

      {newAccountOpen ? <AccountDialog roles={roles} title="新建同事账号" onClose={() => setNewAccountOpen(false)} onSubmit={createAccount} /> : null}
      {newRoleOpen ? <RoleDialog roles={availableRoleTemplates} onClose={() => setNewRoleOpen(false)} onSubmit={addRole} /> : null}
      {roleMembersOpen ? <RoleMembersDialog role={activeRole} accounts={activeRoleMembers} onClose={() => setRoleMembersOpen(false)} /> : null}
      {editAccount ? (
        <EditAccountDialog
          account={editAccount}
          roles={roles}
          onClose={() => setEditAccount(null)}
          onSubmit={saveAccount}
          pointsRow={pointsByUser[editAccount.id] ?? null}
          canAdjustPoints={canAdjustPoints}
          onPointsChanged={() => setPointsReloadKey((key) => key + 1)}
        />
      ) : null}
      {archivedAccountsOpen ? <ArchivedAccountsDialog rows={archivedAccountRows} onClose={() => setArchivedAccountsOpen(false)} /> : null}
      {detailAccount ? (
        <AccountDetailDrawer
          account={detailAccount}
          roles={roles}
          points={pointsByUser[detailAccount.id] ?? null}
          onClose={() => setDetailAccount(null)}
          onEdit={(account) => { setDetailAccount(null); setEditAccount(account); }}
        />
      ) : null}
    </div>} />
  );
}
