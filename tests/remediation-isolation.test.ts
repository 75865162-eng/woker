import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { mcpProviderPolicies } from "@/lib/mcp/isolation";
import { WorkspaceScopeError, workspaceScopeFromRequest } from "@/lib/workspace/scope";

function source(relative: string) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

test("requireApiPermission 的 request 参数为必传（类型层面强制）", () => {
  const apiPermissions = source("../src/lib/auth/api-permissions.ts");

  // 类型层面：签名必须为 request: Request，不能再是可选参数。
  assert.match(
    apiPermissions,
    /export async function requireApiPermission\([^)]*\brequest: Request\b[^)]*\)/,
    "requireApiPermission 必须显式要求 request",
  );
  assert.doesNotMatch(apiPermissions, /request\?: Request/, "不得保留可选 request，漏传会静默跳过 workspace 校验");

  // 运行时：workspace 选择器检查不得被可选 request 包裹成可跳过路径。
  assert.match(apiPermissions, /assertWorkspaceAccess\(user\.organizationId, workspaceId, user\.id, undefined, request\)/);
});

test("MCP 只读角色命名在代码、审计路由与 DBA 脚本中一致", () => {
  const isolation = source("../src/lib/mcp/isolation.ts");
  const auditRoute = source("../src/app/api/operations/mcp-isolation/route.ts");
  const grantSql = source("../scripts/mcp-isolation/grant-roles.sql");

  for (const [name, text] of [["isolation.ts", isolation], ["mcp-isolation/route.ts", auditRoute], ["grant-roles.sql", grantSql]] as const) {
    assert.doesNotMatch(text, /mcp_amazon_ro|mcp_sellfox_ro/, `${name} 仍使用旧角色名，审计 SQL 会永远误报`);
    assert.match(text, /amazon_mcp_ro/, `${name} 缺少 amazon_mcp_ro`);
    assert.match(text, /sellfox_mcp_ro/, `${name} 缺少 sellfox_mcp_ro`);
  }

  // 代码侧常量须与审计 SQL 侧命名完全一致，否则 UI 矩阵和实测角色对不上。
  assert.equal(mcpProviderPolicies.amazon.dbRole, "amazon_mcp_ro");
  assert.equal(mcpProviderPolicies.sellfox.dbRole, "sellfox_mcp_ro");
});

test("scope 缺失 workspaceId：生产、开发及测试环境均拒绝", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    Object.assign(process.env, { NODE_ENV: "production" });
    assert.throws(
      () => workspaceScopeFromRequest(new Request("http://fixture.invalid/api/resource")),
      (error: unknown) => error instanceof WorkspaceScopeError && error.status === 400,
      "生产环境缺少 workspaceId 必须拒绝，不能静默落到共享 default",
    );
    assert.throws(
      () => workspaceScopeFromRequest(new Request("http://fixture.invalid/api/resource", { headers: { "x-workspace-id": "   " } })),
      WorkspaceScopeError,
      "空 workspaceId 头同样视为缺失",
    );

    for (const environment of ["development", "test"]) {
      Object.assign(process.env, { NODE_ENV: environment });
      assert.throws(
        () => workspaceScopeFromRequest(new Request("http://fixture.invalid/api/resource")),
        (error: unknown) => error instanceof WorkspaceScopeError && error.status === 400,
      );
    }
  } finally {
    if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.assign(process.env, { NODE_ENV: previousNodeEnv });
  }
});

test("workspaceId 选择器优先级保持 body > header > query", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousWarn = console.warn;
  console.warn = () => undefined;
  try {
    Object.assign(process.env, { NODE_ENV: "test" });
    const url = "http://fixture.invalid/api/resource?workspaceId=query-ws";
    const headerOnly = workspaceScopeFromRequest(new Request(url, { headers: { "x-workspace-id": "header-ws" } }));
    assert.equal(headerOnly.workspaceId, "header-ws");

    const bodyFirst = workspaceScopeFromRequest(
      new Request(url, { headers: { "x-workspace-id": "header-ws" } }),
      { workspaceId: "body-ws" },
    );
    assert.equal(bodyFirst.workspaceId, "body-ws");
  } finally {
    console.warn = previousWarn;
    if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.assign(process.env, { NODE_ENV: previousNodeEnv });
  }
});
