import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const exec = promisify(execFile);
const name = `erp-cli-test-${randomBytes(6).toString("hex")}`;
const password = randomBytes(24).toString("hex");
let started = false;
try {
  await exec("docker", ["run", "--detach", "--rm", "--name", name, "--label", "erp-cli-test=true", "--memory", "512m", "--cpus", "1", "--tmpfs", "/var/lib/postgresql/data:rw", "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=erp_test", "-e", "POSTGRES_DB=erp_cli_test", "-e", `POSTGRES_PASSWORD=${password}`, "postgres:16-alpine"]);
  started = true;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await exec("docker", ["exec", name, "pg_isready", "-U", "erp_test", "-d", "erp_cli_test"], { timeout: 2000 }); break; }
    catch { if (attempt === 39) throw new Error("TEST_DATABASE_NOT_READY"); await delay(500); }
  }
  const { stdout: mapping } = await exec("docker", ["port", name, "5432/tcp"]);
  const port = mapping.trim().match(/^127\.0\.0\.1:(\d+)$/)?.[1];
  if (!port) throw new Error("TEST_DATABASE_MUST_BIND_LOOPBACK");
  const databaseUrl = `postgresql://erp_test:${password}@127.0.0.1:${port}/erp_cli_test`;
  const env = { ...process.env, DATABASE_URL: databaseUrl, ERP_ORGANIZATION_ID: "erp-test-org", ERP_ACTOR_USER_ID: "erp-test-owner", QUEUE_DRIVER: "inline" };
  await exec(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--schema", "prisma/schema.prisma"], { env, timeout: 120000 });
  const result = await exec(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--test", "scripts/erp-cli/integration.test.ts"], { env, timeout: 120000, maxBuffer: 5 * 1024 * 1024 });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
} catch (error) {
  const output = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n").replaceAll(password, "[redacted]");
  console.error(output); process.exitCode = 1;
} finally {
  if (started) await exec("docker", ["stop", "--time", "2", name]).catch(() => { console.error(`Cleanup required: docker stop ${name}`); process.exitCode = 1; });
}
