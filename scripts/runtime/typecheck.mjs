// Source validation excludes mutable Next output belonging to other processes.
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = await mkdtemp(path.join(tmpdir(), "erp-source-types-"));
try {
  const ambient = path.join(directory, "next.d.ts");
  await writeFile(ambient, `import ${JSON.stringify(path.join(root, "node_modules/next"))};
import ${JSON.stringify(path.join(root, "node_modules/next/image-types/global"))};
`);
  const config = path.join(directory, "tsconfig.json");
  await writeFile(config, JSON.stringify({
    extends: path.join(root, "tsconfig.json"),
    compilerOptions: { incremental: false },
    include: [ambient, ...["src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts", "scripts/**/*.mts", "tests/**/*.ts", "tests/**/*.tsx", "*.ts", "*.mts"].map(p => path.join(root, p))],
    exclude: [path.join(root, "node_modules"), path.join(root, "next-env.d.ts"), path.join(root, ".next*")],
  }, null, 2));
  const child = spawn(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--project", config], { cwd: root, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
  process.exitCode = await new Promise(resolve => { child.on("error", error => { console.error(error.message); resolve(1); }); child.on("exit", code => resolve(code ?? 1)); });
} finally { await rm(directory, { recursive: true, force: true }); }
