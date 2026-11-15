/**
 * Browser CSRF guard for cookie-authenticated, state-changing requests.
 *
 * Only requests that actually carry the session cookie are checked: bearer-token
 * MCP / OAuth / integration clients never carry it and must stay unaffected.
 * A browser cross-site form/fetch always sends either `Sec-Fetch-Site: cross-site`
 * or a foreign `Origin`, so both signals are enforced. Requests with neither
 * signal are non-browser clients (curl, server-to-server) and are allowed.
 */

export type CsrfInput = {
  method: string;
  hasSessionCookie: boolean;
  origin?: string | null;
  secFetchSite?: string | null;
  /** 可信来源，包含协议、主机和端口。 */
  expectedOrigin: string;
};

export type CsrfResult = { ok: true } | { ok: false; reason: string };

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function evaluateCsrf(input: CsrfInput): CsrfResult {
  if (!stateChangingMethods.has(input.method.toUpperCase())) return { ok: true };
  if (!input.hasSessionCookie) return { ok: true };

  const secFetchSite = (input.secFetchSite ?? "").trim().toLowerCase();
  if (secFetchSite === "cross-site") return { ok: false, reason: "cross-site request" };

  const origin = (input.origin ?? "").trim();
  if (origin) {
    if (origin === "null") return { ok: false, reason: "opaque origin" };
    try {
      const parsed = new URL(origin);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
        return { ok: false, reason: "malformed origin" };
      }
      if (parsed.origin !== new URL(input.expectedOrigin).origin) {
        return { ok: false, reason: "origin mismatch" };
      }
    } catch {
      return { ok: false, reason: "malformed origin" };
    }
  }

  return { ok: true };
}
