import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { normalizeAccountRoleId, normalizeTeamAccounts, organizationRoleIds, toOrganizationRoleId, type TeamAccountRecord } from "@/lib/accounts/team-roster";
import { syncRosterLoginUsers } from "@/lib/accounts/roster-auth-sync";
import { getTeamRosterSnapshot } from "@/lib/accounts/team-roster-server";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

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

type RosterSaveAccount = TeamAccountRecord & { organizationId: string; sortOrder: number };

const rosterSaveMaxAttempts = 3;
const rosterSaveTransactionMaxWaitMs = 10_000;
const rosterSaveTransactionTimeoutMs = 60_000;

function toAccountRecord(member: Omit<RosterAccountRow, "updatedAt">): TeamAccountRecord {
  return {
    id: member.id,
    username: member.username ?? undefined,
    name: member.name,
    email: member.email,
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

function toRosterWriteData(account: RosterSaveAccount) {
  const status: "active" | "pending" | "disabled" | "archived" =
    account.status === "pending" || account.status === "active" || account.status === "archived" || account.status === "disabled" ? account.status : "disabled";

  return {
    username: account.username ?? null,
    name: account.name,
    email: account.email,
    department: account.department,
    title: account.title,
    roleId: account.roleId,
    status,
    lastActiveAt: account.lastActiveAt ?? null,
    amazonStorePermissions: account.amazonStorePermissions ?? null,
    multiPlatformStorePermissions: account.multiPlatformStorePermissions ?? null,
    phone: account.phone ?? null,
    lastLoginIp: account.lastLoginIp ?? null,
    lastLoginAt: account.lastLoginAt ?? null,
    sourceCreatedAt: account.sourceCreatedAt ?? null,
    sortOrder: account.sortOrder,
  };
}

function mapAccountRoleToOrganizationRole(roleId: TeamAccountRecord["roleId"]) {
  return toOrganizationRoleId(roleId);
}

function isProtectedAccount(account: Pick<TeamAccountRecord, "id">, protectedAccountIds: Set<string>) {
  return protectedAccountIds.has(account.id.trim().toLowerCase());
}

function getProtectedAccountIds() {
  return new Set((process.env.PROTECTED_SUPER_ACCOUNT_IDS ?? "").split(",").map((id) => id.trim().toLowerCase()).filter(Boolean));
}

function shouldProtectAccountFromUser(
  user: { id: string; role: string },
  account: Pick<TeamAccountRecord, "id" | "roleId"> & Partial<Pick<TeamAccountRecord, "email" | "username">>,
  defaultSuperAccountIds: Set<string>,
) {
  if (isProtectedAccount(account, defaultSuperAccountIds)) return true;
  if (user.role === "owner") return false;

  return account.id === user.id || account.roleId === "owner" || account.roleId === "database_admin";
}

function mergeProtectedAccounts(
  user: { id: string; role: string },
  organizationId: string,
  submittedAccounts: RosterSaveAccount[],
  currentAccounts: TeamAccountRecord[],
  defaultSuperAccountIds: Set<string>,
) {
  const shouldProtectAccount = (account: TeamAccountRecord | RosterSaveAccount) =>
    shouldProtectAccountFromUser(user, account, defaultSuperAccountIds);

  const protectedAccounts = currentAccounts.filter(shouldProtectAccount);
  const protectedIds = new Set(protectedAccounts.map((account) => account.id));
  const editableAccounts = submittedAccounts.filter((account) => !protectedIds.has(account.id) && !isProtectedAccount(account, defaultSuperAccountIds));
  const preservedAccounts = protectedAccounts.map((account) => ({
    ...account,
    organizationId,
    sortOrder: 0,
  }));
  const mergedAccounts = [...preservedAccounts, ...editableAccounts];

  return mergedAccounts.map((account, index) => ({
    ...account,
    organizationId,
    sortOrder: index,
  }));
}

function buildRosterRevision(members: Pick<RosterAccountRow, "id" | "updatedAt">[]) {
  const latestUpdatedAt = members.reduce((latest, member) => Math.max(latest, member.updatedAt.getTime()), 0);

  return `${members.length}:${latestUpdatedAt}:${members.map((member) => member.id).sort().join(",")}`;
}

function isPrismaWriteConflict(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : "";

  return code === "P2034" || code === "P2028" || /write conflict|deadlock|transaction (not found|already closed)|closed transaction/i.test(message);
}

async function waitForRetry(attempt: number) {
  await new Promise((resolve) => setTimeout(resolve, 60 * attempt));
}

async function runRosterSaveTransaction<T>(operation: () => Promise<T>) {
  for (let attempt = 1; attempt <= rosterSaveMaxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isPrismaWriteConflict(error) || attempt === rosterSaveMaxAttempts) {
        throw error;
      }

      await waitForRetry(attempt);
    }
  }

  throw new Error("账号列表保存失败，请重试。");
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("accounts", "view", request);
    if (!permission.ok) return permission.response;
    const { user } = permission;

    const snapshot = await getTeamRosterSnapshot(user.organizationId);

    return NextResponse.json({
      accounts: snapshot.accounts,
      revision: snapshot.revision,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load team members.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const permission = await requireApiPermission("accounts", "edit", request);
    if (!permission.ok) return permission.response;
    const { user } = permission;

    const body = (await request.json()) as { accounts?: unknown; members?: unknown };
    const input = body.accounts ?? body.members;
    const normalized = normalizeTeamAccounts(input).map((account, index) => ({
      ...account,
      organizationId: user.organizationId,
      sortOrder: index,
    }));

    if (normalized.some((account) => !organizationRoleIds.includes(account.roleId as (typeof organizationRoleIds)[number]))) {
      return NextResponse.json({ error: "账号角色必须使用受支持的正式角色标识。" }, { status: 400 });
    }

    if (!process.env.DATABASE_URL) {
      if (user.role !== "owner" && normalized.some((account) => account.roleId === "owner" || account.roleId === "database_admin")) {
        return NextResponse.json({ error: "仅组织所有者可以分配管理角色。" }, { status: 403 });
      }
      return NextResponse.json({
        accounts: normalized.map(toAccountRecord),
        revision: "local",
      });
    }

    const result = await runRosterSaveTransaction(() =>
      prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw<{ locked: number }[]>`SELECT 1::int AS "locked" FROM "Organization" WHERE id = ${user.organizationId} FOR UPDATE`;

          const currentMembers = (
            await tx.teamRosterMember.findMany({
              where: {
                organizationId: user.organizationId,
              },
              omit: { password: true },
              orderBy: {
                sortOrder: "asc",
              },
            })
          ).map(toAccountRecord);
          const memberships = await tx.organizationMember.findMany({
            where: { organizationId: user.organizationId },
            select: { role: true, user: { select: { id: true, name: true, email: true, status: true } } },
          });
          for (const membership of memberships) {
            const existing = currentMembers.find((account) => account.id === membership.user.id);
            if (existing) {
              existing.roleId = membership.role;
              if (membership.user.status === "disabled") existing.status = "disabled";
            } else {
              currentMembers.push({
                id: membership.user.id,
                name: membership.user.name,
                email: membership.user.email,
                roleId: membership.role,
                status: membership.user.status === "disabled" ? "disabled" : "active",
                department: "未分配",
                title: "注册用户",
              });
            }
          }
          const defaultSuperAccountIds = getProtectedAccountIds();
          for (const account of currentMembers) {
            if (isProtectedAccount(account, defaultSuperAccountIds) && !memberships.some((membership) => membership.user.id === account.id)) {
              account.roleId = "viewer";
              account.status = "disabled";
            }
          }
          const protectedIds = new Set(currentMembers.filter((account) => shouldProtectAccountFromUser(user, account, defaultSuperAccountIds)).map((account) => account.id));
          if (user.role !== "owner" && normalized.some((account) => !protectedIds.has(account.id) && (account.roleId === "owner" || account.roleId === "database_admin"))) {
            return { error: "仅组织所有者可以分配管理角色。" } as const;
          }
          const scopedAccounts = mergeProtectedAccounts(user, user.organizationId, normalized, currentMembers, defaultSuperAccountIds);
          const editableLoginAccounts = scopedAccounts.filter((account) => !shouldProtectAccountFromUser(user, account, defaultSuperAccountIds));
          const existingUsers = await tx.user.findMany({
            where: { id: { in: editableLoginAccounts.map((account) => account.id) } },
            select: { id: true, memberships: { select: { organizationId: true } } },
          });
          if (existingUsers.some((existing) => !existing.memberships.some((membership) => membership.organizationId === user.organizationId)
            || existing.memberships.some((membership) => membership.organizationId !== user.organizationId))) {
            return { error: "不能通过团队账号管理修改组织外或跨组织共享的登录账号。" } as const;
          }
          const currentRoleByAccountId = new Map(currentMembers.map((account) => [account.id, account.roleId]));

          const scopedAccountIds = scopedAccounts.map((account) => account.id);

          await tx.teamRosterMember.deleteMany({
            where: scopedAccountIds.length
              ? {
                  organizationId: user.organizationId,
                  id: {
                    notIn: scopedAccountIds,
                  },
                }
              : {
                  organizationId: user.organizationId,
                },
          });

          for (const account of scopedAccounts) {
            const data = toRosterWriteData(account);

            await tx.teamRosterMember.upsert({
              omit: { password: true },
              where: {
                organizationId_id: {
                  organizationId: user.organizationId,
                  id: account.id,
                },
              },
              create: {
                organizationId: user.organizationId,
                id: account.id,
                ...data,
              },
              update: data,
            });
          }

          for (const account of editableLoginAccounts) {
            await tx.organizationMember.updateMany({
              where: {
                organizationId: user.organizationId,
                userId: account.id,
              },
              data: {
                role: mapAccountRoleToOrganizationRole(account.roleId),
              },
            });
          }

          await syncRosterLoginUsers(
            {
              user: tx.user,
              organizationMember: { upsert: (input) => tx.organizationMember.upsert(input) },
              $executeRaw: tx.$executeRaw.bind(tx),
            } as Prisma.TransactionClient,
            editableLoginAccounts.map((account) => ({
              ...account,
              roleId: normalizeAccountRoleId(account.roleId),
            })),
            "manage",
          );

          const roleChanges = scopedAccounts
            .map((account) => {
              const before = currentRoleByAccountId.get(account.id);
              return before && before !== account.roleId
                ? {
                    accountId: account.id,
                    accountName: account.name,
                    before,
                    after: account.roleId,
                  }
                : null;
            })
            .filter(
              (
                item,
              ): item is {
                accountId: string;
                accountName: string;
                before: TeamAccountRecord["roleId"];
                after: TeamAccountRecord["roleId"];
              } => Boolean(item),
            );

          if (roleChanges.length) {
            await tx.auditLog.create({
              data: {
                organizationId: user.organizationId,
                userId: user.id,
                action: "update_team_member_roles",
                entityType: "TeamRosterMember",
                entityId: user.id,
                metadata: {
                  changes: roleChanges,
                },
              },
            });
          }

          const members = await tx.teamRosterMember.findMany({
            where: {
              organizationId: user.organizationId,
            },
            omit: { password: true },
            orderBy: {
              sortOrder: "asc",
            },
          });

          return {
            accounts: members.map(toAccountRecord),
            revision: buildRosterRevision(members),
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: rosterSaveTransactionMaxWaitMs,
          timeout: rosterSaveTransactionTimeoutMs,
        },
      ),
    );

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 403 });

    return NextResponse.json({
      accounts: result.accounts,
      revision: result.revision,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save team members.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
