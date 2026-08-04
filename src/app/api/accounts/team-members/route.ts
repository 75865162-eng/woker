import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { normalizeTeamAccounts, type TeamAccountRecord } from "@/lib/accounts/team-roster";

export const runtime = "nodejs";

function stripAccountPassword(account: TeamAccountRecord) {
  const record = { ...account };
  delete record.password;
  return record;
}

type RosterAccountRow = {
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
  roleId: string;
  status: string;
  lastActiveAt?: string | null;
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

function toAccountRecord(member: RosterAccountRow): TeamAccountRecord {
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    department: member.department,
    title: member.title,
    roleId: member.roleId as TeamAccountRecord["roleId"],
    status: member.status === "disabled" || member.status === "pending" ? member.status : "active",
    lastActiveAt: member.lastActiveAt ?? undefined,
  };
}

function mapOrganizationRoleToAccountRole(role: string): TeamAccountRecord["roleId"] {
  if (role === "owner") return "owner";
  if (role === "database_admin") return "database_admin";
  if (role === "admin" || role === "operations_manager") return "operations_supervisor";
  if (role === "logistics_specialist") return "warehouse";
  if (role === "ppc_specialist" || role === "listing_specialist") return "operations";

  return "viewer";
}

function mapAccountRoleToOrganizationRole(roleId: TeamAccountRecord["roleId"]) {
  if (roleId === "owner") return "owner";
  if (roleId === "database_admin") return "database_admin";
  if (roleId === "operations_supervisor") return "operations_manager";
  if (roleId === "warehouse" || roleId === "warehouse_supervisor") return "logistics_specialist";
  if (roleId === "operations" || roleId === "operations_assistant") return "ppc_specialist";

  return "viewer";
}

function canManageAccounts(role: string) {
  return role === "owner" || role === "database_admin";
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

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ accounts: [] });
    }

    let members: RosterAccountRow[] = await prisma.teamRosterMember.findMany({
      where: {
        organizationId: user.organizationId,
      },
      orderBy: {
        sortOrder: "asc",
      },
    });

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
    const missingUserAccounts = userMemberships
      .filter((membership) => !existingRosterIds.has(membership.user.id))
      .map((membership, index) => ({
        organizationId: user.organizationId,
        id: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        department: "未分配",
        title: "注册用户",
        roleId: mapOrganizationRoleToAccountRole(membership.role),
        status: membership.user.status === "disabled" ? ("disabled" as const) : ("active" as const),
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

    return NextResponse.json({ accounts: members.map(toAccountRecord), revision: buildRosterRevision(members) });
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

    if (!canManageAccounts(user.role)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const body = (await request.json()) as { accounts?: unknown; members?: unknown; revision?: unknown };
    const input = body.accounts ?? body.members;
    const expectedRevision = typeof body.revision === "string" ? body.revision : "";
    const normalized = normalizeTeamAccounts(input).map((account, index) => ({
      ...stripAccountPassword(account),
      organizationId: user.organizationId,
      sortOrder: index,
    }));

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({
        accounts: normalized.map((account) => ({
          ...account,
          lastActiveAt: account.lastActiveAt ?? undefined,
        })),
        revision: "local",
      });
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const currentRevision = await getRosterRevision(tx, user.organizationId);

        if (!expectedRevision || expectedRevision !== currentRevision) {
          return {
            conflict: true as const,
            revision: currentRevision,
          };
        }

        await tx.teamRosterMember.deleteMany({
          where: {
            organizationId: user.organizationId,
          },
        });

        if (normalized.length) {
          await tx.teamRosterMember.createMany({
            data: normalized,
          });
        }

        await Promise.all(
          normalized.map((account) =>
            tx.organizationMember.updateMany({
              where: {
                organizationId: user.organizationId,
                userId: account.id,
              },
              data: {
                role: mapAccountRoleToOrganizationRole(account.roleId),
              },
            }),
          ),
        );

        await tx.userSession.deleteMany({
          where: {
            userId: {
              not: user.id,
              in: normalized.map((account) => account.id),
            },
          },
        });

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
          accounts: members.map(toAccountRecord),
          revision: buildRosterRevision(members),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
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
