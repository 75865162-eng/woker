import assert from "node:assert/strict";
import test from "node:test";
import { readWorkspaceScope, readWorkspaceScopeId, workspaceScopeHeaders, workspaceScopeStorageKey } from "@/lib/workspace/workspace-scope-store";

const legacyKey = "tiaotiao.workspace.scope";

function withStorage(values: Record<string, string>) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const store = new Map(Object.entries(values));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  };
}

test("选择器写入的主键优先于历史键", () => {
  const restore = withStorage({
    [workspaceScopeStorageKey]: JSON.stringify({ workspaceId: "ws-main" }),
    [legacyKey]: JSON.stringify({ workspaceId: "ws-legacy" }),
  });
  try {
    assert.equal(readWorkspaceScopeId(), "ws-main");
  } finally {
    restore();
  }
});

test("历史键不再被读取，唯一来源只有主键", () => {
  const restore = withStorage({ [legacyKey]: JSON.stringify({ workspaceId: "ws-legacy" }) });
  try {
    assert.equal(readWorkspaceScopeId(), "default");
  } finally {
    restore();
  }
});

test("两套键都没有时落到 default", () => {
  const restore = withStorage({});
  try {
    assert.equal(readWorkspaceScopeId(), "default");
  } finally {
    restore();
  }
});

test("损坏的 JSON 与空白 id 都不抛出，按 default 处理", () => {
  const restore = withStorage({
    [workspaceScopeStorageKey]: "{not-json",
    [legacyKey]: JSON.stringify({ workspaceId: "   " }),
  });
  try {
    assert.equal(readWorkspaceScopeId(), "default");
  } finally {
    restore();
  }
});

test("工作区、账号和站点从同一个快照读取，不拼接历史键字段", () => {
  const restore = withStorage({
    [workspaceScopeStorageKey]: JSON.stringify({ workspaceId: " ws-main ", accountId: " account-main ", marketplace: " US " }),
    [legacyKey]: JSON.stringify({ workspaceId: "ws-legacy", accountId: "account-legacy" }),
  });
  try {
    assert.deepEqual(readWorkspaceScope(), { workspaceId: "ws-main", accountId: "account-main", marketplace: "US" });
    const headers = workspaceScopeHeaders();
    assert.equal(headers.get("x-account-id"), "account-main");
    assert.equal(headers.get("x-marketplace"), "US");
    localStorage.setItem(workspaceScopeStorageKey, JSON.stringify({ workspaceId: "ws-next", accountId: 123, marketplace: {} }));
    assert.equal(workspaceScopeHeaders().get("x-account-id"), null);
    assert.equal(workspaceScopeHeaders().get("x-marketplace"), null);
  } finally {
    restore();
  }
});

test("null、原始值、数组与异常存储访问不会使作用域读取抛错", () => {
  const restore = withStorage({});
  try {
    for (const value of ["null", "123", "true", "[]", '"text"', '{"workspaceId":123}']) {
      localStorage.setItem(workspaceScopeStorageKey, value);
      assert.equal(readWorkspaceScopeId(), "default");
    }
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    assert.deepEqual(readWorkspaceScope(), { workspaceId: "default", accountId: "", marketplace: "" });
  } finally {
    restore();
  }
});

test("请求头带上工作区；json=true 时补 content-type", () => {
  const restore = withStorage({ [workspaceScopeStorageKey]: JSON.stringify({ workspaceId: "ws-headers" }) });
  try {
    const plain = workspaceScopeHeaders();
    assert.equal(plain.get("x-workspace-id"), "ws-headers");
    assert.equal(plain.get("content-type"), null);
    assert.equal(workspaceScopeHeaders(true).get("content-type"), "application/json");
  } finally {
    restore();
  }
});
