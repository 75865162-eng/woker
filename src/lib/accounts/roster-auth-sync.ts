import type { OrganizationRole, Prisma, PrismaClient } from "@prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { isBootstrapAdminEmail } from "@/lib/auth/constants";
import { toOrganizationRoleId, type TeamAccountRecord } from "@/lib/accounts/team-roster";
import { upsertMemberWithCallAccount } from "./member-call-account";

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

export function getRosterInitialPassword(account: Pick<RosterLoginAccount, "password">) {
  const password = account.password?.trim();
  if (!password || password.length < 8 || password === "12345678") {
    throw new Error("新建或重置登录账号必须显式提供至少8位且非默认口令的密码。");
  }
  return password;
}

function getUserStatus(account: Pick<RosterLoginAccount, "status">) {
  return account.status === "disabled" || account.status === "archived" ? "disabled" : "active";
}

export async function syncRosterLoginUsers(
  client: Prisma.TransactionClient | PrismaClient,
  accounts: RosterLoginAccountWithOrg[],
  mode: "incremental" | "manage" = "incremental",
) {
  const existingUsers = await client.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      passwordHash: true,
    },
  });
  const existingById = new Map(existingUsers.map((user) => [user.id, user]));
  const loginNameOwners = new Map(existingUsers.map((user) => [user.email.trim().toLowerCase(), user.id]));
  const sortedAccounts = [...accounts].sort((left, right) => {
    const leftScore = getRosterLoginPriority(left);
    const rightScore = getRosterLoginPriority(right);

    if (leftScore !== rightScore) return rightScore - leftScore;

    return left.id.localeCompare(right.id);
  });

  for (const account of sortedAccounts) {
    const existing = existingById.get(account.id);
    const loginName = mode === "incremental" && existing?.email.trim()
      ? existing.email
      : getRosterLoginCandidates(account).find((candidate) => !loginNameOwners.has(candidate) || loginNameOwners.get(candidate) === account.id);
    if (!loginName) throw new Error("账号登录名已被占用。");
    loginNameOwners.set(loginName.trim().toLowerCase(), account.id);
    const hasExplicitPassword = Boolean(account.password?.trim());
    const password = hasExplicitPassword ? account.password!.trim() : existing ? undefined : getRosterInitialPassword(account);
    const passwordHash = password ? hashPassword(password) : undefined;
    const nextPasswordHash = passwordHash ?? (existing ? undefined : hashPassword(getRosterInitialPassword(account)));
    const isBootstrapAccount = isRosterBootstrapAccount(account);
    const nextName = account.name;
    const nextStatus = getUserStatus(account);

    // 后台只补缺；显式管理员保存才更新资料、登录状态与密码。
    const incrementalUpdate: Prisma.UserUpdateInput = existing
      ? mode === "manage"
        ? {
            email: loginName,
            name: account.name,
            status: getUserStatus(account),
            ...(passwordHash ? { passwordHash } : {}),
          }
        : {
            ...(!existing.email?.trim() ? { email: loginName } : {}),
            ...(!existing.name?.trim() ? { name: nextName } : {}),
          }
      : {
          email: loginName,
          name: nextName,
          passwordHash: nextPasswordHash!,
          status: nextStatus,
        };

    await client.user.upsert({
      where: { id: account.id },
      update: incrementalUpdate,
      create: {
        id: account.id,
        email: loginName,
        name: nextName,
        passwordHash: nextPasswordHash!,
        status: nextStatus,
      },
    });

    await upsertMemberWithCallAccount(client, {
      where: {
        organizationId_userId: {
          organizationId: account.organizationId,
          userId: account.id,
        },
      },
      // Preserve a manual role adjustment on an existing membership; the role
      // from the roster is applied only when the membership is created.
      update: {},
      create: {
        organizationId: account.organizationId,
        userId: account.id,
        role: toOrganizationRoleId(account.roleId) as OrganizationRole,
      },
    });
  }
}
