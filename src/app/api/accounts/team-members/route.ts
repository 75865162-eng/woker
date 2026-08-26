import { NextResponse } from "next/server";
import { Prisma, type OrganizationRole } from "@prisma/client";
import { getBootstrapAdminEmail, isBootstrapAdminEmail } from "@/lib/auth/constants";
import { getCurrentUser } from "@/lib/auth/session";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { normalizeAccountRoleId, normalizeTeamAccounts, type TeamAccountRecord } from "@/lib/accounts/team-roster";
import { syncRosterLoginUsers } from "@/lib/accounts/roster-auth-sync";
import { isDatabaseUnavailableError } from "@/lib/db/is-database-unavailable-error";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

type RosterAccountRow = {
  id: string;
  username?: string | null;
  name: string;
  email: string;
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

type OrganizationMembershipWithUser = {
  role: string;
  user: {
    id: string;
    name: string;
    email: string;
    status: string;
    lastLoginAt: Date | null;
  };
};

type RosterSaveAccount = TeamAccountRecord & { organizationId: string; sortOrder: number };

const rosterSaveMaxAttempts = 3;

function toAccountRecord(member: RosterAccountRow): TeamAccountRecord {
  return {
    id: member.id,
    username: member.username ?? undefined,
    name: member.name,
    email: member.email,
    department: member.department,
    title: member.title,
    roleId: normalizeAccountRoleId(member.roleId),
    status: member.status === "disabled" || member.status === "pending" ? member.status : "active",
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
  return {
    username: account.username ?? null,
    name: account.name,
    email: account.email,
    department: account.department,
    title: account.title,
    roleId: account.roleId,
    status: account.status,
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

function mapOrganizationRoleToAccountRole(role: string): TeamAccountRecord["roleId"] {
  return normalizeAccountRoleId(role);
}

function mapAccountRoleToOrganizationRole(roleId: TeamAccountRecord["roleId"]) {
  return normalizeAccountRoleId(roleId) as OrganizationRole;
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

async function getRosterRevision(client: typeof prisma | Prisma.TransactionClient, organizationId: string) {
  const members = await client.teamRosterMember.findMany({
    where: {
      organizationId,
    },
    select: {
      id: true,
      updatedAt: true,
    },
  });

  return buildRosterRevision(members);
}

function isPrismaWriteConflict(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : "";

  return code === "P2034" || /write conflict|deadlock/i.test(message);
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

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ accounts: [] });
    }

    let members: RosterAccountRow[];

    try {
      members = await prisma.teamRosterMember.findMany({
        where: {
          organizationId: user.organizationId,
        },
        orderBy: {
          sortOrder: "asc",
        },
      });
    } catch (error) {
      if (isDatabaseUnavailableError(error)) {
        return NextResponse.json(
          {
            accounts: [],
            revision: "database-unavailable",
            error: "数据库暂时不可用，账号列表已切换为空数据。",
          },
          { status: 503 },
        );
      }

      throw error;
    }

    const existingRosterIds = new Set(members.map((member) => member.id));
    const userMemberships = (await prisma.organizationMember.findMany({
      where: {
        organizationId: user.organizationId,
      },
      include: {
        user: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    })) as OrganizationMembershipWithUser[];
    const defaultSuperAccountIds = new Set(
      userMemberships.filter((membership) => isBootstrapAdminEmail(membership.user.email)).map((membership) => membership.user.id),
    );
    const missingUserAccounts = userMemberships
      .filter((membership) => !existingRosterIds.has(membership.user.id))
      .map((membership, index) => ({
        organizationId: user.organizationId,
        id: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        department: "未分配",
        title: "注册用户",
        roleId: isBootstrapAdminEmail(membership.user.email) ? ("owner" as const) : mapOrganizationRoleToAccountRole(membership.role),
        status: isBootstrapAdminEmail(membership.user.email) || membership.user.status !== "disabled" ? ("active" as const) : ("disabled" as const),
        lastActiveAt: membership.user.lastLoginAt ? membership.user.lastLoginAt.toLocaleString("zh-CN", { hour12: false }) : "已注册",
        sortOrder: members.length + index,
      }));

    if (missingUserAccounts.length) {
      await prisma.teamRosterMember.createMany({
        data: missingUserAccounts,
        skipDuplicates: true,
      });
      members = await prisma.teamRosterMember.findMany({
        where: {
          organizationId: user.organizationId,
        },
        orderBy: {
          sortOrder: "asc",
        },
      });
    }

    await syncRosterLoginUsers(
      prisma,
      members.map((member) => ({
        ...toAccountRecord(member),
        organizationId: user.organizationId,
        roleId: normalizeAccountRoleId(member.roleId),
      })),
    );

    return NextResponse.json({
      accounts: members.map(toAccountRecord).map((account) => lockDefaultSuperAccount(account, defaultSuperAccountIds)),
      revision: buildRosterRevision(members),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load team members.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const permissions = await getOrganizationRolePermissions(user.organizationId);

    if (!roleCanPerformAction(user.role, "accounts", "edit", permissions)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const body = (await request.json()) as { accounts?: unknown; members?: unknown; revision?: unknown };
    const input = body.accounts ?? body.members;
    const expectedRevision = typeof body.revision === "string" ? body.revision : "";
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
          await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${user.organizationId} FOR UPDATE`;

          const currentRevision = await getRosterRevision(tx, user.organizationId);
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

          if (!expectedRevision || expectedRevision !== currentRevision) {
            return {
              conflict: true as const,
              revision: currentRevision,
            };
          }

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

          const members = await tx.teamRosterMember.findMany({
            where: {
              organizationId: user.organizationId,
            },
            orderBy: {
              sortOrder: "asc",
            },
          });

          return {
            conflict: false as const,
            accounts: members.map(toAccountRecord).map((account) => lockDefaultSuperAccount(account, defaultSuperAccountIds)),
            revision: buildRosterRevision(members),
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      ),
    );

    if (result.conflict) {
      return NextResponse.json(
        { error: "账号列表已被其他人更新，请刷新后重试。", revision: result.revision },
        { status: 409 },
      );
    }

    return NextResponse.json({
      accounts: result.accounts,
      revision: result.revision,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save team members.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
