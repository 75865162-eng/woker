import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/db/prisma";
import { saveProductAggregate } from "@/lib/products/product-aggregate-service";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import type { Product, ProductImageAsset } from "@/lib/products/types";

type ProductWithWorkbook = Product & {
  workbookDetail?: {
    remarkImages?: string[];
    remarkImageAssets?: ProductImageAsset[];
    competitors?: Array<{
      hotVariantImage?: string;
      hotVariantImageAsset?: ProductImageAsset;
      noteImage?: string;
      noteImageAsset?: ProductImageAsset;
    }>;
  };
};

const batchSize = 50;
const applyChanges = process.argv.includes("--apply");
const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3).trim();
const organizationId = argument("organization-id");
const workspaceId = argument("workspace-id");
const actorUserId = argument("actor-user-id");
type BackfillScope = { organizationId: string; userId: string; workspaceId: string; accountId: string; marketplace: string };

function createAssetKey(fileName: string, variant: "original" | "thumb") {
  const extension = variant === "thumb" ? ".webp" : path.extname(fileName).toLowerCase() || ".bin";
  return `assets/products/backfill/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${variant}${extension}`;
}

function createAssetUrl(key: string) {
  return `/api/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function parseDataUrl(value: string) {
  const match = /^data:([^;]+);base64,(.+)$/u.exec(value.trim());
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function createProductImageAssetFromDataUrl(fileName: string, value: string, scope: BackfillScope): Promise<ProductImageAsset | null> {
  const parsed = parseDataUrl(value);
  if (!parsed) {
    return null;
  }
  // Dry-run must not create objects or database rows.
  if (!applyChanges) return {
    id: `product-image-dry-run-${fileName}`, name: fileName, mimeType: parsed.mimeType,
    size: parsed.buffer.length, storageType: getStorageType(), uploadedAt: "", thumbUrl: value, originalUrl: value,
  };

  const storage = getStorageDriver();
  const originalKey = createAssetKey(fileName, "original");
  const thumbKey = createAssetKey(fileName, "thumb");
  const originalContentType = parsed.mimeType || "application/octet-stream";
  const thumbBuffer = await sharp(parsed.buffer)
    .rotate()
    .resize({ width: 360, height: 360, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();

  const [original, thumb] = await Promise.all([
    storage.putBuffer({ key: originalKey, buffer: parsed.buffer, contentType: originalContentType }),
    storage.putBuffer({ key: thumbKey, buffer: thumbBuffer, contentType: "image/webp" }),
  ]);
  const [originalFile, thumbFile] = await prisma.$transaction([
    prisma.fileObject.create({ data: {
      ...scope, originalName: fileName, mimeType: originalContentType, size: original.size,
      storageKey: original.key, storageType: getStorageType(), status: "done", productBindingStatus: "temporary",
    } }),
    prisma.fileObject.create({ data: {
      ...scope, originalName: `${fileName}-thumb.webp`, mimeType: "image/webp", size: thumb.size,
      storageKey: thumb.key, storageType: getStorageType(), status: "done", productBindingStatus: "temporary",
    } }),
  ]);

  return {
    id: originalFile.id,
    thumbFileId: thumbFile.id,
    name: fileName,
    mimeType: originalContentType,
    size: original.size,
    storageType: getStorageType(),
    uploadedAt: new Date().toISOString(),
    thumbUrl: createAssetUrl(thumb.key),
    originalUrl: createAssetUrl(original.key),
  };
}

function isDataUrl(value: string | undefined) {
  return Boolean(value && value.startsWith("data:image/"));
}

function createSyntheticAssetFromUrl(fileName: string, value: string): ProductImageAsset {
  return {
    id: `product-image-${fileName}`,
    name: fileName,
    mimeType: "image/jpeg",
    size: 0,
    storageType: getStorageType(),
    uploadedAt: new Date().toISOString(),
    thumbUrl: value,
    originalUrl: value,
  };
}

async function backfillProduct(product: ProductWithWorkbook, scope: BackfillScope) {
  const imageAssets: ProductImageAsset[] = [...(product.imageAssets ?? [])];
  let changed = false;
  let originalDataUrlBytes = 0;

  const nextImages = await Promise.all(
    (Array.isArray(product.images) ? product.images : []).map(async (image, index) => {
      if (!isDataUrl(image)) {
        if (!imageAssets[index] && image.trim()) imageAssets[index] = createSyntheticAssetFromUrl(`${product.sku || "product"}-${index + 1}`, image);
        return image;
      }

      const asset = await createProductImageAssetFromDataUrl(`${product.sku || "product"}-${index + 1}.png`, image, scope);
      if (!asset) {
        return image;
      }

      changed = true;
      originalDataUrlBytes += image.length;
      imageAssets[index] = asset;
      return asset.thumbUrl;
    }),
  );

  const nextRemarkAssets: ProductImageAsset[] = [];
  const nextRemarkImages = await Promise.all(
    (Array.isArray(product.workbookDetail?.remarkImages) ? product.workbookDetail?.remarkImages : []).map(async (image, index) => {
      if (!image.trim()) {
        return image;
      }

      if (!isDataUrl(image)) {
        const existingAsset = product.workbookDetail?.remarkImageAssets?.[index];
        if (existingAsset) {
          nextRemarkAssets.push(existingAsset);
          return existingAsset.thumbUrl || image;
        }

        changed = true;
        const asset = createSyntheticAssetFromUrl(`${product.sku || "product"}-remark-${index + 1}`, image);
        nextRemarkAssets.push(asset);
        return image;
      }

      const asset = await createProductImageAssetFromDataUrl(`${product.sku || "product"}-remark-${index + 1}.png`, image, scope);
      if (!asset) {
        return image;
      }

      changed = true;
      originalDataUrlBytes += image.length;
      nextRemarkAssets.push(asset);
      return asset.thumbUrl;
    }),
  );

  const nextCompetitors = await Promise.all(
    (Array.isArray(product.workbookDetail?.competitors) ? product.workbookDetail?.competitors : []).map(async (competitor, index) => {
      let nextCompetitor = { ...competitor };

      if (isDataUrl(competitor.hotVariantImage)) {
        const asset = await createProductImageAssetFromDataUrl(`${product.sku || "product"}-competitor-${index + 1}.png`, competitor.hotVariantImage || "", scope);
        if (asset) {
          changed = true;
          originalDataUrlBytes += (competitor.hotVariantImage || "").length;
          nextCompetitor = { ...nextCompetitor, hotVariantImage: asset.thumbUrl, hotVariantImageAsset: asset };
        }
      } else if (competitor.hotVariantImageAsset) {
        nextCompetitor = {
          ...nextCompetitor,
          hotVariantImage: competitor.hotVariantImageAsset.thumbUrl || competitor.hotVariantImage,
          hotVariantImageAsset: competitor.hotVariantImageAsset,
        };
      } else if (competitor.hotVariantImage?.trim()) {
        changed = true;
        const asset = createSyntheticAssetFromUrl(`${product.sku || "product"}-competitor-${index + 1}.png`, competitor.hotVariantImage);
        nextCompetitor = {
          ...nextCompetitor,
          hotVariantImage: asset.thumbUrl,
          hotVariantImageAsset: asset,
        };
      }

      if (isDataUrl(competitor.noteImage)) {
        const asset = await createProductImageAssetFromDataUrl(`${product.sku || "product"}-competitor-note-${index + 1}.png`, competitor.noteImage || "", scope);
        if (asset) {
          changed = true;
          originalDataUrlBytes += (competitor.noteImage || "").length;
          nextCompetitor = { ...nextCompetitor, noteImage: asset.thumbUrl, noteImageAsset: asset };
        }
      } else if (competitor.noteImageAsset) {
        nextCompetitor = {
          ...nextCompetitor,
          noteImage: competitor.noteImageAsset.thumbUrl || competitor.noteImage,
          noteImageAsset: competitor.noteImageAsset,
        };
      } else if (competitor.noteImage?.trim()) {
        changed = true;
        const asset = createSyntheticAssetFromUrl(`${product.sku || "product"}-competitor-note-${index + 1}.png`, competitor.noteImage);
        nextCompetitor = {
          ...nextCompetitor,
          noteImage: asset.thumbUrl,
          noteImageAsset: asset,
        };
      }

      return nextCompetitor;
    }),
  );
  const nextWorkbookDetail = product.workbookDetail
    ? {
        ...product.workbookDetail,
        remarkImages: nextRemarkImages,
        remarkImageAssets: nextRemarkAssets,
        competitors: nextCompetitors,
      }
    : undefined;

  if (!changed) {
    return { changed: false, imageCount: 0, originalDataUrlBytes: 0 };
  }

  const nextPayload: ProductWithWorkbook = {
    ...product,
    images: nextImages,
    imageAssets: imageAssets.length ? imageAssets.filter(Boolean) : product.imageAssets,
    ...(nextWorkbookDetail ? { workbookDetail: nextWorkbookDetail } : {}),
  };

  return {
    changed: true,
    imageCount:
      imageAssets.length +
      nextRemarkAssets.length +
      nextCompetitors.reduce(
        (total, competitor) => total + (competitor.hotVariantImageAsset ? 1 : 0) + (competitor.noteImageAsset ? 1 : 0),
        0,
      ),
    originalDataUrlBytes,
    nextPayload,
  };
}

async function main() {
  if (applyChanges && (!organizationId || !actorUserId)) {
    throw new Error("--apply 必须同时指定 --organization-id=<id> 和 --actor-user-id=<id>；可用 --workspace-id=<id> 缩小范围。默认仅 dry-run。");
  }
  const actor = applyChanges ? await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: organizationId!, userId: actorUserId! } },
    include: { user: { select: { id: true, name: true, status: true } } },
  }) : null;
  if (applyChanges && (!actor || actor.user.status !== "active" || !["owner", "database_admin"].includes(actor.role))) {
    throw new Error("维护操作者必须是目标组织的有效 owner/database_admin，未执行任何上传或事实修改。");
  }
  console.log(`[products] image backfill mode=${applyChanges ? "apply" : "dry-run"}; organization=${organizationId ?? "all"}; workspace=${workspaceId ?? "all"}; actor=${actorUserId ?? "none"}`);
  let offset = 0;
  let scanned = 0;
  let changedRecords = 0;
  let changedImages = 0;
  let estimatedBytes = 0;

  while (true) {
    const records = await prisma.productRecord.findMany({
      where: { ...(organizationId ? { organizationId } : {}), ...(workspaceId ? { workspaceId } : {}) },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        workspaceId: true,
        accountId: true,
        marketplace: true,
        sku: true,
        revision: true,
        payload: true,
      },
      orderBy: {
        createdAt: "asc",
      },
      skip: offset,
      take: batchSize,
    });

    if (!records.length) {
      break;
    }

    scanned += records.length;

    for (const record of records) {
      const payload = record.payload as unknown;
      if (!payload || typeof payload !== "object") {
        continue;
      }

      const product = payload as ProductWithWorkbook;
      const result = await backfillProduct(product, {
        organizationId: record.organizationId, userId: actor?.user.id ?? record.userId, workspaceId: record.workspaceId,
        accountId: record.accountId, marketplace: record.marketplace,
      });
      if (!result.changed || !("nextPayload" in result)) {
        continue;
      }
      const nextPayload = result.nextPayload;
      if (!nextPayload) continue;

      changedRecords += 1;
      changedImages += result.imageCount;
      estimatedBytes += result.originalDataUrlBytes;

      if (applyChanges) {
        await prisma.$transaction(async (tx) => {
          await saveProductAggregate(tx, {
            product: { ...nextPayload, id: record.id, sku: record.sku },
            expectedRevision: record.revision,
            user: { id: actor!.user.id, organizationId: record.organizationId, name: `${actor!.user.name}（图片资产回填）` },
            scope: {
              organizationId: record.organizationId, workspaceId: record.workspaceId,
              accountId: record.accountId, marketplace: record.marketplace,
            },
          });
        });
      }
    }

    offset += records.length;
  }

  const mode = applyChanges ? "applied" : "dry-run";
  console.log(
    `[products] organization=${organizationId ?? "all"}; workspace=${workspaceId ?? "all"}; image asset backfill ${mode} (fact writes use aggregate CAS/audit/outbox): scanned ${scanned.toLocaleString("zh-CN")} records, ` +
      `changed ${changedRecords.toLocaleString("zh-CN")} records, ` +
      `converted ${changedImages.toLocaleString("zh-CN")} image groups, ` +
      `replaced roughly ${(estimatedBytes / 1024 / 1024).toFixed(1)} MB of inline data URLs`,
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown product image backfill error.";
    console.error("[products] image asset backfill failed:", message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
