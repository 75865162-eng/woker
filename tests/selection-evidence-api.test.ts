import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import sample from "./fixtures/selection/evidence.json";
import { POST as upload } from "@/app/api/agents/market/selection-evidence/route";
import { createLocalSession } from "@/lib/auth/session";
import { localStorageDriver } from "@/lib/storage/local-storage";
import { selectionEvidenceLoader } from "@/lib/agent-platform/selection-evidence-server";

test("scoped upload and read sanitize research fields, reject unauthorized/oversize/fixture data and clean failed writes", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const prior = globals.prisma;
  const env = { database: process.env.DATABASE_URL, storage: process.env.STORAGE_DRIVER };
  delete process.env.DATABASE_URL; process.env.STORAGE_DRIVER = "local";
  const storage = { ...localStorageDriver };
  const objects = new Map<string, Buffer>();
  let file: Record<string, unknown> | null = null;
  let failDb = false, reads = 0;
  localStorageDriver.putBuffer = async ({ key, buffer }) => { objects.set(key, buffer); return { key, size: buffer.length }; };
  localStorageDriver.getBuffer = async (key) => { reads++; return objects.get(key)!; };
  localStorageDriver.delete = async (key) => { objects.delete(key); };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "workspace" }) },
    fileObject: {
      create: async ({ data }: { data: Record<string, unknown> }) => { assert.equal(data.organizationId, "org"); assert.equal(data.workspaceId, "workspace"); if (failDb) throw new Error("private failure"); file = { ...data, id: "file" }; return file; },
      findFirst: async ({ where }: { where: { id: string; organizationId: string; workspaceId: string } }) => file?.id === where.id && file?.organizationId === where.organizationId && file?.workspaceId === where.workspaceId ? file : null,
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Test", role: "owner", email: "actor@example.test", name: "Actor" });
    const headers = { "Content-Type": "application/octet-stream", "x-workspace-id": "workspace", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` };
    const request = (body: unknown) => new Request("http://localhost/api/agents/market/selection-evidence", { method: "POST", headers, body: JSON.stringify(body) });
    const unauthorized = new Request("http://localhost/api/agents/market/selection-evidence", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: "{}" });
    assert.equal((await upload(unauthorized)).status, 401);
    const viewer = await createLocalSession({ id: "viewer", organizationId: "org", organizationName: "Test", role: "viewer", email: "viewer@example.test", name: "Viewer" });
    const viewerRequest = request(sample);
    viewerRequest.headers.set("cookie", `${viewer.sessionCookie.name}=${viewer.sessionCookie.value}`);
    assert.equal((await upload(viewerRequest)).status, 403);
    assert.equal((await upload(request({ ...sample, fixture: true }))).status, 400);
    const over = request(sample); over.headers.set("content-length", String(2 * 1024 * 1024 + 1));
    assert.equal((await upload(over)).status, 413);
    assert.equal((await upload(new Request("http://localhost/api/agents/market/selection-evidence", {
      method: "POST", headers, body: " ".repeat(2 * 1024 * 1024 + 1),
    }))).status, 413);
    assert.equal(objects.size, 0);
    const accepted = await upload(request({ ...sample, product: { secret: "discard", imageFileId: "foreign" }, localPath: "/private" }));
    assert.equal(accepted.status, 201);
    const body = await accepted.json(); assert.equal(body.fileId, "file");
    assert.equal(objects.size, 1);
    const saved = JSON.parse([...objects.values()][0].toString());
    assert.equal(saved.product, undefined); assert.equal(saved.localPath, undefined);
    const loader = selectionEvidenceLoader({ organizationId: "org", workspaceId: "workspace" });
    const loaded = await loader("file"); assert.equal(loaded.source.sha256, body.sha256);
    assert.equal(reads, 1);
    await assert.rejects(selectionEvidenceLoader({ organizationId: "foreign", workspaceId: "workspace" })("file"));
    await assert.rejects(selectionEvidenceLoader({ organizationId: "org", workspaceId: "foreign" })("file"));
    assert.equal(reads, 1, "cross-scope denial must precede binary reads");
    failDb = true;
    const failed = await upload(request(sample));
    assert.equal(failed.status, 500);
    assert.ok(!JSON.stringify(await failed.json()).includes("private failure"));
    assert.equal(objects.size, 1, "failed create removes only its new object");
  } finally {
    globals.prisma = prior; Object.assign(localStorageDriver, storage);
    if (env.database === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = env.database;
    if (env.storage === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = env.storage;
  }
});
