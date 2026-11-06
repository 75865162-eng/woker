// Approved local cutover only. Keeps restore database for separately approved cleanup.
import { readFileSync, mkdirSync, writeFileSync, openSync, closeSync, chmodSync, statfsSync, createReadStream } from "node:fs";
import { parseEnv } from "node:util";
import { createHash, createDecipheriv } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { projectRoot } from "./environment.mjs";
const { Client } = createRequire(import.meta.url)("pg");
if (process.argv[2] !== "--apply-approved-local") throw new Error("Explicit local cutover approval required");
const hashes = { ".env": "eea1fff8b29f9294db624a02be7ed0680f76cff49f9fe4535a6539bc1a140c91", ".env.amazon-live.local": "0ef5821a9378f3084a18867b77d58ba42bd5232e6fa8c0d778339b3074d45a47" };
const raw = Object.fromEntries(Object.entries(hashes).map(([name, hash]) => {
  const value = readFileSync(path.join(projectRoot, name));
  if (createHash("sha256").update(value).digest("hex") !== hash) throw new Error("Configuration fingerprint changed; re-review required");
  return [name, value];
}));
const env = parseEnv(raw[".env.amazon-live.local"].toString());
const url = new URL(env.DATABASE_URL);
if (url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/amazon_sync_live_local") throw new Error("Unapproved database target");
const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 3000, statement_timeout: 30000 });
const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
const directory = path.join("/Users/chenjieliang/.codex/backups/erp-local-cutover", timestamp);
const restoreDatabase = `erp_cutover_restore_${timestamp.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
const dockerEnv = { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONTEXT: process.env.DOCKER_CONTEXT, PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)) };
const base = ["exec", "-i", "-e", "PGUSER", "-e", "PGPASSWORD", "-e", "PGDATABASE", "-e", "PGHOST=127.0.0.1", "-e", "PGPORT=5432", "amazon-sync-live-postgres"];
async function restoreCommand(args, dump) {
  await new Promise((resolve, reject) => {
    const child = spawn("docker", [...base, ...args], { env: dockerEnv, stdio: ["pipe", "ignore", "ignore"] });
    const input = createReadStream(dump);
    // --list closes stdin after reading the TOC; EPIPE is harmless only if exit is 0.
    child.stdin.on("error", error => { if (error.code !== "EPIPE") reject(new Error("Backup input stream failed")); });
    input.on("error", () => { child.kill("SIGTERM"); reject(new Error("Backup read failed")); });
    child.on("error", () => { input.destroy(); reject(new Error("Restore executable unavailable")); });
    child.on("close", code => { input.destroy(); if (code === 0) resolve(); else reject(new Error("Restore verification failed")); });
    input.pipe(child.stdin);
  });
}
function decrypt(value, key, aad) {
  const [version, iv, ciphertext, tag, extra] = value.split(".");
  if (!["v1", "v2"].includes(version) || extra || !iv || !ciphertext || !tag || !key) throw new Error("Invalid credential envelope");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(JSON.stringify(aad))); decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const buffer = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]);
  buffer.fill(0);
}
try {
  await client.connect(); await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const tableNames = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r => r.tablename);
  const keyCheck = {};
  for (const [table, field, key, scope] of [
    ["AmazonIntegrationSecret", "credentialsCiphertext", "AMAZON_SP_API_ENCRYPTION_KEY", r => [r.organizationId, r.workspaceId]],
    ["AmazonSpApiAuthorization", "credentialsCiphertext", "AMAZON_SP_API_ENCRYPTION_KEY", r => [r.organizationId, r.workspaceId, r.id]],
    ["SellfoxIntegrationCredential", "credentialsCiphertext", "SELLFOX_CREDENTIAL_ENCRYPTION_KEY", r => ["sellfox", r.organizationId, r.workspaceId]],
    ["AmazonAdsAuthorization", "credentialsCiphertext", "AMAZON_ADS_ENCRYPTION_KEY", r => [r.organizationId, r.workspaceId, r.id]],
  ]) {
    if (!tableNames.includes(table)) { keyCheck[table] = { rows: 0, tableAbsent: true }; continue; }
    const columns = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table])).rows.map(r => r.column_name);
    if (!columns.includes(field)) throw new Error("Credential schema differs from reviewed implementation");
    const records = (await client.query(`SELECT "organizationId", "workspaceId", ${columns.includes("id") ? 'id,' : ''} "${field}" AS envelope FROM "${table}"`)).rows;
    for (const record of records) if (record.envelope) decrypt(record.envelope, env[key], scope(record));
    keyCheck[table] = { rows: records.length, decrypted: records.filter(r => r.envelope).length };
  }
  const counts = {};
  for (const table of tableNames) counts[table] = (await client.query(`SELECT count(*)::int AS n FROM "${table.replaceAll('"', '""')}"`)).rows[0].n;
  const size = Number((await client.query("SELECT pg_database_size(current_database()) AS bytes")).rows[0].bytes);
  const fs = statfsSync("/Users/chenjieliang/.codex");
  if (fs.bavail * fs.bsize < Math.max(size * 4, 1024 ** 3)) throw new Error("Insufficient backup and restore capacity");
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  for (const [filename, value] of Object.entries(raw)) writeFileSync(path.join(directory, filename + ".before"), value, { mode: 0o600, flag: "wx" });
  const snapshot = (await client.query("SELECT pg_export_snapshot() AS snapshot")).rows[0].snapshot;
  const dump = path.join(directory, "postgres-before-cutover.dump"), fd = openSync(dump, "wx", 0o600);
  try { execFileSync("docker", [...base, "pg_dump", "--format=custom", "--snapshot", snapshot, "--no-password"], { env: dockerEnv, stdio: ["ignore", fd, "pipe"], timeout: 120000 }); }
  finally { closeSync(fd); }
  await client.query("COMMIT");
  await restoreCommand(["pg_restore", "--list"], dump);
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(dump)) digest.update(chunk);
  const checksum = digest.digest("hex");
  writeFileSync(dump + ".sha256", `${checksum}  postgres-before-cutover.dump\n`, { mode: 0o600 });
  await client.query(`CREATE DATABASE "${restoreDatabase}"`);
  await restoreCommand(["pg_restore", "--dbname", restoreDatabase, "--exit-on-error"], dump);
  const restoreUrl = new URL(env.DATABASE_URL); restoreUrl.pathname = "/" + restoreDatabase;
  const restored = new Client({ connectionString: restoreUrl.toString(), connectionTimeoutMillis: 3000 });
  try { await restored.connect(); for (const [table, count] of Object.entries(counts)) {
    if ((await restored.query(`SELECT count(*)::int AS n FROM "${table.replaceAll('"', '""')}"`)).rows[0].n !== count) throw new Error("Restored table count mismatch");
  } } finally { await restored.end(); }
  const result = { directory, restoreDatabase, checksum, tablesVerified: tableNames.length, keyCheck, configurationSha256: hashes, databaseBytes: size, completedAt: new Date().toISOString() };
  writeFileSync(path.join(directory, "BACKUP-RESULT.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(JSON.stringify({ stage: "backup", directory, error: error.code ?? "verification_failed", message: "Backup/cipher verification stopped. No configuration replaced or processes stopped." })); process.exitCode = 1; }
finally { await client.end().catch(() => {}); }
