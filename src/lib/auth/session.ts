import { createHash, createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { getAuthDriver, sessionCookieName, sessionMaxAgeSeconds } from "@/lib/auth/constants";

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

export async function createSession(userId: string, sessionUser?: CurrentUser) {
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
  const cookieStore = await cookies();

  cookieStore.set(sessionCookieName, signedCookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionMaxAgeSeconds,
    path: "/",
  });

  return session;
}

export async function createLocalSession(user: CurrentUser) {
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
  const cookieStore = await cookies();

  cookieStore.set(sessionCookieName, `${payload}.${signPayload(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionMaxAgeSeconds,
    path: "/",
  });
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
}

export async function getCurrentUser(): Promise<CurrentUser | undefined> {
  const cookieStore = await cookies();
  const payload = parseSessionCookie(cookieStore.get(sessionCookieName)?.value);

  if (!payload || new Date(payload.expiresAt).getTime() <= Date.now()) {
    return undefined;
  }

  if (payload.driver === "local" || getAuthDriver() === "local") {
    return payload.localUser;
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

export async function getCurrentUserFromSignedCookie(): Promise<CurrentUser | undefined> {
  const cookieStore = await cookies();
  const payload = parseSessionCookie(cookieStore.get(sessionCookieName)?.value);

  if (!payload || new Date(payload.expiresAt).getTime() <= Date.now()) {
    return undefined;
  }

  if (payload.driver === "local" || getAuthDriver() === "local") {
    return payload.localUser;
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
