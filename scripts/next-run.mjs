import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
