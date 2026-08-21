import { Prisma } from "@prisma/client";
import { defaultRules } from "@/data/default-rules";
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
import { normalizeAccountRoleId } from "@/lib/accounts/team-roster";
import { isBootstrapAdminEmail } from "@/lib/auth/constants";
import { prisma } from "@/lib/db/prisma";
import { importCommodityWorkbook } from "@/lib/products/commodity-import";
import type { ProductEditUser } from "@/lib/products/product-edit-access";
import { getStorageDriver } from "@/lib/storage";
import type { AdjustmentDraft, CampaignGroup, DataBatch, LifecycleGroupId, PerformanceRow } from "@/lib/types";

const parserVersion = "bulk-workbook-parser-v1";

type ImportJobWithFile = {
  id: string;
  organizationId: string;
  userId: string;
  workspaceId: string;
  accountId: string;
  marketplace: string;
  fileId: string;
  file: {
    originalName: string;
    storageKey: string;
  };
};

type ProcessImportJobOptions = {
  returnAfterDataset?: boolean;
  continueAfterDataset?: boolean;
};

async function getProductEditUserForJob(job: Pick<ImportJobWithFile, "organizationId" | "userId">): Promise<ProductEditUser> {
  const user = await prisma.user.findUnique({
    where: { id: job.userId },
    select: {
      email: true,
      name: true,
      memberships: {
        where: { organizationId: job.organizationId },
        select: { role: true },
        take: 1,
      },
    },
  });
  const rosterMember = await prisma.teamRosterMember.findUnique({
    where: {
      organizationId_id: {
        organizationId: job.organizationId,
        id: job.userId,
      },
    },
    select: { roleId: true },
  });

  return {
    name: user?.name,
    role: isBootstrapAdminEmail(user?.email) ? "owner" : normalizeAccountRoleId(rosterMember?.roleId ?? user?.memberships[0]?.role),
  };
}

function createResultKey(jobId: string) {
  return `results/${new Date().toISOString().slice(0, 10)}/${jobId}.xlsx`;
}

async function failImportJob(jobId: string, error: unknown) {
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
}

async function markPostDatasetWorkFailed(jobId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "后续处理失败。";

  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: "done",
      progress: 100,
      error: `Bulk 数据集已导入；后续自动处理失败：${message}`,
      file: {
        update: {
          status: "done",
        },
      },
    },
  });
}

async function recordJobDataChange(input: {
  organizationId: string;
  userId: string;
  workspaceId: string;
  accountId: string;
  marketplace: string;
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  payload: Prisma.InputJsonValue;
}) {
  const latest = await prisma.dataChangeVersion.aggregate({
    where: {
      organizationId: input.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
    },
    _max: { version: true },
  });
  const version = (latest._max.version ?? 0) + 1;

  await prisma.$transaction([
    prisma.dataChangeVersion.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        marketplace: input.marketplace,
        entityType: input.entityType,
        entityId: input.entityId,
        version,
        action: input.action,
        summary: input.summary,
        payload: input.payload,
      },
    }),
    prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: {
          version,
          workspaceId: input.workspaceId,
          accountId: input.accountId,
          marketplace: input.marketplace,
          summary: input.summary,
        },
      },
    }),
  ]);
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

