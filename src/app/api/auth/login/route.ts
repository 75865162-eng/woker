import { NextResponse } from "next/server";
import { getAuthDriver } from "@/lib/auth/constants";
import { createLocalSession, createSession, isSecureRequest } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";

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
    );
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
    response.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.options);

    if (rolePermissionsCookie) {
      response.cookies.set(rolePermissionsCookie.name, rolePermissionsCookie.value, rolePermissionsCookie.options);
    }

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
