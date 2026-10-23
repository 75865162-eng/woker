import assert from "node:assert/strict";
import test from "node:test";
import { refreshProductImageUrls } from "@/lib/products/signed-image-urls";

test("product image URLs are requested in one scoped batch and replaced on renewal", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  let sequence = 0;
  Object.assign(globalThis, {
    window: { localStorage: { getItem: () => JSON.stringify({ workspaceId: "workspace-a", accountId: "account-a" }) } },
  });
  globalThis.fetch = (async (input, init) => {
    requests.push({ input, init });
    sequence += 1;
    return new Response(JSON.stringify({
      urls: [{ fileId: "thumb-1", url: `https://storage.example/thumb-1?signature=${sequence}` }],
      expiresAt: "2030-01-01T00:10:00.000Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const first = await refreshProductImageUrls(["thumb-1"]);
    const renewed = await refreshProductImageUrls(["thumb-1"]);
    assert.equal(first.get("thumb-1"), "https://storage.example/thumb-1?signature=1");
    assert.equal(renewed.get("thumb-1"), "https://storage.example/thumb-1?signature=2");
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.input, "/api/products/image-urls");
    assert.equal(requests[0]?.init?.method, "POST");
    assert.equal((requests[0]?.init?.headers as Record<string, string>)["x-workspace-id"], "workspace-a");
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(globalThis, { window: originalWindow });
  }
});

test("product image URL renewal surfaces a forbidden response instead of using a stale URL", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  Object.assign(globalThis, { window: { localStorage: { getItem: () => null } } });
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "无权读取一个或多个商品图片。" }), { status: 403 })) as typeof fetch;
  try {
    await assert.rejects(refreshProductImageUrls(["other-tenant-file"]), /无权读取/);
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(globalThis, { window: originalWindow });
  }
});
