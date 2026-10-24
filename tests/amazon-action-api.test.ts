import assert from "node:assert/strict";
import test from "node:test";
import { POST as preview } from "@/app/api/agents/ppc/actions/route";
import { POST as confirm } from "@/app/api/agents/approvals/[approvalId]/route";
import { POST as apply } from "@/app/api/agents/ppc/audits/[auditId]/apply/route";
import { GET as list } from "@/app/api/agents/ppc/audits/route";
import { GET as detail } from "@/app/api/agents/ppc/audits/[auditId]/route";
import { createLocalSession } from "@/lib/auth/session";

test("all Amazon preview/confirm/apply/audit routes require authenticated module permissions", async () => {
  const request = () => new Request("http://localhost/api/test", { method: "POST", body: "{}" });
  const responses = await Promise.all([preview(request()), confirm(request(), { params: Promise.resolve({ approvalId: "approval" }) }), apply(request(), { params: Promise.resolve({ auditId: "audit" }) }), list(new Request("http://localhost/api/test")), detail(new Request("http://localhost/api/test"), { params: Promise.resolve({ auditId: "audit" }) })]);
  assert.deepEqual(responses.map((response) => response.status), [401, 401, 401, 401, 401]);
});
test("Amazon preview refuses an in-memory success without a configured audit database", async () => {
  const previous = process.env.DATABASE_URL; const driver = process.env.AUTH_DRIVER;
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "ERP", role: "owner", email: "actor@example.test", name: "Actor" });
    const response = await preview(new Request("http://localhost/api/agents/ppc/actions", { method: "POST", headers: { "Content-Type": "application/json", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` }, body: JSON.stringify({ actionTarget: "amazon.ads.apply", report: {}, idempotencyKey: "preview-api-key" }) }));
    assert.equal(response.status, 503); assert.equal((await response.json()).code, "AUDIT_DATABASE_REQUIRED");
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    if (driver === undefined) delete process.env.AUTH_DRIVER; else process.env.AUTH_DRIVER = driver;
  }
});
