import { runtimeVersion } from "./version.mjs";
import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { applyRuntimeEnvironment, projectRoot } from "./environment.mjs";

// Next standalone output intentionally omits static/ and public/. The Windows
// launcher mirrors them with xcopy; do the same here so `npm run start:standalone`
// serves JS/CSS/assets on macOS and Linux too. Idempotent: only copy when missing.
function mirrorIfMissing(source, target) {
  if (existsSync(target)) return;
  if (!existsSync(source)) {
    throw new Error(`Standalone asset missing: ${source}. Run npm run build first.`);
  }
  cpSync(source, target, { recursive: true });
}

const distDir = path.join(projectRoot, ".next-build");
const standaloneDist = path.join(distDir, "standalone", ".next-build");
mirrorIfMissing(path.join(distDir, "static"), path.join(standaloneDist, "static"));
mirrorIfMissing(path.join(projectRoot, "public"), path.join(distDir, "standalone", "public"));

const child = spawn(process.execPath, [path.join(projectRoot, ".next-build/standalone/server.js")], {
  cwd: projectRoot, env: { ...applyRuntimeEnvironment(), ERP_RUNTIME_VERSION: runtimeVersion() }, stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { console.error("Unable to start standalone web"); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
