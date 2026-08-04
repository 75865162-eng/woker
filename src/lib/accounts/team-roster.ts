import type { ProductWorkflowRole } from "@/lib/products/types";

export type TeamMemberStatus = "active" | "pending" | "disabled";

export type AccountRoleId =
  | "owner"
  | "database_admin"
  | "operations_supervisor"
  | "operations"
  | "operations_assistant"
  | "developer"
  | "designer"
  | "warehouse"
  | "warehouse_supervisor"
  | "finance"
  | "procurement"
  | "viewer";

export type TeamAccountRecord = {
  id: string;
  name: string;
  email: string;
  password?: string;
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
  database_admin: "database_admin",
  selection: "procurement",
  ppc_manager: "operations",
  listing_operator: "operations",
  logistics_operator: "warehouse",
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
        password: typeof account.password === "string" ? account.password : undefined,
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
