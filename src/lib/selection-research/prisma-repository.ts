import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { randomUUID, createHash } from "node:crypto";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import type { ResearchRepository, ResearchRow } from "./lease-store";
import type { Run, Scope } from "./types";

const namespace = "selection-research-v1";
function where(id: string, scope: Scope) { return { id, organizationId: scope.organizationId, workspaceId: scope.workspaceId, requestedByUserId: scope.ownerId, context: { path: ["namespace"], equals: namespace } }; }
function json(value: unknown) { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
/** Existing AgentExecution storage; schema/migrations are intentionally unchanged. */
export function prismaResearchRepository(): ResearchRepository {
  return {
    async create(run) {
      const agentId = `${namespace}:${run.scope.organizationId}`;
      await prisma.$transaction(async (tx) => {
        const definition = await tx.agentDefinition.upsert({ where: { id: agentId }, update: {}, create: {
          id: agentId, organizationId: run.scope.organizationId, name: "Local selection research", description: "Five-stage research with mandatory human gates", version: "1", enabled: true,
          systemInstructions: "Research only. No store writes. Human decisions are verified by dedicated API.", goals: [], skills: json(run.skills.map((skill) => skill.name)), tools: [], permissions: ["agents"], inputSchema: {}, outputSchema: {}, approvalPolicy: { gates: [1, 5] },
        } });
        if (definition.organizationId !== run.scope.organizationId) throw new Error("RESEARCH_SCOPE_DENIED");
        await tx.agentExecution.create({ data: { id: run.id, organizationId: run.scope.organizationId, workspaceId: run.scope.workspaceId, requestedByUserId: run.scope.ownerId, agentDefinitionId: agentId,
          marketplace: run.marketplace, status: run.status, input: { requirement: run.requirement, mode: run.mode }, context: { namespace, version: randomUUID(), leaseId: null, leaseUntil: 0 }, output: json(run) } });
      });
    },
    async read(id, scope): Promise<ResearchRow> {
      const row = await prisma.agentExecution.findFirst({ where: where(id, scope), select: { output: true, context: true } });
      if (!row) throw new Error("RESEARCH_NOT_FOUND");
      const context = row.context as { version: string; leaseId: string | null; leaseUntil: number };
      const run = row.output as unknown as Run;
      if (run.version !== 1 || run.id !== id || run.scope.organizationId !== scope.organizationId || run.scope.workspaceId !== scope.workspaceId || run.scope.ownerId !== scope.ownerId) throw new Error("RESEARCH_SCOPE_DENIED");
      return { run, ...context };
    },
    async compareAndSet(id, scope, version, value) {
      if (Buffer.byteLength(JSON.stringify(value.run)) > 16_000_000) throw new Error("RESEARCH_SNAPSHOT_LIMIT");
      const next = randomUUID();
      const result = await prisma.agentExecution.updateMany({ where: { ...where(id, scope), AND: [{ context: { path: ["version"], equals: version } }] },
        data: { status: value.run.status, toolCallCount: value.run.calls.length, output: json(value.run), context: { namespace, version: next, leaseId: value.leaseId, leaseUntil: value.leaseUntil }, finishedAt: ["COMPLETED", "CANCELLED"].includes(value.run.status) ? new Date() : null } });
      return result.count === 1 ? next : null;
    },
  };
}

/** Export goes through the existing file adapter, not a business-level local disk path. */
export async function saveResearchReport(run: Run, html: string) {
  const buffer = Buffer.from(html, "utf8");
  const hash = createHash("sha256").update(buffer).digest("hex");
  const prefix = `selection-research/${run.scope.organizationId}/${run.scope.workspaceId}/${run.id}/`;
  const originalName = `selection-research-${run.id}.html`;
  const storage = getStorageDriver();
  const existing = await prisma.fileObject.findFirst({ where: {
    organizationId: run.scope.organizationId, userId: run.scope.ownerId, workspaceId: run.scope.workspaceId,
    marketplace: run.marketplace, originalName, mimeType: "text/html", contentHash: hash, status: "done", storageType: getStorageType(), storageKey: { startsWith: prefix },
  }, select: { id: true, storageKey: true } });
  if (existing) {
    let saved: Buffer;
    try { saved = await storage.getBuffer(existing.storageKey); }
    catch { throw new Error("RESEARCH_REPORT_UNAVAILABLE"); }
    if (saved.length !== buffer.length || createHash("sha256").update(saved).digest("hex") !== hash) throw new Error("RESEARCH_REPORT_INTEGRITY_FAILED");
    return existing.id;
  }
  const key = `${prefix}${randomUUID()}.html`;
  await storage.putBuffer({ key, buffer, contentType: "text/html; charset=utf-8" });
  // Never return a public storage URL: downloads are served behind scoped authorization.
  try {
    const file = await prisma.fileObject.create({ data: { organizationId: run.scope.organizationId, userId: run.scope.ownerId, workspaceId: run.scope.workspaceId,
      marketplace: run.marketplace, originalName, mimeType: "text/html", size: buffer.length, storageKey: key, storageType: getStorageType(), status: "done", contentHash: hash } });
    return file.id;
  } catch {
    // A unique new object is safe to compensate; never delete or replace an existing report.
    await storage.delete(key).catch(() => undefined);
    throw new Error("RESEARCH_REPORT_METADATA_FAILED");
  }
}

/** Project only small summaries; evidence stays in the saved task. */
export async function listCredentialResearch(scope: Scope, credentialId: string, page: number, pageSize: number) {
  const rows = await prisma.agentExecution.findMany({
    where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, requestedByUserId: scope.ownerId,
      AND: [{ context: { path: ["namespace"], equals: namespace } },
        { output: { path: ["mode"], equals: "live" } },
        { output: { path: ["erpCredentialId"], equals: credentialId } },
        { output: { path: ["scope", "organizationId"], equals: scope.organizationId } },
        { output: { path: ["scope", "workspaceId"], equals: scope.workspaceId } },
        { output: { path: ["scope", "ownerId"], equals: scope.ownerId } } ] },
    select: { id: true, status: true, input: true, marketplace: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize + 1,
  });
  return { runs: rows.slice(0, pageSize).map(row => ({ id: row.id, status: row.status,
    requirement: String((row.input as { requirement?: string })?.requirement ?? "").slice(0, 240),
    marketplace: row.marketplace, updatedAt: row.updatedAt })), page, pageSize, hasNext: rows.length > pageSize, persisted: true };
}
