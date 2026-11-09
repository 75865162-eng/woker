// Fresh PostgreSQL fixture only. Does not read .env or inherit application credentials.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const name = `market-quota-fixture-${randomUUID()}`;
const password = randomUUID();
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr?.slice(0, 300) ?? ""}`);
  return result.stdout.trim();
};
let created = false;
try {
  run("docker", ["run", "--pull=never", "--rm", "-d", "--name", name, "--label", `market-quota-fixture=${name}`,
    "-p", "127.0.0.1::5432", "-e", `POSTGRES_PASSWORD=${password}`, "-e", "POSTGRES_DB=market_quota_fixture", "postgres:16-alpine"]);
  created = true;
  for (let attempt = 0; ; attempt++) {
    const ready = spawnSync("docker", ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], { stdio: "ignore" });
    if (ready.status === 0) break;
    if (attempt >= 40) throw new Error("Fixture PostgreSQL did not start");
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const mapping = JSON.parse(run("docker", ["inspect", "--format", '{{json .NetworkSettings.Ports}}', name]));
  const port = mapping["5432/tcp"][0].HostPort;
  const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--test", "tests/integration/market-call-quota.integration.ts"], {
    stdio: "inherit", env: { PATH: process.env.PATH, NODE_ENV: "test", MARKET_QUOTA_TEST_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/market_quota_fixture` },
  });
  process.exitCode = result.status ?? 1;
} finally {
  if (created) {
    const identity = run("docker", ["inspect", "--format", '{{index .Config.Labels "market-quota-fixture"}}', name]);
    if (identity !== name) throw new Error("Refusing cleanup: fixture identity mismatch");
    run("docker", ["rm", "-f", name]);
  }
}
