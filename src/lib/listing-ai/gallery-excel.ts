import type {
  GalleryCellStyle,
  GalleryExcelCell,
  ImagePreview,
} from "@/lib/listing-ai/workspace-draft";

export function galleryCellKey(rowLabel: string, columnKey: string) {
  return `${rowLabel}::${columnKey}`;
}

export function normalizeGalleryRedRanges(
  value: string,
  style?: GalleryCellStyle,
) {
  return (style?.redRanges ?? [])
    .map((range) => ({
      start: Math.max(0, Math.min(value.length, range.start)),
      end: Math.max(0, Math.min(value.length, range.end)),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
}

export function applyGalleryCellStyleToExcelCell(
  cell: GalleryExcelCell,
  style?: GalleryCellStyle,
) {
  if (!style) return;
  if (style.redText) {
    cell.font = {
      ...(cell.font ?? {}),
      bold: true,
      color: { argb: "FFFF0000" },
    };
  }
  if (style.yellowBg) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFFF00" },
    };
  }
}

export function setExcelCellText(
  cell: GalleryExcelCell,
  value: string,
  style?: GalleryCellStyle,
) {
  const ranges = normalizeGalleryRedRanges(value, style);
  if (!ranges.length) {
    cell.value = value;
    return;
  }

  const richText: Array<{
    text: string;
    font?: { bold?: boolean; color?: { argb: string } };
  }> = [];
  let cursor = 0;
  ranges.forEach((range) => {
    const start = Math.max(cursor, range.start);
    const end = Math.max(start, range.end);
    if (start > cursor) richText.push({ text: value.slice(cursor, start) });
    richText.push({
      text: value.slice(start, end),
      font: { bold: true, color: { argb: "FFFF0000" } },
    });
    cursor = end;
  });
  if (cursor < value.length) richText.push({ text: value.slice(cursor) });
  cell.value = { richText };
}

export function excelCellStyleToGalleryStyle(cell: GalleryExcelCell) {
  const fontColor = cell.font?.color?.argb?.toUpperCase() ?? "";
  const fillColor = (
    cell.fill?.fgColor?.argb ??
    cell.fill?.bgColor?.argb ??
    ""
  ).toUpperCase();
  const style: GalleryCellStyle = {};
  if (fontColor.endsWith("FF0000")) style.redText = true;
  if (fillColor.endsWith("FFFF00")) style.yellowBg = true;
  const value = cell.value as {
    richText?: Array<{
      text?: string;
      font?: { color?: { argb?: string } };
    }>;
  };
  if (Array.isArray(value?.richText)) {
    let cursor = 0;
    const redRanges: Array<{ start: number; end: number }> = [];
    value.richText.forEach((part) => {
      const text = part.text ?? "";
      const start = cursor;
      const end = start + text.length;
      const partColor = part.font?.color?.argb?.toUpperCase() ?? "";
      if (partColor.endsWith("FF0000") && end > start) {
        redRanges.push({ start, end });
      }
      cursor = end;
    });
    if (redRanges.length) style.redRanges = redRanges;
  }
  return style;
}

export function mergeGalleryCellStyle(
  target: Record<string, GalleryCellStyle>,
  styleKey: string,
  style: GalleryCellStyle,
) {
  if (!style.redText && !style.yellowBg && !style.redRanges?.length) return;
  target[styleKey] = { ...(target[styleKey] ?? {}), ...style };
}

export function imageExtension(image: ImagePreview) {
  const lowerName = image.name.toLowerCase();
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "jpeg";
  if (lowerName.endsWith(".gif")) return "gif";
  return "png";
}

export function excelCellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "object") return String(value);

  const richValue = value as {
    richText?: Array<{ text?: string }>;
    text?: string;
    result?: unknown;
    formula?: string;
    hyperlink?: string;
  };
  if (Array.isArray(richValue.richText)) {
    return richValue.richText.map((part) => part.text ?? "").join("");
  }
  if (richValue.text !== undefined) return String(richValue.text);
  if (richValue.result !== undefined) return excelCellToText(richValue.result);
  if (richValue.formula !== undefined) return String(richValue.formula);
  if (richValue.hyperlink !== undefined) return String(richValue.hyperlink);

  return "";
}
