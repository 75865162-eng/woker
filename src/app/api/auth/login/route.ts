import { NextResponse } from "next/server";
import { getAuthDriver } from "@/lib/auth/constants";
import { createLocalSession, createSession, isSecureRequest } from "@/lib/auth/session";
import { verifyPasswordAsync } from "@/lib/auth/password";
import { measureServerOperation } from "@/lib/server/performance";
import { getOrganizationRolePermissionsSnapshot } from "@/lib/accounts/role-permissions-server";
import { isDatabaseUnavailableError } from "@/lib/db/is-database-unavailable-error";
import { clearLoginFailures, LoginRateLimitUnavailableError, peekLoginRateLimit, recordLoginFailure } from "@/lib/auth/login-rate-limit";
import { prisma } from "@/lib/db/prisma";
import { getTrustedClientIp, RequestSecurityConfigurationError } from "@/lib/auth/request-security";

export const runtime = "nodejs";

function tooManyAttempts(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "尝试次数过多，请稍后再试。" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

/** Count a failed attempt and fail closed immediately once the budget is spent. */
async function failedLogin(ip: string, email: string) {
  const verdict = await recordLoginFailure(ip, email);
  return verdict.allowed
    ? NextResponse.json({ error: "账号或密码不正确。" }, { status: 401 })
    : tooManyAttempts(verdict.retryAfterSeconds);
}

export async function POST(request: Request) {
  try {
    const clientIp = getTrustedClientIp(request);
    const body = (await request.json()) as { email?: string; password?: string; organizationId?: string };
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? "";

    if (!email || !password) {
      return NextResponse.json({ error: "请输入账号和密码。" }, { status: 400 });
    }

    const precheck = await peekLoginRateLimit(clientIp, email);
    if (!precheck.allowed) {
      return tooManyAttempts(precheck.retryAfterSeconds);
    }

    if (getAuthDriver() === "local") {
      const configuredEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL || "1").trim().toLowerCase();
      const configuredPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "1";

      if (email !== configuredEmail || password !== configuredPassword) {
        return failedLogin(clientIp, email);
      }

      await clearLoginFailures(clientIp, email);
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
      const user = await measureServerOperation("login.user", () => prisma.user.findFirst({
        where: {
          email: {
            equals: email,
            mode: "insensitive",
          },
        },
        select: {
          id: true, email: true, name: true, status: true, passwordHash: true,
          memberships: {
            select: { organizationId: true, role: true, organization: { select: { name: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
      }));

      if (!user || user.status !== "active" || !await measureServerOperation("login.password", () => verifyPasswordAsync(password, user.passwordHash))) {
        return failedLogin(clientIp, email);
      }

      if (user.memberships.length === 0) {
        return NextResponse.json({ error: "账号尚未加入任何组织。" }, { status: 403 });
      }
      if (user.memberships.length > 1 && !body.organizationId) {
        return NextResponse.json({
          error: "请选择要进入的组织。",
          organizations: user.memberships.map(({ organizationId, organization }) => ({ id: organizationId, name: organization.name })),
        }, { status: 409 });
      }

      const membership = body.organizationId
        ? user.memberships.find(item => item.organizationId === body.organizationId)
        : user.memberships[0];
      if (!membership) return NextResponse.json({ error: "所选组织不可访问。" }, { status: 403 });
      await clearLoginFailures(clientIp, email);
      const rolePermissionsSnapshotPromise = getOrganizationRolePermissionsSnapshot(membership.organizationId);
      const loginAt = new Date();
      const loginAtText = loginAt.toLocaleString("zh-CN", { hour12: false });

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
        rolePermissionsSnapshotPromise,
      );
      const rolePermissionsSnapshot = await rolePermissionsSnapshotPromise;
      await Promise.all([prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: loginAt },
      }), prisma.teamRosterMember.updateMany({
        where: {
          organizationId: membership.organizationId,
          id: user.id,
        },
        data: {
          lastActiveAt: loginAtText,
          lastLoginAt: loginAtText,
          ...(clientIp ? { lastLoginIp: clientIp } : {}),
        },
      })]);

      const response = NextResponse.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: membership.role,
        },
        // Only the revision is exposed. The full permission map is never part
        // of the login response: the browser consumes the snapshot cookie for
        // UI gating, and every server authorization re-reads the DB snapshot.
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

      if (process.env.NODE_ENV === "production") {
        return NextResponse.json(
          { error: "数据库暂时不可用，请稍后重试。" },
          { status: 503 },
        );
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
    if (error instanceof LoginRateLimitUnavailableError) {
      return NextResponse.json(
        { error: error.message },
        { status: 503, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    if (error instanceof RequestSecurityConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "登录失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
