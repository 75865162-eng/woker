import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: string;
      name?: string;
      password?: string;
      confirmPassword?: string;
    };
    const email = body.email?.trim().toLowerCase();
    const name = body.name?.trim();
    const password = body.password ?? "";
    const confirmPassword = body.confirmPassword ?? "";

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: "注册需要先配置数据库连接。" }, { status: 500 });
    }

    if (!email || !name || !password || !confirmPassword) {
      return NextResponse.json({ error: "请填写账号、真实姓名、密码和确认密码。" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "密码至少需要 8 位。" }, { status: 400 });
    }

    if (password !== confirmPassword) {
      return NextResponse.json({ error: "两次输入的密码不一致。" }, { status: 400 });
    }

    const organizationName = process.env.BOOTSTRAP_ORG_NAME || "Amazon Operations";
    const organizationSlug = process.env.BOOTSTRAP_ORG_SLUG || slugify(organizationName) || "amazon-operations";

    const result = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email },
        select: { id: true },
      });

      if (existingUser) {
        return { error: "该账号已注册。" };
      }

      const organization = await tx.organization.upsert({
        where: { slug: organizationSlug },
        update: { name: organizationName },
        create: {
          name: organizationName,
          slug: organizationSlug,
        },
      });
      const existingMemberCount = await tx.organizationMember.count({
        where: {
          organizationId: organization.id,
        },
      });
      const membershipRole = existingMemberCount === 0 ? "owner" : "viewer";
      const user = await tx.user.create({
        data: {
          email,
          name,
          passwordHash: hashPassword(password),
          memberships: {
            create: {
              organizationId: organization.id,
              role: membershipRole,
            },
          },
        },
        include: {
          memberships: true,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          action: "user_register",
          entityType: "User",
          entityId: user.id,
        },
      });
      await tx.teamRosterMember.upsert({
        where: {
          organizationId_id: {
            organizationId: organization.id,
            id: user.id,
          },
        },
        update: {
          name: user.name,
          email: user.email,
          status: "active",
        },
        create: {
          organizationId: organization.id,
          id: user.id,
          name: user.name,
          email: user.email,
          department: "未分配",
          title: "注册用户",
          roleId: membershipRole,
          status: "active",
          lastActiveAt: "已注册",
          sortOrder: 1000,
        },
      });

      return {
        user,
        organization,
        membership: user.memberships[0],
      };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    await createSession(result.user.id, {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.membership.role,
      organizationId: result.organization.id,
      organizationName: result.organization.name,
    });

    return NextResponse.json({
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "注册失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
