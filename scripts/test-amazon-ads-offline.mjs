import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";


const root = process.cwd(), suffix = randomUUID().slice(0, 8), pgName = `codex-sync-test-pg-${suffix}`, redisName = `codex-sync-test-redis-${suffix}`;
const temporary = await mkdtemp(join(tmpdir(), "amazon-sync-integration-"));
const started = [];
const docker = args => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function run(command, args, env) { return new Promise((resolve, reject) => { const child = spawn(command, args, { cwd: root, env, stdio: "inherit" }); child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))); }); }
async function cleanup() { for (const name of started.reverse()) { try { docker(["stop", "--time", "2", name]); } catch { console.error(`Please remove disposable fixture container ${name}`); } } await rm(temporary, { recursive: true, force: true }); }
try {
  // Require preinstalled official images. Never pull images or touch existing containers.
  docker(["image", "inspect", "postgres:16-alpine"]); docker(["image", "inspect", "redis:7"]);
  docker(["run", "--pull=never", "--rm", "-d", "--name", pgName, "--label", "codex.task=amazon-sync-integration", "--memory=512m", "--cpus=1", "-e", "POSTGRES_PASSWORD=fixture_password", "-e", "POSTGRES_DB=amazon_sync_test", "-p", "127.0.0.1::5432", "postgres:16-alpine"]); started.push(pgName);
  docker(["run", "--pull=never", "--rm", "-d", "--name", redisName, "--label", "codex.task=amazon-sync-integration", "--memory=128m", "--cpus=0.5", "-p", "127.0.0.1::6379", "redis:7", "redis-server", "--save", "", "--appendonly", "no"]); started.push(redisName);
  const pgPort = docker(["port", pgName, "5432"]).split(":").at(-1), redisPort = docker(["port", redisName, "6379"]).split(":").at(-1);
  // Explicit allowlist: never inherit credentials, private dotenv paths or real DB URLs.
  const env = { AMAZON_ADS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), AMAZON_ADS_LWA_CLIENT_ID: "fixture-client", AMAZON_ADS_LWA_CLIENT_SECRET: "fixture-secret", QUEUE_DRIVER: "redis", PATH: process.env.PATH, TMPDIR: tmpdir(), DATABASE_URL: `postgresql://postgres:fixture_password@127.0.0.1:${pgPort}/amazon_sync_test`, REDIS_URL: `redis://127.0.0.1:${redisPort}`, AMAZON_SYNC_TEST_REDIS_DISPOSABLE: "1", AMAZON_SYNC_OFFLINE_FIXTURE: "1", AMAZON_SYNC_BENCHMARK_OUTPUT: join(temporary, "capacity.json"), STORAGE_DRIVER: "local", UPLOAD_DIR: join(temporary, "uploads"), AUTH_DRIVER: "database", AUTH_SECRET: "fixture-only-isolated-integration-secret-2026", AMAZON_DATA_CENTER_ENVIRONMENT: "local" };
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) { try { docker(["exec", pgName, "pg_isready", "-U", "postgres"]); ready = true; break; } catch { /* Local readiness probe only; no real test sleeps. */ } }
  if (!ready) throw new Error("Fixture PostgreSQL did not become ready");
  const baseline = join(temporary, "schema.prisma");
  await writeFile(baseline, await readFile(join(root, "prisma/schema.prisma"), "utf8"));
  const fixtureConfig = join(temporary, "prisma.config.ts");
  await writeFile(fixtureConfig, `import { defineConfig } from ${JSON.stringify(join(root, "node_modules/prisma/config.js"))}; export default defineConfig({schema:${JSON.stringify(baseline)},datasource:{url:${JSON.stringify(env.DATABASE_URL)}}});`);
  await run(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--config", fixtureConfig], env);
  const testFiles = process.argv.includes("--reporting-v1") ? ["tests/integration/amazon-ads-reporting-v1.integration.ts"] : process.argv.includes("--report-worker") ? ["tests/integration/amazon-ads-report-worker.integration.ts"] : process.argv.includes("--reports") ? ["tests/integration/amazon-ads-reports.integration.ts"] : process.argv.includes("--mcp")
    ? ["tests/integration/amazon-ads-mcp.integration.ts"]
    : ["tests/integration/amazon-ads.integration.ts", "tests/integration/amazon-ads-mcp.integration.ts"];
  for (const testFile of testFiles) {
    await run(process.execPath, ["--import", join(root, "tests/helpers/amazon-offline-network-guard.mjs"), "node_modules/tsx/dist/cli.mjs", "--test", "--test-concurrency=1", testFile], env);
  }
} finally { await cleanup(); }
