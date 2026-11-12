import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "@/app/api/operations/sync-center/route";
import { createLocalSession } from "@/lib/auth/session";

test("sync center requires authentication before reading state or accepting task/credential changes", async () => {
  assert.equal((await GET(new Request("http://localhost/api/operations/sync-center"))).status, 401);
  assert.equal((await GET(new Request("http://localhost/api/operations/sync-center?section=report-attribution-preview&sourceId=foreign-source"))).status, 401);
  assert.equal((await POST(new Request("http://localhost/api/operations/sync-center", { method: "POST", body: JSON.stringify({ action: "run", sourceIds: ["other-tenant"] }) }))).status, 401);
});
test("feature gating fails closed and never reports successful persistence without a database", async () => {
  const env = { url: process.env.DATABASE_URL, driver: process.env.AUTH_DRIVER, scopes: process.env.AMAZON_SYNC_CENTER_SCOPES };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local"; process.env.AMAZON_SYNC_CENTER_SCOPES = "[]";
  try {
    const session = await createLocalSession({ id: "sync-actor", organizationId: "sync-org", organizationName: "fixture", role: "owner", email: "sync@example.invalid", name: "fixture" });
    const headers = { cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}`, "content-type": "application/json" };
    const request = () => new Request("http://localhost/api/operations/sync-center", { headers });
    const disabled = await GET(request()); assert.equal(disabled.status, 409); assert.equal((await disabled.json()).code, "SYNC_CENTER_DISABLED");
    process.env.AMAZON_SYNC_CENTER_SCOPES = '[["sync-org","default"]]'; assert.equal((await GET(request())).status, 503);
    const post = await POST(new Request("http://localhost/api/operations/sync-center", { method: "POST", headers, body: JSON.stringify({ action: "save-authorization", refreshToken: "fixture-sensitive" }) }));
    assert.equal(post.status, 503); assert.ok(!(await post.text()).includes("fixture-sensitive"));
  } finally {
    for (const [key, value] of [["DATABASE_URL", env.url], ["AUTH_DRIVER", env.driver], ["AMAZON_SYNC_CENTER_SCOPES", env.scopes]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; }
  }
});
