import { defaultRules } from "@/data/default-rules";
import { recordDataChangeVersion } from "@/lib/audit/versioning";
import { exportBulkDrafts } from "@/lib/bulk/export";
import { runBulkOptimizationForCampaignGroup } from "@/lib/bulk/optimization";
import { parseBulkWorkbook } from "@/lib/bulk/workbook-parser";
import {
  buildGroupsFromRows,
  buildParseFailureMessage,
  collectDiagnostics,
  toPerformanceRow,
  type ParseDiagnostics,
} from "@/lib/bulk/workspace-builders";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  buildProductExportCsv,
  buildProductExportRows,
  buildProductExportWhere,
  normalizeProductExportPayload,
} from "@/lib/products/product-export-job";
import { getStorageDriver } from "@/lib/storage";
import type { AdjustmentDraft, CampaignGroup, DataBatch, LifecycleGroupId, PerformanceRow } from "@/lib/types";
import type { CurrentUser } from "@/lib/auth/session";

function createResultKey(jobId: string) {
  return `results/${new Date().toISOString().slice(0, 10)}/${jobId}.xlsx`;
}

function getDefaultLifecycleGroupId(): LifecycleGroupId {
  const value = process.env.WORKER_DEFAULT_LIFECYCLE_GROUP;

  if (value === "launch" || value === "mature" || value === "decline" || value === "clearance") {
    return value;
  }

  return "mature";
}

function createEmptyDiagnostics(): ParseDiagnostics {
  return {
    totalRows: 0,
    sponsoredProductRows: 0,
    rowsWithAdGroup: 0,
    keywordRows: 0,
    rowsWithBid: 0,
    executableRows: 0,
    sampleHeaders: [],
    sampleEntities: [],
  };
}

async function getAuditUserForJob(job: {
  userId: string;
  organizationId: string;
}): Promise<CurrentUser | undefined> {
  const user = await prisma.user.findUnique({
    where: { id: job.userId },
    include: {
      memberships: {
        where: {
          organizationId: job.organizationId,
        },
        include: {
          organization: true,
        },
        orderBy: {
          createdAt: "asc",
        },
        take: 1,
      },
    },
  });

  const membership = user?.memberships[0];

  if (!user || user.status !== "active" || !membership) {
    return undefined;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: membership.role,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
  };
}

