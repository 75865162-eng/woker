import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireNextOutputLock } from "../scripts/runtime/next-output-lock.mjs";

function fixture(run: (root: string, options: { lockDirectory: string }) => void) {
  const root = mkdtempSync(path.join(tmpdir(), "erp-next-lock-test-"));
  try { run(root, { lockDirectory: path.join(root, "locks") }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("one Next output owner across path aliases, with independent dev/build outputs", () => fixture((root, options) => {
  const output = path.join(root, "dev");
  const release = acquireNextOutputLock(output, options);
  try {
    symlinkSync(output, path.join(root, "alias"), "dir");
    assert.throws(() => acquireNextOutputLock(path.join(root, "alias"), options), /already locked/);
    const releaseBuild = acquireNextOutputLock(path.join(root, "build"), options);
    releaseBuild();
    assert.throws(() => acquireNextOutputLock(output, options), /already locked/);
  } finally { release(); }
  release();
  acquireNextOutputLock(output, options)();
  assert.deepEqual(readdirSync(options.lockDirectory), []);
}));

test("stale or malformed lock requires inspection without deleting another owner's lock", () => fixture((root, options) => {
  const output = path.join(root, "dev");
  const release = acquireNextOutputLock(output, options);
  const filename = path.join(options.lockDirectory, readdirSync(options.lockDirectory)[0]);
  writeFileSync(filename, "unconfirmed owner");
  release();
  assert.equal(readFileSync(filename, "utf8"), "unconfirmed owner");
  assert.throws(() => acquireNextOutputLock(output, options), /verify no process/);
  assert.equal(readFileSync(filename, "utf8"), "unconfirmed owner");
}));

test("output lock survives Next replacing its generated output directory", () => fixture((root, options) => {
  const output = path.join(root, "dev");
  const release = acquireNextOutputLock(output, options);
  try {
    rmSync(output, { recursive: true });
    mkdirSync(output);
    assert.throws(() => acquireNextOutputLock(output, options), /already locked/);
  } finally { release(); }
}));
