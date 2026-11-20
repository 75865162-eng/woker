import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * 分级门禁的子集测试运行器。
 * 读取 dist/change-tier.json 的 testScope 显式清单运行；清单缺失/为空时回退全量，
 * 保证任何情况下都不会"零测试放行"。全量逻辑与 run-unit-tests.mjs 保持一致。
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const inherited = process.env;
const env = Object.fromEntries([
  "PATH", "Path", "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC", "PATHEXT",
  "HOME", "USERPROFILE", "TEMP", "TMP", "TMPDIR",
].flatMap((key) => (inherited[key] === undefined ? [] : [[key, inherited[key]]])));

const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const preload = pathToFileURL(path.join(root, "scripts", "runtime", "test-environment.mjs")).href;
const tierPath = path.join(root, "dist", "change-tier.json");

let tests = null;
if (existsSync(tierPath)) {
  try {
    const report = JSON.parse(readFileSync(tierPath, "utf8"));
    if (report.tier === "fast" && Array.isArray(report.testScope) && report.testScope.length) {
      tests = report.testScope.filter((file) => existsSync(path.join(root, file)));
    }
  } catch {
    tests = null;
  }
}

// 回退全量：清单无效、档位非 fast、或清单里的文件都不存在。
if (!tests || tests.length === 0) {
  const { readdirSync } = await import("node:fs");
  tests = readdirSync(path.join(root, "tests"))
    .filter((name) => /\.test\.(?:ts|mjs)$/.test(name))
    .sort()
    .map((name) => path.join("tests", name));
  console.error("[run-unit-tests-changed] no valid fast-tier scope; running full suite");
}

const child = spawn(process.execPath, [tsx, "--import", preload, "--test", ...tests], {
  cwd: root,
  env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(`Unable to start unit tests: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
