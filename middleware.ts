import { NextRequest, NextResponse } from "next/server";
import { getAuthDriver, getAuthSecret, publicApiPrefixes, publicRoutes, sessionCookieName } from "@/lib/auth/constants";
import { evaluateCsrf } from "@/lib/auth/csrf";
import { getPublicOrigin } from "@/lib/auth/request-security";

// getAuthSecret is shared with the Node session signer (see constants.ts) so
// signing and verification can never diverge; production rejects weak secrets.

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function verifySignature(payload: string, signature: string) {
  const secret = getAuthSecret();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret || "local-development-auth-secret"),
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

    return Boolean(
      (parsed.driver === "local" || parsed.driver === getAuthDriver()) &&
        parsed.expiresAt &&
        new Date(parsed.expiresAt).getTime() > Date.now(),
    );
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let publicOrigin: string;
  try {
    publicOrigin = getPublicOrigin(request);
  } catch {
    return NextResponse.json({ error: "可信入口配置缺失或无效，服务暂不可用。" }, { status: 503 });
  }
  const isPublicRoute = publicRoutes.includes(pathname);
  const isPublicApi = publicApiPrefixes.some((prefix) => pathname.startsWith(prefix));

  // Browser-session bypass below is scoped to endpoints that carry their OWN
  // authentication (personal MCP bearer, OAuth2 token/pairing flow, or a
  // one-time device-pairing code). Requiring a browser cookie here would break
  // external MCP clients that never have one. Each handler remains responsible
  // for verifying its bearer/OAuth credentials and scoping private data; the
  // middleware only skips the cookie gate, never the endpoint's own auth.
  // This exact endpoint authenticates every request with its personal MCP bearer.
  // Requiring a browser session here prevents external MCP clients from reaching it.
  if (pathname === "/api/mcp/amazon") {
    return NextResponse.next();
  }
  // Read-only Sellfox MCP server: authenticates with its own sfmcp_ bearer.
  // `/api/mcp` stays as the legacy alias; both are bound to the sellfox provider.
  if (pathname === "/api/mcp/sellfox" || pathname === "/api/mcp") {
    return NextResponse.next();
  }
  // OAuth 2.0 endpoints and RFC 9728/8414 discovery documents must be reachable
  // before a browser session exists. They implement their own client registration,
  // authorization and token validation in @/lib/lili/oauth; the .well-known
  // documents are static metadata that disclose no private data.
  if (["/api/lili/oauth/authorize", "/api/lili/oauth/token", "/api/lili/oauth/register", "/api/lili/oauth/revoke", "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/lili/mcp"].includes(pathname)) return NextResponse.next();
  // Public MCP connection/Skill discovery requires no browser session. The
  // handler still authenticates every private-data operation; neighboring APIs stay protected.
  if ((pathname === "/api/lili/devices" && request.headers.has("authorization")) || pathname === "/api/lili/pair" || pathname === "/api/lili/mcp" || pathname === "/lili/api/mcp") {
    return NextResponse.next();
  }

  // CSRF: only cookie-authenticated state-changing requests are browser-forgable.
  // Bearer-token MCP/OAuth clients are exempted above and never carry this cookie.
  const csrf = evaluateCsrf({
    method: request.method,
    hasSessionCookie: request.cookies.has(sessionCookieName),
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    expectedOrigin: publicOrigin,
  });
  if (!csrf.ok) {
    return NextResponse.json({ error: "跨站请求已被拒绝。" }, { status: 403 });
  }

  if (isPublicRoute || isPublicApi) {
    return NextResponse.next();
  }

  const validSession = await hasValidSessionCookie(request);

  if (validSession) {
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/", publicOrigin));
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-current-path", pathname);

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  if (pathname.startsWith("/api/") || pathname.startsWith("/lili/api/")) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const loginUrl = new URL("/login", publicOrigin);
  loginUrl.searchParams.set("next", pathname === "/agents/selection-research" ? pathname + request.nextUrl.search : pathname);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|brand-logo.png).*)"],
};
