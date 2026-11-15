import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCsrf } from "@/lib/auth/csrf";
import { evaluateRateLimit, loginRateLimit, loginRateLimitKeys } from "@/lib/auth/login-rate-limit";

// Isolated: no .env loading, no database, no Redis connection, no fetch.

const base = {
  method: "POST",
  hasSessionCookie: true,
  origin: "https://erp.example.com",
  secFetchSite: "same-origin",
  expectedOrigin: "https://erp.example.com",
};

test("CSRF: GET and other safe methods are never blocked", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.deepEqual(evaluateCsrf({ ...base, method, origin: "https://evil.test", secFetchSite: "cross-site" }), { ok: true });
  }
});

test("CSRF: bearer/MCP requests without a session cookie stay unaffected", () => {
  assert.deepEqual(evaluateCsrf({ ...base, hasSessionCookie: false, origin: "https://evil.test", secFetchSite: "cross-site" }), { ok: true });
});

test("CSRF: cross-site Sec-Fetch-Site is rejected even with a matching Origin", () => {
  const result = evaluateCsrf({ ...base, secFetchSite: "cross-site" });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /cross-site/);
});

test("CSRF: foreign, opaque and malformed origins are rejected", () => {
  for (const origin of ["https://evil.test", "https://erp.example.com.evil.test", "null", "not-a-url"]) {
    const result = evaluateCsrf({ ...base, origin, secFetchSite: "same-origin" });
    assert.equal(result.ok, false, `expected rejection for ${origin}`);
  }
});

test("CSRF: same host with explicit port and case differences is accepted", () => {
  assert.deepEqual(evaluateCsrf({ ...base, origin: "https://ERP.example.com:8443", expectedOrigin: "https://erp.example.com:8443" }), { ok: true });
  assert.deepEqual(evaluateCsrf({ ...base, secFetchSite: "same-site" }), { ok: true });
});

test("CSRF: non-browser clients with neither signal are allowed", () => {
  assert.deepEqual(evaluateCsrf({ ...base, origin: null, secFetchSite: null }), { ok: true });
});

test("rate limit: boundary is inclusive and Retry-After is derived from TTL", () => {
  assert.deepEqual(evaluateRateLimit(loginRateLimit.perIdentity, 60_000, loginRateLimit.perIdentity, loginRateLimit.windowSeconds), { allowed: true, retryAfterSeconds: 0 });
  const blocked = evaluateRateLimit(loginRateLimit.perIdentity + 1, 60_000, loginRateLimit.perIdentity, loginRateLimit.windowSeconds);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
});

test("rate limit: expired/negative TTL falls back to a full window and never returns zero", () => {
  const blocked = evaluateRateLimit(999, -2, 5, loginRateLimit.windowSeconds);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, loginRateLimit.windowSeconds);
  assert.ok(evaluateRateLimit(999, 1, 5, loginRateLimit.windowSeconds).retryAfterSeconds >= 1);
});

test("rate limit keys are deterministic, scoped and never contain raw identifiers", () => {
  const first = loginRateLimitKeys("203.0.113.9", "Ops@Example.com");
  const second = loginRateLimitKeys("203.0.113.9", "Ops@Example.com");
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, loginRateLimitKeys("203.0.113.10", "Ops@Example.com"));
  assert.notEqual(first.identity, first.ip);
  const serialized = JSON.stringify(first);
  assert.ok(!serialized.includes("203.0.113.9"));
  assert.ok(!serialized.includes("Ops@Example.com"));
});
