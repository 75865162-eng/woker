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
  buildProductExportWorkbook,
  buildProductExportWhere,
  normalizeProductExportPayload,
} from "@/lib/products/product-export-job";
import { productRecordPayloadToProduct } from "@/lib/products/product-projection";
import { getStorageDriver } from "@/lib/storage";
import type { AdjustmentDraft, CampaignGroup, DataBatch, LifecycleGroupId, PerformanceRow } from "@/lib/types";
import type { CurrentUser } from "@/lib/auth/session";

import { claimExecution, ExecutionLostError, type JobExecution } from "@/lib/runtime/job-execution";

const maxProductExportRows = 100_000;

function createResultKey(jobId: string, token: string) {
  return `results/${new Date().toISOString().slice(0, 10)}/${jobId}/${token}.xlsx`;
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
  execution: JobExecution,
) {
  if (!input) return;

  await execution.write(tx => recordDataChangeVersion(input, tx));
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
  execution: JobExecution,
) {
  const resultKey = createResultKey(job.id, execution.token);
  const payload = normalizeProductExportPayload(job.payload);
  const startedAt = new Date().toISOString();

  await execution.write(tx => tx.importJob.update({
    where: { id: job.id },
    data: {
      progress: 10,
      payload: {
        ...payload,
        _runtime: {
          phase: "读取商品数据",
          startedAt,
          processedCount: 0,
          totalCount: null,
        },
      } as unknown as Prisma.InputJsonValue,
    },
  }));

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
    }, execution);
  }

  const records = await prisma.productSummaryRecord.findMany({
    where: buildProductExportWhere({
      user: { organizationId: job.organizationId, id: job.userId },
      workspaceId: job.workspaceId,
      payload,
    }),
    select: {
      productRecordId: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: maxProductExportRows + 1,
  });

  if (records.length > maxProductExportRows) {
    throw new Error(`导出结果超过 ${maxProductExportRows.toLocaleString("zh-CN")} 条，请缩小筛选范围后重试。`);
  }

  await execution.write(tx => tx.importJob.update({
    where: { id: job.id },
    data: {
      progress: 55,
      payload: {
        ...payload,
        _runtime: {
          phase: "生成 Excel",
          startedAt,
          processedCount: 0,
          totalCount: records.length,
        },
      } as unknown as Prisma.InputJsonValue,
    },
  }));

  const productRecords = await prisma.productRecord.findMany({
    where: {
      id: { in: records.map((record) => record.productRecordId) },
      organizationId: job.organizationId,
      workspaceId: job.workspaceId,
    },
    select: {
      id: true,
      payload: true,
    },
  });
  const productsById = new Map(productRecords.map((record) => [record.id, productRecordPayloadToProduct(record.payload)]));
  const products = records
    .map((record) => productsById.get(record.productRecordId))
    .filter((product): product is ReturnType<typeof productRecordPayloadToProduct> => Boolean(product));
  const buffer = Buffer.from(await buildProductExportWorkbook(products));

  await execution.write(tx => tx.importJob.update({
    where: { id: job.id },
    data: {
      progress: 85,
      payload: {
        ...payload,
        _runtime: {
          phase: "保存导出文件",
          startedAt,
          processedCount: products.length,
          totalCount: records.length,
        },
      } as unknown as Prisma.InputJsonValue,
    },
  }));

  await getStorageDriver().putBuffer({
    key: resultKey,
    buffer,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  await execution.write(async tx => {
    const recordJobVersion = (input: Parameters<typeof recordDataChangeVersion>[0]) => recordDataChangeVersion(input, tx);
    await tx.importJob.update({
      where: { id: job.id },
      data: {
        status: "done",
        progress: 100,
        resultKey,
        leaseExpiresAt: null,
        payload: {
          ...payload,
          _runtime: {
            phase: "已完成",
            startedAt,
            processedCount: products.length,
            totalCount: records.length,
          },
        } as unknown as Prisma.InputJsonValue,
        file: {
          update: {
            status: "done",
            storageKey: resultKey,
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size: buffer.byteLength,
          },
        },
      },
    });

    await tx.exportRecord.upsert({
      where: {
        jobId_resultKey: {
          jobId: job.id,
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
        jobId: job.id,
        resultKey,
        fileName: job.file.originalName,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: buffer.byteLength,
      },
      update: {
        fileName: job.file.originalName,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
          resultKey,
          workspaceId: job.workspaceId,
          accountId: job.accountId,
          marketplace: job.marketplace,
          rowCount: products.length,
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
        entityId: `${job.id}:${resultKey}`,
        action: "export_record_save",
        summary: job.file.originalName,
        payload: {
          jobId: job.id,
          fileId: job.fileId,
          resultKey,
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
    });
  }

  export async function processImportJob(jobId: string) {
    const execution = await claimExecution("import", jobId);
    if (!execution) return;
    let loadedJob: Awaited<ReturnType<typeof loadJob>> | undefined;
    let auditUser: CurrentUser | undefined;
    try {
      const job = await loadJob(jobId);
      loadedJob = job;
      await execution.write(async tx => {
        await tx.importJob.update({ where: { id: jobId }, data: { progress: 10, error: null } });
        await tx.fileObject.update({ where: { id: job!.fileId }, data: { status: "processing" } });
      });
      auditUser = await getAuditUserForJob(job);
      if (job.type === "product_export") {
        await processProductExportJob(job, auditUser, execution);
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
        }, execution);
      }

      const storage = getStorageDriver();
      const fileBuffer = await storage.getBuffer(job.file.storageKey);
      const arrayBuffer = new Uint8Array(fileBuffer).buffer;
      const parsedWorkbook = parseBulkWorkbook(arrayBuffer);

      if (parsedWorkbook.matchedSheets.length === 0) {
        throw new Error("未找到可解析的 Amazon Bulk Operations Sheet。");
      }

      await execution.write(tx => tx.importJob.update({
        where: { id: jobId },
        data: {
          progress: 45,
        },
      }));

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

      const resultKey = createResultKey(jobId, execution.token);
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

      await execution.write(async tx => {
      const recordJobVersion = (input: Parameters<typeof recordDataChangeVersion>[0]) => recordDataChangeVersion(input, tx);
      await tx.importJob.update({
        where: { id: jobId },
        data: {
          status: "done",
          progress: 100,
          resultKey,
          leaseExpiresAt: null,
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

      await tx.exportRecord.upsert({
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
      });
    } catch (error) {
      if (error instanceof ExecutionLostError) return;
      if (!loadedJob) throw error;
      const message = error instanceof Error ? error.message : "Job processing failed.";
      const failedJob = loadedJob;
      await execution.write(async tx => {
        const job = failedJob;
      const recordJobVersion = (input: Parameters<typeof recordDataChangeVersion>[0]) => recordDataChangeVersion(input, tx);
      await tx.importJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          leaseExpiresAt: null,
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
    }).catch(failure => { if (!(failure instanceof ExecutionLostError)) throw failure; });
  } finally {
    execution.dispose();
  }
}

function loadJob(id: string) {
  return prisma.importJob.findUniqueOrThrow({ where: { id }, include: { file: true } });
}
