import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isSellfoxSameOrigin } from "../src/lib/sellfox/request-origin";

test("checks the configured public origin behind a reverse proxy", () => {
  const previous = process.env.AUTH_PUBLIC_ORIGIN;
  process.env.AUTH_PUBLIC_ORIGIN = "https://aoocy.com";
  try {
  const check = (headers: Record<string, string>) => isSellfoxSameOrigin(new Request("http://127.0.0.1:3000/api", { headers }));
  const proxy = { host: "aoocy.com", "x-forwarded-proto": "https" };
  assert.equal(check({ ...proxy, origin: "https://aoocy.com", "sec-fetch-site": "same-origin" }), true);
  assert.equal(check({ ...proxy, origin: "https://evil.example" }), false);
  assert.equal(check({ ...proxy, origin: "https://aoocy.com", "sec-fetch-site": "cross-site" }), false);
  assert.equal(check({ ...proxy, origin: "null" }), false);
  assert.equal(check({ host: "evil.example", "x-forwarded-proto": "https", origin: "https://evil.example" }), false);
  } finally {
    if (previous === undefined) delete process.env.AUTH_PUBLIC_ORIGIN;
    else process.env.AUTH_PUBLIC_ORIGIN = previous;
  }
});
