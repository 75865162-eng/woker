import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { parseReportingV1GzipJson, parseReportingV1GzipJsonParts, ReportingV1JsonNumber } from "../src/lib/amazon-ads/reporting-v1-json";

const gzip = (value: string) => gzipSync(Buffer.from(value));

test("bounded GZIP_JSON reader validates syntax and preserves exact numeric lexemes", () => {
  const text = '{"large":900719925474099312345,"nested":[true,null,"x"]}';
  const parsed = parseReportingV1GzipJson(gzip(text));
  assert.ok(parsed.value && !Array.isArray(parsed.value) && !(parsed.value instanceof ReportingV1JsonNumber));
  assert.equal((parsed.value as Record<string, ReportingV1JsonNumber>).large.source, "900719925474099312345");
  assert.equal(parsed.uncompressedBytes, Buffer.byteLength(text));
});

test("duplicate decoded keys, malformed UTF-8/JSON and trailing bytes fail closed", () => {
  for (const value of ['{"currency":"USD","\\u0063urrency":"USD"}', '{"a":1,"\\u0061":2}', '{"a":01}', '{"a":1} false']) {
    assert.throws(() => parseReportingV1GzipJson(gzip(value)), { message: "ADS_REPORT_V1_JSON_INVALID" });
  }
  assert.throws(() => parseReportingV1GzipJson(gzipSync(Buffer.from([0xff, 0xfe]))), { message: "ADS_REPORT_V1_JSON_INVALID" });
});

test("decompression, depth, value count and report-wide expanded limits are bounded", () => {
  assert.throws(() => parseReportingV1GzipJson(gzip("[" + " ".repeat(300) + "0]"), { compressedPartBytes: 1024, uncompressedPartBytes: 128, uncompressedReportBytes: 1024, valuesPerPart: 20, maxDepth: 8 }), { message: "ADS_REPORT_V1_GZIP_INVALID_OR_LIMIT" });
  assert.throws(() => parseReportingV1GzipJson(gzip("[1,2]"), { compressedPartBytes: 1024, uncompressedPartBytes: 1024, uncompressedReportBytes: 4, valuesPerPart: 20, maxDepth: 8 }), { message: "ADS_REPORT_V1_GZIP_INVALID_OR_LIMIT" });
  for (const uncompressedReportBytes of [0, -1, Infinity, NaN, 1.5, 32 * 1024 * 1024 + 1]) {
    assert.throws(() => parseReportingV1GzipJson(gzip("{}"), { compressedPartBytes: 1024, uncompressedPartBytes: 1024, uncompressedReportBytes, valuesPerPart: 20, maxDepth: 8 }), { message: "ADS_REPORT_V1_COMPRESSED_LIMIT" });
  }
  assert.equal(parseReportingV1GzipJson(gzip("[1,2]"), { compressedPartBytes: 1024, uncompressedPartBytes: 1024, uncompressedReportBytes: 5, valuesPerPart: 20, maxDepth: 8 }).uncompressedBytes, 5);
  assert.throws(() => parseReportingV1GzipJson(gzip("[[[[[[[[[[0]]]]]]]]]]"), { compressedPartBytes: 1024, uncompressedPartBytes: 1024, uncompressedReportBytes: 1024, valuesPerPart: 100, maxDepth: 4 }), { message: "ADS_REPORT_V1_JSON_INVALID" });
  assert.throws(() => parseReportingV1GzipJson(gzip("[1,2,3,4]"), { compressedPartBytes: 1024, uncompressedPartBytes: 1024, uncompressedReportBytes: 1024, valuesPerPart: 3, maxDepth: 8 }), { message: "ADS_REPORT_V1_JSON_INVALID" });
  assert.throws(() => parseReportingV1GzipJsonParts([gzip("{}"), gzip("{}")], 2), { message: "ADS_REPORT_V1_EXPANDED_REPORT_LIMIT" });
});

test("report parts are validated independently and part count is bounded", () => {
  assert.equal(parseReportingV1GzipJsonParts([gzip('[{"part":1}]'), gzip('[{"part":2}]')]).parts.length, 2);
  assert.throws(() => parseReportingV1GzipJsonParts([]), { message: "ADS_REPORT_V1_PART_COUNT_INVALID" });
  assert.throws(() => parseReportingV1GzipJsonParts(Array(101).fill(gzip("{}"))), { message: "ADS_REPORT_V1_PART_COUNT_INVALID" });
});
