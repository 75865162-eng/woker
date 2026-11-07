import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runtimeEnvironment } from "../scripts/runtime/environment.mjs";

test("retired Amazon profile is rejected and historical file cannot override root", t => {
  const root = mkdtempSync(path.join(tmpdir(), "amazon-runtime-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, ".env"), "DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:55439/fixture\nREDIS_URL=redis://127.0.0.1:6399\nQUEUE_DRIVER=redis\nAUTH_SECRET=fixture-root");
  writeFileSync(path.join(root, ".env.amazon-live.local"), "AUTH_SECRET=fixture-historical");
  assert.equal(runtimeEnvironment({ root, inherited: {} }).AUTH_SECRET, "fixture-root");
  for (const mode of ["local", "production"]) {
    for (const build of [false, true]) {
      assert.throws(() => runtimeEnvironment({ root, inherited: { ERP_RUNTIME_MODE: mode, ERP_LOCAL_INTEGRATION_PROFILE: "amazon-live-approved" }, build }), /profiles are retired/);
    }
  }
  assert.throws(() => runtimeEnvironment({ root, inherited: { DOTENV_CONFIG_PATH: ".env.amazon-live.local" } }), /Alternate dotenv/);
  assert.throws(() => runtimeEnvironment({ root, inherited: { AUTH_SECRET: "fixture-conflict" } }), /conflicts/);
});
