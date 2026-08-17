import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordDataChangeVersion } from "@/lib/audit/versioning";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function jsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function resultKey(fileName: string) {
  const extension = fileName.toLowerCase().endsWith(".xlsx") ? ".xlsx" : "";
  return `results/client/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission(request, "workspace", "export");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as Record<string, unknown>;
    const scope = workspaceScopeFromRequest(request, body);
    const fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : "bulk-export.xlsx";
    const contentBase64 = typeof body.contentBase64 === "string" ? body.contentBase64 : "";
    const draftRunId = typeof body.draftRunId === "string" && body.draftRunId ? body.draftRunId : undefined;
    const datasetId = typeof body.datasetId === "string" && body.datasetId ? body.datasetId : undefined;
    const fileId = typeof body.fileId === "string" && body.fileId ? body.fileId : undefined;
    const jobId = typeof body.jobId === "string" && body.jobId ? body.jobId : undefined;

    if (!contentBase64 || !fileId || !jobId) {
      return NextResponse.json({ error: "Export requires content, fileId, and jobId." }, { status: 400 });
    }

    const sourceJob = await prisma.importJob.findFirst({
      where: {
        id: jobId,
        organizationId: user.organizationId,
        workspaceId: scope.workspaceId,
        fileId,
      },
    });

    if (!sourceJob) {
      return NextResponse.json({ error: "Source import job not found." }, { status: 404 });
    }

    const buffer = Buffer.from(contentBase64, "base64");
    const key = resultKey(fileName);

    await getStorageDriver().putBuffer({
      key,
      buffer,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const exportRecord = await prisma.exportRecord.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        fileId,
        jobId,
        draftRunId,
        resultKey: key,
        fileName,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: buffer.byteLength,
        draftIds: jsonArray(body.draftIds) as unknown as Prisma.InputJsonValue,
        validation: (isRecord(body.validation) ? body.validation : {}) as Prisma.InputJsonValue,
        lineage: {
          datasetId,
          fileId,
          jobId,
          draftRunId,
          sourceFileName: typeof body.sourceFileName === "string" ? body.sourceFileName : undefined,
          mode: "reviewed_client_export",
        } as Prisma.InputJsonValue,
      },
    });

    if (draftRunId) {
      await prisma.draftRun.updateMany({
        where: {
          id: draftRunId,
          organizationId: user.organizationId,
        },
        data: {
          exportedAt: new Date(),
          exportFileName: fileName,
        },
      });
    }

    await recordDataChangeVersion({
      user,
      entityType: "export_record",
      entityId: exportRecord.id,
      action: "bulk_export_create",
      summary: `导出 ${fileName}`,
      payload: {
        exportRecordId: exportRecord.id,
        datasetId,
        fileId,
        jobId,
        draftRunId,
        fileName,
        size: buffer.byteLength,
        validation: isRecord(body.validation) ? body.validation : {},
      } as Prisma.InputJsonValue,
      scope,
    });

    return NextResponse.json({ exportRecord });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record export.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
