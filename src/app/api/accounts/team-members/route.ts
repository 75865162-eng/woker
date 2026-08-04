import { NextResponse } from "next/server";
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
      members = [...members, ...missingUserAccounts];
    }

    return NextResponse.json({ accounts: members.map(toAccountRecord) });
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

    const body = (await request.json()) as { accounts?: unknown; members?: unknown };
    const input = body.accounts ?? body.members;
    const normalized = normalizeTeamAccounts(input).map((account, index) => ({
      ...stripAccountPassword(account),
      organizationId: user.organizationId,
      sortOrder: index,
    }));

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ accounts: normalized.map(toAccountRecord) });
    }

    await prisma.$transaction([
      prisma.teamRosterMember.deleteMany({
        where: {
          organizationId: user.organizationId,
        },
      }),
      ...(normalized.length
        ? [
            prisma.teamRosterMember.createMany({
              data: normalized,
            }),
          ]
        : []),
      ...normalized.map((account) =>
        prisma.organizationMember.updateMany({
          where: {
            organizationId: user.organizationId,
            userId: account.id,
          },
          data: {
            role: mapAccountRoleToOrganizationRole(account.roleId),
          },
        }),
      ),
      prisma.userSession.deleteMany({
        where: {
          userId: {
            not: user.id,
            in: normalized.map((account) => account.id),
          },
        },
      }),
    ]);

    return NextResponse.json({
      accounts: normalized.map((account) => ({
        ...account,
        lastActiveAt: account.lastActiveAt ?? undefined,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save team members.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
