import { NextResponse } from "next/server";
import { getAuthDriver } from "@/lib/auth/constants";
import { createLocalSession, createSession, isSecureRequest } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { getOrganizationRolePermissionsSnapshot } from "@/lib/accounts/role-permissions-server";
import { isDatabaseUnavailableError } from "@/lib/db/is-database-unavailable-error";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();

  return forwardedFor || realIp || "";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? "";

    if (!email || !password) {
      return NextResponse.json({ error: "请输入账号和密码。" }, { status: 400 });
    }

    if (getAuthDriver() === "local") {
      const configuredEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL || "1").trim().toLowerCase();
      const configuredPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "1";

      if (email !== configuredEmail || password !== configuredPassword) {
        return NextResponse.json({ error: "账号或密码不正确。" }, { status: 401 });
      }

      const user = {
        id: "local-admin",
        email: configuredEmail,
        name: "Local Admin",
        role: "owner",
        organizationId: "local-organization",
        organizationName: process.env.BOOTSTRAP_ORG_NAME || "Local Organization",
      };

      const { sessionCookie } = await createLocalSession(user, isSecureRequest(request));
      const response = NextResponse.json({ user });
      response.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.options);

      return response;
    }

    try {
      const user = await prisma.user.findFirst({
        where: {
          email: {
            equals: email,
            mode: "insensitive",
          },
        },
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
      const rolePermissionsSnapshot = await getOrganizationRolePermissionsSnapshot(membership.organizationId);
      const loginAt = new Date();
      const loginAtText = loginAt.toLocaleString("zh-CN", { hour12: false });
      const clientIp = getClientIp(request);

      const { sessionCookie, rolePermissionsCookie } = await createSession(
        user.id,
        {
          id: user.id,
          email: user.email,
          name: user.name,
          role: membership.role,
          organizationId: membership.organizationId,
          organizationName: "",
        },
        isSecureRequest(request),
        rolePermissionsSnapshot,
      );
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: loginAt },
      });
      await prisma.teamRosterMember.updateMany({
        where: {
          organizationId: membership.organizationId,
          id: user.id,
        },
        data: {
          lastActiveAt: loginAtText,
          lastLoginAt: loginAtText,
          ...(clientIp ? { lastLoginIp: clientIp } : {}),
        },
      });

      const response = NextResponse.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: membership.role,
        },
        rolePermissions: rolePermissionsSnapshot.permissions,
        rolePermissionsRevision: rolePermissionsSnapshot.revision,
      });
      response.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.options);

      if (rolePermissionsCookie) {
        response.cookies.set(rolePermissionsCookie.name, rolePermissionsCookie.value, rolePermissionsCookie.options);
      }

      return response;
    } catch (error) {
      if (!isDatabaseUnavailableError(error)) {
        throw error;
      }

      const configuredEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL || "1").trim().toLowerCase();
      const configuredPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "1";

      if (email !== configuredEmail || password !== configuredPassword) {
        return NextResponse.json(
          {
            error: "数据库暂时不可用，请先启动 PostgreSQL，或使用本地管理员账号登录。",
          },
          { status: 503 },
        );
      }

      const user = {
        id: "local-admin",
        email: configuredEmail,
        name: "Local Admin",
        role: "owner",
        organizationId: "local-organization",
        organizationName: process.env.BOOTSTRAP_ORG_NAME || "Local Organization",
      };

      const { sessionCookie } = await createLocalSession(user, isSecureRequest(request));
      const response = NextResponse.json({ user });
      response.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.options);

      return response;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
