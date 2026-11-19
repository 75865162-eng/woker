import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_PERMS_CACHE_PREFIX, ROLE_PERMS_CACHE_TTL_SECONDS, rolePermsCacheKey,
  readThroughRolePerms, invalidateRolePerms, setRolePermsCacheRedisForTest,
} from "../src/lib/accounts/role-permissions-cache";

type KV = Map<string, { value: string; expireAt: number }>;
class FakeRedis {
  store: KV = new Map();
  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expireAt <= Date.now()) { this.store.delete(key); return null; }
    return entry.value;
  }
  async set(key: string, value: string, _mode: "EX", ttl: number) {
    void _mode;
    this.store.set(key, { value, expireAt: Date.now() + ttl * 1000 });
  }
  async del(...keys: string[]) { let n = 0; for (const k of keys) if (this.store.delete(k)) n++; return n; }
  on(_event: string, _listener: () => void) { void _event; void _listener; }
}

function enable() { process.env.ROLE_PERMS_CACHE_ENABLED = "true"; }
function disable() { delete process.env.ROLE_PERMS_CACHE_ENABLED; }

test("rolePermsCacheKey is namespaced, deterministic and org-scoped", () => {
  assert.ok(rolePermsCacheKey("org-a").startsWith(ROLE_PERMS_CACHE_PREFIX));
  assert.equal(rolePermsCacheKey("org-a"), rolePermsCacheKey("org-a"));
  assert.notEqual(rolePermsCacheKey("org-a"), rolePermsCacheKey("org-b"));
  assert.ok(ROLE_PERMS_CACHE_TTL_SECONDS > 0);
});

test("disabled cache bypasses loadVersion and returns authoritative body", async () => {
  disable();
  let versionCalls = 0;
  let loadCalls = 0;
  const r = await readThroughRolePerms(
    "org-a",
    async () => { versionCalls++; return "v1"; },
    async () => { loadCalls++; return { body: { admin: ["view"] }, revision: "v1" }; },
  );
  assert.equal(r.cache, "bypass");
  assert.deepEqual(r.body, { admin: ["view"] });
  assert.equal(versionCalls, 0, "no version query when disabled");
  assert.equal(loadCalls, 1);
  enable();
});

test("miss then hit when revision unchanged", async () => {
  enable();
  const fake = new FakeRedis();
  setRolePermsCacheRedisForTest(fake);
  const revision = "rev-1";
  let loadCalls = 0;
  const read = () => readThroughRolePerms(
    "org-a",
    async () => revision,
    async () => { loadCalls++; return { body: { admin: ["view", "edit"] }, revision: "rev-1" }; },
  );
  const first = await read();
  assert.equal(first.cache, "miss");
  assert.equal(loadCalls, 1);
  const second = await read();
  assert.equal(second.cache, "hit");
  assert.equal(loadCalls, 1, "load not re-run on hit");
  assert.deepEqual(second.body, { admin: ["view", "edit"] });
  setRolePermsCacheRedisForTest(undefined);
});

test("revision change forces miss (permission revoke honored immediately)", async () => {
  enable();
  const fake = new FakeRedis();
  setRolePermsCacheRedisForTest(fake);
  let revision = "rev-1";
  let loadCalls = 0;
  const read = () => readThroughRolePerms(
    "org-a",
    async () => revision,
    async () => { loadCalls++; return { body: { admin: ["view"] }, revision }; },
  );
  await read();                       // miss, store rev-1
  assert.equal((await read()).cache, "hit");
  revision = "rev-2";                 // simulate a permission write bumping revision
  const after = await read();
  assert.equal(after.cache, "miss", "stale cached permissions must not be served");
  assert.equal(loadCalls, 2);
  setRolePermsCacheRedisForTest(undefined);
});

test("version query failure degrades to load (fail-open, no stale body)", async () => {
  enable();
  const fake = new FakeRedis();
  setRolePermsCacheRedisForTest(fake);
  let loadCalls = 0;
  const r = await readThroughRolePerms(
    "org-a",
    async () => { throw new Error("db down"); },
    async () => { loadCalls++; return { body: { viewer: ["view"] }, revision: "rev-1" }; },
  );
  assert.equal(r.cache, "miss");
  assert.equal(loadCalls, 1);
  assert.deepEqual(r.body, { viewer: ["view"] });
  setRolePermsCacheRedisForTest(undefined);
});

test("Redis outage degrades to direct load", async () => {
  enable();
  setRolePermsCacheRedisForTest(null); // simulate outage
  const r = await readThroughRolePerms(
    "org-a",
    async () => "rev-1",
    async () => ({ body: { admin: ["view"] }, revision: "rev-1" }),
  );
  assert.equal(r.cache, "miss");
  assert.deepEqual(r.body, { admin: ["view"] });
  setRolePermsCacheRedisForTest(undefined);
});

test("invalidate deletes the org key", async () => {
  enable();
  const fake = new FakeRedis();
  setRolePermsCacheRedisForTest(fake);
  await readThroughRolePerms(
    "org-a",
    async () => "rev-1",
    async () => ({ body: { admin: ["view"] }, revision: "rev-1" }),
  );
  assert.ok(fake.store.has(rolePermsCacheKey("org-a")));
  await invalidateRolePerms("org-a");
  assert.equal(fake.store.has(rolePermsCacheKey("org-a")), false);
  setRolePermsCacheRedisForTest(undefined);
  disable();
});

test("singleflight: concurrent callers share one load", async () => {
  enable();
  const fake = new FakeRedis();
  setRolePermsCacheRedisForTest(fake);
  let loadCalls = 0;
  const makeRead = () => readThroughRolePerms(
    "org-sf",
    async () => "rev-1",
    async () => { loadCalls++; await new Promise(r => setTimeout(r, 20)); return { body: { admin: ["view"] }, revision: "rev-1" }; },
  );
  const [a, b, c] = await Promise.all([makeRead(), makeRead(), makeRead()]);
  assert.equal(loadCalls, 1, "concurrent loads collapsed to one");
  assert.deepEqual(a.body, b.body);
  assert.deepEqual(b.body, c.body);
  setRolePermsCacheRedisForTest(undefined);
  disable();
});
