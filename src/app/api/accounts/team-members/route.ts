import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { defaultTeamAccounts, normalizeTeamAccounts, type TeamAccountRecord } from "@/lib/accounts/team-roster";

export const runtime = "nodejs";

function toAccountRecord(member: {
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
  roleId: string;
  status: string;
  lastActiveAt?: string | null;
}): TeamAccountRecord {
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

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ accounts: [] });
    }

    const members = await prisma.teamRosterMember.findMany({
      where: {
        organizationId: user.organizationId,
      },
      orderBy: {
        sortOrder: "asc",
      },
    });

    if (!members.length) {
      const seedAccounts = normalizeTeamAccounts(defaultTeamAccounts).map((account, index) => ({
        ...account,
        organizationId: user.organizationId,
        sortOrder: index,
      }));

      if (seedAccounts.length) {
        await prisma.teamRosterMember.createMany({ data: seedAccounts });
      }

      return NextResponse.json({ accounts: seedAccounts.map(toAccountRecord) });
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
      ...account,
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
