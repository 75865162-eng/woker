import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
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

const child = spawn(process.execPath, [command, ...args], {
  env: {
    ...process.env,
    NEXT_DIST_DIR: distDir,
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

child.on("exit", async (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
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
