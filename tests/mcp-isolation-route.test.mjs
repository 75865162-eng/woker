import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

import { auditQueries, probeDatabaseRole, rolePolicies } from "../src/lib/mcp/database-audit.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const routeSource = readFileSync(new URL("../src/app/api/operations/mcp-isolation/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

function fixture(audit = { available: false, roles: [], violations: ["未知"] }) {
  const calls = { checked: [], managed: [], probes: [] };
  const modules = {
    "next/server": { NextResponse: { json: (value, options = {}) => ({ status: options.status ?? 200, value }) } },
    "@/lib/auth/api-permissions": { requireApiPermission: async (_module, _action, request) => {
      assert.equal(request.bodyUsed, false, "鉴权前不能消费原始body");
      const body = request.body ? await request.clone().json() : {};
      const selectors = [body.workspaceId, body.context?.workspaceId, request.headers.get("x-workspace-id"), ...new URL(request.url).searchParams.getAll("workspaceId")].filter(value => value != null);
      calls.checked.push(...selectors);
      return selectors.some(value => value !== "allowed") ? { ok: false, response: { status: 403 } } : { ok: true, user: { id: "user", organizationId: "org" } };
    } },
    "@/lib/workspace/scope": { workspaceScopeFromRequest: (request, body) => ({ workspaceId: body?.workspaceId ?? request.headers.get("x-workspace-id") ?? new URL(request.url).searchParams.get("workspaceId") }) },
    "@/lib/db/prisma": { prisma: { sellfoxStore: { findMany: async () => [] }, auditLog: { findMany: async () => [] } } },
    "@/lib/amazon-sync/mcp": { amazonMcpToolCatalog: [], listMcpCredentials: async () => [], listMcpScopeOptions: async () => [] },
    "@/lib/mcp/isolation": { McpIsolationError: class extends Error {}, mcpIsolationMatrix: () => [], mcpProviderPolicies: { amazon: {}, sellfox: {} } },
    "@/lib/mcp/database-audit.mjs": { inspectDatabaseRoles: async () => audit, probeDatabaseRole: async provider => { calls.probes.push(provider); return { ok: false }; } },
    "@/lib/sellfox/mcp": { listSellfoxMcpCredentials: async () => [], sellfoxMcpCatalog: () => [], manageSellfoxMcpCredential: async scope => { calls.managed.push(scope); return scope; } },
    "@/lib/sellfox/mcp-tool-registry": { sellfoxDatasetKeys: [], sellfoxDatasets: {}, sellfoxMcpToolNames: [] },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => { assert.ok(modules[name], name); return modules[name]; }, process: { env: {} }, Request, Date });
  return { ...exports, calls };
}

function request(body, query = "allowed") {
  return new Request(`http://fixture.invalid/api?workspaceId=${query}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

test("POST保留body给鉴权，body/context跨scope请求均拒绝且不调用业务或探针", async () => {
  for (const body of [{ action: "create", workspaceId: "other" }, { action: "probe", context: { workspaceId: "other" } }]) {
    const route = fixture();
    const response = await route.POST(request(body));
    assert.equal(response.status, 403);
    assert.ok(route.calls.checked.includes("other"));
    assert.equal(route.calls.managed.length, 0);
    assert.equal(route.calls.probes.length, 0);
  }
});

test("POST业务scope使用已验body，探针调用对应提供方", async () => {
  const route = fixture();
  assert.equal((await route.POST(request({ action: "create", workspaceId: "allowed" }))).status, 200);
  assert.equal(route.calls.managed[0].workspaceId, "allowed");
  assert.equal(route.calls.managed[0].organizationId, "org");
  for (const provider of ["amazon", "sellfox"]) await route.POST(request({ action: "probe", provider, workspaceId: "allowed" }));
  assert.deepEqual(route.calls.probes, ["amazon", "sellfox"]);
});

test("实际审计查询器返回本池空表或未知字段时探针拒绝", async () => {
  for (const mode of ["empty", "unknown"]) {
    class IncompleteClient {
      async connect() {}
      async end() {}
      async query(query) {
        if (query === auditQueries.identity) {
          const flags = ["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls", "membership", "owns_objects", "db_create", "db_temp", "unsafe_defaults", "public_acl"];
          return { rows: [{ role: rolePolicies[0].role, session_role: rolePolicies[0].role, ...Object.fromEntries(flags.map(key => [key, false])) }] };
        }
        if (query === auditQueries.relations) return { rows: mode === "empty" ? [] : [{ schema: "public", name: "AmazonOrder", kind: "r", readable: true, grantable: false }] };
        if (query === auditQueries.schemas) return { rows: [{ name: "public", creatable: false }] };
        return { rows: [] };
      }
    }
    const result = await probeDatabaseRole("amazon", { AMAZON_MCP_PG_READONLY_URL: "offline-fixture" }, IncompleteClient);
    assert.equal(result.ok, false);
    assert.match(result.detail, mode === "empty" ? /没有可读/ : /字段缺失/);
  }
});

test("GET缺角色时状态及文案均不能声称审计通过", async () => {
  const route = fixture();
  const response = await route.GET(new Request("http://fixture.invalid/api?workspaceId=allowed"));
  assert.equal(response.status, 200);
  for (const key of ["amazon-ro", "sellfox-ro", "db-cross-pool"]) {
    const row = response.value.health.find(row => row.key === key);
    assert.equal(row.state, "warn");
    assert.doesNotMatch(row.detail, /审计通过/);
  }
});
