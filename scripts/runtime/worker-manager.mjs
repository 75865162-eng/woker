import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { applyRuntimeEnvironment, projectRoot } from "./environment.mjs";
import { runtimeVersion } from "./version.mjs";

export const registry = createRequire(import.meta.url)("../../src/lib/runtime/worker-registry.json");
export const restartDelay = failures => Math.min(30_000, 1000 * 2 ** Math.min(5, Math.max(0, failures - 1)));

export function supervise(items, { env, launch = spawn, log = console.log, onFatal = () => {} } = {}) {
  let stopping = false;
  let started = false;
  let stopPromise;
  const slots = items.map(item => ({ item, child: null, timer: null, failures: 0, started: 0 }));
  const start = slot => {
    if (stopping) return;
    slot.started = Date.now();
    let child;
    try {
      child = launch(process.execPath, ["--import", "tsx", path.join(projectRoot, "scripts/runtime/worker-child.mjs"), slot.item.id], { cwd: projectRoot, env, stdio: ["ignore", "inherit", "inherit", "ipc"] });
    } catch {
      log(`[worker-manager] unable to launch ${slot.item.id}; stopping startup`);
      onFatal(); return;
    }
    slot.child = child;
    log(`[worker-manager] starting ${slot.item.id}`);
    let handled = false;
    const exited = code => {
      if (handled) return; handled = true;
      slot.child = null;
      if (stopping) return;
      if (code === 73) { log(`[worker-manager] duplicate ${slot.item.id}; refusing partial startup`); onFatal(); return; }
      if (Date.now() - slot.started > 60_000) slot.failures = 0;
      const delay = restartDelay(++slot.failures);
      log(`[worker-manager] ${slot.item.id} exited; retry in ${delay}ms`);
      slot.timer = setTimeout(() => start(slot), delay);
    };
    child.once("error", () => exited(1));
    child.once("exit", code => exited(code));
  };
  return {
    start() { if (started || stopping) return; started = true; for (const slot of slots) start(slot); },
    stop(timeoutMs = 25_000) {
      if (stopPromise) return stopPromise;
      stopping = true;
      stopPromise = Promise.all(slots.map(slot => {
        clearTimeout(slot.timer);
        const child = slot.child;
        if (!child) return;
        return new Promise(resolve => {
          const timer = setTimeout(() => { child.kill("SIGKILL"); }, timeoutMs);
          child.once("exit", () => { clearTimeout(timer); resolve(); });
          child.kill("SIGTERM");
        });
      }));
      return stopPromise;
    },
  };
}

if (process.argv[1] === path.join(projectRoot, "scripts/runtime/worker-manager.mjs")) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--list") {
    for (const item of registry) console.log(`${item.id}: ${item.label}`);
  } else {
    if (args.length > 1 || (args.length && !registry.some(item => item.id === args[0]))) throw new Error("Usage: npm run worker -- [--list|registration-id]");
    // Single-instance pid file: the scheduled task repeats on a timer and must not spawn a second consumer.
    const { existsSync, readFileSync, unlinkSync, writeFileSync } = await import("node:fs");
    const pidPath = path.join(projectRoot, "tmp", `worker-${args[0] ?? "all"}.pid`);
    const releasePid = () => {
      try { if (existsSync(pidPath) && readFileSync(pidPath, "utf8").trim() === String(process.pid)) unlinkSync(pidPath); } catch { /* best effort */ }
    };
    writeFileSync(pidPath, String(process.pid));
    process.on("exit", releasePid);
    const env = { ...applyRuntimeEnvironment(), ERP_RUNTIME_VERSION: runtimeVersion() };
    const manager = supervise(args.length ? registry.filter(item => item.id === args[0]) : registry, { env, onFatal: () => void stop(1) });
    let closing = false;
    async function stop(code = 0) { if (closing) return; closing = true; await manager.stop(); releasePid(); process.exit(code); }
    process.on("SIGINT", () => void stop());
    process.on("SIGTERM", () => void stop());
    manager.start();
  }
}
