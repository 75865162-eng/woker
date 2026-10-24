import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
const exec = promisify(execFile);
const name = `selection-pipeline-test-${randomBytes(6).toString("hex")}`;
const password = randomBytes(24).toString("hex");
async function command(file, args, options = {}) {
  return exec(file, args, { timeout: 120000, maxBuffer: 5 * 1024 * 1024, ...options });
}
let started = false;
try {
  await command("docker", ["run", "--detach", "--rm", "--name", name,
    "--label", "selection-pipeline-test=true", "--memory", "512m", "--cpus", "1",
    "--tmpfs", "/var/lib/postgresql/data:rw", "-p", "127.0.0.1::5432",
    "-e", "POSTGRES_USER=selection_test", "-e", "POSTGRES_DB=selection_pipeline_test",
    "-e", `POSTGRES_PASSWORD=${password}`, "postgres:16-alpine"]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await command("docker", ["exec", name, "pg_isready", "-U", "selection_test", "-d", "selection_pipeline_test"], { timeout: 2000 }); ready = true; break; }
    catch { await delay(500); }
  }
  if (!ready) throw new Error("TEST_DATABASE_NOT_READY");
  const { stdout: mapping } = await command("docker", ["port", name, "5432/tcp"]);
  const port = mapping.trim().match(/^127\.0\.0\.1:(\d+)$/)?.[1];
  if (!port) throw new Error("TEST_DATABASE_MUST_BIND_LOOPBACK");
  // Never accept or reuse a caller's DATABASE_URL. This URL belongs solely to the new container.
  const databaseUrl = `postgresql://selection_test:${password}@127.0.0.1:${port}/selection_pipeline_test`;
  const env = { ...process.env, DATABASE_URL: databaseUrl, SELECTION_TEST_DATABASE_URL: databaseUrl, SELECTION_TEST_CONTAINER: name, QUEUE_DRIVER: "inline" };
  console.log("Preparing isolated PostgreSQL schema (temporary container, no existing database)...");
  await command(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--schema", "prisma/schema.prisma"], { env });
  const result = await command(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--test", "scripts/selection-pipeline/create.integration.test.ts"], { env });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
} catch (error) {
  // The subprocess may include its environment in diagnostic text; redact the generated password.
  const output = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n").replaceAll(password, "[redacted]");
  console.error(output);
  process.exitCode = 1;
} finally {
  if (started) await command("docker", ["stop", "--time", "2", name]).catch(() => { console.error(`Cleanup required: docker stop ${name}`); process.exitCode = 1; });
}