async function recordJobVersion(
  input: Parameters<typeof recordDataChangeVersion>[0] | undefined,
) {
  if (!input) return;

  try {
    await recordDataChangeVersion(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record job version.";
    console.warn(message);
  }
}

function buildImportedData(input: ReturnType<typeof parseBulkWorkbook>, batchId: string) {
  let diagnostics = createEmptyDiagnostics();
  let performanceRows: PerformanceRow[] = [];
  let campaignGroups: CampaignGroup[] = [];

  for (const sheet of input.sheets) {
    diagnostics = collectDiagnostics(sheet.sheetName, sheet.rows, diagnostics);

    const rows = sheet.rows
      .map((row, index) => toPerformanceRow(row, sheet.sheetName, batchId, index + 2))
      .filter((row): row is PerformanceRow => Boolean(row));

    performanceRows = [...performanceRows, ...rows];
    campaignGroups = buildGroupsFromRows(campaignGroups, rows);
  }

  return {
    diagnostics,
    performanceRows,
    campaignGroups,
  };
}

function buildDataBatches(input: {
  campaignGroups: CampaignGroup[];
  batchId: string;
  fileName: string;
  rowCount: number;
}): DataBatch[] {
  const uploadedAt = new Date().toISOString();

  return input.campaignGroups.map((campaignGroup) => ({
    id: `${campaignGroup.id}-${input.batchId}`,
    campaignGroupId: campaignGroup.id,
    fileName: input.fileName,
    uploadedAt,
    rowCount: input.rowCount,
    dateRange: uploadedAt.slice(0, 10),
    status: "archived",
  }));
}

function runImportedBulkOptimization(input: {
  campaignGroups: CampaignGroup[];
  performanceRows: PerformanceRow[];
  dataBatches: DataBatch[];
  batchId: string;
}): AdjustmentDraft[] {
  return input.campaignGroups.flatMap((campaignGroup) =>
    runBulkOptimizationForCampaignGroup({
      campaignGroup,
      rows: input.performanceRows,
      dataBatches: input.dataBatches,
      activeBatchId: input.batchId,
      overallAdDataRows: [],
      rules: defaultRules,
    }),
  );
}

async function processProductExportJob(
  job: {
    id: string;
    organizationId: string;
    userId: string;
    fileId: string;
    workspaceId: string;
    accountId: string;
    marketplace: string;
    payload: unknown;
    file: {
      originalName: string;
      storageKey: string;
    };
  },
  auditUser: CurrentUser | undefined,
) {
  const payload = normalizeProductExportPayload(job.payload);

  if (auditUser) {
    await recordJobVersion({
      user: auditUser,
      entityType: "import_job",
      entityId: job.id,
      action: "import_job_start",
      summary: `${job.file.originalName} 开始导出`,
      payload: {
        id: job.id,
        fileId: job.fileId,
        type: "product_export",
        status: "running",
        progress: 10,
        workspaceId: job.workspaceId,
        accountId: job.accountId,
        marketplace: job.marketplace,
        filters: payload,
      } as unknown as Prisma.InputJsonValue,
      scope: {
        workspaceId: job.workspaceId,
        accountId: job.accountId,
        marketplace: job.marketplace,
      },
    });
  }

  const records = await prisma.productRecord.findMany({
    where: buildProductExportWhere({
      user: { organizationId: job.organizationId },
      workspaceId: job.workspaceId,
      payload,
    }),
    select: {
      id: true,
      sku: true,
      chineseName: true,
      englishName: true,
      status: true,
      selectionOwner: true,
      opsAssignee: true,
      designerAssignee: true,
      workflowStage: true,
      updatedAt: true,
      asin: true,
      supplierName: true,
      purchasePrice: true,
      workflowDueAt: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  const csv = buildProductExportCsv(buildProductExportRows(records));
  const buffer = Buffer.from(csv, "utf8");

  await getStorageDriver().putBuffer({
    key: job.file.storageKey,
    buffer,
    contentType: "text/csv; charset=utf-8",
  });

  await prisma.importJob.update({
    where: { id: job.id },
    data: {
      status: "done",
      progress: 100,
      resultKey: job.file.storageKey,
      file: {
        update: {
          status: "done",
          mimeType: "text/csv; charset=utf-8",
          size: buffer.byteLength,
        },
      },
    },
  });

  await prisma.exportRecord.upsert({
    where: {
      jobId_resultKey: {
        jobId: job.id,
        resultKey: job.file.storageKey,
      },
    },
    create: {
      organizationId: job.organizationId,
      userId: job.userId,
      workspaceId: job.workspaceId,
      accountId: job.accountId,
      marketplace: job.marketplace,
      fileId: job.fileId,
      jobId: job.id,
      resultKey: job.file.storageKey,
      fileName: job.file.originalName,
      mimeType: "text/csv; charset=utf-8",
      size: buffer.byteLength,
    },
    update: {
      fileName: job.file.originalName,
      mimeType: "text/csv; charset=utf-8",
      size: buffer.byteLength,
    },
  });

  if (auditUser) {
    await recordJobVersion({
      user: auditUser,
      entityType: "import_job",
      entityId: job.id,
      action: "import_job_done",
      summary: `${job.file.originalName} 导出完成`,
      payload: {
        id: job.id,
        fileId: job.fileId,
        type: "product_export",
        status: "done",
        progress: 100,
        resultKey: job.file.storageKey,
        workspaceId: job.workspaceId,
        accountId: job.accountId,
        marketplace: job.marketplace,
        rowCount: records.length,
      } as unknown as Prisma.InputJsonValue,
      scope: {
        workspaceId: job.workspaceId,
        accountId: job.accountId,
        marketplace: job.marketplace,
      },
    });
    await recordJobVersion({
      user: auditUser,
      entityType: "export_record",
      entityId: `${job.id}:${job.file.storageKey}`,
      action: "export_record_save",
      summary: job.file.originalName,
      payload: {
        jobId: job.id,
        fileId: job.fileId,
        resultKey: job.file.storageKey,
        fileName: job.file.originalName,
        size: buffer.byteLength,
        workspaceId: job.workspaceId,
        accountId: job.accountId,
        marketplace: job.marketplace,
      } as unknown as Prisma.InputJsonValue,
      scope: {
        workspaceId: job.workspaceId,
        accountId: job.accountId,
        marketplace: job.marketplace,
      },
    });
  }
}

export async function processImportJob(jobId: string) {
  const job = await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: "running",
      progress: 10,
      file: {
        update: {
          status: "processing",
        },
      },
    },
    include: { file: true },
  });
  const auditUser = await getAuditUserForJob(job);

  try {
    if (job.type === "product_export") {
      await processProductExportJob(job, auditUser);
      return;
    }

    if (auditUser) {
      await recordJobVersion({
        user: auditUser,
        entityType: "import_job",
        entityId: job.id,
        action: "import_job_start",
        summary: `${job.file.originalName} 开始处理`,
        payload: {
          id: job.id,
          fileId: job.fileId,
          type: job.type,
          status: "running",
          progress: 10,
          workspaceId: job.workspaceId,
          accountId: job.accountId,
          marketplace: job.marketplace,
        } as unknown as Prisma.InputJsonValue,
        scope: {
          workspaceId: job.workspaceId,
          accountId: job.accountId,
          marketplace: job.marketplace,
        },
      });
    }

    const storage = getStorageDriver();
    const fileBuffer = await storage.getBuffer(job.file.storageKey);
    const arrayBuffer = new Uint8Array(fileBuffer).buffer;
    const parsedWorkbook = parseBulkWorkbook(arrayBuffer);

    if (parsedWorkbook.matchedSheets.length === 0) {
      throw new Error("未找到可解析的 Amazon Bulk Operations Sheet。");
    }

    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        progress: 45,
      },
    });

    const batchId = `job-${jobId}`;
    const importedData = buildImportedData(parsedWorkbook, batchId);

    if (importedData.campaignGroups.length === 0) {
      throw new Error(buildParseFailureMessage(importedData.diagnostics));
    }

    const campaignGroups = importedData.campaignGroups.map((group) => ({
      ...group,
      lifecycleGroupId: group.lifecycleGroupId ?? getDefaultLifecycleGroupId(),
    }));
    const dataBatches = buildDataBatches({
      campaignGroups,
      batchId,
      fileName: job.file.originalName,
      rowCount: importedData.performanceRows.length,
    });
    const drafts = runImportedBulkOptimization({
      campaignGroups,
      performanceRows: importedData.performanceRows,
      dataBatches,
      batchId,
    });

    if (drafts.length === 0) {
      throw new Error("规则未生成可写回草稿，请检查 Bulk 指标、规则条件或默认生命周期分组。");
    }

    const resultKey = createResultKey(jobId);
    const exportResult = await exportBulkDrafts({
      workbookBuffer: arrayBuffer,
      drafts,
      fileName: job.file.originalName,
    });

    if (exportResult.writableCount === 0) {
      throw new Error(
        `没有可写回的草稿。冲突 ${exportResult.conflictCount} 条，阻止 ${exportResult.blockedCount} 条。`,
      );
    }

    await storage.putBuffer({
      key: resultKey,
      buffer: Buffer.from(exportResult.data),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const exportFileName = `${job.file.originalName.replace(/\.[^.]+$/, "")}-optimized.xlsx`;

    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "done",
        progress: 100,
        resultKey,
        file: {
          update: {
            status: "done",
          },
        },
      },
    });
    if (auditUser) {
      await recordJobVersion({
        user: auditUser,
        entityType: "import_job",
        entityId: job.id,
        action: "import_job_done",
        summary: `${job.file.originalName} 处理完成`,
        payload: {
          id: job.id,
          fileId: job.fileId,
          type: job.type,
          status: "done",
          progress: 100,
          resultKey,
          workspaceId: job.workspaceId,
          accountId: job.accountId,
          marketplace: job.marketplace,
        } as unknown as Prisma.InputJsonValue,
        scope: {
          workspaceId: job.workspaceId,
          accountId: job.accountId,
          marketplace: job.marketplace,
        },
      });
    }

    await prisma.exportRecord.upsert({
      where: {
        jobId_resultKey: {
          jobId,
          resultKey,
        },
      },
      create: {
        organizationId: job.organizationId,
        userId: job.userId,
        workspaceId: job.workspaceId,
        accountId: job.accountId,
        marketplace: job.marketplace,
        fileId: job.fileId,
        jobId,
        resultKey,
        fileName: exportFileName,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: exportResult.data.byteLength,
      },
      update: {
        fileName: exportFileName,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: exportResult.data.byteLength,
      },
    });
    if (auditUser) {
      await recordJobVersion({
        user: auditUser,
        entityType: "export_record",
        entityId: `${job.id}:${resultKey}`,
        action: "export_record_save",
        summary: exportFileName,
        payload: {
          jobId,
          fileId: job.fileId,
          resultKey,
          fileName: exportFileName,
          size: exportResult.data.byteLength,
          workspaceId: job.workspaceId,
          accountId: job.accountId,
          marketplace: job.marketplace,
        } as unknown as Prisma.InputJsonValue,
        scope: {
          workspaceId: job.workspaceId,
          accountId: job.accountId,
          marketplace: job.marketplace,
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Job processing failed.";
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        error: message,
        file: {
          update: {
            status: "failed",
          },
        },
      },
    });
    if (auditUser) {
      await recordJobVersion({
        user: auditUser,
        entityType: "import_job",
        entityId: job.id,
        action: "import_job_failed",
        summary: message,
        payload: {
          id: job.id,
          fileId: job.fileId,
          type: job.type,
          status: "failed",
          progress: 0,
          error: message,
          workspaceId: job.workspaceId,
          accountId: job.accountId,
          marketplace: job.marketplace,
        } as unknown as Prisma.InputJsonValue,
        scope: {
          workspaceId: job.workspaceId,
          accountId: job.accountId,
          marketplace: job.marketplace,
        },
      });
    }
  }
}
