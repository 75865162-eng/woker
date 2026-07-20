export function makeId(prefix: string) {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (randomUUID) {
    return `${prefix}-${randomUUID.call(globalThis.crypto)}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function parseNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/US\$/gi, "").replace(/[^\d.-]/g, "").trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function downloadFilesAsZip(files: { fileName: string; blob: Blob }[], archiveName: string) {
  const JSZipModule = await import("jszip");
  const zip = new JSZipModule.default();

  files.forEach((file) => {
    zip.file(file.fileName, file.blob);
  });

  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, archiveName);
}

export function formatMetricNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function inferPdfMetaFromFileName(fileName: string) {
  const baseName = fileName.replace(/\.pdf$/i, "");
  const parts = baseName.split("-");

  let shipmentName = "";
  let warehouseCode = "";
  let fbaCode = "";
  let totalBoxes: number | null = null;
  let channelName = "";

  for (const part of parts) {
    if (!shipmentName && /^货件\d+$/u.test(part)) {
      shipmentName = part;
      continue;
    }

    if (!warehouseCode && /^[A-Z]{3,5}\d*$/u.test(part)) {
      warehouseCode = part;
      continue;
    }

    if (!fbaCode && /^FBA[A-Z0-9]+$/u.test(part)) {
      fbaCode = part;
      continue;
    }

    if (part.endsWith("箱")) {
      const parsed = Number(part.replace(/[^\d]/g, ""));
      totalBoxes = Number.isFinite(parsed) ? parsed : null;
      continue;
    }
  }

  const channelStartIndex = parts.findIndex((part) => part.endsWith("箱"));
  if (channelStartIndex >= 0 && channelStartIndex < parts.length - 1) {
    channelName = parts.slice(channelStartIndex + 1).join("-");
  } else if (parts.length > 0) {
    channelName = parts.at(-1) ?? "";
  }

  const renamedFileName = [shipmentName, warehouseCode, fbaCode, totalBoxes ? `${totalBoxes}箱` : ""]
    .filter(Boolean)
    .join("-")
    .concat(".pdf");

  const shipmentTitle = [shipmentName, warehouseCode, fbaCode, totalBoxes ? `${totalBoxes}箱` : "", channelName]
    .filter(Boolean)
    .join("-");

  return {
    fileNameBase: baseName,
    shipmentTitle,
    shipmentName,
    warehouseCode,
    fbaCode,
    totalBoxes,
    channelName,
    renamedFileName: renamedFileName === ".pdf" ? fileName : renamedFileName,
  };
}
