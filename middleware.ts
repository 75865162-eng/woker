import { NextRequest, NextResponse } from "next/server";
import { getAuthDriver, publicApiPrefixes, publicRoutes, sessionCookieName } from "@/lib/auth/constants";
import {
  getModuleIdForPath,
  parseRolePermissionsCookie,
  roleCanAccessModule,
  rolePermissionsCookieName,
} from "@/lib/accounts/permissions";

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

function getPublicOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.split(",")[0]?.trim() || request.nextUrl.host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || request.nextUrl.protocol.replace(":", "");

  return `${protocol}://${host}`;
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

    return Boolean(
      (parsed.driver === "local" || parsed.driver === getAuthDriver()) &&
        parsed.expiresAt &&
        new Date(parsed.expiresAt).getTime() > Date.now(),
    );
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

    return parsed.localUser?.role ?? parsed.sessionUser?.role;
  } catch {
    return undefined;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const publicOrigin = getPublicOrigin(request);
  const isPublicRoute = publicRoutes.includes(pathname);
  const isPublicApi = publicApiPrefixes.some((prefix) => pathname.startsWith(prefix));

  if (isPublicRoute || isPublicApi) {
    return NextResponse.next();
  }

  const validSession = await hasValidSessionCookie(request);

  if (validSession) {
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/", publicOrigin));
    }

    if (pathname !== "/forbidden" && !pathname.startsWith("/api/")) {
      const role = parseSessionRole(request);
      const rolePermissions = parseRolePermissionsCookie(request.cookies.get(rolePermissionsCookieName)?.value);
      const moduleId = pathname === "/" ? null : getModuleIdForPath(pathname);
      const canOpenRequestedPage = pathname === "/" ? true : roleCanAccessModule(role, moduleId, rolePermissions);

      if (!canOpenRequestedPage) {
        return NextResponse.redirect(new URL("/forbidden", publicOrigin));
      }
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-current-path", pathname);

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const loginUrl = new URL("/login", publicOrigin);
  loginUrl.searchParams.set("next", pathname);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|brand-logo.png).*)"],
};
