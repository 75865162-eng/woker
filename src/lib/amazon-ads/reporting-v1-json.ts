import { gunzipSync } from "node:zlib";
import { TextDecoder } from "node:util";
import { AdsQueryError } from "./query-contract";

export class ReportingV1JsonNumber {
  constructor(readonly source: string) {}
}

export type ReportingV1JsonValue = null | boolean | string | ReportingV1JsonNumber | ReportingV1JsonValue[] | { [key: string]: ReportingV1JsonValue };

export type ReportingV1JsonLimits = { compressedPartBytes: number; uncompressedPartBytes: number; uncompressedReportBytes: number; valuesPerPart: number; maxDepth: number };
export const reportingV1JsonLimits: Readonly<ReportingV1JsonLimits> = Object.freeze({ compressedPartBytes: 8 * 1024 * 1024, uncompressedPartBytes: 8 * 1024 * 1024, uncompressedReportBytes: 32 * 1024 * 1024, valuesPerPart: 200_000, maxDepth: 64 });

/** Bounded GZIP_JSON syntax reader. It preserves number lexemes and rejects duplicate decoded object keys. */
export function parseReportingV1GzipJson(bytes: Buffer, limits: ReportingV1JsonLimits = reportingV1JsonLimits): { value: ReportingV1JsonValue; uncompressedBytes: number } {
  if (!Buffer.isBuffer(bytes) || !Number.isSafeInteger(limits.compressedPartBytes) || limits.compressedPartBytes < 1 || limits.compressedPartBytes > reportingV1JsonLimits.compressedPartBytes
    || !Number.isSafeInteger(limits.uncompressedPartBytes) || limits.uncompressedPartBytes < 1 || limits.uncompressedPartBytes > reportingV1JsonLimits.uncompressedPartBytes
    || !Number.isSafeInteger(limits.uncompressedReportBytes) || limits.uncompressedReportBytes < 1 || limits.uncompressedReportBytes > reportingV1JsonLimits.uncompressedReportBytes
    || !Number.isSafeInteger(limits.valuesPerPart) || limits.valuesPerPart < 1 || limits.valuesPerPart > reportingV1JsonLimits.valuesPerPart
    || !Number.isSafeInteger(limits.maxDepth) || limits.maxDepth < 1 || limits.maxDepth > reportingV1JsonLimits.maxDepth || bytes.length < 1 || bytes.length > limits.compressedPartBytes) throw new AdsQueryError("ADS_REPORT_V1_COMPRESSED_LIMIT");
  let decoded: Buffer;
  try { decoded = gunzipSync(bytes, { maxOutputLength: Math.min(limits.uncompressedPartBytes, limits.uncompressedReportBytes) }); }
  catch { throw new AdsQueryError("ADS_REPORT_V1_GZIP_INVALID_OR_LIMIT"); }
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(decoded); }
  catch { throw new AdsQueryError("ADS_REPORT_V1_JSON_INVALID"); }
  let offset = 0, values = 0;
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const invalid = (): never => { throw new AdsQueryError("ADS_REPORT_V1_JSON_INVALID"); };
  const whitespace = () => { while (offset < source.length && /[\x20\t\r\n]/.test(source[offset])) offset++; };
  const string = (): string => {
    const start = offset++;
    while (offset < source.length) {
      const character = source[offset++];
      if (character === "\\") { offset++; continue; }
      if (character === '"') { try { return JSON.parse(source.slice(start, offset)) as string; } catch { return invalid(); } }
    }
    return invalid();
  };
  const parse = (depth: number): ReportingV1JsonValue => {
    if (++values > limits.valuesPerPart || depth > limits.maxDepth) return invalid();
    whitespace();
    const character = source[offset];
    if (character === '"') return string();
    if (character === "{") {
      offset++; whitespace(); const result: { [key: string]: ReportingV1JsonValue } = Object.create(null);
      if (source[offset] === "}") { offset++; return result; }
      while (offset < source.length) {
        if (source[offset] !== '"') return invalid();
        const key = string(); whitespace();
        if (Object.hasOwn(result, key) || source[offset++] !== ":") return invalid();
        result[key] = parse(depth + 1); whitespace();
        const delimiter = source[offset++];
        if (delimiter === "}") return result;
        if (delimiter !== ",") return invalid();
        whitespace();
      }
      return invalid();
    }
    if (character === "[") {
      offset++; whitespace(); const result: ReportingV1JsonValue[] = [];
      if (source[offset] === "]") { offset++; return result; }
      while (offset < source.length) {
        result.push(parse(depth + 1)); whitespace();
        const delimiter = source[offset++];
        if (delimiter === "]") return result;
        if (delimiter !== ",") return invalid();
      }
      return invalid();
    }
    for (const [literal, decodedValue] of [["true", true], ["false", false], ["null", null]] as const) {
      if (source.startsWith(literal, offset)) { offset += literal.length; return decodedValue; }
    }
    number.lastIndex = offset;
    const match = number.exec(source);
    if (!match || match[0].length > 200) return invalid();
    offset = number.lastIndex;
    return new ReportingV1JsonNumber(match[0]);
  };
  const value = parse(0); whitespace();
  if (offset !== source.length) return invalid();
  return { value, uncompressedBytes: decoded.length };
}

/** Enforces a report-wide expanded-byte limit while checking each part independently. */
export function parseReportingV1GzipJsonParts(parts: readonly Buffer[], maxUncompressedBytes = reportingV1JsonLimits.uncompressedReportBytes) {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 100) throw new AdsQueryError("ADS_REPORT_V1_PART_COUNT_INVALID");
  if (!Number.isSafeInteger(maxUncompressedBytes) || maxUncompressedBytes < 1 || maxUncompressedBytes > reportingV1JsonLimits.uncompressedReportBytes) throw new AdsQueryError("ADS_REPORT_V1_LIMIT_INVALID");
  let total = 0;
  const results = parts.map(bytes => {
    const result = parseReportingV1GzipJson(bytes);
    total += result.uncompressedBytes;
    if (total > maxUncompressedBytes) throw new AdsQueryError("ADS_REPORT_V1_EXPANDED_REPORT_LIMIT");
    return result;
  });
  return { parts: results, uncompressedBytes: total };
}
