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

export function galleryImageRowCount(columns: ImagePreview[][], pendingRows: number[] = []): number {
  let lastRow = -1;
  for (const images of columns) {
    images.forEach((image, row) => { if (image?.url || image?.assetId) lastRow = Math.max(lastRow, row); });
  }
  for (const row of pendingRows) lastRow = Math.max(lastRow, row);
  return lastRow + 2;
}

export function clearGalleryImageAt(images: ImagePreview[], row: number): ImagePreview[] {
  const next = [...images];
  next[row] = { name: "", url: "" };
  while (next.length && !next[next.length - 1]?.url && !next[next.length - 1]?.assetId) next.pop();
  return next;
}
