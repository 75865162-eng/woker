import assert from "node:assert/strict";
import test from "node:test";
import { inspectLiveConfiguration } from "../scripts/amazon-sync-live-preflight.mjs";
const valid = { DATABASE_URL: "postgresql://user:private-password@127.0.0.1:5555/local", REDIS_URL: "redis://:private-redis@127.0.0.1:6666/0", QUEUE_DRIVER: "redis", AMAZON_SP_API_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), AUTH_SECRET: "private-auth", AMAZON_SYNC_CENTER_SCOPES: '[["private-org","private-workspace"]]' };
test("live preflight prints no credentials or scope values and never connects", () => {
  const result = inspectLiveConfiguration(valid);
  assert.equal(result.configurationReady, true); assert.equal(result.connectedToServices, false); assert.equal(result.amazonRequests, 0);
  for (const secret of ["private-password", "private-redis", "private-auth", "private-org", "private-workspace", valid.AMAZON_SP_API_ENCRYPTION_KEY]) assert.ok(!JSON.stringify(result).includes(secret));
});
test("live preflight fails closed for nonlocal services, invalid key, multiple scopes or production", () => {
  for (const override of [{ DATABASE_URL: "postgresql://host.example/db" }, { REDIS_URL: "redis://host.example" }, { AMAZON_SP_API_ENCRYPTION_KEY: "bad" }, { AMAZON_SYNC_CENTER_SCOPES: '[["org","ws"],["org","other"]]' }, { AMAZON_SYNC_CENTER_SCOPES: '[["org","*"]]' }, { NODE_ENV: "production" }, { QUEUE_DRIVER: "inline" }]) assert.equal(inspectLiveConfiguration({ ...valid, ...override }).configurationReady, false);
  assert.equal(inspectLiveConfiguration({}).configurationReady, false);
});
