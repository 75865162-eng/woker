import { NextRequest, NextResponse } from "next/server";
import { getAuthDriver, publicApiPrefixes, publicRoutes, sessionCookieName } from "@/lib/auth/constants";
import {
  getModuleIdForPath,
  parseRolePermissionsCookie,
  roleCanAccessModule,
  rolePermissionsCookieName,
  type RolePermissionMap,
} from "@/lib/accounts/permissions";
import { normalizeAccountRoleId } from "@/lib/accounts/team-roster";

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function verifySignature(payload: string, signature: string) {
  const secret = process.env.AUTH_SECRET || "local-development-auth-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  return crypto.subtle.verify("HMAC", key, base64UrlToBytes(signature), new TextEncoder().encode(payload));
}

async function hasValidSessionCookie(request: NextRequest) {
  const cookie = request.cookies.get(sessionCookieName)?.value;

  if (!cookie) {
    return false;
  }

  const [payload, signature] = cookie.split(".");

  if (!payload || !signature || !(await verifySignature(payload, signature))) {
    return false;
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as { driver?: "database" | "local"; expiresAt?: string };

    return Boolean(parsed.driver === getAuthDriver() && parsed.expiresAt && new Date(parsed.expiresAt).getTime() > Date.now());
  } catch {
    return false;
  }
}

function parseSessionRole(request: NextRequest) {
  const cookie = request.cookies.get(sessionCookieName)?.value;
  const [payload] = cookie?.split(".") ?? [];

  if (!payload) return undefined;

  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as {
      localUser?: { role?: string };
      sessionUser?: { role?: string };
    };

    return normalizeAccountRoleId(parsed.localUser?.role ?? parsed.sessionUser?.role);
  } catch {
    return undefined;
  }
}

type MiddlewareCurrentUser = {
  role?: string;
};

async function loadCurrentUserFromApi(request: NextRequest): Promise<MiddlewareCurrentUser | null> {
  try {
    const response = await fetch(new URL("/api/auth/me", request.url), {
      cache: "no-store",
      headers: {
        cookie: request.headers.get("cookie") ?? "",
      },
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { user?: MiddlewareCurrentUser | null };

    return payload.user ?? null;
  } catch {
    return null;
  }
}

async function loadLatestRolePermissions(request: NextRequest): Promise<RolePermissionMap | null> {
  try {
    const response = await fetch(new URL("/api/accounts/role-permissions", request.url), {
      cache: "no-store",
      headers: {
        cookie: request.headers.get("cookie") ?? "",
      },
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { permissions?: RolePermissionMap };

    return payload.permissions ?? null;
  } catch {
    return null;
  }
}

function buildNextResponse(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const { pathname } = request.nextUrl;
  requestHeaders.set("x-current-path", pathname);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicRoute = publicRoutes.includes(pathname);
  const isPublicApi = publicApiPrefixes.some((prefix) => pathname.startsWith(prefix));

  if (isPublicRoute || isPublicApi) {
    return NextResponse.next();
  }

  const validSession = await hasValidSessionCookie(request);

  if (validSession) {
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }

    if (pathname !== "/forbidden" && !pathname.startsWith("/api/")) {
      const currentUser = await loadCurrentUserFromApi(request);

      if (!currentUser) {
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("next", pathname);

        return NextResponse.redirect(loginUrl);
      }

      const role = normalizeAccountRoleId(currentUser.role ?? parseSessionRole(request));
      const rolePermissions = parseRolePermissionsCookie(request.cookies.get(rolePermissionsCookieName)?.value);
      const moduleId = pathname === "/" ? null : getModuleIdForPath(pathname);
      const latestRolePermissions = await loadLatestRolePermissions(request);
      const effectiveRolePermissions = latestRolePermissions ?? rolePermissions;
      const canOpenRequestedPage = pathname === "/" ? true : roleCanAccessModule(role, moduleId, effectiveRolePermissions);

      if (!canOpenRequestedPage) {
        return NextResponse.redirect(new URL("/forbidden", request.url));
      }

      if (latestRolePermissions) {
        const response = buildNextResponse(request);

        response.cookies.set(rolePermissionsCookieName, encodeURIComponent(JSON.stringify(latestRolePermissions)), {
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          maxAge: 60 * 60 * 24 * 365,
          path: "/",
        });

        return response;
      }
    }

    return buildNextResponse(request);
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|brand-logo.png).*)"],
};
