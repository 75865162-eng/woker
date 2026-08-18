import { NextRequest, NextResponse } from "next/server";
import { getAuthDriver, publicApiPrefixes, publicRoutes, sessionCookieName } from "@/lib/auth/constants";
import {
  getModuleIdForPath,
  parseRolePermissionsCookie,
  roleCanAccessModule,
  rolePermissionsCookieName,
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

function buildExternalUrl(request: NextRequest, pathname: string) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(/:$/, "");
  const url = new URL(`${proto}://${host}`);
  url.pathname = pathname;

  return url;
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
      return NextResponse.redirect(buildExternalUrl(request, "/"));
    }

    if (pathname !== "/forbidden" && !pathname.startsWith("/api/")) {
      const role = normalizeAccountRoleId(parseSessionRole(request));

      if (!role) {
        const loginUrl = buildExternalUrl(request, "/login");
        loginUrl.searchParams.set("next", pathname);

        return NextResponse.redirect(loginUrl);
      }

      const rolePermissions = parseRolePermissionsCookie(request.cookies.get(rolePermissionsCookieName)?.value);
      const moduleId = pathname === "/" ? null : getModuleIdForPath(pathname);
      const canOpenRequestedPage = pathname === "/" ? true : roleCanAccessModule(role, moduleId, rolePermissions);

      if (!canOpenRequestedPage) {
        return NextResponse.redirect(buildExternalUrl(request, "/forbidden"));
      }
    }

    return buildNextResponse(request);
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const loginUrl = buildExternalUrl(request, "/login");
  loginUrl.searchParams.set("next", pathname);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|brand-logo.png).*)"],
};
