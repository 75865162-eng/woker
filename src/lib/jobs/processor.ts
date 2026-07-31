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
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";
import type { AdjustmentDraft, CampaignGroup, DataBatch, LifecycleGroupId, PerformanceRow } from "@/lib/types";

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

  try {
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
  }
}
