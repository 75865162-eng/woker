import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

test("the exact ERP MCP endpoint delegates cookie-free requests to bearer authentication", async () => {
  for (const authorization of [undefined, "Bearer invalid", `Bearer amcp_${"a".repeat(43)}`]) {
    const response = await middleware(new NextRequest("http://localhost/api/mcp/amazon", {
      method: "POST", headers: authorization ? { authorization } : {},
    }));
    assert.equal(response.headers.get("x-middleware-next"), "1");
  }
});

test("MCP routing never exempts neighboring APIs, Lili settings or credential management from session auth", async () => {
  for (const path of ["/api/mcp/amazon-extra", "/api/mcp/amazon/child", "/api/mcp/other", "/api/operations/amazon-mcp", "/api/lili/mcp/child", "/lili/api/tool-config", "/api/lili/tool-config"]) {
    const response = await middleware(new NextRequest(`http://localhost${path}`, {
      method: "POST", headers: { authorization: `Bearer amcp_${"a".repeat(43)}` },
    }));
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get("x-middleware-next"), null, path);
  }
  const page = await middleware(new NextRequest("http://localhost/lili"));
  assert.equal(page.status, 307);
  assert.equal(new URL(page.headers.get("location")!).pathname, "/login");
});
