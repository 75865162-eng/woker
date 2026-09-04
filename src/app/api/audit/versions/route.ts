import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { recordDataChangeVersion, type VersionedEntityType } from "@/lib/audit/versioning";
import {
  createAiProfileName,
  createSavedAiModelProfilePair,
  normalizeAiImageSettings,
  normalizeAiSettings,
  normalizeSavedAiModelProfiles,
  type AiModelSettings,
} from "@/lib/ai-settings";
import { ensureCurrentUserRecord } from "@/lib/auth/ensure-user-record";
import { prisma } from "@/lib/db/prisma";
import {
  getProductRecordCurrentOwner,
  getProductRecordIsOverdue,
  getProductRecordSource,
  isProductOperationsProgressIncomplete,
} from "@/lib/products/list-query";
import {
  invalidateProductListResponseCaches,
  updateCachedProductListSummariesForProductChange,
} from "@/lib/products/product-list-cache";
import { getProductWorkflowStage } from "@/lib/products/workflow";
import { applyProductListSummaryChange } from "@/lib/products/product-list-summary";
import type { Product } from "@/lib/products/types";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const visibleEntityTypes = new Set<VersionedEntityType>([
  "ai_model_setting",
  "external_integration_setting",
  "product",
  "listing_ai_workspace",
  "ppc_workspace_snapshot",
  "rule_config",
  "file_object",
  "import_job",
  "export_record",
]);

function isVersionedEntityType(value: string | null): value is VersionedEntityType {
  return Boolean(value && visibleEntityTypes.has(value as VersionedEntityType));
}

function isRestorableEntityType(value: VersionedEntityType) {
  return (
    value === "ai_model_setting" ||
    value === "product" ||
    value === "listing_ai_workspace" ||
    value === "ppc_workspace_snapshot" ||
    value === "rule_config"
  );
}

