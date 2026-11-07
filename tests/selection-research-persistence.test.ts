import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { localStorageDriver } from "@/lib/storage/local-storage";
import { saveResearchReport } from "@/lib/selection-research/prisma-repository";
import { renderResearchReport } from "@/lib/selection-research/report";
import { storedResearchEngine } from "@/lib/selection-research/http";
import { SKILLS, type Run, type Store } from "@/lib/selection-research/types";

// Isolated file/Prisma doubles only; no credentials, external APIs or existing files are used.
test("report retries recover a saved FileObject after an interrupted task checkpoint and reject corrupt evidence", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = { prisma: globals.prisma, driver: process.env.STORAGE_DRIVER, database: process.env.DATABASE_URL, put: localStorageDriver.putBuffer, get: localStorageDriver.getBuffer, delete: localStorageDriver.delete };
  delete process.env.DATABASE_URL;
  process.env.STORAGE_DRIVER = "local";
  const approvedAt = "2026-01-02T03:04:05.000Z";
  const run: Run = {
    id: "isolated-report", version: 1, revision: 1, scope: { organizationId: "isolated-org", workspaceId: "isolated-workspace", ownerId: "isolated-owner" },
    asin: "B000000001", requirement: "Isolated report persistence verification; no market facts", marketplace: "US", mode: "fixture", stage: 5, status: "COMPLETED", createdAt: approvedAt, updatedAt: approvedAt,
    skills: SKILLS.map(name => ({ name, path: "isolated", markdown: "isolated", sha256: "isolated", tools: [] })), registry: [], policies: {}, limits: {}, calls: [], actions: [],
    results: SKILLS.map(() => ({ summary: "Isolated protocol verification", claims: [] })),
    decisions: [{ actorId: "isolated-owner", at: approvedAt, decision: { gateId: "isolated-first", kind: "SELECT", candidateId: "B000000001" } }, { actorId: "isolated-owner", at: approvedAt, decision: { gateId: "isolated-final", kind: "CONFIRM" } }],
  };
  type Row = Record<string, unknown> & { id: string; storageKey: string };
  const rows: Row[] = [];
  const objects = new Map<string, Buffer>();
  let puts = 0, deletes = 0, failCreate = false;
  localStorageDriver.putBuffer = async ({ key, buffer }) => { puts++; objects.set(key, Buffer.from(buffer)); return { key, size: buffer.length }; };
  localStorageDriver.getBuffer = async key => { const value = objects.get(key); if (!value) throw new Error("isolated missing object"); return Buffer.from(value); };
  localStorageDriver.delete = async key => { deletes++; objects.delete(key); };
  globals.prisma = { fileObject: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => rows.find(row => Object.entries(where).every(([key, value]) => key === "storageKey" ? row.storageKey.startsWith((value as { startsWith: string }).startsWith) : row[key] === value)) ?? null,
    create: async ({ data }: { data: Omit<Row, "id"> }) => { if (failCreate) throw new Error("isolated metadata failure"); const row = { ...data, id: `isolated-file-${rows.length + 1}` } as Row; rows.push(row); return row; },
  } } as unknown as PrismaClient;
  try {
    const html = renderResearchReport(run);
    assert.match(html, /审批定稿时间：2026-01-02T03:04:05.000Z/);
    assert.match(html, /目标 ASIN：B000000001/);
    let stored = structuredClone(run), failCheckpoint = true;
    const store: Store = {
      async create(value) { stored = structuredClone(value); }, async read() { return structuredClone(stored); },
      async transaction(_id, work) {
        const current = structuredClone(stored);
        return work(current, async () => {
          if (failCheckpoint) { failCheckpoint = false; throw new Error("isolated checkpoint failure"); }
          stored = structuredClone(current);
        });
      },
    };
    const engine = storedResearchEngine(store, run.scope, "fixture");
    const persist = async (current: Run) => saveResearchReport(current, renderResearchReport(current));
    await assert.rejects(engine.saveReport(run.id, persist), /isolated checkpoint failure/);
    // The actual engine's task checkpoint failed after the file and metadata were saved.
    const first = rows[0].id;
    assert.equal((await engine.inspect(run.id)).report, undefined);
    run.revision++; run.updatedAt = "2026-01-03T00:00:00.000Z";
    assert.equal(renderResearchReport(run), html);
    assert.equal((await engine.saveReport(run.id, persist)).fileId, first);
    assert.equal((await engine.inspect(run.id)).report?.fileId, first);
    assert.equal(puts, 1); assert.equal(rows.length, 1); assert.equal(deletes, 0);
    const key = rows[0].storageKey;
    objects.set(key, Buffer.from("isolated corrupted report"));
    await assert.rejects(saveResearchReport(run, html), /INTEGRITY_FAILED/);
    assert.equal(puts, 1); assert.equal(deletes, 0);
    objects.delete(key);
    await assert.rejects(saveResearchReport(run, html), /REPORT_UNAVAILABLE/);
    objects.set(key, Buffer.from(html));
    failCreate = true;
    await assert.rejects(saveResearchReport(run, `${html}<!--isolated changed report-->`), /REPORT_METADATA_FAILED/);
    assert.equal(deletes, 1); assert.ok(objects.has(key)); assert.equal(rows.length, 1);
    failCreate = false;
    const other = await saveResearchReport({ ...run, scope: { ...run.scope, ownerId: "isolated-other-owner" } }, html);
    assert.notEqual(other, first); assert.equal(rows.length, 2);
    assert.equal(await saveResearchReport(run, html), first);
  } finally {
    globals.prisma = previous.prisma;
    localStorageDriver.putBuffer = previous.put; localStorageDriver.getBuffer = previous.get; localStorageDriver.delete = previous.delete;
    if (previous.driver === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = previous.driver;
    if (previous.database === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.database;
  }
});
