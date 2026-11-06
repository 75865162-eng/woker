// Read-only inventory: no configuration changes, queue consumption or process control.
import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { projectRoot } from "./environment.mjs";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const Redis = createRequire(require.resolve("bullmq"))("ioredis");
const configs = {};
const output = { capturedAt: new Date().toISOString(), configurations: [], processes: [] };
function target(value) { try { const u = new URL(value); return { protocol: u.protocol, host: u.hostname, port: u.port, path: u.pathname }; } catch { return null; } }
for (const filename of [".env", ".env.amazon-live.local"]) {
  if (!existsSync(path.join(projectRoot, filename))) continue;
  const raw = readFileSync(path.join(projectRoot, filename), "utf8"), env = parseEnv(raw); configs[filename] = env;
  const row = { filename, sha256: createHash("sha256").update(raw).digest("hex"), database: target(env.DATABASE_URL), redis: target(env.REDIS_URL), modes: { queue: env.QUEUE_DRIVER, storage: env.STORAGE_DRIVER }, tables: {} };
  if (["127.0.0.1", "localhost", "[::1]"].includes(row.database?.host)) {
    const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 2000, statement_timeout: 3000 });
    try {
      await client.connect(); await client.query("BEGIN READ ONLY");
      row.identity = (await client.query("SELECT current_database() AS database, inet_server_port() AS port")).rows[0];
      for (const table of ["Organization", "ProductRecord", "ImportJob", "ImageUpscaleJob", "AmazonSyncRun", "SellfoxSyncRun", "AmazonSyncSchedule", "SellfoxSyncSchedule", "WorkerHeartbeat", "FileObject"]) {
        const columns = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table])).rows.map(r => r.column_name);
        if (!columns.length) { row.tables[table] = { missing: true }; continue; }
        const info = { count: (await client.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n };
        for (const column of ["status", "enabled", "storageType"]) if (columns.includes(column)) info[column] = (await client.query(`SELECT "${column}"::text AS value, count(*)::int AS n FROM "${table}" GROUP BY "${column}" ORDER BY 1`)).rows;
        if (["ImportJob", "ImageUpscaleJob"].includes(table)) info.leaseColumns = ["executionToken", "leaseExpiresAt", "executionAttempts", "maxAttempts"].filter(c => columns.includes(c));
        row.tables[table] = info;
      }
      await client.query("ROLLBACK");
    } catch (error) { row.databaseError = error.code ?? "read_failed"; }
    finally { await client.end().catch(() => {}); }
  }
  if (["127.0.0.1", "localhost", "[::1]"].includes(row.redis?.host)) {
    const redis = new Redis(env.REDIS_URL, { lazyConnect: true, connectTimeout: 2000, commandTimeout: 2500, maxRetriesPerRequest: 0, retryStrategy: () => null, enableOfflineQueue: false }); redis.on("error", () => {});
    try {
      await redis.connect(); const info = await redis.info("server"), queues = {};
      row.redisInstance = createHash("sha256").update(info.match(/^run_id:(.*)$/m)?.[1]?.trim() ?? "unknown").digest("hex").slice(0, 16);
      for (const name of ["import-jobs", "product-outbox-jobs", "image-upscale-jobs", "amazon-data-center-jobs", "sellfox-sync-jobs"]) {
        const counts = {};
        for (const state of ["wait", "active", "paused", "delayed", "failed", "completed"]) {
          const key = `bull:${name}:${state}`, type = await redis.type(key);
          counts[state] = type === "none" ? 0 : type === "list" ? await redis.llen(key) : type === "zset" ? await redis.zcard(key) : "unexpected";
        }
        queues[name] = counts;
      }
      row.queues = queues;
    } catch (error) { row.redisError = error.code ?? "read_failed"; }
    finally { redis.disconnect(); }
  }
  output.configurations.push(row);
}
const a = configs[".env"], b = configs[".env.amazon-live.local"];
if (a && b) output.keyComparison = Object.keys({ ...a, ...b }).sort().map(key => ({ key, source: key in a && key in b ? "both" : key in a ? "root-only" : "integration-only", equal: a[key] === b[key] }));
for (const line of execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" }).split("\n")) {
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); if (!match || Number(match[1]) === process.pid) continue;
  const [, pid, parent, command] = match;
  const entry = command.match(/scripts\/(?:runtime\/(?:worker-manager|worker-child)|(?:amazon-sync|sellfox-sync|import|image-upscale)-worker|next-run)\.(?:mjs|ts)|next-server|next dev|npm run (?:dev|worker(?::[\w-]+)?)/)?.[0];
  if (!entry) continue;
  let cwd;
  try { cwd = execFileSync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").find(s => s.startsWith("n"))?.slice(1); } catch {}
  if (cwd !== projectRoot) continue;
  let endpoints = [];
  try { endpoints = execFileSync("lsof", ["-a", "-p", pid, "-iTCP", "-nP", "-Fn"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(s => s.startsWith("n")).map(s => s.slice(1)); } catch {}
  output.processes.push({ pid: Number(pid), ppid: Number(parent), entry, started: execFileSync("ps", ["-p", pid, "-o", "lstart="], { encoding: "utf8" }).trim(), cwd, endpoints });
}
console.log(JSON.stringify(output, null, 2));
