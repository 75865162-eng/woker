import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoundedReportBody } from "../src/lib/amazon-ads/report-body";

test("bounded report body preserves exact bytes and releases its reader", async () => {
  const response = new Response("fixture", { headers: { "Content-Length": "7" } });
  assert.equal((await readBoundedReportBody(response, 7, new AbortController().signal)).toString(), "fixture");
  assert.equal(response.body!.locked, false);
});

test("abort interrupts a pending read even if stream cancellation never resolves", { timeout: 1000 }, async () => {
  const controller = new AbortController(); let cancelled = 0;
  const response = new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled++; return new Promise(() => {}); } }));
  const reading = readBoundedReportBody(response, 100, controller.signal);
  controller.abort();
  await assert.rejects(reading, /ADS_REPORT_OPERATION_TIMEOUT/);
  assert.equal(cancelled, 1); assert.equal(response.body!.locked, false);
});

test("dripping chunks cannot extend the total operation signal", { timeout: 1000 }, async () => {
  const controller = new AbortController(); let chunks = 0, cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(stream) { stream.enqueue(new Uint8Array([1])); if (++chunks === 5) controller.abort(); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(readBoundedReportBody(response, 1000, controller.signal), /OPERATION_TIMEOUT/);
  assert.equal(cancelled, true); assert.equal(response.body!.locked, false);
  assert.ok(chunks <= 5);
});

test("already aborted late response is cancelled before reading", async () => {
  const controller = new AbortController(); controller.abort(); let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  await assert.rejects(readBoundedReportBody(response, 100, controller.signal), /OPERATION_TIMEOUT/);
  assert.equal(cancelled, true); assert.equal(response.body!.locked, false);
});

test("body limits and truncation remain enforced and cancel errors do not mask rejection", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(stream) { stream.enqueue(new Uint8Array(11)); },
    cancel() { cancelled = true; throw new Error("private cancellation details"); },
  }));
  await assert.rejects(readBoundedReportBody(response, 10, new AbortController().signal), /ADS_REPORT_BODY_LIMIT/);
  assert.equal(cancelled, true); assert.equal(response.body!.locked, false);
  await assert.rejects(readBoundedReportBody(new Response("a", { headers: { "Content-Length": "2" } }), 10, new AbortController().signal), /BODY_SIZE_MISMATCH/);
});

test("rejected HTTP response cannot hang on cancellation", { timeout: 1000 }, async () => {
  const response = new Response(new ReadableStream({ cancel() { return new Promise(() => {}); } }), { status: 403 });
  await assert.rejects(readBoundedReportBody(response, 10, new AbortController().signal), /HTTP_OR_REDIRECT_REJECTED/);
});
