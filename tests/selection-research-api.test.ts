import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { createLocalSession } from "@/lib/auth/session";
import { GET, POST } from "@/app/api/selection-research/[id]/route";
import { GET as report } from "@/app/api/selection-research/[id]/report/route";
import { POST as create } from "@/app/api/selection-research/route";
import { GET as savedReport } from "@/app/api/selection-research/[id]/report/[fileId]/route";
import { localStorageDriver } from "@/lib/storage/local-storage";
import { SKILLS, type Run } from "@/lib/selection-research/types";

test("real Next handlers enforce session/scope, reject unconfigured live, serialize decisions and retain both gates using a mock Prisma client", async () => {
  const previousUrl = process.env.DATABASE_URL;
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previousClient = globals.prisma;
  const previousStorage = process.env.STORAGE_DRIVER;
  const previousReadBuffer = localStorageDriver.getBuffer;
  process.env.STORAGE_DRIVER = "local";
  delete process.env.DATABASE_URL;
  const session = await createLocalSession({ id: "fixture-owner", organizationId: "fixture-org", organizationName: "Fixture", role: "owner", email: "fixture@example.test", name: "Fixture" });
  const other = await createLocalSession({ id: "fixture-other", organizationId: "fixture-org", organizationName: "Fixture", role: "owner", email: "other@example.test", name: "Fixture" });
  const run: Run = { version: 1, id: "fixture-run", revision: 0, scope: { organizationId: "fixture-org", workspaceId: "fixture-workspace", ownerId: "fixture-owner" }, requirement: "isolated API verification", marketplace: "US", mode: "fixture", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "WAITING_FOR_USER", stage: 1,
    skills: SKILLS.map((name) => ({ name, path: "fixture", sha256: "fixture", markdown: "fixture", tools: [] })), registry: [], policies: {}, limits: {}, calls: [], actions: [], results: [{ summary: "fixture only", claims: [{ text: "unverified", kind: "assumption", evidenceIds: [] }], candidates: [1, 2, 3].map((id) => ({ id: String(id), name: `fixture ${id}` })) }], gate: { id: "gate-niche", kind: "NICHE", reason: "fixture" }, decisions: [] };
  let row = { output: structuredClone(run), context: { namespace: "selection-research-v1", version: "v0", leaseId: null as string | null, leaseUntil: 0 } };
  let writes = 0;
  let fileReads = 0;
  let foundFile: Record<string, unknown> | undefined;
  localStorageDriver.getBuffer = async () => { fileReads++; return Buffer.from("isolated report"); };
  globals.prisma = {
    workspaceScope: { findUnique: async ({ where }: { where: { organizationId_id: { id: string } } }) => where.organizationId_id.id === "fixture-workspace" ? { id: "fixture-workspace" } : null },
    agentExecution: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string; workspaceId: string; requestedByUserId: string } }) => where.id === run.id && where.organizationId === run.scope.organizationId && where.workspaceId === run.scope.workspaceId && where.requestedByUserId === run.scope.ownerId ? structuredClone(row) : null,
      updateMany: async ({ where, data }: { where: { AND: { context: { equals: string } }[] }; data: { output: Run; context: typeof row.context } }) => {
        if (where.AND[0].context.equals !== row.context.version) return { count: 0 };
        writes++; row = structuredClone({ output: data.output, context: data.context }); return { count: 1 };
      },
    },
    fileObject: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      if (where.id === "isolated-file" && where.organizationId === run.scope.organizationId && where.workspaceId === run.scope.workspaceId && where.userId === run.scope.ownerId) return foundFile;
      return null;
    } },
  } as unknown as PrismaClient;
  const request = (body?: unknown, options: { anonymous?: boolean; other?: boolean; workspace?: string } = {}) => new Request("http://localhost/api/selection-research/fixture-run", {
    method: body ? "POST" : "GET", headers: { ...(body ? { "Content-Type": "application/json" } : {}), "x-workspace-id": options.workspace ?? "fixture-workspace", ...(options.anonymous ? {} : { cookie: `${session.sessionCookie.name}=${options.other ? other.sessionCookie.value : session.sessionCookie.value}` }) }, body: body ? JSON.stringify(body) : undefined,
  });
  const context = { params: Promise.resolve({ id: run.id }) };
  try {
    assert.equal((await GET(request(undefined, { anonymous: true }), context)).status, 401);
    assert.equal((await GET(request(undefined, { other: true }), context)).status, 404);
    assert.equal((await GET(request(undefined, { workspace: "forbidden" }), context)).status, 403);
    assert.equal((await create(request({ mode: "live", requirement: "fixture", marketplace: "US", approved: true }))).status, 409);
    assert.equal((await report(request(), context)).status, 409);
    assert.equal((await POST(request({ operation: "step", approved: true, status: "COMPLETED" }), context)).status, 200);
    assert.equal(row.output.status, "WAITING_FOR_USER"); assert.equal(row.output.stage, 1);
    assert.equal((await POST(request({ operation: "decide", decision: { kind: "CONFIRM", gateId: "gate-niche" } }), context)).status, 409);
    assert.equal(row.output.status, "WAITING_FOR_USER");
    assert.equal((await POST(request({ operation: "decide", decision: { kind: "SELECT", candidateId: "2", gateId: "gate-niche" } }), context)).status, 200);
    assert.equal(row.output.stage, 2); assert.equal(row.output.selectedCandidateId, "2"); assert.equal(row.output.decisions[0].actorId, "fixture-owner");
    assert.equal((await POST(request({ operation: "decide", decision: { kind: "SELECT", candidateId: "2", gateId: "gate-niche" } }), context)).status, 409);
    assert.equal((await report(request(), context)).status, 409);
    assert.ok(writes > 0); assert.equal(row.context.leaseId, null);
    row.output.status = "COMPLETED";
    row.output.report = { fileId: "isolated-file", savedAt: new Date().toISOString() };
    foundFile = { id: "isolated-file", storageKey: `selection-research/${run.scope.organizationId}/${run.scope.workspaceId}/${run.id}/isolated.html`, originalName: `selection-research-${run.id}.html` };
    const savedContext = { params: Promise.resolve({ id: run.id, fileId: "isolated-file" }) };
    assert.equal((await savedReport(request(undefined, { anonymous: true }), savedContext)).status, 401);
    assert.equal((await savedReport(request(undefined, { workspace: "forbidden" }), savedContext)).status, 403);
    assert.equal((await savedReport(request(undefined, { other: true }), savedContext)).status, 404);
    assert.equal(fileReads, 0);
    const exported = await savedReport(request(), savedContext);
    assert.equal(exported.status, 200); assert.equal(await exported.text(), "isolated report");
    assert.equal(fileReads, 1); assert.match(exported.headers.get("content-security-policy")!, /sandbox/);
    assert.equal((await savedReport(request(), { params: Promise.resolve({ id: run.id, fileId: "different-file" }) })).status, 404);
    assert.equal(fileReads, 1);
  } finally {
    globals.prisma = previousClient;
    localStorageDriver.getBuffer = previousReadBuffer;
    if (previousStorage === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = previousStorage;
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  }
});
