import { getBootstrapAdminEmail, isBootstrapAdminEmail } from "@/lib/auth/constants";
import { prisma } from "@/lib/db/prisma";
import { normalizeAccountRoleId, type TeamAccountRecord } from "@/lib/accounts/team-roster";

type RosterAccountRow = {
  id: string;
  username?: string | null;
  name: string;
  email: string;
  password?: string | null;
  department: string;
  title: string;
  roleId: string;
  status: string;
  lastActiveAt?: string | null;
  amazonStorePermissions?: string | null;
  multiPlatformStorePermissions?: string | null;
  phone?: string | null;
  lastLoginIp?: string | null;
  lastLoginAt?: string | null;
  sourceCreatedAt?: string | null;
  updatedAt: Date;
};

type OrganizationMembershipRow = {
  user: {
    id: string;
    name: string;
    email: string;
    status: string;
    lastLoginAt: Date | null;
  };
  role: string;
};

export type TeamRosterSnapshot = {
  accounts: TeamAccountRecord[];
  revision: string;
};

function toAccountRecord(member: RosterAccountRow): TeamAccountRecord {
  return {
    id: member.id,
    username: member.username ?? undefined,
    name: member.name,
    email: member.email,
    password: member.password ?? undefined,
    department: member.department,
    title: member.title,
    roleId: normalizeAccountRoleId(member.roleId),
    status: member.status === "disabled" || member.status === "pending" || member.status === "archived" ? member.status : "active",
    lastActiveAt: member.lastActiveAt ?? undefined,
    amazonStorePermissions: member.amazonStorePermissions ?? undefined,
    multiPlatformStorePermissions: member.multiPlatformStorePermissions ?? undefined,
    phone: member.phone ?? undefined,
    lastLoginIp: member.lastLoginIp ?? undefined,
    lastLoginAt: member.lastLoginAt ?? undefined,
    sourceCreatedAt: member.sourceCreatedAt ?? undefined,
  };
}

function lockDefaultSuperAccount(account: TeamAccountRecord, defaultSuperAccountIds: Set<string>) {
  const isDefaultSuperAccount =
    account.id === "local-admin"
    || defaultSuperAccountIds.has(account.id)
    || isBootstrapAdminEmail(account.email)
    || account.username?.trim().toLowerCase() === "1";

  if (!isDefaultSuperAccount) return account;

  return {
    ...account,
    email: getBootstrapAdminEmail(),
    roleId: "owner",
    status: "active" as const,
  };
}

function buildRosterRevision(members: Pick<RosterAccountRow, "id" | "updatedAt">[]) {
  const latestUpdatedAt = members.reduce((latest, member) => Math.max(latest, member.updatedAt.getTime()), 0);

  return `${members.length}:${latestUpdatedAt}:${members.map((member) => member.id).sort().join(",")}`;
}

export async function getTeamRosterSnapshot(organizationId: string): Promise<TeamRosterSnapshot> {
  if (!process.env.DATABASE_URL) {
    return { accounts: [], revision: "local" };
  }

  const [members, userMemberships] = await Promise.all([
    prisma.teamRosterMember.findMany({
      where: { organizationId },
      orderBy: { sortOrder: "asc" },
    }) as Promise<RosterAccountRow[]>,
    prisma.organizationMember.findMany({
      where: { organizationId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            lastLoginAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }) as Promise<OrganizationMembershipRow[]>,
  ]);

  const existingRosterIds = new Set(members.map((member) => member.id));
  const defaultSuperAccountIds = new Set(
    userMemberships.filter((membership) => isBootstrapAdminEmail(membership.user.email)).map((membership) => membership.user.id),
  );
  const missingAccounts = userMemberships
    .filter((membership) => !existingRosterIds.has(membership.user.id))
    .map((membership) => ({
      id: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      department: "未分配",
      title: "注册用户",
      roleId: isBootstrapAdminEmail(membership.user.email) ? "owner" : normalizeAccountRoleId(membership.role),
      status: isBootstrapAdminEmail(membership.user.email) || membership.user.status !== "disabled" ? "active" as const : "disabled" as const,
      lastActiveAt: membership.user.lastLoginAt ? membership.user.lastLoginAt.toLocaleString("zh-CN", { hour12: false }) : "已注册",
    } satisfies TeamAccountRecord));

  const accounts = [
    ...members.map(toAccountRecord),
    ...missingAccounts,
  ].map((account) => lockDefaultSuperAccount(account, defaultSuperAccountIds));

  return {
    accounts,
    revision: buildRosterRevision(members),
  };
}
