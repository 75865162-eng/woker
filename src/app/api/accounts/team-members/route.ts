import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getBootstrapAdminEmail, isBootstrapAdminEmail } from "@/lib/auth/constants";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { normalizeAccountRoleId, normalizeTeamAccounts, toOrganizationRoleId, type TeamAccountRecord } from "@/lib/accounts/team-roster";
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

function toRosterWriteData(account: RosterSaveAccount) {
  const status: "active" | "pending" | "disabled" | "archived" =
    account.status === "pending" || account.status === "active" || account.status === "archived" ? account.status : "disabled";

  return {
    username: account.username ?? null,
    name: account.name,
    email: account.email,
    ...(typeof account.password === "string" && account.password.trim() ? { password: account.password.trim() } : {}),
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

function isDefaultSuperAccount(
  account: Pick<TeamAccountRecord, "id"> & Partial<Pick<TeamAccountRecord, "email" | "username">>,
  defaultSuperAccountIds: Set<string>,
) {
  return (
    account.id === "local-admin" ||
    defaultSuperAccountIds.has(account.id) ||
    isBootstrapAdminEmail(account.email) ||
    account.username?.trim().toLowerCase() === "1"
  );
}

function lockDefaultSuperAccount<T extends TeamAccountRecord | RosterSaveAccount>(account: T, defaultSuperAccountIds: Set<string>): T {
  if (!isDefaultSuperAccount(account, defaultSuperAccountIds)) return account;

  return {
    ...account,
    email: getBootstrapAdminEmail(),
    roleId: "owner",
    status: "active",
  };
}

async function getDefaultSuperAccountIds(client: typeof prisma | Prisma.TransactionClient, organizationId: string) {
  const bootstrapUser = await client.user.findUnique({
    where: {
      email: getBootstrapAdminEmail(),
    },
    select: {
      id: true,
    },
  });

  if (!bootstrapUser) return new Set<string>();

  const membership = await client.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: bootstrapUser.id,
      },
    },
    select: {
      userId: true,
    },
  });

  return new Set(membership ? [membership.userId] : []);
}

function shouldProtectAccountFromUser(
  user: { id: string; role: string },
  account: Pick<TeamAccountRecord, "id" | "roleId"> & Partial<Pick<TeamAccountRecord, "email" | "username">>,
  defaultSuperAccountIds: Set<string>,
) {
  if (isDefaultSuperAccount(account, defaultSuperAccountIds)) return true;
  if (user.role !== "operations_supervisor") return false;

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
  const editableAccounts = submittedAccounts.filter((account) => !protectedIds.has(account.id) && !isDefaultSuperAccount(account, defaultSuperAccountIds));
  const preservedAccounts = protectedAccounts.map((account) => ({
    ...lockDefaultSuperAccount(account, defaultSuperAccountIds),
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
    const user = await getCurrentUserFromRequest(request);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

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
    const user = await getCurrentUserFromRequest(request);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const permissions = await getOrganizationRolePermissions(user.organizationId);

    if (!roleCanPerformAction(user.role, "accounts", "edit", permissions)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const body = (await request.json()) as { accounts?: unknown; members?: unknown };
    const input = body.accounts ?? body.members;
    const normalized = normalizeTeamAccounts(input).map((account, index) => ({
      ...account,
      organizationId: user.organizationId,
      sortOrder: index,
    }));

    if (!process.env.DATABASE_URL) {
      const localAccounts = normalized.map((account) => lockDefaultSuperAccount(account, new Set<string>()));

      return NextResponse.json({
        accounts: localAccounts.map((account) => ({
          ...account,
          lastActiveAt: account.lastActiveAt ?? undefined,
        })),
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
              orderBy: {
                sortOrder: "asc",
              },
            })
          ).map(toAccountRecord);
          const defaultSuperAccountIds = await getDefaultSuperAccountIds(tx, user.organizationId);
          const currentRoleByAccountId = new Map(currentMembers.map((account) => [account.id, account.roleId]));

          const scopedAccounts = mergeProtectedAccounts(user, user.organizationId, normalized, currentMembers, defaultSuperAccountIds);
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

          for (const account of scopedAccounts) {
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
            tx,
            scopedAccounts.map((account) => ({
              ...account,
              roleId: normalizeAccountRoleId(account.roleId),
            })),
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
            orderBy: {
              sortOrder: "asc",
            },
          });

          return {
            accounts: members.map(toAccountRecord).map((account) => lockDefaultSuperAccount(account, defaultSuperAccountIds)),
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

    return NextResponse.json({
      accounts: result.accounts,
      revision: result.revision,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save team members.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
