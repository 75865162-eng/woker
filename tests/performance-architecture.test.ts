import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? files(filename) : [filename];
  });
}

test("business routes retain the authenticated app shell in one persistent App Router layout", () => {
  assert.ok(files(path.join(root, "src/app/(erp)")).some(filename => filename.endsWith("/layout.tsx")));
  assert.ok(!files(path.join(root, "src/app")).filter(filename => !filename.includes("/(erp)/"))
    .some(filename => filename.endsWith("/page.tsx") && !filename.includes("/login/")));
  for (const filename of files(path.join(root, "src/app/(erp)"))) {
    if (!filename.endsWith("/page.tsx")) continue;
    const source = readFileSync(filename, "utf8");
    let routeDirectory = path.dirname(filename);
    let routeLayoutOwnsShell = false;
    while (routeDirectory.startsWith(path.join(root, "src/app/(erp)"))) {
      const layout = path.join(routeDirectory, "layout.tsx");
      if (existsSync(layout) && /@\/components\/app-shell\/(?:app-shell|persistent-app-shell)/.test(readFileSync(layout, "utf8"))) {
        routeLayoutOwnsShell = true;
        break;
      }
      routeDirectory = path.dirname(routeDirectory);
    }
    assert.ok(source.includes("@/components/app-shell/app-shell") || routeLayoutOwnsShell || filename.endsWith("/(erp)/page.tsx"),
      `${filename} must use the shared authorized AppShell`);
    assert.ok(!source.includes("app-shell-client"), `${filename} must not create another shell owner`);
  }
});

test("Tailwind scans application source only; generated Next output and task artifacts stay outside the scan", () => {
  const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
  assert.match(css, /@import "tailwindcss" source\("\.\.\/"\)/);
});
