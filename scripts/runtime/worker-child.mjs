import { openSync, mkdirSync, readFileSync, unlinkSync, closeSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { applyRuntimeEnvironment, projectRoot } from "./environment.mjs";
import { watchParent } from "./parent-lifecycle.mjs";

const registry = createRequire(import.meta.url)("../../src/lib/runtime/worker-registry.json");
applyRuntimeEnvironment();
const item = registry.find(worker => worker.id === process.argv[2]);
if (!item) throw new Error("Unknown Worker registration");
if (typeof process.send !== "function") throw new Error("Worker child requires its owning manager IPC channel");
const stopWatchingParent = watchParent();
process.on("exit", stopWatchingParent);
// Same DB/Redis target shares a lock even across releases and start commands.
const targets = ["DATABASE_URL", "REDIS_URL"].map(key => {
  const u = new URL(process.env[key]); u.username = ""; u.password = ""; return u.toString();
});
const scope = createHash("sha256").update(JSON.stringify(targets)).digest("hex").slice(0, 24);
const directory = path.join(tmpdir(), `erp-worker-locks-${process.getuid?.() ?? "user"}`);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const lock = path.join(directory, `${scope}-${item.id}.lock`);
let fd;
for (let attempt = 0; attempt < 2; attempt++) {
  try { fd = openSync(lock, "wx", 0o600); break; }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    let owner;
    try { owner = JSON.parse(readFileSync(lock, "utf8")); } catch { throw new Error(`Worker ${item.id} lock requires manual inspection`); }
    if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error("Invalid Worker lock; inspect manually");
    try { process.kill(owner.pid, 0); }
    catch (probeError) {
      if (probeError.code !== "ESRCH") throw probeError;
      // Recheck inode contents so a concurrent replacement is never removed.
      if (readFileSync(lock, "utf8") === JSON.stringify(owner)) unlinkSync(lock);
      continue;
    }
    console.error(`[${item.id}] already running; stop its owning manager before starting another`);
    process.exit(73);
  }
}
if (fd === undefined) throw new Error("Unable to acquire Worker lock");
writeSync(fd, JSON.stringify({ pid: process.pid }));
process.on("exit", () => {
  closeSync(fd);
  try { if (JSON.parse(readFileSync(lock, "utf8")).pid === process.pid) unlinkSync(lock); } catch { /* Stale lock is checked on next start. */ }
});
process.env.ERP_WORKER_REGISTRATION = item.id;
await import(pathToFileURL(path.join(projectRoot, item.entry)).href);