function clampPageSize(value: string | null) {
  const pageSize = Number(value) || 50;
  return Math.min(Math.max(pageSize, 1), 100);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toInputJsonValue(value: Prisma.JsonValue): Prisma.InputJsonValue {
  return value === null ? {} : (value as Prisma.InputJsonValue);
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("versions", "view", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const url = new URL(request.url);
    const entityType = url.searchParams.get("entityType");
    const entityId = url.searchParams.get("entityId")?.trim();
    const scope = workspaceScopeFromRequest(request);
    const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
    const pageSize = clampPageSize(url.searchParams.get("pageSize"));
    const where: Prisma.DataChangeVersionWhereInput = {
      organizationId: user.organizationId,
      workspaceId: scope.workspaceId,
      ...(isVersionedEntityType(entityType) ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
    };
    const [total, versions] = await Promise.all([
      prisma.dataChangeVersion.count({ where }),
      prisma.dataChangeVersion.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { version: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({
      versions,
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load versions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("versions", "edit", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as { versionId?: unknown; workspaceId?: unknown; accountId?: unknown; marketplace?: unknown };
    const versionId = typeof body.versionId === "string" ? body.versionId : "";

    if (!versionId) {
      return NextResponse.json({ error: "Version id is required." }, { status: 400 });
    }

    const version = await prisma.dataChangeVersion.findFirst({
      where: {
        id: versionId,
        organizationId: user.organizationId,
      },
    });

    if (!version || !isVersionedEntityType(version.entityType)) {
      return NextResponse.json({ error: "Version not found." }, { status: 404 });
    }

    if (!isRestorableEntityType(version.entityType)) {
      return NextResponse.json({ error: "This version type is audit-only and cannot be restored." }, { status: 400 });
    }

    const scope = workspaceScopeFromRequest(request, {
      workspaceId: body.workspaceId ?? version.workspaceId,
      accountId: body.accountId ?? version.accountId,
      marketplace: body.marketplace ?? version.marketplace,
    });
    const payload = toInputJsonValue(version.payload);

    if (version.entityType === "product") {
      const product = version.payload as unknown as Product;
      let existingProduct: Partial<Product> | null | undefined;

      await prisma.$transaction(async (tx) => {
        const existingRecord = await tx.productRecord.findUnique({
          where: {
            organizationId_workspaceId_sku: {
              organizationId: user.organizationId,
              workspaceId: scope.workspaceId,
              sku: product.sku,
            },
          },
          select: {
            payload: true,
          },
        });
        existingProduct = existingRecord?.payload as Partial<Product> | undefined;

        await tx.productRecord.upsert({
          where: {
            organizationId_workspaceId_sku: {
              organizationId: user.organizationId,
              workspaceId: scope.workspaceId,
              sku: product.sku,
            },
          },
          create: {
            id: product.id,
            organizationId: user.organizationId,
            userId: user.id,
            workspaceId: scope.workspaceId,
            accountId: scope.accountId,
            marketplace: scope.marketplace,
            sku: product.sku,
            payload: product as unknown as Prisma.InputJsonValue,
            chineseName: product.chineseName,
            englishName: product.englishName,
            asin: product.asin,
            status: product.status,
            source: getProductRecordSource(product),
            supplierName: product.supplierName,
            purchasePrice: product.purchasePrice,
            selectionOwner: product.selectionOwner || product.developer || "",
            opsAssignee: product.opsAssignee || "",
            designerAssignee: product.designerAssignee || "",
            currentOwner: getProductRecordCurrentOwner(product),
            workflowStage: getProductWorkflowStage(product),
            workflowDueAt: product.workflowDueAt ? new Date(product.workflowDueAt) : null,
            isOverdue: getProductRecordIsOverdue(product),
            operationsProgressIncomplete: isProductOperationsProgressIncomplete(product),
          },
          update: {
            userId: user.id,
            accountId: scope.accountId,
            marketplace: scope.marketplace,
            payload: product as unknown as Prisma.InputJsonValue,
            chineseName: product.chineseName,
            englishName: product.englishName,
            asin: product.asin,
            status: product.status,
            source: getProductRecordSource(product),
            supplierName: product.supplierName,
            purchasePrice: product.purchasePrice,
            selectionOwner: product.selectionOwner || product.developer || "",
            opsAssignee: product.opsAssignee || "",
            designerAssignee: product.designerAssignee || "",
            currentOwner: getProductRecordCurrentOwner(product),
            workflowStage: getProductWorkflowStage(product),
            workflowDueAt: product.workflowDueAt ? new Date(product.workflowDueAt) : null,
            isOverdue: getProductRecordIsOverdue(product),
            operationsProgressIncomplete: isProductOperationsProgressIncomplete(product),
          },
        });

        await applyProductListSummaryChange(tx, {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          before: existingProduct,
          after: product,
        });
      });

      await invalidateProductListResponseCaches(`${user.organizationId}:${scope.workspaceId}:`);
      updateCachedProductListSummariesForProductChange({
        organizationId: user.organizationId,
        workspaceId: scope.workspaceId,
        before: existingProduct,
        after: product,
      });
    }

    if (version.entityType === "listing_ai_workspace" && isRecord(version.payload)) {
      await prisma.listingAiWorkspace.upsert({
        where: {
          organizationId_workspaceId_userId: {
            organizationId: user.organizationId,
            workspaceId: scope.workspaceId,
            userId: user.id,
          },
        },
        create: {
          organizationId: user.organizationId,
          userId: user.id,
          workspaceId: scope.workspaceId,
          accountId: scope.accountId,
          marketplace: scope.marketplace,
          draft: (version.payload.draft ?? {}) as Prisma.InputJsonValue,
          records: (version.payload.records ?? []) as Prisma.InputJsonValue,
        },
        update: {
          accountId: scope.accountId,
          marketplace: scope.marketplace,
          draft: (version.payload.draft ?? {}) as Prisma.InputJsonValue,
          records: (version.payload.records ?? []) as Prisma.InputJsonValue,
        },
      });
    }

    if (version.entityType === "ai_model_setting" && isRecord(version.payload)) {
      const settings = {
        text: normalizeAiSettings(version.payload.settings as Partial<AiModelSettings> | undefined),
        image: normalizeAiImageSettings(version.payload.imageSettings as Partial<AiModelSettings> | undefined),
      };
      const profiles = normalizeSavedAiModelProfiles(version.payload.profiles);
      const nextProfiles = profiles.length
        ? profiles
        : createSavedAiModelProfilePair(settings.text, settings.image, createAiProfileName(settings.text));
      const activeProfileId =
        typeof version.payload.activeProfileId === "string"
          ? version.payload.activeProfileId
          : nextProfiles.find((profile) => profile.kind === "system")?.id || "";

      await ensureCurrentUserRecord(user);
      await prisma.aiModelSetting.upsert({
        where: {
          organizationId_workspaceId_userId: {
            organizationId: user.organizationId,
            workspaceId: scope.workspaceId,
            userId: user.id,
          },
        },
        create: {
          organizationId: user.organizationId,
          userId: user.id,
          workspaceId: scope.workspaceId,
          accountId: scope.accountId,
          marketplace: scope.marketplace,
          activeProfileId,
          settings: settings as unknown as Prisma.InputJsonValue,
          profiles: nextProfiles as unknown as Prisma.InputJsonValue,
        },
        update: {
          accountId: scope.accountId,
          marketplace: scope.marketplace,
          activeProfileId,
          settings: settings as unknown as Prisma.InputJsonValue,
          profiles: nextProfiles as unknown as Prisma.InputJsonValue,
        },
      });
    }

    if (version.entityType === "ppc_workspace_snapshot") {
      await prisma.workspaceSnapshot.upsert({
        where: {
          organizationId_workspaceId_userId: {
            organizationId: user.organizationId,
            workspaceId: scope.workspaceId,
            userId: user.id,
          },
        },
        create: {
          organizationId: user.organizationId,
          userId: user.id,
          workspaceId: scope.workspaceId,
          accountId: scope.accountId,
          marketplace: scope.marketplace,
          version: 1,
          savedAt: new Date(),
          snapshot: payload,
        },
        update: {
          accountId: scope.accountId,
          marketplace: scope.marketplace,
          savedAt: new Date(),
          snapshot: payload,
        },
      });
    }

    if (version.entityType === "rule_config") {
      const current = await prisma.workspaceSnapshot.findUnique({
        where: {
          organizationId_workspaceId_userId: {
            organizationId: user.organizationId,
            workspaceId: scope.workspaceId,
            userId: user.id,
          },
        },
      });
      const snapshot = isRecord(current?.snapshot) ? current.snapshot : {};

      await prisma.workspaceSnapshot.upsert({
        where: {
          organizationId_workspaceId_userId: {
            organizationId: user.organizationId,
            workspaceId: scope.workspaceId,
            userId: user.id,
          },
        },
        create: {
          organizationId: user.organizationId,
          userId: user.id,
          workspaceId: scope.workspaceId,
          accountId: scope.accountId,
          marketplace: scope.marketplace,
          version: 1,
          savedAt: new Date(),
          snapshot: { ...snapshot, rules: version.payload } as Prisma.InputJsonValue,
        },
        update: {
          accountId: scope.accountId,
          marketplace: scope.marketplace,
          savedAt: new Date(),
          snapshot: { ...snapshot, rules: version.payload } as Prisma.InputJsonValue,
        },
      });
    }

    await recordDataChangeVersion({
      user,
      entityType: version.entityType,
      entityId: version.entityId,
      action: `${version.entityType}_restore`,
      summary: `恢复到版本 ${version.version}`,
      payload,
      scope,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to restore version.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
