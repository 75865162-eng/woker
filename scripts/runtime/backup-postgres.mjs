import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, renameSync, createReadStream, statSync, writeFileSync, rmSync, openSync, closeSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { applyRuntimeEnvironment, projectRoot } from "./environment.mjs";

function execute(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "ignore" });
    child.once("error", () => reject(new Error(`${command} unavailable`)));
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${command} failed; no backup published`)));
  });
}

export async function backupDatabase({ directory, env, run = execute, timestamp = new Date() }) {
  if (!path.isAbsolute(directory) || directory === projectRoot || directory.startsWith(projectRoot + path.sep)) throw new Error("Backup directory must be absolute and outside the repository");
  const url = new URL(env.DATABASE_URL);
  // Explicit libpq mapping: never silently drop TLS/options from a connection URL.
  for (const key of url.searchParams.keys()) if (!["sslmode", "schema"].includes(key)) throw new Error("Backup URL option requires reviewed libpq mapping");
  const pgEnv = {
    PATH: env.PATH, PGHOST: url.hostname, PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGCONNECT_TIMEOUT: "15",
    PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer",
  };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const lock = path.join(directory, ".backup.lock");
  const fd = openSync(lock, "wx", 0o600);
  const name = `postgres-${timestamp.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.dump`;
  const temporary = path.join(directory, `.${name}.partial`);
  const destination = path.join(directory, name);
  try {
    writeFileSync(temporary, "", { mode: 0o600, flag: "wx" });
    await run("pg_dump", ["--format=custom", "--no-password", "--file", temporary], pgEnv);
    await run("pg_restore", ["--list", temporary], pgEnv);
    const bytes = statSync(temporary).size;
    if (!bytes) throw new Error("Empty database backup refused");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(temporary)) hash.update(chunk);
    const checksum = hash.digest("hex");
    renameSync(temporary, destination);
    writeFileSync(`${destination}.sha256`, `${checksum}  ${name}\n`, { mode: 0o600, flag: "wx" });
    return { filename: name, bytes, checksum };
  } finally {
    closeSync(fd); rmSync(lock, { force: true }); rmSync(temporary, { force: true });
  }
}

if (process.argv[1] === path.join(projectRoot, "scripts/runtime/backup-postgres.mjs")) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--apply" || !args[1].startsWith("--directory=")) throw new Error("Approval required. Usage: node scripts/runtime/backup-postgres.mjs --apply --directory=/approved/path");
  void backupDatabase({ directory: args[1].slice("--directory=".length), env: applyRuntimeEnvironment() })
    .then(result => console.log(`[postgres-backup] verified ${result.filename}; ${result.bytes} bytes`))
    .catch(() => { console.error("[postgres-backup] failed; inspect backup permissions, tools and database availability"); process.exitCode = 1; });
}
