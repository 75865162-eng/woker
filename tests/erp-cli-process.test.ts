import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function run(input: unknown, args: string[] = []) {
  // This suite must never access a configured database.
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/erp-cli/src/cli.ts", ...args], {
    input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "", ERP_ORGANIZATION_ID: "", ERP_ACTOR_USER_ID: "", SELECTION_ORGANIZATION_ID: "", SELECTION_ACTOR_USER_ID: "" },
  });
}
const draft = { version: 1, sku: "ERP-STDIN", title: "商品", marketplace: "US", workspace: "default" };
test("stdin and forwarded package-manager separator work without Cookie", () => {
  const child = run(draft, ["--", "products", "upsert", "--file", "-"]);
  assert.equal(child.status, 1);
  const result = JSON.parse(child.stdout);
  assert.equal(result.sku, draft.sku); assert.equal(result.dryRun, true);
  assert.match(result.errors[0], /UNAUTHORIZED/);
});
test("invalid JSON and unknown flags produce exactly one JSON error", () => {
  for (const [input, args] of [["bad json", ["products", "upsert"]], [draft, ["products", "upsert", "--typo"]]] as const) {
    const child = run(input, [...args]);
    assert.equal(child.status, 1); assert.equal(JSON.parse(child.stdout).ok, false);
    assert.equal(child.stdout.trim().split("\n").length, 1);
  }
});
test("get missing identity has read-only error semantics", () => {
  const child = run("", ["products", "get", "--sku", "A"]);
  assert.equal(JSON.parse(child.stdout).dryRun, false); assert.equal(child.status, 1);
});
