import assert from "node:assert/strict";
import test from "node:test";
import { boundedJsonObject } from "@/lib/amazon-sync/request-body";

function jsonRequest(headers: Record<string, string>) {
  return new Request("http://127.0.0.1:3000/api/integrations/amazon/sp-api/oauth/start", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ region: "us-east-1" }),
  });
}

test("bounded JSON accepts same-site browser requests behind a reverse proxy", async () => {
  const previous = process.env.AUTH_PUBLIC_ORIGIN;
  process.env.AUTH_PUBLIC_ORIGIN = "https://aoocy.com";
  try {
    // 浏览器真实场景：request.url 是反代内部地址，Origin 是可信公网入口。
    const body = await boundedJsonObject(jsonRequest({
      origin: "https://aoocy.com",
      "sec-fetch-site": "same-origin",
    }), 1024);
    assert.equal(body.region, "us-east-1");
    // 无 Origin 的非浏览器客户端同样放行（与 middleware CSRF 策略一致）。
    const fromCurl = await boundedJsonObject(jsonRequest({}), 1024);
    assert.equal(fromCurl.region, "us-east-1");
  } finally {
    if (previous === undefined) delete process.env.AUTH_PUBLIC_ORIGIN;
    else process.env.AUTH_PUBLIC_ORIGIN = previous;
  }
});

test("bounded JSON rejects cross-site browser requests", async () => {
  const previous = process.env.AUTH_PUBLIC_ORIGIN;
  process.env.AUTH_PUBLIC_ORIGIN = "https://aoocy.com";
  try {
    await assert.rejects(
      () => boundedJsonObject(jsonRequest({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }), 1024),
      (error: unknown) => {
        assert.equal((error as { status?: number }).status, 403);
        assert.equal((error as { message?: string }).message, "数据范围不可访问。");
        return true;
      },
    );
  } finally {
    if (previous === undefined) delete process.env.AUTH_PUBLIC_ORIGIN;
    else process.env.AUTH_PUBLIC_ORIGIN = previous;
  }
});

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
