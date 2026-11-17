import { runtimeVersion } from "./runtime/version.mjs";
import { spawn } from "node:child_process";
import { applyRuntimeEnvironment } from "./runtime/environment.mjs";
import { existsSync } from "node:fs";
import { readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { acquireNextOutputLock } from "./runtime/next-output-lock.mjs";

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

// Acquire before loading configuration or generating files. Different ports may
// otherwise overwrite each other's RSC manifests in the same distDir.
const releaseOutputLock = acquireNextOutputLock(path.resolve(distDir));
process.on("exit", releaseOutputLock);
const runtimeEnv = applyRuntimeEnvironment({ build: args[0] === "build" });
// Turbopack resolves `paths` aliases relative to the tsconfig file's own
// directory. A generated tsconfig inside a nested .next-types-*/ directory makes
// "@/..." resolve to <root>/.next-types-*/src/... in the edge (middleware) build,
// so keep the temporary tsconfig at the project root (random suffix keeps
// parallel invocations isolated) and set baseUrl to "." to match the real layout.
await mkdir(path.join(process.cwd(), "tmp"), { recursive: true });
const typeSuffix = randomBytes(6).toString("hex");
const typeConfig = path.join(process.cwd(), `.next-types-${typeSuffix}.json`);
const ambient = path.join(process.cwd(), `.next-types-ambient-${typeSuffix}.d.ts`);
await writeFile(ambient, `/// <reference path=${JSON.stringify(path.relative(process.cwd(), path.resolve(distDir, "types/routes.d.ts")))} />
/// <reference types="next" />
/// <reference types="next/image-types/global" />
`);
await writeFile(typeConfig, JSON.stringify({
  compilerOptions: {
    target: "ES2020",
    lib: ["dom", "dom.iterable", "esnext"],
    allowJs: true,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
    esModuleInterop: true,
    module: "esnext",
    moduleResolution: "bundler",
    resolveJsonModule: true,
    isolatedModules: true,
    jsx: "preserve",
    baseUrl: ".",
    paths: { "@/*": ["./src/*"] },
    incremental: false,
    plugins: [{ name: "next" }],
  },
  include: [ambient, ...["*.ts", "*.mts", "src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts", "scripts/**/*.mts", "tests/**/*.ts", "tests/**/*.tsx", `${distDir}/types/**/*.ts`].map(p => path.resolve(p))],
  exclude: [path.join(process.cwd(), "node_modules"), path.join(process.cwd(), "next-env.d.ts")],
}, null, 2));

const child = spawn(process.execPath, [command, ...args], {
  env: {
    ...runtimeEnv,
    ERP_RUNTIME_VERSION: runtimeVersion(),
    NEXT_DIST_DIR: distDir,
    ERP_NEXT_TYPESCRIPT_CONFIG: path.basename(typeConfig),
  },
  shell: false,
  stdio: "inherit",
});

async function cleanupTypeFiles() {
  await Promise.all([
    rm(typeConfig, { force: true }),
    rm(ambient, { force: true }),
  ]);
}

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
        // Runtime configuration is supplied by the host, never by the artifact.
        if (entry.name === ".env" || entry.name.startsWith(".env.")) {
          return true;
        }

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
          // Windows 会短暂锁住深层嵌套的 .next-* 副本（EPERM/EBUSY/ENOTEMPTY），
          // 有限重试即可收敛；构建产物本身与代码无关，不应因此判构建失败。
          maxRetries: 5,
          retryDelay: 200,
        }),
      ),
  );
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", async () => { await cleanupTypeFiles(); console.error("Unable to start Next"); process.exitCode = 1; });

child.on("exit", async (code, signal) => {
  await cleanupTypeFiles();
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
