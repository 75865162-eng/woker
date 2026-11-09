import test from "node:test";
import assert from "node:assert/strict";
import { liliClientConnection } from "@/lib/lili/client-connection";

test("Lili client instructions use the current origin and preserve loopback ports", () => {
  for (const origin of ["http://localhost:3017", "http://127.0.0.1:3017", "http://[::1]:3017", "https://erp.example"]) {
    const connection = liliClientConnection(origin);
    assert.equal(connection.endpoint, `${origin}/api/lili/mcp`);
    assert.equal(connection.toml, `[mcp_servers.lili]\nurl = ${JSON.stringify(connection.endpoint)}\n`);
    assert.equal(connection.loginCommand, "codex mcp login lili");
    assert.match(connection.verifyPrompt, /lili_ping/);
    assert.match(connection.verifyPrompt, /authenticated=true/);
  }
});

test("Lili instructions refuse credential links, non-origin paths and public HTTP", () => {
  for (const origin of ["https://user:secret@erp.example", "https://erp.example/mcp/k/fixture-secret",
    "https://erp.example?token=fixture-secret", "https://erp.example#fixture-secret", "http://erp.example",
    "http://localhost.evil.example:3017", "file:///tmp", "invalid"]) {
    assert.throws(() => liliClientConnection(origin));
  }
});
