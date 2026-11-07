import { gunzipSync } from "node:zlib";
export const reportDownloadLimit = 16 * 1024 * 1024;
export const reportDownloadPartSize = 256 * 1024;
export type ReportDownloadPart = { bytes: Uint8Array; offset: number; total: number; etag: string; compressionAlgorithm: "GZIP" | null; charset: string };
export type ReportDownloadPosition = { offset: number; total?: number; etag?: string };
export function reportRangeHeaders(position: ReportDownloadPosition) {
  if (!Number.isInteger(position.offset) || position.offset < 0 || position.offset >= reportDownloadLimit || (position.offset > 0 && (!position.etag || !Number.isInteger(position.total) || position.total! <= position.offset || position.total! > reportDownloadLimit))) throw new Error("Invalid bounded report position");
  if (position.etag !== undefined && !/^"[A-Za-z0-9-]{1,128}"$/.test(position.etag)) throw new Error("Invalid report entity tag");
  return { Range: `bytes=${position.offset}-${Math.min(position.offset + reportDownloadPartSize, position.total ?? reportDownloadLimit) - 1}`, "Accept-Encoding": "identity", ...(position.etag ? { "If-Match": position.etag } : {}) };
}
export function validateReportRange(response: Response, position: ReportDownloadPosition) {
  const match = new RegExp("^bytes ([0-9]+)-([0-9]+)/([0-9]+)$").exec(response.headers.get("content-range") ?? "");
  const etag = response.headers.get("etag") ?? "";
  if (response.status !== 206 || !match || !/^"[A-Za-z0-9-]{1,128}"$/.test(etag) || (position.etag && etag !== position.etag) || ![null, "identity"].includes(response.headers.get("content-encoding"))) throw new Error("Report range unsupported or object changed");
  const [offset, end, total] = match.slice(1).map(Number);
  if (offset !== position.offset || !Number.isSafeInteger(total) || total < 1 || total > reportDownloadLimit || end !== Math.min(offset + reportDownloadPartSize, total) - 1 || end < offset || (position.total !== undefined && position.total !== total) || Number(response.headers.get("content-length")) !== end - offset + 1) throw new Error("Report range boundary mismatch");
  const declared = (response.headers.get("content-type") ?? "").split(";").map(value => value.trim()).find(value => value.toLowerCase().startsWith("charset="));
  const charset = declared ? declared.slice(8).trim().replaceAll(String.fromCharCode(34), "").replaceAll(String.fromCharCode(39), "").toLowerCase() : "utf-8";
  if (!["utf-8", "utf8", "cp1252", "windows-1252"].includes(charset)) throw new Error("Unsupported report charset");
  return { offset, end, total, etag, charset };
}
export function decodeReportParts(parts: ReportDownloadPart[]) {
  if (!parts.length || parts.length > reportDownloadLimit / reportDownloadPartSize) throw new Error("Invalid report part count");
  const first = parts[0]; let offset = 0;
  if (!Number.isSafeInteger(first.total) || first.total < 1 || first.total > reportDownloadLimit || ![null, "GZIP"].includes(first.compressionAlgorithm) || !["utf-8", "utf8", "cp1252", "windows-1252"].includes(first.charset)) throw new Error("Invalid report object metadata");
  for (const part of parts) {
    if (part.offset !== offset || part.total !== first.total || part.etag !== first.etag || part.charset !== first.charset || part.compressionAlgorithm !== first.compressionAlgorithm || part.bytes.byteLength !== Math.min(reportDownloadPartSize, first.total - offset)) throw new Error("Report parts are not a complete consistent object");
    offset += part.bytes.byteLength;
  }
  if (offset !== first.total || offset > reportDownloadLimit) throw new Error("Incomplete report object");
  const data = Buffer.concat(parts.map(part => Buffer.from(part.bytes)));
  const decoded = first.compressionAlgorithm === "GZIP" ? gunzipSync(data, { maxOutputLength: reportDownloadLimit }) : data;
  return new TextDecoder(["cp1252", "windows-1252"].includes(first.charset) ? "windows-1252" : "utf-8", { fatal: true }).decode(decoded);
}
