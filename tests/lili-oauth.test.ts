import test from "node:test";
import assert from "node:assert/strict";
import { liliOAuthOrigin, liliOAuthMetadata, validRedirect } from "@/lib/lili/oauth";
import { GET } from "@/app/.well-known/[...parts]/route";
import { POST } from "@/app/api/lili/oauth/[action]/route";

test("OAuth accepts HTTPS and exact loopback redirects, refuses unsafe schemes and fragments", () => {
 for (const url of ["http://127.0.0.1:1234/callback", "http://[::1]:4567/callback", "https://client.example/callback"]) assert.equal(validRedirect(url), true);
 for (const url of ["javascript:alert(1)", "file:///tmp/token", "http://evil.example/callback", "https://a:b@client.example/callback", "https://client.example/cb#fragment"]) assert.equal(validRedirect(url), false);
});
test("OAuth metadata uses canonical origin, never trusts forwarded host, and advertises S256 only", async () => {
 const previous = process.env.LILI_PUBLIC_ORIGIN;
 try {
  delete process.env.LILI_PUBLIC_ORIGIN;
  assert.throws(() => liliOAuthOrigin(new Request("https://forged.example/")));
  const request = new Request("http://localhost:3017/", { headers: { "x-forwarded-host": "forged.example" } });
  assert.equal(liliOAuthOrigin(request), "http://localhost:3017");
  process.env.LILI_PUBLIC_ORIGIN = "https://erp.example";
  assert.equal(liliOAuthMetadata(request).issuer, "https://erp.example");
  assert.deepEqual(liliOAuthMetadata(request).code_challenge_methods_supported, ["S256"]);
  const response = await GET(request, { params: Promise.resolve({ parts: ["oauth-protected-resource", "api", "lili", "mcp"] }) });
  assert.equal((await response.json()).resource, "https://erp.example/api/lili/mcp");
 } finally { if (previous === undefined) delete process.env.LILI_PUBLIC_ORIGIN; else process.env.LILI_PUBLIC_ORIGIN = previous; }
});
test("OAuth routes reject foreign origins and duplicate form parameters before database access", async () => {
 const context = { params: Promise.resolve({ action: "token" }) };
 const foreign = new Request("http://localhost:3017/api/lili/oauth/token", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=refresh_token" });
 assert.equal((await POST(foreign, context)).status, 403);
 const duplicate = new Request("http://localhost:3017/api/lili/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "client_id=a&client_id=b" });
 assert.equal((await POST(duplicate, context)).status, 400);
});
