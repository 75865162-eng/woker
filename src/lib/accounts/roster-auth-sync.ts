import type { OrganizationRole, Prisma, PrismaClient } from "@prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { isBootstrapAdminEmail } from "@/lib/auth/constants";
import type { TeamAccountRecord } from "@/lib/accounts/team-roster";

type RosterLoginAccount = Pick<TeamAccountRecord, "id" | "name" | "email" | "username" | "status" | "password">;
type RosterLoginAccountWithOrg = RosterLoginAccount & {
  organizationId: string;
  roleId: TeamAccountRecord["roleId"];
};

function trimOrEmpty(value?: string | null) {
  return value?.trim() ?? "";
}

export function getRosterLoginName(account: Pick<RosterLoginAccount, "id" | "email" | "username">) {
  return trimOrEmpty(account.email) || trimOrEmpty(account.username) || account.id;
}

export function isRosterBootstrapAccount(account: Pick<RosterLoginAccount, "id" | "email" | "username">) {
  const loginName = getRosterLoginName(account);

  return account.id === "local-admin" || isBootstrapAdminEmail(loginName) || loginName === "1";
}

export function getRosterInitialPassword(account: Pick<RosterLoginAccount, "id" | "email" | "username">) {
  return isRosterBootstrapAccount(account) ? "1" : "12345678";
}

function getUserStatus(account: Pick<RosterLoginAccount, "status">) {
  return account.status === "disabled" ? "disabled" : "active";
}

export async function syncRosterLoginUsers(
  client: Prisma.TransactionClient | PrismaClient,
  accounts: RosterLoginAccountWithOrg[],
) {
  for (const account of accounts) {
    const loginName = getRosterLoginName(account);
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
