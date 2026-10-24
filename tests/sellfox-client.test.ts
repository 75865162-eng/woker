import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { setImmediate } from "node:timers/promises";

test("Sellfox HTTP client uses official token, signature, retry and queue contracts without network", async (t) => {
  const previousFetch = globalThis.fetch;
  const previousEnv = { DATABASE_URL: process.env.DATABASE_URL, SELLFOX_CLIENT_ID: process.env.SELLFOX_CLIENT_ID, SELLFOX_CLIENT_SECRET: process.env.SELLFOX_CLIENT_SECRET };
  process.env.SELLFOX_CLIENT_ID = "fixture-client";
  process.env.SELLFOX_CLIENT_SECRET = "fixture-secret";
  delete process.env.DATABASE_URL;
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_800_000_000_000 });
  const { sellfoxPost } = await import("@/lib/sellfox/client");
  type Call = { url: URL; init?: RequestInit; at: number };
  let calls: Call[] = [];
  let respond: (call: Call) => unknown = () => ({ data: { accepted: true } });
  let tokenTtl: unknown = 86_400_000;
  let tokenCount = 0;
  let tokenCode = 0;
  globalThis.fetch = async (input, init) => {
    const call = { url: new URL(String(input)), init, at: Date.now() };
    calls.push(call);
    if (call.url.pathname.includes("/api/oauth/")) {
      tokenCount += 1;
      return Response.json({ code: tokenCode, data: { access_token: `fixture-token-${tokenCount}`, expires_in: tokenTtl } });
    }
    const value = await respond(call);
    if (value instanceof Error) throw value;
    return value instanceof Response ? value : Response.json(value);
  };
  async function drive<T>(operation: Promise<T>): Promise<T> {
    let done = false;
    let result: T | undefined;
    let failure: unknown;
    operation.then((value) => { done = true; result = value; }, (error) => { done = true; failure = error; });
    for (let i = 0; i < 1000 && !done; i += 1) {
      await setImmediate();
      if (!done) t.mock.timers.tick(100);
    }
    assert.ok(done, "mock HTTP operation should finish within the bounded retry budget");
    if (failure) throw failure;
    return result as T;
  }
  function reset() {
    t.mock.timers.tick(2 * 86_400_000);
    calls = []; tokenTtl = 86_400_000; tokenCount = 0; tokenCode = 0;
    respond = () => ({ code: 0, data: { accepted: true } });
  }
  try {
    await t.test("one cached token serves concurrent signed requests, spaced after HTTP completion", async () => {
      reset();
      const starts: number[] = []; const ends: number[] = [];
      respond = async (call) => {
        starts.push(call.at);
        const query = call.url.searchParams;
        const values = { access_token: query.get("access_token"), client_id: "fixture-client", method: "post", nonce: query.get("nonce"), timestamp: query.get("timestamp"), url: call.url.pathname };
        const source = Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&");
        assert.equal(query.get("sign"), createHmac("sha256", "fixture-secret").update(source).digest("hex"));
        assert.equal(call.init?.method, "POST");
        assert.equal(call.init?.body, JSON.stringify({ shopIdList: ["shop-a"] }));
        // Simulate a slow response so spacing is measured from completion.
        await new Promise((resolve) => setTimeout(resolve, 500));
        ends.push(Date.now());
        return { data: { accepted: true } };
      };
      await drive(Promise.all([sellfoxPost("/api/test/a.json", { shopIdList: ["shop-a"] }), sellfoxPost("/api/test/b.json", { shopIdList: ["shop-a"] })]));
      assert.equal(tokenCount, 1);
      assert.equal(calls.length, 3);
      for (let i = 1; i < calls.length; i += 1) assert.ok(calls[i].at - calls[i - 1].at >= 1200);
      assert.ok(starts[1] - ends[0] >= 1200);
    });
    await t.test("expires_in is milliseconds; expired cache refreshes without a 1000x extension", async () => {
      reset(); tokenTtl = 10_000;
      await drive(sellfoxPost("/api/test.json", {}));
      await drive(sellfoxPost("/api/test.json", {}));
      assert.equal(tokenCount, 1);
      t.mock.timers.tick(10_000);
      await drive(sellfoxPost("/api/test.json", {}));
      assert.equal(tokenCount, 2);
    });
    await t.test("zero, missing and invalid TTLs never send a business API request", async () => {
      for (const ttl of [0, undefined, -1, "86400000"]) {
        reset(); tokenTtl = ttl;
        await assert.rejects(drive(sellfoxPost("/api/test.json", {})), /毫秒有效期/);
        assert.equal(calls.length, 1);
      }
    });
    await t.test("40001 refreshes and signs with the replacement token only once", async () => {
      reset();
      let attempts = 0;
      respond = () => ++attempts === 1 ? { code: 40001 } : { data: { accepted: true } };
      await drive(sellfoxPost("/api/test.json", {}));
      assert.equal(tokenCount, 2);
      const businessCalls = calls.filter((call) => !call.url.pathname.includes("/api/oauth/"));
      assert.notEqual(businessCalls[0].url.searchParams.get("access_token"), businessCalls[1].url.searchParams.get("access_token"));
      reset(); respond = () => ({ code: 40001 });
      await assert.rejects(drive(sellfoxPost("/api/test.json", {})), /40001/);
      assert.equal(tokenCount, 2);
      assert.equal(calls.length, 4);
    });
    await t.test("rate limits use bounded exponential backoff and never expose upstream messages", async () => {
      reset(); respond = () => ({ code: 40019, msg: "private upstream credentials" });
      await assert.rejects(drive(sellfoxPost("/api/test.json", {})), (error: Error) => error.message.includes("40019") && !error.message.includes("private"));
      const attempts = calls.filter((call) => !call.url.pathname.includes("/api/oauth/"));
      assert.equal(attempts.length, 4);
      for (let i = 1; i < attempts.length; i += 1) assert.ok(attempts[i].at - attempts[i - 1].at >= 2000 * 2 ** (i - 1));
    });
    await t.test("permanent parameter, permission, whitelist and signature errors are not retried", async () => {
      for (const code of [40005, 40011, 40014, 40021]) {
        reset(); respond = () => ({ code, msg: "private upstream credentials" });
        await assert.rejects(drive(sellfoxPost("/api/test.json", {})), (error: Error) => error.message.includes(String(code)) && !error.message.includes("private"));
        assert.equal(calls.length, 2);
      }
      reset(); tokenCode = 40005;
      await assert.rejects(drive(sellfoxPost("/api/test.json", {})), /40005/);
      assert.equal(calls.length, 1);
    });
    await t.test("network and non-JSON 503 responses retry; non-JSON success fails closed", async () => {
      reset();
      let attempts = 0;
      respond = () => {
        attempts += 1;
        if (attempts === 1) return new Error("private network URL");
        if (attempts === 2) return new Response("temporary outage", { status: 503 });
        return { data: { accepted: true } };
      };
      assert.deepEqual(await drive(sellfoxPost("/api/test.json", {})), { accepted: true });
      assert.equal(attempts, 3);
      reset(); respond = () => new Response("invalid upstream body");
      await assert.rejects(drive(sellfoxPost("/api/test.json", {})), /非 JSON/);
      assert.equal(calls.length, 2);
    });
    await t.test("task creation transport is sent once when the result is ambiguous", async () => {
      reset(); respond = () => new Error("private timeout URL");
      await assert.rejects(drive(sellfoxPost("/api/cpc/download/createTask.json", {}, { retry: false })));
      assert.equal(calls.filter((call) => call.url.pathname.includes("createTask")).length, 1);
    });
  } finally {
    globalThis.fetch = previousFetch;
    t.mock.timers.reset();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
