import { createHash, createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthDriver, isBootstrapAdminEmail, sessionCookieName, sessionMaxAgeSeconds } from "@/lib/auth/constants";
import { rolePermissionsCookieName } from "@/lib/accounts/permissions";
import { normalizeAccountRoleId } from "@/lib/accounts/team-roster";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";

type SessionPayload = {
  driver?: "database" | "local";
  sessionId: string;
  userId: string;
  token: string;
  expiresAt: string;
  localUser?: CurrentUser;
  sessionUser?: Pick<CurrentUser, "id" | "email" | "name" | "role" | "organizationId" | "organizationName">;
};

type WritableCookieStore = Awaited<ReturnType<typeof cookies>> | NextResponse["cookies"];

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  organizationName: string;
};

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;

  if (!secret || secret === "change-this-local-secret-before-production") {
    if (process.env.NODE_ENV === "production" && getAuthDriver() === "database") {
      throw new Error("AUTH_SECRET must be set before production use.");
    }
  }

  return secret || "local-development-auth-secret";
}

function shouldUseSecureCookies() {
  if (process.env.AUTH_COOKIE_SECURE === "false") {
    return false;
  }

  return process.env.NODE_ENV === "production";
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signPayload(payload: string) {
  return createHmac("sha256", getAuthSecret()).update(payload).digest("base64url");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function parseSessionCookie(value?: string): SessionPayload | undefined {
  if (!value) {
    return undefined;
  }

  const [payload, signature] = value.split(".");

  if (!payload || !signature || signPayload(payload) !== signature) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return undefined;
  }
}

function getCookieValue(cookieHeader: string | null | undefined, name: string) {
  if (!cookieHeader) {
    return undefined;
  }

  const cookiesByName = cookieHeader.split(";").map((cookie) => cookie.trim());
  const prefix = `${name}=`;
  const cookie = cookiesByName.find((item) => item.startsWith(prefix));

  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : undefined;
}

async function getWritableCookies(response?: NextResponse): Promise<WritableCookieStore> {
  return response?.cookies ?? (await cookies());
}

export async function createSession(userId: string, sessionUser?: CurrentUser, response?: NextResponse) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionMaxAgeSeconds * 1000);
  const session = await prisma.userSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
    },
  });
  const payload = base64UrlJson({
    sessionId: session.id,
    driver: "database",
    userId,
    token,
    expiresAt: expiresAt.toISOString(),
    sessionUser,
  } satisfies SessionPayload);
  const signedCookie = `${payload}.${signPayload(payload)}`;
  const cookieStore = await getWritableCookies(response);

  cookieStore.set(sessionCookieName, signedCookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    maxAge: sessionMaxAgeSeconds,
    path: "/",
  });

  if (sessionUser?.organizationId) {
    const rolePermissions = await getOrganizationRolePermissions(sessionUser.organizationId);

    cookieStore.set(rolePermissionsCookieName, encodeURIComponent(JSON.stringify(rolePermissions)), {
      sameSite: "lax",
      secure: shouldUseSecureCookies(),
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }

  return session;
}

export async function createLocalSession(user: CurrentUser, response?: NextResponse) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionMaxAgeSeconds * 1000);
  const payload = base64UrlJson({
    driver: "local",
    sessionId: `local-${Date.now()}`,
    userId: user.id,
    token,
    expiresAt: expiresAt.toISOString(),
    localUser: user,
  } satisfies SessionPayload);
  const cookieStore = await getWritableCookies(response);

  cookieStore.set(sessionCookieName, `${payload}.${signPayload(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    maxAge: sessionMaxAgeSeconds,
    path: "/",
  });
}

export async function destroyCurrentSession(response?: NextResponse, request?: Request) {
  const payload = request
    ? parseSessionCookie(getCookieValue(request.headers.get("cookie"), sessionCookieName))
    : parseSessionCookie((await cookies()).get(sessionCookieName)?.value);

  if (payload && payload.driver !== "local" && getAuthDriver() === "database") {
    await prisma.userSession.deleteMany({
      where: {
        id: payload.sessionId,
        userId: payload.userId,
      },
    });
  }

  const writableCookieStore = await getWritableCookies(response);
  writableCookieStore.delete(sessionCookieName);
  writableCookieStore.delete(rolePermissionsCookieName);
}

export async function getCurrentUser(request?: Request): Promise<CurrentUser | undefined> {
  if (request) {
    return getCurrentUserFromRequest(request);
  }

  const cookieStore = await cookies();
  const payload = parseSessionCookie(cookieStore.get(sessionCookieName)?.value);

  return getCurrentUserFromPayload(payload);
}

export async function getCurrentUserFromRequest(request: Request): Promise<CurrentUser | undefined> {
  const payload = parseSessionCookie(getCookieValue(request.headers.get("cookie"), sessionCookieName));

  return getCurrentUserFromPayload(payload);
}

async function getCurrentUserFromPayload(payload: SessionPayload | undefined): Promise<CurrentUser | undefined> {
  if (!payload || new Date(payload.expiresAt).getTime() <= Date.now()) {
    return undefined;
  }

  if (payload.driver !== getAuthDriver()) {
    return undefined;
  }

  if (payload.driver === "local") {
    return payload.localUser
      ? {
          ...payload.localUser,
          role: normalizeAccountRoleId(payload.localUser.role),
        }
      : undefined;
  }

  const session = await prisma.userSession.findFirst({
    where: {
      id: payload.sessionId,
      userId: payload.userId,
      tokenHash: hashToken(payload.token),
      expiresAt: {
        gt: new Date(),
      },
    },
    include: {
      user: {
        include: {
          memberships: {
            include: {
              organization: true,
            },
            orderBy: {
              createdAt: "asc",
            },
            take: 1,
          },
        },
      },
    },
  });

  const membership = session?.user.memberships[0];

  if (!session || session.user.status !== "active" || !membership) {
    return undefined;
  }

  const rosterMember = await prisma.teamRosterMember.findUnique({
    where: {
      organizationId_id: {
        organizationId: membership.organizationId,
        id: session.user.id,
      },
    },
    select: {
      roleId: true,
    },
  });

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: isBootstrapAdminEmail(session.user.email) ? "owner" : normalizeAccountRoleId(rosterMember?.roleId ?? membership.role),
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
  };
}

export async function getCurrentUserFromSignedCookie(): Promise<CurrentUser | undefined> {
  const cookieStore = await cookies();
  const payload = parseSessionCookie(cookieStore.get(sessionCookieName)?.value);

  if (!payload || new Date(payload.expiresAt).getTime() <= Date.now()) {
    return undefined;
  }

  if (payload.driver !== getAuthDriver()) {
    return undefined;
  }

  if (payload.driver === "local") {
    return payload.localUser
      ? {
          ...payload.localUser,
          role: normalizeAccountRoleId(payload.localUser.role),
        }
      : undefined;
  }

  if (!payload.sessionUser) {
    return undefined;
  }

  return {
    id: payload.sessionUser.id,
    email: payload.sessionUser.email,
    name: payload.sessionUser.name,
    role: isBootstrapAdminEmail(payload.sessionUser.email) ? "owner" : normalizeAccountRoleId(payload.sessionUser.role),
    organizationId: payload.sessionUser.organizationId,
    organizationName: payload.sessionUser.organizationName,
  };
}
