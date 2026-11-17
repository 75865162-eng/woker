import assert from "node:assert/strict";
import test from "node:test";
import { buildPgPoolConfig } from "@/lib/db/prisma";

const keys = ["PG_POOL_MAX", "PG_POOL_IDLE_TIMEOUT_MS", "PG_POOL_CONNECTION_TIMEOUT_MS"];

function clearEnv() {
  for (const key of keys) delete process.env[key];
}

test("buildPgPoolConfig uses safe defaults when env is absent", () => {
  clearEnv();
  const config = buildPgPoolConfig("postgresql://u:p@127.0.0.1:5432/db");
  assert.equal(config.connectionString, "postgresql://u:p@127.0.0.1:5432/db");
  assert.equal(config.max, 10);
  assert.equal(config.idleTimeoutMillis, 10_000);
  assert.equal(config.connectionTimeoutMillis, 10_000);
});

test("buildPgPoolConfig reads positive integer overrides", () => {
  clearEnv();
  process.env.PG_POOL_MAX = "25";
  process.env.PG_POOL_IDLE_TIMEOUT_MS = "2000";
  process.env.PG_POOL_CONNECTION_TIMEOUT_MS = "3000";
  try {
    const config = buildPgPoolConfig("postgresql://u:p@127.0.0.1:5432/db");
    assert.equal(config.max, 25);
    assert.equal(config.idleTimeoutMillis, 2000);
    assert.equal(config.connectionTimeoutMillis, 3000);
  } finally {
    clearEnv();
  }
});

test("buildPgPoolConfig falls back on invalid or non-positive values", () => {
  clearEnv();
  process.env.PG_POOL_MAX = "0";
  process.env.PG_POOL_IDLE_TIMEOUT_MS = "abc";
  process.env.PG_POOL_CONNECTION_TIMEOUT_MS = "-5";
  try {
    const config = buildPgPoolConfig("postgresql://u:p@127.0.0.1:5432/db");
    assert.equal(config.max, 10);
    assert.equal(config.idleTimeoutMillis, 10_000);
    assert.equal(config.connectionTimeoutMillis, 10_000);
  } finally {
    clearEnv();
  }
});
