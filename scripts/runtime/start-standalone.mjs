import { runtimeVersion } from "./version.mjs";
import { spawn } from "node:child_process";
import path from "node:path";
import { applyRuntimeEnvironment, projectRoot } from "./environment.mjs";

const child = spawn(process.execPath, [path.join(projectRoot, ".next-build/standalone/server.js")], {
  cwd: projectRoot, env: { ...applyRuntimeEnvironment(), ERP_RUNTIME_VERSION: runtimeVersion() }, stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { console.error("Unable to start standalone web"); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
