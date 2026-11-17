import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const inherited = process.env;
const env = Object.fromEntries([
  "PATH", "Path", "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC", "PATHEXT",
  "HOME", "USERPROFILE", "TEMP", "TMP", "TMPDIR",
].flatMap(key => inherited[key] === undefined ? [] : [[key, inherited[key]]]));
const tests = readdirSync(path.join(root, "tests"))
  .filter(name => /\.test\.(?:ts|mjs)$/.test(name))
  .sort()
  .map(name => path.join("tests", name));
const runnerArgs = process.argv.slice(2);
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const preload = pathToFileURL(path.join(root, "scripts", "runtime", "test-environment.mjs")).href;
const child = spawn(process.execPath, [tsx, "--import", preload, "--test", ...runnerArgs, ...tests], {
  cwd: root,
  env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.on("error", error => {
  console.error(`Unable to start unit tests: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
