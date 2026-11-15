import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { workspaceScopeHeaders, workspaceScopeStorageKey } from "@/lib/workspace/workspace-scope-store";

const directory = new URL("../src/components/amazon-ads/", import.meta.url);

function requests(directoryUrl: URL): Array<{ file: string; source: ts.SourceFile; call: ts.CallExpression }> {
  return readdirSync(directoryUrl, { withFileTypes: true }).flatMap(entry => {
    const url = new URL(entry.name, directoryUrl);
    if (entry.isDirectory()) return requests(new URL(`${entry.name}/`, directoryUrl));
    if (!/\.[jt]sx?$/.test(entry.name)) return [];
    const source = ts.createSourceFile(url.pathname, readFileSync(url, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const calls: Array<{ file: string; source: ts.SourceFile; call: ts.CallExpression }> = [];
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
        calls.push({ file: entry.name, source, call: node });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    return calls;
  });
}

const calls = requests(directory);

test("所有 Amazon Ads fetch 显式调用已有作用域请求头，不依赖选择器挂载", () => {
  assert.equal(calls.length, 17);
  for (const { file, source, call } of calls) {
    const label = `${file}:${source.getLineAndCharacterOfPosition(call.getStart()).line + 1}`;
    const imports = source.statements.filter(ts.isImportDeclaration);
    assert.ok(imports.some(statement => ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text === "@/lib/workspace/workspace-scope-store"
      && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
      && statement.importClause.namedBindings.elements.some(binding => binding.name.text === "workspaceScopeHeaders" && !binding.propertyName)), label);
    const options = call.arguments[1];
    assert.ok(options && ts.isObjectLiteralExpression(options), label);
    const properties = options.properties.filter(ts.isPropertyAssignment);
    assert.ok(options.properties.every(property => ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)), label);
    const header = properties.find(property => property.name.getText(source) === "headers")?.initializer;
    assert.ok(header && ts.isCallExpression(header) && ts.isIdentifier(header.expression), label);
    assert.equal(header.expression.text, "workspaceScopeHeaders", label);
    const json = properties.some(property => property.name.getText(source) === "body");
    assert.equal(header.arguments.length, json ? 1 : 0, label);
    if (json) assert.equal(header.arguments[0].kind, ts.SyntaxKind.TrueKeyword, label);
  }
});

test("逐个执行请求传输选项：无需 window 或选择器，即时读取 scope 并保留 signal/cache/JSON 语义", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let stored: string | null = null;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => key === workspaceScopeStorageKey ? stored : null },
  });
  try {
    for (const scope of [null, { workspaceId: "ws-a", accountId: "seller-a", marketplace: "US" }, { workspaceId: "ws-b", accountId: "seller-b", marketplace: "DE" }]) {
      stored = scope ? JSON.stringify(scope) : null;
      let signalCount = 0;
      for (const { source, call } of calls) {
        const options = call.arguments[1];
        assert.ok(ts.isObjectLiteralExpression(options));
        // 仅隔离执行原请求的传输选项，避免挂载 UI、执行业务写入或访问网络。
        const transport = options.properties.filter(property => ts.isPropertyAssignment(property)
          ? property.name.getText(source) !== "body" : true).map(property => property.getText(source));
        const controller = new AbortController();
        let captured: RequestInit | undefined;
        runInNewContext(`fetch("/fixture", { ${transport.join(", ")} })`, {
          workspaceScopeHeaders,
          controller,
          signal: controller.signal,
          fetch: (_url: string, init: RequestInit) => { captured = init; },
        });
        assert.ok(captured);
        const headers = new Headers(captured.headers);
        assert.equal(headers.get("x-workspace-id"), scope?.workspaceId ?? "default");
        assert.equal(headers.get("x-account-id"), scope?.accountId ?? null);
        assert.equal(headers.get("x-marketplace"), scope?.marketplace ?? null);
        assert.equal(headers.get("content-type"), captured.method === "POST" ? "application/json" : null);
        assert.equal(captured.cache, captured.method === "POST" ? undefined : "no-store");
        if (captured.signal) {
          signalCount++;
          assert.equal(captured.signal, controller.signal);
          controller.abort();
          assert.equal(captured.signal.aborted, true);
        }
      }
      assert.equal(signalCount, 5);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
