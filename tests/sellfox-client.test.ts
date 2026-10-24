import test from "node:test";
import assert from "node:assert/strict";

test("Sellfox client serializes token and API HTTP requests with at least 1200ms spacing", async () => {
  const previousFetch = globalThis.fetch;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousClientId = process.env.SELLFOX_CLIENT_ID;
  const previousClientSecret = process.env.SELLFOX_CLIENT_SECRET;
  const starts: number[] = [];
  process.env.SELLFOX_CLIENT_ID = "test-client-id";
  process.env.SELLFOX_CLIENT_SECRET = "test-client-secret";
  delete process.env.DATABASE_URL;
  globalThis.fetch = async (input) => {
    starts.push(Date.now());
    return {
      ok: true,
      status: 200,
      json: async () => String(input).includes("/api/oauth/")
        ? { data: { access_token: "test-access-token", expires_in: 3600 } }
        : { data: { accepted: true } },
    } as Response;
  };
  try {
    const { sellfoxPost } = await import("@/lib/sellfox/client");
    await Promise.all([sellfoxPost("/api/test/a.json", {}), sellfoxPost("/api/test/b.json", {})]);
    assert.equal(starts.length, 3);
    for (let index = 1; index < starts.length; index += 1) assert.ok(starts[index] - starts[index - 1] >= 1_200);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousClientId === undefined) delete process.env.SELLFOX_CLIENT_ID; else process.env.SELLFOX_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.SELLFOX_CLIENT_SECRET; else process.env.SELLFOX_CLIENT_SECRET = previousClientSecret;
  }
});
