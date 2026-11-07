import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { decodeReportParts, reportRangeHeaders, validateReportRange, reportDownloadPartSize, type ReportDownloadPart } from "../src/lib/amazon/report-download-range";
function response(offset: number, total: number, etag = '"fixture-etag"', status = 206) { const end = Math.min(offset + reportDownloadPartSize, total) - 1; return new Response(null, { status, headers: { "content-range": `bytes ${offset}-${end}/${total}`, "content-length": String(end - offset + 1), etag } }); }
test("report ranges bind offset, total and strong ETag and reject unsupported responses", () => {
  assert.deepEqual(reportRangeHeaders({ offset: 0 }), { Range: "bytes=0-262143", "Accept-Encoding": "identity" });
  const position = { offset: reportDownloadPartSize, total: reportDownloadPartSize + 10, etag: '"fixture-etag"' };
  assert.equal(reportRangeHeaders(position)["If-Match"], position.etag);
  assert.equal(validateReportRange(response(position.offset, position.total), position).total, position.total);
  for (const bad of [response(0, position.total), response(position.offset, position.total, '"changed"'), response(position.offset, position.total + 1), response(position.offset, position.total, position.etag, 200)]) assert.throws(() => validateReportRange(bad, position));
  assert.throws(() => reportRangeHeaders({ offset: 2 }));
  assert.throws(() => validateReportRange(response(0, 16 * 1024 * 1024 + 1), { offset: 0 }));
});
test("report assembly requires every contiguous part and decodes bounded gzip only when complete", () => {
  const bytes = Buffer.from("x".repeat(reportDownloadPartSize + 10));
  const part = (offset: number): ReportDownloadPart => ({ bytes: bytes.subarray(offset, offset + reportDownloadPartSize), offset, total: bytes.length, etag: '"fixture-etag"', compressionAlgorithm: null, charset: "utf-8" });
  assert.equal(decodeReportParts([part(0), part(reportDownloadPartSize)]), bytes.toString());
  assert.throws(() => decodeReportParts([part(0)]));
  assert.throws(() => decodeReportParts([part(reportDownloadPartSize), part(0)]));
  assert.throws(() => decodeReportParts([part(0), { ...part(reportDownloadPartSize), etag: '"other"' }]));
  const compressed = gzipSync("date\tamount\n2026-11-01\t1.00");
  assert.equal(decodeReportParts([{ bytes: compressed, offset: 0, total: compressed.length, etag: '"gzip"', compressionAlgorithm: "GZIP", charset: "utf-8" }]), "date\tamount\n2026-11-01\t1.00");
});
