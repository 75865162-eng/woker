import assert from "node:assert/strict";
import test from "node:test";
import { boundedJsonObject } from "@/lib/amazon-sync/request-body";

test("bounded JSON parser rejects chunked oversized bodies without waiting on tee cancellation", async () => {
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(32));
    },
    cancel() {
      canceled = true;
      return new Promise<void>(() => {});
    },
  });
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    // Node's Request requires duplex for streaming bodies.
    duplex: "half",
  } as RequestInit);
  await assert.rejects(() => boundedJsonObject(request, 16), (error: unknown) => {
    assert.equal((error as { status?: number }).status, 413);
    return true;
  });
  assert.equal(request.bodyUsed, true);
  assert.equal(canceled, true);
  assert.equal(request.body?.locked, false);
});
