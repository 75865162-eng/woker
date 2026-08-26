import { createHash, createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { getAuthDriver, sessionCookieName, sessionMaxAgeSeconds } from "@/lib/auth/constants";
import { rolePermissionsCookieName } from "@/lib/accounts/permissions";
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

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  organizationName: string;
};

export type AuthCookie = {
  name: string;
  value: string;
  options: {
    httpOnly?: boolean;
    sameSite?: "lax" | "strict" | "none";
    secure?: boolean;
    maxAge?: number;
    path?: string;
  };
};

export function isSecureRequest(request: Request) {
  try {
    const url = new URL(request.url);
    const hostname = url.hostname;
    const isTemporaryIpHost =
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.endsWith(".sslip.io") || hostname === "localhost" || hostname === "127.0.0.1";

    if (isTemporaryIpHost) {
      return false;
    }

    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

    if (forwardedProto) {
      return forwardedProto === "https";
    }

    return url.protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;

  if (!secret || secret === "change-this-local-secret-before-production") {
    if (process.env.NODE_ENV === "production" && getAuthDriver() === "database") {
      throw new Error("AUTH_SECRET must be set before production use.");
    }
  }

  return secret || "local-development-auth-secret";
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

function getRequestCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return undefined;
  }

  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

async function getCurrentUserFromPayload(payload: SessionPayload): Promise<CurrentUser | undefined> {
  if (new Date(payload.expiresAt).getTime() <= Date.now()) {
    return undefined;
  }

  if (payload.driver === "local") {
    return payload.localUser;
  }

  if (payload.driver !== getAuthDriver()) {
    return undefined;
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

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: membership.role,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
  };
}

export async function createSession(userId: string, sessionUser?: CurrentUser, secureCookie = process.env.NODE_ENV === "production") {
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
  const sessionCookieOptions: AuthCookie["options"] = {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    maxAge: sessionMaxAgeSeconds,
    path: "/",
  };
  const sessionCookie: AuthCookie = {
    name: sessionCookieName,
    value: signedCookie,
    options: sessionCookieOptions,
  };

  let rolePermissionsCookie: AuthCookie | undefined;
  if (sessionUser?.organizationId) {
    const rolePermissions = await getOrganizationRolePermissions(sessionUser.organizationId);

    rolePermissionsCookie = {
      name: rolePermissionsCookieName,
      value: encodeURIComponent(JSON.stringify(rolePermissions)),
      options: {
        sameSite: "lax",
        secure: secureCookie,
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
      },
    };
  }

  return { session, sessionCookie, rolePermissionsCookie };
}

export async function createLocalSession(user: CurrentUser, secureCookie = process.env.NODE_ENV === "production") {
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
  const sessionCookieOptions: AuthCookie["options"] = {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    maxAge: sessionMaxAgeSeconds,
    path: "/",
  };
  return {
    sessionCookie: {
      name: sessionCookieName,
      value: `${payload}.${signPayload(payload)}`,
      options: sessionCookieOptions,
    },
  };
}

export async function destroyCurrentSession() {
  const cookieStore = await cookies();
  const payload = parseSessionCookie(cookieStore.get(sessionCookieName)?.value);

  if (payload && payload.driver !== "local" && getAuthDriver() === "database") {
    await prisma.userSession.deleteMany({
      where: {
        id: payload.sessionId,
        userId: payload.userId,
      },
    });
  }

  cookieStore.delete(sessionCookieName);
  cookieStore.delete(rolePermissionsCookieName);
}

export async function getCurrentUser(): Promise<CurrentUser | undefined> {
  const cookieStore = await cookies();
  const payload = parseSessionCookie(cookieStore.get(sessionCookieName)?.value);

  if (!payload) {
    return undefined;
  }

  return getCurrentUserFromPayload(payload);
}

export async function getCurrentUserFromRequest(request: Request): Promise<CurrentUser | undefined> {
  const payload = parseSessionCookie(getRequestCookie(request, sessionCookieName));

  if (!payload) {
    return undefined;
  }

  return getCurrentUserFromPayload(payload);
}

export async function getCurrentUserFromSignedCookie(): Promise<CurrentUser | undefined> {
  const cookieStore = await cookies();
  const payload = parseSessionCookie(cookieStore.get(sessionCookieName)?.value);

  if (!payload || new Date(payload.expiresAt).getTime() <= Date.now()) {
    return undefined;
  }

  if (payload.driver === "local") {
    return payload.localUser;
  }

  if (payload.driver !== getAuthDriver()) {
    return undefined;
  }

  if (!payload.sessionUser) {
    return undefined;
  }

  return {
    id: payload.sessionUser.id,
    email: payload.sessionUser.email,
    name: payload.sessionUser.name,
    role: payload.sessionUser.role,
    organizationId: payload.sessionUser.organizationId,
    organizationName: payload.sessionUser.organizationName,
  };
}