export async function processImportJob(jobId: string, options: ProcessImportJobOptions = {}) {
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

  try {
    if (job.type === "product_commodity_import") {
      await processProductCommodityImportJob(job);
      return;
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
    const workspaceDataset = await prisma.workspaceDataset.upsert({
      where: { jobId },
      create: {
        organizationId: job.organizationId,
        userId: job.userId,
        workspaceId: job.workspaceId,
        accountId: job.accountId,
        marketplace: job.marketplace,
        fileId: job.fileId,
        jobId,
        sourceFileName: job.file.originalName,
        parserVersion,
        rowCount: importedData.performanceRows.length,
        campaignCount: campaignGroups.length,
        campaignGroups: campaignGroups as unknown as Prisma.InputJsonValue,
        performanceRows: importedData.performanceRows as unknown as Prisma.InputJsonValue,
        dataBatches: dataBatches as unknown as Prisma.InputJsonValue,
        parseDiagnostics: importedData.diagnostics as unknown as Prisma.InputJsonValue,
      },
      update: {
        sourceFileName: job.file.originalName,
        parserVersion,
        rowCount: importedData.performanceRows.length,
        campaignCount: campaignGroups.length,
        campaignGroups: campaignGroups as unknown as Prisma.InputJsonValue,
        performanceRows: importedData.performanceRows as unknown as Prisma.InputJsonValue,
        dataBatches: dataBatches as unknown as Prisma.InputJsonValue,
        parseDiagnostics: importedData.diagnostics as unknown as Prisma.InputJsonValue,
      },
    });

    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        progress: 70,
      },
    });

    await recordJobDataChange({
      organizationId: job.organizationId,
      userId: job.userId,
      workspaceId: job.workspaceId,
      accountId: job.accountId,
      marketplace: job.marketplace,
      entityType: "workspace_dataset",
      entityId: workspaceDataset.id,
      action: "workspace_dataset_import",
      summary: `导入 ${campaignGroups.length} 个广告组、${importedData.performanceRows.length} 行 Bulk 数据`,
      payload: {
        datasetId: workspaceDataset.id,
        fileId: job.fileId,
        jobId,
        sourceFileName: job.file.originalName,
        parserVersion,
        rowCount: importedData.performanceRows.length,
        campaignCount: campaignGroups.length,
        diagnostics: importedData.diagnostics,
      } as Prisma.InputJsonValue,
    }).catch((error) => console.warn("Failed to record workspace dataset import.", error));

    const finishImportJob = async () => {
      const drafts = runImportedBulkOptimization({
        campaignGroups,
        performanceRows: importedData.performanceRows,
        dataBatches,
        batchId,
      });

      if (drafts.length === 0) {
        await prisma.importJob.update({
          where: { id: jobId },
          data: {
            status: "done",
            progress: 100,
            error: "Bulk 数据集已导入；默认规则未生成自动草稿，请在 PPC 工作台中选择范围后手动运行规则。",
            file: {
              update: {
                status: "done",
              },
            },
          },
        });
        return;
      }

      const resultKey = createResultKey(jobId);
      const exportResult = await exportBulkDrafts({
        workbookBuffer: arrayBuffer,
        drafts,
        fileName: job.file.originalName,
      });

      if (exportResult.writableCount === 0) {
        await prisma.importJob.update({
          where: { id: jobId },
          data: {
            status: "done",
            progress: 100,
            error: `Bulk 数据集已导入；自动导出没有可写回草稿。冲突 ${exportResult.conflictCount} 条，阻止 ${exportResult.blockedCount} 条。`,
            file: {
              update: {
                status: "done",
              },
            },
          },
        });
        return;
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
          draftIds: drafts.map((draft) => draft.id) as unknown as Prisma.InputJsonValue,
          validation: {
            writableCount: exportResult.writableCount,
            conflictCount: exportResult.conflictCount,
            blockedCount: exportResult.blockedCount,
          } as Prisma.InputJsonValue,
          lineage: {
            datasetId: workspaceDataset.id,
            fileId: job.fileId,
            jobId,
            parserVersion,
            sourceFileName: job.file.originalName,
            mode: "worker_auto_export",
          } as Prisma.InputJsonValue,
        },
        update: {
          fileName: exportFileName,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: exportResult.data.byteLength,
          draftIds: drafts.map((draft) => draft.id) as unknown as Prisma.InputJsonValue,
          validation: {
            writableCount: exportResult.writableCount,
            conflictCount: exportResult.conflictCount,
            blockedCount: exportResult.blockedCount,
          } as Prisma.InputJsonValue,
          lineage: {
            datasetId: workspaceDataset.id,
            fileId: job.fileId,
            jobId,
            parserVersion,
            sourceFileName: job.file.originalName,
            mode: "worker_auto_export",
          } as Prisma.InputJsonValue,
        },
      });
    };

    if (options.returnAfterDataset) {
      if (options.continueAfterDataset === false) {
        await prisma.importJob.update({
          where: { id: jobId },
          data: {
            status: "done",
            progress: 100,
            error: "Bulk 数据集已导入；请在 PPC 工作台选择范围后运行规则并导出。",
            file: {
              update: {
                status: "done",
              },
            },
          },
        });
        return;
      }

      void finishImportJob().catch((error) => markPostDatasetWorkFailed(jobId, error));
      return;
    }

    await finishImportJob().catch((error) => markPostDatasetWorkFailed(jobId, error));
  } catch (error) {
    await failImportJob(jobId, error);
  }
}

async function processProductCommodityImportJob(job: ImportJobWithFile) {
  const storage = getStorageDriver();
  const fileBuffer = await storage.getBuffer(job.file.storageKey);
  const arrayBuffer = new Uint8Array(fileBuffer).buffer;

  const result = await importCommodityWorkbook({
    organizationId: job.organizationId,
    userId: job.userId,
    workspaceId: job.workspaceId,
    accountId: job.accountId,
    marketplace: job.marketplace,
    fileName: job.file.originalName,
    workbookBuffer: arrayBuffer,
    user: await getProductEditUserForJob(job),
    onProgress: async (progress) => {
      await prisma.importJob.update({
        where: { id: job.id },
        data: { progress },
      });
    },
  });

  await prisma.importJob.update({
    where: { id: job.id },
    data: {
      status: "done",
      progress: 100,
      error: `已导入 ${result.importedCount} 个商品；主图下载 ${result.imageDownloadedCount} 个，失败 ${result.imageFailedCount} 个，跳过 ${result.skippedRowCount} 行${result.permissionSkippedCount ? `，其中权限限制 ${result.permissionSkippedCount} 行` : ""}。`,
      file: {
        update: {
          status: "done",
        },
      },
    },
  });
}
