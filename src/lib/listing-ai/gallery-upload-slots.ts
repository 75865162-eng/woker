import type { ImagePreview } from "./workspace-draft";

// Reserve distinct empty rows before any asynchronous uploads start.
export function reserveGalleryUploadRows(images: ImagePreview[], pendingRows: number[], count: number, targetRow?: number): number[] {
  const pending = new Set(pendingRows);
  if (targetRow !== undefined) return pending.has(targetRow) ? [] : [targetRow];
  const rows: number[] = [];
  for (let row = 0; row < 200 && rows.length < count; row++) {
    if (!images[row]?.url && !images[row]?.assetId && !pending.has(row)) rows.push(row);
  }
  return rows;
}
