import type { OrganizationRole, Prisma, PrismaClient } from "@prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { isBootstrapAdminEmail } from "@/lib/auth/constants";
import type { TeamAccountRecord } from "@/lib/accounts/team-roster";

type RosterLoginAccount = Pick<TeamAccountRecord, "id" | "name" | "email" | "username" | "phone" | "status" | "password">;
type RosterLoginAccountWithOrg = RosterLoginAccount & {
  organizationId: string;
  roleId: TeamAccountRecord["roleId"];
};

function trimOrEmpty(value?: string | null) {
  return value?.trim() ?? "";
}

function getRosterLoginCandidates(account: Pick<RosterLoginAccount, "id" | "email" | "username" | "phone">) {
  return [trimOrEmpty(account.phone), trimOrEmpty(account.username), trimOrEmpty(account.email), trimOrEmpty(account.id)]
    .map((value) => value.toLowerCase())
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);
}

function getRosterLoginPriority(account: Pick<RosterLoginAccount, "email" | "username" | "phone">) {
  if (trimOrEmpty(account.phone)) return 3;
  if (trimOrEmpty(account.username)) return 2;
  if (trimOrEmpty(account.email)) return 1;
  return 0;
}

export function getRosterLoginName(account: Pick<RosterLoginAccount, "id" | "email" | "username" | "phone">) {
  return getRosterLoginCandidates(account)[0] ?? account.id.toLowerCase();
}

export function isRosterBootstrapAccount(account: Pick<RosterLoginAccount, "id" | "email" | "username" | "phone">) {
  const loginName = getRosterLoginName(account);

  return account.id === "local-admin" || isBootstrapAdminEmail(loginName) || loginName === "1";
}

export function getRosterInitialPassword(account: Pick<RosterLoginAccount, "id" | "email" | "username" | "phone">) {
  return isRosterBootstrapAccount(account) ? "1" : "12345678";
}

function getUserStatus(account: Pick<RosterLoginAccount, "status">) {
  return account.status === "disabled" || account.status === "archived" ? "disabled" : "active";
}

export async function syncRosterLoginUsers(
  client: Prisma.TransactionClient | PrismaClient,
  accounts: RosterLoginAccountWithOrg[],
) {
  const currentAccountIds = new Set(accounts.map((account) => account.id));
  const existingUsers = await client.user.findMany({
    select: {
      id: true,
      email: true,
    },
  });
  const usedLoginNames = new Set(
    existingUsers
      .filter((user) => !currentAccountIds.has(user.id))
      .map((user) => user.email.trim().toLowerCase())
      .filter(Boolean),
  );
  const sortedAccounts = [...accounts].sort((left, right) => {
    const leftScore = getRosterLoginPriority(left);
    const rightScore = getRosterLoginPriority(right);

    if (leftScore !== rightScore) return rightScore - leftScore;

    return left.id.localeCompare(right.id);
  });

  for (const account of sortedAccounts) {
    const loginName = getRosterLoginCandidates(account).find((candidate) => !usedLoginNames.has(candidate)) ?? account.id.toLowerCase();
    usedLoginNames.add(loginName);
    const hasExplicitPassword = Boolean(account.password?.trim());
    const password = hasExplicitPassword ? account.password!.trim() : getRosterInitialPassword(account);
    const isBootstrapAccount = isRosterBootstrapAccount(account);
    const nextName = isBootstrapAccount ? "Super Admin" : account.name;
    const nextStatus = isBootstrapAccount ? "active" : getUserStatus(account);

    await client.user.upsert({
      where: { id: account.id },
      update: {
        email: loginName,
        name: nextName,
        status: nextStatus,
        ...(hasExplicitPassword ? { passwordHash: hashPassword(password) } : {}),
      },
      create: {
        id: account.id,
        email: loginName,
        name: nextName,
        passwordHash: hashPassword(password),
        status: nextStatus,
      },
    });

    await client.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: account.organizationId,
          userId: account.id,
        },
      },
      update: {
        role: account.roleId as OrganizationRole,
      },
      create: {
        organizationId: account.organizationId,
        userId: account.id,
        role: account.roleId as OrganizationRole,
      },
    });
  }
}
