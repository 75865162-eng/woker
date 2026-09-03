import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
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

async function createProductImageAssetFromDataUrl(fileName: string, value: string): Promise<ProductImageAsset | null> {
  const parsed = parseDataUrl(value);
  if (!parsed) {
    return null;
  }

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

  return {
    id: originalKey,
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
    id: fileName,
    name: fileName,
    mimeType: "image/jpeg",
    size: 0,
    storageType: getStorageType(),
    uploadedAt: new Date().toISOString(),
    thumbUrl: value,
    originalUrl: value,
  };
}

async function backfillProduct(product: ProductWithWorkbook) {
  const imageAssets: ProductImageAsset[] = [];
  let changed = false;
  let originalDataUrlBytes = 0;

  const nextImages = await Promise.all(
    (Array.isArray(product.images) ? product.images : []).map(async (image, index) => {
      if (!isDataUrl(image)) {
        return image;
      }

      const asset = await createProductImageAssetFromDataUrl(`${product.sku || "product"}-${index + 1}.png`, image);
      if (!asset) {
        return image;
      }

      changed = true;
      originalDataUrlBytes += image.length;
      imageAssets.push(asset);
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

      const asset = await createProductImageAssetFromDataUrl(`${product.sku || "product"}-remark-${index + 1}.png`, image);
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
        const asset = await createProductImageAssetFromDataUrl(`${product.sku || "product"}-competitor-${index + 1}.png`, competitor.hotVariantImage || "");
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
        const asset = await createProductImageAssetFromDataUrl(`${product.sku || "product"}-competitor-note-${index + 1}.png`, competitor.noteImage || "");
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
    imageAssets: imageAssets.length ? imageAssets : product.imageAssets,
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
  let offset = 0;
  let scanned = 0;
  let changedRecords = 0;
  let changedImages = 0;
  let estimatedBytes = 0;

  while (true) {
    const records = await prisma.productRecord.findMany({
      select: {
        id: true,
        organizationId: true,
        workspaceId: true,
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
      const result = await backfillProduct(product);
      if (!result.changed || !("nextPayload" in result)) {
        continue;
      }

      changedRecords += 1;
      changedImages += result.imageCount;
      estimatedBytes += result.originalDataUrlBytes;

      if (applyChanges) {
        await prisma.productRecord.update({
          where: {
            id: record.id,
          },
          data: {
            payload: result.nextPayload as Prisma.InputJsonValue,
          },
        });
      }
    }

    offset += records.length;
  }

  const mode = applyChanges ? "applied" : "dry-run";
  console.log(
    `[products] image asset backfill ${mode}: scanned ${scanned.toLocaleString("zh-CN")} records, ` +
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
