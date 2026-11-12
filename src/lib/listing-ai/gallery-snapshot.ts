import type { ListingOptimizationRequest } from "./types";
import {
  createEmptyCompetitor,
  type CompetitorDraft,
  type GalleryCellStyle,
  type ImagePreview,
  type OwnImageDraft,
} from "./workspace-draft";

export const galleryInputKeys = [
  "asin", "mainSellingPoint1", "variationInfo", "currentTitle", "currentBullets", "aplusRequirements",
] as const;
export type GallerySnapshot = {
  competitors: CompetitorDraft[];
  ownImages: OwnImageDraft;
  input: Pick<ListingOptimizationRequest, typeof galleryInputKeys[number]>;
  cellStyles: Record<string, GalleryCellStyle>;
};
export type GallerySaveSummary = { id: string; name: string; savedBy: string; createdAt: string; thumbnailUrl?: string | null };

export class GallerySnapshotError extends Error {}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GallerySnapshotError("图片工作区数据格式不正确。");
  }
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 100_000) {
    throw new GallerySnapshotError("文字字段格式不正确或超过 100000 字。");
  }
  return value;
}
export function gallerySaveName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100) {
    throw new GallerySnapshotError("请输入名称（最多 100 字）。");
  }
  return value.trim();
}

function images(value: unknown): ImagePreview[] {
  if (!Array.isArray(value) || value.length > 200) {
    throw new GallerySnapshotError("图片列表格式不正确或超过 200 张。");
  }
  // Empty slots must keep their row positions through JSON serialization.
  return Array.from(value, (item) => {
    if (item == null) return { name: "", url: "" };
    const image = object(item);
    if (!image.assetId && !image.url) return { name: "", url: "" };
    const assetId = text(image.assetId);
    if (!/^assets\/listing-ai\/[a-zA-Z0-9_./-]+$/.test(assetId) || assetId.split("/").some(part => part === "." || part === "..")) {
      throw new GallerySnapshotError("图片尚未持久保存，请重新上传后再保存工作区。");
    }
    return { name: text(image.name), assetId, url: `/api/assets/${assetId.split("/").map(encodeURIComponent).join("/")}` };
  });
}

export function normalizeGallerySnapshot(value: unknown): GallerySnapshot {
  const snapshot = object(value);
  if (!Array.isArray(snapshot.competitors) || !snapshot.competitors.length || snapshot.competitors.length > 24) {
    throw new GallerySnapshotError("竞品列必须为 1 至 24 列。");
  }
  const competitors = snapshot.competitors.map((value) => {
    const source = object(value);
    const competitor = createEmptyCompetitor();
    for (const key of Object.keys(competitor) as Array<keyof CompetitorDraft>) {
      if (key === "images" || key === "mainImage" || key === "screenshot") competitor[key] = images(source[key] ?? []);
      else competitor[key] = text(source[key]);
    }
    return competitor;
  });
  const own = object(snapshot.ownImages);
  if (!Array.isArray(own.imageNotes) || own.imageNotes.length > 200) throw new GallerySnapshotError("图片备注格式不正确。");
  const ownImages: OwnImageDraft = {
    structureNotes: text(own.structureNotes),
    mainImage: images(own.mainImage ?? []), images: images(own.images ?? []),
    imageNotes: Array.from(own.imageNotes, note => note == null ? "" : text(note)),
    sales: text(own.sales), price: text(own.price), rating: text(own.rating), reviewCount: text(own.reviewCount),
  };
  const inputSource = object(snapshot.input);
  const input = Object.fromEntries(galleryInputKeys.map(key => [key, text(inputSource[key])])) as GallerySnapshot["input"];
  const styles = object(snapshot.cellStyles);
  if (Object.keys(styles).length > 10_000) throw new GallerySnapshotError("单元格格式数量过多。");
  const cellStyles: GallerySnapshot["cellStyles"] = {};
  for (const [key, value] of Object.entries(styles)) {
    if (key.length > 200) throw new GallerySnapshotError("单元格标识过长。");
    const style = object(value);
    const ranges = style.redRanges;
    if (ranges !== undefined && (!Array.isArray(ranges) || ranges.length > 1000)) throw new GallerySnapshotError("红字范围格式不正确。");
    cellStyles[key] = {
      redText: style.redText === true, yellowBg: style.yellowBg === true,
      ...(Array.isArray(ranges) ? { redRanges: ranges.map(value => {
        const range = object(value);
        if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || Number(range.start) < 0 || Number(range.end) <= Number(range.start)) {
          throw new GallerySnapshotError("红字范围格式不正确。");
        }
        return { start: Number(range.start), end: Number(range.end) };
      }) } : {}),
    };
  }
  return { competitors, ownImages, input, cellStyles };
}

export function galleryAssetIds(snapshot: GallerySnapshot): string[] {
  const images = [snapshot.ownImages.mainImage, snapshot.ownImages.images,
    ...snapshot.competitors.flatMap(item => [item.mainImage, item.screenshot, item.images])];
  return [...new Set(images.flat().flatMap(image => image.assetId ? [image.assetId] : []))];
}

// Follow the gallery's image row order, from competitor columns to Mine.
export function galleryThumbnailUrl(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  const competitors = Array.isArray(snapshot.competitors) ? snapshot.competitors : [];
  const columns = [...competitors, snapshot.ownImages].map(column => {
    if (!column || typeof column !== "object" || Array.isArray(column)) return [];
    const images = (column as Record<string, unknown>).images;
    return Array.isArray(images) ? images : [];
  });
  const rows = Math.max(0, ...columns.map(column => column.length));
  for (let row = 0; row < rows; row++) {
    for (const column of columns) {
      const image: unknown = column[row];
      if (!image || typeof image !== "object" || Array.isArray(image)) continue;
      const assetId = (image as Record<string, unknown>).assetId;
      if (typeof assetId !== "string" || !/^assets\/listing-ai\/[a-zA-Z0-9_./-]+$/.test(assetId)
        || assetId.split("/").some(part => part === "." || part === "..")) continue;
      return `/api/assets/${assetId.split("/").map(encodeURIComponent).join("/")}`;
    }
  }
  return null;
}
