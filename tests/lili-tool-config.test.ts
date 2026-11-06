import assert from "node:assert/strict";
import test from "node:test";
import { handleLiliRequest, type LiliAuthorize } from "@/lib/lili/api";
import { defaultXiyouSettings, mergeXiyouSettings, publicXiyouSettings, xiyouEndpoint } from "@/lib/lili/tool-config";
import { decryptXiyouSettings, encryptXiyouSettings, type ToolConfigScope, type ToolConfigStore } from "@/lib/lili/tool-config-server";
import { probeXiyouConnection } from "@/lib/lili/tool-config-api";

const user = { id: "fixture-user", organizationId: "fixture-org" };
const scope = { organizationId: user.organizationId, userId: user.id, workspaceId: "default" };
const token = "fixture-xiyou-token";
const clientSecret = "fixture-openapi-secret";
const configured = { ...defaultXiyouSettings, enabled: true, mcpToken: token, clientSecret };
const authorize: LiliAuthorize = async () => ({ ok: true, user });
function request(method: string, body?: unknown, query = "") {
  return new Request(`http://lili.invalid/api/lili/tool-config${query}`, { method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
}
function fixture() {
  const rows = new Map<string, typeof configured>();
  const reads: ToolConfigScope[] = [];
  let writes = 0, probes = 0;
  const store: ToolConfigStore = {
    async read(key) { reads.push(key); return rows.get(JSON.stringify(key)) ?? { ...defaultXiyouSettings }; },
    async save(key, patch) { const next = mergeXiyouSettings(patch, await store.read(key)); rows.set(JSON.stringify(key), next); writes++; return next; },
  };
  const dependencies = { store, async probe(value: typeof configured) { assert.equal(value.mcpToken, token); probes++; } };
  return { dependencies, reads, counts: () => ({ writes, probes }) };
}

test("Xiyou preserves blank secrets and rejects endpoint changes, placeholders and unknown fields", () => {
  assert.equal(mergeXiyouSettings({ mcpToken: "", clientSecret: "", clientId: "new-id" }, configured).mcpToken, token);
  assert.equal(mergeXiyouSettings({ mcpToken: "", clientSecret: "" }, configured).clientSecret, clientSecret);
  for (const input of [{ mcpUrl: "https://attacker.invalid/mcp" }, { mcpUrl: `${xiyouEndpoint}?mcp_token=secret` },
    { mcpToken: "Bearer test" }, { mcpToken: "YOUR_MCP_TOKEN" }, { mcpToken: "bad\r\nheader" },
    { enabled: "true" }, { enabled: true }, { mcpToken: "x".repeat(8193) }, { unknownField: "value" },
    { openapiBase: "http://localhost" }, null, []]) assert.throws(() => mergeXiyouSettings(input));
  const safe = JSON.stringify(publicXiyouSettings(configured));
  assert.ok(!safe.includes(token)); assert.ok(!safe.includes(clientSecret));
  assert.equal(publicXiyouSettings(configured).hasMcpToken, true);
});

test("encryption binds organization, workspace, user and authenticated ciphertext; no key means no fallback", () => {
  const previous = process.env.AMAZON_SP_API_ENCRYPTION_KEY;
  try {
    process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptXiyouSettings(configured, scope);
    assert.ok(!JSON.stringify(encrypted).includes(token));
    assert.ok(!JSON.stringify(encrypted).includes(clientSecret));
    assert.deepEqual(decryptXiyouSettings(encrypted, scope), configured);
    for (const changed of [{ ...scope, organizationId: "other" }, { ...scope, workspaceId: "other" }, { ...scope, userId: "other" }]) assert.throws(() => decryptXiyouSettings(encrypted, changed));
    assert.throws(() => decryptXiyouSettings({ ...encrypted, ciphertext: encrypted.ciphertext + "bad" }, scope));
    delete process.env.AMAZON_SP_API_ENCRYPTION_KEY;
    assert.throws(() => encryptXiyouSettings(configured, scope));
    assert.throws(() => decryptXiyouSettings(encrypted, scope));
  } finally {
    if (previous === undefined) delete process.env.AMAZON_SP_API_ENCRYPTION_KEY;
    else process.env.AMAZON_SP_API_ENCRYPTION_KEY = previous;
  }
});

test("configuration saves, restores, preserves secrets and probes only on explicit test requests", async () => {
  const fx = fixture();
  const put = (settings: unknown) => handleLiliRequest(request("PUT", { id: "xiyou", settings }), ["tool-config"], authorize, fx.dependencies);
  let response = await put(configured);
  assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes(token));
  assert.deepEqual(fx.counts(), { writes: 1, probes: 0 });
  response = await handleLiliRequest(request("GET"), ["tool-config"], authorize, fx.dependencies);
  assert.equal((await response.json()).settings.hasMcpToken, true);
  assert.equal((await put({ mcpToken: "", clientSecret: "" })).status, 200);
  response = await handleLiliRequest(request("POST", { id: "xiyou" }), ["tool-config", "test"], authorize, fx.dependencies);
  assert.equal(response.status, 200); assert.deepEqual(fx.counts(), { writes: 2, probes: 1 });
});

test("read-only, foreign-origin, unauthorized workspace and anonymous requests cannot save or test", async () => {
  const fx = fixture();
  const viewOnly: LiliAuthorize = async (_module, action) => action === "view" ? { ok: true, user } : { ok: false, response: new Response(null, { status: 403 }) };
  for (const [method, parts] of [["PUT", ["tool-config"]], ["POST", ["tool-config", "test"]]] as const) {
    const response = await handleLiliRequest(request(method, { id: "xiyou", settings: configured }), [...parts], viewOnly, fx.dependencies);
    assert.equal(response.status, 403);
  }
  const foreign = request("PUT", { id: "xiyou", settings: configured }); foreign.headers.set("origin", "http://attacker.invalid");
  assert.equal((await handleLiliRequest(foreign, ["tool-config"], authorize, fx.dependencies)).status, 403);
  const deny: LiliAuthorize = async () => ({ ok: false, response: new Response(null, { status: 403 }) });
  assert.equal((await handleLiliRequest(request("GET", undefined, "?workspaceId=other"), ["tool-config"], deny, fx.dependencies)).status, 403);
  assert.equal((await handleLiliRequest(request("GET"), ["tool-config"], async () => ({ ok: true }), fx.dependencies)).status, 403);
  assert.deepEqual(fx.counts(), { writes: 0, probes: 0 }); assert.equal(fx.reads.length, 0);
});

test("server-derived identity and workspace determine every repository access", async () => {
  const fx = fixture();
  const body = { id: "xiyou", organizationId: "forged", userId: "forged", workspaceId: "fixture-workspace", settings: configured };
  assert.equal((await handleLiliRequest(request("PUT", body), ["tool-config"], authorize, fx.dependencies)).status, 200);
  assert.deepEqual(fx.reads[0], { ...scope, workspaceId: "fixture-workspace" });
  for (const identity of [user, { ...user, id: "other-user" }, { ...user, organizationId: "other-org" }]) {
    const response = await handleLiliRequest(request("GET"), ["tool-config"], async () => ({ ok: true, user: identity }), fx.dependencies);
    assert.equal((await response.json()).settings.hasMcpToken, false);
  }
  const restored = await handleLiliRequest(request("GET", undefined, "?workspaceId=fixture-workspace"), ["tool-config"], authorize, fx.dependencies);
  assert.equal((await restored.json()).settings.hasMcpToken, true);
});

test("failures never echo tokens, provider responses or database details", async () => {
  const fx = fixture();
  await fx.dependencies.store.save(scope, configured);
  const response = await handleLiliRequest(request("POST", { id: "xiyou" }), ["tool-config", "test"], authorize,
    { ...fx.dependencies, async probe() { throw new Error(`${token} ${clientSecret} database-connection-string`); } });
  assert.equal(response.status, 503);
  const text = await response.text();
  for (const secret of [token, clientSecret, "database-connection-string"]) assert.ok(!text.includes(secret));
  assert.equal((await handleLiliRequest(request("PUT", { id: "xiyou", settings: { mcpUrl: "https://bad.invalid" } }), ["tool-config"], authorize, fx.dependencies)).status, 400);
  assert.equal((await handleLiliRequest(request("POST", { id: "xiyou" }), ["tool-config", "test"], authorize, fixture().dependencies)).status, 400);
});

const initialized = { jsonrpc: "2.0", id: "lili-connection-test", result: { protocolVersion: "2025-03-26", serverInfo: { name: "fixture", version: "1" }, capabilities: {} } };
test("MCP probe sends only initialize to the fixed host and accepts JSON and bounded SSE", async () => {
  for (const sse of [false, true]) {
    const transport: typeof fetch = async (url, init) => {
      assert.equal(url, xiyouEndpoint); assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
      assert.equal(JSON.parse(init?.body as string).method, "initialize");
      return new Response(sse ? `event: message\ndata: ${JSON.stringify(initialized)}\n\n` : JSON.stringify(initialized), { headers: { "content-type": sse ? "text/event-stream" : "application/json" } });
    };
    await probeXiyouConnection(configured, transport);
  }
  for (const response of [new Response("unauthorized", { status: 401 }), new Response(JSON.stringify({ ...initialized, id: "wrong" })),
    new Response(JSON.stringify({ ...initialized, error: { message: token } })), new Response("x".repeat(65537)), new Response("<html>login</html>")]) {
    await assert.rejects(() => probeXiyouConnection(configured, async () => response));
  }
});
