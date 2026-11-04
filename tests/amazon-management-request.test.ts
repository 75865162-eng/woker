import assert from "node:assert/strict";
import test from "node:test";
import { POST as credentialPost } from "@/app/api/operations/amazon-mcp/route";
import { PATCH as storePatch } from "@/app/api/operations/amazon-stores/route";
import { POST as oauthStart } from "@/app/api/integrations/amazon/sp-api/oauth/start/route";

const routes = [
  { handle: credentialPost, path: "/api/operations/amazon-mcp", method: "POST", limit: 16000 },
  { handle: storePatch, path: "/api/operations/amazon-stores", method: "PATCH", limit: 16000 },
  { handle: oauthStart, path: "/api/integrations/amazon/sp-api/oauth/start", method: "POST", limit: 1024 },
];
for (const route of routes) {
  const request = (body: string, headers: Record<string, string> = {}) => new Request(`http://localhost${route.path}`, { method: route.method, body, headers: { "content-type": "application/json", ...headers } });
  test(`${route.path} rejects cross-origin and non-JSON management requests before session parsing`, async () => {
    assert.equal((await route.handle(request("{}", { origin: "https://untrusted.invalid" }))).status, 403);
    assert.equal((await route.handle(request("{}", { "content-type": "text/plain" }))).status, 415);
  });
  test(`${route.path} returns 400 for invalid JSON and non-object JSON`, async () => {
    for (const body of ["{", "null", "[]", '"text"']) {
      const result = await route.handle(request(body));
      assert.equal(result.status, 400); assert.equal(result.headers.get("cache-control"), "no-store");
    }
  });
  test(`${route.path} cancels oversized streaming bodies without Content-Length`, async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("中".repeat(route.limit))); }, cancel() { cancelled = true; } });
    const input = new Request(`http://localhost${route.path}`, { method: route.method, headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    assert.equal(input.headers.get("content-length"), null);
    const response = await route.handle(input);
    assert.equal(response.status, 413); assert.equal(cancelled, true);
    assert.ok(!input.body!.locked, "stream reader released before returning");
  });
}
