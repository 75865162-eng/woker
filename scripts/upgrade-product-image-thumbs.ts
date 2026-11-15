import sharp from "sharp";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import { isPlaceholderProductImageAssetId } from "@/lib/products/image-assets";

// 商品详情页左上角主图分辨率从 160×160 升级到 250×250：
// 就地重生成已有商品图片的 thumb（同一 storageKey 覆盖写，不改 payload、不新建 fileObject）。
// 默认 dry-run 只统计；加 --apply 执行覆盖写并同步 fileObject.size。
const applyChanges = process.argv.includes("--apply");
const batchSize = 50;
const thumbSize = 250;

type AssetPair = { originalFileId: string; thumbFileId: string };

function collectAssetPairs(value: unknown, pairs: Map<string, AssetPair>) {
  if (Array.isArray(value)) {
    for (const item of value) collectAssetPairs(item, pairs);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const thumbFileId = typeof record.thumbFileId === "string" ? record.thumbFileId : "";
  if (
    id && thumbFileId && id !== thumbFileId
    && !isPlaceholderProductImageAssetId(id) && !isPlaceholderProductImageAssetId(thumbFileId)
  ) {
    if (!pairs.has(thumbFileId)) pairs.set(thumbFileId, { originalFileId: id, thumbFileId });
  }
  for (const item of Object.values(record)) collectAssetPairs(item, pairs);
}

async function main() {
  const pairsByOrganization = new Map<string, Map<string, AssetPair>>();
  let offset = 0;
  let scannedRecords = 0;

  while (true) {
    const records = await prisma.productRecord.findMany({
      select: { organizationId: true, payload: true },
      orderBy: { createdAt: "asc" },
      skip: offset,
      take: batchSize,
    });
    if (!records.length) break;
    for (const record of records) {
      scannedRecords += 1;
      let pairs = pairsByOrganization.get(record.organizationId);
      if (!pairs) {
        pairs = new Map();
        pairsByOrganization.set(record.organizationId, pairs);
      }
      collectAssetPairs(record.payload, pairs);
    }
    offset += records.length;
  }

  const totalPairs = [...pairsByOrganization.values()].reduce((sum, pairs) => sum + pairs.size, 0);
  console.log(
    `[products] thumb 250 upgrade mode=${applyChanges ? "apply" : "dry-run"}; scanned ${scannedRecords} records; ` +
      `${totalPairs} thumb/original pairs`,
  );

  const storage = getStorageDriver();
  const storageType = getStorageType();
  let regenerated = 0;
  let skipped = 0;
  let failed = 0;

  for (const [organizationId, pairs] of pairsByOrganization) {
    for (const pair of pairs.values()) {
      try {
        const [original, thumb] = await Promise.all([
          prisma.fileObject.findFirst({
            where: { id: pair.originalFileId, organizationId, storageType },
            select: { storageKey: true },
          }),
          prisma.fileObject.findFirst({
            where: { id: pair.thumbFileId, organizationId, storageType },
            select: { storageKey: true, originalName: true },
          }),
        ]);
        if (!original?.storageKey || !thumb?.storageKey || !thumb.storageKey.startsWith("assets/products/")) {
          skipped += 1;
          continue;
        }
        if (!applyChanges) {
          regenerated += 1;
          continue;
        }
        const sourceBuffer = await storage.getBuffer(original.storageKey);
        const thumbBuffer = await sharp(sourceBuffer, { limitInputPixels: 100_000_000 })
          .rotate()
          .resize({ width: thumbSize, height: thumbSize, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();
        await storage.putBuffer({ key: thumb.storageKey, buffer: thumbBuffer, contentType: "image/webp" });
        await prisma.fileObject.update({ where: { id: pair.thumbFileId }, data: { size: thumbBuffer.byteLength } });
        regenerated += 1;
      } catch (error) {
        failed += 1;
        console.error(`[products] thumb 250 upgrade failed for ${pair.thumbFileId}:`, error instanceof Error ? error.message : error);
      }
    }
  }

  console.log(
    `[products] thumb 250 upgrade ${applyChanges ? "applied" : "dry-run"}: regenerated ${regenerated}, skipped ${skipped}, failed ${failed}`,
  );
  if (!applyChanges) console.log("[products] dry-run only; rerun with --apply to overwrite thumb objects in place.");
}

main()
  .catch((error: unknown) => {
    console.error("[products] thumb 250 upgrade failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
