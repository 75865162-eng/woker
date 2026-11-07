import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "sellfox-credentials-test-"));
const container = `codex-sellfox-credentials-${randomUUID().slice(0, 8)}`;
const docker = args => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const run = (args, env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
  child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Fixture process exited ${code}`)));
});
let started = false;
try {
  docker(["image", "inspect", "postgres:16"]);
  docker(["run", "--pull=never", "--rm", "-d", "--name", container, "--label", "codex.task=sellfox-credentials-test", "--memory=512m", "--cpus=1", "-e", "POSTGRES_PASSWORD=fixture_password", "-e", "POSTGRES_DB=sellfox_credentials_test", "-p", "127.0.0.1::5432", "postgres:16"]);
  started = true;
  const port = docker(["port", container, "5432/tcp"]).split(":").at(-1);
  const url = `postgresql://postgres:fixture_password@127.0.0.1:${port}/sellfox_credentials_test`;
  // Explicit allowlist; never inherit private dotenv, credentials or existing DB URLs.
  const env = { PATH: process.env.PATH, TMPDIR: tmpdir(), DOTENV_CONFIG_PATH: "/dev/null", DATABASE_URL: url, AUTH_DRIVER: "local", AUTH_SECRET: "isolated-sellfox-test-session-secret", SELLFOX_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 91).toString("base64"), SELLFOX_CREDENTIAL_TEST_DISPOSABLE: "1" };
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try { docker(["exec", container, "pg_isready", "-U", "postgres"]); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!ready) throw new Error("Disposable PostgreSQL not ready");
  const schema = join(temporary, "schema.prisma"), config = join(temporary, "prisma.config.ts");
  await writeFile(schema, await readFile(join(root, "prisma/schema.prisma"), "utf8"));
  await writeFile(config, `import {defineConfig} from ${JSON.stringify(join(root, "node_modules/prisma/config.js"))}; export default defineConfig({schema:${JSON.stringify(schema)},datasource:{url:${JSON.stringify(url)}}});`);
  await run(["node_modules/prisma/build/index.js", "db", "push", "--config", config], env);
  // Apply the checked-in migration itself after bootstrapping the disposable schema.
  const pg = new Client({ connectionString: url });
  try {
    await pg.connect();
    await pg.query('DROP TABLE "SellfoxIntegrationCredential"');
    await pg.query(await readFile(join(root, "prisma/migrations/20261106150000_sellfox_integration_credentials/migration.sql"), "utf8"));
  } finally { await pg.end(); }
  await run(["node_modules/tsx/dist/cli.mjs", "--test", "tests/integration/sellfox-credentials.integration.ts"], env);
} finally {
  if (started) try { docker(["stop", "--time", "2", container]); } catch { console.error(`Cleanup pending for disposable container ${container}`); process.exitCode = 1; }
  await rm(temporary, { recursive: true, force: true });
}
