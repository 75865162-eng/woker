import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import type { ExportFormat, StructuredReport } from "./types";

/**
 * Skill 运行历史的持久化层。
 *
 * 复用现有 AgentExecution + FileObject + storage 适配器（与选品研究同一套底座），
 * 不新增数据库表、不新建存储通道。运行记录按组织/工作区/发起人三重隔离，
 * 文档下载走带作用域的 FileObject 查询，不返回公开存储 URL。
 *
 * 只保存模型真实产出的报告内容与导出文件字节；缺失事实由报告内的 NEEDS_DATA 表达，
 * 本层不补造任何业务数值。
 */

export const SKILL_RUN_NAMESPACE = "skill-run-v1";

export type SkillRunScope = {
  organizationId: string;
  workspaceId: string;
  ownerId: string;
};

export type SkillRunSummary = {
  id: string;
  slug: string;
  skillName: string;
  exportFormat: ExportFormat;
  fileName: string;
  status: string;
  marketplace: string;
  createdAt: string;
  finishedAt: string | null;
};

export type SkillRunDetail = SkillRunSummary & {
  title: string;
  markdown: string;
  notes: string[];
  rowCount: number;
  model: string;
  provider: string;
  inputs: Record<string, string>;
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function scopedWhere(id: string, scope: SkillRunScope) {
  return {
    id,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    requestedByUserId: scope.ownerId,
    context: { path: ["namespace"], equals: SKILL_RUN_NAMESPACE },
  };
}

async function ensureDefinition(organizationId: string) {
  const id = `${SKILL_RUN_NAMESPACE}:${organizationId}`;
  await prisma.agentDefinition.upsert({
    where: { id },
    update: {},
    create: {
      id,
      organizationId,
      name: "Skill engine runs",
      description: "Read-only skill reports with durable history",
      version: "1",
      enabled: true,
      systemInstructions: "Read-only analysis. No store writes. Reports are AI-generated suggestions.",
      goals: [],
      skills: [],
      tools: [],
      permissions: ["agents"],
      inputSchema: {},
      outputSchema: {},
      approvalPolicy: {},
    },
  });
  return id;
}

const MIME: Record<ExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export type SaveSkillRunInput = {
  scope: SkillRunScope;
  slug: string;
  skillName: string;
  inputs: Record<string, string>;
  exportFormat: ExportFormat;
  fileName: string;
  report: StructuredReport;
  bytes: Uint8Array;
  model: string;
  provider: string;
  marketplace: string;
};

/** 保存一次已完成的运行：先写文件对象，再写运行记录；失败时补偿删除新文件。 */
export async function saveSkillRun(input: SaveSkillRunInput): Promise<string> {
  const { scope, report, bytes, exportFormat } = input;
  if (bytes.byteLength < 1 || bytes.byteLength > 10 * 1024 * 1024) throw new Error("SKILL_REPORT_SIZE_INVALID");
  const id = randomUUID();
  const definitionId = await ensureDefinition(scope.organizationId);
  const buffer = Buffer.from(bytes);
  const hash = createHash("sha256").update(buffer).digest("hex");
  const prefix = `skill-runs/${scope.organizationId}/${scope.workspaceId}/${id}/`;
  const storage = getStorageDriver();
  const key = `${prefix}${randomUUID()}.${exportFormat}`;
  await storage.putBuffer({ key, buffer, contentType: MIME[exportFormat] });

  try {
    await prisma.$transaction(async (tx) => {
      const file = await tx.fileObject.create({ data: {
        id: randomUUID(),
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        userId: scope.ownerId,
        originalName: input.fileName,
        mimeType: MIME[exportFormat],
        size: buffer.byteLength,
        storageKey: key,
        storageType: getStorageType(),
        status: "done",
        contentHash: hash,
      } });
      await tx.agentExecution.create({ data: {
        id,
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        requestedByUserId: scope.ownerId,
        agentDefinitionId: definitionId,
        marketplace: input.marketplace,
        status: "COMPLETED",
        input: json({ slug: input.slug, skillName: input.skillName, inputs: input.inputs, exportFormat }),
        context: json({ namespace: SKILL_RUN_NAMESPACE, fileId: file.id, model: input.model, provider: input.provider }),
        output: json({ title: report.title, markdown: report.markdown, notes: report.notes ?? [], rowCount: report.rows.length }),
        finishedAt: new Date(),
      } });
    });
  } catch (error) {
    await storage.delete(key).catch(() => undefined);
    throw error;
  }
  return id;
}

function summarize(row: {
  id: string;
  status: string;
  marketplace: string;
  createdAt: Date;
  finishedAt: Date | null;
  input: Prisma.JsonValue;
  context: Prisma.JsonValue;
}): SkillRunSummary {
  const input = (row.input ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    slug: String(input.slug ?? ""),
    skillName: String(input.skillName ?? ""),
    exportFormat: input.exportFormat === "xlsx" ? "xlsx" : "docx",
    fileName: "",
    status: row.status,
    marketplace: row.marketplace,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

/** 旧记录（namespace 建立前）的 context 可能没有 fileName/exportFormat，从 FileObject 与 input 兜底。 */
async function hydrateSummaries(rows: Awaited<ReturnType<typeof listRows>>): Promise<SkillRunSummary[]> {
  const fileIds = rows.map((row) => String(((row.context ?? {}) as Record<string, unknown>).fileId ?? "")).filter(Boolean);
  const files = fileIds.length
    ? await prisma.fileObject.findMany({ where: { organizationId: rows[0]?.organizationId, id: { in: fileIds } }, select: { id: true, originalName: true, mimeType: true } })
    : [];
  const fileMap = new Map(files.map((file) => [file.id, file]));
  return rows.map((row) => {
    const summary = summarize(row);
    const fileId = String(((row.context ?? {}) as Record<string, unknown>).fileId ?? "");
    const file = fileMap.get(fileId);
    if (!summary.fileName && file) summary.fileName = file.originalName;
    if (file?.mimeType === MIME.xlsx) summary.exportFormat = "xlsx";
    return summary;
  });
}

async function listRows(scope: SkillRunScope, page: number, pageSize: number) {
  return prisma.agentExecution.findMany({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      requestedByUserId: scope.ownerId,
      context: { path: ["namespace"], equals: SKILL_RUN_NAMESPACE },
    },
    select: { id: true, status: true, marketplace: true, createdAt: true, finishedAt: true, input: true, context: true, organizationId: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize + 1,
  });
}

export async function listSkillRuns(scope: SkillRunScope, page: number, pageSize: number) {
  const rows = await listRows(scope, page, pageSize);
  const hasNext = rows.length > pageSize;
  const summaries = await hydrateSummaries(rows.slice(0, pageSize));
  return { runs: summaries, page, pageSize, hasNext, persisted: true };
}

export async function getSkillRun(id: string, scope: SkillRunScope): Promise<SkillRunDetail> {
  const row = await prisma.agentExecution.findFirst({
    where: scopedWhere(id, scope),
    select: { id: true, status: true, marketplace: true, createdAt: true, finishedAt: true, input: true, context: true, output: true },
  });
  if (!row) throw new Error("SKILL_RUN_NOT_FOUND");
  const summary = summarize(row);
  const input = (row.input ?? {}) as Record<string, unknown>;
  const context = (row.context ?? {}) as Record<string, unknown>;
  const output = (row.output ?? {}) as Record<string, unknown>;
  const fileId = String(context.fileId ?? "");
  const file = fileId
    ? await prisma.fileObject.findFirst({ where: { id: fileId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, userId: scope.ownerId }, select: { originalName: true } })
    : null;
  return {
    ...summary,
    fileName: file?.originalName ?? "",
    title: String(output.title ?? summary.skillName),
    markdown: String(output.markdown ?? ""),
    notes: Array.isArray(output.notes) ? output.notes.filter((n): n is string => typeof n === "string") : [],
    rowCount: Number.isFinite(output.rowCount) ? Number(output.rowCount) : 0,
    model: String(context.model ?? ""),
    provider: String(context.provider ?? ""),
    inputs: (input.inputs ?? {}) as Record<string, string>,
  };
}

/** 取得授权范围内的导出文档字节；做作用域与哈希双重校验，失败明确抛错。 */
export async function getSkillRunDocument(id: string, scope: SkillRunScope): Promise<{ bytes: Buffer; fileName: string; mimeType: string }> {
  const row = await prisma.agentExecution.findFirst({
    where: scopedWhere(id, scope),
    select: { context: true, status: true },
  });
  if (!row || row.status !== "COMPLETED") throw new Error("SKILL_RUN_NOT_FOUND");
  const context = (row.context ?? {}) as Record<string, unknown>;
  const fileId = String(context.fileId ?? "");
  if (!fileId) throw new Error("SKILL_RUN_NOT_FOUND");
  const prefix = `skill-runs/${scope.organizationId}/${scope.workspaceId}/${id}/`;
  const file = await prisma.fileObject.findFirst({ where: {
    id: fileId,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    userId: scope.ownerId,
    storageKey: { startsWith: prefix },
  } });
  if (!file) throw new Error("SKILL_RUN_NOT_FOUND");
  const buffer = await getStorageDriver().getBuffer(file.storageKey);
  if (file.contentHash && createHash("sha256").update(buffer).digest("hex") !== file.contentHash) throw new Error("SKILL_RUN_INTEGRITY_FAILED");
  if (typeof file.size === "number" && file.size !== buffer.length) throw new Error("SKILL_RUN_INTEGRITY_FAILED");
  return { bytes: buffer, fileName: file.originalName, mimeType: file.mimeType ?? MIME[context.exportFormat === "xlsx" ? "xlsx" : "docx"] };
}
