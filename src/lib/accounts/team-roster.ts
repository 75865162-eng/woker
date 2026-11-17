import type { ProductWorkflowRole } from "@/lib/products/types";

export type TeamMemberStatus = "active" | "pending" | "disabled" | "archived";

export type AccountRoleId = string;

export const organizationRoleIds = [
  "owner",
  "database_admin",
  "operations_supervisor",
  "operations",
  "operations_assistant",
  "developer",
  "designer",
  "warehouse",
  "warehouse_supervisor",
  "finance",
  "procurement",
  "viewer",
] as const;

export type OrganizationRoleId = (typeof organizationRoleIds)[number];

export type TeamAccountRecord = {
  id: string;
  username?: string;
  name: string;
  email: string;
  // 仅用于显式设置或重置密码；服务端读取和导出不得返回。
  password?: string;
  department: string;
  title: string;
  roleId: AccountRoleId;
  status: TeamMemberStatus;
  lastActiveAt?: string;
  amazonStorePermissions?: string;
  multiPlatformStorePermissions?: string;
  phone?: string;
  lastLoginIp?: string;
  lastLoginAt?: string;
  sourceCreatedAt?: string;
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

export const teamRoleLabels: Record<ProductWorkflowRole, string> = {
  selection: "选品",
  operations_supervisor: "运营主管",
  operations: "运营",
  designer: "美工",
};

export const accountRoleToWorkflowRole: Partial<Record<string, ProductWorkflowRole>> = {
  operations_supervisor: "operations_supervisor",
  operations: "operations",
  operations_assistant: "operations",
  procurement: "selection",
  designer: "designer",
};

const roleAliases: Record<string, OrganizationRoleId> = {
  "超级管理员": "owner",
  "数据库管理员": "database_admin",
  "运营主管": "operations_supervisor",
  "运营助理": "operations_assistant",
  "运营": "operations",
  "选品": "developer",
  "美工": "designer",
  "仓管": "warehouse",
  "仓管员": "warehouse",
  "仓库主管": "warehouse_supervisor",
  "财务": "finance",
  "采购": "procurement",
  "查看者": "viewer",
  "乐器查看账号": "viewer",
};

export function normalizeAccountRoleId(roleId: string | null | undefined): AccountRoleId {
  const normalized = String(roleId ?? "").trim();
  if (organizationRoleIds.includes(normalized as OrganizationRoleId)) return normalized;
  if (roleAliases[normalized]) return roleAliases[normalized];
  const candidates = normalized.split(/[，,、/|]+/).map((item) => item.trim()).filter(Boolean);
  const matches = candidates.map((candidate) => roleAliases[candidate] ?? (organizationRoleIds.includes(candidate as OrganizationRoleId) ? candidate as OrganizationRoleId : undefined)).filter((role): role is OrganizationRoleId => Boolean(role));
  if (!matches.length) return normalized;
  if (matches.includes("operations_supervisor")) return "operations_supervisor";
  if (matches.includes("operations")) return "operations";
  if (matches.includes("warehouse_supervisor")) return "warehouse_supervisor";
  if (matches.includes("warehouse")) return "warehouse";
  return matches[0];
}

export function toOrganizationRoleId(roleId: string | null | undefined): OrganizationRoleId {
  const normalized = normalizeAccountRoleId(roleId);

  // Roster roles may be customized; membership authorization stores only the Prisma enum.
  return organizationRoleIds.includes(normalized as OrganizationRoleId) ? (normalized as OrganizationRoleId) : "viewer";
}

export function normalizeTeamAccounts(value: unknown): TeamAccountRecord[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) => Boolean(item.id) && Boolean(item.name) && Boolean(item.roleId))
    .map((item) => {
      const account = item as Partial<TeamAccountRecord>;

      return {
        id: String(account.id),
        username: typeof account.username === "string" ? account.username : undefined,
        name: String(account.name),
        email: String(account.email ?? ""),
        password: typeof account.password === "string" ? account.password : undefined,
        department: String(account.department ?? ""),
        title: String(account.title ?? ""),
        roleId: normalizeAccountRoleId(String(account.roleId)),
        status: account.status === "disabled" || account.status === "pending" || account.status === "archived" ? account.status : "active",
        lastActiveAt: account.lastActiveAt,
        amazonStorePermissions: typeof account.amazonStorePermissions === "string" ? account.amazonStorePermissions : undefined,
        multiPlatformStorePermissions: typeof account.multiPlatformStorePermissions === "string" ? account.multiPlatformStorePermissions : undefined,
        phone: typeof account.phone === "string" ? account.phone : undefined,
        lastLoginIp: typeof account.lastLoginIp === "string" ? account.lastLoginIp : undefined,
        lastLoginAt: typeof account.lastLoginAt === "string" ? account.lastLoginAt : undefined,
        sourceCreatedAt: typeof account.sourceCreatedAt === "string" ? account.sourceCreatedAt : undefined,
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

  return members.filter((member) => member.status !== "disabled" && member.status !== "archived" && roleSet.has(member.role));
}

export function getTeamMemberNameOptionsFromAccounts(accounts: TeamAccountRecord[], roles: ProductWorkflowRole[]) {
  return filterTeamMembersByRoles(accountsToTeamMembers(accounts), roles).map((member) => member.name);
}
