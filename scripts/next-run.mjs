import { runtimeVersion } from "./runtime/version.mjs";
import { spawn } from "node:child_process";
import { applyRuntimeEnvironment } from "./runtime/environment.mjs";
import { existsSync } from "node:fs";
import { readdir, rm, mkdtemp, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const [, , distDir, ...args] = process.argv;

if (!distDir || args.length === 0) {
  console.error("Usage: node scripts/next-run.mjs <distDir> <next args...>");
  process.exit(1);
}

const command = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

if (!existsSync(command)) {
  console.error(`Next executable was not found at ${command}`);
  process.exit(1);
}

const runtimeEnv = applyRuntimeEnvironment({ build: args[0] === "build" });
// Next validates only this invocation's generated routes, never old dist outputs.
// Turbopack requires its tsconfig path to remain inside the project root.
await mkdir(path.join(process.cwd(), "tmp"), { recursive: true });
const typeDirectory = await mkdtemp(path.join(process.cwd(), "tmp", "erp-next-types-"));
const typeConfig = path.join(typeDirectory, "tsconfig.json");
const ambient = path.join(typeDirectory, "next.d.ts");
await writeFile(ambient, `/// <reference path=${JSON.stringify(path.relative(typeDirectory, path.resolve(distDir, "types/routes.d.ts")))} />
/// <reference types="next" />
/// <reference types="next/image-types/global" />
`);
await writeFile(typeConfig, JSON.stringify({
  extends: path.relative(typeDirectory, path.join(process.cwd(), "tsconfig.json")),
  compilerOptions: { incremental: false },
  include: [ambient, ...["*.ts", "*.mts", "src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts", "scripts/**/*.mts", "tests/**/*.ts", "tests/**/*.tsx", `${distDir}/types/**/*.ts`].map(p => path.resolve(p))],
  exclude: [path.join(process.cwd(), "node_modules"), path.join(process.cwd(), "next-env.d.ts")],
}, null, 2));

const child = spawn(process.execPath, [command, ...args], {
  env: {
    ...runtimeEnv,
    ERP_RUNTIME_VERSION: runtimeVersion(),
    NEXT_DIST_DIR: distDir,
    ERP_NEXT_TYPESCRIPT_CONFIG: path.relative(process.cwd(), typeConfig),
  },
  shell: false,
  stdio: "inherit",
});

async function cleanupStandaloneOutput() {
  if (args[0] !== "build") {
    return;
  }

  const standaloneDir = path.join(process.cwd(), distDir, "standalone");
  if (!existsSync(standaloneDir)) {
    return;
  }

  const embeddedDistDir = path.basename(path.resolve(distDir));
  const entries = await readdir(standaloneDir, { withFileTypes: true });
  const localOnlyDirs = new Set([".git", "tmp", "tools", "uploads"]);

  await Promise.all(
    entries
      .filter((entry) => {
        if (!entry.isDirectory()) {
          return false;
        }

        if (localOnlyDirs.has(entry.name)) {
          return true;
        }

        return entry.name.startsWith(".next") && entry.name !== embeddedDistDir;
      })
      .map((entry) =>
        rm(path.join(standaloneDir, entry.name), {
          force: true,
          recursive: true,
        }),
      ),
  );
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", async () => { await rm(typeDirectory, { recursive: true, force: true }); console.error("Unable to start Next"); process.exitCode = 1; });

child.on("exit", async (code, signal) => {
  await rm(typeDirectory, { recursive: true, force: true });
  if (signal) {
    process.exit(128 + (signal === "SIGINT" ? 2 : 15));
    return;
  }

  if (code === 0) {
    try {
      await cleanupStandaloneOutput();
    } catch (error) {
      console.error("Failed to clean standalone output:", error);
      process.exit(1);
      return;
    }
  }

  process.exit(code ?? 0);
});
