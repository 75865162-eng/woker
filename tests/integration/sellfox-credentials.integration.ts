import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/prisma";
import { saveSellfoxCredentials, resolveSellfoxCredentials, getSellfoxCredentialStatus } from "@/lib/sellfox/credential-store";
import { withSellfoxCredentialScope } from "@/lib/sellfox/credential-context";
import { sellfoxPost, closeSellfoxClient } from "@/lib/sellfox/client";

test("disposable PG: migration, encrypted save, CAS, tenant isolation, audit rollback and scoped worker transport", async () => {
  assert.equal(process.env.SELLFOX_CREDENTIAL_TEST_DISPOSABLE, "1");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/sellfox_credentials_test");
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Real network forbidden in credential save"); };
  const scope = { organizationId: "credential-fixture-org", workspaceId: "fixture-a" };
  const other = { ...scope, workspaceId: "fixture-b" };
  const credentials = { clientId: "fixture-id-a", clientSecret: "fixture-secret-a" };
  try {
    await prisma.organization.create({ data: { id: scope.organizationId, name: "Fixture", slug: "credential-fixture" } });
    await prisma.user.create({ data: { id: "fixture-owner", name: "Fixture", email: "fixture-owner@example.test", passwordHash: "fixture-not-a-password" } });
    await prisma.organizationMember.create({ data: { organizationId: scope.organizationId, userId: "fixture-owner", role: "owner" } });
    for (const s of [scope, other]) await prisma.workspaceScope.create({ data: { organizationId: s.organizationId, id: s.workspaceId, name: s.workspaceId } });
    await saveSellfoxCredentials(scope, "fixture-owner", credentials, 0);
    const row = await prisma.sellfoxIntegrationCredential.findUniqueOrThrow({ where: { organizationId_workspaceId: scope } });
    assert.doesNotMatch(row.credentialsCiphertext, /fixture-id-a|fixture-secret-a/);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "sellfox.credentials.saved" } });
    assert.doesNotMatch(JSON.stringify(audit.metadata), /fixture-id-a|fixture-secret-a|credentialsCiphertext/);
    const results = await Promise.allSettled([
      saveSellfoxCredentials(scope, "fixture-owner", { clientId: "fixture-revision-a", clientSecret: "" }, 1),
      saveSellfoxCredentials(scope, "fixture-owner", { clientId: "fixture-revision-b", clientSecret: "" }, 1),
    ]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.filter(r => r.status === "rejected").length, 1);
    assert.equal((await getSellfoxCredentialStatus(scope)).revision, 2);
    assert.equal((await resolveSellfoxCredentials(scope)).clientSecret, credentials.clientSecret);
    assert.equal((await getSellfoxCredentialStatus(other)).configured, false);
    await assert.rejects(() => saveSellfoxCredentials({ organizationId: "foreign", workspaceId: scope.workspaceId }, "fixture-owner", credentials, 0));
    await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: "fixture-owner" } }, data: { role: "viewer" } });
    await assert.rejects(() => saveSellfoxCredentials(scope, "fixture-owner", credentials, 2));
    await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: "fixture-owner" } }, data: { role: "owner" } });
    await prisma.$executeRawUnsafe(`CREATE FUNCTION fixture_reject_credential_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'sellfox.credentials.saved' THEN RAISE EXCEPTION 'fixture audit rejection'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER fixture_credential_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fixture_reject_credential_audit()');
    await assert.rejects(() => saveSellfoxCredentials(scope, "fixture-owner", credentials, 2));
    assert.equal((await getSellfoxCredentialStatus(scope)).revision, 2);
    await prisma.$executeRawUnsafe('DROP TRIGGER fixture_credential_audit_failure ON "AuditLog"');
    assert.equal(calls, 0);
    await saveSellfoxCredentials(other, "fixture-owner", { clientId: "fixture-id-b", clientSecret: "fixture-secret-b" }, 0);
    const tokens: string[] = [];
    globalThis.fetch = async input => {
      calls++;
      const request = new URL(String(input));
      const clientId = request.searchParams.get("client_id")!;
      if (request.pathname.includes("oauth")) { tokens.push(clientId); return Response.json({ data: { access_token: `token-${clientId}`, expires_in: 86_400_000 } }); }
      assert.equal(request.searchParams.get("access_token"), `token-${clientId}`);
      return Response.json({ data: { ok: true } });
    };
    await withSellfoxCredentialScope(scope, () => sellfoxPost("/api/fixture.json", {}));
    await withSellfoxCredentialScope(other, () => sellfoxPost("/api/fixture.json", {}));
    assert.equal(new Set(tokens).size, 2);
    await saveSellfoxCredentials(scope, "fixture-owner", { clientId: "fixture-rotated", clientSecret: "" }, 2);
    await withSellfoxCredentialScope(scope, () => sellfoxPost("/api/fixture.json", {}));
    assert.equal(tokens.at(-1), "fixture-rotated");
  } finally {
    globalThis.fetch = previousFetch;
    await closeSellfoxClient();
    await prisma.$disconnect();
  }
});
