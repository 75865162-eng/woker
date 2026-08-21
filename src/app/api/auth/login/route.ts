import { NextResponse } from "next/server";
import {
  getAuthDriver,
  getBootstrapAdminEmail,
  getBootstrapSuperAdminCredentials,
  isBootstrapAdminEmail,
} from "@/lib/auth/constants";
import { createLocalSession, createSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import { normalizeAccountRoleId } from "@/lib/accounts/team-roster";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? "";

    if (!email || !password) {
      return NextResponse.json({ error: "请输入账号和密码。" }, { status: 400 });
    }

    if (getAuthDriver() === "local") {
      const configuredEmail = getBootstrapAdminEmail();
      const configuredPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "1";
      const superAdminCredentials = getBootstrapSuperAdminCredentials();
      const isPrimaryAdmin = email === configuredEmail && password === configuredPassword;
      const isExtraAdmin = Boolean(superAdminCredentials && email === superAdminCredentials.email && password === superAdminCredentials.password);

      if (!isPrimaryAdmin && !isExtraAdmin) {
        return NextResponse.json({ error: "账号或密码不正确。" }, { status: 401 });
      }

      const user = {
        id: isExtraAdmin ? "local-super-admin" : "local-admin",
        email: isExtraAdmin && superAdminCredentials ? superAdminCredentials.email : configuredEmail,
        name: isExtraAdmin ? "Local Super Admin" : "Local Admin",
        role: "owner",
        organizationId: "local-organization",
        organizationName: process.env.BOOTSTRAP_ORG_NAME || "Local Organization",
      };

      const response = NextResponse.json({ user });
      await createLocalSession(user, response);

      return response;
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: true,
      },
    });

    if (!user || user.status !== "active" || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "账号或密码不正确。" }, { status: 401 });
    }

    if (user.memberships.length === 0) {
      return NextResponse.json({ error: "账号尚未加入任何组织。" }, { status: 403 });
    }

    const membership = user.memberships[0];
    const rosterMember = await prisma.teamRosterMember.findUnique({
      where: {
        organizationId_id: {
          organizationId: membership.organizationId,
          id: user.id,
        },
      },
      select: {
        roleId: true,
      },
    });
    const effectiveRole = isBootstrapAdminEmail(user.email) ? "owner" : normalizeAccountRoleId(rosterMember?.roleId ?? membership.role);

    if (isBootstrapAdminEmail(user.email)) {
      await Promise.all([
        prisma.organizationMember.updateMany({
          where: {
            organizationId: membership.organizationId,
            userId: user.id,
          },
          data: {
            role: "owner",
          },
        }),
        prisma.teamRosterMember.updateMany({
          where: {
            organizationId: membership.organizationId,
            id: user.id,
          },
          data: {
            name: user.name,
            email: user.email,
            roleId: "owner",
            status: "active",
          },
        }),
      ]);
    }

    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });

    await createSession(user.id, {
      id: user.id,
      email: user.email,
      name: user.name,
      role: effectiveRole,
      organizationId: membership.organizationId,
      organizationName: "",
    }, response);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
