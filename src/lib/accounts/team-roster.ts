import type { ProductWorkflowRole } from "@/lib/products/types";

export type TeamMemberStatus = "active" | "pending" | "disabled";

export type AccountRoleId =
  | "owner"
  | "operations_supervisor"
  | "operations"
  | "operations_assistant"
  | "designer"
  | "warehouse"
  | "warehouse_supervisor"
  | "finance"
  | "procurement";

export type TeamAccountRecord = {
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
  roleId: AccountRoleId;
  status: TeamMemberStatus;
  lastActiveAt?: string;
};

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
  role: ProductWorkflowRole;
  status: TeamMemberStatus;
};

export const accountRosterStorageKey = "amazon-bulk-ad-accounts-v1";

export const defaultTeamAccounts: TeamAccountRecord[] = [
  {
    id: "local-admin",
    name: "Local Admin",
    email: "1",
    department: "系统管理",
    title: "系统管理员",
    roleId: "owner",
    status: "active",
    lastActiveAt: "当前登录账号",
  },
  {
    id: "u-selection-001",
    name: "陈选品",
    email: "selection.chen@example.local",
    department: "选品中心",
    title: "选品",
    roleId: "procurement",
    status: "active",
    lastActiveAt: "今天 09:10",
  },
  {
    id: "u-ops-manager-001",
    name: "李主管",
    email: "ops.manager.li@example.local",
    department: "运营中心",
    title: "运营主管",
    roleId: "operations_supervisor",
    status: "active",
    lastActiveAt: "今天 09:42",
  },
  {
    id: "u-ops-001",
    name: "张运营",
    email: "ops.zhang@example.local",
    department: "运营中心",
    title: "运营",
    roleId: "operations",
    status: "active",
    lastActiveAt: "今天 10:16",
  },
  {
    id: "u-ops-002",
    name: "周运营",
    email: "ops.zhou@example.local",
    department: "运营中心",
    title: "运营",
    roleId: "operations",
    status: "active",
    lastActiveAt: "昨天 18:03",
  },
  {
    id: "u-designer-001",
    name: "林美工",
    email: "designer.lin@example.local",
    department: "设计中心",
    title: "美工",
    roleId: "designer",
    status: "active",
    lastActiveAt: "今天 11:20",
  },
  {
    id: "u-designer-002",
    name: "赵美工",
    email: "designer.zhao@example.local",
    department: "设计中心",
    title: "美工",
    roleId: "designer",
    status: "pending",
    lastActiveAt: "待首次登录",
  },
];

export const teamRoleLabels: Record<ProductWorkflowRole, string> = {
  selection: "选品",
  operations_supervisor: "运营主管",
  operations: "运营",
  designer: "美工",
};

export const accountRoleToWorkflowRole: Partial<Record<AccountRoleId, ProductWorkflowRole>> = {
  operations_supervisor: "operations_supervisor",
  operations: "operations",
  operations_assistant: "operations",
  procurement: "selection",
  designer: "designer",
};

const legacyRoleMap: Record<string, AccountRoleId> = {
  admin: "operations_supervisor",
  selection: "procurement",
  ppc_manager: "operations",
  listing_operator: "operations",
  logistics_operator: "warehouse",
  viewer: "finance",
};

export function normalizeTeamAccounts(value: unknown): TeamAccountRecord[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) => Boolean(item.id) && Boolean(item.name) && Boolean(item.roleId))
    .map((item) => {
      const account = item as Partial<TeamAccountRecord>;

      return {
        id: String(account.id),
        name: String(account.name),
        email: String(account.email ?? ""),
        department: String(account.department ?? ""),
        title: String(account.title ?? ""),
        roleId: legacyRoleMap[String(account.roleId)] ?? (account.roleId as AccountRoleId),
        status: account.status === "disabled" || account.status === "pending" ? account.status : "active",
        lastActiveAt: account.lastActiveAt,
      } satisfies TeamAccountRecord;
    });
}

export function accountsToTeamMembers(accounts: TeamAccountRecord[]): TeamMember[] {
  return accounts.flatMap((account) => {
    const role = accountRoleToWorkflowRole[account.roleId];
    if (!role) return [];

    return [
      {
        id: account.id,
        name: account.name,
        email: account.email,
        department: account.department,
        title: account.title,
        role,
        status: account.status,
      },
    ];
  });
}

export function filterTeamMembersByRoles(members: TeamMember[], roles: ProductWorkflowRole[]) {
  const roleSet = new Set(roles);

  return members.filter((member) => member.status !== "disabled" && roleSet.has(member.role));
}

export function getTeamMemberNameOptionsFromAccounts(accounts: TeamAccountRecord[], roles: ProductWorkflowRole[]) {
  return filterTeamMembersByRoles(accountsToTeamMembers(accounts), roles).map((member) => member.name);
}
