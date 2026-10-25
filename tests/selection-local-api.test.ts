import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { createLocalSession } from "@/lib/auth/session";
import { GET as list } from "@/app/api/agents/market/selection-slugs/route";
import { GET as local, POST as advanced } from "@/app/api/agents/market/selection-local/route";
import { POST as reviews } from "@/app/api/agents/market/selection-reviews/route";
import { POST as suppliers } from "@/app/api/agents/market/selection-suppliers/route";
import { writeJson } from "../scripts/selection-pipeline/src/io";

test("local APIs enforce login, roles, organization/workspace binding, bounded input and fresh write gates", async () => {
  const global = globalThis as unknown as { prisma?: PrismaClient }; const prior = global.prisma;
  const keys = ["DATABASE_URL", "SELECTION_ORGANIZATION_ID", "SELECTION_WORKSPACE_ID", "SELECTION_ACTOR_USER_ID", "SELECTION_ERP_URL", "SELECTION_ERP_COOKIE"] as const;
  const env = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  delete process.env.DATABASE_URL; process.env.SELECTION_ORGANIZATION_ID = "org"; process.env.SELECTION_WORKSPACE_ID = "workspace";
  process.env.SELECTION_ACTOR_USER_ID = "actor"; process.env.SELECTION_ERP_COOKIE = "private-cookie"; process.env.SELECTION_ERP_URL = "https://private.example.test";
  let databaseAccess = 0;
  global.prisma = {
    workspaceScope: { findUnique: async ({ where }: { where: { organizationId_id: { organizationId: string; id: string } } }) => where.organizationId_id.id === "workspace" ? { id: "workspace" } : null },
    organization: { findMany: async () => [{ id: "org" }] },
    organizationMember: { findUnique: async () => { databaseAccess++; throw new Error("MUST_NOT_WRITE"); } },
  } as unknown as PrismaClient;
  const slug = `web-api-test-${randomUUID()}`; const dir = path.resolve("selections", slug); const asin = "B012345678";
  try {
    await mkdir(path.join(dir, "raw"), { recursive: true });
    await writeJson(path.join(dir,"brief.json"), { keyword: "test cover" });
    await writeJson(path.join(dir,"raw/competitors.json"), [{ asin, title: "test", url: "", price: null, rating: null, reviewsCount: null }]);
    await writeJson(path.join(dir,"raw/collection-info.json"), { fixture: true });
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Test", role: "owner", email: "actor@example.test", name: "Actor" });
    const cookie = `${session.sessionCookie.name}=${session.sessionCookie.value}`;
    const headers = { "Content-Type": "application/octet-stream", "x-workspace-id": "workspace", cookie };
    const req = (value?: unknown, endpoint = "selection-local") => new Request(`http://localhost/api/agents/market/${endpoint}${value ? "" : `?slug=${slug}`}`, { method: value ? "POST" : "GET", headers, ...(value ? { body: JSON.stringify(value) } : {}) });
    const anonymous = req(); anonymous.headers.delete("cookie"); assert.equal((await local(anonymous)).status, 401);
    const viewer = await createLocalSession({ id: "viewer", organizationId: "org", organizationName: "Test", role: "viewer", email: "viewer@example.test", name: "Viewer" });
    const forbidden = req({ slug, rows: [] }); forbidden.headers.set("cookie", `${viewer.sessionCookie.name}=${viewer.sessionCookie.value}`);
    assert.equal((await reviews(forbidden)).status, 403);
    const badScope = req(); badScope.headers.set("x-workspace-id", "other"); assert.equal((await local(badScope)).status, 403);
    process.env.SELECTION_ORGANIZATION_ID = "foreign"; assert.equal((await local(req())).status, 403); process.env.SELECTION_ORGANIZATION_ID = "org";
    delete process.env.SELECTION_ORGANIZATION_ID; assert.equal((await local(req())).status, 200); process.env.SELECTION_ORGANIZATION_ID = "org";
    const snapshot = await local(req()); assert.equal(snapshot.status, 200);
    const text = JSON.stringify(await snapshot.json()); assert.ok(!text.includes("private-cookie")); assert.ok(!text.includes("private.example.test"));
    const oversized = req({ slug }); oversized.headers.set("content-length", String(2 * 1024 * 1024 + 1)); assert.equal((await reviews(oversized)).status, 413);
    const json = req({ slug }); json.headers.set("content-type", "application/json"); assert.equal((await reviews(json)).status, 415);
    const crossOrigin = req({ slug }); crossOrigin.headers.set("origin", "https://foreign.test"); assert.equal((await reviews(crossOrigin)).status, 403);
    assert.equal((await reviews(req({ slug, rows: [{ asin, star: 5, date: "", text: "bad" }] }))).status, 400);
    assert.equal((await reviews(req({ slug, rows: [{ asin, star: 2, date: "", text: "Material is thin and leaks water." }] }))).status, 200);
    const supplierRows = [781234567891, 781234567892, 781234567893].map(id => ({ title: "Test only", url: `https://detail.1688.com/offer/${id}.html` }));
    assert.equal((await suppliers(req({ slug, rows: supplierRows.slice(0,2) }))).status, 400);
    const saved = await suppliers(req({ slug, rows: supplierRows })); assert.equal(saved.status, 200); assert.equal((await saved.json()).quality.suppliers, 3);
    assert.ok((await readFile(path.join(dir, "derived/workbook.xlsx"))).length > 1000);
    assert.equal((await advanced(req({ slug, action: "create" }))).status, 400);
    assert.equal((await advanced(req({ slug, action: "upload", cookie: "do-not-store" }))).status, 400);
    assert.equal(databaseAccess, 0, "blocked quality must precede writes and uploader access");
    const listing = await list(req()); assert.equal(listing.status, 200); assert.ok((await listing.json()).slugs.some((s: { slug: string }) => s.slug === slug));
    const traversal = req(); const unsafe = new Request(traversal.url.replace(slug,"..%2Fescape"), { headers }); assert.equal((await local(unsafe)).status, 400);
  } finally {
    global.prisma = prior;
    for (const key of keys) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; }
    await rm(dir, { recursive: true, force: true });
  }
});
